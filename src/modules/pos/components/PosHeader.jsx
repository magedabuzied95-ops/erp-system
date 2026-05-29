import { useEffect, useMemo, useRef, useState } from "react";

import {
  BadgeCheck,
  Gift,
  ReceiptText,
  Search,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { matchesPhoneSearch, normalizePhone } from "../lib/phoneSearch";
import { formatCurrency } from "../lib/posUtils";

function PosHeader({
  customerSearch,
  setCustomerSearch,
  customers = [],
  selectedCustomer,
  selectedCustomerId,
  onSelectCustomer,
  onClearCustomer,
  onCreateCustomerClick,
}) {
  const { t, i18n } = useTranslation();
  void i18n;
  const [customerSearchActive, setCustomerSearchActive] = useState(false);
  const [activeCustomerIndex, setActiveCustomerIndex] = useState(-1);
  const customerSearchRef = useRef(null);
  const customerSearchWrapRef = useRef(null);
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const normalizedCustomerSearch = String(customerSearch || "").trim().toLowerCase();
  const customerPhoneSearch = normalizePhone(customerSearch);
  const customerMatches = useMemo(
    () =>
      safeCustomers.filter((item) => {
        if (!normalizedCustomerSearch) return true;
        const text = `${item?.name || ""} ${item?.phone || ""} ${item?.mobile || ""} ${item?.whatsapp || ""}`.toLowerCase();
        if (text.includes(normalizedCustomerSearch)) return true;
        if (!customerPhoneSearch.replace(/\D/g, "")) return false;
        return [item?.phone, item?.mobile, item?.whatsapp].some((value) => matchesPhoneSearch(value, customerSearch));
      }),
    [customerPhoneSearch, customerSearch, normalizedCustomerSearch, safeCustomers]
  );
  const showCustomerSuggestions =
    customerSearchActive &&
    !selectedCustomer &&
    String(customerSearch || "").trim().length > 0;
  const customerPlaceholder = "Search customer by name or phone";
  const addCustomerLabel = "New customer";
  const selectedCustomerName = selectedCustomer?.name || selectedCustomer?.customer_name || "";
  const selectedCustomerTier = selectedCustomer?.loyalty_tier || selectedCustomer?.tier || "";

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (customerSearchWrapRef.current?.contains(event.target)) return;
      setCustomerSearchActive(false);
      setActiveCustomerIndex(-1);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setCustomerSearchActive(false);
        setActiveCustomerIndex(-1);
        customerSearchRef.current?.blur();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="pos-header rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl shadow-black/15 backdrop-blur">
      <div className="grid min-w-0 flex-1 gap-2 xl:min-h-0">
        <div ref={customerSearchWrapRef} className="relative w-full min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-2 shadow-xl shadow-black/10">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0 flex-1">
              {selectedCustomer ? (
                <div className="flex h-11 w-full min-w-0 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--primary)]/35 hover:bg-[var(--card)] focus-within:border-[var(--primary)]/50 focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]">
                  <Search className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                  <button
                    type="button"
                    onClick={() => {
                      onClearCustomer?.();
                      setCustomerSearch(selectedCustomerName);
                      setCustomerSearchActive(true);
                      setActiveCustomerIndex(-1);
                      window.setTimeout(() => customerSearchRef.current?.focus(), 0);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                    title={selectedCustomerName}
                  >
                    <span className="min-w-0 flex-1 truncate" dir="auto">{selectedCustomerName}</span>
                    {selectedCustomerTier ? <CustomerTierBadge tier={selectedCustomerTier} /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearCustomer?.();
                      setCustomerSearch("");
                      setCustomerSearchActive(true);
                      setActiveCustomerIndex(-1);
                      window.setTimeout(() => customerSearchRef.current?.focus(), 0);
                    }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] transition hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
                    aria-label={t("pos.customer.change")}
                    title={t("pos.customer.change")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    ref={customerSearchRef}
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearchActive(true);
                      setActiveCustomerIndex(-1);
                      setCustomerSearch(e.target.value);
                    }}
                    onFocus={() => {
                      setCustomerSearchActive(true);
                    }}
                    placeholder={customerPlaceholder}
                    className="h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-11 text-sm font-semibold text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                  />
                  {customerSearch ? (
                    <button
                      type="button"
                      onClick={() => {
                        onClearCustomer?.();
                        setCustomerSearch("");
                        setCustomerSearchActive(true);
                        setActiveCustomerIndex(-1);
                        window.setTimeout(() => customerSearchRef.current?.focus(), 0);
                      }}
                      className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] transition hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
                      aria-label={t("pos.customer.change")}
                      title={t("pos.customer.change")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onCreateCustomerClick}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-3 text-xs font-black text-[var(--primary)] transition hover:border-[var(--primary)]/50 hover:bg-[var(--primary-soft)]/80 sm:w-11 sm:px-0"
              aria-label={t("pos.customer.add")}
              title={addCustomerLabel}
            >
              <UserPlus className="h-4 w-4" />
              <span className="sm:hidden">{addCustomerLabel}</span>
            </button>
          </div>

          {showCustomerSuggestions ? (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl shadow-black/40 backdrop-blur-xl">
              <div className="max-h-56 overflow-auto p-2">
                {customerMatches.length > 0 ? (
                  customerMatches.slice(0, 6).map((item, index) => {
                    const itemId = item?.id || item?.customer_id;
                    const active = String(selectedCustomerId) === String(itemId);
                    const phone = item.phone || item.mobile || item.whatsapp || "No phone";
                    return (
                      <button
                        key={String(itemId || `${item.name}-${phone}-${index}`)}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveCustomerIndex(index)}
                        onClick={(event) => {
                          onSelectCustomer?.(item);
                          setCustomerSearchActive(false);
                          setActiveCustomerIndex(-1);
                          customerSearchRef.current?.blur();
                          event.currentTarget.blur();
                        }}
                        className={`mb-1 w-full rounded-2xl border px-3 py-2.5 text-left transition ${
                        active || activeCustomerIndex === index
                          ? "border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--primary-soft)]/60"
                      }`}
                      >
                        <div className="text-sm font-semibold">{item.name}</div>
                        <div className="mt-0.5 text-[11px] text-[var(--muted)]">{phone}</div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-sm text-[var(--muted)]">{t("pos.customer.noMatch")}</div>
                )}
              </div>
            </div>
          ) : null}

          {selectedCustomer ? (
            <div className="mt-3">
              <CustomerQuickStats customer={selectedCustomer} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CustomerQuickStats({ customer }) {
  const { t } = useTranslation();
  const points = Number(customer.loyalty_points ?? customer.available_points ?? 0);
  const walletBalance = Number(customer.wallet_balance ?? customer.balance ?? 0);
  const totalOrders = Number(customer.total_orders ?? customer.totalOrders ?? customer.orders_count ?? 0);

  return (
    <div className="grid translate-y-0 grid-cols-3 gap-2 opacity-100 transition-all duration-200 ease-out">
      <QuickStat icon={Wallet} label={t("pos.statsCard.wallet")} value={formatCurrency(walletBalance)} />
      <QuickStat
        icon={Gift}
        label={t("pos.statsCard.loyalty")}
        value={`${points.toLocaleString()} ${t("pos.statsCard.pts")}`}
        accent
      />
      <QuickStat icon={ReceiptText} label={t("pos.statsCard.invoices")} value={totalOrders.toLocaleString()} />
    </div>
  );
}

function CustomerTierBadge({ tier }) {
  const normalizedTier = String(tier || "").trim();
  if (!normalizedTier) return null;

  const tone = normalizedTier.toLowerCase();
  const toneClass =
    tone === "bronze"
      ? "border-orange-300/20 bg-orange-300/10 text-orange-100"
      : tone === "silver"
        ? "border-slate-200/25 bg-slate-200/12 text-slate-100"
        : tone === "gold"
          ? "border-amber-300/25 bg-amber-300/12 text-amber-100"
          : tone === "platinum"
            ? "border-cyan-200/25 bg-cyan-200/12 text-cyan-100"
            : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";

  return (
    <span className={`inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border px-2 text-[9px] font-black leading-none ${toneClass}`}>
      <span className="truncate">{normalizedTier}</span>
    </span>
  );
}

function QuickStat({ icon: Icon, label, value, badge, accent = false }) {
  return (
    <div className={`group flex min-h-[4.65rem] min-w-0 flex-col justify-between rounded-2xl border px-2.5 py-2.5 transition ${
      accent
        ? "border-emerald-300/18 bg-emerald-400/[0.075]"
        : "border-white/10 bg-white/[0.035] hover:border-emerald-300/30 hover:bg-emerald-400/10"
    }`}>
      <div className="flex min-w-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${accent ? "text-emerald-200" : "text-emerald-300"}`} />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex min-w-0 flex-1 flex-col items-start justify-end gap-1">
        <div className="w-full break-words text-[0.94rem] font-black leading-tight text-white [overflow-wrap:anywhere]">{value}</div>
        {badge ? (
          <span className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-cyan-300/15 bg-cyan-300/[0.08] px-1.5 py-0.5 text-[8px] font-black leading-none text-cyan-100">
            <BadgeCheck className="h-2.5 w-2.5" />
            <span className="truncate">{badge}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default PosHeader;
