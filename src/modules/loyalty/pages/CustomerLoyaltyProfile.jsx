import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Gift, ReceiptText, ShieldCheck, UserCircle2 } from "lucide-react";
import toast from "react-hot-toast";

import { getLoyaltyCustomerById, redeemLoyaltyPoints } from "../loyaltyApi";
import { loyaltyMockData } from "../lib/loyaltyMockData";

const tierStyles = {
  Bronze: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  Silver: "border-slate-300/20 bg-slate-300/10 text-[var(--text)]",
  Gold: "border-yellow-500/20 bg-yellow-500/10 text-yellow-200",
  Platinum: "border-primary/20 bg-primary/10 text-primary",
};

function CustomerLoyaltyProfile() {
  const { t } = useTranslation();
  const { customerId } = useParams();
  const [customer, setCustomer] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);
  const [points, setPoints] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        const response = await getLoyaltyCustomerById(customerId);
        if (!active) return;

        setCustomer(response?.customer || loyaltyMockData.customerDetail.customer);
        setLoyalty(response?.loyalty || loyaltyMockData.customerDetail.loyalty);
        setTransactions(
          Array.isArray(response?.transactions) && response.transactions.length
            ? response.transactions
            : loyaltyMockData.customerDetail.transactions
        );
      } catch (error) {
        if (!active) return;
        console.log(error);
        toast.error(t("loyalty.profile.fallbackToast"));
        setCustomer(loyaltyMockData.customerDetail.customer);
        setLoyalty(loyaltyMockData.customerDetail.loyalty);
        setTransactions(loyaltyMockData.customerDetail.transactions);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [customerId]);

  const handleRedeem = async () => {
    const redeemPoints = Number(points);
    if (!Number.isFinite(redeemPoints) || redeemPoints <= 0) {
      toast.error(t("loyalty.profile.invalidPoints"));
      return;
    }

    try {
      setRedeeming(true);
      const response = await redeemLoyaltyPoints({ customerId, points: redeemPoints });
      setLoyalty((current) => ({
        ...(current || {}),
        available_points: response?.loyalty?.available_points ?? Math.max(0, Number(current?.available_points || 0) - redeemPoints),
        total_points_redeemed: response?.loyalty?.total_points_redeemed ?? Number(current?.total_points_redeemed || 0) + redeemPoints,
        tier: response?.loyalty?.tier || current?.tier || "Bronze",
      }));
      setTransactions((current) => [response?.transaction, ...current].filter(Boolean));
      setPoints("");
      toast.success(t("loyalty.profile.redeemed"));
    } catch (error) {
      console.log(error);
      toast.error(error.message || "تعذر استبدال النقاط");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="space-y-6 text-[var(--text)]">
      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
            <UserCircle2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-primary/80">{t("loyalty.profile.eyebrow")}</p>
            <h1 className="m1-page-title mt-2">{loading ? t("loyalty.profile.loading") : customer?.name}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {customer?.phone || "No phone"} {customer?.email ? `| ${customer.email}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link to="/loyalty" className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold hover:bg-[var(--surface)]">
            Back to dashboard
          </Link>
          <Link to="/loyalty/rules" className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-slate-950">
            Rules
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Tier", loyalty?.tier || "Bronze", ShieldCheck],
          ["النقاط المتاحة", Number(loyalty?.available_points || 0).toLocaleString(), Gift],
          ["Points earned", Number(loyalty?.total_points_earned || 0).toLocaleString(), ReceiptText],
          ["إجمالي الإنفاق", Number(loyalty?.lifetime_spent || 0).toLocaleString(), ReceiptText],
        ].map(([label, value, Icon]) => (
          <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{label}</p>
                <p className="mt-3 text-2xl font-black text-[var(--text)]">{value}</p>
              </div>
              <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="m1-section-title">{t("loyalty.profile.history")}</h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${tierStyles[loyalty?.tier] || tierStyles.Bronze}`}>{loyalty?.tier || "Bronze"}</span>
          </div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)]">
            <table className="m1-table m1-table--compact min-w-full text-left text-sm">
              <thead className="bg-[var(--surface)] text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("loyalty.profile.type")}</th>
                  <th className="px-4 py-3">{t("loyalty.profile.points")}</th>
                  <th className="px-4 py-3">{t("loyalty.profile.value")}</th>
                  <th className="px-4 py-3">{t("loyalty.profile.date")}</th>
                </tr>
              </thead>
              <tbody>
                {(transactions || []).map((tx) => (
                  <tr key={tx.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 text-primary">{tx.transaction_type}</td>
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
          <h2 className="m1-section-title">{t("loyalty.profile.redeemTitle")}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("loyalty.profile.redeemHint")}</p>

          <label className="mt-5 block space-y-2 text-sm text-[var(--muted)]">
            <span className="block text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{t("loyalty.profile.pointsToRedeem")}</span>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--text)] outline-none ring-0 focus:border-primary/40"
            />
          </label>

          <button
            type="button"
            onClick={handleRedeem}
            disabled={redeeming}
            className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
          >
            <Gift className="h-4 w-4" />
            {redeeming ? "جارٍ الاستبدال..." : "استبدال النقاط"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CustomerLoyaltyProfile;
