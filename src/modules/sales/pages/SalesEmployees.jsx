import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { BriefcaseBusiness, Calculator, RefreshCw, Save, Search, UserPlus } from "lucide-react";

import {
  createSalesEmployee,
  getSalesCommissionPayroll,
  getSalesCommissionReport,
  getSalesEmployees,
  updateSalesEmployee,
  updateSalesEmployeeSettings,
} from "../services/salesEmployeesApi";
import { getProductsWithVariants } from "../../products/services/productsApi";
import { formatCurrency } from "../../pos/lib/posUtils";

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

const emptyForm = {
  id: null,
  name: "",
  code: "",
  phone: "",
  is_active: true,
  commission_type: "percent",
  commission_value: 0,
  excluded_product_ids: [],
};

const numberValue = (value) => Number(value || 0);

function SalesEmployees() {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({ allow_sale_without_salesperson: true, fixed_commission_mode: "fixed_per_invoice" });
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({ start_date: monthStart, end_date: today, employee_id: "", branch_id: "" });
  const [payroll, setPayroll] = useState({ employee_id: "", base_salary: 0, bonuses: 0, deductions: 0 });
  const [report, setReport] = useState({ rows: [], summary: {} });
  const [payrollPreview, setPayrollPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products
      .filter((item) => !q || `${item.name || item.product_name || ""} ${item.sku || ""}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [products, productSearch]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [employeesRes, productsRes, reportRes] = await Promise.all([
        getSalesEmployees({ params: { include_inactive: true } }),
        getProductsWithVariants(),
        getSalesCommissionReport(filters),
      ]);
      setEmployees(employeesRes.employees || []);
      setSettings(employeesRes.settings || settings);
      setProducts(Array.isArray(productsRes) ? productsRes : []);
      setReport({ rows: reportRes.rows || [], summary: reportRes.summary || {} });
    } catch (error) {
      toast.error(error?.message || "Failed to load sales staff");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const refreshReport = async () => {
    const reportRes = await getSalesCommissionReport(filters);
    setReport({ rows: reportRes.rows || [], summary: reportRes.summary || {} });
  };

  const saveEmployee = async () => {
    try {
      setSaving(true);
      const payload = {
        ...form,
        commission_value: numberValue(form.commission_value),
        excluded_product_ids: form.excluded_product_ids.map(Number),
      };
      if (form.id) {
        await updateSalesEmployee(form.id, payload);
      } else {
        await createSalesEmployee(payload);
      }
      toast.success("Sales employee saved");
      setForm(emptyForm);
      await loadAll();
    } catch (error) {
      toast.error(error?.message || "Unable to save employee");
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    const result = await updateSalesEmployeeSettings(settings);
    setSettings(result.settings || settings);
    toast.success("Sales settings saved");
  };

  const previewPayroll = async () => {
    if (!payroll.employee_id) {
      toast.error("Select an employee for payroll preview");
      return;
    }
    const data = await getSalesCommissionPayroll(payroll.employee_id, { ...filters, ...payroll });
    setPayrollPreview(data);
  };

  const toggleExcludedProduct = (productId) => {
    setForm((prev) => {
      const id = Number(productId);
      const set = new Set(prev.excluded_product_ids.map(Number));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, excluded_product_ids: Array.from(set) };
    });
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 text-[var(--text)] md:p-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.24em] text-[var(--primary)]">Sales Staff</div>
          <h1 className="mt-2 text-3xl font-black">Sales Staff + Commissions</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">POS assignment, item-level commission exclusions, reports, and payroll previews.</p>
        </div>
        <button onClick={loadAll} className="theme-button-soft px-4 py-3 text-sm">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="theme-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">{form.id ? "Edit employee" : "Add employee"}</h2>
            <UserPlus className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div className="grid gap-3">
            <Field label="Name" value={form.name} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" value={form.code} onChange={(value) => setForm((prev) => ({ ...prev, code: value }))} />
              <Field label="Phone" value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Commission type</span>
                <select value={form.commission_type} onChange={(e) => setForm((prev) => ({ ...prev, commission_type: e.target.value }))} className="mt-2 w-full bg-transparent font-bold outline-none">
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <Field type="number" label="Value" value={form.commission_value} onChange={(value) => setForm((prev) => ({ ...prev, commission_value: value }))} />
            </div>
            <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-bold">
              Active
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
            </label>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-[var(--muted)]" />
                <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products to exclude" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {filteredProducts.map((product) => {
                  const productId = Number(product.id || product.product_id);
                  const active = form.excluded_product_ids.map(Number).includes(productId);
                  return (
                    <button
                      key={productId}
                      type="button"
                      onClick={() => toggleExcludedProduct(productId)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-rose-300/40 bg-rose-500/20 text-rose-100" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"}`}
                    >
                      {product.name || product.product_name}
                    </button>
                  );
                })}
              </div>
            </div>

            <button disabled={saving} onClick={saveEmployee} className="theme-button-primary px-4 py-3 text-sm">
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save employee"}
            </button>
          </div>
        </section>

        <main className="space-y-4">
          <section className="theme-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-black">POS commission settings</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Controls checkout blocking and fixed commission behavior.</p>
              </div>
              <button onClick={saveSettings} className="theme-button-soft px-4 py-3 text-sm">Save settings</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-bold">
                Allow sale without salesperson
                <input type="checkbox" checked={settings.allow_sale_without_salesperson} onChange={(e) => setSettings((prev) => ({ ...prev, allow_sale_without_salesperson: e.target.checked }))} />
              </label>
              <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Fixed mode</span>
                <select value={settings.fixed_commission_mode} onChange={(e) => setSettings((prev) => ({ ...prev, fixed_commission_mode: e.target.value }))} className="mt-2 w-full bg-transparent font-bold outline-none">
                  <option value="fixed_per_invoice">Fixed per invoice</option>
                  <option value="fixed_per_item">Fixed per item</option>
                </select>
              </label>
            </div>
          </section>

          <section className="theme-card p-4">
            <h2 className="mb-4 text-xl font-black">Employees</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {employees.map((employee) => (
                <button key={employee.id} onClick={() => setForm({ ...emptyForm, ...employee, excluded_product_ids: employee.excluded_product_ids || [] })} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--primary)]/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black">{employee.name}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{employee.code || "No code"} · {employee.phone || "No phone"}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black ${employee.is_active ? "bg-emerald-500/15 text-emerald-200" : "bg-zinc-500/15 text-zinc-300"}`}>{employee.is_active ? "Active" : "Inactive"}</span>
                  </div>
                  <div className="mt-4 text-sm font-bold text-[var(--primary)]">
                    {employee.commission_type === "percent" ? `${employee.commission_value}%` : formatCurrency(employee.commission_value)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{(employee.excluded_product_ids || []).length} excluded products</div>
                </button>
              ))}
            </div>
          </section>

          <section className="theme-card p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-black">Commission report</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Item-level net sales with returns and exclusions applied.</p>
              </div>
              <button onClick={refreshReport} className="theme-button-soft px-4 py-3 text-sm">Apply filters</button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field type="date" label="Start" value={filters.start_date} onChange={(value) => setFilters((prev) => ({ ...prev, start_date: value }))} />
              <Field type="date" label="End" value={filters.end_date} onChange={(value) => setFilters((prev) => ({ ...prev, end_date: value }))} />
              <Select label="Employee" value={filters.employee_id} onChange={(value) => setFilters((prev) => ({ ...prev, employee_id: value }))} options={[{ value: "", label: "All employees" }, ...employees.map((item) => ({ value: item.id, label: item.name }))]} />
              <Field label="Branch ID" value={filters.branch_id} onChange={(value) => setFilters((prev) => ({ ...prev, branch_id: value }))} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-6">
              <Metric label="Sales" value={formatCurrency(report.summary.total_sales || 0)} />
              <Metric label="Invoices" value={report.summary.total_invoices || 0} />
              <Metric label="Items" value={report.summary.total_items_sold || 0} />
              <Metric label="Returns" value={report.summary.returns_refunds || 0} />
              <Metric label="Net sales" value={formatCurrency(report.summary.net_sales || 0)} />
              <Metric label="Commissions" value={formatCurrency(report.summary.earned_commissions || 0)} />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="text-left text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Sales</th>
                    <th className="px-3 py-2">Invoices</th>
                    <th className="px-3 py-2">Items</th>
                    <th className="px-3 py-2">Returns</th>
                    <th className="px-3 py-2">Net</th>
                    <th className="px-3 py-2">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.rows || []).map((row) => (
                    <tr key={row.salesperson_id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-3 font-bold">{row.salesperson_name}</td>
                      <td className="px-3 py-3">{formatCurrency(row.total_sales)}</td>
                      <td className="px-3 py-3">{row.total_invoices}</td>
                      <td className="px-3 py-3">{row.total_items_sold}</td>
                      <td className="px-3 py-3">{row.returns_refunds}</td>
                      <td className="px-3 py-3">{formatCurrency(row.net_sales)}</td>
                      <td className="px-3 py-3 font-black text-emerald-300">{formatCurrency(row.earned_commissions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="theme-card p-4">
            <div className="mb-4 flex items-center gap-3">
              <Calculator className="h-5 w-5 text-[var(--primary)]" />
              <h2 className="text-xl font-black">Payroll breakdown preview</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <Select label="Employee" value={payroll.employee_id} onChange={(value) => setPayroll((prev) => ({ ...prev, employee_id: value }))} options={[{ value: "", label: "Select employee" }, ...employees.map((item) => ({ value: item.id, label: item.name }))]} />
              <Field type="number" label="Base salary" value={payroll.base_salary} onChange={(value) => setPayroll((prev) => ({ ...prev, base_salary: value }))} />
              <Field type="number" label="Bonuses" value={payroll.bonuses} onChange={(value) => setPayroll((prev) => ({ ...prev, bonuses: value }))} />
              <Field type="number" label="Deductions" value={payroll.deductions} onChange={(value) => setPayroll((prev) => ({ ...prev, deductions: value }))} />
              <button onClick={previewPayroll} className="theme-button-primary mt-6 px-4 py-3 text-sm">
                <BriefcaseBusiness className="h-4 w-4" />
                Preview
              </button>
            </div>
            {payrollPreview ? (
              <div className="mt-4 grid gap-3 md:grid-cols-5">
                <Metric label="Base salary" value={formatCurrency(payrollPreview.payroll.base_salary)} />
                <Metric label="Commissions" value={formatCurrency(payrollPreview.payroll.commissions)} />
                <Metric label="Bonuses" value={formatCurrency(payrollPreview.payroll.bonuses)} />
                <Metric label="Deductions" value={`- ${formatCurrency(payrollPreview.payroll.deductions)}`} />
                <Metric label="Final salary" value={formatCurrency(payrollPreview.payroll.final_salary)} />
              </div>
            ) : null}
          </section>
        </main>
      </div>

      {loading ? <div className="fixed inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/80 px-4 py-2 text-sm font-bold text-white">Loading sales staff...</div> : null}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full bg-transparent font-bold outline-none" />
    </label>
  );
}

function Select({ label, value, onChange, options = [] }) {
  return (
    <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full bg-transparent font-bold outline-none">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </div>
  );
}

export default SalesEmployees;
