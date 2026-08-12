import { useMemo } from "react";
import { Link } from "react-router-dom";

import { BadgeDollarSign, CheckCircle2, Clock3, CreditCard, Crown } from "lucide-react";

import SaaSShell from "../components/SaaSShell";
import { PLANS } from "../lib/tenantStore";
import { useTenant } from "../context/TenantContext";

function Billing() {
  const tenantApi = useTenant();
  const billing = tenantApi?.billing;

  const nextCharge = useMemo(() => {
    if (!billing?.expiresAt) return "n/a";
    return new Date(billing.expiresAt).toLocaleDateString();
  }, [billing?.expiresAt]);

  return (
    <SaaSShell
      title="Billing"
      subtitle="Subscription status, expiration date, billing placeholders, and an upgrade flow that works even before the backend billing service exists."
      actions={
        <Link to="/workspace" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <CheckCircle2 className="h-4 w-4" />
          Workspace
        </Link>
      }
      tabs={[
        { to: "/workspace", label: "Workspace" },
        { to: "/billing", label: "Billing", end: true },
        { to: "/settings/company", label: "Company settings" },
        { to: "/admin/tenants", label: "Admin tenants" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Plan" value={billing?.plan?.name || "Trial"} icon={<Crown className="h-5 w-5" />} />
        <Metric label="Status" value={billing?.status || "Active"} icon={<CheckCircle2 className="h-5 w-5" />} />
        <Metric label="Expires" value={nextCharge} icon={<Clock3 className="h-5 w-5" />} />
        <Metric label="Currency" value={billing?.currency || "USD"} icon={<BadgeDollarSign className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">Current subscription</h3>
          <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-primary/70">Subscription</div>
            <div className="mt-2 text-3xl font-black text-white">{billing?.plan?.name || "Trial"}</div>
            <p className="mt-2 text-sm text-primary/80">
              {billing?.plan?.features?.join(" • ") || "Billing placeholders available until live checkout is connected."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                {billing?.plan?.duration || "Monthly"}
              </span>
              <span className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                Next charge {nextCharge}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="m1-section-title text-white">Upgrade page</h3>
          <div className="mt-4 space-y-3">
            {PLANS.map((plan) => (
              <div key={plan.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{plan.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{plan.features.join(" • ")}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-white">${plan.price}</div>
                    <div className="text-xs text-zinc-500">{plan.duration}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
            Billing gateway placeholder. Connect your processor here when the backend is available.
          </div>
          <button type="button" className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-black">
            <CreditCard className="h-4 w-4" />
            Upgrade plan
          </button>
        </div>
      </div>
    </SaaSShell>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
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

export default Billing;
