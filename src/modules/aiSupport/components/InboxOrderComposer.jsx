/*
 * The AI Inbox order composer — ONE implementation for both surfaces.
 *
 * It used to live inside AiInbox.jsx while /inbox shipped a cut-down twin
 * (single product, no cart, no discount, no payment method, no shipping quote,
 * no saved addresses). Two composers meant an order written from the phone was
 * a different order from one written at the desk, so this is the shared one and
 * PwaOrderComposer is gone.
 *
 * Layout is class-driven (`ai-order__*`, see AiInboxOrderComposer.m1.css) and
 * already fluid, so the same markup serves the desktop dialog and the phone.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  CreditCard,
  Link2,
  Loader2,
  MapPin,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Truck,
  User,
  XCircle,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { formatCurrency } from "../../../shared/lib/currency";
import { aiInboxConversationEndpoint, asArray, clean, firstUsefulCustomerName } from "../lib/conversationHelpers";
import "./AiInboxOrderComposer.m1.css";

const money = (value) => formatCurrency(value);
// Same one-liner the desktop page uses: a filter descriptor carries either a
// translation key or a literal label.
const filterLabel = (t, item = {}) => (item.labelKey ? t(item.labelKey) : item.label || "");

const shippingLocationId = (item = {}) => clean(item.id || item.provider_city_id || item.provider_zone_id || item.provider_district_id);
const shippingLocationLabel = (item = {}) => clean(item.name_ar || item.name_en || item.name || item.city_name_ar || item.zone_name_ar || item.district_name_ar);
const AI_INBOX_SHIPPING_PROVIDERS = [
  { id: "bosta", label: "Bosta" },
  { id: "mylerz", label: "Mylerz" },
  { id: "shipblu", label: "ShipBlu" },
  { id: "in_store_delivery", labelKey: "aiSupport.inbox.panel.inStoreDelivery" },
];

// Payment methods offered on an AI Inbox invoice. Cash on delivery is the default
// because that is how the chat channels sell; the rest mirror the POS row for when
// the customer already paid before the order is written.
const AI_INBOX_PAYMENT_METHODS = [
  { id: "cash_on_delivery", labelKey: "aiSupport.inbox.order.paymentCod" },
  { id: "cash", labelKey: "aiSupport.inbox.order.paymentCash" },
  { id: "visa", labelKey: "aiSupport.inbox.order.paymentVisa" },
  { id: "instapay", labelKey: "aiSupport.inbox.order.paymentInstapay" },
  { id: "vodafone_cash", labelKey: "aiSupport.inbox.order.paymentVodafoneCash" },
];

// A cart row is identified by the model, and a model without a variant id is still
// pinned by its colour+size — which is what the server resolves it from.
const composerLineKey = (line = {}) =>
  `${line.product_id || ""}:${line.variant_id || ""}:${clean(line.color || "").toLowerCase()}:${clean(line.size || "").toLowerCase()}`;

// The picker returns product cards; the cart needs one row per chosen model.
const composerLineFromCard = (card = {}) => ({
  product_id: card.product_id || card.id || null,
  variant_id: card.variant_id || null,
  product_name: clean(card.product_name || card.name || ""),
  color: clean(card.color || ""),
  size: clean(card.size || ""),
  image_url: card.image_url || card.image || card.thumbnail_url || "",
  price: Number(card.display_price ?? card.price ?? 0) || 0,
  quantity: 1,
});

function InboxOrderComposer({ open, conversation = {}, products = [], busy = false, headers = {}, onClose, onSubmit, portalTarget = null, picks = null, onRequestPick, onSendMessage }) {
  const { t } = useTranslation();
  const profile = conversation?.customer_profile || {};
  const [lines, setLines] = useState([]);
  const consumedPickBatchRef = useRef("");
  const [paymentMethod, setPaymentMethod] = useState("cash_on_delivery");
  const [discountType, setDiscountType] = useState("amount");
  const [discountValue, setDiscountValue] = useState(0);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingProvider, setShippingProvider] = useState("bosta");
  const [shippingCityId, setShippingCityId] = useState("");
  const [shippingZoneId, setShippingZoneId] = useState("");
  const [shippingDistrictId, setShippingDistrictId] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [floorNumber, setFloorNumber] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [landmark, setLandmark] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [cityArea, setCityArea] = useState("");
  const [shippingLocations, setShippingLocations] = useState({ cities: [], zones: [], districts: [], loading: false });
  const [notes, setNotes] = useState("");
  // Quoted = what the zone price list says for this address. Override = what the
  // seller typed instead. Only the override travels in the payload; leaving it
  // null keeps the server as the single authority on the price.
  const [quotedShipping, setQuotedShipping] = useState({ cost: null, source: "", freeShipping: false, loading: false });
  const [shippingOverride, setShippingOverride] = useState(null);
  // The customer-facing address link: created here, delivered through the
  // normal chat send path, and polled until the customer submits.
  const [addressRequest, setAddressRequest] = useState(null);
  const [addressLinkBusy, setAddressLinkBusy] = useState(false);
  const [addressLinkCopied, setAddressLinkCopied] = useState(false);
  const appliedAddressRequestRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setLines([]);
    setPaymentMethod("cash_on_delivery");
    setDiscountType("amount");
    setDiscountValue(0);
    setCustomerName(firstUsefulCustomerName(conversation?.customer_name, profile.name, profile.display_name));
    setCustomerPhone(clean(profile.phone || conversation?.customer_phone || conversation?.channel_metadata?.resolved_phone || ""));
    setShippingProvider(clean(profile.shipping_provider || profile.shipping_provider_id || conversation?.shipping_provider || "bosta").toLowerCase());
    setShippingCityId(clean(profile.shipping_city_id || conversation?.shipping_city_id || ""));
    setShippingZoneId(clean(profile.shipping_zone_id || conversation?.shipping_zone_id || ""));
    setShippingDistrictId(clean(profile.shipping_district_id || profile.district_id || conversation?.shipping_district_id || ""));
    setStreetAddress(clean(profile.street_address || profile.address || conversation?.customer_address || ""));
    setBuildingNumber(clean(profile.building_number || conversation?.building_number || ""));
    setFloorNumber(clean(profile.floor_number || conversation?.floor_number || ""));
    setApartmentNumber(clean(profile.apartment_number || conversation?.apartment_number || ""));
    setLandmark(clean(profile.landmark || conversation?.landmark || ""));
    setGovernorate(clean(profile.governorate || conversation?.governorate || ""));
    setCityArea(clean(profile.city_area || profile.area || conversation?.city_area || ""));
    setNotes("");
    setQuotedShipping({ cost: null, source: "", freeShipping: false, loading: false });
    setShippingOverride(null);
    setAddressRequest(null);
    setAddressLinkBusy(false);
    appliedAddressRequestRef.current = "";
    // Deliberately NOT keyed on `products`: the parent passes it as an inline
    // `cond ? list : []`, so it is a new array on every parent render. Adding a
    // model re-renders the parent, which used to re-run this effect and wipe the
    // cart the moment it was filled. Reset belongs to open/conversation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.session_id, open]);

  // Models chosen in the popup arrive here as a batch. A batch is appended once —
  // tracked by its id rather than by clearing the parent's state, because clearing
  // shared state from inside the effect raced the append. A card without a
  // variant_id is still a real pick: the server resolves the model from
  // product + colour + size, so nothing is dropped here.
  useEffect(() => {
    const batch = picks?.batch || "";
    const cards = asArray(picks?.cards);
    if (!open || !batch || !cards.length || consumedPickBatchRef.current === batch) return;
    consumedPickBatchRef.current = batch;
    setLines((current) => {
      const next = [...current];
      cards.forEach((card) => {
        const line = composerLineFromCard(card);
        if (!line.product_id) return;
        const existing = next.find((item) => composerLineKey(item) === composerLineKey(line));
        if (existing) existing.quantity += 1;
        else next.push(line);
      });
      return next;
    });
  }, [open, picks]);

  // "My addresses": everything this phone has ordered to before, so a returning
  // customer's address is one tap instead of eight fields.
  useEffect(() => {
    if (!open || !clean(customerPhone)) {
      setSavedAddresses([]);
      return undefined;
    }
    let active = true;
    api.get(`/ai-inbox/customer-addresses?phone=${encodeURIComponent(clean(customerPhone))}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setSavedAddresses(asArray(data?.addresses)))
      .catch(() => active && setSavedAddresses([]));
    return () => { active = false; };
  }, [customerPhone, headers, open]);

  // Everything the customer typed on the public page lands in the form in one
  // shot. City first: the id chain re-triggers the zone/district loads above.
  const applyAddressRequest = (request = null) => {
    const address = request?.address || {};
    if (!clean(address.shipping_city_id)) return;
    setShippingProvider("bosta");
    setShippingCityId(clean(address.shipping_city_id));
    setShippingZoneId(clean(address.shipping_zone_id));
    setShippingDistrictId(clean(address.shipping_district_id));
    setStreetAddress(clean(address.street_address));
    setBuildingNumber(clean(address.building_number));
    setFloorNumber(clean(address.floor_number));
    setApartmentNumber(clean(address.apartment_number));
    setLandmark(clean(address.landmark));
    setGovernorate(clean(address.governorate));
    setCityArea(clean(address.city_area));
    if (clean(request?.customer_name)) setCustomerName(clean(request.customer_name));
    if (clean(request?.customer_phone)) setCustomerPhone(clean(request.customer_phone));
  };

  // Load the latest link once on open, then keep polling while one is pending.
  // Auto-fill happens only on the pending→submitted transition observed here —
  // an address that was already submitted before the composer opened is offered
  // as a button instead, so it never silently overwrites what the seller typed.
  useEffect(() => {
    if (!open || !conversation?.session_id) return undefined;
    let active = true;
    let timer = null;
    const load = async (isFirst = false) => {
      try {
        const payload = await api.get(aiInboxConversationEndpoint(conversation.session_id, "/address-request"), { headers, suppressErrorStatuses: [404, 500] });
        if (!active) return;
        const request = payload?.request || null;
        setAddressRequest((previous) => {
          if (
            !isFirst &&
            request?.status === "submitted" &&
            previous?.status === "pending" &&
            appliedAddressRequestRef.current !== String(request.id)
          ) {
            appliedAddressRequestRef.current = String(request.id);
            applyAddressRequest(request);
          }
          return request;
        });
        if (request?.status === "pending") timer = window.setTimeout(() => load(false), 7000);
      } catch {
        /* polling is best-effort */
      }
    };
    load(true);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.session_id, headers, open, addressLinkBusy]);

  const sendAddressLink = async () => {
    if (addressLinkBusy || !conversation?.session_id) return;
    setAddressLinkBusy(true);
    try {
      const payload = await api.post(
        aiInboxConversationEndpoint(conversation.session_id, "/address-request"),
        { customer_name: clean(customerName), customer_phone: clean(customerPhone) },
        { headers, perfComponent: "AiInbox.addressRequest" }
      );
      const request = payload?.request || null;
      setAddressRequest(request);
      if (!request?.url) return;
      // A reused pending link means the customer ALREADY has this exact message — re-sending it only spams
      // them (a real conversation got it 10+ times). Copy the link instead; the server independently refuses
      // duplicate /addr/ sends, so even a pasted resend within the cooldown never reaches the customer twice.
      if (request.reused) {
        try { await navigator.clipboard?.writeText(request.url); } catch { /* clipboard is best-effort */ }
        setAddressLinkCopied(true);
        window.setTimeout(() => setAddressLinkCopied(false), 3000);
        return;
      }
      if (typeof onSendMessage === "function") {
        const firstName = clean(customerName).split(" ")[0];
        await onSendMessage(
          `أهلاً ${firstName || "بيك"} 🌟\nعشان نجهز أوردرك بسرعة، اكتب عنوان التوصيل من الرابط ده — دقيقة واحدة بس 👇\n${request.url}`,
          { flow: "address_link" }
        );
      }
    } catch {
      /* the status row keeps its previous state; the seller can retry */
    } finally {
      setAddressLinkBusy(false);
    }
  };

  useEffect(() => {
    if (!open || shippingProvider !== "bosta") return;
    let active = true;
    setShippingLocations((current) => ({ ...current, loading: true }));
    api.get("/shipping/cities?provider=bosta&dropoff=1", { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setShippingLocations((current) => ({ ...current, cities: asArray(data?.cities) })))
      .catch(() => active && setShippingLocations((current) => ({ ...current, cities: [] })))
      .finally(() => active && setShippingLocations((current) => ({ ...current, loading: false })));
    return () => { active = false; };
  }, [headers, open, shippingProvider]);

  useEffect(() => {
    if (!open || shippingProvider !== "bosta" || !shippingCityId) {
      setShippingLocations((current) => ({ ...current, zones: [], districts: [] }));
      return;
    }
    let active = true;
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(shippingCityId)}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setShippingLocations((current) => ({ ...current, zones: asArray(data?.zones), districts: [] })))
      .catch(() => active && setShippingLocations((current) => ({ ...current, zones: [], districts: [] })));
    return () => { active = false; };
  }, [headers, open, shippingCityId, shippingProvider]);

  useEffect(() => {
    if (!open || shippingProvider !== "bosta" || !shippingZoneId) {
      setShippingLocations((current) => ({ ...current, districts: [] }));
      return;
    }
    let active = true;
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(shippingZoneId)}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setShippingLocations((current) => ({ ...current, districts: asArray(data?.districts) })))
      .catch(() => active && setShippingLocations((current) => ({ ...current, districts: [] })));
    return () => { active = false; };
  }, [headers, open, shippingProvider, shippingZoneId]);

  // Hoisted above the `open` guard so the shipping quote effect can price
  // against the same net subtotal the server will.
  const cartTotal = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.price || 0) * Math.max(1, Number(line.quantity) || 1), 0),
    [lines]
  );
  const discountAmount = useMemo(() => {
    const raw = discountType === "percent" ? (cartTotal * (Number(discountValue) || 0)) / 100 : (Number(discountValue) || 0);
    return Math.max(0, Math.min(cartTotal, Math.round(raw * 100) / 100));
  }, [cartTotal, discountType, discountValue]);
  const netSubtotal = Math.max(0, cartTotal - discountAmount);

  // The zone price list is re-quoted whenever the address or the amount it is
  // priced against changes, because a free-shipping threshold makes the price a
  // function of both. Debounced so typing a discount does not spray requests.
  useEffect(() => {
    if (!open) return undefined;
    const addressKnown = shippingProvider === "bosta"
      ? Boolean(shippingCityId)
      : Boolean(governorate);
    if (!addressKnown) {
      setQuotedShipping({ cost: null, source: "", freeShipping: false, loading: false });
      return undefined;
    }
    let active = true;
    setQuotedShipping((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        governorate: shippingProvider === "bosta" ? shippingLocationLabel(shippingLocations.cities.find((item) => shippingLocationId(item) === shippingCityId)) : governorate,
        city_area: shippingProvider === "bosta"
          ? (shippingLocationLabel(shippingLocations.districts.find((item) => shippingLocationId(item) === shippingDistrictId))
            || shippingLocationLabel(shippingLocations.zones.find((item) => shippingLocationId(item) === shippingZoneId)))
          : cityArea,
        shipping_city_id: shippingCityId,
        shipping_zone_id: shippingZoneId,
        shipping_district_id: shippingDistrictId,
        net_subtotal: String(netSubtotal),
      });
      api.get(`/ai-inbox/shipping-quote?${query.toString()}`, { headers, suppressErrorStatuses: [404, 500] })
        .then((data) => active && setQuotedShipping({
          cost: Number(data?.shipping_cost || 0),
          source: clean(data?.source),
          freeShipping: Boolean(data?.free_shipping_applied),
          loading: false,
        }))
        .catch(() => active && setQuotedShipping({ cost: null, source: "unavailable", freeShipping: false, loading: false }));
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [cityArea, governorate, headers, netSubtotal, open, shippingCityId, shippingDistrictId, shippingLocations, shippingProvider, shippingZoneId]);

  if (!open) return null;
  const shippingIsOverridden = shippingOverride !== null;
  const shippingCost = shippingIsOverridden ? Math.max(0, Number(shippingOverride) || 0) : Math.max(0, Number(quotedShipping.cost) || 0);
  const orderTotal = Math.max(0, netSubtotal + shippingCost);
  const selectedCity = shippingLocations.cities.find((item) => shippingLocationId(item) === shippingCityId) || null;
  const selectedZone = shippingLocations.zones.find((item) => shippingLocationId(item) === shippingZoneId) || null;
  const selectedDistrict = shippingLocations.districts.find((item) => shippingLocationId(item) === shippingDistrictId) || null;
  const shippingComplete = shippingProvider === "bosta"
    ? Boolean(shippingCityId && shippingZoneId && shippingDistrictId && streetAddress && buildingNumber)
    : Boolean(governorate && cityArea && streetAddress);
  const canSubmit = Boolean(lines.length && customerName && customerPhone && shippingProvider && shippingComplete) && !busy;
  const submitPayload = (confirm) => ({
    confirm,
    payment_method: paymentMethod,
    discount_type: discountType,
    discount_value: Math.max(0, Number(discountValue) || 0),
    // Sent only when the seller typed a price. Omitting the key entirely leaves
    // the server to quote from the zone list, which is the default authority.
    ...(shippingIsOverridden ? { shipping_cost: shippingCost } : {}),
    items: lines.map((line) => ({
      variant_id: line.variant_id,
      product_id: line.product_id,
      // Sent so the server can resolve the variant when the picker card had none.
      color: line.color,
      size: line.size,
      quantity: Math.max(1, Number(line.quantity) || 1),
    })),
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: streetAddress,
    governorate: shippingProvider === "bosta" ? shippingLocationLabel(selectedCity) : governorate,
    city_area: shippingProvider === "bosta" ? shippingLocationLabel(selectedDistrict) || shippingLocationLabel(selectedZone) : cityArea,
    shipping_provider: shippingProvider,
    shipping_provider_id: shippingProvider,
    shipping_city_id: shippingCityId,
    shipping_zone_id: shippingZoneId,
    shipping_district_id: shippingDistrictId,
    district_id: shippingDistrictId,
    street_address: streetAddress,
    building_number: buildingNumber,
    floor_number: floorNumber,
    apartment_number: apartmentNumber,
    landmark,
    notes,
  });
  const content = (
    <div className="ai-order ai-order__scrim fixed inset-0 z-[140] flex justify-end backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section dir="rtl" className="ai-order__dialog h-full w-full max-w-2xl overflow-y-auto p-5">
        <div className="ai-order__header flex items-start justify-between gap-3 pb-4">
          <div>
            <div className="ai-order__eyebrow">{t("aiSupport.inbox.order.orderTitle")}</div>
            <h2 className="ai-order__title mt-1">{t("aiSupport.inbox.order.orderHeading")}</h2>
            <p className="ai-order__subtitle mt-1">{t("aiSupport.inbox.order.orderNote")}</p>
          </div>
          <button type="button" onClick={onClose} className="ai-order__close grid h-10 w-10 place-items-center"><XCircle className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="ai-order__group p-4">
            <div className="ai-order__group-title mb-3 flex items-center gap-2"><User className="ai-order__group-icon h-4 w-4" />{t("aiSupport.inbox.order.customerData")}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t("aiSupport.inbox.order.customerName")} className="ai-order__field h-11 px-3" />
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder={t("aiSupport.inbox.order.phone")} inputMode="tel" className="ai-order__field h-11 px-3" />
            </div>
          </div>

          <div className="ai-order__group p-4">
            <div className="ai-order__group-title mb-1 flex items-center gap-2"><Truck className="ai-order__group-icon h-4 w-4" />{t("aiSupport.inbox.order.shippingSection")}</div>
            <p className="ai-order__group-hint mb-3">{t("aiSupport.inbox.order.shippingNote")}</p>

            {/* The customer can type their own address: one tap drops a public
                link into the chat, and the row below tracks it until the
                submitted address lands back in this form. */}
            <div className="ai-order__saved mb-3 flex flex-wrap items-center justify-between gap-2 p-2.5">
              {addressRequest?.status === "submitted" ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("aiSupport.inbox.order.addressLinkSubmitted")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      appliedAddressRequestRef.current = String(addressRequest.id);
                      applyAddressRequest(addressRequest);
                    }}
                    className="ai-order__saved-chip px-3 py-1.5"
                  >
                    {t("aiSupport.inbox.order.addressLinkUse")}
                  </button>
                </>
              ) : (
                <>
                  <span className="ai-order__label inline-flex items-center gap-1.5">
                    {addressLinkCopied ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("aiSupport.inbox.order.addressLinkCopied")}
                      </>
                    ) : addressRequest?.status === "pending" ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("aiSupport.inbox.order.addressLinkPending")}
                      </>
                    ) : (
                      t("aiSupport.inbox.order.addressLinkHint")
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={addressLinkBusy}
                    onClick={sendAddressLink}
                    className="ai-order__saved-chip inline-flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-50"
                  >
                    {addressLinkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                    {addressRequest?.status === "pending" ? t("aiSupport.inbox.order.addressLinkCopy") : t("aiSupport.inbox.order.addressLinkSend")}
                  </button>
                </>
              )}
            </div>

            {/* Addresses this customer has ordered to before — one tap instead of
                retyping the whole block. */}
            {savedAddresses.length ? (
              <div className="ai-order__saved mb-3 p-2.5">
                <div className="ai-order__label mb-2">{t("aiSupport.inbox.order.myAddresses")}</div>
                <div className="flex flex-wrap gap-2">
                  {savedAddresses.map((address) => (
                    <button
                      key={address.id}
                      type="button"
                      onClick={() => {
                        setShippingProvider(clean(address.shipping_provider) || shippingProvider);
                        setGovernorate(clean(address.governorate));
                        setCityArea(clean(address.city_area));
                        setShippingCityId(clean(address.shipping_city_id));
                        setShippingZoneId(clean(address.shipping_zone_id));
                        setShippingDistrictId(clean(address.shipping_district_id));
                        setStreetAddress(clean(address.street_address));
                        setBuildingNumber(clean(address.building_number));
                        setFloorNumber(clean(address.floor_number));
                        setApartmentNumber(clean(address.apartment_number));
                        setLandmark(clean(address.landmark));
                      }}
                      className="ai-order__saved-chip max-w-full truncate px-3 py-1.5"
                      title={[address.street_address, address.city_area, address.governorate].filter(Boolean).join(" — ")}
                    >
                      {[address.street_address, address.city_area || address.governorate].filter(Boolean).join(" — ") || t("aiSupport.inbox.order.savedAddress")}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="ai-order__label mb-1.5 block">{t("aiSupport.inbox.order.courierRequired")}</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("aiSupport.inbox.order.courier")}>
                  {AI_INBOX_SHIPPING_PROVIDERS.map((provider) => {
                    const active = shippingProvider === provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setShippingProvider(provider.id);
                          setShippingCityId("");
                          setShippingZoneId("");
                          setShippingDistrictId("");
                        }}
                        className={`ai-order__choice px-2${active ? " is-active" : ""}`}
                      >
                        {filterLabel(t, provider)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {shippingProvider === "bosta" ? (
                <>
                  <select value={shippingCityId} onChange={(event) => { setShippingCityId(event.target.value); setShippingZoneId(""); setShippingDistrictId(""); }} disabled={shippingLocations.loading} className="ai-order__field h-11 px-3">
                    <option value="">{shippingLocations.loading ? "تحميل المدن..." : "المدينة *"}</option>
                    {shippingLocations.cities.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)}>{shippingLocationLabel(item)}</option>)}
                  </select>
                  <select value={shippingZoneId} onChange={(event) => { setShippingZoneId(event.target.value); setShippingDistrictId(""); }} disabled={!shippingCityId} className="ai-order__field h-11 px-3">
                    <option value="">{t("aiSupport.inbox.order.zone")}</option>
                    {shippingLocations.zones.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)}>{shippingLocationLabel(item)}</option>)}
                  </select>
                  <select value={shippingDistrictId} onChange={(event) => setShippingDistrictId(event.target.value)} disabled={!shippingZoneId} className="ai-order__field h-11 px-3 sm:col-span-2">
                    <option value="">{t("aiSupport.inbox.order.district")}</option>
                    {shippingLocations.districts.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)}>{shippingLocationLabel(item)}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <input value={governorate} onChange={(event) => setGovernorate(event.target.value)} placeholder={t("aiSupport.inbox.order.governorate")} className="ai-order__field h-11 px-3" />
                  <input value={cityArea} onChange={(event) => setCityArea(event.target.value)} placeholder={t("aiSupport.inbox.order.cityArea")} className="ai-order__field h-11 px-3" />
                </>
              )}

              <div className="ai-order__label sm:col-span-2 flex items-center gap-2 pt-1"><MapPin className="ai-order__group-icon h-4 w-4" />{t("aiSupport.inbox.order.addressSection")}</div>
              <textarea value={streetAddress} onChange={(event) => setStreetAddress(event.target.value)} placeholder={t("aiSupport.inbox.order.streetAddress")} className="ai-order__field min-h-20 p-3 sm:col-span-2" />
              <input value={buildingNumber} onChange={(event) => setBuildingNumber(event.target.value)} placeholder={shippingProvider === "bosta" ? "رقم المبنى *" : "رقم المبنى"} className="ai-order__field h-11 px-3" />
              <input value={floorNumber} onChange={(event) => setFloorNumber(event.target.value)} placeholder={t("aiSupport.inbox.order.floor")} className="ai-order__field h-11 px-3" />
              <input value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} placeholder={t("aiSupport.inbox.order.apartment")} className="ai-order__field h-11 px-3" />
              <input value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder={t("aiSupport.inbox.order.landmark")} className="ai-order__field h-11 px-3" />
            </div>
          </div>

          <div className="ai-order__group p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="ai-order__group-title flex items-center gap-2"><ShoppingBag className="ai-order__group-icon h-4 w-4" />{t("aiSupport.inbox.order.productsSection")}</div>
              <button type="button" onClick={() => onRequestPick?.()} className="ai-order__add inline-flex items-center gap-2 px-3">
                <Plus className="h-4 w-4" />{t("aiSupport.inbox.order.addProduct")}
              </button>
            </div>

            {lines.length === 0 ? (
              <button type="button" onClick={() => onRequestPick?.()} className="ai-order__empty w-full p-6 text-center">
                {t("aiSupport.inbox.order.emptyCart")}
              </button>
            ) : (
              <div className="space-y-2">
                {lines.map((line) => (
                  <div key={composerLineKey(line)} className="ai-order__line flex items-center gap-3 p-2">
                    <div className="ai-order__line-thumb h-12 w-12 shrink-0 overflow-hidden">
                      {line.image_url ? <img src={line.image_url} alt="" className="h-full w-full object-contain" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="ai-order__line-name truncate">{line.product_name}</div>
                      <div className="ai-order__line-meta truncate">{[line.color, line.size].filter(Boolean).join(" / ") || "—"} · {money(line.price)}</div>
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) => {
                        const quantity = Math.max(1, Number(event.target.value) || 1);
                        setLines((current) => current.map((item) => (composerLineKey(item) === composerLineKey(line) ? { ...item, quantity } : item)));
                      }}
                      className="ai-order__qty h-10 w-16 shrink-0 px-2 text-center"
                    />
                    <button type="button" aria-label={t("aiSupport.inbox.order.removeLine")} onClick={() => setLines((current) => current.filter((item) => composerLineKey(item) !== composerLineKey(line)))} className="ai-order__line-remove grid h-9 w-9 shrink-0 place-items-center">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {/* Invoice discount: an amount or a percent of the goods. Zero means
                    the invoice prints no discount line at all. */}
                <div className="ai-order__discount p-3">
                  <div className="ai-order__label mb-2">{t("aiSupport.inbox.order.discount")}</div>
                  <div className="flex items-center gap-2">
                    <div className="ai-order__segment flex">
                      {["amount", "percent"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setDiscountType(type)}
                          className={`ai-order__segment-option h-10 px-3${discountType === type ? " is-active" : ""}`}
                        >
                          {type === "amount" ? t("aiSupport.inbox.order.discountAmount") : "%"}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={discountValue}
                      onChange={(event) => setDiscountValue(Math.max(0, Number(event.target.value) || 0))}
                      className="ai-order__qty h-10 w-28 px-3"
                    />
                    {discountAmount > 0 ? <span className="ai-order__deduction">- {money(discountAmount)}</span> : null}
                  </div>
                </div>

                {/* Shipping: quoted from the zone price list for the chosen
                    address, and editable here. The seller sees the real figure
                    before saving instead of discovering it on the invoice. */}
                <div className="ai-order__discount p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="ai-order__label">{t("aiSupport.inbox.order.shippingLabel")}</span>
                    {shippingIsOverridden ? (
                      <button type="button" onClick={() => setShippingOverride(null)} className="ai-order__segment-option h-8 px-2 text-xs">
                        {t("aiSupport.inbox.order.shippingResetAuto")}
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={shippingIsOverridden ? shippingOverride : (quotedShipping.cost ?? "")}
                      onChange={(event) => setShippingOverride(Math.max(0, Number(event.target.value) || 0))}
                      placeholder={quotedShipping.loading ? "…" : "0"}
                      aria-label={t("aiSupport.inbox.order.shippingLabel")}
                      className="ai-order__qty h-10 w-28 px-3"
                    />
                    <span className="ai-order__total-note">
                      {quotedShipping.loading
                        ? t("aiSupport.inbox.order.shippingLoading")
                        : shippingIsOverridden
                          ? t("aiSupport.inbox.order.shippingManual")
                          : quotedShipping.cost === null
                            ? t("aiSupport.inbox.order.shippingNeedsAddress")
                            : quotedShipping.freeShipping
                              ? t("aiSupport.inbox.order.shippingFree")
                              : t("aiSupport.inbox.order.shippingFromZones")}
                    </span>
                  </div>
                </div>

                <div className="ai-order__total p-3">
                  <div className="flex items-center justify-between">
                    <span>{lines.length} {t("aiSupport.inbox.order.lineCount")}</span>
                    <span>{t("aiSupport.inbox.order.cartTotal")} {money(cartTotal)}</span>
                  </div>
                  {discountAmount > 0 ? (
                    <div className="ai-order__deduction mt-1 flex items-center justify-between">
                      <span>{t("aiSupport.inbox.order.discount")}</span>
                      <span>- {money(discountAmount)}</span>
                    </div>
                  ) : null}
                  <div className="mt-1 flex items-center justify-between">
                    <span>{t("aiSupport.inbox.order.shippingLabel")}</span>
                    <span>+ {money(shippingCost)}</span>
                  </div>
                  <div className="ai-order__grand-total mt-2 flex items-center justify-between pt-2">
                    <span>{t("aiSupport.inbox.order.orderTotal")}</span>
                    <span>{money(orderTotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="ai-order__group p-4">
            <div className="ai-order__group-title mb-3 flex items-center gap-2"><CreditCard className="ai-order__group-icon h-4 w-4" />{t("aiSupport.inbox.order.paymentSection")}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("aiSupport.inbox.order.paymentSection")}>
              {AI_INBOX_PAYMENT_METHODS.map((method) => {
                const active = paymentMethod === method.id;
                return (
                  <button key={method.id} type="button" role="radio" aria-checked={active} onClick={() => setPaymentMethod(method.id)} className={`ai-order__choice px-2${active ? " is-active" : ""}`}>
                    {t(method.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("aiSupport.inbox.order.orderNotes")} className="ai-order__field min-h-20 w-full p-3" />
          {!lines.length ? <div className="ai-order__notice p-3">{t("aiSupport.inbox.order.addAtLeastOne")}</div> : null}
          {!shippingComplete ? <div className="ai-order__notice p-3">{t("aiSupport.inbox.order.completeShippingShort")}</div> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={!canSubmit} onClick={() => onSubmit?.(submitPayload(false))} className="ai-order__action inline-flex items-center justify-center gap-2 px-4"><ShoppingCart className="h-5 w-5" />{t("aiSupport.inbox.order.createDraft")}</button>
            {/* Save = the POS behaviour: confirmed invoice, stock out now, and the
                invoice link goes to the customer on this conversation channel. */}
            <button type="button" disabled={!canSubmit} onClick={() => onSubmit?.(submitPayload(true))} className="ai-order__action ai-order__action--primary inline-flex items-center justify-center gap-2 px-4"><CheckCircle2 className="h-5 w-5" />{t("aiSupport.inbox.order.saveInvoice")}</button>
          </div>
          <p className="ai-order__hint text-center">{t("aiSupport.inbox.order.saveHint")}</p>
        </div>
      </section>
    </div>
  );
  return portalTarget && typeof document !== "undefined" ? createPortal(content, portalTarget) : content;
}

export default InboxOrderComposer;
