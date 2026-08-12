import { useState } from "react";
import { Link } from "react-router-dom";

import { Building2, FileText, Globe, Printer, Save, ShipWheel, Warehouse } from "lucide-react";
import toast from "react-hot-toast";

import SaaSShell from "../components/SaaSShell";
import { useTenant } from "../context/TenantContext";

function CompanySettings() {
  const tenantApi = useTenant();
  const current = tenantApi?.currentTenant || {};
  const [companyName, setCompanyName] = useState(current.companyName || "");
  const [currency, setCurrency] = useState(current.currency || "USD");
  const [language, setLanguage] = useState(current.language || "en");
  const [invoicePrefix, setInvoicePrefix] = useState(current.settings?.invoicePrefix || "INV");
  const [invoiceFooter, setInvoiceFooter] = useState(current.settings?.invoiceFooter || "");
  const [branchNames, setBranchNames] = useState((current.branches || []).join(", "));
  const [posReceipt, setPosReceipt] = useState(current.settings?.posReceipt || "");

  const save = () => {
    if (!current.id) {
      toast.error("Select or create a workspace first");
      return;
    }

    tenantApi?.updateTenant?.(current.id, {
      companyName,
      currency,
      language,
      branches: branchNames.split(",").map((item) => item.trim()).filter(Boolean),
      settings: {
        ...current.settings,
        invoicePrefix,
        invoiceFooter,
        posReceipt,
      },
    });

    toast.success("Company settings saved locally");
  };

  return (
    <SaaSShell
      title="Company Settings"
      subtitle="Company profile, currency, language placeholder, invoice settings, branch settings, and POS settings."
      actions={
        <Link to="/workspace" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <Building2 className="h-4 w-4" />
          Workspace
        </Link>
      }
      tabs={[
        { to: "/workspace", label: "Workspace" },
        { to: "/billing", label: "Billing" },
        { to: "/settings/company", label: "Company settings", end: true },
        { to: "/admin/tenants", label: "Admin tenants" },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">Profile settings</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Company name" value={companyName} onChange={setCompanyName} icon={<Building2 className="h-4 w-4" />} />
            <Field label="Currency" value={currency} onChange={setCurrency} icon={<FileText className="h-4 w-4" />} />
            <Field label="Language placeholder" value={language} onChange={setLanguage} icon={<Globe className="h-4 w-4" />} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Invoice prefix" value={invoicePrefix} onChange={setInvoicePrefix} icon={<Printer className="h-4 w-4" />} />
            <Field label="POS receipt note" value={posReceipt} onChange={setPosReceipt} icon={<ShipWheel className="h-4 w-4" />} />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Invoice footer</div>
            <textarea value={invoiceFooter} onChange={(e) => setInvoiceFooter(e.target.value)} rows={4} className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500" />
          </label>
          <button type="button" onClick={save} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-black">
            <Save className="h-4 w-4" />
            Save company settings
          </button>
        </div>

        <div className="space-y-4">
          <Section title="Branch settings" icon={<Warehouse className="h-4 w-4" />} value={branchNames} onChange={setBranchNames} placeholder="Main, North, Warehouse..." />
          <Section title="POS settings" icon={<ShipWheel className="h-4 w-4" />} value={posReceipt} onChange={setPosReceipt} placeholder="Receipt footer / POS note" />
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">Company logo placeholder</h3>
            <div className="mt-4 flex h-44 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 text-zinc-500">
              Upload logo placeholder
            </div>
          </div>
        </div>
      </div>
    </SaaSShell>
  );
}

function Field({ label, value, onChange, icon }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {icon}
        {label}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
    </label>
  );
}

function Section({ title, icon, value, onChange, placeholder }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <h3 className="m1-section-title flex items-center gap-2 text-white">
        {icon}
        {title}
      </h3>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500" />
    </div>
  );
}

export default CompanySettings;
