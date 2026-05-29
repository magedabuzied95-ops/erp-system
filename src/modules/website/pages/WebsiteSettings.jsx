import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Globe, Palette, Save, Search, Settings, ShieldCheck, Truck, WalletCards } from "lucide-react";
import { api } from "../../../shared/api/api";
import { SALE_MODE_DEFAULTS, normalizeSaleModeSettings, saleModePreviewText } from "../../../shared/lib/saleMode";

const PRICING_DEFAULTS = {
  enable_fake_compare_price: true,
  fake_compare_percent: 20,
  fake_compare_rounding_mode: "none",
  ...SALE_MODE_DEFAULTS,
};

const settingsCards = [
  {
    title: "Website status",
    value: "Online",
    description: "Public storefront is available at /shop.",
    icon: ShieldCheck,
    tone: "emerald",
  },
  {
    title: "Domain",
    value: "Not connected",
    description: "Connect a custom domain for the customer storefront.",
    icon: Globe,
    tone: "blue",
  },
  {
    title: "Theme",
    value: "Premium minimal",
    description: "Control storefront logo, colors, typography, and homepage assets.",
    icon: Palette,
    tone: "violet",
  },
  {
    title: "Shipping provider",
    value: "Manual ready",
    description: "Bosta, Mylerz, Aramex, manual delivery, and pickup structure is ready.",
    icon: Truck,
    tone: "amber",
  },
  {
    title: "Payment provider",
    value: "COD active",
    description: "Cash on delivery is enabled. Online payment gateway can be configured later.",
    icon: WalletCards,
    tone: "cyan",
  },
  {
    title: "SEO settings",
    value: "Placeholders ready",
    description: "Meta title, description, Open Graph image, and product URL controls.",
    icon: Search,
    tone: "rose",
  },
];

