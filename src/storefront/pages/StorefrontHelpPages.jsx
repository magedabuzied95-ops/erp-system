import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarDays, Clock3, Mail, MapPin, Phone, Plus, RefreshCcw, Search, ShoppingBag, Truck } from "lucide-react";
import { sfText } from "../lib/sfText";
import { normalizeMerchantReturnPolicy, normalizeShippingPolicyZone } from "../../shared/lib/merchantPolicies";
import { STORE_IDENTITY, storeAddressFor } from "../../shared/lib/storeIdentity";
import { FALLBACK_GOVERNORATES } from "../components/DeliveryEstimate.jsx";
import { api } from "../../shared/api/api";
import { ROOT_PATHS } from "../lib/paths";
import PolicyLayout, { PolicyHelp, PolicyList, PolicyTabs } from "./policy/PolicyLayout";

/*
 * The storefront's help pages — /faq and /returns — in the frame the legal pages share
 * (policy/PolicyLayout). Copy lives in storefront.json under storefront.faq / storefront.returns.
 */

const DEFAULT_RETURN_DAYS = 14;

export function usePolicyTabs() {
  const { pathname } = useLocation();
  const links = [
    { to: ROOT_PATHS.faq || "/faq", label: sfText("storefront.policies.faq", "الأسئلة الشائعة") },
    { to: ROOT_PATHS.returns || "/returns", label: sfText("storefront.policies.returns", "الاستبدال والاسترجاع") },
    { to: ROOT_PATHS.shipping || "/shipping", label: sfText("storefront.policies.shipping", "الشحن والتوصيل") },
    { to: ROOT_PATHS.about || "/about", label: sfText("storefront.policies.about", "من نحن") },
    { to: "/privacy", label: sfText("storefront.policies.privacy", "سياسة الخصوصية") },
    { to: "/terms", label: sfText("storefront.policies.terms", "الشروط والأحكام") },
  ];
  return <PolicyTabs label={sfText("storefront.policies.navLabel", "المساعدة والسياسات")} links={links.map((link) => ({ ...link, active: pathname === link.to }))} />;
}

function StoreHelp({ whatsappHref }) {
  return (
    <PolicyHelp
      title={sfText("storefront.policies.helpTitle", "لسه عندك سؤال؟")}
      text={sfText("storefront.policies.helpText", "فريقنا بيرد على واتساب ويساعدك في أي حاجة تخص طلبك.")}
      whatsappHref={whatsappHref}
      whatsappLabel={sfText("storefront.policies.whatsapp", "كلّمنا على واتساب")}
    />
  );
}

/* -------------------------------------------------------------------- FAQ */

