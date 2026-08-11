import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AlertTriangle, Clock3, Save } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import {
  formatDateTime,
  getInventoryTransfers,
  normalizeWarehouse,
  saveInventoryTransfers,
  seedWarehouses,
} from "../../purchases/lib/flowStore";

function StockTransfers() {
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [variantId, setVariantId] = useState("");
  const [fromWarehouse, setFromWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await api.get("/warehouses");
        const rows = Array.isArray(data) ? data : data?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      } catch (err) {
        console.log(err);
        setWarehouses(seedWarehouses());
        setError("تم تفعيل البيانات الاحتياطية للتحويلات. قد لا يُرجع مسار الخلفية كل تفاصيل التحويل.");
        toast.error("جارٍ استخدام بيانات تحويل احتياطية");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!fromWarehouse && warehouses.length) setFromWarehouse(String(warehouses[0].id));
    if (!toWarehouse && warehouses.length > 1) setToWarehouse(String(warehouses[1].id));
  }, [warehouses, fromWarehouse, toWarehouse]);

  const transfers = getInventoryTransfers();

  const submitTransfer = async () => {
    if (!variantId.trim()) {
      toast.error("معرّف الاختيار مطلوب");
      return;
    }

    const payload = {
      variant_id: Number(variantId),
      from_warehouse: fromWarehouse,
      to_warehouse: toWarehouse,
      quantity: Number(quantity || 0),
    };

    try {
      await api.post("/warehouses/transfer", payload);
      const record = {
        id: `trf-${Date.now()}`,
        ...payload,
        notes,
        created_at: new Date().toISOString(),
        status: "تم التحويل",
      };
      saveInventoryTransfers([record, ...transfers]);
      toast.success("تم إرسال التحويل");
    } catch (err) {
      console.log(err);
      const record = {
        id: `trf-${Date.now()}`,
        ...payload,
        notes,
        created_at: new Date().toISOString(),
        status: "مسودة",
      };
      saveInventoryTransfers([record, ...transfers]);
      toast.error("مسار التحويل غير متاح. تم الحفظ محليًا.");
    }
  };

  return (
    <InventoryShell
      title="تحويل المخزون بين المخازن"
      subtitle="إدارة تحويلات المخزون بين المخازن، ومراجعة السجل المحلي، وحفظ تفاصيل التحويل عندما تكون واجهة الخلفية غير مكتملة."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Clock3 className="mr-2 inline h-4 w-4" />
            سجل الاختيارات
          </Link>
          <Link to="/warehouses" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            لوحة المخازن
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "المخزون", end: true },
        { to: "/inventory/movements", label: "الحركات" },
        { to: "/inventory/adjustments", label: "التسويات" },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: "التحويلات", end: true },
        { to: "/warehouses", label: "المخازن" },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="معرّف الاختيار" value={variantId} onChange={setVariantId} placeholder="أدخل معرّف الاختيار" />
            <Select label="من مخزن" value={fromWarehouse} onChange={setFromWarehouse} options={warehouses} />
            <Select label="إلى مخزن" value={toWarehouse} onChange={setToWarehouse} options={warehouses} />
            <Field label="الكمية" value={quantity} onChange={setQuantity} type="number" />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">ملاحظات التحويل</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="ملاحظات التعبئة، تفاصيل السائق، سبب التحويل..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>
          <button
            type="button"
            onClick={submitTransfer}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-black"
          >
            <Save className="h-4 w-4" />
            إرسال التحويل
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">سجل التحويلات</h3>
            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">جارٍ تحميل المخازن...</div>
              ) : transfers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">لا توجد تحويلات محفوظة محليًا.</div>
              ) : (
                transfers.map((transfer) => (
                  <div key={String(transfer.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">الاختيار {transfer.variant_id}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatDateTime(transfer.created_at)}</div>
                      </div>
                      <StatusBadge value={transfer.status || "مسودة"} />
                    </div>
                    <div className="mt-2 text-sm text-zinc-300">
                      {transfer.from_warehouse} ← {transfer.to_warehouse} • الكمية {transfer.quantity}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">تحويل المخزون بين المخازن</h3>
            <p className="mt-3 text-sm text-zinc-400">
              تحافظ هذه الصفحة على سير العمل حتى عندما تكون بيانات التحويل في الخلفية غير مكتملة. يتم حفظ السجل محليًا، ويُستخدم مسار التحويل المباشر عندما يكون متاحًا.
            </p>
          </div>
        </div>
      </div>
    </InventoryShell>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
        {options.map((option) => (
          <option key={String(option.id)} value={String(option.id)} className="bg-zinc-950 text-white">
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default StockTransfers;
