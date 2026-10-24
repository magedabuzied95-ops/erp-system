import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Pencil, Play, Plus, RefreshCw } from "lucide-react";

import {
  Button,
  EmptyState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableContainer,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
} from "../../shared/ui";
import ThemedSelect from "../../shared/ui/ThemedSelect";
import { AccountPicker, useGoogleAds } from "./GoogleAdsContext";
import { errorMessage, googleAdsApi, statusTone } from "./googleAdsApi";

const LEVELS = ["campaigns", "groups", "ads", "keywords", "assets", "products", "terms"];
const TOGGLE_KIND = { groups: "group", ads: "ad", assets: "asset", keywords: "keyword" };

// The row's own object for the chosen level, and the id Google knows it by.
const entityOf = (level, row) => {
  const entity = level === "campaigns" ? row.campaign
    : level === "groups" ? row.adGroup
      : level === "assets" ? row.assetGroup
        : level === "keywords" ? row.adGroupCriterion
          : level === "terms" ? row.searchTermView
            : level === "products" ? row.segments
              : row.adGroupAd;
  const id = level === "ads" ? entity?.ad?.id : entity?.id || entity?.criterionId || entity?.productItemId || entity?.searchTerm;
  const name = entity?.name || entity?.ad?.name || entity?.keyword?.text || entity?.productTitle || entity?.searchTerm || id;
  return { entity, id, name };
};

const metricsOf = (rows) => rows.reduce((sum, row) => {
  const m = row.metrics || {};
  sum.impressions += Number(m.impressions || 0);
  sum.clicks += Number(m.clicks || 0);
  sum.cost += Number(m.costMicros || 0) / 1e6;
  sum.conversions += Number(m.conversions || 0);
  sum.value += Number(m.conversionsValue || 0);
  return sum;
}, { impressions: 0, clicks: 0, cost: 0, conversions: 0, value: 0 });