// Literal keys, so the missing-key guard can see every one of them.
const FAQ_GROUPS = [
  {
    id: "orders",
    title: () => sfText("storefront.faq.groups.orders", "الطلب"),
    items: [
      { id: "how-to-order", q: () => sfText("storefront.faq.items.howToOrder.q"), a: () => sfText("storefront.faq.items.howToOrder.a") },
      { id: "confirmation", q: () => sfText("storefront.faq.items.confirmation.q"), a: () => sfText("storefront.faq.items.confirmation.a") },
      { id: "track-order", q: () => sfText("storefront.faq.items.trackOrder.q"), a: () => sfText("storefront.faq.items.trackOrder.a"), link: { to: "/track", label: () => sfText("storefront.orders.trackOrder", "تتبع الطلب") } },
      { id: "change-order", q: () => sfText("storefront.faq.items.changeOrder.q"), a: () => sfText("storefront.faq.items.changeOrder.a") },
    ],
  },
  {
    id: "shipping",
    title: () => sfText("storefront.faq.groups.shipping", "الشحن والتوصيل"),
    items: [
      { id: "delivery-time", q: () => sfText("storefront.faq.items.deliveryTime.q"), a: () => sfText("storefront.faq.items.deliveryTime.a") },
      { id: "shipping-cost", q: () => sfText("storefront.faq.items.shippingCost.q"), a: () => sfText("storefront.faq.items.shippingCost.a") },
      { id: "courier", q: () => sfText("storefront.faq.items.courier.q"), a: () => sfText("storefront.faq.items.courier.a") },
    ],
  },
  {
    id: "payment",
    title: () => sfText("storefront.faq.groups.payment", "الدفع"),
    items: [
      { id: "payment-methods", q: () => sfText("storefront.faq.items.paymentMethods.q"), a: () => sfText("storefront.faq.items.paymentMethods.a") },
    ],
  },
  {
    id: "returns",
    title: () => sfText("storefront.faq.groups.returns", "الاستبدال والاسترجاع"),
    items: [
      { id: "return-window", q: () => sfText("storefront.faq.items.returnWindow.q"), a: (days) => sfText("storefront.faq.items.returnWindow.a", undefined, { days }), link: { to: "/returns", label: () => sfText("storefront.faq.readReturnsPolicy", "اقرأ سياسة الاستبدال") } },
      { id: "bags-returns", q: () => sfText("storefront.faq.items.bagsReturns.q"), a: () => sfText("storefront.faq.items.bagsReturns.a") },
      { id: "return-shipping", q: () => sfText("storefront.faq.items.returnShipping.q"), a: () => sfText("storefront.faq.items.returnShipping.a") },
      { id: "start-exchange", q: () => sfText("storefront.faq.items.startExchange.q"), a: () => sfText("storefront.faq.items.startExchange.a") },
      { id: "refund", q: () => sfText("storefront.faq.items.refund.q"), a: () => sfText("storefront.faq.items.refund.a") },
    ],
  },
  {
    id: "sizes",
    title: () => sfText("storefront.faq.groups.sizes", "المقاسات"),
    items: [
      { id: "find-size", q: () => sfText("storefront.faq.items.findSize.q"), a: () => sfText("storefront.faq.items.findSize.a") },
      { id: "between-sizes", q: () => sfText("storefront.faq.items.betweenSizes.q"), a: () => sfText("storefront.faq.items.betweenSizes.a") },
      { id: "crocs-sizes", q: () => sfText("storefront.faq.items.crocsSizes.q"), a: () => sfText("storefront.faq.items.crocsSizes.a") },
    ],
  },
  {
    id: "account",
    title: () => sfText("storefront.faq.groups.account", "الحساب"),
    items: [
      { id: "need-account", q: () => sfText("storefront.faq.items.needAccount.q"), a: () => sfText("storefront.faq.items.needAccount.a"), link: { to: "/account", label: () => sfText("storefront.account.title", "حسابي") } },
      { id: "sign-in", q: () => sfText("storefront.faq.items.signIn.q"), a: () => sfText("storefront.faq.items.signIn.a") },
    ],
  },
];

const normalizeSearch = (value = "") => String(value || "")
  .toLowerCase()
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/ى/g, "ي")
  .replace(/[ً-ْ]/g, "")
  .trim();

