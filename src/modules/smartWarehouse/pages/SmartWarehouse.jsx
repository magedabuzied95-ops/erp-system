import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Boxes,
  Check,
  ClipboardList,
  Flame,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  Smartphone,
  Warehouse,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import InventoryShell from "../../inventory/components/InventoryShell";
import { smartWarehouseApi } from "../services/smartWarehouseApi";

const tabs = [
  { id: "count", label: "Quick Count", icon: Smartphone },
  { id: "sections", label: "Sections", icon: Warehouse },
  { id: "qr", label: "Master QR", icon: QrCode },
  { id: "cycle", label: "Cycle Count", icon: ClipboardList },
  { id: "reports", label: "Reports", icon: Flame },
];

const emptyReports = {
  discrepancies: [],
  deadStock: [],
  alerts: [],
  heatmap: [],
  transfers: [],
};

function SmartWarehouse() {
  const [activeTab, setActiveTab] = useState("count");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [sections, setSections] = useState([]);
  const [cycleTasks, setCycleTasks] = useState([]);
  const [counts, setCounts] = useState([]);
  const [reports, setReports] = useState(emptyReports);
  const [form, setForm] = useState({
    branch_id: "",
    warehouse_id: "",
    section_id: "",
    section_scan: "",
    model_scan: "",
  });
  const [productData, setProductData] = useState(null);
  const [actuals, setActuals] = useState({});
  const [sectionDraft, setSectionDraft] = useState({ code: "", name: "", color: "#2563eb", notes: "" });
  const [productId, setProductId] = useState("");
  const [generatedQr, setGeneratedQr] = useState(null);

  const selectedSection = useMemo(
    () => sections.find((section) => String(section.id) === String(form.section_id)),
    [sections, form.section_id]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [branchRes, warehouseRes, sectionRes, cycleRes, countsRes, reportsRes] = await Promise.allSettled([
        api.get("/branches"),
        api.get("/warehouses"),
        smartWarehouseApi.sections({ limit: 200 }),
        smartWarehouseApi.cycleTasks({ limit: 30 }),
        smartWarehouseApi.counts({ limit: 20 }),
        smartWarehouseApi.reports(),
      ]);

      if (branchRes.status === "fulfilled") {
        const rows = Array.isArray(branchRes.value) ? branchRes.value : branchRes.value?.branches || [];
        setBranches(rows);
      }
      if (warehouseRes.status === "fulfilled") {
        const rows = Array.isArray(warehouseRes.value) ? warehouseRes.value : warehouseRes.value?.warehouses || [];
        setWarehouses(rows);
      }
      if (sectionRes.status === "fulfilled") setSections(sectionRes.value.sections || []);
      if (cycleRes.status === "fulfilled") setCycleTasks(cycleRes.value.tasks || []);
      if (countsRes.status === "fulfilled") setCounts(countsRes.value.counts || []);
      if (reportsRes.status === "fulfilled") setReports(reportsRes.value.reports || emptyReports);
    } catch (error) {
      toast.error(error.message || "Failed to load smart warehouse data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const scanSection = async () => {
    if (!form.section_scan.trim()) return;
    try {
      const result = await smartWarehouseApi.sectionByCode(form.section_scan.trim());
      const section = result.section;
      setForm((current) => ({
        ...current,
        section_id: section.id,
        warehouse_id: current.warehouse_id || section.warehouse_id || "",
        branch_id: current.branch_id || section.branch_id || "",
      }));
      toast.success("Section loaded");
    } catch (error) {
      toast.error(error.message || "Section not found");
    }
  };

  const scanMasterQr = async () => {
    if (!form.model_scan.trim()) return;
    try {
      const result = await smartWarehouseApi.masterQr(form.model_scan.trim());
      setProductData(result);
      const nextActuals = {};
      (result.variants || []).forEach((variant) => {
        nextActuals[variant.id] = Number(variant.stock || 0);
      });
      setActuals(nextActuals);
      toast.success("Model loaded");
    } catch (error) {
      toast.error(error.message || "Master QR not found");
    }
  };

  const changeActual = (variantId, delta) => {
    setActuals((current) => ({
      ...current,
      [variantId]: Math.max(0, Number(current[variantId] || 0) + delta),
    }));
  };

  const saveCount = async () => {
    if (!form.warehouse_id || !productData?.variants?.length) {
      toast.error("Select warehouse and scan a model first");
      return;
    }

    try {
      setSaving(true);
      const items = productData.variants.map((variant) => ({
        product_id: variant.product_id,
        variant_id: variant.id,
        expected_qty: Number(variant.stock || 0),
        actual_qty: Number(actuals[variant.id] || 0),
      }));
      await smartWarehouseApi.saveQuickCount({
        branch_id: form.branch_id || null,
        warehouse_id: form.warehouse_id,
        section_id: form.section_id || null,
        count_type: "quick_scan",
        items,
      });
      toast.success("Count saved and movements created");
      setProductData(null);
      setActuals({});
      await loadData();
    } catch (error) {
      toast.error(error.message || "Failed to save count");
    } finally {
      setSaving(false);
    }
  };

  const saveSection = async () => {
    if (!form.warehouse_id || !sectionDraft.code.trim()) {
      toast.error("Warehouse and section code are required");
      return;
    }
    try {
      const result = await smartWarehouseApi.createSection({
        ...sectionDraft,
        branch_id: form.branch_id || null,
        warehouse_id: form.warehouse_id,
      });
      setSections((current) => [result.section, ...current.filter((section) => section.id !== result.section.id)]);
      setSectionDraft({ code: "", name: "", color: "#2563eb", notes: "" });
      toast.success("Section saved");
    } catch (error) {
      toast.error(error.message || "Failed to save section");
    }
  };

  const generateQr = async () => {
    if (!productId.trim()) return;
    try {
      const result = await smartWarehouseApi.generateMasterQr(productId.trim());
      setGeneratedQr(result.qr);
      toast.success("Master QR ready");
    } catch (error) {
      toast.error(error.message || "Failed to generate master QR");
    }
  };

  return (
    <InventoryShell
      title="Smart Warehouse"
      subtitle="Model QR counting, section organization, cycle count tasks, movement-ready adjustments, and AI-ready inventory analytics."
      actions={
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      }
      tabs={[
        { to: "/inventory", label: "Inventory", end: true },
        { to: "/smart-warehouse", label: "Smart Warehouse", end: true },
        { to: "/inventory/movements", label: "Movements" },
        { to: "/stock-transfers", label: "Transfers" },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition ${
                active
                  ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? <Skeleton /> : null}

      {activeTab === "count" ? (
        <QuickCount
          form={form}
          setForm={setForm}
          branches={branches}
          warehouses={warehouses}
          sections={sections}
          selectedSection={selectedSection}
          productData={productData}
          actuals={actuals}
          saving={saving}
          scanSection={scanSection}
          scanMasterQr={scanMasterQr}
          changeActual={changeActual}
          saveCount={saveCount}
        />
      ) : null}

      {activeTab === "sections" ? (
        <SectionsPanel
          form={form}
          setForm={setForm}
          branches={branches}
          warehouses={warehouses}
          sections={sections}
          draft={sectionDraft}
          setDraft={setSectionDraft}
          saveSection={saveSection}
        />
      ) : null}

      {activeTab === "qr" ? (
        <MasterQrPanel productId={productId} setProductId={setProductId} generatedQr={generatedQr} generateQr={generateQr} />
      ) : null}

      {activeTab === "cycle" ? <CyclePanel tasks={cycleTasks} counts={counts} /> : null}

      {activeTab === "reports" ? <ReportsPanel reports={reports} /> : null}
    </InventoryShell>
  );
}

function QuickCount({ form, setForm, branches, warehouses, sections, selectedSection, productData, actuals, saving, scanSection, scanMasterQr, changeActual, saveCount }) {
  const variants = productData?.variants || [];
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="grid gap-3">
          <Select label="Branch" value={form.branch_id} onChange={(value) => setForm((current) => ({ ...current, branch_id: value }))} rows={branches} />
          <Select label="Warehouse" value={form.warehouse_id} onChange={(value) => setForm((current) => ({ ...current, warehouse_id: value }))} rows={warehouses} />
          <Select label="Section" value={form.section_id} onChange={(value) => setForm((current) => ({ ...current, section_id: value }))} rows={sections} labelKey="code" />

          <ScanInput
            label="Scan section QR"
            value={form.section_scan}
            onChange={(value) => setForm((current) => ({ ...current, section_scan: value }))}
            onSubmit={scanSection}
            placeholder="MEN-SHOES-41"
          />
          <ScanInput
            label="Scan model QR"
            value={form.model_scan}
            onChange={(value) => setForm((current) => ({ ...current, model_scan: value }))}
            onSubmit={scanMasterQr}
            placeholder="MODEL-..."
          />
        </div>
        {selectedSection ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Active section</div>
            <div className="mt-1 text-xl font-black text-[var(--text)]">{selectedSection.code}</div>
            <div className="mt-2 h-2 rounded-full" style={{ background: selectedSection.color || "#2563eb" }} />
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {!productData ? (
          <EmptyState icon={QrCode} title="Scan a master model QR" text="The model QR opens the product, all colors, all sizes, warehouse locations, and a fast counting grid." />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm text-[var(--muted)]">Model-level count</div>
                <h2 className="text-2xl font-black text-[var(--text)]">{productData.product?.name}</h2>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  {productData.colors?.length || 0} colors / {productData.sizes?.length || 0} sizes / stock {productData.totalStock || 0}
                </div>
              </div>
              <button
                type="button"
                onClick={saveCount}
                disabled={saving}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {saving ? "Saving..." : "Save Count"}
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[720px] space-y-2">
                <div className="grid grid-cols-[1fr_1fr_120px_170px_120px] rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  <div>Color</div>
                  <div>Size</div>
                  <div>Expected</div>
                  <div>Actual</div>
                  <div>Diff</div>
                </div>
                {variants.map((variant) => {
                  const expected = Number(variant.stock || 0);
                  const actual = Number(actuals[variant.id] || 0);
                  const diff = actual - expected;
                  return (
                    <div key={variant.id} className="grid grid-cols-[1fr_1fr_120px_170px_120px] items-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                      <div className="font-semibold text-[var(--text)]">{variant.color || "Default"}</div>
                      <div className="font-semibold text-[var(--text)]">{variant.size || "One Size"}</div>
                      <div>{expected}</div>
                      <div className="flex items-center gap-2">
                        <IconButton label="Decrease" onClick={() => changeActual(variant.id, -1)} icon={Minus} />
                        <div className="flex h-11 w-14 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-lg font-black">{actual}</div>
                        <IconButton label="Increase" onClick={() => changeActual(variant.id, 1)} icon={Plus} />
                      </div>
                      <div className={diff === 0 ? "font-black text-emerald-400" : diff > 0 ? "font-black text-blue-400" : "font-black text-rose-400"}>{diff}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionsPanel({ form, setForm, branches, warehouses, sections, draft, setDraft, saveSection }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <Select label="Branch" value={form.branch_id} onChange={(value) => setForm((current) => ({ ...current, branch_id: value }))} rows={branches} />
        <div className="mt-3">
          <Select label="Warehouse" value={form.warehouse_id} onChange={(value) => setForm((current) => ({ ...current, warehouse_id: value }))} rows={warehouses} />
        </div>
        <TextInput label="Code" value={draft.code} onChange={(value) => setDraft((current) => ({ ...current, code: value }))} placeholder="MEN-SHOES-41" />
        <TextInput label="Name" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder="Men Shoes Size 41" />
        <TextInput label="Color" value={draft.color} onChange={(value) => setDraft((current) => ({ ...current, color: value }))} placeholder="#2563eb" />
        <TextInput label="Notes" value={draft.notes} onChange={(value) => setDraft((current) => ({ ...current, notes: value }))} placeholder="Aisle, shelf, or season notes" />
        <button type="button" onClick={saveSection} className="mt-4 w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white">
          Save Section
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <div key={section.id} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-[var(--text)]">{section.code}</div>
                <div className="text-sm text-[var(--muted)]">{section.name || section.warehouse_name}</div>
              </div>
              <div className="h-8 w-8 rounded-full border border-[var(--border)]" style={{ background: section.color || "#2563eb" }} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="rounded-2xl bg-white p-2">
                <QRCode value={section.qr_code || section.code} size={72} />
              </div>
              <div className="text-right text-sm text-[var(--muted)]">
                <div>{section.variant_count || 0} variants</div>
                <div>{section.stock_qty || 0} units</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MasterQrPanel({ productId, setProductId, generatedQr, generateQr }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <TextInput label="Product ID" value={productId} onChange={setProductId} placeholder="Product database id" />
        <button type="button" onClick={generateQr} className="mt-4 w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white">
          Generate Master QR
        </button>
      </div>
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
        {!generatedQr ? (
          <EmptyState icon={QrCode} title="No QR generated yet" text="Generate one model-level QR per product and place it on product cards, bins, or warehouse labels." />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="rounded-3xl bg-white p-5">
              <QRCode value={generatedQr.qr_value} size={180} />
            </div>
            <div>
              <div className="text-sm text-[var(--muted)]">Master QR value</div>
              <div className="mt-2 break-all text-2xl font-black text-[var(--text)]">{generatedQr.qr_value}</div>
              <div className="mt-3 text-sm text-[var(--muted)]">Model-level, not variant-level. Scanning this opens the full variant stock matrix.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CyclePanel({ tasks, counts }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <DataList title="Smart Daily Cycle Tasks" rows={tasks} render={(task) => (
        <>
          <div className="font-black text-[var(--text)]">{task.product_name}</div>
          <div className="mt-1 text-sm text-[var(--muted)]">{task.color || "Default"} / {task.size || "One Size"} / {task.sku || "No SKU"}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <Badge>{task.reason}</Badge>
            <Badge>sold {task.sold_30d || 0}</Badge>
            <Badge>stock {task.stock || 0}</Badge>
          </div>
        </>
      )} />
      <DataList title="Recent Counts" rows={counts} render={(count) => (
        <>
          <div className="font-black text-[var(--text)]">{count.section_code || count.warehouse_name || "Inventory count"}</div>
          <div className="mt-1 text-sm text-[var(--muted)]">{count.count_type} / {count.status}</div>
          <div className="mt-3 flex gap-2 text-xs font-bold">
            <Badge>{count.item_count || 0} items</Badge>
            <Badge>{count.discrepancy_qty || 0} discrepancy</Badge>
          </div>
        </>
      )} />
    </div>
  );
}

function ReportsPanel({ reports }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <DataList title="Discrepancies" rows={reports.discrepancies} render={(row) => <ReportRow row={row} value={row.difference_qty} />} />
      <DataList title="Dead Stock" rows={reports.deadStock} render={(row) => <ReportRow row={row} value={row.last_sold_at ? new Date(row.last_sold_at).toLocaleDateString() : "Never sold"} />} />
      <DataList title="Smart Alerts" rows={reports.alerts} render={(row) => <ReportRow row={row} value={row.alert_type} />} />
      <DataList title="Transfer Recommendations" rows={reports.transfers} render={(row) => <ReportRow row={row} value={`${row.source_stock || 0} > ${row.target_stock || 0}`} />} />
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 xl:col-span-2">
        <h3 className="text-xl font-black text-[var(--text)]">Warehouse Heatmap</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {reports.heatmap.map((section) => (
            <div key={section.id} className="rounded-2xl border border-[var(--border)] p-4" style={{ background: `color-mix(in srgb, ${section.color || "#2563eb"} 18%, var(--card))` }}>
              <div className="font-black text-[var(--text)]">{section.code}</div>
              <div className="mt-2 text-sm text-[var(--muted)]">{section.stock_qty || 0} stock / {section.discrepancy_qty || 0} discrepancy</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportRow({ row, value }) {
  return (
    <>
      <div className="font-black text-[var(--text)]">{row.product_name}</div>
      <div className="mt-1 text-sm text-[var(--muted)]">{row.color || "Default"} / {row.size || "One Size"} / {row.sku || "No SKU"}</div>
      <div className="mt-3"><Badge>{value}</Badge></div>
    </>
  );
}

function DataList({ title, rows, render }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-xl font-black text-[var(--text)]">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows?.length ? rows.map((row, index) => (
          <div key={row.id || row.variant_id || index} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            {render(row)}
          </div>
        )) : <EmptyState icon={Boxes} title="No records" text="Data will appear here after inventory activity is recorded." compact />}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, rows, labelKey = "name" }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none">
        <option value="">Select {label.toLowerCase()}</option>
        {rows.map((row) => <option key={row.id} value={row.id}>{row[labelKey] || row.name || row.code || row.id}</option>)}
      </select>
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <label className="mt-3 block">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]" />
    </label>
  );
}

function ScanInput({ label, value, onChange, onSubmit, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
          placeholder={placeholder}
          className="min-h-12 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-base font-semibold text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />
        <button type="button" onClick={onSubmit} className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)] text-white" aria-label={label}>
          <ScanLine className="h-5 w-5" />
        </button>
      </div>
    </label>
  );
}

function IconButton({ label, onClick, icon: Icon }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]">
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Badge({ children }) {
  return <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[var(--text)]">{children}</span>;
}

function EmptyState({ icon: Icon = AlertTriangle, title, text, compact = false }) {
  return (
    <div className={`rounded-3xl border border-dashed border-[var(--border)] bg-[var(--card)] text-center ${compact ? "p-5" : "p-10"}`}>
      <Icon className="mx-auto h-10 w-10 text-[var(--muted)]" />
      <h3 className="mt-3 text-lg font-black text-[var(--text)]">{title}</h3>
      <p className="mt-2 text-sm text-[var(--muted)]">{text}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-3xl border border-[var(--border)] bg-[var(--surface)]" />
      ))}
    </div>
  );
}

export default SmartWarehouse;
