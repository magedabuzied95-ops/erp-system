import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Award, ChevronRight, Coins, Gift, RefreshCw, TrendingUp, UsersRound } from "lucide-react";

import { getLoyaltyCustomers, getLoyaltyRules } from "../loyaltyApi";
import { loyaltyMockData } from "../lib/loyaltyMockData";

const tierStyles = {
  Bronze: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  Silver: "border-slate-300/20 bg-slate-300/10 text-[var(--text)]",
  Gold: "border-yellow-500/20 bg-yellow-500/10 text-yellow-200",
  Platinum: "border-primary/20 bg-primary/10 text-primary",
};

const StatCard = ({ label, value, icon: Icon, hint }) => (
  <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{label}</p>
        <p className="mt-3 text-3xl font-black text-[var(--text)]">{value}</p>
        {hint ? <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p> : null}
      </div>
      <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </div>
);

function LoyaltyDashboard() {
  const { t } = useTranslation();
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
    <div className="space-y-6 text-[var(--text)]">
      <div className="flex flex-col justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] xl:flex-row xl:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary/80">{t("loyalty.dashboard.eyebrow")}</p>
          <h1 className="m1-page-title mt-2">{t("loyalty.dashboard.title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Track points issuance, redemptions, tier movement, and customer value from one operational dashboard.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/loyalty/rules" className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface)]">
            Manage Rules
          </Link>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-bold text-slate-950">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("loyalty.dashboard.stats.totalCustomers")} value={loading ? "..." : summary.totalCustomers || 0} icon={UsersRound} hint={t("loyalty.dashboard.stats.totalCustomersHint")} />
        <StatCard label={t("loyalty.dashboard.stats.pointsIssued")} value={loading ? "..." : Number(summary.totalPointsIssued || 0).toLocaleString()} icon={Coins} hint={t("loyalty.dashboard.stats.pointsIssuedHint")} />
        <StatCard label={t("loyalty.dashboard.stats.pointsRedeemed")} value={loading ? "..." : Number(summary.totalPointsRedeemed || 0).toLocaleString()} icon={Gift} hint={t("loyalty.dashboard.stats.pointsRedeemedHint")} />
        <StatCard label={t("loyalty.dashboard.stats.activeRules")} value={loading ? "..." : rules.filter((rule) => rule.is_active !== false).length} icon={Award} hint={t("loyalty.dashboard.stats.activeRulesHint")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="m1-section-title">{t("loyalty.dashboard.top.title")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("loyalty.dashboard.top.subtitle")}</p>
            </div>
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>

          <div className="mt-5 space-y-3">
            {(summary.topCustomers || []).slice(0, 6).map((customer) => (
              <Link
                key={customer.id}
                to={`/loyalty/customers/${customer.id}`}
                className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition hover:border-primary/30 hover:bg-primary/5"
              >
                <div>
                  <p className="font-semibold text-[var(--text)]">{customer.name}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Lifetime spend {Number(customer.lifetime_spent || 0).toLocaleString()} EGP
                  </p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tierStyles[customer.tier] || tierStyles.Bronze}`}>
                    {customer.tier || "Bronze"}
                  </span>
                  <p className="mt-2 text-sm text-primary">{Number(customer.available_points || 0).toLocaleString()} pts</p>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="m1-section-title">{t("loyalty.dashboard.tiers.title")}</h2>
          <div className="mt-5 space-y-3">
            {Object.entries(tierCounts).map(([tier, count]) => (
              <div key={tier} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--text)]">{tier}</span>
                  <span className="text-sm text-[var(--muted)]">{count}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (count / Math.max(summary.totalCustomers || 1, 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="m1-section-title">{t("loyalty.dashboard.history.title")}</h2>
          <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)]">
            <table className="m1-table m1-table--compact min-w-full text-left text-sm">
              <thead className="bg-[var(--surface)] text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("loyalty.dashboard.history.type")}</th>
                  <th className="px-4 py-3">{t("loyalty.dashboard.history.customer")}</th>
                  <th className="px-4 py-3">{t("loyalty.dashboard.history.points")}</th>
                  <th className="px-4 py-3">{t("loyalty.dashboard.history.value")}</th>
                  <th className="px-4 py-3">{t("loyalty.dashboard.history.date")}</th>
                </tr>
              </thead>
              <tbody>
                {(summary.transactions || []).slice(0, 8).map((tx) => (
                  <tr key={tx.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 text-primary">{tx.transaction_type}</td>
                    <td className="px-4 py-3 text-[var(--text)]">{tx.customer_name || "Customer"}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{Number(tx.points || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{Number(tx.amount_value || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{tx.created_at ? new Date(tx.created_at).toLocaleDateString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="m1-section-title">{t("loyalty.dashboard.rules.title")}</h2>
          <div className="mt-5 space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--text)]">{rule.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {Number(rule.points_per_currency_amount || 0)} pts / currency unit
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${rule.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-zinc-600 bg-[var(--card)] text-[var(--muted)]"}`}>
                    {rule.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                  <div>{t("loyalty.dashboard.rules.minOrder", { value: Number(rule.minimum_order_amount || 0).toLocaleString() })}</div>
                  <div>{t("loyalty.dashboard.rules.redeemValue", { value: Number(rule.redeem_value || 0).toLocaleString() })}</div>
                  <div>{t("loyalty.dashboard.rules.silver", { value: Number(rule.silver_threshold || 0).toLocaleString() })}</div>
                  <div>{t("loyalty.dashboard.rules.platinum", { value: Number(rule.platinum_threshold || 0).toLocaleString() })}</div>
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