export function FaqPage({ publicStoreSettings = {}, whatsappHref = "" }) {
  const { i18n } = useTranslation();
  const { hash } = useLocation();
  const tabs = usePolicyTabs();
  const [query, setQuery] = useState("");
  const days = normalizeMerchantReturnPolicy(publicStoreSettings)?.days || DEFAULT_RETURN_DAYS;

  // Resolved per language so a switch re-renders the copy, not the cached first language.
  const groups = useMemo(
    () => FAQ_GROUPS.map((group) => ({
      id: group.id,
      title: group.title(),
      items: group.items.map((item) => ({ id: item.id, q: item.q(), a: item.a(days), link: item.link ? { to: item.link.to, label: item.link.label() } : null })),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, i18n.language]
  );

  const needle = normalizeSearch(query);
  const visible = needle
    ? groups
      .map((group) => ({ ...group, items: group.items.filter((item) => normalizeSearch(`${item.q} ${item.a}`).includes(needle)) }))
      .filter((group) => group.items.length)
    : groups;

  const openId = String(hash || "").replace(/^#/, "");
  useEffect(() => {
    if (!openId || typeof document === "undefined") return;
    document.getElementById(openId)?.scrollIntoView({ block: "start" });
  }, [openId]);

  return (
    <PolicyLayout
      dir={i18n.dir?.(i18n.language)}
      tabs={tabs}
      title={sfText("storefront.faq.title", "الأسئلة الشائعة")}
      lead={sfText("storefront.faq.lead", "إجابات سريعة عن الطلب والشحن والدفع والاستبدال والمقاسات.")}
      contentsLabel={sfText("storefront.policies.contents", "في الصفحة دي")}
      intro={(
        <label className="sfp-search">
          <Search size={18} className="sfp-search__icon" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={sfText("storefront.faq.searchPlaceholder", "دوّر على سؤالك...")}
            aria-label={sfText("storefront.faq.searchPlaceholder", "دوّر على سؤالك...")}
            className="sfp-search__input sfx-input sfx-input--pill"
          />
        </label>
      )}
      sections={visible.map((group) => ({
        id: `faq-${group.id}`,
        title: group.title,
        content: (
          <div className="sfp-faq">
            {group.items.map((item) => (
              <details key={item.id} id={item.id} className="sfp-faq__item" open={Boolean(needle) || openId === item.id || undefined}>
                <summary className="sfp-faq__q">
                  <span>{item.q}</span>
                  <span className="sfp-faq__sign" aria-hidden="true"><Plus size={14} /></span>
                </summary>
                <div className="sfp-faq__a">
                  <p>{item.a}</p>
                  {item.link ? <Link to={item.link.to} className="sfp-link">{item.link.label}</Link> : null}
                </div>
              </details>
            ))}
          </div>
        ),
      }))}
      help={<StoreHelp whatsappHref={whatsappHref} />}
    >
      {!visible.length ? <div className="sfp-empty sfx-empty sfx-empty--compact"><p className="sfp-empty__text sfx-empty__text">{sfText("storefront.faq.noResults", "مفيش سؤال بالكلام ده، جرّب كلمة تانية أو كلّمنا على واتساب.")}</p></div> : null}
    </PolicyLayout>
  );
}

/* ---------------------------------------------------------------- returns */

export function ReturnsPolicyPage({ publicStoreSettings = {}, whatsappHref = "" }) {
  const { i18n } = useTranslation();
  const tabs = usePolicyTabs();
  const configuredPolicy = normalizeMerchantReturnPolicy(publicStoreSettings);
  const days = configuredPolicy?.days || DEFAULT_RETURN_DAYS;

  let sections = [
    {
      id: "returns-conditions",
      title: sfText("storefront.returns.policy.acceptanceTitle"),
      intro: sfText("storefront.returns.policy.intro"),
      items: [
        sfText("storefront.returns.policy.cond1"),
        sfText("storefront.returns.policy.cond2"),
        sfText("storefront.returns.policy.cond3"),
        sfText("storefront.returns.policy.cond4"),
      ],
    },
    {
      id: "returns-excluded",
      title: sfText("storefront.returns.policy.excludedTitle"),
      items: [
        sfText("storefront.returns.noBags"),
        sfText("storefront.returns.policy.excluded1"),
        sfText("storefront.returns.policy.excluded2"),
        sfText("storefront.returns.policy.excluded3"),
        sfText("storefront.returns.policy.excluded4"),
      ],
    },
    {
      id: "returns-online",
      title: sfText("storefront.returns.policy.onlineTitle"),
      text: sfText("storefront.returns.policy.onlineText"),
    },
    {
      id: "returns-customer-change",
      title: sfText("storefront.returns.policy.customerChangeTitle"),
      items: [
        sfText("storefront.returns.policy.customerChange1"),
        sfText("storefront.returns.policy.customerChange2"),
        sfText("storefront.returns.policy.customerChange3"),
      ],
      outro: sfText("storefront.returns.policy.customerChange4"),
    },
    {
      id: "returns-store-error",
      title: sfText("storefront.returns.policy.storeErrorTitle"),
      items: [
        sfText("storefront.returns.policy.storeError1"),
        sfText("storefront.returns.policy.storeError2"),
        sfText("storefront.returns.policy.storeError3"),
      ],
      outro: sfText("storefront.returns.policy.storeError4"),
    },
    {
      id: "returns-inspection",
      title: sfText("storefront.returns.policy.inspectionTitle"),
      items: [sfText("storefront.returns.policy.inspection1"), sfText("storefront.returns.policy.inspection2")],
    },
    {
      id: "returns-refund",
      title: sfText("storefront.returns.policy.refundTitle"),
      items: [sfText("storefront.returns.policy.refund1"), sfText("storefront.returns.policy.refund2")],
    },
    {
      id: "returns-notes",
      title: sfText("storefront.returns.policy.notesTitle"),
      items: [sfText("storefront.returns.policy.note1"), sfText("storefront.returns.policy.note2"), sfText("storefront.returns.policy.note3")],
    },
  ];

  // A policy the owner configured in settings replaces the default wording.
  if (configuredPolicy) {
    const stored = configuredPolicy.conditions && typeof configuredPolicy.conditions === "object" ? configuredPolicy.conditions : {};
    // The owner writes these once, in Arabic. An English reader gets the same clause from the
    // locale file (the key names what the clause says); the Arabic reader keeps the owner's words.
    const english = String(i18n.language || "").startsWith("en");
    const translated = {
      unused_original_condition: sfText("storefront.returns.policy.conditions.unusedOriginal"),
      invoice_required: sfText("storefront.returns.policy.conditions.invoiceRequired"),
      customer_choice_shipping: sfText("storefront.returns.policy.conditions.customerChoiceShipping"),
      defect_shipping: sfText("storefront.returns.policy.conditions.defectShipping"),
    };
    const conditions = Object.fromEntries(
      Object.entries(stored).map(([key, value]) => [key, value && english && translated[key] ? translated[key] : value])
    );
    sections = [
      {
        id: "returns-duration",
        title: sfText("storefront.returns.policy.durationTitle"),
        text: sfText("storefront.returns.policy.durationText", undefined, { days: configuredPolicy.days }),
      },
      {
        id: "returns-conditions",
        title: sfText("storefront.returns.policy.acceptanceTitle"),
        items: [conditions.unused_original_condition, conditions.invoice_required].filter(Boolean),
      },
      {
        id: "returns-excluded",
        title: sfText("storefront.returns.policy.excludedTitle"),
        items: [sfText("storefront.returns.noBags")],
      },
      {
        id: "returns-shipping",
        title: sfText("storefront.returns.policy.shippingCostTitle"),
        items: [conditions.customer_choice_shipping, conditions.defect_shipping].filter(Boolean),
      },
    ].filter((section) => section.text || section.items.length);
  }

  const facts = [
    { key: "days", Icon: CalendarDays, title: sfText("storefront.returns.facts.daysTitle", "{{days}} يوم", { days }), text: sfText("storefront.returns.facts.daysText", "من يوم ما تستلم الطلب") },
    ...(configuredPolicy ? [] : [
      { key: "store", Icon: Truck, title: sfText("storefront.returns.facts.storeErrorTitle", "الغلط مننا؟ الشحن علينا"), text: sfText("storefront.returns.facts.storeErrorText", "مقاس أو منتج مختلف أو عيب صناعة") },
      { key: "change", Icon: RefreshCcw, title: sfText("storefront.returns.facts.changeTitle", "غيّرت رأيك؟"), text: sfText("storefront.returns.facts.changeText", "بتتحمل مصاريف الشحن رايح جاي") },
    ]),
    { key: "bags", Icon: ShoppingBag, title: sfText("storefront.returns.facts.bagsTitle", "الشنط مش بتتبدل"), text: sfText("storefront.returns.facts.bagsText", "ولا بترجع، فاتأكد من اختيارك قبل الطلب") },
    { key: "inspection", Icon: BadgeCheck, title: sfText("storefront.returns.facts.inspectionTitle", "بنفحص المنتج"), text: sfText("storefront.returns.facts.inspectionText", "قبل الموافقة على الاستبدال أو الاسترجاع") },
  ];

  return (
    <PolicyLayout
      dir={i18n.dir?.(i18n.language)}
      tabs={tabs}
      title={sfText("storefront.returns.title", "سياسة الاستبدال والاسترجاع")}
      lead={sfText("storefront.returns.policy.footer")}
      contentsLabel={sfText("storefront.policies.contents", "في الصفحة دي")}
      intro={(
        <div className="sfp-facts">
          {facts.map(({ key, Icon, title, text }) => (
            <div key={key} className="sfp-fact sfx-surface">
              <span className="sfp-fact__icon" aria-hidden="true"><Icon size={18} /></span>
              <div>
                <p className="sfp-fact__title sfx-h3">{title}</p>
                <p className="sfp-fact__text">{text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      sections={sections.map((section) => ({
        id: section.id,
        title: section.title,
        content: (
          <>
            {section.intro ? <p className="sfp-p">{section.intro}</p> : null}
            {section.text ? <p className="sfp-p">{section.text}</p> : null}
            {section.items?.length ? <PolicyList items={section.items} /> : null}
            {section.outro ? <p className="sfp-p"><strong>{section.outro}</strong></p> : null}
          </>
        ),
      }))}
      help={(
        <PolicyHelp
          title={sfText("storefront.returns.helpTitle", "عايز تبدّل أو ترجّع؟")}
          text={sfText("storefront.returns.helpText", "ابعتلنا رقم الطلب والسبب على واتساب وهنرتّب معاك الباقي.")}
          whatsappHref={whatsappHref}
          whatsappLabel={sfText("storefront.policies.whatsapp", "كلّمنا على واتساب")}
        />
      )}
    />
  );
}

/* --------------------------------------------------------------- shipping */

const governorateLabel = (zone = {}, arabic = true) => {
  const name = String(zone.governorate || zone.city || zone.area || "").trim();
  if (!arabic) return name;
  if (String(zone.arabic_alias || "").trim()) return String(zone.arabic_alias).trim();
  const key = name.toLowerCase().replace(/\s+/g, "-");
  return FALLBACK_GOVERNORATES.find((entry) => entry.id === key || entry.en.toLowerCase() === name.toLowerCase())?.ar || name;
};

const shippingZonesFrom = (settings = {}) => {
  const storefront = settings.storefront && typeof settings.storefront === "object" ? settings.storefront : {};
  const zones = Array.isArray(settings.shipping_zones) ? settings.shipping_zones : Array.isArray(storefront.shipping_zones) ? storefront.shipping_zones : [];
  return zones.map(normalizeShippingPolicyZone).filter((zone) => zone.active && String(zone.governorate || zone.city || zone.area || "").trim());
};

/*
 * /shipping — the fee and delivery time per governorate, read from the same shipping zones the
 * checkout charges and the product JSON-LD advertises, so the three never disagree. The zones live
 * in /storefront/settings, not in the public settings map the shell already holds.
 */
export function ShippingPolicyPage({ publicStoreSettings = {}, whatsappHref = "" }) {
  const { i18n } = useTranslation();
  const tabs = usePolicyTabs();
  const arabic = !String(i18n.language || "ar").startsWith("en");
  const [loadedZones, setLoadedZones] = useState(null);
  useEffect(() => {
    let active = true;
    api
      .get("/storefront/settings", { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (active) setLoadedZones(shippingZonesFrom(data?.settings || data || {})); })
      .catch(() => { if (active) setLoadedZones([]); });
    return () => { active = false; };
  }, []);
  const zones = loadedZones?.length ? loadedZones : shippingZonesFrom(publicStoreSettings);
  const money = (value) => new Intl.NumberFormat(arabic ? "ar-EG" : "en-EG").format(Number(value) || 0);
  const deliveryText = (zone) => {
    const min = zone.delivery_min_days;
    const max = zone.delivery_max_days;
    if (min === null || max === null) return String(zone.estimated_delivery_text || "").trim() || "—";
    return min === max ? sfText("storefront.shippingPolicy.deliveryDay", undefined, { min }) : sfText("storefront.shippingPolicy.deliveryDays", undefined, { min, max });
  };

  const sections = [
    {
      id: "shipping-zones",
      title: sfText("storefront.shippingPolicy.zonesTitle"),
      content: zones.length ? (
        <>
          <p className="sfp-p">{sfText("storefront.shippingPolicy.zonesIntro")}</p>
          <div className="sfp-table-wrap">
            <table className="sfp-table">
              <thead>
                <tr>
                  <th scope="col">{sfText("storefront.shippingPolicy.governorate")}</th>
                  <th scope="col">{sfText("storefront.shippingPolicy.price")}</th>
                  <th scope="col">{sfText("storefront.shippingPolicy.delivery")}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.id || zone.governorate}>
                    <th scope="row">{governorateLabel(zone, arabic)}</th>
                    <td>
                      {zone.price > 0 ? `${money(zone.price)} ${arabic ? "ج.م" : "EGP"}` : sfText("storefront.shippingPolicy.free")}
                      {zone.free_shipping_threshold > 0 ? <small className="sfp-table__note">{sfText("storefront.shippingPolicy.freeOver", undefined, { amount: money(zone.free_shipping_threshold) })}</small> : null}
                    </td>
                    <td>{deliveryText(zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="sfp-p">{sfText("storefront.shippingPolicy.noZones")}</p>,
    },
    {
      id: "shipping-confirm",
      title: sfText("storefront.shippingPolicy.confirmTitle"),
      content: <PolicyList items={[sfText("storefront.shippingPolicy.confirm1"), sfText("storefront.shippingPolicy.confirm2")]} />,
    },
    {
      id: "shipping-track",
      title: sfText("storefront.shippingPolicy.trackTitle"),
      content: (
        <>
          <p className="sfp-p">{sfText("storefront.shippingPolicy.trackText")}</p>
          <Link to={ROOT_PATHS.track || "/track"} className="sfp-link">{sfText("storefront.shippingPolicy.trackLink")}</Link>
        </>
      ),
    },
    {
      id: "shipping-issues",
      title: sfText("storefront.shippingPolicy.issuesTitle"),
      content: (
        <>
          <PolicyList items={[sfText("storefront.shippingPolicy.issues1"), sfText("storefront.shippingPolicy.issues2")]} />
          <Link to={ROOT_PATHS.returns || "/returns"} className="sfp-link">{sfText("storefront.shippingPolicy.returnsLink")}</Link>
        </>
      ),
    },
  ];

  return (
    <PolicyLayout
      dir={i18n.dir?.(i18n.language)}
      tabs={tabs}
      title={sfText("storefront.shippingPolicy.title")}
      lead={sfText("storefront.shippingPolicy.lead")}
      contentsLabel={sfText("storefront.policies.contents", "في الصفحة دي")}
      sections={sections}
      help={<StoreHelp whatsappHref={whatsappHref} />}
    />
  );
}

/* ------------------------------------------------------------------ about */

/*
 * /about — who runs the shop and where it is. The address, phone and hours come from
 * STORE_IDENTITY, the record Merchant Center and the Business Profile are checked against.
 */
export function AboutPage({ publicStoreSettings = {}, whatsappHref = "" }) {
  const { i18n } = useTranslation();
  const tabs = usePolicyTabs();
  const arabic = !String(i18n.language || "ar").startsWith("en");
  const days = normalizeMerchantReturnPolicy(publicStoreSettings)?.days || DEFAULT_RETURN_DAYS;
  const facts = [
    { key: "address", Icon: MapPin, title: sfText("storefront.about.addressLabel"), text: storeAddressFor(arabic ? "ar" : "en"), href: STORE_IDENTITY.mapUrl, external: true },
    { key: "hours", Icon: Clock3, title: sfText("storefront.about.hoursLabel"), text: arabic ? STORE_IDENTITY.hours.ar : STORE_IDENTITY.hours.en },
    { key: "phone", Icon: Phone, title: sfText("storefront.about.phoneLabel"), text: STORE_IDENTITY.phoneDisplay, href: `tel:${STORE_IDENTITY.phoneE164}`, ltr: true },
    { key: "email", Icon: Mail, title: sfText("storefront.about.emailLabel"), text: STORE_IDENTITY.email, href: `mailto:${STORE_IDENTITY.email}`, ltr: true },
  ];

  return (
    <PolicyLayout
      dir={i18n.dir?.(i18n.language)}
      tabs={tabs}
      title={sfText("storefront.about.title")}
      lead={sfText("storefront.about.lead")}
      contentsLabel={sfText("storefront.policies.contents", "في الصفحة دي")}
      intro={(
        <div className="sfp-facts">
          {facts.map(({ key, Icon, title, text, href, external, ltr }) => (
            <div key={key} className="sfp-fact sfx-surface">
              <span className="sfp-fact__icon" aria-hidden="true"><Icon size={18} /></span>
              <div>
                <p className="sfp-fact__title sfx-h3">{title}</p>
                <p className="sfp-fact__text" dir={ltr ? "ltr" : undefined}>
                  {href ? <a href={href} className="sfp-link" {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{text}</a> : text}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      sections={[
        { id: "about-who", title: sfText("storefront.about.whoTitle"), content: <p className="sfp-p">{sfText("storefront.about.whoText")}</p> },
        {
          id: "about-how",
          title: sfText("storefront.about.howTitle"),
          content: <PolicyList items={[sfText("storefront.about.how1"), sfText("storefront.about.how2"), sfText("storefront.about.how3", undefined, { days })]} />,
        },
        { id: "about-contact", title: sfText("storefront.about.contactTitle"), content: <p className="sfp-p">{sfText("storefront.about.contactText")}</p> },
      ]}
      help={<StoreHelp whatsappHref={whatsappHref} />}
    />
  );
}
