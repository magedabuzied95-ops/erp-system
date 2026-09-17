import { useCallback, useEffect, useState } from "react";
import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";
import { getToken, isAdminUser } from "../../../shared/auth/authStorage";

const labels = { customer_name: "اسم العميل", customer_phone: "هاتف العميل", governorate: "المحافظة", city_area: "المدينة والمنطقة", street_address: "العنوان", jt_region_mapping: "ربط منطقة J&T المعتمد", weight_kg: "وزن الشحنة", jt_sender_profile: "بيانات المرسل", jt_pay_type: "طريقة دفع الشحن", jt_cod_enabled: "تفعيل التحصيل", order_items: "أصناف الطلب", jt_configuration: "إعدادات J&T" };
const message = (error) => error?.responseBody?.message || "تعذر تنفيذ طلب J&T. حاول مرة أخرى أو راجع الإعدادات.";

export default function JtShippingPanel({ orderId }) {
  const [status, setStatus] = useState(null);
  const [weightKg, setWeightKg] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [test, setTest] = useState(null);
  const admin = isAdminUser();
  const refresh = useCallback(async () => {
    if (!admin || !orderId) return;
    try { setStatus(await api.get(`/orders/${orderId}/shipping/jt?weightKg=${encodeURIComponent(weightKg)}`)); }
    catch (error) { setNotice(message(error)); }
  }, [admin, orderId, weightKg]);
  useEffect(() => { refresh(); }, [refresh]);
  if (!admin || !orderId) return null;

  const act = async (action, body = {}) => {
    if (action === "create" && !window.confirm("تأكيد إنشاء شحنة J&T لهذا الطلب؟")) return;
    if (action === "cancel" && !window.confirm("تأكيد إلغاء شحنة J&T؟")) return;
    setBusy(true); setNotice("");
    try {
      const result = await api.post(`/orders/${orderId}/shipping/jt/${action}`, body);
      setNotice(action === "create" ? "تم إنشاء الشحنة." : action === "cancel" ? "تم إلغاء الشحنة." : "تم تحديث بيانات الشحنة.");
      await refresh();
      return result;
    } catch (error) { setNotice(message(error)); return null; }
    finally { setBusy(false); }
  };
  const download = async (sandbox = false) => {
    setBusy(true); setNotice("");
    try {
      const path = sandbox ? "/shipping/jt/sandbox/label" : `/orders/${orderId}/shipping/jt/label`;
      const response = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(sandbox ? { billCode: test.billCode } : {}) });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (blob.type !== "application/pdf" || blob.size < 5) throw new Error();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `JT-${sandbox ? test.billCode : status.shipment.billCode}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setNotice("تعذر تحميل بوليصة J&T."); }
    finally { setBusy(false); }
  };
  const sandbox = status?.environment !== "production";
  const shipment = status?.shipment;
  return <section className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-white" aria-label="J&T Shipping">
    <div className="flex flex-wrap items-center gap-2"><strong>J&T Shipping</strong>{sandbox && <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-black text-black">J&T SANDBOX</span>}</div>
    {sandbox && <p className="mt-2 text-amber-100">طلبات M1 الفعلية مقفلة. الاختبار يستخدم بيانات تجريبية فقط.</p>}
    {shipment ? <div className="mt-3 space-y-1"><div>الحالة: {shipment.status || "قيد الإنشاء"}</div><div>رقم البوليصة: {shipment.billCode || "لم يصدر بعد"}</div><div>آخر تحديث: {shipment.updatedAt ? new Date(shipment.updatedAt).toLocaleString("ar-EG") : "—"}</div>{shipment.tracking?.length > 0 && <div>تحديثات التتبع: {shipment.tracking.length}</div>}</div> : <p className="mt-2 text-zinc-300">لا توجد شحنة J&T لهذا الطلب.</p>}
    {!sandbox && !shipment && <div className="mt-3"><label>الوزن بالكيلوجرام <input className="ml-2 w-24 rounded bg-black/30 p-2" type="number" min="0.01" max="30" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} /></label><button type="button" disabled={busy || !status?.createAllowed} onClick={() => act("create", { weightKg })} className="ml-2 rounded bg-red-600 px-3 py-2 disabled:opacity-50">إنشاء شحنة</button>{status?.missing?.length > 0 && <p className="mt-2 text-amber-100">المطلوب: {status.missing.map((key) => labels[key] || key).join("، ")}</p>}</div>}
    {!sandbox && shipment && <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={() => act("query")}>استعلام</button><button disabled={busy || !shipment.billCode} onClick={() => act("track")}>تتبع</button><button disabled={busy || !shipment.billCode} onClick={() => download()}>تحميل البوليصة</button><button disabled={busy || ["cancelled", "picked_up", "in_transit", "delivered"].includes(shipment.status)} onClick={() => act("cancel")}>إلغاء</button></div>}
    {sandbox && <div className="mt-3"><button disabled={busy} className="rounded bg-amber-400 px-3 py-2 text-black disabled:opacity-50" onClick={async () => { if (!window.confirm("إنشاء شحنة اختبارية مستقلة في J&T Sandbox؟")) return; setBusy(true); try { setTest(await api.post("/shipping/jt/sandbox/orders", {})); setNotice("نجح إنشاء شحنة اختبارية."); } catch (error) { setNotice(message(error)); } finally { setBusy(false); } }}>إنشاء شحنة اختبارية</button>{test?.billCode && <div className="mt-2"><div>رقم الاختبار: {test.txlogisticId} · البوليصة: {test.billCode}</div><div className="mt-2 flex flex-wrap gap-3"><button disabled={busy} onClick={async () => { try { await api.post("/shipping/jt/sandbox/orders/query", { txlogisticId: test.txlogisticId }); setNotice("نجح الاستعلام."); } catch (error) { setNotice(message(error)); } }}>استعلام</button><button disabled={busy} onClick={async () => { try { await api.post("/shipping/jt/sandbox/trace", { billCode: test.billCode }); setNotice("نجح التتبع."); } catch (error) { setNotice(message(error)); } }}>تتبع</button><button disabled={busy} onClick={() => download(true)}>تحميل البوليصة</button><button disabled={busy} onClick={async () => { if (!window.confirm("إلغاء شحنة الاختبار؟")) return; try { await api.post("/shipping/jt/sandbox/orders/cancel", { txlogisticId: test.txlogisticId }); setNotice("تم إلغاء شحنة الاختبار."); } catch (error) { setNotice(message(error)); } }}>إلغاء الاختبار</button></div></div>}</div>}
    {notice && <p role="status" className="mt-3 text-amber-100">{notice}</p>}
  </section>;
}
