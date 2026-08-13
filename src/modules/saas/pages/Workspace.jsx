import { useMemo } from "react";
import { Link } from "react-router-dom";

import { ArrowRightLeft, Building2, CreditCard, ShieldCheck } from "lucide-react";

import SaaSShell from "../components/SaaSShell";
import { PLANS } from "../lib/tenantStore";
import { useTenant } from "../context/TenantContext";

function Workspace() {
  const tenantApi = useTenant();
  const billing = tenantApi?.billing;
  const tenants = tenantApi?.tenants || [];
  const currentTenant = tenantApi?.currentTenant;
  const kpis = tenantApi?.kpis || { total: 0, active: 0, suspended: 0, trial: 0, revenue: 0 };

  const history = useMemo(() => tenants.slice(0, 6), [tenants]);

  return (
    <SaaSShell
      title="Workspace"
      subtitle="Switch tenants, inspect the active subscription, and keep the authenticated session aligned with the current workspace."
      actions={
        <>
          <Link to="/register-company" className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black">
            <Building2 className="h-4 w-4" />
            Register company
          </Link>
          <Link to="/billing" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <CreditCard className="h-4 w-4" />
            Billing
          </Link>
        </>
      }
      tabs={[
        { to: "/workspace", label: "Workspace", end: true },
        { to: "/billing", label: "Billing" },
        { to: "/settings/company", label: "Company settings" },
        { to: "/admin/tenants", label: "Admin tenants" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Tenants" value={kpis.total} />
        <Metric label="Active" value={kpis.active} />
        <Metric label="Suspended" value={kpis.suspended} />
        <Metric label="Trial" value={kpis.trial} />
        <Metric label="Revenue placeholder" value={`$${Number(kpis.revenue || 0).toLocaleString()}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="m1-section-title text-white">Current workspace</h3>
              <p className="mt-1 text-sm text-zinc-400">Tenant-aware session persisted in local storage.</p>
            </div>
            <button type="button" className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
              <ArrowRightLeft className="h-4 w-4" />
              Switch
            </button>
          </div>

          <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-primary/70">Workspace</div>
                <div className="mt-2 text-2xl font-black text-white">{currentTenant?.companyName || "No workspace selected"}</div>
                <div className="mt-1 text-sm text-primary/80">{currentTenant?.ownerEmail || "Sign in to attach a tenant workspace."}</div>
              </div>
              <ShieldCheck className="h-10 w-10 text-primary" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Small label="Subscription" value={billing?.status || "Active"} />
              <Small label="Plan" value={billing?.plan?.name || "Trial"} />
              <Small label="Expires" value={billing?.expiresAt ? new Date(billing.expiresAt).toLocaleDateString() : "n/a"} />
              <Small label="Currency" value={billing?.currency || "USD"} />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">Recent workspaces</h3>
          <div className="mt-4 space-y-3">
            {history.length === 0 ? (
              <Empty label="No workspace history yet." />
            ) : (
              history.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => tenantApi?.setCurrentTenant?.(tenant)}
                  className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10"
                >
                  <div>
                    <div className="font-semibold text-white">{tenant.companyName}</div>
                    <div className="mt-1 text-xs text-zinc-500">{tenant.ownerEmail}</div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                    {tenant.plan}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Supported plans</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PLANS.map((plan) => (
                <span key={plan.id} className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                  {plan.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SaaSShell>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Small({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function Empty({ label }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{label}</div>;
}

export default Workspace;
