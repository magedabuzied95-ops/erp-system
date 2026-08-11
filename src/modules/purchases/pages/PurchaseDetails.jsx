import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Ban,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  FileText,
  PackageCheck,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import {
  formatCurrency,
  formatDateTime,
  normalizePurchase,
  purchaseCanEditDestructively,
  purchaseHasStockMovements,
  purchaseIsFullyReceived,
  purchasePaidAmount,
  purchaseReceivedQuantity,
} from "../lib/flowStore";

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const nullableNumber = (value) => (value === "" || value === null || value === undefined ? null : number(value));
const notifyProductsChanged = (source = "purchase-price-sync") => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("products:refetch", { detail: { source } }));
};
const lineCost = (item = {}) => number(item.unit_cost ?? item.cost_price ?? item.purchase_price ?? item.purchase_cost ?? item.cost ?? item.price);
const lineSalePrice = (item = {}) => number(item.variant_sale_price ?? item.selling_price ?? item.regular_price ?? 0);
const lineDiscountPrice = (item = {}) => {
  const value = item.variant_discount_price ?? item.discount_price ?? item.offer_price ?? item.sale_price;
  return value === null || value === undefined || value === "" ? "" : number(value);
};
const lineQty = (item = {}) => number(item.quantity ?? item.qty);
const lineReceived = (item = {}) => number(item.received_quantity ?? item.received_qty ?? item.receivedQty);
const lineSubtotal = (item = {}) => number(item.subtotal ?? item.total ?? lineQty(item) * lineCost(item));
const imageFor = (value) => resolveProductImageUrl(value) || "/favicon.svg";
const firstImageValue = (...values) =>
  values.find((value) => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") return value.image_url || value.url || value.path || value.image;
    return false;
  });
const comparableImageValue = (value) => String(value || "").trim();
const resolveLineImage = (line = {}) =>
  imageFor(firstImageValue(
    line.variant_image_url,
    line.variantImageUrl,
    line.variant?.image_url,
    line.variant?.image,
    line.color_image_url,
    line.colorImageUrl,
    line.product_variant_image,
    line.image_url,
    line.product_image_url,
    line.product?.image_url,
    line.product?.image
  ));
const purchaseRemaining = (purchase) => Math.max(0, number(purchase.total) - purchasePaidAmount(purchase));
const receivedInventoryValue = (purchase) =>
  (purchase.items || []).reduce((sum, item) => sum + lineReceived(item) * lineCost(item), 0);
