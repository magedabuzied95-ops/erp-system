import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Award, ChevronRight, Coins, Gift, RefreshCw, TrendingUp, UsersRound } from "lucide-react";

import { getLoyaltyCustomers, getLoyaltyRules } from "../loyaltyApi";
import { loyaltyMockData } from "../lib/loyaltyMockData";

const tierStyles = {
  Bronze: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  Silver: "border-slate-300/20 bg-slate-300/10 text-slate-100",
  Gold: "border-yellow-500/20 bg-yellow-500/10 text-yellow-200",
  Platinum: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
};

const StatCard = ({ label, value, icon: Icon, hint }) => (
  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
        <p className="mt-3 text-3xl font-black text-white">{value}</p>
        {hint ? <p className="mt-2 text-sm text-zinc-400">{hint}</p> : null}
      </div>
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </div>
);

function LoyaltyDashboard() {
  const [customersData, setCustomersData] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const [customersRes, rulesRes] = await Promise.allSettled([getLoyaltyCustomers(), getLoyaltyRules()]);
        if (!active) return;

        const customersPayload = customersRes.status === "fulfilled" ? customersRes.value : null;
        const rulesPayload = rulesRes.status === "fulfilled" ? rulesRes.value : null;

        setCustomersData(
          customersPayload?.summary
            ? customersPayload
            : {
                customers: loyaltyMockData.summary.topCustomers,
                summary: loyaltyMockData.summary,
              }
        );
        setRules(Array.isArray(rulesPayload?.rules) && rulesPayload.rules.length ? rulesPayload.rules : loyaltyMockData.rules);

        if (customersRes.status !== "fulfilled" || rulesRes.status !== "fulfilled") {
          console.warn("Loyalty dashboard fallback data used.");
          setError("Loyalty endpoints are not ready yet. Showing fallback data.");
        }
      } catch (err) {
        if (!active) return;
        console.log(err);
        setCustomersData({
          customers: loyaltyMockData.summary.topCustomers,
          summary: loyaltyMockData.summary,
        });
        setRules(loyaltyMockData.rules);
        setError("Loyalty endpoints are not ready yet. Showing fallback data.");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const summary = customersData?.summary || loyaltyMockData.summary;

  const tierCounts = useMemo(() => {
    const base = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0 };
    (summary.tierDistribution || []).forEach((item) => {
      base[item.tier] = item.count;
    });
    return base;
  }, [summary.tierDistribution]);

  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-[#0b1220] p-6 shadow-2xl shadow-black/20 xl:flex-row xl:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Loyalty</p>
          <h1 className="mt-2 text-3xl font-black">Customer Loyalty Intelligence</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            Track points issuance, redemptions, tier movement, and customer value from one operational dashboard.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/loyalty/rules" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
            Manage Rules
          </Link>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-bold text-slate-950">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total loyalty customers" value={loading ? "..." : summary.totalCustomers || 0} icon={UsersRound} hint="Customers enrolled in the program" />
        <StatCard label="Total points issued" value={loading ? "..." : Number(summary.totalPointsIssued || 0).toLocaleString()} icon={Coins} hint="Lifetime earned points" />
        <StatCard label="Total points redeemed" value={loading ? "..." : Number(summary.totalPointsRedeemed || 0).toLocaleString()} icon={Gift} hint="Points spent at checkout" />
        <StatCard label="Active rules" value={loading ? "..." : rules.filter((rule) => rule.is_active !== false).length} icon={Award} hint="Current point and tier policies" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-[#0b1220] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Top Loyalty Customers</h2>
              <p className="mt-1 text-sm text-zinc-500">Highest value and point balance customers</p>
            </div>
            <TrendingUp className="h-5 w-5 text-cyan-300" />
          </div>

          <div className="mt-5 space-y-3">
            {(summary.topCustomers || []).slice(0, 6).map((customer) => (
              <Link
                key={customer.id}
                to={`/loyalty/customers/${customer.id}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-500/30 hover:bg-cyan-500/5"
              >
                <div>
                  <p className="font-semibold text-white">{customer.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Lifetime spend {Number(customer.lifetime_spent || 0).toLocaleString()} EGP
                  </p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tierStyles[customer.tier] || tierStyles.Bronze}`}>
                    {customer.tier || "Bronze"}
                  </span>
                  <p className="mt-2 text-sm text-cyan-200">{Number(customer.available_points || 0).toLocaleString()} pts</p>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0b1220] p-5">
          <h2 className="text-lg font-bold">Tier Distribution</h2>
          <div className="mt-5 space-y-3">
            {Object.entries(tierCounts).map(([tier, count]) => (
              <div key={tier} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{tier}</span>
                  <span className="text-sm text-zinc-400">{count}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, (count / Math.max(summary.totalCustomers || 1, 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-[#0b1220] p-5">
          <h2 className="text-lg font-bold">Transaction History</h2>
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Points</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {(summary.transactions || []).slice(0, 8).map((tx) => (
                  <tr key={tx.id} className="border-t border-white/10">
                    <td className="px-4 py-3 text-cyan-200">{tx.transaction_type}</td>
                    <td className="px-4 py-3 text-white">{tx.customer_name || "Customer"}</td>
                    <td className="px-4 py-3 text-zinc-300">{Number(tx.points || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-300">{Number(tx.amount_value || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-400">{tx.created_at ? new Date(tx.created_at).toLocaleDateString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0b1220] p-5">
          <h2 className="text-lg font-bold">Rules Snapshot</h2>
          <div className="mt-5 space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{rule.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {Number(rule.points_per_currency_amount || 0)} pts / currency unit
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${rule.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-zinc-600 bg-zinc-800 text-zinc-300"}`}>
                    {rule.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                  <div>Min order: {Number(rule.minimum_order_amount || 0).toLocaleString()}</div>
                  <div>Redeem value: {Number(rule.redeem_value || 0).toLocaleString()}</div>
                  <div>Silver: {Number(rule.silver_threshold || 0).toLocaleString()}</div>
                  <div>Platinum: {Number(rule.platinum_threshold || 0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoyaltyDashboard;
