import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, CheckCircle2, Loader2, PlayCircle, Save, ShieldCheck, SlidersHorizontal, Sparkles, TerminalSquare } from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";
import "../../../theme/ai-surface.css";

const defaultSettings = {
  autoReplyMode: "suggest_only",
  tone: "casual",
  ai_shoe_cover_enabled: true,
  safety: {
    no_fake_stock: true,
    no_fake_price: true,
    escalate_angry_customers: true,
  },
  debug: {
    show_live_logs: true,
    show_memory_debug: true,
  },
};

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

const mergeSettings = (value = {}) => ({
  ...defaultSettings,
  ...value,
  safety: { ...defaultSettings.safety, ...(value.safety || {}) },
  debug: { ...defaultSettings.debug, ...(value.debug || {}) },
});

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl border border-primary/15 bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <h2 className="m1-section-title text-white">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function OptionCard({ active, title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[var(--radius-control)] border p-4 text-left transition ${active ? "border-primary/40 bg-primary/15 shadow-lg shadow-primary/10" : "border-white/10 bg-slate-950/55 hover:border-white/20"}`}>
      <span className="block text-sm font-black text-white">{title}</span>
      <span className="mt-2 block text-xs leading-5 text-slate-400">{description}</span>
    </button>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-left transition ${checked ? "border-emerald-300/25 bg-emerald-400/10" : "border-white/10 bg-slate-950/55"}`}>
      <span className="text-sm font-black text-white">{label}</span>
      <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? "bg-emerald-300" : "bg-white/10"}`}>
        <span className={`block h-4 w-4 rounded-full bg-[var(--primary-contrast)] transition ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function UrlRow({ label, value }) {
  const url = String(value || "").trim();
  return (
    <div className="min-w-0">
      {label}: {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-bold text-primary underline decoration-primary/50 underline-offset-4">
          {url}
        </a>
      ) : "n/a"}
    </div>
  );
}

