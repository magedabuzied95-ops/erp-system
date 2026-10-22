import { useTranslation } from "react-i18next";
import { BarChart3, Copy, ExternalLink, Pencil, Trash2 } from "lucide-react";

import { Checkbox, IconButton, LoadingState, Switch } from "../../../../shared/ui";
import { deliveryTone, formatCompact, formatDate, formatMoney, localeFor } from "../../shared/metaAdsFormat";

const DASH = "—";
const isBlank = (value) => value === null || value === undefined || value === "";
const hasAmount = (value) => !isBlank(value) && Number(value) > 0;

const statusOf = (row) => String(row.effective_status || row.status || "").toUpperCase();
const isLiveOn = (row) => String(row.status || "").toUpperCase() === "ACTIVE";

// One level of the Ads Manager (campaigns / ad sets / ads).
export default function ManagerTable({
  level,
  rows,
  loading,
  visible,
  canManage,
  pendingIds,
  selectedIds,
  onSelect,
  onSelectAll,
  onToggleStatus,
  onEdit,
  onDuplicate,
  onDelete,
  onCharts,
  onDrill,
  emptyText,
  erp,
}) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);

  // LTR isolate (LRI…PDI) keeps "50.00 USD" in that order inside Arabic text.
  const money = (value, currency) => `⁦${formatMoney(value, currency, locale)}⁩`;
  const compact = (value) => (isBlank(value) ? DASH : formatCompact(value, t, locale));
  const ratio = (value) => (isBlank(value) ? DASH : `${Number(value).toLocaleString(locale, { maximumFractionDigits: 2 })}×`);
  const moneyCell = (value, currency) => (isBlank(value) ? DASH : money(value, currency));
  // Meta's ranking verdicts: above / average / the bottom 35%, 20% or 10% for the same audience.
  const ranking = (value) => {
    const code = String(value || "").toUpperCase();
    if (!code || code === "UNKNOWN") return DASH;
    const tone = code === "ABOVE_AVERAGE" ? "success" : code === "AVERAGE" ? "neutral" : "danger";
    return <span className={`ma-rank ma-rank--${tone}`}>{t(`metaAdsManager.rankings.${code}`, { defaultValue: code })}</span>;
  };

  const budgetText = (row) => {
    if (hasAmount(row.daily_budget)) return t("metaAdsManager.perDay", { amount: money(row.daily_budget, row.currency) });
    if (hasAmount(row.lifetime_budget)) return t("metaAdsManager.lifetime", { amount: money(row.lifetime_budget, row.currency) });
    if (level === "adset" && (row.campaign_budget_optimization || hasAmount(row.campaign_daily_budget) || hasAmount(row.campaign_lifetime_budget))) {
      return t("metaAdsManager.campaignBudget");
    }
    return DASH;
  };

  const endText = (row) => {
    const end = level === "campaign" ? row.stop_time : row.end_time;
    return end ? formatDate(end, locale) : t("metaAdsManager.ongoing");
  };

  const delivery = (row) => {
    if (row.is_draft) {
      return <span className="ma-delivery ma-delivery--neutral"><i aria-hidden="true" />{t("metaAdsManager.draft")}</span>;
    }
    const status = statusOf(row);
    const tone = deliveryTone(status);
    const rejection = row.rejection;
    if (rejection) {
      // Meta's verdict under the status, and the Ads Manager panel that carries Meta's own
      // "request review" button (there is no Graph call that files an appeal).
      const detail = [
        ...rejection.reasons.map((reason) => (reason.reason && reason.policy_label ? `${reason.policy_label}: ${reason.reason}` : reason.reason || reason.policy_label)),
        ...rejection.issues.map((issue) => issue.message || issue.summary),
      ].join("\n");
      return (
        <div className="ma-delivery-block">
          <span className={`ma-delivery ma-delivery--${tone}`} title={detail}>
            <i aria-hidden="true" />
            {status ? t(`metaAds.status.${status}`, { defaultValue: status }) : DASH}
          </span>
          <span className="ma-delivery__reason" title={detail}>{rejection.headline}</span>
          {row.review_url ? (
            <a className="ma-delivery__review" href={row.review_url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} aria-hidden="true" />
              <span>{t("metaAdsManager.rejection.requestReview")}</span>
            </a>
          ) : null}
        </div>
      );
    }
    return (
      <span className={`ma-delivery ma-delivery--${tone}`} title={row.last_error || undefined}>
        <i aria-hidden="true" />
        {status ? t(`metaAds.status.${status}`, { defaultValue: status }) : DASH}
      </span>
    );
  };

  const CELLS = {
    delivery,
    objective: (row) => (row.objective ? t(`metaAds.objectives.${row.objective}.label`, { defaultValue: row.objective }) : DASH),
    goal: (row) => (row.optimization_goal ? t(`metaAds.goals.${row.optimization_goal}`, { defaultValue: row.optimization_goal }) : DASH),
    creative: (row) => (row.creative_type ? t(`metaAdsManager.creativeTypes.${row.creative_type}`, { defaultValue: row.creative_type }) : DASH),
    budget: budgetText,
    results: (row) => compact(row.results),
    reach: (row) => compact(row.reach),
    impressions: (row) => compact(row.impressions),
    spend: (row) => moneyCell(row.spend, row.currency),
    purchases: (row) => compact(row.purchases),
    purchase_value: (row) => moneyCell(row.purchase_value, row.currency),
    roas: (row) => ratio(row.roas),
    cost_per_purchase: (row) => moneyCell(row.cost_per_purchase, row.currency),
    purchases_7d_click: (row) => compact(row.purchases_7d_click),
    roas_7d_click: (row) => ratio(row.roas_7d_click),
    link_clicks: (row) => compact(row.link_clicks),
    landing_page_views: (row) => compact(row.landing_page_views),
    add_to_cart: (row) => compact(row.add_to_cart),
    initiate_checkout: (row) => compact(row.initiate_checkout),
    frequency: (row) => (isBlank(row.frequency) ? DASH : Number(row.frequency).toLocaleString(locale, { maximumFractionDigits: 2 })),
    quality_ranking: (row) => ranking(row.quality_ranking),
    engagement_rate_ranking: (row) => ranking(row.engagement_rate_ranking),
    conversion_rate_ranking: (row) => ranking(row.conversion_rate_ranking),
    end: endText,
  };

  // The footer sums what is summable and divides the sums for the ratios, the way Ads Manager's
  // "results from N" row does. Reach is people, not additive across rows, so it stays blank.
  const SUMMED = ["results", "impressions", "spend", "purchases", "purchase_value", "purchases_7d_click", "purchase_value_7d_click", "link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout"];
  const totals = rows.reduce((acc, row) => {
    for (const key of SUMMED) acc[key] = (acc[key] || 0) + (Number(row[key]) || 0);
    return acc;
  }, {});
  totals.roas = totals.spend > 0 ? totals.purchase_value / totals.spend : null;
  totals.cost_per_purchase = totals.purchases > 0 ? totals.spend / totals.purchases : null;
  totals.roas_7d_click = totals.spend > 0 ? totals.purchase_value_7d_click / totals.spend : null;
  totals.currency = rows[0]?.currency;
  const FOOTER_CELLS = {
    ...CELLS,
    delivery: () => "", objective: () => "", goal: () => "", creative: () => "", budget: () => "", end: () => "", reach: () => "",
    frequency: () => "", quality_ranking: () => "", engagement_rate_ranking: () => "", conversion_rate_ranking: () => "",
  };
  const erpLine = erp ? t("metaAdsManager.totals.erp", { orders: Number(erp.orders || 0).toLocaleString(locale), revenue: money(erp.revenue || 0, totals.currency) }) : "";

  const nameLabel = t(`metaAdsManager.columns.${level}`);
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(String(row.id)));
  const colCount = 3 + visible.length + 1;

  const secondLine = (row) => {
    if (level === "campaign") return row.is_draft ? "" : row.meta_id || "";
    if (level === "adset") return row.campaign_name || "";
    return row.adset_name || "";
  };

  const canDrill = level !== "ad";

  return (
    <div className="ma-table-scroll">
      <table className="ma-table">
        <thead>
          <tr>
            <th className="ma-col-check">
              <Checkbox
                aria-label={t("metaAdsManager.columns.selectAll")}
                checked={allSelected}
                onChange={(event) => onSelectAll(event.target.checked)}
              />
            </th>
            <th className="ma-col-toggle">{t("metaAdsManager.columns.toggle")}</th>
            <th className="ma-col-name">{nameLabel}</th>
            {visible.map((key) => (
              <th key={key}>{t(`metaAdsManager.columns.${key}`)}</th>
            ))}
            <th className="ma-col-actions"><span className="ma-sr-only">{t("metaAdsManager.columns.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length ? (
            <tr><td colSpan={colCount} className="ma-table__state"><LoadingState /></td></tr>
          ) : !rows.length ? (
            <tr><td colSpan={colCount} className="ma-table__state">{emptyText}</td></tr>
          ) : rows.map((row) => {
            const key = String(row.id);
            const pending = pendingIds.has(key);
            const thumb = row.thumbnail_url || row.image_url;
            const sub = secondLine(row);
            return (
              <tr key={key} className={selectedIds.has(key) ? "is-selected" : undefined}>
                <td className="ma-col-check">
                  <Checkbox aria-label={t("metaAdsManager.columns.select")} checked={selectedIds.has(key)} onChange={(event) => onSelect(key, event.target.checked)} />
                </td>
                <td className="ma-col-toggle">
                  {/* Meta refuses ACTIVE/PAUSED on an archived or deleted object, so no switch there. */}
                  {row.is_draft || ["ARCHIVED", "DELETED"].includes(String(row.status || "").toUpperCase()) ? (
                    <span className="ma-muted">{DASH}</span>
                  ) : (
                    <Switch
                      aria-label={isLiveOn(row) ? t("metaAdsManager.actions.turnOff") : t("metaAdsManager.actions.turnOn")}
                      checked={isLiveOn(row)}
                      disabled={!canManage || pending}
                      onChange={(event) => onToggleStatus(row, event.target.checked)}
                    />
                  )}
                </td>
                <td className="ma-col-name">
                  <div className="ma-name">
                    {level === "ad" ? (
                      <span className="ma-thumb" aria-hidden="true">{thumb ? <img src={thumb} alt="" loading="lazy" /> : null}</span>
                    ) : null}
                    <div className="ma-name__text">
                      {canDrill ? (
                        <button type="button" className="ma-name__link" onClick={() => onDrill(row)}>{row.name || DASH}</button>
                      ) : (
                        <span className="ma-name__plain">{row.name || DASH}</span>
                      )}
                      {sub ? <span className="ma-name__sub">{sub}</span> : null}
                    </div>
                  </div>
                </td>
                {visible.map((col) => (
                  <td key={col} className={`ma-col-${col}`}>{CELLS[col](row)}</td>
                ))}
                <td className="ma-col-actions">
                  <div className="ma-row-actions">
                    {!row.is_draft ? (
                      <IconButton icon={BarChart3} size="sm" label={t("metaAdsManager.actions.charts")} onClick={() => onCharts(row)} />
                    ) : null}
                    {canManage ? (
                      <>
                        <IconButton icon={Pencil} size="sm" label={t("metaAdsManager.actions.edit")} onClick={() => onEdit(row)} />
                        <IconButton icon={Copy} size="sm" label={t("metaAdsManager.actions.duplicate")} onClick={() => onDuplicate(row)} />
                        {row.is_draft ? (
                          <IconButton icon={Trash2} size="sm" label={t("metaAdsManager.actions.deleteDraft")} onClick={() => onDelete(row)} />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        {rows.length ? (
          <tfoot>
            <tr className="ma-totals">
              <td className="ma-col-check" />
              <td className="ma-col-toggle" />
              <td className="ma-col-name">
                <div className="ma-name__text">
                  <span className="ma-totals__label">{t("metaAdsManager.totals.label", { count: rows.length })}</span>
                  {erpLine ? <span className="ma-name__sub ma-totals__erp" title={t("metaAdsManager.totals.erpHint")}>{erpLine}</span> : null}
                </div>
              </td>
              {visible.map((col) => (
                <td key={col} className={`ma-col-${col}`}>{FOOTER_CELLS[col](totals)}</td>
              ))}
              <td className="ma-col-actions" />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
