import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, ExternalLink, Link2, Link2Off, PlugZap, RefreshCw, ShieldAlert, Wand2 } from "lucide-react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  LoadingState,
  MetricCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
} from "../../shared/ui";
import { hasPermission } from "../../shared/auth/authStorage";
import {
  MAPPING_STATUS_TONES,
  ORDER_STATUS_TONES,
  RUN_STATUS_TONES,
  amazonApi,
  formatDateTime,
  formatMoney,
  isForbiddenError,
  isMfaRequiredError,
} from "./amazonApi";

const AMAZON_TABS = ["dashboard", "orders", "products", "inventory", "pricing", "listings", "sku-mapping", "sync-logs", "settings"];
const PAGE_SIZE = 50;

const useLocale = () => {
  const { i18n } = useTranslation();
  return i18n.language === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
};

const canManageAmazon = () => hasPermission("amazon.manage");

// ------------------------------------------------------------------ shared pieces
function AccessNotice({ error }) {
  const { t } = useTranslation();
  if (isMfaRequiredError(error)) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-3">
          <StatusBadge tone="warning"><ShieldAlert size={14} /> {t("amazon.access.mfaTitle")}</StatusBadge>
          <p className="text-sm text-[var(--muted)]">{t("amazon.access.mfaBody")}</p>
          <Link className="m1-button m1-button--primary m1-button--md" to="/settings/account-security">{t("amazon.access.mfaAction")}</Link>
        </div>
      </Card>
    );
  }
  if (isForbiddenError(error)) {
    return <EmptyState title={t("amazon.access.deniedTitle")} description={t("amazon.access.deniedBody")} />;
  }
  if (error?.status === 503) {
    return <EmptyState title={t("amazon.access.notReadyTitle")} description={t("amazon.access.notReadyBody")} />;
  }
  return <EmptyState title={t("amazon.common.loadFailed")} description={error?.message || ""} />;
}

