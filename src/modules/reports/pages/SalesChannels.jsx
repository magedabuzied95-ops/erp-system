import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FaEnvelope,
  FaFacebookF,
  FaGlobe,
  FaInstagram,
  FaLink,
  FaMicrosoft,
  FaQuestion,
  FaSnapchatGhost,
  FaTelegramPlane,
  FaTiktok,
  FaTwitter,
  FaWhatsapp,
  FaYoutube,
} from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";

import useAnalyticsFilters from "../hooks/useAnalyticsFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import { fetchSalesChannels } from "../services/salesChannelsApi";

import PeriodSelector from "../components/PeriodSelector";
import ReportExportMenu from "../components/ReportExportMenu";
import { Card, ReportsHeader, ReportsPage } from "../components/ReportsLayout";
import { formatMoney } from "../lib/metricFormat";

/**
 * Sales channels: storefront sessions, carts, orders and revenue by the source that
 * brought the visit (Google, Facebook, TikTok, ...) and its medium (paid, organic, direct,
 * unknown). Last-touch per session — the order is credited to the visit it was placed in.
 *
 * Sessions and carts come from storefront traffic events; orders and revenue from the
 * attribution stamped on the order at checkout, so cancelled orders drop out.
 */

const MEDIUM_FILTERS = ["all", "paid", "organic", "direct", "unknown"];

const CHANNEL_LABELS = {
  direct: ["مباشر", "Direct"],
  google: ["جوجل", "Google"],
  facebook: ["فيسبوك", "Facebook"],
  instagram: ["إنستجرام", "Instagram"],
  tiktok: ["تيك توك", "TikTok"],
  youtube: ["يوتيوب", "YouTube"],
  snapchat: ["سناب شات", "Snapchat"],
  whatsapp: ["واتساب", "WhatsApp"],
  telegram: ["تليجرام", "Telegram"],
  twitter: ["إكس (تويتر)", "X (Twitter)"],
  bing: ["بينج", "Bing"],
  email: ["البريد الإلكتروني", "Email"],
  referral: ["مواقع أخرى", "Referral sites"],
  other: ["أخرى", "Other"],
  unknown: ["غير معروف", "Unknown"],
};

// Brand marks in brand colours, so a channel reads at a glance as it does on the ad platforms.
const CHANNEL_ICONS = {
  direct: { Icon: FaLink, color: "var(--text-secondary)" },
  google: { Icon: FcGoogle, color: undefined },
  facebook: { Icon: FaFacebookF, color: "#1877F2" },
  instagram: { Icon: FaInstagram, color: "#E4405F" },
  tiktok: { Icon: FaTiktok, color: "var(--text)" },
  youtube: { Icon: FaYoutube, color: "#FF0000" },
  snapchat: { Icon: FaSnapchatGhost, color: "#F7C600" },
  whatsapp: { Icon: FaWhatsapp, color: "#25D366" },
  telegram: { Icon: FaTelegramPlane, color: "#229ED9" },
  twitter: { Icon: FaTwitter, color: "#1DA1F2" },
  bing: { Icon: FaMicrosoft, color: "#00A4EF" },
  email: { Icon: FaEnvelope, color: "var(--text-secondary)" },
  referral: { Icon: FaGlobe, color: "var(--text-secondary)" },
  other: { Icon: FaGlobe, color: "var(--text-secondary)" },
  unknown: { Icon: FaQuestion, color: "var(--text-tertiary)" },
};

function ChannelMark({ channel }) {
  const { Icon, color } = CHANNEL_ICONS[channel] || CHANNEL_ICONS.other;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)]"
    >
      <Icon size={14} style={color ? { color } : undefined} />
    </span>
  );
}

