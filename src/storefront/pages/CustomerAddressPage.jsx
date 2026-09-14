import { Component, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sfText } from "../lib/sfText";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  MessageCircleWarning,
  Pencil,
  Search,
  Send,
  X,
} from "lucide-react";

import { api } from "../../shared/api/api";
import i18n, { normalizeLanguage } from "../../i18n/i18n";
import { releaseStorefrontColorScheme, setStorefrontColorScheme } from "../../theme/documentColorScheme";
// /addr/:code renders outside the storefront shell (App.jsx), where Storefront.jsx and its
// stylesheets never load — so the page brings the site's tokens and primitives itself.
import "../site-skin.css";
import "../catalog-skin.css";
import "./customerLinks.css";

/*
  The customer's side of the AI-inbox address link (/addr/:code).

  Deliberately Arabic-only and dependency-free: the person opening this came
  from WhatsApp/Instagram on a phone, mid-conversation, and should finish in
  under a minute. One search box picks the whole Bosta city→zone→district
  hierarchy; the manual cascading selects stay available as a fallback.
*/

const text = (value = "") => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const idOf = (item = {}) => text(item.id ?? item.city_id ?? item.zone_id ?? item.district_id);
const labelOf = (item = {}) =>
  text(item.name_ar || item.name_en || item.name || item.city_name_ar || item.zone_name_ar || item.district_name_ar);

const searchRowLabel = (row = {}) => {
  const city = text(row.city_name_ar || row.city_name_en);
  const zone = text(row.zone_name_ar || row.zone_name_en);
  const district = text(row.district_name_ar || row.district_name_en);
  return [city, zone, district && district !== zone ? district : ""].filter(Boolean).join(" — ");
};

// The site's input (site-skin.css): 48px, 16px text, token field colours in both themes.
// The placeholders ARE the field labels here, so they use --m1h-text-3, which clears the
// 4.5:1 floor on --sfx-field in light and dark alike.
const inputClass = "sfx-input";