function useAmazonResource(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await loader();
      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SyncButton({ job, label, onStarted }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!canManageAmazon()) return null;
  const start = async () => {
    setBusy(true);
    try {
      await amazonApi.startSync(job);
      toast.success(t("amazon.sync.jobStarted"));
      onStarted?.();
    } catch (error) {
      toast.error(error?.responseBody?.code === "SYNC_ALREADY_RUNNING" ? t("amazon.sync.alreadyRunning") : error?.message || t("amazon.common.actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  return <Button icon={RefreshCw} loading={busy} onClick={start}>{label}</Button>;
}

function Pager({ page, hasMore, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{t("amazon.common.previous")}</Button>
      <span className="text-sm text-[var(--muted)]">{t("amazon.common.page", { page })}</span>
      <Button size="sm" disabled={!hasMore} onClick={() => onChange(page + 1)}>{t("amazon.common.next")}</Button>
    </div>
  );
}

const statusLabel = (t, group, value) => (value ? t(`amazon.${group}.${String(value).toLowerCase()}`, { defaultValue: String(value) }) : "—");

// ------------------------------------------------------------------ dashboard
function DashboardTab() {
  const { t } = useTranslation();
  const locale = useLocale();
  const resource = useAmazonResource(() => amazonApi.dashboard());
  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error) return <AccessNotice error={resource.error} />;
  const { dashboard, status } = resource.data;
  const connection = status.connection || {};
  const currency = dashboard.revenue.currency_code;
  const sync = status.sync || {};
  const unhealthy = Object.values(sync).filter((run) => run.status === "failed").length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("amazon.dashboard.connection")} value={statusLabel(t, "connection", connection.status)} tone={connection.status === "connected" ? "success" : "warning"} supporting={`${status.marketplace.name} · ${status.marketplace.id}`} />
        <MetricCard label={t("amazon.dashboard.ordersToday")} value={dashboard.orders.today} supporting={t("amazon.dashboard.last30", { count: dashboard.orders.last_30_days })} />
        <MetricCard label={t("amazon.dashboard.pending")} value={dashboard.orders.pending} tone={dashboard.orders.pending ? "warning" : "neutral"} />
        <MetricCard label={t("amazon.dashboard.unshipped")} value={dashboard.orders.unshipped} tone={dashboard.orders.late_to_ship ? "danger" : "neutral"} supporting={dashboard.orders.late_to_ship ? t("amazon.dashboard.lateToShip", { count: dashboard.orders.late_to_ship }) : null} />
        <MetricCard label={t("amazon.dashboard.revenueToday")} value={formatMoney(dashboard.revenue.today, currency, locale)} supporting={t("amazon.dashboard.revenue30", { value: formatMoney(dashboard.revenue.last_30_days, currency, locale) })} />
        <MetricCard label={t("amazon.dashboard.mappedSkus")} value={dashboard.skus.mapped} tone="success" />
        <MetricCard label={t("amazon.dashboard.unmappedSkus")} value={dashboard.skus.unmapped + dashboard.skus.conflict + dashboard.skus.missing_m1_sku} tone={dashboard.skus.conflict ? "danger" : "warning"} supporting={t("amazon.dashboard.conflicts", { count: dashboard.skus.conflict })} />
        <MetricCard label={t("amazon.dashboard.listingErrors")} value={dashboard.listings.listing_errors} tone={dashboard.listings.listing_errors ? "danger" : "neutral"} supporting={t("amazon.dashboard.listingsCount", { count: dashboard.listings.listings })} />
      </div>
      <Card title={t("amazon.dashboard.syncHealth")} subtitle={unhealthy ? t("amazon.dashboard.syncUnhealthy", { count: unhealthy }) : t("amazon.dashboard.syncHealthy")}>
        <DataTable
          rowKey="job"
          columns={[
            { key: "job", label: t("amazon.sync.job"), render: (row) => t(`amazon.jobs.${row.job}`, { defaultValue: row.job }) },
            { key: "status", label: t("amazon.common.status"), render: (row) => (row.status ? <StatusBadge tone={RUN_STATUS_TONES[row.status] || "neutral"}>{statusLabel(t, "runStatus", row.status)}</StatusBadge> : t("amazon.sync.never")) },
            { key: "finished_at", label: t("amazon.sync.lastRun"), render: (row) => formatDateTime(row.finished_at || row.started_at, locale) },
            { key: "records", label: t("amazon.sync.records"), render: (row) => (row.status ? `${row.records_read ?? 0} / ${row.records_failed ?? 0}` : "—") },
          ]}
          rows={["orders", "listings", "inventory", "pricing"].map((job) => ({ job, ...(sync[job] || {}) }))}
        />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ orders
function OrdersTab() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [fulfilledBy, setFulfilledBy] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const term = useDebounced(search);
  useEffect(() => setPage(1), [term, status, fulfilledBy, from, to]);
  const resource = useAmazonResource(
    () => amazonApi.orders({ search: term, status, fulfilled_by: fulfilledBy, from, to, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    [term, status, fulfilledBy, from, to, page]
  );
  if (resource.error) return <AccessNotice error={resource.error} />;
  const orders = resource.data?.orders || [];
  const total = resource.data?.total || 0;
  return (
    <div className="space-y-3">
      <FilterBar actions={<SyncButton job="orders" label={t("amazon.sync.syncOrders")} onStarted={() => setTimeout(resource.reload, 4000)} />}>
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} placeholder={t("amazon.orders.searchPlaceholder")} aria-label={t("amazon.orders.searchPlaceholder")} />
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t("amazon.common.status")}>
          <option value="">{t("amazon.orders.allStatuses")}</option>
          {["PENDING", "UNSHIPPED", "PARTIALLY_SHIPPED", "SHIPPED", "CANCELLED", "UNFULFILLABLE"].map((value) => <option key={value} value={value}>{statusLabel(t, "orderStatus", value)}</option>)}
        </Select>
        <Select value={fulfilledBy} onChange={(event) => setFulfilledBy(event.target.value)} aria-label={t("amazon.orders.fulfilledBy")}>
          <option value="">{t("amazon.orders.allChannels")}</option>
          <option value="MERCHANT">{t("amazon.fulfillment.merchant")}</option>
          <option value="AMAZON">{t("amazon.fulfillment.amazon")}</option>
        </Select>
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label={t("amazon.orders.from")} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label={t("amazon.orders.to")} />
      </FilterBar>
      <p className="text-sm text-[var(--muted)]">{t("amazon.orders.readOnlyNote")} · {t("amazon.common.totalCount", { count: total })}</p>
      <DataTable
        loading={resource.loading}
        onRowClick={(row) => setOpen(row)}
        columns={[
          { key: "amazon_order_id", label: t("amazon.orders.orderId") },
          { key: "created_time", label: t("amazon.orders.date"), render: (row) => formatDateTime(row.created_time, locale) },
          { key: "fulfillment_status", label: t("amazon.common.status"), render: (row) => <StatusBadge tone={ORDER_STATUS_TONES[row.fulfillment_status] || "neutral"}>{statusLabel(t, "orderStatus", row.fulfillment_status)}</StatusBadge> },
          { key: "fulfilled_by", label: t("amazon.orders.fulfilledBy"), render: (row) => statusLabel(t, "fulfillment", row.fulfilled_by) },
          { key: "items", label: t("amazon.orders.items"), render: (row) => `${row.items_ordered} (${t("amazon.orders.shippedShort", { count: row.items_shipped })})` },
          { key: "mapping", label: t("amazon.orders.mapping"), render: (row) => {
            const unmapped = (row.items || []).filter((item) => !item.mapped_variant_id).length;
            return unmapped ? <StatusBadge tone="warning">{t("amazon.orders.unmappedItems", { count: unmapped })}</StatusBadge> : <StatusBadge tone="success">{t("amazon.mappingStatus.mapped")}</StatusBadge>;
          } },
          { key: "order_total", label: t("amazon.orders.total"), numeric: true, render: (row) => formatMoney(row.order_total, row.currency_code, locale) },
          { key: "m1", label: t("amazon.orders.m1Order"), render: (row) => (row.m1_order_id ? <Link to={`/orders?search=${encodeURIComponent(row.m1_invoice_number || row.m1_order_id)}`} onClick={(event) => event.stopPropagation()}>{row.m1_invoice_number || `#${row.m1_order_id}`}</Link> : "—") },
        ]}
        rows={orders}
        emptyLabel={t("amazon.orders.empty")}
      />
      <Pager page={page} hasMore={page * PAGE_SIZE < total} onChange={setPage} />
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} size="lg" title={open ? t("amazon.orders.detailTitle", { id: open.amazon_order_id }) : ""} description={open ? `${statusLabel(t, "orderStatus", open.fulfillment_status)} · ${formatDateTime(open.created_time, locale)}` : ""}>
        {open ? (
          <div className="space-y-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>{t("amazon.orders.fulfilledBy")}: <b>{statusLabel(t, "fulfillment", open.fulfilled_by)}</b></div>
              <div>{t("amazon.orders.serviceLevel")}: <b>{open.fulfillment_service_level || "—"}</b></div>
              <div>{t("amazon.orders.shipBy")}: <b>{formatDateTime(open.ship_by_latest, locale)}</b></div>
              <div>{t("amazon.orders.lastUpdated")}: <b>{formatDateTime(open.last_updated_time, locale)}</b></div>
              {open.has_cancellation_request ? <div className="sm:col-span-2"><StatusBadge tone="danger"><AlertTriangle size={13} /> {t("amazon.orders.cancellationRequested")}</StatusBadge></div> : null}
            </div>
            <DataTable
              rowKey="order_item_id"
              columns={[
                { key: "seller_sku", label: t("amazon.common.sellerSku") },
                { key: "title", label: t("amazon.common.title"), render: (item) => (
                  <span className="inline-flex items-center gap-1">{item.title || "—"}{item.amazon_url ? <a href={item.amazon_url} target="_blank" rel="noreferrer noopener" aria-label={t("amazon.title")}><ExternalLink size={13} /></a> : null}</span>
                ) },
                { key: "m1", label: t("amazon.common.m1Item"), render: (item) => (item.mapped_variant_id ? `${item.product_name || ""} · ${[item.color, item.size].filter(Boolean).join(" / ")} (${item.m1_sku || ""})` : <StatusBadge tone="warning">{t("amazon.mappingStatus.unmapped")}</StatusBadge>) },
                { key: "quantity_ordered", label: t("amazon.orders.quantity"), numeric: true, render: (item) => `${item.quantity_ordered} / ${item.quantity_fulfilled}` },
                { key: "unit_price", label: t("amazon.orders.price"), numeric: true, render: (item) => formatMoney(item.unit_price, item.currency_code, locale) },
              ]}
              rows={open.items || []}
            />
            <p className="text-xs text-[var(--muted)]">{t("amazon.orders.piiNote")}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ generic listing-based tabs
function ListingTable({ kind }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [issuesFor, setIssuesFor] = useState(null);
  const term = useDebounced(search);
  useEffect(() => setPage(1), [term]);
  const loaders = {
    listings: () => amazonApi.listings({ search: term, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).then((data) => data.listings),
    inventory: () => amazonApi.inventory({ search: term, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).then((data) => data.inventory),
    pricing: () => amazonApi.pricing({ search: term, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).then((data) => data.pricing),
    products: () => amazonApi.products({ search: term, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).then((data) => data.products),
  };
  const resource = useAmazonResource(loaders[kind], [kind, term, page]);
  if (resource.error) return <AccessNotice error={resource.error} />;
  const rows = resource.data || [];
  const mappingBadge = (row) => <StatusBadge tone={MAPPING_STATUS_TONES[row.mapping_status] || "neutral"}>{statusLabel(t, "mappingStatus", row.mapping_status || "unmapped")}</StatusBadge>;
  const diffCell = (value, money = false) => {
    if (value === null || value === undefined) return "—";
    const tone = Number(value) === 0 ? "success" : "warning";
    return <StatusBadge tone={tone}>{money ? formatMoney(value, "EGP", locale) : Number(value) > 0 ? `+${value}` : value}</StatusBadge>;
  };
  const m1Cell = (row) => (row.m1_sku ? `${row.product_name || ""} · ${[row.color, row.size].filter(Boolean).join(" / ")} (${row.m1_sku})` : "—");

  const columns = {
    listings: [
      { key: "seller_sku", label: t("amazon.common.sellerSku") },
      { key: "asin", label: "ASIN", render: (row) => (row.amazon_url ? <a href={row.amazon_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">{row.asin}<ExternalLink size={12} /></a> : row.asin || "—") },
      { key: "title", label: t("amazon.common.title") },
      { key: "listing_status", label: t("amazon.common.status"), render: (row) => <StatusBadge tone={String(row.listing_status).toLowerCase() === "active" ? "success" : "warning"}>{row.listing_status || "—"}</StatusBadge> },
      { key: "issues", label: t("amazon.listings.issues"), render: (row) => (row.issue_count ? <Button size="sm" variant="ghost" onClick={() => setIssuesFor(row)}>{t("amazon.listings.issueCount", { count: row.issue_count, errors: row.error_count })}</Button> : row.issues_synced_at ? t("amazon.listings.noIssues") : "—") },
      { key: "price", label: t("amazon.orders.price"), numeric: true, render: (row) => formatMoney(row.price, row.currency_code, locale) },
      { key: "quantity", label: t("amazon.orders.quantity"), numeric: true, render: (row) => row.quantity ?? row.fba_fulfillable ?? "—" },
      { key: "mapping_status", label: t("amazon.orders.mapping"), render: mappingBadge },
      { key: "last_synced_at", label: t("amazon.common.lastSynced"), render: (row) => formatDateTime(row.last_synced_at, locale) },
    ],
    inventory: [
      { key: "seller_sku", label: t("amazon.common.sellerSku") },
      { key: "m1", label: t("amazon.common.m1Item"), render: m1Cell },
      { key: "fulfillment", label: t("amazon.orders.fulfilledBy"), render: (row) => statusLabel(t, "fulfillment", row.fulfillment) },
      { key: "amazon_quantity", label: t("amazon.inventory.amazonQuantity"), numeric: true, render: (row) => row.amazon_quantity ?? "—" },
      { key: "m1_available", label: t("amazon.inventory.m1Available"), numeric: true, render: (row) => row.m1_available ?? "—" },
      { key: "difference", label: t("amazon.common.difference"), numeric: true, render: (row) => diffCell(row.difference) },
      { key: "mapping_status", label: t("amazon.orders.mapping"), render: mappingBadge },
      { key: "last_synced_at", label: t("amazon.common.lastSynced"), render: (row) => formatDateTime(row.last_synced_at, locale) },
    ],
    pricing: [
      { key: "seller_sku", label: t("amazon.common.sellerSku") },
      { key: "m1", label: t("amazon.common.m1Item"), render: m1Cell },
      { key: "m1_price", label: t("amazon.pricing.m1Price"), numeric: true, render: (row) => formatMoney(row.m1_price, "EGP", locale) },
      { key: "amazon_price", label: t("amazon.pricing.amazonPrice"), numeric: true, render: (row) => formatMoney(row.amazon_price, row.currency_code, locale) },
      { key: "difference", label: t("amazon.common.difference"), numeric: true, render: (row) => diffCell(row.difference, true) },
      { key: "mapping_status", label: t("amazon.orders.mapping"), render: mappingBadge },
      { key: "last_update", label: t("amazon.pricing.lastUpdate"), render: (row) => formatDateTime(row.last_update, locale) },
    ],
    products: [
      { key: "product_name", label: t("amazon.products.product") },
      { key: "variant", label: t("amazon.products.variant"), render: (row) => [row.color, row.size].filter(Boolean).join(" / ") || "—" },
      { key: "sku", label: t("amazon.common.m1Sku") },
      { key: "stock", label: t("amazon.inventory.m1Available"), numeric: true },
      { key: "seller_sku", label: t("amazon.common.sellerSku"), render: (row) => row.seller_sku || <StatusBadge tone="neutral">{t("amazon.products.notOnAmazon")}</StatusBadge> },
      { key: "listing_status", label: t("amazon.common.status"), render: (row) => row.listing_status || "—" },
      { key: "amazon_price", label: t("amazon.pricing.amazonPrice"), numeric: true, render: (row) => (row.amazon_price ? formatMoney(row.amazon_price, "EGP", locale) : "—") },
    ],
  }[kind];

  const syncFor = {
    listings: <SyncButton job="listings" label={t("amazon.sync.syncListings")} onStarted={() => setTimeout(resource.reload, 8000)} />,
    inventory: <><SyncButton job="listings" label={t("amazon.sync.syncListings")} /><SyncButton job="inventory" label={t("amazon.sync.syncInventory")} onStarted={() => setTimeout(resource.reload, 6000)} /></>,
    pricing: <SyncButton job="pricing" label={t("amazon.sync.syncPricing")} onStarted={() => setTimeout(resource.reload, 8000)} />,
    products: null,
  }[kind];

  return (
    <div className="space-y-3">
      <FilterBar actions={syncFor}>
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} placeholder={t("amazon.common.searchSku")} aria-label={t("amazon.common.searchSku")} />
      </FilterBar>
      {kind !== "products" ? <p className="text-sm text-[var(--muted)]">{t(`amazon.${kind}.note`)}</p> : null}
      <DataTable loading={resource.loading} rowKey={(row, index) => `${row.seller_sku || row.variant_id || index}`} columns={columns} rows={rows} emptyLabel={t(`amazon.${kind}.empty`)} />
      <Pager page={page} hasMore={rows.length === PAGE_SIZE} onChange={setPage} />
      <Modal open={Boolean(issuesFor)} onClose={() => setIssuesFor(null)} title={issuesFor ? t("amazon.listings.issuesTitle", { sku: issuesFor.seller_sku }) : ""}>
        <ul className="space-y-2 text-sm">
          {(issuesFor?.issues || []).map((issue, index) => (
            <li key={`${issue.code}-${index}`} className="rounded-[var(--radius-control)] border border-[var(--border)] p-2">
              <StatusBadge tone={issue.severity === "ERROR" ? "danger" : "warning"}>{issue.severity} · {issue.code}</StatusBadge>
              <p className="mt-1">{issue.message}</p>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ SKU mapping
function SkuMappingTab() {
  const { t } = useTranslation();
  const manage = canManageAmazon();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const term = useDebounced(search);
  useEffect(() => setPage(1), [term, status]);
  const resource = useAmazonResource(
    () => amazonApi.skuMappings({ status, search: term, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    [status, term, page]
  );
  if (resource.error) return <AccessNotice error={resource.error} />;
  const rows = resource.data?.rows || [];
  const totals = resource.data?.totals || {};

  const run = async (fn, successKey) => {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(t(successKey, { count: result?.result?.accepted ?? result?.result?.suggested ?? 0 }));
      resource.reload();
    } catch (error) {
      toast.error(error?.message || t("amazon.common.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {["mapped", "unmapped", "conflict", "missing_m1_sku"].map((key) => (
          <MetricCard key={key} density="compact" label={statusLabel(t, "mappingStatus", key)} value={totals[key] || 0} tone={MAPPING_STATUS_TONES[key]} />
        ))}
      </div>
      <FilterBar
        actions={manage ? (
          <>
            <Button icon={RefreshCw} disabled={busy} onClick={() => run(amazonApi.refreshSuggestions, "amazon.mapping.suggestionsRefreshed")}>{t("amazon.mapping.refreshSuggestions")}</Button>
            <Button icon={Wand2} variant="primary" disabled={busy} onClick={() => { if (window.confirm(t("amazon.mapping.acceptExactConfirm"))) run(amazonApi.acceptExactSuggestions, "amazon.mapping.acceptedCount"); }}>{t("amazon.mapping.acceptExact")}</Button>
          </>
        ) : null}
      >
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} placeholder={t("amazon.common.searchSku")} aria-label={t("amazon.common.searchSku")} />
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t("amazon.common.status")}>
          <option value="">{t("amazon.mapping.allStatuses")}</option>
          {["mapped", "unmapped", "conflict", "missing_m1_sku"].map((key) => <option key={key} value={key}>{statusLabel(t, "mappingStatus", key)}</option>)}
        </Select>
      </FilterBar>
      <p className="text-sm text-[var(--muted)]">{t("amazon.mapping.note")}</p>
      <DataTable
        loading={resource.loading}
        columns={[
          { key: "seller_sku", label: t("amazon.common.sellerSku") },
          { key: "asin", label: "ASIN", render: (row) => row.asin || "—" },
          { key: "amazon_title", label: t("amazon.common.title"), render: (row) => row.amazon_title || "—" },
          { key: "m1", label: t("amazon.common.m1Item"), render: (row) => (row.variant_id ? `${row.product_name || ""} · ${[row.color, row.size].filter(Boolean).join(" / ")} (${row.m1_sku || "—"})` : row.suggested_variant_id ? <span className="text-[var(--muted)]">{t("amazon.mapping.suggested", { item: `${row.suggested_product_name || ""} · ${[row.suggested_color, row.suggested_size].filter(Boolean).join(" / ")} (${row.suggested_sku})`, method: t(`amazon.mapping.method.${row.suggestion_method}`, { defaultValue: row.suggestion_method }) })}</span> : row.status === "conflict" ? t("amazon.mapping.candidates", { count: row.candidate_count }) : "—") },
          { key: "status", label: t("amazon.common.status"), render: (row) => <StatusBadge tone={MAPPING_STATUS_TONES[row.status] || "neutral"}>{statusLabel(t, "mappingStatus", row.status)}</StatusBadge> },
          ...(manage ? [{
            key: "actions",
            label: "",
            actions: true,
            render: (row) => (
              <div className="flex gap-1">
                <Button size="sm" icon={Link2} onClick={() => setEditing(row)}>{row.variant_id ? t("amazon.mapping.change") : t("amazon.mapping.map")}</Button>
                {row.variant_id ? <Button size="sm" variant="ghost" icon={Link2Off} disabled={busy} onClick={() => { if (window.confirm(t("amazon.mapping.unmapConfirm", { sku: row.seller_sku }))) run(() => amazonApi.unmapSku(row.id), "amazon.mapping.unmapped"); }}>{t("amazon.mapping.unmap")}</Button> : null}
              </div>
            ),
          }] : []),
        ]}
        rows={rows}
        emptyLabel={t("amazon.mapping.empty")}
      />
      <Pager page={page} hasMore={rows.length === PAGE_SIZE} onChange={setPage} />
      {editing ? <MapSkuModal mapping={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); resource.reload(); }} /> : null}
    </div>
  );
}

function MapSkuModal({ mapping, onClose, onSaved }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(mapping.suggested_sku || mapping.seller_sku || "");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(mapping.suggested_variant_id || null);
  const [saving, setSaving] = useState(false);
  const term = useDebounced(query);
  const requestRef = useRef(0);
  useEffect(() => {
    const id = ++requestRef.current;
    if (String(term).trim().length < 2) {
      setResults([]);
      return;
    }
    amazonApi.searchVariants(term).then((data) => {
      if (id === requestRef.current) setResults(data.variants || []);
    }).catch(() => setResults([]));
  }, [term]);
  const save = async () => {
    setSaving(true);
    try {
      await amazonApi.mapSku(mapping.id, selected);
      toast.success(t("amazon.mapping.saved"));
      onSaved();
    } catch (error) {
      toast.error(error?.message || t("amazon.common.actionFailed"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t("amazon.mapping.modalTitle", { sku: mapping.seller_sku })}
      description={mapping.amazon_title || ""}
      footer={<><Button onClick={onClose}>{t("amazon.common.cancel")}</Button><Button variant="primary" disabled={!selected} loading={saving} onClick={save}>{t("amazon.mapping.confirmMap")}</Button></>}
    >
      <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder={t("amazon.mapping.searchM1")} aria-label={t("amazon.mapping.searchM1")} />
      <div className="mt-3 max-h-80 overflow-y-auto">
        <DataTable
          rowKey="variant_id"
          density="compact"
          isRowSelected={(row) => row.variant_id === selected}
          onRowClick={(row) => { if (!row.already_mapped || row.variant_id === mapping.variant_id) setSelected(row.variant_id); }}
          columns={[
            { key: "product_name", label: t("amazon.products.product") },
            { key: "variant", label: t("amazon.products.variant"), render: (row) => [row.color, row.size].filter(Boolean).join(" / ") },
            { key: "sku", label: t("amazon.common.m1Sku") },
            { key: "stock", label: t("amazon.inventory.m1Available"), numeric: true },
            { key: "state", label: "", render: (row) => (row.variant_id === selected ? <StatusBadge tone="success">{t("amazon.mapping.selected")}</StatusBadge> : row.already_mapped ? <StatusBadge tone="neutral">{t("amazon.mapping.alreadyMapped")}</StatusBadge> : null) },
          ]}
          rows={results}
          emptyLabel={t("amazon.mapping.noResults")}
        />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ sync logs
function SyncLogsTab() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [job, setJob] = useState("");
  const resource = useAmazonResource(() => amazonApi.syncRuns({ job_type: job, limit: 100 }), [job]);
  const running = (resource.data?.runs || []).some((run) => run.status === "running");
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(resource.reload, 10000);
    return () => clearInterval(timer);
  }, [running, resource.reload]);
  if (resource.error) return <AccessNotice error={resource.error} />;
  return (
    <div className="space-y-3">
      <FilterBar actions={<Button icon={RefreshCw} onClick={resource.reload}>{t("amazon.common.refresh")}</Button>}>
        <Select value={job} onChange={(event) => setJob(event.target.value)} aria-label={t("amazon.sync.job")}>
          <option value="">{t("amazon.sync.allJobs")}</option>
          {["orders", "listings", "inventory", "pricing"].map((key) => <option key={key} value={key}>{t(`amazon.jobs.${key}`)}</option>)}
        </Select>
      </FilterBar>
      <DataTable
        loading={resource.loading}
        columns={[
          { key: "id", label: "#" },
          { key: "job_type", label: t("amazon.sync.job"), render: (row) => t(`amazon.jobs.${row.job_type}`, { defaultValue: row.job_type }) },
          { key: "trigger", label: t("amazon.sync.trigger"), render: (row) => t(`amazon.sync.triggers.${row.trigger}`, { defaultValue: row.trigger }) },
          { key: "status", label: t("amazon.common.status"), render: (row) => <StatusBadge tone={RUN_STATUS_TONES[row.status] || "neutral"}>{statusLabel(t, "runStatus", row.status)}</StatusBadge> },
          { key: "started_at", label: t("amazon.sync.started"), render: (row) => formatDateTime(row.started_at, locale) },
          { key: "finished_at", label: t("amazon.sync.finished"), render: (row) => formatDateTime(row.finished_at, locale) },
          { key: "counts", label: t("amazon.sync.counts"), render: (row) => t("amazon.sync.countsValue", { read: row.records_read, created: row.records_created, updated: row.records_updated, failed: row.records_failed }) },
          { key: "error", label: t("amazon.sync.error"), render: (row) => (row.error_category ? `${t(`amazon.errors.${row.error_category}`, { defaultValue: row.error_category })}: ${row.error_message || ""}` : "—") },
        ]}
        rows={resource.data?.runs || []}
        emptyLabel={t("amazon.sync.empty")}
      />
    </div>
  );
}

// ------------------------------------------------------------------ settings (also /settings/integrations/amazon)
export function AmazonSettingsPanel() {
  const { t } = useTranslation();
  const locale = useLocale();
  const manage = canManageAmazon();
  const resource = useAmazonResource(() => amazonApi.status());
  const [testing, setTesting] = useState(false);
  const [sellerId, setSellerId] = useState("");
  const [savingSeller, setSavingSeller] = useState(false);
  useEffect(() => {
    if (resource.data?.status) setSellerId(resource.data.status.seller_id || "");
  }, [resource.data]);
  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error) return <AccessNotice error={resource.error} />;
  const { status, scheduler } = resource.data;
  const connection = status.connection;
  const jobs = ["orders", "listings", "inventory", "pricing"];

  const test = async () => {
    setTesting(true);
    try {
      const { result } = await amazonApi.testConnection();
      if (result.ok) toast.success(t("amazon.settings.testOk"));
      else toast.error(t("amazon.settings.testFailed", { reason: result.error?.message || statusLabel(t, "connection", result.status) }));
      resource.reload();
    } catch (error) {
      toast.error(error?.message || t("amazon.common.actionFailed"));
    } finally {
      setTesting(false);
    }
  };
  const saveSeller = async () => {
    setSavingSeller(true);
    try {
      await amazonApi.saveSellerId(sellerId.trim());
      toast.success(t("amazon.settings.sellerSaved"));
      resource.reload();
    } catch (error) {
      toast.error(error?.message || t("amazon.common.actionFailed"));
    } finally {
      setSavingSeller(false);
    }
  };

  const row = (label, value) => (
    <div key={label} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-sm last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-end font-semibold">{value}</span>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("amazon.settings.connectionTitle")} action={manage ? <Button icon={PlugZap} loading={testing} onClick={test}>{t("amazon.settings.test")}</Button> : null}>
        {row(t("amazon.dashboard.connection"), <StatusBadge tone={connection.status === "connected" ? "success" : connection.status === "unknown" ? "neutral" : "danger"}>{statusLabel(t, "connection", connection.status)}</StatusBadge>)}
        {row(t("amazon.settings.marketplace"), `${status.marketplace.name} (${status.marketplace.country_code})`)}
        {row(t("amazon.settings.marketplaceId"), status.marketplace.id)}
        {row(t("amazon.settings.currency"), status.marketplace.currency_code)}
        {row(t("amazon.settings.authorization"), statusLabel(t, "authorization", connection.authorization_status))}
        {row(t("amazon.settings.credentials"), status.configured ? t("amazon.settings.credentialsStored") : t("amazon.settings.credentialsMissing"))}
        {row(t("amazon.settings.lastSuccess"), formatDateTime(connection.last_successful_api_request_at, locale))}
        {row(t("amazon.settings.lastChecked"), formatDateTime(connection.last_checked_at, locale))}
        {connection.last_error ? row(t("amazon.settings.lastError"), `${t(`amazon.errors.${connection.last_error.category}`, { defaultValue: connection.last_error.category })} · ${formatDateTime(connection.last_error_at, locale)}`) : null}
        <p className="mt-3 text-xs text-[var(--muted)]">{t("amazon.settings.secretsNote")}</p>
      </Card>

      <Card title={t("amazon.settings.syncTitle")}>
        {jobs.map((job) => {
          const run = status.sync?.[job];
          return row(
            t(`amazon.jobs.${job}`),
            <span className="inline-flex items-center gap-2">
              {run ? <StatusBadge tone={RUN_STATUS_TONES[run.status] || "neutral"}>{statusLabel(t, "runStatus", run.status)}</StatusBadge> : t("amazon.sync.never")}
              <span className="text-xs text-[var(--muted)]">{run ? formatDateTime(run.finished_at || run.started_at, locale) : ""}</span>
            </span>
          );
        })}
        {row(t("amazon.settings.autoSync"), status.flags.order_auto_sync ? t("amazon.settings.autoSyncOn", { minutes: status.flags.order_auto_sync_minutes }) : t("amazon.settings.off"))}
        {row(t("amazon.settings.projection"), status.flags.order_projection ? t("amazon.settings.on") : t("amazon.settings.off"))}
        {manage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <SyncButton job="orders" label={t("amazon.sync.syncOrders")} onStarted={resource.reload} />
            <SyncButton job="listings" label={t("amazon.sync.syncListings")} onStarted={resource.reload} />
            <SyncButton job="inventory" label={t("amazon.sync.syncInventory")} onStarted={resource.reload} />
            <SyncButton job="pricing" label={t("amazon.sync.syncPricing")} onStarted={resource.reload} />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-[var(--muted)]">{scheduler?.tick_in_progress ? t("amazon.settings.schedulerBusy") : ""}</p>
      </Card>

      <Card title={t("amazon.settings.writeTitle")} subtitle={t("amazon.settings.writeSubtitle")}>
        {["inventory", "price", "listings"].map((key) => (
          <div key={key} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-sm last:border-0">
            <span>{t(`amazon.settings.write.${key}`)}</span>
            <Button size="sm" disabled title={t("amazon.settings.writeDisabled")}>{status.flags.write_sync ? t("amazon.settings.writeNotImplemented") : t("amazon.settings.writeDisabled")}</Button>
          </div>
        ))}
      </Card>

      <Card title={t("amazon.settings.sellerTitle")} subtitle={t("amazon.settings.sellerSubtitle")}>
        <Input value={sellerId} disabled={!manage} onChange={(event) => setSellerId(event.target.value.toUpperCase())} placeholder="A1B2C3D4E5F6G7" label={t("amazon.settings.sellerLabel")} />
        {manage ? <div className="mt-3"><Button variant="primary" loading={savingSeller} onClick={saveSeller}>{t("amazon.common.save")}</Button></div> : null}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ page shell
export default function AmazonCenter() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const tab = AMAZON_TABS.includes(params.tab) ? params.tab : "dashboard";
  const items = useMemo(() => AMAZON_TABS.map((value) => ({ value, label: t(`amazon.tabs.${value}`) })), [t]);
  const body = {
    dashboard: <DashboardTab />,
    orders: <OrdersTab />,
    products: <ListingTable key="products" kind="products" />,
    inventory: <ListingTable key="inventory" kind="inventory" />,
    pricing: <ListingTable key="pricing" kind="pricing" />,
    listings: <ListingTable key="listings" kind="listings" />,
    "sku-mapping": <SkuMappingTab />,
    "sync-logs": <SyncLogsTab />,
    settings: <AmazonSettingsPanel />,
  }[tab];
  return (
    <div className="space-y-4">
      <PageHeader title={t("amazon.title")} description={t("amazon.subtitle")} />
      <div className="overflow-x-auto">
        <Tabs value={tab} items={items} ariaLabel={t("amazon.title")} onChange={(value) => navigate(value === "dashboard" ? "/amazon" : `/amazon/${value}`)} />
      </div>
      <section role="tabpanel" aria-labelledby={`m1-tab-${tab}`}>{body}</section>
    </div>
  );
}

export function AmazonIntegrationSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <PageHeader title={t("amazon.settings.pageTitle")} description={t("amazon.settings.pageSubtitle")} actions={<Link className="m1-button m1-button--secondary m1-button--md" to="/amazon">{t("amazon.settings.openCenter")}</Link>} />
      <AmazonSettingsPanel />
    </div>
  );
}