const MEDIUM_TONES = {
  paid: "bg-[var(--primary)]/10 text-[var(--primary)]",
  organic: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  direct: "bg-[var(--border)]/60 text-[var(--text-secondary)]",
  unknown: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const changePct = (current, previous) => {
  const prev = Number(previous || 0);
  if (!prev) return null;
  return ((Number(current || 0) - prev) / prev) * 100;
};

export default function SalesChannels() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  const { filters, allowedComparisons, setPreset, setCompare } = useAnalyticsFilters();
  const [medium, setMedium] = useState("all");
  const [sort, setSort] = useState({ key: "revenue", dir: "desc" });

  const params = useMemo(
    () => ({ from: filters.from, to: filters.to, compare: filters.compare }),
    [filters.from, filters.to, filters.compare]
  );
  const { status, data, error, refresh } = useAnalyticsResource(fetchSalesChannels, params);

  const rText = (key, fallback, options = {}) => t(`reports.salesChannels.${key}`, { defaultValue: fallback, ...options });
  const money = (value) => formatMoney(Number(value || 0), language);
  const count = (value) => Number(value || 0).toLocaleString(isArabic ? "ar-EG" : "en-US");
  const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
  const channelLabel = (channel) => {
    const pair = CHANNEL_LABELS[channel];
    return pair ? pair[isArabic ? 0 : 1] : channel;
  };
  const mediumLabel = (value) => rText(`mediums.${value}`, {
    all: isArabic ? "الكل" : "All",
    paid: isArabic ? "مدفوع" : "Paid",
    organic: isArabic ? "مجاني" : "Organic",
    direct: isArabic ? "مباشر" : "Direct",
    unknown: isArabic ? "غير معروف" : "Unknown",
  }[value] || value);

  const totals = data?.totals || null;
  const previous = data?.comparison?.totals || null;
  const untracked = data?.untracked || { orders: 0, revenue: 0 };
  const busy = status === "loading" || status === "refreshing";
  const forbidden = error?.status === 403;

  const rows = useMemo(() => {
    const all = Array.isArray(data?.channels) ? data.channels : [];
    const filtered = medium === "all" ? all : all.filter((row) => row.medium === medium);
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (Number(a[sort.key] || 0) - Number(b[sort.key] || 0)) * factor);
  }, [data, medium, sort]);

  const toggleSort = (key) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const tiles = totals
    ? [
        { key: "revenue", label: rText("tiles.revenue", "الإيراد"), value: money(totals.revenue) },
        { key: "orders", label: rText("tiles.orders", "الطلبات"), value: count(totals.orders) },
        { key: "sessions", label: rText("tiles.sessions", "الزيارات"), value: count(totals.sessions) },
        { key: "added_to_cart", label: rText("tiles.addedToCart", "زيارات أضافت للسلة"), value: count(totals.added_to_cart), hint: pct(totals.cart_rate) },
        { key: "conversion_rate", label: rText("tiles.conversion", "نسبة التحويل"), value: pct(totals.conversion_rate), points: true },
        { key: "average_order_value", label: rText("tiles.aov", "متوسط قيمة الطلب"), value: money(totals.average_order_value) },
      ].map((tile) => {
        if (!previous) return tile;
        const delta = tile.points
          ? Number(totals[tile.key] || 0) - Number(previous[tile.key] || 0)
          : changePct(totals[tile.key], previous[tile.key]);
        return { ...tile, delta, deltaLabel: delta === null ? "" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}${tile.points ? " pt" : "%"}` };
      })
    : [];

  const columns = [
    { key: "sessions", label: rText("table.sessions", "الزيارات") },
    { key: "added_to_cart", label: rText("table.addedToCart", "أضاف للسلة") },
    { key: "orders", label: rText("table.orders", "الطلبات") },
    { key: "revenue", label: rText("table.revenue", "الإيراد") },
    { key: "conversion_rate", label: rText("table.conversion", "نسبة التحويل") },
    { key: "average_order_value", label: rText("table.aov", "متوسط الطلب") },
  ];

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <ReportsHeader
        title={rText("title", "تحليل قنوات البيع")}
        subtitle={rText(
          "subtitle",
          "الطلب بيتحسب لآخر مصدر جه منه العميل في نفس الزيارة. الزيارات والسلة من أحداث المتجر، والطلبات والإيراد من الطلبات نفسها بعد استبعاد الملغي."
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector
            filters={filters}
            allowedComparisons={allowedComparisons}
            onPresetChange={setPreset}
            onCompareChange={setCompare}
            onRefresh={refresh}
            busy={busy}
          />
          <ReportExportMenu
            reportKey="sales-channels"
            title={rText("title", "تحليل قنوات البيع")}
            filters={filters}
            language={language}
            sheets={() => ({
              language,
              sheets: rows.length
                ? [
                    {
                      name: rText("table.title", "القنوات"),
                      columns: [
                        { key: "channel_label", label: rText("table.channel", "القناة") },
                        { key: "medium_label", label: rText("table.medium", "النوع") },
                        { key: "sessions", label: rText("table.sessions", "الزيارات"), align: "end" },
                        { key: "added_to_cart", label: rText("table.addedToCart", "أضاف للسلة"), align: "end" },
                        { key: "orders", label: rText("table.orders", "الطلبات"), align: "end" },
                        { key: "revenue", label: rText("table.revenue", "الإيراد"), align: "end", kind: "currency" },
                        { key: "conversion_rate", label: rText("table.conversion", "نسبة التحويل"), align: "end", kind: "percent" },
                        { key: "average_order_value", label: rText("table.aov", "متوسط الطلب"), align: "end", kind: "currency" },
                      ],
                      rows: rows.map((row) => ({ ...row, channel_label: channelLabel(row.channel), medium_label: mediumLabel(row.medium) })),
                    },
                  ]
                : [],
            })}
          />
        </div>
      </ReportsHeader>

      {forbidden ? (
        <Card>
          <p className="text-[13px] text-[var(--text-secondary)]">{rText("forbidden", "مالكش صلاحية على التقارير.")}</p>
        </Card>
      ) : error ? (
        <Card>
          <p className="text-[13px] text-[var(--text-secondary)]">{error.message || rText("failed", "تعذر تحميل التقرير.")}</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {(tiles.length ? tiles : Array.from({ length: 6 }, (_, index) => ({ key: `skeleton-${index}` }))).map((tile) => (
              <Card key={tile.key}>
                {tile.label ? (
                  <>
                    <div className="text-[11px] font-semibold text-[var(--text-tertiary)]">{tile.label}</div>
                    <div className="mt-1.5 text-[20px] font-black tabular-nums text-[var(--text)] 2xl:text-[22px]">{tile.value}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--text-tertiary)]">
                      {tile.hint ? <span>{tile.hint}</span> : null}
                      {tile.deltaLabel ? (
                        <span dir="ltr" className={tile.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                          {tile.deltaLabel}
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="h-[52px] animate-pulse rounded-[var(--radius-control)] bg-[var(--border)]/40" />
                )}
              </Card>
            ))}
          </div>

          {untracked.orders > 0 ? (
            <Card>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {rText(
                  "untracked",
                  "{{orders}} طلب من الموقع بقيمة {{revenue}} في الفترة دي مالهمش مصدر مسجل (اتعملوا قبل تشغيل التتبع)، فمش داخلين في الجدول.",
                  { orders: count(untracked.orders), revenue: money(untracked.revenue) }
                )}
              </p>
            </Card>
          ) : null}

          <Card
            title={rText("table.title", "القنوات")}
            subtitle={rText("table.subtitle", "آخر مصدر في الزيارة اللي اتعمل فيها الطلب")}
            actions={
              <div className="flex flex-wrap gap-1" role="tablist">
                {MEDIUM_FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={medium === value}
                    onClick={() => setMedium(value)}
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                      medium === value
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--text-secondary)] hover:bg-[var(--border)]/50"
                    }`}
                  >
                    {mediumLabel(value)}
                  </button>
                ))}
              </div>
            }
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] text-[var(--text-tertiary)]">
                    <th className="px-4 py-2.5 text-start font-semibold">{rText("table.channel", "القناة")}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{rText("table.medium", "النوع")}</th>
                    {columns.map((column) => (
                      <th key={column.key} className="px-4 py-2.5 text-end font-semibold">
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className="inline-flex items-center gap-1 hover:text-[var(--text)]"
                          aria-sort={sort.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                        >
                          {column.label}
                          <span aria-hidden="true">{sort.key === column.key ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {busy && !rows.length ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index}><td colSpan={8} className="h-12 animate-pulse bg-[var(--border)]/20" /></tr>
                    ))
                  ) : rows.length ? (
                    rows.map((row) => (
                      <tr key={`${row.channel}|${row.medium}`} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2.5 font-semibold text-[var(--text)]">
                          <span className="inline-flex items-center gap-2.5">
                            <ChannelMark channel={row.channel} />
                            {channelLabel(row.channel)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${MEDIUM_TONES[row.medium] || MEDIUM_TONES.direct}`}>
                            {mediumLabel(row.medium)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{count(row.sessions)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
                          {count(row.added_to_cart)}
                          {row.sessions ? <span className="ms-1 text-[11px] text-[var(--text-tertiary)]">({pct(row.cart_rate)})</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text)]">{count(row.orders)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums font-semibold text-[var(--text)]">{money(row.revenue)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{row.sessions ? pct(row.conversion_rate) : "—"}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{money(row.average_order_value)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-[var(--text-secondary)]">
                        {rText("table.empty", "مفيش زيارات أو طلبات متتبعة في الفترة دي لسه. الأرقام بتبدأ تتجمع من يوم تشغيل التتبع.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </ReportsPage>
  );
}
