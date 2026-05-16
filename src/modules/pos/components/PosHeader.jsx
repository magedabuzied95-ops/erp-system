import { useEffect, useRef, useState } from "react";

import {
  BadgeCheck,
  Gift,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { matchesPhoneSearch, normalizePhone } from "../lib/phoneSearch";
import { formatCurrency } from "../lib/posUtils";

function PosHeader({
  search,
  setSearch,
  searchRef,
  filtersButtonRef,
  filtersOpen = false,
  activeSmartFilterCount = 0,
  onToggleFilters,
  totals,
  customerSearch,
  setCustomerSearch,
  customers = [],
  selectedCustomer,
  selectedCustomerId,
  onSelectCustomer,
  onClearCustomer,
  onCreateCustomerClick,
  onBarcodeSubmit,
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
  const customerMatches = safeCustomers.filter((item) => {
    if (!normalizedCustomerSearch) return true;
    const text = `${item?.name || ""} ${item?.phone || ""} ${item?.mobile || ""} ${item?.whatsapp || ""}`.toLowerCase();
    if (text.includes(normalizedCustomerSearch)) return true;
    if (!customerPhoneSearch.replace(/\D/g, "")) return false;
    return [item?.phone, item?.mobile, item?.whatsapp].some((value) => matchesPhoneSearch(value, customerSearch));
  });
  const showCustomerSuggestions =
    customerSearchActive &&
    !selectedCustomer &&
    String(customerSearch || "").trim().length > 0;
  const customerPlaceholder = "Search customer by name or phone";
  const walkInLabel = "Walk-in customer";
  const addCustomerLabel = "+ New customer";

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
    <div className="pos-header rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-black/20 backdrop-blur">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3 text-[var(--primary)]">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">{t("pos.moduleEyebrow")}</span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text)]">
            {t("pos.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            {t("pos.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[54rem]">
          <Stat label={t("pos.stats.subtotal")} value={formatCurrency(totals.subtotal)} />
          <Stat label={t("pos.stats.discounts")} value={formatCurrency(totals.itemDiscountTotal + totals.invoiceDiscount + (totals.loyaltyDiscount || 0))} />
          <Stat label={t("pos.stats.serviceFee", "Service fee")} value={formatCurrency(totals.serviceFee)} />
          <Stat label={t("pos.stats.total")} value={formatCurrency(totals.total)} accent />
        </div>
      </div>

      <div className="mt-4 grid min-w-0 flex-1 gap-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onBarcodeSubmit();
                }
              }}
              placeholder={t("pos.searchPlaceholder")}
              className="theme-input pl-11"
            />
          </div>

          <div className="shrink-0">
            <button
              ref={filtersButtonRef}
              type="button"
              onClick={onToggleFilters}
              aria-expanded={filtersOpen}
              className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-semibold transition ${
                filtersOpen
                  ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.14)]"
                  : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10"
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t("pos.filters.title")}
              {activeSmartFilterCount > 0 ? (
                <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-black text-emerald-100">
                  {activeSmartFilterCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        <div ref={customerSearchWrapRef} className="relative w-full min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--card)]/80 p-3 shadow-xl shadow-black/10">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                ref={customerSearchRef}
                value={customerSearch}
                onChange={(e) => {
                  if (selectedCustomer) {
                    onClearCustomer?.();
                  }
                  setCustomerSearchActive(true);
                  setActiveCustomerIndex(-1);
                  setCustomerSearch(e.target.value);
                }}
                onFocus={() => {
                  if (!selectedCustomer) {
                    setCustomerSearchActive(true);
                  }
                }}
                placeholder={customerPlaceholder}
                className="h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-11 text-sm font-medium text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
              />
              {selectedCustomer ? (
                <button
                  type="button"
                  onClick={() => {
                    onClearCustomer?.();
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
            </div>
            <button
              type="button"
              onClick={onCreateCustomerClick}
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-4 text-sm font-black text-[var(--primary)] transition hover:border-[var(--primary)]/50 hover:bg-[var(--primary-soft)]/80"
              aria-label={t("pos.customer.add")}
            >
              {addCustomerLabel}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClearCustomer?.();
                setCustomerSearchActive(false);
                setActiveCustomerIndex(-1);
              }}
              className={`inline-flex h-9 items-center rounded-full border px-3 text-xs font-black transition ${
                selectedCustomer
                  ? "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)]/30 hover:text-[var(--primary)]"
                  : "border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary)]"
              }`}
            >
              {walkInLabel}
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
            <div className="mt-2">
              <CustomerQuickStats customer={selectedCustomer} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        accent
          ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--card)]"
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-lg font-black ${accent ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>
        {value}
      </div>
    </div>
  );
}

function CustomerQuickStats({ customer }) {
  const { t } = useTranslation();
  const tier = customer.loyalty_tier || customer.tier || "Bronze";
  const points = Number(customer.loyalty_points ?? customer.available_points ?? 0);
  const walletBalance = Number(customer.wallet_balance ?? customer.balance ?? 0);
  const totalOrders = Number(customer.total_orders ?? customer.totalOrders ?? customer.orders_count ?? 0);

  return (
    <div className="mt-2 grid translate-y-0 grid-cols-1 gap-2 opacity-100 transition-all duration-200 ease-out sm:grid-cols-3">
        <QuickStat icon={Wallet} label={t("pos.statsCard.wallet")} value={formatCurrency(walletBalance)} />
        <QuickStat
          icon={Gift}
          label={t("pos.statsCard.loyalty")}
          value={`${points.toLocaleString()} ${t("pos.statsCard.pts")}`}
          badge={tier}
        />
      <QuickStat icon={ReceiptText} label={t("pos.statsCard.invoices")} value={totalOrders.toLocaleString()} />
    </div>
  );
}

function QuickStat({ icon: Icon, label, value, badge }) {
  return (
    <div className="group min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 shadow-[0_0_18px_rgba(16,185,129,0.05)] transition hover:border-emerald-300/30 hover:bg-emerald-400/10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
          <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <span>{label}</span>
        </div>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <div className="truncate text-xs font-black text-white sm:text-sm">{value}</div>
        {badge ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-[9px] font-black text-cyan-100">
            <BadgeCheck className="h-3 w-3" />
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default PosHeader;
