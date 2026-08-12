import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Building2, CheckCircle2, Crown, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { setAuth, setCurrentTenant } from "../../../shared/auth/authStorage";
import SaaSShell from "../components/SaaSShell";
import { PLANS, createTenant } from "../lib/tenantStore";

function RegisterCompany() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("trial");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!companyName.trim() || !ownerEmail.trim() || !password.trim()) {
      toast.error("اسم الشركة والبريد الإلكتروني وكلمة المرور مطلوبة");
      return;
    }

    const tenant = createTenant({
      name: companyName.trim(),
      companyName: companyName.trim(),
      ownerName: ownerName.trim() || companyName.trim(),
      ownerEmail: ownerEmail.trim(),
      slug: workspaceSlug || companyName.trim(),
      plan,
      subscriptionStatus: plan === "trial" ? "Trial" : "Active",
      expiresAt:
        plan === "trial"
          ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
          : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      currency: "USD",
      language: "en",
      billingEmail: ownerEmail.trim(),
      settings: {
        invoicePrefix: "INV",
        invoiceFooter: "Thank you for your business",
        companyAddress: "",
        taxRate: 0,
      },
    });

    setLoading(true);
    try {
      await api.post("/auth/register", {
        name: ownerName.trim() || companyName.trim(),
        email: ownerEmail.trim(),
        password,
        role: "Admin",
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        company_name: tenant.companyName,
      });
    } catch (err) {
      console.log(err);
    } finally {
      setCurrentTenant(tenant);
      setAuth({
        token: `local-${Date.now()}`,
        user: {
          name: ownerName.trim() || companyName.trim(),
          email: ownerEmail.trim(),
          role: "Admin",
          permissions: ["*"],
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          tenant_slug: tenant.slug,
          company_name: tenant.companyName,
        },
      });
      toast.success("تم إنشاء مساحة العمل للشركة");
      navigate("/workspace");
      setLoading(false);
    }
  };

  return (
    <SaaSShell
      title="تسجيل شركة"
      subtitle="أنشئ مساحة عمل للشركة وحساب المالك وبداية الاشتراك. إذا تعذر الاتصال بالخادم، سيتم حفظ المساحة محليًا وتسجيل الدخول عليها."
      actions={
        <Link to="/login" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          تسجيل الدخول
        </Link>
      }
      tabs={[
        { to: "/register-company", label: "تسجيل" , end: true },
        { to: "/workspace", label: "مساحة العمل" },
        { to: "/billing", label: "الفوترة" },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">بيانات الشركة</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="اسم الشركة" value={companyName} onChange={setCompanyName} placeholder="Acme Retail" />
            <Field label="اسم المالك" value={ownerName} onChange={setOwnerName} placeholder="الاسم الكامل للمالك" />
            <Field label="بريد المالك" value={ownerEmail} onChange={setOwnerEmail} placeholder="owner@company.com" />
            <Field label="معرّف مساحة العمل" value={workspaceSlug} onChange={setWorkspaceSlug} placeholder="acme-retail" />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">كلمة المرور</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              placeholder="كلمة مرور المالك"
            />
          </label>
          <div className="mt-5 flex flex-wrap gap-2">
            {PLANS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPlan(item.id)}
                className={[
                  "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
                  plan === item.id ? "border-primary/40 bg-primary text-black" : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10",
                ].join(" ")}
              >
                {item.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={submit}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-black disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" />
            {loading ? "Creating..." : "Create workspace"}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">Owner and staff accounts</h3>
            <div className="mt-4 space-y-3">
              <Card icon={<Crown className="h-4 w-4" />} title="Owner account" text="Full tenant access, billing ownership, subscription upgrades, and admin operations." />
              <Card icon={<Building2 className="h-4 w-4" />} title="Staff accounts" text="Assignable later through the users module and permission matrix." />
              <Card icon={<CheckCircle2 className="h-4 w-4" />} title="Workspace persistence" text="Tenant metadata is stored locally and attached to the authenticated user for session continuity." />
            </div>
          </div>
        </div>
      </div>
    </SaaSShell>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function Card({ icon, title, text }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-2 text-primary">{icon}</div>
        <div>
          <div className="font-semibold text-white">{title}</div>
          <div className="mt-1 text-sm text-zinc-400">{text}</div>
        </div>
      </div>
    </div>
  );
}

export default RegisterCompany;
