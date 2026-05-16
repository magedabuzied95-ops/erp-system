import { useMemo, useState } from "react";

import { CircleDollarSign, RotateCcw, Save, WalletCards } from "lucide-react";
import toast from "react-hot-toast";

import { formatCurrency, getCurrency, resetCurrency, setCurrency, supportedCurrencies } from "../../../shared/lib/currency";

function Currencies() {
  const [form, setForm] = useState(() => getCurrency());
  const current = useMemo(
    () => supportedCurrencies.find((item) => item.code === form.code && item.locale === form.locale && item.symbol === form.symbol),
    [form]
  );

  const handlePresetChange = (code) => {
    if (!code) {
      setForm((prev) => ({ ...prev, code: "", symbol: "", locale: "" }));
      return;
    }

    const preset = supportedCurrencies.find((item) => item.code === code);
    if (!preset) return;
    setForm({ code: preset.code, symbol: preset.symbol, locale: preset.locale });
  };

  const handleSave = () => {
    const next = {
      code: String(form.code || "").trim().toUpperCase(),
      symbol: String(form.symbol || "").trim(),
      locale: String(form.locale || "").trim(),
    };

    if (!next.code || !next.symbol || !next.locale) {
      toast.error("Currency code, symbol, and locale are required");
      return;
    }

    setCurrency(next);
    toast.success("Currency settings saved");
  };

  const handleReset = () => {
    const next = resetCurrency();
    setForm(next);
    toast.success("Currency reset to default");
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <section className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 text-emerald-300">
              <CircleDollarSign className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.24em]">Currency settings</span>
            </div>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white">ERP Currency</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
              Set the default currency used across product pricing, POS totals, invoices, reports, and analytics.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Preview</div>
            <div className="mt-1 text-lg font-black text-white">{formatCurrency(1850, form)}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="mb-5 flex items-center gap-3">
            <WalletCards className="h-5 w-5 text-cyan-300" />
            <div>
              <h2 className="text-xl font-black text-white">Currency profile</h2>
              <p className="mt-1 text-sm text-zinc-400">Choose a supported currency or edit the fields directly.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Preset</div>
              <select
                value={current?.code && current?.symbol && current?.locale ? current.code : ""}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">Custom</option>
                {supportedCurrencies.map((item) => (
                  <option key={item.code} value={item.code} className="bg-zinc-950 text-white">
                    {item.code} - {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Currency code</div>
              <input
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                placeholder="EGP"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>

            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Currency symbol</div>
              <input
                value={form.symbol}
                onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value }))}
                placeholder="E£"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>

            <label className="block md:col-span-2">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Locale</div>
              <input
                value={form.locale}
                onChange={(e) => setForm((prev) => ({ ...prev, locale: e.target.value }))}
                placeholder="ar-EG"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Stored value</div>
            <div className="mt-2 text-lg font-black text-white">{getCurrency().code}</div>
            <div className="mt-1 text-sm text-zinc-400">{getCurrency().symbol} / {getCurrency().locale}</div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Supported currencies</div>
            <div className="mt-4 grid gap-3">
              {supportedCurrencies.map((item) => {
                const active = form.code === item.code && form.symbol === item.symbol && form.locale === item.locale;
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setForm({ code: item.code, symbol: item.symbol, locale: item.locale })}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                      active ? "border-emerald-500/30 bg-emerald-500/10 text-white" : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{item.code}</div>
                      <div className="text-xs text-zinc-500">{item.label}</div>
                    </div>
                    <div className="text-sm font-black">{item.symbol}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400"
            >
              <Save className="h-4 w-4" />
              Save currency
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Currencies;
