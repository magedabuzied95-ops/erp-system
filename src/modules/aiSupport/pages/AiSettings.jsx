import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Loader2, PlayCircle, Save, ShieldCheck, SlidersHorizontal, Sparkles, TerminalSquare } from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";

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
    <section className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl border border-primary/15 bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <h2 className="text-base font-black text-white">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function OptionCard({ active, title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border p-4 text-left transition ${active ? "border-primary/40 bg-primary/15 shadow-lg shadow-primary/10" : "border-white/10 bg-slate-950/55 hover:border-white/20"}`}>
      <span className="block text-sm font-black text-white">{title}</span>
      <span className="mt-2 block text-xs leading-5 text-slate-400">{description}</span>
    </button>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${checked ? "border-emerald-300/25 bg-emerald-400/10" : "border-white/10 bg-slate-950/55"}`}>
      <span className="text-sm font-black text-white">{label}</span>
      <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? "bg-emerald-300" : "bg-white/10"}`}>
        <span className={`block h-4 w-4 rounded-full bg-slate-950 transition ${checked ? "translate-x-5" : ""}`} />
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
    <div dir="ltr" className="min-h-full bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.13),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] p-3 text-white md:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <section className="rounded-2xl border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-primary"><Bot className="h-4 w-4" />AI Brain</div>
              <h1 className="mt-3 text-3xl font-black md:text-4xl">AI Settings</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Control automatic replies, tone, safety defaults, and debugging visibility for the Meta AI Inbox.</p>
              <p className="mt-3 max-w-3xl rounded-xl border border-primary/15 bg-primary/10 px-3 py-2 text-xs font-bold leading-5 text-primary">
                Global settings are the master control. A channel can only auto-reply when global mode and channel mode both allow fully automatic replies.
              </p>
            </div>
            <button type="button" onClick={saveSettings} disabled={loading || saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-slate-950 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
          {toast ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100"><CheckCircle2 className="h-4 w-4" />{toast}</div> : null}
          {error ? <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
        </section>

        <Section icon={SlidersHorizontal} title="Auto Reply Mode" subtitle="Global behavior. Fully automatic only sends when the channel setting also allows it.">
          <div className="grid gap-3 md:grid-cols-3">
            <OptionCard active={settings.autoReplyMode === "off"} title="Off" description="AI will not reply automatically." onClick={() => patch({ autoReplyMode: "off" })} />
            <OptionCard active={settings.autoReplyMode === "suggest_only"} title="Suggest only" description="AI drafts replies for staff." onClick={() => patch({ autoReplyMode: "suggest_only" })} />
            <OptionCard active={settings.autoReplyMode === "fully_automatic"} title="Fully automatic" description="AI can send replies automatically." onClick={() => patch({ autoReplyMode: "fully_automatic" })} />
          </div>
        </Section>

        <Section icon={Sparkles} title="Tone" subtitle="Lightweight instruction used by the AI reply layer.">
          <div className="grid gap-3 md:grid-cols-3">
            <OptionCard active={settings.tone === "casual"} title="Casual Egyptian" description="Friendly Egyptian Arabic, short and helpful." onClick={() => patch({ tone: "casual" })} />
            <OptionCard active={settings.tone === "professional"} title="Professional" description="Clear, respectful Arabic for service conversations." onClick={() => patch({ tone: "professional" })} />
            <OptionCard active={settings.tone === "luxury"} title="Luxury seller" description="Premium seller tone, confident and polished." onClick={() => patch({ tone: "luxury" })} />
          </div>
        </Section>

        <Section icon={ShieldCheck} title="AI Shoe Cover Generation" subtitle="Runtime toggle for new AI shoe cover jobs. Existing processing jobs are allowed to finish.">
          <div className="grid gap-3">
            <Toggle
              label="AI Shoe Cover Generation"
              checked={settings.ai_shoe_cover_enabled !== false}
              onChange={(value) => patch({ ai_shoe_cover_enabled: value })}
            />
            <p className="text-xs leading-5 text-slate-400">
              When this is off, new AI shoe cover jobs are not created. Product saves, AI Product Data, and AI Thermal Artwork keep working normally.
            </p>
          </div>
        </Section>

        <Section icon={PlayCircle} title="AI Test Playground" subtitle="Simulate an AI reply without sending anything to Meta or changing memory.">
          <div className="grid gap-3 lg:grid-cols-[0.85fr_1fr]">
            <div className="grid gap-3">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">القناة</span>
                <select value={playground.channelId} onChange={(event) => updatePlaygroundChannel(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40">
                  <option value="facebook_messenger">Facebook Messenger</option>
                  <option value="instagram">Instagram DM</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="web_chat">Web chat</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Platform</span>
                <input value={playground.platform} onChange={(event) => setPlayground((current) => ({ ...current, platform: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Optional Product ID</span>
                <input value={playground.productId} onChange={(event) => setPlayground((current) => ({ ...current, productId: event.target.value }))} placeholder="Example: 123" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-primary/40" />
              </label>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">رسالة العميل</span>
                <textarea value={playground.message} onChange={(event) => setPlayground((current) => ({ ...current, message: event.target.value }))} className="mt-2 min-h-36 w-full resize-y rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none focus:border-primary/40" />
              </label>
              <button type="button" onClick={runPlayground} disabled={testing || !playground.message.trim()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Test reply
              </button>
            </div>
          </div>

          {testResult ? (
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">Intent</div><div className="mt-1 font-black text-white">{testResult.intent}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">Effective mode</div><div className="mt-1 font-black text-white">{testResult.effectiveMode}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">Effective tone</div><div className="mt-1 font-black text-white">{testResult.effectiveTone}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3"><div className="text-xs text-slate-500">Would auto-send</div><div className={`mt-1 font-black ${testResult.wouldSendAutomatically ? "text-emerald-100" : "text-amber-100"}`}>{testResult.wouldSendAutomatically ? "Yes" : "No, suggest only"}</div></div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3 md:col-span-2"><div className="text-xs text-slate-500">Safety guard reason</div><div className="mt-1 font-black text-white">{testResult.safetyReason}</div></div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Product context</div>
                  {testResult.productContext ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-300">
                      <div><b className="text-white">{testResult.productContext.name || "Unnamed product"}</b></div>
                      <div>السعر: {testResult.productContext.salePrice || testResult.productContext.price || "غير متاح"}</div>
                      <div>المخزون: {testResult.productContext.inStock ? "متوفر" : "غير متوفر"}</div>
                      <div>Sizes: {(testResult.productContext.sizes || []).join(", ") || "n/a"}</div>
                      <UrlRow label="Product URL" value={testResult.productContext.productUrl} />
                      <UrlRow label="Image URL" value={testResult.productContext.imageUrl} />
                    </div>
                  ) : <div className="mt-2 text-sm text-slate-500">No product context found.</div>}
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/55 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Memory fallback</div>
                  {testResult.memory?.lastProduct ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-300">
                      <div>Last product: <b className="text-white">{testResult.memory.lastProduct.name}</b></div>
                      <div>Last size: {testResult.memory.lastSize || "n/a"}</div>
                      <div>Last intent: {testResult.memory.lastIntent || "n/a"}</div>
                    </div>
                  ) : <div className="mt-2 text-sm text-slate-500">No memory fallback used.</div>}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-100">Final reply preview</div>
                <p dir="rtl" className="mt-3 text-base font-bold leading-8 text-white">{testResult.finalReply}</p>
              </div>
            </div>
          ) : null}
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={ShieldCheck} title="Safety" subtitle="Defaults stay on to prevent bad commerce claims.">
            <div className="grid gap-3">
              <Toggle label="لا تختلق المخزون" checked={settings.safety.no_fake_stock !== false} onChange={(value) => patchGroup("safety", "no_fake_stock", value)} />
              <Toggle label="لا تختلق الأسعار" checked={settings.safety.no_fake_price !== false} onChange={(value) => patchGroup("safety", "no_fake_price", value)} />
              <Toggle label="Escalate angry customers" checked={settings.safety.escalate_angry_customers !== false} onChange={(value) => patchGroup("safety", "escalate_angry_customers", value)} />
            </div>
          </Section>

          <Section icon={TerminalSquare} title="Debug Options" subtitle="Visibility tools for the live AI Inbox console.">
            <div className="grid gap-3">
              <Toggle label="Show live AI logs" checked={settings.debug.show_live_logs !== false} onChange={(value) => patchGroup("debug", "show_live_logs", value)} />
              <Toggle label="Show conversation memory debug" checked={settings.debug.show_memory_debug !== false} onChange={(value) => patchGroup("debug", "show_memory_debug", value)} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
