import { Link } from "react-router-dom";

import { Building2, CircleDollarSign, ShieldCheck, ShieldOff } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import SaaSShell from "../components/SaaSShell";
import { buildTenantKpis, getTenants, updateTenant } from "../lib/tenantStore";

function AdminTenants() {
  const tenants = getTenants();
  const kpis = buildTenantKpis(tenants);

  const toggleStatus = async (tenant) => {
    const nextStatus = tenant.status === "Active" ? "Suspended" : "Active";
    try {
      await api.put(`/tenants/${tenant.id}/status`, { status: nextStatus });
    } catch (err) {
      console.log(err);
    } finally {
      updateTenant(tenant.id, { status: nextStatus });
      toast.success(`${tenant.companyName} ${nextStatus.toLowerCase()}`);
    }
  };

  return (
    <SaaSShell
      title="Super Admin Tenants"
      subtitle="Monitor companies, active subscriptions, revenue placeholders, and tenant status management from one panel."
      actions={
        <Link to="/workspace" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <Building2 className="h-4 w-4" />
          Workspace
        </Link>
      }
      tabs={[
        { to: "/admin/tenants", label: "Tenants", end: true },
        { to: "/workspace", label: "Workspace" },
        { to: "/billing", label: "Billing" },
        { to: "/settings/company", label: "Company settings" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Tenants" value={kpis.total} icon={<Building2 className="h-5 w-5" />} />
        <Metric label="Active" value={kpis.active} icon={<ShieldCheck className="h-5 w-5" />} />
        <Metric label="Suspended" value={kpis.suspended} icon={<ShieldOff className="h-5 w-5" />} />
        <Metric label="Revenue placeholder" value={`$${Number(kpis.revenue || 0).toLocaleString()}`} icon={<CircleDollarSign className="h-5 w-5" />} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="m1-section-title text-white">Companies list</h3>
            <p className="mt-1 text-sm text-zinc-400">Suspend or activate tenants without affecting the existing ERP modules.</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {tenants.length === 0 ? (
            <Empty label="No tenants found." />
          ) : (
            tenants.map((tenant) => (
              <div key={tenant.id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr_0.9fr_0.7fr] xl:items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-white">{tenant.companyName}</div>
                      <div className="mt-1 text-xs text-zinc-500">{tenant.ownerEmail}</div>
                    </div>
                  </div>
                  <div className="text-sm text-zinc-300">
                    <div className="font-semibold text-white">{tenant.plan}</div>
                    <div className="text-xs text-zinc-500">{tenant.subscriptionStatus}</div>
                  </div>
                  <div className="text-sm text-zinc-300">
                    <div className="font-semibold text-white">{tenant.status}</div>
                    <div className="text-xs text-zinc-500">{new Date(tenant.expiresAt).toLocaleDateString()}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleStatus(tenant)}
                    className={[
                      "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-3 text-sm font-black transition",
                      tenant.status === "Active" ? "bg-amber-500 text-black" : "bg-emerald-500 text-black",
                    ].join(" ")}
                  >
                    {tenant.status === "Active" ? "Suspend" : "Activate"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </SaaSShell>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-white">{icon}</div>
      </div>
    </div>
  );
}

function Empty({ label }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{label}</div>;
}

export default AdminTenants;