// Same key and JSON encoding as Storefront.jsx; the shop defaults to dark.
const STOREFRONT_THEME_KEY = "storefront.theme";
const readStorefrontTheme = () => {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(STOREFRONT_THEME_KEY);
    return raw && JSON.parse(raw) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

class CustomerAddressPageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[customer-address-page]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="sf-address-link-page sfx-scope sfl" data-theme={readStorefrontTheme()}>
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
            <div className="sfx-empty">
              <span className="sfx-empty__icon">
                <MessageCircleWarning className="h-7 w-7" aria-hidden="true" />
              </span>
              <h1 className="sfx-empty__title">{sfText("storefront.addressLink.errorTitle")}</h1>
              <p className="sfx-empty__text">{sfText("storefront.addressLink.errorText")}</p>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export function CustomerAddressPage() {
  return (
    <CustomerAddressPageErrorBoundary>
      <CustomerAddressPageInner />
    </CustomerAddressPageErrorBoundary>
  );
}

function CustomerAddressPageInner() {
  useTranslation();
  const { code } = useParams();

  // This page is reached from an Arabic DM and renders OUTSIDE the storefront shell — so it
  // inherited the ERP app's signals: the wrong root `color-scheme`/`theme-color`, and the language
  // fell back to the phone's browser locale, which handed an Egyptian customer an English form.
  //
  // It now paints in the shop's own theme (the stored storefront theme, dark by default — which is
  // what a first-time visitor from WhatsApp gets) and claims `only light|dark` to match: that is
  // what stops Chrome-on-Android, Samsung Internet and the Facebook / Instagram in-app browsers
  // re-colouring the page — see src/theme/documentColorScheme.js. Released on unmount so the ERP
  // theme takes over again. Inside the shell the storefront owns the claim, so stay out of it.
  const [theme] = useState(readStorefrontTheme);
  useEffect(() => {
    if (typeof document !== "undefined" && document.body?.classList?.contains("storefront-shell")) return undefined;
    setStorefrontColorScheme(theme, theme === "dark" ? "#070707" : "#f3f3f1");
    return () => releaseStorefrontColorScheme();
  }, [theme]);

  useEffect(() => {
    if (normalizeLanguage(i18n.language) === "ar") return;
    i18n.changeLanguage("ar").catch(() => {});
  }, []);
  const resolvedCode = useMemo(() => {
    try {
      return decodeURIComponent(text(code));
    } catch {
      return text(code);
    }
  }, [code]);

  const [linkState, setLinkState] = useState("loading"); // loading | ready | submitted | expired | error
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [phoneOverride, setPhoneOverride] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);

  // One selected Bosta location = the whole hierarchy at once.
  const [location, setLocation] = useState(null); // { city_id, zone_id, district_id, label }
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // The seller-side composer uses the same three Bosta lists; the customer sees
  // the identical hierarchy by default, with the type-ahead as the alternative.
  const [manualMode, setManualMode] = useState(true);
  const [manual, setManual] = useState({ cities: [], zones: [], districts: [], cityId: "", zoneId: "", districtId: "" });

  const [streetAddress, setStreetAddress] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [floorNumber, setFloorNumber] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [landmark, setLandmark] = useState("");
  const [fieldError, setFieldError] = useState("");
  const searchBoxRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (!resolvedCode) {
      setLinkState("error");
      setError(sfText("storefront.addressLink.invalidLink"));
      return undefined;
    }
    api.get(`/public/address-request/${encodeURIComponent(resolvedCode)}`)
      .then((payload) => {
        if (!active) return;
        const loaded = payload?.request || payload?.data?.request || null;
        setRequest(loaded);
        setCustomerName(text(loaded?.customer_name));
        setLinkState(loaded?.status === "submitted" ? "submitted" : "ready");
      })
      .catch((err) => {
        if (!active) return;
        const status = Number(err?.status || err?.response?.status || 0);
        setError(err?.responseBody?.message || err?.message || sfText("storefront.addressLink.loadFailed"));
        setLinkState(status === 410 ? "expired" : "error");
      });
    return () => {
      active = false;
    };
  }, [resolvedCode]);

  // Search-as-you-type over the full city/zone/district tree. Debounced; only
  // dropoff-capable districts are offered, because Bosta will refuse the rest.
  useEffect(() => {
    const term = text(searchTerm);
    if (location || manualMode || term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.get(`/shipping/locations/search?provider=bosta&q=${encodeURIComponent(term)}&limit=60`)
        .then((payload) => {
          if (!active) return;
          const rows = list(payload?.locations).filter(
            (row) => row.city_dropoff_available !== false && row.district_dropoff_available !== false
          );
          setSearchResults(rows.slice(0, 30));
        })
        .catch(() => active && setSearchResults([]))
        .finally(() => active && setSearching(false));
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [location, manualMode, searchTerm]);

  // Manual fallback: the classic three cascading lists.
  useEffect(() => {
    if (!manualMode) return undefined;
    let active = true;
    api.get("/shipping/cities?provider=bosta&dropoff=1")
      .then((payload) => active && setManual((current) => ({ ...current, cities: list(payload?.cities) })))
      .catch(() => active && setManual((current) => ({ ...current, cities: [] })));
    return () => {
      active = false;
    };
  }, [manualMode]);

  useEffect(() => {
    if (!manualMode || !manual.cityId) return undefined;
    let active = true;
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(manual.cityId)}`)
      .then((payload) => active && setManual((current) => ({ ...current, zones: list(payload?.zones) })))
      .catch(() => active && setManual((current) => ({ ...current, zones: [] })));
    return () => {
      active = false;
    };
  }, [manual.cityId, manualMode]);

  useEffect(() => {
    if (!manualMode || !manual.zoneId) return undefined;
    let active = true;
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(manual.zoneId)}`)
      .then((payload) => active && setManual((current) => ({ ...current, districts: list(payload?.districts) })))
      .catch(() => active && setManual((current) => ({ ...current, districts: [] })));
    return () => {
      active = false;
    };
  }, [manual.zoneId, manualMode]);

  const manualComplete = manualMode && manual.cityId && manual.zoneId && manual.districtId;
  const selectedIds = location
    ? { city: location.city_id, zone: location.zone_id, district: location.district_id }
    : manualComplete
      ? { city: manual.cityId, zone: manual.zoneId, district: manual.districtId }
      : null;

  const canSubmit = Boolean(selectedIds && text(streetAddress) && text(buildingNumber) && text(customerName)) && !submitting;

  const submit = async () => {
    if (!canSubmit) {
      setFieldError(sfText("storefront.addressLink.fieldsRequired"));
      return;
    }
    setFieldError("");
    setSubmitting(true);
    try {
      const payload = await api.post(`/public/address-request/${encodeURIComponent(resolvedCode)}/submit`, {
        customer_name: text(customerName),
        customer_phone: text(phoneOverride),
        shipping_city_id: selectedIds.city,
        shipping_zone_id: selectedIds.zone,
        shipping_district_id: selectedIds.district,
        street_address: text(streetAddress),
        building_number: text(buildingNumber),
        floor_number: text(floorNumber),
        apartment_number: text(apartmentNumber),
        landmark: text(landmark),
      });
      setRequest((current) => ({ ...(current || {}), ...(payload?.request || {}), status: "submitted", address: payload?.address || payload?.request?.address || {
        governorate: "",
        city_area: location?.label || "",
        street_address: text(streetAddress),
        building_number: text(buildingNumber),
      } }));
      setLinkState("submitted");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      const message = err?.responseBody?.message || err?.message || sfText("storefront.addressLink.submitFailed");
      if (status === 410) {
        setLinkState("expired");
        setError(message);
      } else {
        setFieldError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submittedAddress = request?.address || {};

  return (
    <main className="sf-address-link-page sfx-scope sfl" data-theme={theme}>
      <div className="sfx-wrap sfx-wrap--sm sfx-section sfl-page">
        <header className="sfl-head">
          <span className="sfl-icon" aria-hidden="true">
            <MapPin className="h-6 w-6" />
          </span>
          <div className="sfx-page-head__text">
            <p className="sfx-kicker">{sfText("storefront.addressLink.eyebrow")}</p>
            <h1 className="sfx-title">
              {linkState === "submitted" ? sfText("storefront.addressLink.receivedHeading") : sfText("storefront.addressLink.greeting", undefined, { name: text(customerName).split(" ")[0] || sfText("storefront.addressLink.greetingFallbackName") })}
            </h1>
            <p className="sfx-subtitle">
              {linkState === "submitted"
                ? sfText("storefront.addressLink.receivedSubtitle")
                : sfText("storefront.addressLink.introSubtitle")}
            </p>
          </div>
        </header>

        {linkState === "loading" ? (
          <div className="sfx-surface sfl-loading" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {sfText("storefront.addressLink.loading")}
          </div>
        ) : null}

        {linkState === "expired" || linkState === "error" ? (
          <div className="sfx-notice sfx-notice--accent" role="alert">
            <MessageCircleWarning aria-hidden="true" />
            <div className="sfl-notice-body">
              <h2 className="sfx-h3">{linkState === "expired" ? sfText("storefront.addressLink.linkExpired") : sfText("storefront.addressLink.linkUnavailable")}</h2>
              <p className="sfl-text">
                {error || sfText("storefront.addressLink.askForNewLink")}
              </p>
            </div>
          </div>
        ) : null}

        {linkState === "submitted" ? (
          <div className="sfx-stack">
            <div className="sfx-notice sfx-notice--success" role="status">
              <CheckCircle2 aria-hidden="true" />
              <div className="sfl-notice-body">
                <h2 className="sfx-h3">{sfText("storefront.addressLink.submittedTitle")}</h2>
                <p className="sfl-text">{sfText("storefront.addressLink.submittedText")}</p>
              </div>
            </div>
            {[submittedAddress.governorate, submittedAddress.city_area, submittedAddress.street_address].some(Boolean) ? (
              <section className="sfx-surface">
                <h2 className="sfx-h3 sfl-block-title">
                  <MapPin aria-hidden="true" />
                  {sfText("storefront.addressLink.submittedAddressLabel")}
                </h2>
                <p className="sfl-text sfl-text--strong">
                  {[
                    submittedAddress.governorate,
                    submittedAddress.city_area,
                    submittedAddress.street_address,
                    submittedAddress.building_number ? sfText("storefront.addressLink.buildingPrefix", undefined, { value: submittedAddress.building_number }) : "",
                    submittedAddress.floor_number ? sfText("storefront.addressLink.floorPrefix", undefined, { value: submittedAddress.floor_number }) : "",
                    submittedAddress.apartment_number ? sfText("storefront.addressLink.apartmentPrefix", undefined, { value: submittedAddress.apartment_number }) : "",
                  ]
                    .filter(Boolean)
                    .join(" — ")}
                </p>
              </section>
            ) : null}
          </div>
        ) : null}

        {linkState === "ready" ? (
          <div className="sfx-stack">
            {/* Who */}
            <section className="sfx-surface">
              <h2 className="sfx-h3 sfl-block-title">{sfText("storefront.addressLink.yourDetails")}</h2>
              <div className="sfl-fields">
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder={sfText("storefront.addressLink.fullNamePlaceholder")}
                  aria-label={sfText("storefront.addressLink.fullNamePlaceholder")}
                  className={inputClass}
                />
                {request?.has_phone && !editingPhone ? (
                  <div className="sfl-static-field">
                    <span dir="ltr" className="sfl-static-field__value">{request.customer_phone_masked}</span>
                    <button
                      type="button"
                      onClick={() => setEditingPhone(true)}
                      className="sfx-btn sfx-btn--ghost sfx-btn--sm"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {sfText("storefront.addressLink.changePhone")}
                    </button>
                  </div>
                ) : (
                  <input
                    value={phoneOverride}
                    onChange={(event) => setPhoneOverride(event.target.value)}
                    placeholder={request?.has_phone ? sfText("storefront.addressLink.newPhonePlaceholder") : sfText("storefront.addressLink.phonePlaceholder")}
                    aria-label={request?.has_phone ? sfText("storefront.addressLink.newPhonePlaceholder") : sfText("storefront.addressLink.phonePlaceholder")}
                    inputMode="tel"
                    dir="ltr"
                    className={inputClass}
                  />
                )}
              </div>
            </section>

            {/* Where */}
            <section className="sfx-surface">
              <h2 className="sfx-h3 sfl-block-title" style={{ marginBottom: "var(--m1h-s1)" }}>
                <MapPin aria-hidden="true" />
                {sfText("storefront.addressLink.yourArea")}
              </h2>
              <p className="sfl-text sfl-text--sm" style={{ marginBottom: "var(--m1h-s3)" }}>
                {manualMode ? sfText("storefront.addressLink.manualHint") : sfText("storefront.addressLink.searchHint")}
              </p>

              {location ? (
                <div className="sfl-picked">
                  <span className="sfl-picked__label">{location.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocation(null);
                      setSearchTerm("");
                      window.setTimeout(() => searchBoxRef.current?.focus(), 50);
                    }}
                    aria-label={sfText("storefront.addressLink.changeArea")}
                    className="sfx-icon-btn"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : manualMode ? (
                <div className="sfl-fields">
                  <label className="sfx-select sfx-select--lg sfx-select--block sfl-select">
                    <select
                      value={manual.cityId}
                      onChange={(event) => setManual((current) => ({ ...current, cityId: event.target.value, zoneId: "", districtId: "", zones: [], districts: [] }))}
                      aria-label={sfText("storefront.addressLink.cityPlaceholder")}
                      className="sfx-select__control"
                    >
                      <option value="">{sfText("storefront.addressLink.cityPlaceholder")}</option>
                      {manual.cities.map((item) => (
                        <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>
                      ))}
                    </select>
                    <ChevronDown className="sfx-select__icon" aria-hidden="true" />
                  </label>
                  <label className="sfx-select sfx-select--lg sfx-select--block sfl-select">
                    <select
                      value={manual.zoneId}
                      onChange={(event) => setManual((current) => ({ ...current, zoneId: event.target.value, districtId: "", districts: [] }))}
                      disabled={!manual.cityId}
                      aria-label={sfText("storefront.addressLink.areaPlaceholder")}
                      className="sfx-select__control"
                    >
                      <option value="">{sfText("storefront.addressLink.areaPlaceholder")}</option>
                      {manual.zones.map((item) => (
                        <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>
                      ))}
                    </select>
                    <ChevronDown className="sfx-select__icon" aria-hidden="true" />
                  </label>
                  <label className="sfx-select sfx-select--lg sfx-select--block sfl-select">
                    <select
                      value={manual.districtId}
                      onChange={(event) => setManual((current) => ({ ...current, districtId: event.target.value }))}
                      disabled={!manual.zoneId}
                      aria-label={sfText("storefront.addressLink.districtPlaceholder")}
                      className="sfx-select__control"
                    >
                      <option value="">{sfText("storefront.addressLink.districtPlaceholder")}</option>
                      {manual.districts.map((item) => (
                        <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>
                      ))}
                    </select>
                    <ChevronDown className="sfx-select__icon" aria-hidden="true" />
                  </label>
                  <button type="button" onClick={() => setManualMode(false)} className="sfx-link-btn sfl-toggle">
                    <Search aria-hidden="true" />
                    {sfText("storefront.addressLink.quickSearch")}
                  </button>
                </div>
              ) : (
                <div className="sfl-fields">
                  <div>
                    <div className="sfl-search">
                      <Search className="sfl-search__icon" aria-hidden="true" />
                      <input
                        ref={searchBoxRef}
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder={sfText("storefront.addressLink.searchPlaceholder")}
                        aria-label={sfText("storefront.addressLink.searchPlaceholder")}
                        className="sfx-input sfx-input--pill"
                      />
                    </div>
                    {searching ? (
                      <div className="sfl-loading sfl-text--sm" role="status" style={{ marginTop: "var(--m1h-s2)", paddingInline: "var(--m1h-s1)" }}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        {sfText("storefront.addressLink.searching")}
                      </div>
                    ) : null}
                    {!searching && searchResults.length ? (
                      <div className="sfl-results">
                        {searchResults.map((row) => (
                          <button
                            key={`${row.city_id}-${row.zone_id}-${row.district_id}`}
                            type="button"
                            onClick={() => {
                              setLocation({
                                city_id: text(row.city_id),
                                zone_id: text(row.zone_id),
                                district_id: text(row.district_id),
                                label: searchRowLabel(row),
                              });
                              setSearchResults([]);
                            }}
                            className="sfl-results__row"
                          >
                            {searchRowLabel(row)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {!searching && text(searchTerm).length >= 2 && !searchResults.length ? (
                      <p className="sfl-text sfl-text--sm sfl-text--muted" style={{ marginTop: "var(--m1h-s2)", paddingInline: "var(--m1h-s1)" }}>{sfText("storefront.addressLink.noResults")}</p>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => setManualMode(true)} className="sfx-link-btn sfl-toggle">
                    {sfText("storefront.addressLink.manualPick")}
                  </button>
                </div>
              )}
            </section>

            {/* Street-level detail */}
            <section className="sfx-surface">
              <h2 className="sfx-h3 sfl-block-title">
                <Building2 aria-hidden="true" />
                {sfText("storefront.addressLink.detailedAddress")}
              </h2>
              <div className="sfl-fields">
                <textarea
                  value={streetAddress}
                  onChange={(event) => setStreetAddress(event.target.value)}
                  placeholder={sfText("storefront.addressLink.streetPlaceholder")}
                  aria-label={sfText("storefront.addressLink.streetPlaceholder")}
                  rows={3}
                  className={inputClass}
                />
                <input
                  value={buildingNumber}
                  onChange={(event) => setBuildingNumber(event.target.value)}
                  placeholder={sfText("storefront.addressLink.buildingPlaceholder")}
                  aria-label={sfText("storefront.addressLink.buildingPlaceholder")}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setExtrasOpen((current) => !current)}
                  aria-expanded={extrasOpen}
                  className={`sfx-link-btn sfl-toggle${extrasOpen ? " is-open" : ""}`}
                >
                  <ChevronDown aria-hidden="true" />
                  {sfText("storefront.addressLink.extraDetails")}
                </button>
                {extrasOpen ? (
                  <div className="sfl-fields sfl-fields--pair">
                    <input value={floorNumber} onChange={(event) => setFloorNumber(event.target.value)} placeholder={sfText("storefront.addressLink.floorPlaceholder")} aria-label={sfText("storefront.addressLink.floorPlaceholder")} className={inputClass} />
                    <input value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} placeholder={sfText("storefront.addressLink.apartmentPlaceholder")} aria-label={sfText("storefront.addressLink.apartmentPlaceholder")} className={inputClass} />
                    <input value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder={sfText("storefront.addressLink.landmarkPlaceholder")} aria-label={sfText("storefront.addressLink.landmarkPlaceholder")} className={`${inputClass} sfl-span`} />
                  </div>
                ) : null}
              </div>
            </section>

            {fieldError ? (
              <div className="sfx-notice sfx-notice--danger" role="alert">
                <MessageCircleWarning aria-hidden="true" />
                <p className="sfl-text sfl-text--strong">{fieldError}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
              {sfText("storefront.addressLink.submit")}
            </button>
            <p className="sfl-footnote">
              {sfText("storefront.addressLink.privacyNote")}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default CustomerAddressPage;