function WebsiteSettings() {
  const [pricing, setPricing] = useState(PRICING_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/website/settings")
      .then((response) => {
        if (cancelled) return;
        setPricing({ ...PRICING_DEFAULTS, ...normalizeSaleModeSettings(response.settings || {}), ...(response.settings || {}) });
      })
      .catch(() => toast.error("Failed to load website settings"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savePricingSettings = async () => {
    setSaving(true);
    try {
      const payload = {
        enable_fake_compare_price: Boolean(pricing.enable_fake_compare_price),
        fake_compare_percent: Math.max(0, Number(pricing.fake_compare_percent || 0)),
        fake_compare_rounding_mode: pricing.fake_compare_rounding_mode || "none",
        ...normalizeSaleModeSettings(pricing),
        sale_mode_type: "use_existing_sale_prices_only",
        sale_mode_value: 0,
      };
      const response = await api.put("/website/settings", payload);
      setPricing({ ...PRICING_DEFAULTS, ...(response.settings || payload) });
      toast.success("Storefront pricing settings saved");
    } catch (error) {
      toast.error(error.message || "Failed to save pricing settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl shadow-[var(--shadow)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[var(--muted)]">
              <Settings className="h-4 w-4" />
              Website
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[var(--text)]">Website Settings</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Manage the public storefront configuration from one place. These controls are ready for real provider credentials and SEO data.
            </p>
          </div>
          <a
            href="/shop"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 py-3 text-sm font-black text-white shadow-lg"
          >
            <Globe className="h-4 w-4" />
            Open Storefront
          </a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {settingsCards.map((card) => (
          <SettingCard key={card.title} {...card} />
        ))}
      </div>

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl shadow-[var(--shadow)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-[var(--text)]">Storefront Pricing Settings</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Marketing compare prices are storefront-only. They do not affect POS, invoices, cost, valuation, or profit reports.
            </p>
          </div>
          <button
            type="button"
            onClick={savePricingSettings}
            disabled={loading || saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span>
              <span className="block text-sm font-black text-[var(--text)]">Enable fake compare price</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">Show generated old prices on storefront cards and product pages.</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(pricing.enable_fake_compare_price)}
              onChange={(event) => setPricing((current) => ({ ...current, enable_fake_compare_price: event.target.checked }))}
              className="h-5 w-5 accent-[var(--primary)]"
            />
          </label>

          <label className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span className="block text-sm font-black text-[var(--text)]">Fake compare percent</span>
            <input
              type="number"
              min="0"
              step="1"
              value={pricing.fake_compare_percent}
              onChange={(event) => setPricing((current) => ({ ...current, fake_compare_percent: event.target.value }))}
              className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none"
            />
          </label>

          <label className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span className="block text-sm font-black text-[var(--text)]">Rounding mode</span>
            <select
              value={pricing.fake_compare_rounding_mode}
              onChange={(event) => setPricing((current) => ({ ...current, fake_compare_rounding_mode: event.target.value }))}
              className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none"
            >
              <option value="none">none</option>
              <option value="nearest_10">nearest_10</option>
              <option value="nearest_50">nearest_50</option>
              <option value="nearest_100">nearest_100</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-6 shadow-xl shadow-[var(--shadow)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-[var(--text)]">Existing Sale Prices</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Turn on every product's saved real sale price in POS and storefront. Product prices are not overwritten in the database.
            </p>
            <p className="mt-3 text-sm font-black text-amber-200">{saleModePreviewText(pricing)}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              setPricing((current) => ({
                ...current,
                sale_mode_enabled: !current.sale_mode_enabled,
                sale_mode_type: "use_existing_sale_prices_only",
                sale_mode_value: 0,
              }))
            }
            className={`inline-flex h-12 items-center justify-center rounded-2xl px-5 text-sm font-black shadow-lg ${
              pricing.sale_mode_enabled ? "bg-amber-300 text-zinc-950" : "border border-amber-300/30 bg-black/10 text-amber-100"
            }`}
          >
            {pricing.sale_mode_enabled ? "Disable Existing Sale Prices" : "Enable Existing Sale Prices"}
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span className="block text-sm font-black text-[var(--text)]">Sale label</span>
            <input
              value={pricing.sale_mode_label || ""}
              onChange={(event) => setPricing((current) => ({ ...current, sale_mode_label: event.target.value }))}
              placeholder="Summer Sale"
              className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none"
            />
          </label>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span className="block text-sm font-black text-[var(--text)]">Active indicator</span>
            <span className="mt-3 block text-sm font-bold text-[var(--muted)]">
              {pricing.sale_mode_enabled ? "Products with saved sale prices are now live." : "Saved sale prices are currently hidden."}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            ["sale_mode_excluded_product_ids", "Excluded product IDs"],
            ["sale_mode_excluded_category_ids", "Excluded category IDs"],
            ["sale_mode_excluded_brand_ids", "Excluded brand IDs"],
          ].map(([key, label]) => (
            <label key={key} className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <span className="block text-sm font-black text-[var(--text)]">{label}</span>
              <input
                value={Array.isArray(pricing[key]) ? pricing[key].join(",") : pricing[key] || ""}
                onChange={(event) => setPricing((current) => ({ ...current, [key]: event.target.value }))}
                placeholder="Comma separated"
                className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none"
              />
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span>
              <span className="block text-sm font-black text-[var(--text)]">Minimum price protection</span>
              <span className="mt-1 block text-xs text-[var(--muted)]">Prevent global sale prices from going below cost plus margin.</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(pricing.sale_mode_min_price_protection_enabled)}
              onChange={(event) => setPricing((current) => ({ ...current, sale_mode_min_price_protection_enabled: event.target.checked }))}
              className="h-5 w-5 accent-[var(--primary)]"
            />
          </label>
          <label className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span className="block text-sm font-black text-[var(--text)]">Minimum margin percent</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={pricing.sale_mode_min_margin_percent}
              onChange={(event) => setPricing((current) => ({ ...current, sale_mode_min_margin_percent: event.target.value }))}
              className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none"
            />
          </label>
        </div>
      </section>

      <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-xl font-black text-[var(--text)]">Next configuration fields</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {["Storefront domain", "Logo and favicon", "Default shipping provider", "Payment gateway keys", "Homepage SEO title", "Open Graph image"].map((label) => (
            <label key={label} className="block">
              <span className="mb-2 block text-sm font-bold text-[var(--muted)]">{label}</span>
              <input
                disabled
                placeholder="Coming soon"
                className="h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-semibold text-[var(--muted)] outline-none"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingCard({ title, value, description, icon: Icon, tone }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  };

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{title}</div>
          <div className="mt-2 text-xl font-black text-[var(--text)]">{value}</div>
        </div>
        <div className={`rounded-2xl border p-3 ${tones[tone] || tones.blue}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}

export default WebsiteSettings;
