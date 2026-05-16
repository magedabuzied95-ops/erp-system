import { Globe, Palette, Search, Settings, ShieldCheck, Truck, WalletCards } from "lucide-react";

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