// /google-ads — campaigns down to keywords and search terms with their numbers.
export default function ResultsPage() {
  const { label, manage, account, accountId, structure, refreshKey, busy, action, request, confirm, money, count } = useGoogleAds();
  const [level, setLevel] = useState("campaigns");
  const [days, setDays] = useState("30");
  const [campaign, setCampaign] = useState("");
  const [list, setList] = useState({ loading: true, rows: [], error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [budget, setBudget] = useState(null);
  const sequence = useRef(0);

  useEffect(() => { setCampaign(""); }, [accountId]);

  useEffect(() => {
    const current = ++sequence.current;
    setList((state) => ({ ...state, loading: true, error: null }));
    googleAdsApi.get(accountId, `/data?level=${level}&days=${days}${campaign ? `&campaign=${campaign}` : ""}`)
      .then((data) => { if (current === sequence.current) setList({ loading: false, rows: data?.rows || [], error: null }); })
      .catch((error) => { if (current === sequence.current) setList({ loading: false, rows: [], error }); });
  }, [accountId, level, days, campaign, refreshKey, reloadKey]);

  const levelItems = useMemo(() => LEVELS.map((key) => ({
    value: key,
    label: {
      campaigns: label("الحملات", "Campaigns"),
      groups: label("المجموعات", "Ad groups"),
      ads: label("الإعلانات", "Ads"),
      keywords: label("الكلمات المفتاحية", "Keywords"),
      assets: label("مجموعات Performance Max", "Performance Max groups"),
      products: label("المنتجات", "Products"),
      terms: label("عبارات البحث", "Search terms"),
    }[key],
  })), [label]);

  const statusLabel = (status) => ({
    ENABLED: label("شغالة", "Enabled"),
    PAUSED: label("موقوفة", "Paused"),
    REMOVED: label("محذوفة", "Removed"),
  }[status] || status);

  const toggle = (row) => {
    const { entity, id, name } = entityOf(level, row);
    const next = entity.status === "ENABLED" ? "PAUSED" : "ENABLED";
    const starting = next === "ENABLED";
    confirm({
      title: starting ? label("تشغيل", "Enable") : label("إيقاف", "Pause"),
      body: level === "campaigns" && starting
        ? label(`تشغيل الحملة "${name}" هيبدأ الصرف حسب الميزانية.`, `Enabling "${name}" starts spending against its budget.`)
        : label(`تأكيد تغيير حالة "${name}"؟`, `Change the status of "${name}"?`),
      confirmLabel: starting ? label("تشغيل", "Enable") : label("إيقاف", "Pause"),
      danger: !starting,
      onConfirm: () => (level === "campaigns"
        ? action(() => googleAdsApi.post(accountId, `/campaigns/${id}`, { status: next }))
        : request("/entities/status", { kind: TOGGLE_KIND[level], id, group: row.adGroup?.id, status: next })),
    });
  };

  const saveBudget = async () => {
    const ok = await action(() => googleAdsApi.post(accountId, `/campaigns/${budget.id}/budget`, { amount: budget.amount }));
    if (ok) setBudget(null);
  };

  const showBudget = level === "campaigns";
  const canToggle = manage && (level === "campaigns" || TOGGLE_KIND[level]);
  const showStatus = level !== "products" && level !== "terms";
  const totals = metricsOf(list.rows);

  const metricCells = (m) => (
    <>
      <TableCell numeric>{money(m.cost)}</TableCell>
      <TableCell numeric>{count(m.impressions)}</TableCell>
      <TableCell numeric>{count(m.clicks)}</TableCell>
      <TableCell numeric>{m.impressions ? `${count((m.clicks / m.impressions) * 100, 2)}%` : "—"}</TableCell>
      <TableCell numeric>{count(m.conversions, 2)}</TableCell>
      <TableCell numeric>{money(m.value)}</TableCell>
      <TableCell numeric>{m.cost ? count(m.value / m.cost, 2) : "—"}</TableCell>
    </>
  );

  return (
    <div className="tiktok-ads-page google-ads-page">
      <PageHeader
        title={label("إعلانات جوجل", "Google Ads")}
        description={label("حملات البحث وإعلانات منتجات المتجر ونتايجها.", "Search and retail campaigns and how they perform.")}
        actions={(
          <>
            <Button icon={RefreshCw} loading={list.loading} onClick={() => setReloadKey((key) => key + 1)}>{label("تحديث النتائج", "Refresh")}</Button>
            {manage ? <Link className="m1-button m1-button--primary m1-button--md" to="/google-ads/create"><Plus size={17} aria-hidden="true" /><span>{label("إنشاء حملة", "Create campaign")}</span></Link> : null}
          </>
        )}
      />

      <div className="tiktok-ads-toolbar">
        <AccountPicker />
        <div className="tiktok-ads-presets" role="group" aria-label={label("الفترة", "Period")}>
          {["7", "30"].map((preset) => (
            <button
              key={preset}
              type="button"
              className={`tiktok-ads-presets__item${days === preset ? " is-active" : ""}`}
              aria-pressed={days === preset}
              onClick={() => setDays(preset)}
            >
              {preset === "7" ? label("آخر ٧ أيام", "Last 7 days") : label("آخر ٣٠ يوم", "Last 30 days")}
            </button>
          ))}
        </div>
        {level !== "campaigns" ? (
          <ThemedSelect
            value={campaign}
            onChange={setCampaign}
            options={[{ value: "", label: label("كل الحملات", "All campaigns") }, ...structure.campaigns.map((item) => ({ value: String(item.id), label: item.name }))]}
            ariaLabel={label("الحملة", "Campaign")}
          />
        ) : null}
      </div>

      <Tabs value={level} onChange={setLevel} items={levelItems} ariaLabel={label("المستوى", "Level")} />

      {list.error ? <div className="tiktok-ads-notice tiktok-ads-notice--danger">{errorMessage(list.error)}</div> : null}

      {list.loading && !list.rows.length ? <LoadingState /> : !list.rows.length ? (
        <EmptyState
          title={label("مفيش نتايج في الفترة دي", "No results for this period")}
          description={label("جرّب فترة أطول أو مستوى تاني.", "Try a longer period or another level.")}
        />
      ) : (
        <TableContainer>
          <Table density="compact" nowrap sticky>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{label("الاسم", "Name")}</TableHeaderCell>
                {showStatus ? <TableHeaderCell>{label("الحالة", "Status")}</TableHeaderCell> : null}
                {showBudget ? <TableHeaderCell numeric>{label("الميزانية اليومية", "Daily budget")}</TableHeaderCell> : null}
                <TableHeaderCell numeric>{label("التكلفة", "Cost")}</TableHeaderCell>
                <TableHeaderCell numeric>{label("الظهور", "Impressions")}</TableHeaderCell>
                <TableHeaderCell numeric>{label("النقرات", "Clicks")}</TableHeaderCell>
                <TableHeaderCell numeric>{label("نسبة النقر", "CTR")}</TableHeaderCell>
                <TableHeaderCell numeric>{label("التحويلات", "Conversions")}</TableHeaderCell>
                <TableHeaderCell numeric>{label("قيمة التحويلات", "Conv. value")}</TableHeaderCell>
                <TableHeaderCell numeric>{label("العائد", "ROAS")}</TableHeaderCell>
                {canToggle ? <TableHeaderCell /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {list.rows.map((row) => {
                const { entity, id, name } = entityOf(level, row);
                const m = metricsOf([row]);
                const amount = Number(row.campaignBudget?.amountMicros || 0) / 1e6;
                return (
                  <TableRow key={`${row.campaign?.id}-${row.adGroup?.id}-${id}`}>
                    <TableCell><span className="tiktok-ads-name" title={String(name || "")}>{name}</span></TableCell>
                    {showStatus ? (
                      <TableCell>{entity?.status ? <StatusBadge tone={statusTone(entity.status)}>{statusLabel(entity.status)}</StatusBadge> : "—"}</TableCell>
                    ) : null}
                    {showBudget ? <TableCell numeric>{amount ? money(amount) : "—"}</TableCell> : null}
                    {metricCells(m)}
                    {canToggle ? (
                      <TableCell actions>
                        <TableActions>
                          <Button size="sm" variant="ghost" icon={entity?.status === "ENABLED" ? Pause : Play} disabled={busy} onClick={() => toggle(row)}>
                            {entity?.status === "ENABLED" ? label("إيقاف", "Pause") : label("تشغيل", "Enable")}
                          </Button>
                          {showBudget ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Pencil}
                              disabled={busy || row.campaignBudget?.explicitlyShared}
                              title={row.campaignBudget?.explicitlyShared ? label("ميزانية مشتركة بين أكتر من حملة", "Shared budget") : undefined}
                              onClick={() => setBudget({ id, name, amount: String(amount || "") })}
                            >
                              {label("الميزانية", "Budget")}
                            </Button>
                          ) : null}
                        </TableActions>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFoot>
              <TableRow>
                <TableCell>{label("الإجمالي", "Total")}</TableCell>
                {showStatus ? <TableCell /> : null}
                {showBudget ? <TableCell /> : null}
                {metricCells(totals)}
                {canToggle ? <TableCell /> : null}
              </TableRow>
            </TableFoot>
          </Table>
        </TableContainer>
      )}

      <Modal
        open={Boolean(budget)}
        size="sm"
        title={label("الميزانية اليومية", "Daily budget")}
        description={budget?.name}
        onClose={() => setBudget(null)}
        footer={(
          <>
            <Button onClick={() => setBudget(null)}>{label("إلغاء", "Cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!(Number(budget?.amount) > 0)} onClick={saveBudget}>{label("حفظ الميزانية", "Save budget")}</Button>
          </>
        )}
      >
        <Input
          type="number"
          min="0.01"
          step="0.01"
          label={label(`المبلغ بعملة الحساب (${account?.currencyCode || ""})`, `Amount in account currency (${account?.currencyCode || ""})`)}
          value={budget?.amount ?? ""}
          onChange={(event) => setBudget((current) => ({ ...current, amount: event.target.value }))}
        />
      </Modal>
    </div>
  );
}
