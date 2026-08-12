import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowLeft, Phone, ReceiptText, Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import { formatCurrency, formatDateTime, getLocalPurchases, normalizeSupplier, seedSuppliers } from "../lib/flowStore";

function SupplierDetails() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSupplier = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.get("/suppliers?limit=200&page=1");
      const rows = Array.isArray(data.suppliers) ? data.suppliers : [];
      const supplierRow = rows.find((row) => String(row.id) === String(id)) || seedSuppliers().find((row) => String(row.id) === String(id));
      setSupplier(supplierRow ? normalizeSupplier(supplierRow) : null);
    } catch (err) {
      console.log(err);
      const fallback = seedSuppliers().find((row) => String(row.id) === String(id));
      setSupplier(fallback ? normalizeSupplier(fallback) : null);
      setError(t("purchases.supplierDetails.fallbackError"));
      toast.error(t("purchases.supplierDetails.fallbackToast"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSupplier();
  }, [id]);

  const purchases = useMemo(
    () => getLocalPurchases().filter((purchase) => purchase.supplier_name === supplier?.name),
    [supplier]
  );

  const ledger = useMemo(
    () =>
      purchases.map((purchase) => ({
        id: purchase.id,
        type: "Purchase",
        invoice: purchase.invoice_number,
        amount: Number(purchase.total || 0),
        created_at: purchase.created_at,
        status: purchase.status,
      })),
    [purchases]
  );

  if (loading) {
    return (
      <FlowShell title={t("purchases.supplierDetails.title")} subtitle={t("purchases.supplierDetails.loadingSubtitle")}>
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-10 text-center text-zinc-400">
          {t("purchases.supplierDetails.loading")}
        </div>
      </FlowShell>
    );
  }

  if (!supplier) {
    return (
      <FlowShell title={t("purchases.supplierDetails.title")} subtitle={t("purchases.supplierDetails.notFoundSubtitle")}>
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-6 text-amber-100">
          <AlertTriangle className="me-2 inline h-4 w-4" />
          {t("purchases.supplierDetails.notFound")}
          <div className="mt-4">
            <button type="button" onClick={() => navigate("/suppliers")} className="rounded-[var(--radius-control)] bg-white px-4 py-2 text-sm font-semibold text-black">
              {t("purchases.supplierDetails.backToSuppliers")}
            </button>
          </div>
        </div>
      </FlowShell>
    );
  }

  const balance = Number(supplier.balance || 0);

  return (
    <FlowShell
      title={supplier.name}
      subtitle={t("purchases.supplierDetails.subtitle")}
      actions={
        <Link
          to="/suppliers"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("purchases.supplierDetails.back")}
        </Link>
      }
      tabs={[
        { to: "/purchases", label: t("purchases.tabs.purchases"), end: true },
        { to: "/purchases/create", label: t("purchases.tabs.createPo") },
        { to: "/suppliers", label: t("purchases.tabs.suppliers"), end: true },
        { to: "/inventory", label: t("purchases.tabs.inventory") },
        { to: "/warehouses", label: t("purchases.tabs.warehouses") },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="me-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("purchases.supplierDetails.profile")}</div>
                <h2 className="m1-section-title mt-2 text-white">{supplier.name}</h2>
                <p className="mt-1 text-sm text-zinc-400">{supplier.address || t("purchases.supplierDetails.noAddress")}</p>
              </div>
              <StatusBadge value={supplier.status} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Info label={t("purchases.supplierDetails.phone")} value={supplier.phone || t("purchases.supplierDetails.notAvailable")} icon={<Phone className="h-4 w-4" />} />
              <Info label={t("purchases.supplierDetails.email")} value={supplier.email || t("purchases.supplierDetails.notAvailable")} />
              <Info label={t("purchases.supplierDetails.debtBalance")} value={formatCurrency(balance)} icon={<Wallet className="h-4 w-4" />} />
              <Info label={t("purchases.supplierDetails.purchases")} value={String(purchases.length)} icon={<ReceiptText className="h-4 w-4" />} />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("purchases.supplierDetails.purchaseHistory")}</h3>
            <div className="mt-4 space-y-3">
              {purchases.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                  {t("purchases.supplierDetails.noPurchaseHistory")}
                </div>
              ) : (
                purchases.map((purchase) => (
                  <div key={String(purchase.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{purchase.invoice_number}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatDateTime(purchase.created_at)}</div>
                      </div>
                      <StatusBadge value={purchase.status} />
                    </div>
                    <div className="mt-3 text-sm text-zinc-300">{t("purchases.supplierDetails.itemsCount", { count: purchase.items?.length || 0 })}</div>
                    <div className="mt-1 font-bold text-white">{formatCurrency(purchase.total)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("purchases.supplierDetails.transactionsHistory")}</h3>
            <div className="mt-4 space-y-3">
              {[...ledger].map((entry) => (
                <div key={String(entry.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{entry.invoice}</div>
                      <div className="mt-1 text-xs text-zinc-500">{formatDateTime(entry.created_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-white">{formatCurrency(entry.amount)}</div>
                      <div className="text-xs text-zinc-500">{entry.status}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("purchases.supplierDetails.ledgerSummary")}</h3>
            <div className="mt-4 grid gap-3">
              <Info label={t("purchases.supplierDetails.openingBalance")} value={formatCurrency(balance)} />
              <Info label={t("purchases.supplierDetails.purchaseCount")} value={String(purchases.length)} />
              <Info label={t("purchases.supplierDetails.latestTransaction")} value={ledger[0] ? formatDateTime(ledger[0].created_at) : t("purchases.supplierDetails.notAvailable")} />
              <Info label={t("purchases.supplierDetails.currentStatus")} value={supplier.status} />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("purchases.supplierDetails.contactInfo")}</h3>
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <ContactRow label={t("purchases.supplierDetails.phone")} value={supplier.phone} emptyLabel={t("purchases.supplierDetails.notAvailable")} />
              <ContactRow label={t("purchases.supplierDetails.email")} value={supplier.email} emptyLabel={t("purchases.supplierDetails.notAvailable")} />
              <ContactRow label={t("purchases.supplierDetails.address")} value={supplier.address} emptyLabel={t("purchases.supplierDetails.notAvailable")} />
              <ContactRow label={t("purchases.supplierDetails.notes")} value={supplier.notes} emptyLabel={t("purchases.supplierDetails.noNotes")} />
            </div>
          </div>
        </div>
      </div>
    </FlowShell>
  );
}

function Info({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ContactRow({ label, value, emptyLabel }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-white">{value || emptyLabel}</div>
    </div>
  );
}

export default SupplierDetails;