function PurchaseDetails() {
  const { t } = useTranslation();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const isEditRoute = /\/edit\/?$/.test(location.pathname);

  useEffect(() => {
    if (searchParams.get("edit") === "1") {
      navigate(`/purchases/${id}/edit`, { replace: true });
    }
  }, [id, navigate, searchParams]);

  const refresh = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await api.get(`/purchases/${id}`);
      const nextPurchase = response?.purchase || response?.data;
      setPurchase(nextPurchase ? normalizePurchase(nextPurchase) : null);
    } catch (error) {
      console.error(error);
      setPurchase(null);
      const backendMessage = error.responseBody?.message || error.responseBody?.error || error.message;
      const message = error.status === 409
        ? t("purchases.details.conflict")
        : backendMessage || t("purchases.details.loadFailed");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [id]);

  const savePurchase = async (next) => {
    const response = await api.patch(`/purchases/${purchase.id}`, {
      supplier_id: next.supplier_id,
      warehouse_id: next.warehouse_id,
      supplier_name: next.supplier_name,
      payment_status: next.payment_status,
      paid_amount: next.paid_amount,
      supplier_paid_amount: next.supplier_paid_amount,
      notes: next.notes,
      supplier_invoice_number: next.supplier_invoice_number,
      supplier_reference: next.supplier_reference,
      payment_reference: next.payment_reference,
      attachments: next.attachments,
      metadata: next.metadata,
      items: next.items,
    });
    const updated = response?.purchase || response?.data;
    if (updated) setPurchase(normalizePurchase(updated));
    return updated;
  };

  const runPurchaseAction = async (action) => {
    try {
      await action();
    } catch (error) {
      toast.error(error.responseBody?.message || error.responseBody?.error || error.message || t("purchases.toasts.actionFailed"));
    }
  };

  const duplicatePurchase = async () => {
    await runPurchaseAction(async () => {
      const response = await api.post(`/purchases/${purchase.id}/duplicate`, {});
      const duplicate = response?.purchase || response?.data;
      toast.success(t("purchases.toasts.cleanDraftCreated"));
      if (duplicate?.id) navigate(`/purchases/${duplicate.id}`);
    });
  };

  const receiveStock = async () => {
    await runPurchaseAction(async () => {
      const response = await api.post(`/purchases/${purchase.id}/receive`, {});
      const updated = response?.purchase || response?.data;
      if (updated) setPurchase(normalizePurchase(updated));
      notifyProductsChanged("purchase-receive-price-sync");
      toast.success(t("purchases.toasts.stockReceived"));
    });
  };

  const cancelPurchase = async () => {
    await runPurchaseAction(async () => {
      const reason = window.prompt(t("purchases.confirm.cancelReason"), t("purchases.confirm.cancelReasonDefault"));
      if (reason === null) return;
      const response = await api.post(`/purchases/${purchase.id}/cancel`, { reason });
      const updated = response?.purchase || response?.data;
      if (updated) setPurchase(normalizePurchase(updated));
      toast.success(response?.message || t("purchases.toasts.cancelled"));
    });
  };

  const deletePurchase = async () => {
    const confirmed = window.confirm(t("purchases.confirm.deleteReverse"));
    if (!confirmed) return;
    await runPurchaseAction(async () => {
      const response = await api.delete(`/purchases/${purchase.id}`, { body: { reason: "Purchase deleted and stock reversed from details" } });
      toast.success(response?.message || t("purchases.toasts.deletedReversed"));
      navigate("/purchases");
    });
  };

  const createAdjustment = async (payload) => {
    const response = await api.post(`/purchases/${purchase.id}/adjustments`, payload);
    const updated = response?.purchase || response?.data;
    if (updated) setPurchase(normalizePurchase(updated));
    notifyProductsChanged("purchase-adjustment-price-sync");
    return updated;
  };

  const exportPdf = () => window.print();

  if (loading) {
    return (
      <FlowShell title={t("purchases.details.title")} subtitle={t("purchases.details.loadingSubtitle")}>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">{t("purchases.details.loading")}</div>
      </FlowShell>
    );
  }

  if (!purchase) {
    return (
      <FlowShell title={t("purchases.details.notFoundTitle")} subtitle={loadError || t("purchases.details.notFoundSubtitle")}>
        {loadError ? (
          <div className="mb-4 rounded-3xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-semibold text-rose-100">
            {loadError}
          </div>
        ) : null}
        <Link to="/purchases" className="inline-flex w-fit rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black">{t("purchases.details.backToPurchases")}</Link>
      </FlowShell>
    );
  }

  const paidAmount = purchasePaidAmount(purchase);
  const remaining = purchaseRemaining(purchase);
  const receivedValue = receivedInventoryValue(purchase);
  const isLocked = purchaseIsFullyReceived(purchase);
  const hasStockMovements = purchase.safety?.hasStockMovements || purchaseHasStockMovements(purchase);
  const canEditDestructively = purchase.can_edit_destructively ?? purchase.safety?.canEditDestructively ?? purchaseCanEditDestructively(purchase);
  const attachments = purchase.metadata?.attachments || purchase.attachments || [];
  const adjustments = Array.isArray(purchase.metadata?.adjustments) ? purchase.metadata.adjustments : [];
  const purchaseTimelineEvents = Array.isArray(purchase.metadata?.timeline) ? purchase.metadata.timeline : [];
  const editLabel = t("purchases.details.editPurchase");
  const timeline = [
    { label: t("purchases.details.timeline.draftCreated"), at: purchase.created_at, detail: purchase.invoice_number },
    purchase.stock_applied || purchaseReceivedQuantity(purchase) > 0 ? { label: t("purchases.details.timeline.stockReceived"), at: purchase.stock_applied_at || purchase.updated_at, detail: t("purchases.details.timeline.unitsReceived", { count: purchaseReceivedQuantity(purchase) }) } : null,
    ...purchaseTimelineEvents.map((entry) => ({ label: entry.label || t("purchases.details.timeline.purchaseEdited"), at: entry.created_at || purchase.updated_at, detail: [entry.delta_quantity ? `${t("purchases.details.qty")} ${entry.delta_quantity > 0 ? "+" : ""}${entry.delta_quantity}` : "", entry.value_delta ? `${t("purchases.details.value")} ${formatCurrency(entry.value_delta)}` : "", entry.variant_id ? `${t("purchases.details.variant")} #${entry.variant_id}` : ""].filter(Boolean).join(" - ") || entry.type || "" })),
    ...adjustments.map((entry) => ({ label: t("purchases.details.timeline.purchaseAdjustment"), at: entry.created_at, detail: `${formatCurrency(entry.total || 0)} - ${t("purchases.details.linesCount", { count: entry.lines?.length || 0 })}` })),
    paidAmount > 0 ? { label: t("purchases.details.timeline.paymentRecorded"), at: purchase.updated_at || purchase.created_at, detail: formatCurrency(paidAmount) } : null,
    String(purchase.status || "").toLowerCase() === "cancelled" ? { label: t("purchases.statusLabels.cancelled"), at: purchase.updated_at, detail: purchase.cancel_reason || t("purchases.toasts.cancelled") } : null,
  ].filter(Boolean);

  if (isEditRoute) {
    return (
      <FlowShell
        title={t("purchases.details.editPurchaseTitle")}
        subtitle={t("purchases.details.purchaseTitle", { invoice: purchase.invoice_number })}
        actions={<Link to="/purchases" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">{t("purchases.details.back")}</Link>}
        tabs={[
          { to: "/purchases", label: t("purchases.tabs.purchases"), end: true },
          { to: "/purchases/create", label: t("purchases.tabs.createPo") },
          { to: "/purchases/reorder-suggestions", label: t("purchases.tabs.smartReorder") },
          { to: "/suppliers", label: t("purchases.tabs.suppliers") },
        ]}
      >
        {!canEditDestructively ? (
          <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
            {t("purchases.details.receivedEditWarning")}
          </div>
        ) : null}
        <EditPurchaseModal
          purchase={purchase}
          locked={!canEditDestructively}
          mode="page"
          onClose={() => navigate(`/purchases/${purchase.id}`)}
          onSave={async (next) => {
            try {
              await savePurchase(next);
              toast.success(t("purchases.toasts.updated"));
              navigate("/purchases");
            } catch (error) {
              const message = error.responseBody?.message || error.responseBody?.error || error.message || t("purchases.toasts.updateFailed");
              toast.error(message);
              throw error;
            }
          }}
        />
      </FlowShell>
    );
  }

  return (
    <FlowShell
      title={t("purchases.details.purchaseTitle", { invoice: purchase.invoice_number })}
      subtitle={t("purchases.details.subtitle")}
      actions={<Link to="/purchases" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">{t("purchases.details.back")}</Link>}
      tabs={[
        { to: "/purchases", label: t("purchases.tabs.purchases"), end: true },
        { to: "/purchases/create", label: t("purchases.tabs.createPo") },
        { to: "/purchases/reorder-suggestions", label: t("purchases.tabs.smartReorder") },
        { to: "/suppliers", label: t("purchases.tabs.suppliers") },
      ]}
    >
      <div className="flex flex-wrap gap-2 rounded-3xl border border-white/10 bg-zinc-950/90 p-4">
        <ActionButton icon={Edit3} label={editLabel} onClick={() => navigate(`/purchases/${purchase.id}/edit`)} />
        <ActionButton icon={Plus} label={t("purchases.details.addAdjustment")} onClick={() => setAdjusting(true)} />
        <ActionButton icon={Truck} label={t("purchases.actionsMenu.receiveStock")} onClick={receiveStock} disabled={hasStockMovements} />
        <ActionButton icon={Printer} label={t("purchases.details.printInvoice")} onClick={() => window.print()} />
        <ActionButton icon={Download} label={t("purchases.actionsMenu.exportPdf")} onClick={exportPdf} />
        <ActionButton icon={Copy} label={t("purchases.details.duplicate")} onClick={duplicatePurchase} />
        <ActionButton icon={Ban} label={t("common.cancel")} onClick={cancelPurchase} />
        <ActionButton icon={Trash2} label={t("purchases.actionsMenu.deleteReverseStock")} onClick={deletePurchase} danger />
      </div>

      {isLocked ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
          {t("purchases.details.receivedEditWarning")}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={t("purchases.details.totalPurchaseCost")} value={formatCurrency(purchase.total)} />
        <SummaryCard label={t("purchases.details.paidAmount")} value={formatCurrency(paidAmount)} tone="emerald" />
        <SummaryCard label={t("purchases.details.remainingBalance")} value={formatCurrency(remaining)} tone={remaining > 0 ? "amber" : "emerald"} />
        <SummaryCard label={t("purchases.details.receivedInventoryValue")} value={formatCurrency(receivedValue)} tone="blue" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5">
          <div className="flex items-center gap-3">
            <ReceiptText className="h-5 w-5 text-emerald-300" />
            <h2 className="text-lg font-black text-white">{t("purchases.details.invoiceOverview")}</h2>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Info label={t("purchases.table.supplier")} value={purchase.supplier_name} />
            <Info label={t("purchases.table.warehouse")} value={purchase.warehouse_name} />
            <Info label={t("purchases.details.paymentStatus")} value={<StatusBadge value={purchase.payment_status} />} />
            <Info label={t("purchases.details.purchaseStatus")} value={<StatusBadge value={purchase.status} />} />
            <Info label={t("purchases.details.invoiceTotal")} value={formatCurrency(purchase.total)} />
            <Info label={t("purchases.details.paidRemaining")} value={`${formatCurrency(paidAmount)} / ${formatCurrency(remaining)}`} />
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5">
          <div className="flex items-center gap-3">
            <PackageCheck className="h-5 w-5 text-blue-300" />
            <h2 className="text-lg font-black text-white">{t("purchases.details.timelineTitle")}</h2>
          </div>
          <div className="mt-5 space-y-3">
            {timeline.map((item) => (
              <div key={`${item.label}-${item.at}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="font-black text-white">{item.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{formatDateTime(item.at)}</div>
                <div className="mt-1 text-sm text-zinc-300">{item.detail}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5">
        <h2 className="text-lg font-black text-white">{t("purchases.details.products")}</h2>
        <div className="m1-table-container mt-4 overflow-x-auto">
          <table className="m1-table m1-table--compact min-w-[980px] w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="py-3">{t("purchases.details.image")}</th>
                <th>{t("purchases.details.product")}</th>
                <th>{t("purchases.details.variant")}</th>
                <th>{t("purchases.details.qty")}</th>
                <th>{t("purchases.kpis.received")}</th>
                <th>{t("purchases.details.cost")}</th>
                <th>{t("purchases.details.subtotal")}</th>
                <th>{t("purchases.details.state")}</th>
              </tr>
            </thead>
            <tbody>
              {(purchase.items || []).map((item, index) => (
                <tr key={item.id || item.line_id || index} className="text-zinc-200">
                  <td className="py-3"><PurchaseLineImage line={item} /></td>
                  <td className="font-bold text-white">{item.product_name || item.name || item.sku || t("purchases.details.product")}</td>
                  <td>{[item.color, item.size, item.sku].filter(Boolean).join(" / ") || t("purchases.details.variant")}</td>
                  <td>{lineQty(item)}</td>
                  <td>{lineReceived(item)}</td>
                  <td>{formatCurrency(lineCost(item))}</td>
                  <td className="font-bold text-white">{formatCurrency(lineSubtotal(item))}</td>
                  <td className="max-w-[220px] text-xs text-amber-200">
                    {lineReceived(item) > 0 ? t("purchases.details.itemReceivedLocked") : t("purchases.details.editableBeforeReceipt")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5">
          <h2 className="text-lg font-black text-white">{t("purchases.details.notes")}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{purchase.notes || t("purchases.details.noNotes")}</p>
        </section>
        <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5">
          <h2 className="text-lg font-black text-white">{t("purchases.details.attachments")}</h2>
          <div className="mt-3 space-y-2">
            {attachments.length ? attachments.map((file, index) => (
              <div key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-200">
                <FileText className="h-4 w-4" />
                {file.name || t("purchases.details.attachmentNumber", { number: index + 1 })}
              </div>
            )) : <div className="text-sm text-zinc-500">{t("purchases.details.noAttachments")}</div>}
          </div>
        </section>
      </div>

      {editing ? (
        <EditPurchaseModal
          purchase={purchase}
          locked={!canEditDestructively}
          onClose={() => {
            setEditing(false);
            if (searchParams.get("edit")) setSearchParams({});
          }}
          onSave={async (next) => {
            try {
              await savePurchase(next);
              setEditing(false);
              if (searchParams.get("edit")) setSearchParams({});
              toast.success(t("purchases.toasts.updated"));
            } catch (error) {
              const message = error.responseBody?.message || error.responseBody?.error || error.message || t("purchases.toasts.updateFailed");
              toast.error(message);
              throw error;
            }
          }}
        />
      ) : null}
      {adjusting ? (
        <AdjustmentModal
          purchase={purchase}
          onClose={() => setAdjusting(false)}
          onSave={async (payload) => {
            try {
              await createAdjustment(payload);
              setAdjusting(false);
              toast.success(t("purchases.toasts.adjustmentReceived"));
            } catch (error) {
              toast.error(error.message || t("purchases.toasts.adjustmentFailed"));
            }
          }}
        />
      ) : null}
    </FlowShell>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled = false, danger = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function SummaryCard({ label, value, tone = "zinc" }) {
  const tones = {
    zinc: "border-white/10 bg-white/5",
    emerald: "border-emerald-500/20 bg-emerald-500/10",
    amber: "border-amber-500/20 bg-amber-500/10",
    blue: "border-blue-500/20 bg-blue-500/10",
  };
  return (
    <div className={`rounded-3xl border p-5 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-2 font-black text-white">{value}</div>
    </div>
  );
}

function PurchaseLineImage({ line, className = "h-14 w-14" }) {
  const resolvedImage = resolveLineImage(line);

  useEffect(() => {
    const productImage = resolveProductImageUrl(line?.product_image_url || line?.product?.image_url || line?.product?.image || "");
    const variantImageFields = [
      line?.variant_image_url,
      line?.variantImageUrl,
      line?.color_image_url,
      line?.colorImageUrl,
      line?.product_variant_image,
    ].map((value) => resolveProductImageUrl(value || "")).filter(Boolean);
    console.log("[purchase-line-image-debug]", {
      lineId: line?.id || line?.line_id || null,
      productId: line?.product_id || line?.productId || null,
      variantId: line?.variant_id || line?.variantId || null,
      sku: line?.sku || "",
      color: line?.color || "",
      size: line?.size || "",
      variant_image_url: line?.variant_image_url,
      color_image_url: line?.color_image_url,
      product_variant_image: line?.product_variant_image,
      product_image_url: line?.product_image_url,
      resolvedImage,
      rawImageFields: {
        variant_image_url: line?.variant_image_url,
        color_image_url: line?.color_image_url,
        product_variant_image: line?.product_variant_image,
        product_image_url: line?.product_image_url,
        image_url: line?.image_url,
      },
    });
    if (
      productImage &&
      variantImageFields.length > 0 &&
      comparableImageValue(resolvedImage) === comparableImageValue(productImage) &&
      variantImageFields.some((value) => comparableImageValue(value) === comparableImageValue(productImage))
    ) {
      console.warn("[purchase-image-fallback-warning]", {
        lineId: line?.id || line?.line_id || null,
        sku: line?.sku || "",
        variantId: line?.variant_id || line?.variantId || null,
        color: line?.color || "",
        size: line?.size || "",
        reason: "variant image missing or resolved to product cover",
      });
    }
  }, [line?.id, line?.line_id, line?.product_id, line?.variant_id, line?.sku, line?.color, line?.size, resolvedImage]);

  return (
    <img
      src={resolvedImage}
      alt=""
      className={`${className} rounded-xl bg-white/5 object-contain p-1`}
      onError={(event) => {
        if (event.currentTarget.src.endsWith("/favicon.svg")) return;
        event.currentTarget.src = "/favicon.svg";
      }}
      loading="lazy"
      decoding="async"
    />
  );
}

const productDisplayName = (product = {}) => product.name || product.product_name || product.title || `Product ${product.id || ""}`.trim();
const productSku = (product = {}) => product.sku || product.product_sku || product.code || "";
const productImage = (product = {}) => firstImageValue(product.variant_image_url, product.color_image_url, product.image_url, product.product_image_url, product.image);
const variantDisplayName = (variant = {}) =>
  [variant.color, variant.size, variant.sku || variant.barcode].filter(Boolean).join(" / ") || `Variant ${variant.id || ""}`.trim();
const variantImage = (variant = {}) =>
  firstImageValue(
    variant.variant_image_url,
    variant.variantImageUrl,
    variant.image_url,
    variant.image,
    variant.color_image_url,
    variant.colorImageUrl,
    variant.product_variant_image
  );
const variantSalePrice = (variant = {}, product = {}) =>
  number(variant.price ?? variant.regular_price ?? product.price ?? product.regular_price ?? 0);
const variantDiscountPrice = (variant = {}) => {
  const enabled = variant.sale_price_enabled === true || String(variant.sale_price_enabled || "").toLowerCase() === "true";
  const explicit = variant.discount_price ?? variant.offer_price;
  const raw = explicit ?? (enabled ? variant.sale_price : "");
  if (raw === null || raw === undefined || raw === "") return "";
  const value = number(raw);
  return value > 0 ? value : "";
};

function EditPurchaseModal({ purchase, locked, onClose, onSave, mode = "modal" }) {
  const { t } = useTranslation();
  const isPage = mode === "page";
  const purchaseMetadata = purchase.metadata && typeof purchase.metadata === "object" ? purchase.metadata : {};
  const [confirmReceivedSave, setConfirmReceivedSave] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [form, setForm] = useState(() => ({
    supplier_name: purchase.supplier_name || "",
    warehouse_id: purchase.warehouse_id || "",
    payment_status: purchase.payment_status || "unpaid",
    paid_amount: purchasePaidAmount(purchase),
    supplier_invoice_number: purchaseMetadata.supplier_invoice_number || "",
    supplier_reference: purchaseMetadata.supplier_reference || "",
    payment_reference: purchaseMetadata.payment_reference || "",
    attachmentsText: Array.isArray(purchaseMetadata.attachments) ? purchaseMetadata.attachments.map((file) => file.name || file.url || "").filter(Boolean).join("\n") : "",
    notes: purchase.notes || "",
    items: (purchase.items || []).map((item) => ({
      ...item,
      variant_sale_price: lineSalePrice(item),
      variant_discount_price: lineDiscountPrice(item),
    })),
  }));

  useEffect(() => {
    let active = true;
    api.get("/products/with-variants")
      .then((response) => {
        if (!active) return;
        const rows = Array.isArray(response?.products) ? response.products : Array.isArray(response?.data) ? response.data : [];
        setProducts(rows);
      })
      .catch((error) => toast.error(error.message || t("purchases.toasts.loadProductsFailed")));
    return () => {
      active = false;
    };
  }, []);

  const setItem = (index, patch) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const filteredProducts = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    const list = needle
      ? products.filter((product) => `${productDisplayName(product)} ${productSku(product)}`.toLowerCase().includes(needle))
      : products;
    return list.slice(0, 80);
  }, [products, productSearch]);

  const productById = (productId) => products.find((product) => String(product.id) === String(productId));
  const variantsForItem = (item) => {
    const product = productById(item.product_id);
    return Array.isArray(product?.variants) ? product.variants : [];
  };
  const selectProductForLine = (index, productId) => {
    const product = productById(productId);
    setItem(index, {
      product_id: productId,
      variant_id: "",
      product_name: product ? productDisplayName(product) : "",
      name: product ? productDisplayName(product) : "",
      sku: product ? productSku(product) : "",
      color: "",
      size: "",
      product_image_url: product ? productImage(product) : "",
      image_url: product ? productImage(product) : "",
      variant_image_url: "",
      color_image_url: "",
      product_variant_image: "",
      variant_sale_price: product ? number(product.price ?? product.regular_price ?? 0) : 0,
      variant_discount_price: product ? variantDiscountPrice(product) : "",
      variant: null,
    });
  };
  const selectVariantForLine = (index, variantId) => {
    const current = form.items[index] || {};
    const product = productById(current.product_id);
    const variant = (product?.variants || []).find((entry) => String(entry.id) === String(variantId));
    const image = variant ? variantImage(variant) : "";
    setItem(index, {
      variant_id: variantId,
      sku: variant?.sku || variant?.barcode || current.sku || "",
      color: variant?.color || current.color || "",
      size: variant?.size || current.size || "",
      variant_image_url: image || "",
      color_image_url: variant?.color_image_url || variant?.colorImageUrl || "",
      product_variant_image: variant?.product_variant_image || "",
      image_url: image || current.product_image_url || current.image_url || "",
      variant_sale_price: variant ? variantSalePrice(variant, product) : lineSalePrice(current),
      variant_discount_price: variant ? variantDiscountPrice(variant) : lineDiscountPrice(current),
      variant: variant || null,
    });
  };

  const total = useMemo(() => form.items.reduce((sum, item) => sum + lineQty(item) * lineCost(item), 0), [form.items]);
  const totalItemQuantity = useMemo(() => form.items.reduce((sum, item) => sum + lineQty(item), 0), [form.items]);
  const paidAmount = number(form.paid_amount);
  const remainingAmount = Math.max(0, total - paidAmount);
  const addLine = () => {
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { product_id: "", variant_id: "", product_name: "", sku: "", color: "", size: "", quantity: 1, cost_price: 0, unit_cost: 0, variant_sale_price: 0, variant_discount_price: "" },
      ],
    }));
  };
  const removeLine = (index) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const buildPayload = () => {
    const attachments = form.attachmentsText
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    const items = form.items.map((item) => {
      const purchaseCost = lineCost(item);
      const salePrice = lineSalePrice(item);
      const discountPrice = nullableNumber(lineDiscountPrice(item));
      return {
        ...item,
        unit_cost: purchaseCost,
        cost_price: purchaseCost,
        selling_price: salePrice,
        regular_price: salePrice,
        sale_price: discountPrice ?? 0,
        variant_sale_price: salePrice,
        variant_discount_price: discountPrice,
        subtotal: lineQty(item) * purchaseCost,
      };
    });
    return {
      ...purchase,
      supplier_name: form.supplier_name,
      warehouse_id: form.warehouse_id,
      payment_status: form.payment_status,
      paid_amount: number(form.paid_amount),
      supplier_paid_amount: number(form.paid_amount),
      supplier_invoice_number: form.supplier_invoice_number,
      supplier_reference: form.supplier_reference,
      payment_reference: form.payment_reference,
      attachments,
      metadata: {
        ...(purchase.metadata || {}),
        supplier_invoice_number: form.supplier_invoice_number,
        supplier_reference: form.supplier_reference,
        payment_reference: form.payment_reference,
        attachments,
      },
      notes: form.notes,
      items,
      subtotal: total,
      total,
      can_edit_items: true,
      updated_at: new Date().toISOString(),
    };
  };

  const validatePricing = () => {
    for (const [index, item] of form.items.entries()) {
      const row = index + 1;
      if (lineCost(item) < 0) return t("purchases.details.purchaseCostInvalid", "Row {{row}}: purchase cost must be 0 or greater.", { row });
      if (lineSalePrice(item) < 0) return t("purchases.details.salePriceInvalid", "Row {{row}}: sale price must be 0 or greater.", { row });
      const discountPrice = lineDiscountPrice(item);
      if (discountPrice !== "" && number(discountPrice) < 0) return t("purchases.details.discountPriceInvalid", "Row {{row}}: discount price must be empty or 0 or greater.", { row });
    }
    return "";
  };

  const handleSave = async () => {
    if (saving) return;
    setSaveError("");
    setSaving(true);
    try {
      const pricingError = validatePricing();
      if (pricingError) {
        setSaveError(pricingError);
        setSaving(false);
        return;
      }
      await onSave(buildPayload());
    } catch (error) {
      const message = error.responseBody?.message || error.responseBody?.error || error.message || t("purchases.toasts.updateFailed");
      setSaveError(message);
      setConfirmReceivedSave(false);
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (locked) {
      setConfirmReceivedSave(true);
      return;
    }
    handleSave();
  };

  const editor = (
      <div className={`${isPage ? "w-full" : "max-h-[90vh] w-full max-w-6xl overflow-y-auto shadow-2xl"} rounded-3xl border border-white/10 bg-zinc-950 p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-white">{t("purchases.details.editPurchaseTitle")}</h2>
            {locked ? <p className="mt-1 text-sm text-amber-300">{t("purchases.details.receivedSaveWarning")}</p> : null}
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-white/10 bg-white/5 p-2 text-white disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>

        {saveError ? (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm font-semibold text-rose-100">
            {saveError}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Field label={t("purchases.table.supplier")} value={form.supplier_name} onChange={(value) => setForm((prev) => ({ ...prev, supplier_name: value }))} />
          <Field label={t("purchases.details.warehouseId")} value={form.warehouse_id} onChange={(value) => setForm((prev) => ({ ...prev, warehouse_id: value }))} />
          <Field label={t("purchases.details.paymentStatus")} value={form.payment_status} onChange={(value) => setForm((prev) => ({ ...prev, payment_status: value }))} />
          <Field label={t("purchases.details.paidAmount")} type="number" value={form.paid_amount} onChange={(value) => setForm((prev) => ({ ...prev, paid_amount: value }))} />
          <Field label={t("purchases.details.supplierInvoiceNumber")} value={form.supplier_invoice_number} onChange={(value) => setForm((prev) => ({ ...prev, supplier_invoice_number: value }))} />
          <Field label={t("purchases.details.supplierReference")} value={form.supplier_reference} onChange={(value) => setForm((prev) => ({ ...prev, supplier_reference: value }))} />
          <Field label={t("purchases.details.paymentReference")} value={form.payment_reference} onChange={(value) => setForm((prev) => ({ ...prev, payment_reference: value }))} />
        </div>
        <label className="mt-3 block">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.details.attachments")}</div>
          <textarea value={form.attachmentsText} onChange={(event) => setForm((prev) => ({ ...prev, attachmentsText: event.target.value }))} rows={3} placeholder={t("purchases.details.attachmentsPlaceholder")} className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none" />
        </label>
        <label className="mt-3 block">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.details.notes")}</div>
          <textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} rows={4} className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none" />
        </label>

        <div className="mt-5 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label={t("purchases.details.productSearch")} value={productSearch} onChange={setProductSearch} />
            <button type="button" onClick={addLine} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white">
              <Plus className="h-4 w-4" />
              {t("purchases.details.addProductLine")}
            </button>
          </div>
          {form.items.map((item, index) => {
            const variants = variantsForItem(item);
            const selectedProduct = productById(item.product_id);
            return (
            <div key={item.id || item.line_id || index} className="relative rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-2">
              <button type="button" onClick={() => removeLine(index)} title={t("purchases.details.remove")} className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-400/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-2.5 pr-9">
                <PurchaseLineImage line={item} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-white">{item.product_name || item.name || productDisplayName(selectedProduct) || t("purchases.details.productLine")}</div>
                  <div className="truncate text-[0.7rem] text-zinc-400">
                    {[item.color, item.size, item.sku].filter(Boolean).join(" / ") || t("purchases.details.noVariantSelected")}
                  </div>
                </div>
              </div>

              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-[minmax(18rem,2fr)_minmax(12rem,1.1fr)_4rem_7rem_7rem_7rem_8rem]">
                <label className="block sm:col-span-2 lg:col-span-1">
                  <CellLabel>{t("purchases.details.product")}</CellLabel>
                  <select value={item.product_id || ""} onChange={(event) => selectProductForLine(index, event.target.value)} className="h-8 w-full rounded-lg border border-white/10 bg-zinc-950 px-2 text-xs font-semibold text-white outline-none">
                    <option value="">{item.product_id ? `${t("purchases.details.product")} ${item.product_id}` : t("purchases.details.selectProduct")}</option>
                    {filteredProducts.map((product) => <option key={product.id} value={product.id}>{[productDisplayName(product), productSku(product)].filter(Boolean).join(" / ")}</option>)}
                  </select>
                </label>
                <label className="block">
                  <CellLabel>{t("purchases.details.variant")}</CellLabel>
                  <select value={item.variant_id || ""} onChange={(event) => selectVariantForLine(index, event.target.value)} className="h-8 w-full rounded-lg border border-white/10 bg-zinc-950 px-2 text-xs font-semibold text-white outline-none">
                    <option value="">{item.variant_id ? `${t("purchases.details.variant")} ${item.variant_id}` : t("purchases.details.selectVariant")}</option>
                    {variants.map((variant) => <option key={variant.id} value={variant.id}>{variantDisplayName(variant)}</option>)}
                  </select>
                </label>
                <CompactField label={t("purchases.details.qty")} type="number" value={lineQty(item)} onChange={(value) => setItem(index, { quantity: number(value) })} />
                <CompactField label={t("purchases.details.purchaseCost", "Purchase Cost")} type="number" value={lineCost(item)} onChange={(value) => setItem(index, { cost_price: number(value), unit_cost: number(value) })} />
                <CompactField label={t("purchases.details.salePrice", "Sale Price")} type="number" value={lineSalePrice(item)} onChange={(value) => setItem(index, { variant_sale_price: number(value), selling_price: number(value), regular_price: number(value) })} />
                <CompactField label={t("purchases.details.discountPrice", "Discount Price")} type="number" value={lineDiscountPrice(item)} onChange={(value) => setItem(index, { variant_discount_price: value === "" ? "" : number(value), sale_price: value === "" ? 0 : number(value) })} />
                <div>
                  <CellLabel>{t("purchases.details.subtotal")}</CellLabel>
                  <div className="flex h-8 items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 text-xs font-black text-emerald-100">{formatCurrency(lineQty(item) * lineCost(item))}</div>
                </div>
              </div>

              <details className="group mt-1.5 text-xs text-zinc-500">
                <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-lg px-1.5 py-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300 [&::-webkit-details-marker]:hidden" title={t("purchases.details.debugInfo", "Details")}>
                  <FileText className="h-3.5 w-3.5" />
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label={t("purchases.details.productId")} value={item.product_id || ""} onChange={(value) => setItem(index, { product_id: value })} />
                  <Field label={t("purchases.details.variantId")} value={item.variant_id || ""} onChange={(value) => setItem(index, { variant_id: value })} />
                </div>
              </details>
            </div>
            );
          })}
        </div>

        <div className="sticky bottom-0 -mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-zinc-950/95 px-5 py-3 backdrop-blur">
          <div className="grid flex-1 grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:flex lg:flex-wrap lg:items-center">
            <SummaryMetric label={t("purchases.details.subtotal")} value={formatCurrency(total)} />
            <SummaryMetric label={t("purchases.details.paidAmount")} value={formatCurrency(paidAmount)} />
            <SummaryMetric label={t("purchases.details.remaining", "Remaining")} value={formatCurrency(remainingAmount)} />
            <SummaryMetric label={t("purchases.details.totalItems", "Total Items")} value={totalItemQuantity} />
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{t("common.cancel")}</button>
            <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-black disabled:opacity-60">
              <Save className="h-4 w-4" />
              {saving ? t("purchases.details.savingAdjustments") : t("purchases.details.saveChanges")}
            </button>
          </div>
        </div>

        {confirmReceivedSave ? (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4">
            <div className="w-full max-w-md rounded-3xl border border-amber-400/20 bg-zinc-950 p-5 shadow-2xl">
              <h3 className="text-xl font-black text-white">{t("purchases.details.confirmReceivedEdit")}</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-amber-100">
                {t("purchases.details.receivedSaveWarning")}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmReceivedSave(false)} disabled={saving} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t("common.cancel")}</button>
                <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black disabled:opacity-60">{saving ? t("purchases.details.savingAdjustments") : t("purchases.details.saveAdjustments")}</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
  );

  if (isPage) return editor;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur">
      {editor}
    </div>
  );
}

function AdjustmentModal({ purchase, onClose, onSave }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [warehouseId, setWarehouseId] = useState(purchase.warehouse_id || "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ product_id: "", variant_id: "", quantity: 1, unit_cost: 0 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.get("/products/with-variants")
      .then((response) => {
        if (!active) return;
        const rows = Array.isArray(response?.products) ? response.products : Array.isArray(response?.data) ? response.data : [];
        setProducts(rows);
      })
      .catch((error) => toast.error(error.message || t("purchases.toasts.loadProductsFailed")));
    return () => {
      active = false;
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products.slice(0, 30);
    return products.filter((product) => `${product.name || ""} ${product.sku || ""}`.toLowerCase().includes(needle)).slice(0, 30);
  }, [products, query]);

  const productById = (productId) => products.find((product) => String(product.id) === String(productId));
  const updateLine = (index, patch) => setLines((prev) => prev.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const addLine = () => setLines((prev) => [...prev, { product_id: "", variant_id: "", quantity: 1, unit_cost: 0 }]);
  const removeLine = (index) => setLines((prev) => prev.filter((_, lineIndex) => lineIndex !== index));
  const total = lines.reduce((sum, line) => sum + number(line.quantity) * number(line.unit_cost), 0);

  const submit = async () => {
    const items = lines
      .map((line) => {
        const product = productById(line.product_id);
        const variant = (product?.variants || []).find((entry) => String(entry.id) === String(line.variant_id));
        return {
          product_id: line.product_id,
          variant_id: line.variant_id || null,
          product_name: product?.name || "",
          sku: variant?.sku || product?.sku || "",
          color: variant?.color || "",
          size: variant?.size || "",
          quantity: number(line.quantity),
          unit_cost: number(line.unit_cost),
          cost_price: number(line.unit_cost),
        };
      })
      .filter((line) => line.product_id && line.quantity > 0 && line.unit_cost > 0);
    if (!items.length) {
      toast.error(t("purchases.details.addValidAdjustmentLine"));
      return;
    }
    setSaving(true);
    try {
      await onSave({
        adjustment_key: `adj-${purchase.id}-${Date.now()}`,
        warehouse_id: warehouseId || purchase.warehouse_id,
        notes,
        items,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-white">{t("purchases.details.addAdjustmentTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-400">{t("purchases.details.addAdjustmentSubtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/5 p-2 text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_14rem]">
          <Field label={t("purchases.details.productSearch")} value={query} onChange={setQuery} />
          <Field label={t("purchases.details.warehouseId")} value={warehouseId} onChange={setWarehouseId} />
        </div>

        <div className="mt-5 space-y-3">
          {lines.map((line, index) => {
            const selectedProduct = productById(line.product_id);
            const variants = Array.isArray(selectedProduct?.variants) ? selectedProduct.variants : [];
            return (
              <div key={index} className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 md:grid-cols-[1.2fr_1fr_7rem_8rem_8rem_auto]">
                <label>
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.details.product")}</div>
                  <select value={line.product_id} onChange={(event) => updateLine(index, { product_id: event.target.value, variant_id: "" })} className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none">
                    <option value="">{t("purchases.details.selectProduct")}</option>
                    {filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.name || `${t("purchases.details.product")} ${product.id}`}</option>)}
                  </select>
                </label>
                <label>
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.details.variant")}</div>
                  <select value={line.variant_id} onChange={(event) => updateLine(index, { variant_id: event.target.value })} className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none">
                    <option value="">{t("purchases.details.noVariant")}</option>
                    {variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.color, variant.size, variant.sku].filter(Boolean).join(" / ") || `${t("purchases.details.variant")} ${variant.id}`}</option>)}
                  </select>
                </label>
                <Field label={t("purchases.details.qty")} type="number" value={line.quantity} onChange={(value) => updateLine(index, { quantity: value })} />
                <Field label={t("purchases.details.cost")} type="number" value={line.unit_cost} onChange={(value) => updateLine(index, { unit_cost: value })} />
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.details.subtotal")}</div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-black text-white">{formatCurrency(number(line.quantity) * number(line.unit_cost))}</div>
                </div>
                <button type="button" onClick={() => removeLine(index)} disabled={lines.length === 1} className="self-end rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-bold text-rose-100 disabled:opacity-40">{t("purchases.details.remove")}</button>
              </div>
            );
          })}
        </div>

        <label className="mt-3 block">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.details.adjustmentNotes")}</div>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none" />
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <button type="button" onClick={addLine} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white">
            <Plus className="h-4 w-4" />
            {t("purchases.details.addLine")}
          </button>
          <div className="flex items-center gap-3">
            <div className="text-xl font-black text-white">{t("purchases.details.totalWithValue", { value: formatCurrency(total) })}</div>
            <button type="button" onClick={submit} disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black disabled:opacity-60">
              {saving ? t("purchases.details.saving") : t("purchases.details.receiveAdjustment")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", disabled = false }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
      />
    </label>
  );
}

function CellLabel({ children }) {
  return <div className="mb-0.5 truncate text-[0.58rem] font-bold uppercase tracking-[0.08em] text-zinc-500">{children}</div>;
}

function CompactField({ label, value, onChange, type = "text", disabled = false }) {
  return (
    <label className="block">
      <CellLabel>{label}</CellLabel>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-white outline-none disabled:opacity-50"
      />
    </label>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 lg:min-w-28">
      <div className="truncate text-[0.62rem] font-bold uppercase tracking-[0.08em] text-zinc-500">{label}</div>
      <div className="truncate text-sm font-black text-white">{value}</div>
    </div>
  );
}

export default PurchaseDetails;
