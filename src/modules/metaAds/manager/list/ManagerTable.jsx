import { useTranslation } from "react-i18next";
import { BarChart3, Copy, Pencil, Trash2 } from "lucide-react";

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
}) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);

  // LTR isolate (LRI…PDI) keeps "50.00 USD" in that order inside Arabic text.
  const money = (value, currency) => `⁦${formatMoney(value, currency, locale)}⁩`;
  const compact = (value) => (isBlank(value) ? DASH : formatCompact(value, t, locale));

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
    spend: (row) => (isBlank(row.spend) ? DASH : money(row.spend, row.currency)),
    end: endText,
  };

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
                  {row.is_draft ? (
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
      </table>
    </div>
  );
}
