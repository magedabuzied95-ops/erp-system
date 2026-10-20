import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Ban, Check, LoaderCircle, MapPin, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, Modal } from "../../../../../shared/ui";
import { WzSelect } from "../parts";
import { PIN_RADII } from "../wizardModel";
import { wizardApi } from "../wizardApi";
import TokenSearch from "./TokenSearch";

const CAIRO = [27.5, 31.5];

const sameLocation = (a, b) => a.type === b.type && String(a.key) === String(b.key);

// "المواقع": Leaflet/OSM map (pins = custom locations with a radius), search with Meta's
// adgeolocation suggestions, include/exclude chips, location type and bulk add.
export default function LocationPicker({ spec, update, account, catalog, error }) {
  const { t, i18n } = useTranslation();
  const [showMap, setShowMap] = useState(true);
  const [pinMode, setPinMode] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMissed, setBulkMissed] = useState([]);
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pinModeRef = useRef(pinMode);
  const locationsRef = useRef(spec.locations);
  const accountId = account?.id;

  pinModeRef.current = pinMode;
  locationsRef.current = spec.locations;

  const addLocation = useCallback(
    (loc) => {
      const current = locationsRef.current || [];
      if (current.some((row) => sameLocation(row, loc))) return;
      update({ locations: [...current, { exclude: false, ...loc }] });
    },
    [update],
  );

  // Map lifecycle.
  useEffect(() => {
    if (!showMap || !mapNode.current) return undefined;
    const map = L.map(mapNode.current, { center: CAIRO, zoom: 4, zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on("click", async (event) => {
      if (!pinModeRef.current) return;
      const { lat, lng } = event.latlng;
      setPinBusy(true);
      let name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      let country = "";
      try {
        const res = await wizardApi.geocode({ lat: lat.toFixed(6), lng: lng.toFixed(6), lang: i18n.language });
        name = res?.name || name;
        country = res?.country_code || "";
      } catch {
        // keep the coordinates as the label
      } finally {
        setPinBusy(false);
      }
      addLocation({ key: `${lat.toFixed(5)},${lng.toFixed(5)}`, name, type: "custom", latitude: lat, longitude: lng, radius: 10, country_code: country });
    });
    const resize = () => map.invalidateSize();
    const timer = setTimeout(resize, 50);
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [showMap, addLocation, i18n.language]);

  useEffect(() => {
    if (mapNode.current) mapNode.current.style.cursor = pinMode ? "crosshair" : "";
  }, [pinMode, showMap]);

  // Draw custom pins.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const pins = (spec.locations || []).filter((loc) => loc.type === "custom" && Number.isFinite(Number(loc.latitude)));
    for (const pin of pins) {
      const color = pin.exclude ? "#dc2626" : "#1677ff";
      const center = [Number(pin.latitude), Number(pin.longitude)];
      L.circle(center, { radius: (Number(pin.radius) || 10) * 1000, color, weight: 1.5, fillOpacity: 0.15 }).addTo(layer);
      L.circleMarker(center, { radius: 5, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(pin.name).addTo(layer);
    }
  }, [spec.locations, showMap]);

  const searchLocations = useCallback(
    async (q) => {
      const res = await wizardApi.searchLocations({ account_id: accountId, q, locale: i18n.language });
      return res?.results || [];
    },
    [accountId, i18n.language],
  );

  const patchLocation = (loc, patch) => {
    update({ locations: spec.locations.map((row) => (sameLocation(row, loc) ? { ...row, ...patch } : row)) });
  };
  const removeLocation = (loc) => update({ locations: spec.locations.filter((row) => !sameLocation(row, loc)) });

  const runBulk = async () => {
    const lines = bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50);
    if (!lines.length) return;
    setBulkBusy(true);
    const missed = [];
    const found = [];
    for (const line of lines) {
      try {
        const rows = await searchLocations(line);
        if (rows[0]) found.push(rows[0]);
        else missed.push(line);
      } catch {
        missed.push(line);
      }
    }
    const current = locationsRef.current || [];
    const next = [...current];
    for (const row of found) if (!next.some((item) => sameLocation(item, row))) next.push({ exclude: false, ...row });
    update({ locations: next });
    setBulkBusy(false);
    setBulkMissed(missed);
    if (!missed.length) {
      setBulkOpen(false);
      setBulkText("");
    }
  };

  const typeOptions = (catalog?.location_types || [{ code: "home_recent" }, { code: "home" }, { code: "recent" }]).map((row) => ({
    value: row.code,
    label: t(`metaAdsWizard.audience.locationTypes.${row.code}`),
  }));
  const radiusOptions = PIN_RADII.map((km) => ({ value: String(km), label: t("metaAdsWizard.audience.radiusKm", { km }) }));

  return (
    <div className="wz-field" data-wz-field="locations">
      <div className="wz-label">{t("metaAdsWizard.audience.locations")}</div>
      {showMap ? (
        <div className="wz-map">
          <div ref={mapNode} className="wz-map__canvas" />
          <button type="button" className={`wz-map__pin ${pinMode ? "is-on" : ""}`.trim()} onClick={() => setPinMode((value) => !value)} aria-pressed={pinMode}>
            {pinBusy ? <LoaderCircle size={15} className="m1-spin" /> : <MapPin size={15} />}
            <span>{pinMode ? t("metaAdsWizard.audience.pinModeOn") : t("metaAdsWizard.audience.pinMode")}</span>
          </button>
        </div>
      ) : null}
      <div className="wz-row-end">
        <button type="button" className="wz-link" onClick={() => { setShowMap((value) => !value); setPinMode(false); }}>
          {showMap ? t("metaAdsWizard.audience.hideMap") : t("metaAdsWizard.audience.showMap")}
        </button>
      </div>

      <TokenSearch
        placeholder={t("metaAdsWizard.audience.locationSearch")}
        search={searchLocations}
        rowKey={(row) => `${row.type}:${row.key}`}
        onPick={addLocation}
        renderRow={(row) => (
          <span className="wz-search__main">
            <span>{row.name}</span>
            <span className="wz-search__meta">
              {[t(`metaAdsWizard.audience.locationKinds.${row.type}`, { defaultValue: row.type }), row.region, row.country_name || row.country_code].filter(Boolean).join(" · ")}
            </span>
          </span>
        )}
      />

      {spec.locations.length ? (
        <div className="wz-chips wz-chips--locations">
          {spec.locations.map((loc) => (
            <span key={`${loc.type}:${loc.key}`} className={`wz-chip ${loc.exclude ? "is-excluded" : ""}`.trim()}>
              {loc.exclude ? <Ban size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
              <span className="wz-chip__label">
                {loc.name}
                <span className="wz-chip__meta">{t(`metaAdsWizard.audience.locationKinds.${loc.type}`, { defaultValue: loc.type })}</span>
              </span>
              {loc.type === "custom" ? (
                <WzSelect
                  className="wz-chip__radius"
                  value={String(loc.radius || 10)}
                  onChange={(value) => patchLocation(loc, { radius: Number(value) })}
                  options={radiusOptions}
                  ariaLabel={t("metaAdsWizard.audience.radius")}
                />
              ) : null}
              <button type="button" className="wz-chip__action" onClick={() => patchLocation(loc, { exclude: !loc.exclude })}>
                {loc.exclude ? t("metaAdsWizard.audience.include") : t("metaAdsWizard.audience.exclude")}
              </button>
              <button type="button" className="wz-chip__x" aria-label={t("metaAdsWizard.common.remove")} onClick={() => removeLocation(loc)}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className="wz-error">{error}</div> : null}

      <div className="wz-location-row">
        <WzSelect
          value={spec.location_type}
          onChange={(value) => update({ location_type: value })}
          options={typeOptions}
          ariaLabel={t("metaAdsWizard.audience.locationType")}
        />
        <button type="button" className="wz-link" onClick={() => { setBulkMissed([]); setBulkOpen(true); }}>
          <Plus size={15} aria-hidden="true" />
          <span>{t("metaAdsWizard.audience.bulkAdd")}</span>
        </button>
      </div>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t("metaAdsWizard.audience.bulkTitle")}
        description={t("metaAdsWizard.audience.bulkHint")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>{t("metaAds.common.cancel")}</Button>
            <Button variant="primary" loading={bulkBusy} onClick={runBulk}>{t("metaAdsWizard.audience.bulkAction")}</Button>
          </>
        }
      >
        <textarea
          className="wz-textarea"
          rows={8}
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          placeholder={t("metaAdsWizard.audience.bulkPlaceholder")}
        />
        {bulkMissed.length ? <div className="wz-error">{t("metaAdsWizard.audience.bulkMissed", { list: bulkMissed.join("، ") })}</div> : null}
      </Modal>
    </div>
  );
}
