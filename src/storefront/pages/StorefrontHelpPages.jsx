import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarDays, Plus, RefreshCcw, Search, Truck } from "lucide-react";
import { sfText } from "../lib/sfText";
import { normalizeMerchantReturnPolicy } from "../../shared/lib/merchantPolicies";
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
            className="sfp-search__input"
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
      {!visible.length ? <p className="sfp-empty">{sfText("storefront.faq.noResults", "مفيش سؤال بالكلام ده، جرّب كلمة تانية أو كلّمنا على واتساب.")}</p> : null}
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
    const conditions = configuredPolicy.conditions && typeof configuredPolicy.conditions === "object" ? configuredPolicy.conditions : {};
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
            <div key={key} className="sfp-fact">
              <span className="sfp-fact__icon" aria-hidden="true"><Icon size={18} /></span>
              <div>
                <p className="sfp-fact__title">{title}</p>
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