export default function AiSettings() {
  const { t } = useTranslation();
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [playground, setPlayground] = useState({
    channelId: "facebook_messenger",
    platform: "facebook",
    message: "بكام؟",
    productId: "",
  });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.getAISettings({ params: { tenant_id: tenantId }, headers });
      setSettings(mergeSettings(payload.settings));
    } catch (err) {
      setError(err?.message || "تعذر تحميل إعدادات الذكاء الاصطناعي");
    } finally {
      setLoading(false);
    }
  }, [headers, tenantId]);

  useEffect(() => {
    Promise.resolve().then(loadSettings);
  }, [loadSettings]);

  const patch = (updates) => setSettings((current) => mergeSettings({ ...current, ...updates }));
  const patchGroup = (group, key, value) => setSettings((current) => mergeSettings({
    ...current,
    [group]: { ...(current[group] || {}), [key]: value },
  }));

  const saveSettings = async () => {
    setSaving(true);
    setToast("");
    setError("");
    try {
      const payload = await api.updateAISettings({ tenant_id: tenantId, settings }, { headers });
      setSettings(mergeSettings(payload.settings));
      setToast("AI settings saved.");
    } catch (err) {
      setError(err?.message || "تعذر حفظ إعدادات الذكاء الاصطناعي");
    } finally {
      setSaving(false);
    }
  };

  const runPlayground = async () => {
    setTesting(true);
    setError("");
    setTestResult(null);
    try {
      const payload = await api.testAIReply({
        tenant_id: tenantId,
        channelId: playground.channelId,
        platform: playground.platform,
        message: playground.message,
        productId: playground.productId || undefined,
      }, { headers });
      setTestResult(payload.result || null);
    } catch (err) {
      setError(err?.message || "تعذر اختبار رد الذكاء الاصطناعي");
    } finally {
      setTesting(false);
    }
  };

  const updatePlaygroundChannel = (channelId) => {
    const platform = channelId === "facebook_messenger" ? "facebook" : channelId;
    setPlayground((current) => ({ ...current, channelId, platform }));
  };

  return (
    <div dir="ltr" className="m1-ai-scope min-h-full p-3 text-white md:p-6">
      <div className="mx-auto flex w-full flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-primary"><Bot className="h-4 w-4" />{t("aiSupport.aiSettings.eyebrow")}</div>
              <h1 className="m1-page-title mt-3">{t("aiSupport.aiSettings.title")}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{t("aiSupport.aiSettings.subtitle")}</p>
              <p className="mt-3 max-w-3xl rounded-xl border border-primary/15 bg-primary/10 px-3 py-2 text-xs font-bold leading-5 text-primary">
                {t("aiSupport.aiSettings.masterNote")}
              </p>
            </div>
            <button type="button" onClick={saveSettings} disabled={loading || saving} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-slate-950 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("aiSupport.aiSettings.save")}
            </button>
          </div>
          {toast ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100"><CheckCircle2 className="h-4 w-4" />{toast}</div> : null}
          {error ? <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
        </section>

        <Section icon={SlidersHorizontal} title={t("aiSupport.aiSettings.mode.title")} subtitle={t("aiSupport.aiSettings.mode.subtitle")}>
          <div className="grid gap-3 md:grid-cols-3">
            <OptionCard active={settings.autoReplyMode === "off"} title={t("aiSupport.aiSettings.mode.off")} description={t("aiSupport.aiSettings.mode.offDesc")} onClick={() => patch({ autoReplyMode: "off" })} />
            <OptionCard active={settings.autoReplyMode === "suggest_only"} title={t("aiSupport.aiSettings.mode.suggestOnly")} description={t("aiSupport.aiSettings.mode.suggestOnlyDesc")} onClick={() => patch({ autoReplyMode: "suggest_only" })} />
            <OptionCard active={settings.autoReplyMode === "fully_automatic"} title={t("aiSupport.aiSettings.mode.fullyAutomatic")} description={t("aiSupport.aiSettings.mode.fullyAutomaticDesc")} onClick={() => patch({ autoReplyMode: "fully_automatic" })} />
          </div>
        </Section>

        <Section icon={Sparkles} title={t("aiSupport.aiSettings.tone.title")} subtitle={t("aiSupport.aiSettings.tone.subtitle")}>
          <div className="grid gap-3 md:grid-cols-3">
            <OptionCard active={settings.tone === "casual"} title={t("aiSupport.aiSettings.tone.casual")} description={t("aiSupport.aiSettings.tone.casualDesc")} onClick={() => patch({ tone: "casual" })} />
            <OptionCard active={settings.tone === "professional"} title={t("aiSupport.aiSettings.tone.professional")} description={t("aiSupport.aiSettings.tone.professionalDesc")} onClick={() => patch({ tone: "professional" })} />
            <OptionCard active={settings.tone === "luxury"} title={t("aiSupport.aiSettings.tone.luxury")} description={t("aiSupport.aiSettings.tone.luxuryDesc")} onClick={() => patch({ tone: "luxury" })} />
          </div>
        </Section>

        <Section icon={ShieldCheck} title={t("aiSupport.aiSettings.shoeCover.title")} subtitle={t("aiSupport.aiSettings.shoeCover.subtitle")}>
          <div className="grid gap-3">
            <Toggle
              label={t("aiSupport.aiSettings.shoeCover.title")}
              checked={settings.ai_shoe_cover_enabled !== false}
              onChange={(value) => patch({ ai_shoe_cover_enabled: value })}
            />
            <p className="text-xs leading-5 text-slate-400">
              {t("aiSupport.aiSettings.shoeCover.note")}
            </p>
          </div>
        </Section>

        <Section icon={PlayCircle} title={t("aiSupport.aiSettings.playground.title")} subtitle={t("aiSupport.aiSettings.playground.subtitle")}>
          <div className="grid gap-3 lg:grid-cols-[0.85fr_1fr]">
            <div className="grid gap-3">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.playground.channel")}</span>
                <select value={playground.channelId} onChange={(event) => updatePlaygroundChannel(event.target.value)} className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40">
                  <option value="facebook_messenger">{t("aiSupport.aiSettings.playground.facebookMessenger")}</option>
                  <option value="instagram">{t("aiSupport.aiSettings.playground.instagramDm")}</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="web_chat">{t("aiSupport.aiSettings.playground.webChat")}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.playground.platform")}</span>
                <input value={playground.platform} onChange={(event) => setPlayground((current) => ({ ...current, platform: event.target.value }))} className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.playground.productId")}</span>
                <input value={playground.productId} onChange={(event) => setPlayground((current) => ({ ...current, productId: event.target.value }))} placeholder={t("aiSupport.aiSettings.playground.productIdPlaceholder")} className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-primary/40" />
              </label>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.playground.customerMessage")}</span>
                <textarea value={playground.message} onChange={(event) => setPlayground((current) => ({ ...current, message: event.target.value }))} className="mt-2 min-h-36 w-full resize-y rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none focus:border-primary/40" />
              </label>
              <button type="button" onClick={runPlayground} disabled={testing || !playground.message.trim()} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                {t("aiSupport.aiSettings.playground.testReply")}
              </button>
            </div>
          </div>

          {testResult ? (
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">{t("aiSupport.aiSettings.result.intent")}</div><div className="mt-1 font-black text-white">{testResult.intent}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">{t("aiSupport.aiSettings.result.effectiveMode")}</div><div className="mt-1 font-black text-white">{testResult.effectiveMode}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">{t("aiSupport.aiSettings.result.effectiveTone")}</div><div className="mt-1 font-black text-white">{testResult.effectiveTone}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">{t("aiSupport.aiSettings.result.wouldAutoSend")}</div><div className={`mt-1 font-black ${testResult.wouldSendAutomatically ? "text-emerald-100" : "text-amber-100"}`}>{testResult.wouldSendAutomatically ? t("aiSupport.aiSettings.result.yes") : t("aiSupport.aiSettings.result.noSuggestOnly")}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3 md:col-span-2"><div className="text-xs text-slate-500">{t("aiSupport.aiSettings.result.safetyReason")}</div><div className="mt-1 font-black text-white">{testResult.safetyReason}</div></div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.result.productContext")}</div>
                  {testResult.productContext ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-300">
                      <div><b className="text-white">{testResult.productContext.name || t("aiSupport.aiSettings.result.unnamedProduct")}</b></div>
                      <div>{t("aiSupport.aiSettings.result.price")} {testResult.productContext.salePrice || testResult.productContext.price || t("aiSupport.aiSettings.result.priceUnavailable")}</div>
                      <div>{t("aiSupport.aiSettings.result.stock")} {testResult.productContext.inStock ? t("aiSupport.aiSettings.result.inStock") : t("aiSupport.aiSettings.result.outOfStock")}</div>
                      <div>{t("aiSupport.aiSettings.result.sizes")} {(testResult.productContext.sizes || []).join(", ") || t("aiSupport.aiSettings.result.na")}</div>
                      <UrlRow label={t("aiSupport.aiSettings.result.productUrl")} value={testResult.productContext.productUrl} />
                      <UrlRow label={t("aiSupport.aiSettings.result.imageUrl")} value={testResult.productContext.imageUrl} />
                    </div>
                  ) : <div className="mt-2 text-sm text-slate-500">{t("aiSupport.aiSettings.result.noProductContext")}</div>}
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.result.memoryFallback")}</div>
                  {testResult.memory?.lastProduct ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-300">
                      <div>{t("aiSupport.aiSettings.result.lastProduct")} <b className="text-white">{testResult.memory.lastProduct.name}</b></div>
                      <div>{t("aiSupport.aiSettings.result.lastSize")} {testResult.memory.lastSize || t("aiSupport.aiSettings.result.na")}</div>
                      <div>{t("aiSupport.aiSettings.result.lastIntent")} {testResult.memory.lastIntent || t("aiSupport.aiSettings.result.na")}</div>
                    </div>
                  ) : <div className="mt-2 text-sm text-slate-500">{t("aiSupport.aiSettings.result.noMemoryFallback")}</div>}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-100">{t("aiSupport.aiSettings.result.finalReply")}</div>
                <p dir="rtl" className="mt-3 text-base font-bold leading-8 text-white">{testResult.finalReply}</p>
              </div>
            </div>
          ) : null}
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={ShieldCheck} title={t("aiSupport.aiSettings.safety.title")} subtitle={t("aiSupport.aiSettings.safety.subtitle")}>
            <div className="grid gap-3">
              <Toggle label={t("aiSupport.aiSettings.safety.noFakeStock")} checked={settings.safety.no_fake_stock !== false} onChange={(value) => patchGroup("safety", "no_fake_stock", value)} />
              <Toggle label={t("aiSupport.aiSettings.safety.noFakePrice")} checked={settings.safety.no_fake_price !== false} onChange={(value) => patchGroup("safety", "no_fake_price", value)} />
              <Toggle label={t("aiSupport.aiSettings.safety.escalateAngry")} checked={settings.safety.escalate_angry_customers !== false} onChange={(value) => patchGroup("safety", "escalate_angry_customers", value)} />
            </div>
          </Section>

          <Section icon={TerminalSquare} title={t("aiSupport.aiSettings.debug.title")} subtitle={t("aiSupport.aiSettings.debug.subtitle")}>
            <div className="grid gap-3">
              <Toggle label={t("aiSupport.aiSettings.debug.showLogs")} checked={settings.debug.show_live_logs !== false} onChange={(value) => patchGroup("debug", "show_live_logs", value)} />
              <Toggle label={t("aiSupport.aiSettings.debug.showMemory")} checked={settings.debug.show_memory_debug !== false} onChange={(value) => patchGroup("debug", "show_memory_debug", value)} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
