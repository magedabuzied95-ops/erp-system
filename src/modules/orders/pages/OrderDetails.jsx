import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  AlertTriangle,
  ArrowLeft,
  Download,
  ExternalLink,
  MessageCircle,
  Printer,
  RefreshCcw,
  Save,
  ShieldCheck,
  Truck,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import {
  formatShippingPaymentMethodLabel,
  isInvalidShippingProofUrl,
  resolveShippingProofImageUrl,
} from "../../../shared/lib/imageUrls";
import {
  buildWhatsappDeepLink,
  isValidWhatsappPhone,
  normalizePhoneNumber,
} from "../../../shared/utils/whatsapp.js";
import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "../../../shared/utils/orderInvoice";
import OrdersShell from "../components/OrdersShell";
import StatusBadge from "../components/StatusBadge";
import OrderInvoiceCard from "../../../shared/components/invoices/OrderInvoiceCard";
import {
  buildTimeline,
  formatCurrency,
  formatDateTime,
  normalizeOrder,
  ORDER_STATUSES,
  SHIPPING_STATUSES,
  upsertOrderMeta,
} from "../lib/ordersStore";

const getAttributionLabel = (order = {}) => {
  const source = String(order.attribution_type || order.marketing_source || "").toLowerCase();
  const platform = String(order.marketing_platform || order.marketing_source || "").toLowerCase();
  if (source.includes("instagram") && source.includes("story")) return "Instagram Story";
  if (source.includes("story")) return "Story";
  if (platform === "facebook" || source.includes("facebook")) return "Facebook Post";
  if (platform === "instagram" || source.includes("instagram")) return "Instagram Post";
  if (platform === "whatsapp" || source.includes("whatsapp")) return "WhatsApp Campaign";
  if (platform === "tiktok" || source.includes("tiktok")) return "TikTok Campaign";
  if (order.marketing_campaign) return String(order.marketing_campaign);
  return "";
};

function OrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const invoiceRef = useRef(null);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pdfFormat, setPdfFormat] = useState("a4");
  const [notes, setNotes] = useState("");
  const [reviewingPayment, setReviewingPayment] = useState(false);
  const [shipping, setShipping] = useState({
    provider: "",
    shipping_status: "pending",
    shipment_id: "",
    tracking_number: "",
    tracking_url: "",
    delivery_fee: 0,
    cod_amount: 0,
    courier_notes: "",
  });

  const loadOrder = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.get(`/orders/${id}`);
      const merged = normalizeOrder(data.order || data, { items: Array.isArray(data.items) ? data.items : [] });
      setOrder(merged);
      setNotes(merged.notes || "");
      setShipping({
        provider: merged.shipping_provider || "",
        shipping_status: merged.shipping_status || "pending",
        shipment_id: merged.shipment_id || "",
        tracking_number: merged.tracking_number || "",
        tracking_url: merged.tracking_url || "",
        delivery_fee: merged.delivery_fee || merged.shipping_fee || 0,
        cod_amount: merged.cod_amount || 0,
        courier_notes: merged.courier_notes || "",
      });
    } catch (err) {
      console.log(err);
      setError("Order details endpoint unavailable. Showing safe frontend fallback.");
      toast.error("Unable to load order details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
  }, [id]);

  const previewItems = useMemo(() => {
    if (!order) return [];
    return Array.isArray(order.items) ? order.items : [];
  }, [order]);

  const timeline = useMemo(() => (order ? buildTimeline(order) : []), [order]);
  const isAwaitingPaymentVerification =
    String(order?.payment_status || order?.paymentStatus || "").toLowerCase() === "awaiting_verification" ||
    String(order?.status || "").toLowerCase() === "awaiting_verification";
  const isShippingPaid = String(order?.payment_status || order?.paymentStatus || "").toLowerCase() === "shipping_paid";
  const isPaymentRejected =
    String(order?.payment_status || order?.paymentStatus || "").toLowerCase() === "rejected" ||
    String(order?.status || "").toLowerCase() === "payment_rejected";
  const paymentReviewVisible =
    isAwaitingPaymentVerification ||
    isShippingPaid ||
    isPaymentRejected ||
    Boolean(order?.shipping_payment_screenshot);
  const shippingProofValue = String(order?.shipping_payment_screenshot || "").trim();
  const shippingProofInvalid = isInvalidShippingProofUrl(shippingProofValue);
  const paymentProofUrl = shippingProofInvalid ? "" : resolveShippingProofImageUrl(shippingProofValue);
  const canReviewShippingProof = Boolean(paymentProofUrl);
  const paymentSummaryStatus = (() => {
    const value = String(order?.payment_status || order?.paymentStatus || "").toLowerCase();
    if (value === "awaiting_verification") return "بانتظار مراجعة التحويل";
    if (value === "shipping_paid") return "تم دفع الشحن";
    if (value === "rejected") return "تم رفض إثبات التحويل";
    if (value === "cod") return "الدفع عند الاستلام";
    return order?.paymentStatus === "Paid" ? formatCurrency(0) : "Pending";
  })();
  const paymentReviewBadgeText = isAwaitingPaymentVerification
    ? "بانتظار مراجعة التحويل"
    : isShippingPaid
      ? "تم تأكيد دفع الشحن"
      : isPaymentRejected
        ? "تم رفض إثبات التحويل"
        : "";

  const saveLocalMeta = (patch) => {
    upsertOrderMeta(id, patch);
    setOrder((prev) => (prev ? normalizeOrder({ ...prev, ...patch }, { items: previewItems }) : prev));
  };

  const handleStatusChange = (status) => {
    saveLocalMeta({ status, timeline: [{ label: `Status set to ${status}`, at: new Date().toISOString() }] });
    toast.success(`Order marked as ${status}`);
  };

  const handleSaveNotes = () => {
    saveLocalMeta({ notes });
    toast.success("Notes saved locally");
  };

  const handleSaveShipping = () => {
    saveLocalMeta({
      shipping_provider: shipping.provider,
      shipping_status: shipping.shipping_status,
      shipment_id: shipping.shipment_id,
      tracking_number: shipping.tracking_number,
      tracking_url: shipping.tracking_url,
      delivery_fee: Number(shipping.delivery_fee || 0),
      cod_amount: Number(shipping.cod_amount || 0),
      courier_notes: shipping.courier_notes,
    });
    toast.success("Shipping saved locally");
  };

  const handleCreateShipment = async () => {
    try {
      const result = await api.post(`/storefront/shipping/orders/${order.id}/create-shipment`, {
        provider: shipping.provider || "manual",
      });
      if (result.success) {
        setShipping((prev) => ({
          ...prev,
          provider: result.provider || prev.provider,
          shipping_status: result.shipping_status || prev.shipping_status,
          shipment_id: result.shipment_id || prev.shipment_id,
          tracking_number: result.tracking_number || prev.tracking_number,
          tracking_url: result.tracking_url || prev.tracking_url,
        }));
        toast.success("Shipment created");
      } else {
        toast.error(result.message || "Shipping provider is not configured. Manual shipping is available.");
      }
    } catch (err) {
      toast.error(err.message || "Unable to create shipment");
    }
  };

  const handleShippingPaymentReview = async (action) => {
    try {
      setReviewingPayment(true);
      await api.post(`/orders/${order.id}/${action === "confirm" ? "confirm-payment" : "reject-payment"}`, {});
      toast.success(action === "confirm" ? "Payment confirmed" : "Payment rejected");
      await loadOrder();
    } catch (err) {
      toast.error(err.message || "Unable to update payment verification");
    } finally {
      setReviewingPayment(false);
    }
  };

  const handlePrint = () => {
    const node = invoiceRef.current;
    if (!node) return;
    const popup = window.open("", "_blank", "width=900,height=1200");
    if (!popup) {
      toast.error("Popup blocked");
      return;
    }
    popup.document.write(`<html><head><title>${order.invoice_number}</title></head><body>${node.innerHTML}</body></html>`);
    popup.document.close();
    popup.print();
    popup.close();
  };

  const handlePdf = async () => {
    const invoice = {
      invoiceNumber: order.invoice_number,
      invoiceLabel: "Order Invoice",
      companyName: "ERP System",
      companyTagline: "Enterprise ERP and SaaS operations",
      customerName: order.customer_name,
      customerPhone: order.customer_phone || "",
      customerEmail: order.customer_email || "",
      customerAddress: order.customer_address || "",
      createdAt: order.created_at || new Date().toISOString(),
      status: order.status,
      payment: {
        paymentStatus: order.paymentStatus,
        paidAmount: Number(order.paid_amount || 0),
        dueAmount: Number(order.due_amount || 0),
        changeAmount: Number(order.change_amount || 0),
        method: order.payment_method || "n/a",
      },
      items: previewItems.map((item) => ({
        ...item,
        product_name: item.product_name || item.name,
        color: item.color,
        size: item.size,
        sku: item.sku,
        barcode: item.barcode,
        quantity: item.quantity,
        price: item.price,
        discount_amount: item.discount_amount || item.lineDiscount || 0,
        tax_amount: item.tax_amount || 0,
        total_amount:
          item.total_amount || Number(item.price || 0) * Number(item.quantity || 0),
      })),
      totals: {
        subtotal: previewItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0),
        itemDiscountTotal: previewItems.reduce(
          (sum, item) => sum + Number(item.discount_amount || item.lineDiscount || 0) * Number(item.quantity || 0),
          0
        ),
        invoiceDiscount: Number(order.invoice_discount || 0),
        serviceFee: Number(order.service_fee || 0),
        taxAmount: 0,
        total: Number(order.total || 0),
      },
      qrValue: order.invoice_number,
      barcodeValue: order.invoice_number,
    };

    const { downloadInvoicePdf } = await import("../../../shared/utils/invoicePdf");
    const result = await downloadInvoicePdf({
      format: pdfFormat,
      invoice,
      filename: `${order.invoice_number}.pdf`,
      onFallback: ({ html }) => {
        const popup = window.open("", "_blank", "width=980,height=1200");
        if (!popup) {
          toast.error("PDF preview blocked");
          return false;
        }
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        popup.print();
        popup.close();
        return true;
      },
    });

    if (result?.ok) {
      toast.success("PDF downloaded");
    } else if (result?.fallbackOpened) {
      toast.success("PDF preview opened");
    } else {
      toast.error("Unable to generate PDF");
    }
  };

  const shareWhatsApp = () => {
    const phone = normalizePhoneNumber(order.customer_phone || order.phone || "");
    const message = buildOrderInvoiceWhatsappText(normalizeOrderInvoiceData(order, previewItems, { storeName: "ERP System" }));
    window.open(buildWhatsappDeepLink({ phone, message }), "_blank", "noopener,noreferrer");
  };

  const notifyCustomer = () => {
    const phone = normalizePhoneNumber(order.customer_phone || order.phone || "");
    if (!isValidWhatsappPhone(phone)) {
      toast.error("Customer phone number is required for WhatsApp notifications");
      return;
    }

    const message = buildOrderInvoiceWhatsappText(normalizeOrderInvoiceData(order, previewItems, { storeName: "ERP System" }));

    window.open(buildWhatsappDeepLink({ phone, message }), "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <OrdersShell title="Order Details" subtitle="Loading order information...">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-10 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-500/20 border-t-blue-400" />
          <p className="mt-4 text-sm text-zinc-400">Loading order details...</p>
        </div>
      </OrdersShell>
    );
  }

  if (error || !order) {
    return (
      <OrdersShell title="Order Details" subtitle="Unable to load live order data.">
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-6 text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error || "Order not found"}
          <div className="mt-4">
            <button type="button" onClick={() => navigate("/orders")} className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black">
              Back to orders
            </button>
          </div>
        </div>
      </OrdersShell>
    );
  }

  return (
    <OrdersShell
      title={`Order ${order.invoice_number}`}
      subtitle="Detailed order operations, invoice preview, notes, shipping, and delivery flow."
      actions={
        <Link
          to="/orders"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Order summary</div>
                <h2 className="mt-2 text-2xl font-black text-white">{order.customer_name}</h2>
                <p className="mt-1 text-sm text-zinc-400">{order.customer_phone || "No phone recorded"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={order.status} />
                <StatusBadge value={paymentReviewBadgeText || order.paymentStatus} />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Info label="Invoice" value={order.invoice_number} />
              <Info label="Channel" value={order.source || order.channel} />
              <Info label="Branch" value={order.branch} />
              <Info label="Date" value={formatDateTime(order.created_at)} />
            </div>
            {getAttributionLabel(order) ? (
              <div className="mt-4 inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                {getAttributionLabel(order)}
              </div>
            ) : null}
            {String(order.source || order.channel || "").toLowerCase() === "website" ? (
              <div className="mt-4 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                Online Order
              </div>
            ) : null}
          </div>

          {String(order.source || order.channel || "").toLowerCase() === "website" ? (
            <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
              <h3 className="text-xl font-black text-white">Shipping data</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Info label="Customer type" value="Online Customer" />
                <Info label="Governorate" value={order.governorate || "n/a"} />
                <Info label="City / Area" value={order.city_area || "n/a"} />
                <Info label="Address" value={order.customer_address || "n/a"} />
                <Info label="Landmark" value={order.landmark || "n/a"} />
                <Info label="Delivery notes" value={order.delivery_notes || "n/a"} />
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-white">Status flow</h3>
              <div className="text-sm text-zinc-400">Website payment actions update the live database.</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {ORDER_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => handleStatusChange(status)}
                  className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                    order.status === status
                      ? "bg-blue-500 text-black"
                      : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Items</h3>
            <div className="mt-4 space-y-3">
              {previewItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                  No line items available for this order.
                </div>
              ) : (
                previewItems.map((item, index) => (
                  <div key={String(item.id || index)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="font-semibold text-white">{item.product_name || item.name || "Item"}</div>
                        <div className="mt-1 text-sm text-zinc-400">
                          {item.color || "Default"} / {item.size || "One size"} â€¢ SKU {item.sku || "n/a"}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <MiniStat label="Qty" value={item.quantity || 0} />
                        <MiniStat label="Price" value={formatCurrency(item.price || 0)} />
                        <MiniStat label="Line" value={formatCurrency((item.price || 0) * (item.quantity || 0))} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Add internal notes, delivery instructions, or payment remarks..."
              className="mt-4 w-full rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleSaveNotes}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-semibold text-black"
              >
                <Save className="h-4 w-4" />
                Save notes
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-white">Timeline</h3>
              <button type="button" onClick={loadOrder} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {timeline.map((event, index) => (
                <div key={`${event.label}-${index}`} className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-400" />
                  <div>
                    <div className="font-semibold text-white">{event.label}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatDateTime(event.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {paymentReviewVisible ? (
            <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-5 shadow-2xl shadow-black/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-amber-300">Payment proof</div>
                  <h3 className="mt-2 text-xl font-black text-white">مراجعة إثبات التحويل</h3>
                </div>
                <StatusBadge value={order.paymentStatus} />
              </div>

              <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/70">
                {shippingProofInvalid ? (
                  <div className="grid min-h-64 place-items-center px-4 py-10 text-center text-sm font-semibold text-rose-200">
                    صورة إثبات التحويل غير صالحة
                  </div>
                ) : paymentProofUrl ? (
                  <div className="p-4">
                    <button
                      type="button"
                      onClick={() => window.open(paymentProofUrl, "_blank", "noopener,noreferrer")}
                      className="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-black/30"
                    >
                      <img
                        src={paymentProofUrl}
                        alt="Shipping payment proof"
                        className="max-h-[32rem] w-full object-contain bg-black/30 transition group-hover:opacity-90"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(paymentProofUrl, "_blank", "noopener,noreferrer")}
                      className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      <ExternalLink className="h-4 w-4" />
                      فتح الصورة
                    </button>
                  </div>
                ) : (
                  <div className="grid min-h-64 place-items-center px-4 py-10 text-center text-sm font-semibold text-zinc-500">
                    No payment proof image found.
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Info label="طريقة الدفع" value={formatShippingPaymentMethodLabel(order.shipping_payment_method || order.payment_method)} />
                <Info label="قيمة الشحن" value={formatCurrency(order.shipping_fee || order.delivery_fee || 0)} />
                <Info label="رقم/هاندل التحويل" value={order.shipping_payment_reference || "غير متاح"} />
                <Info label="حالة الدفع الحالية" value={paymentSummaryStatus} />
              </div>

              {isAwaitingPaymentVerification ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleShippingPaymentReview("confirm")}
                    disabled={reviewingPayment || !canReviewShippingProof}
                    className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Confirm Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShippingPaymentReview("reject")}
                    disabled={reviewingPayment || !canReviewShippingProof}
                    className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-rose-950/20 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reject Payment
                  </button>
                </div>
              ) : (
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black ${
                  isShippingPaid
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-200"
                }`}>
                  {isShippingPaid ? "تم تأكيد الدفع" : "تم رفض إثبات التحويل"}
                </div>
              )}
            </div>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-white">Payment summary</h3>
              <div className="text-sm text-zinc-400">{paymentSummaryStatus}</div>
            </div>
            <div className="mt-4 inline-flex rounded-2xl border border-white/10 bg-white/5 p-1 text-xs font-semibold text-zinc-300">
              <button
                type="button"
                onClick={() => setPdfFormat("a4")}
                className={`rounded-xl px-3 py-2 transition ${
                  pdfFormat === "a4" ? "bg-blue-500 text-black" : "hover:bg-white/10"
                }`}
              >
                A4 PDF
              </button>
              <button
                type="button"
                onClick={() => setPdfFormat("thermal")}
                className={`rounded-xl px-3 py-2 transition ${
                  pdfFormat === "thermal" ? "bg-blue-500 text-black" : "hover:bg-white/10"
                }`}
              >
                Thermal PDF
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Info label="Subtotal" value={formatCurrency(order.total)} />
              <Info label="Delivery fee" value={formatCurrency(order.delivery_fee || order.shipping_fee || 0)} />
              <Info label="COD amount" value={formatCurrency(order.cod_amount || 0)} />
              <Info label="Refund status" value={order.status === "Returned" ? "Returned" : "Active"} />
              <Info label="Payment status" value={paymentSummaryStatus} />
            </div>
          </div>

          <div ref={invoiceRef}>
            <OrderInvoiceCard order={order} items={previewItems} compact />
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Shipping</h3>
            <div className="mt-4 grid gap-3">
              <select
                value={shipping.provider}
                onChange={(e) => setShipping((prev) => ({ ...prev, provider: e.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              >
                {["manual", "bosta", "mylerz", "aramex", "store_pickup"].map((provider) => (
                  <option key={provider} value={provider} className="bg-zinc-950 text-white">
                    {provider}
                  </option>
                ))}
              </select>
              <input
                value={shipping.shipment_id}
                onChange={(e) => setShipping((prev) => ({ ...prev, shipment_id: e.target.value }))}
                placeholder="Shipment id"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                value={shipping.tracking_number}
                onChange={(e) => setShipping((prev) => ({ ...prev, tracking_number: e.target.value }))}
                placeholder="Tracking number"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <select
                value={shipping.shipping_status}
                onChange={(e) => setShipping((prev) => ({ ...prev, shipping_status: e.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
              >
                {SHIPPING_STATUSES.map((status) => (
                  <option key={status} value={status} className="bg-zinc-950 text-white">
                    {status}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={shipping.delivery_fee}
                onChange={(e) => setShipping((prev) => ({ ...prev, delivery_fee: Number(e.target.value || 0) }))}
                placeholder="Delivery fee"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={shipping.cod_amount}
                onChange={(e) => setShipping((prev) => ({ ...prev, cod_amount: Number(e.target.value || 0) }))}
                placeholder="COD amount"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <textarea
                value={shipping.courier_notes}
                onChange={(e) => setShipping((prev) => ({ ...prev, courier_notes: e.target.value }))}
                rows={4}
                placeholder="Courier notes"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <input
                value={shipping.tracking_url}
                onChange={(e) => setShipping((prev) => ({ ...prev, tracking_url: e.target.value }))}
                placeholder="Tracking URL"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={handleSaveShipping}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-semibold text-black"
              >
                <Truck className="h-4 w-4" />
                Save shipping
              </button>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={handleCreateShipment} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">
                  Create shipment
                </button>
                <button type="button" onClick={handlePrint} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">
                  Print label
                </button>
                <button
                  type="button"
                  onClick={() => shipping.tracking_url && window.open(shipping.tracking_url, "_blank", "noopener,noreferrer")}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                >
                  Track shipment
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ActionButton onClick={handlePrint} icon={<Printer className="h-4 w-4" />} label="Print invoice" />
            <ActionButton onClick={handlePdf} icon={<Download className="h-4 w-4" />} label="Download PDF" />
            <ActionButton onClick={shareWhatsApp} icon={<MessageCircle className="h-4 w-4" />} label="WhatsApp share" />
            <ActionButton onClick={notifyCustomer} icon={<ShieldCheck className="h-4 w-4" />} label="Notify customer" />
            <ActionButton onClick={() => navigate("/orders/returns")} icon={<RefreshCcw className="h-4 w-4" />} label="Return items" />
          </div>
        </div>
      </div>
    </OrdersShell>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-white">{value}</div>
    </div>
  );
}

function ActionButton({ onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
    >
      {icon}
      {label}
    </button>
  );
}

export default OrderDetails;


