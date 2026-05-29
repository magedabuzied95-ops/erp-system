import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";

const asArray = (value) => (Array.isArray(value) ? value : []);
const linesToArray = (value = "") => String(value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
const arrayToLines = (value = []) => asArray(value).join("\n");

const defaultSettings = {
  agent_name: "AI Sales Agent",
  egyptian_tone_level: 0.72,
  emoji_level: 0.2,
  reply_length: "balanced",
  sales_pressure: "medium",
  forbidden_phrases: ["أنا مساعد ذكي", "كنموذج لغوي", "لا أستطيع"],
  preferred_phrases: ["بص يا باشا", "تمام", "اختيار حلو", "أرشحلك"],
  allow_auto_draft_creation: true,
  require_human_approval_before_confirm: false,
  allow_discount_promises: false,
  max_discount_percent: 0,
  cod_availability_text: "الدفع عند الاستلام متاح حسب المنطقة وسياسة الشحن.",
  exchange_return_policy_text: "الاستبدال أو الاسترجاع حسب سياسة المتجر وحالة المنتج.",
  delivery_policy_text: "التوصيل بيتحدد حسب المحافظة والمنطقة ويتأكد قبل الشحن.",
  followups_enabled: true,
  followup_cooldown_hours: 24,
  max_followups_per_customer: 3,
  stop_followups_after_rejection: true,
  followup_templates: ["لسه مهتم بالموديل؟ أقدر أراجعلك المقاس واللون المتاح."],
  handoff_rules: {
    angry_customer: true,
    low_confidence: true,
    discount_request: true,
    return_exchange_complaint: true,
    stock_conflict: true,
    payment_issue: true,
  },
  suggested_replies_enabled: true,
  suggested_reply_count: 3,
  suggested_replies_tone_source: "ai_settings",
  require_takeover_before_suggestions: true,
};

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

function Field({ label, children, hint = "" }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="mt-2 block">{children}</span>
      {hint ? <span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return <input {...props} className={`h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 ${props.className || ""}`} />;
}

function TextArea(props) {
  return <textarea {...props} className={`min-h-28 w-full resize-y rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 ${props.className || ""}`} />;
}

function SelectInput(props) {
  return <select {...props} className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40" />;
}

function Toggle({ label, checked, onChange, hint = "" }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${checked ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-slate-950/70"}`}>
      <span>
        <span className="block text-sm font-black text-white">{label}</span>
        {hint ? <span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span> : null}
      </span>
      <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? "bg-emerald-300" : "bg-white/10"}`}>
        <span className={`block h-4 w-4 rounded-full bg-slate-950 transition ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-cyan-100">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

export default function AiAgentSettings() {
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const [settings, setSettings] = useState(defaultSettings);
  const [draft, setDraft] = useState({
    forbidden_phrases: arrayToLines(defaultSettings.forbidden_phrases),
    preferred_phrases: arrayToLines(defaultSettings.preferred_phrases),
    followup_templates: arrayToLines(defaultSettings.followup_templates),
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const patch = (updates) => setSettings((current) => ({ ...current, ...updates }));
  const patchHandoff = (key, value) => setSettings((current) => ({
    ...current,
    handoff_rules: { ...(current.handoff_rules || {}), [key]: value },
  }));

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await api.get("/ai-agent/settings", { params: { tenant_id: tenantId }, headers });
      const next = { ...defaultSettings, ...(payload.settings || {}) };
      setSettings(next);
      setDraft({
        forbidden_phrases: arrayToLines(next.forbidden_phrases),
        preferred_phrases: arrayToLines(next.preferred_phrases || next.allowed_phrases),
        followup_templates: arrayToLines(next.followup_templates),
      });
    } catch (err) {
      setError(err?.message || "Failed to load AI agent settings");
    } finally {
      setLoading(false);
    }
  }, [headers, tenantId]);

  useEffect(() => {
    Promise.resolve().then(loadSettings);
  }, [loadSettings]);

  const saveSettings = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const next = {
        ...settings,
        forbidden_phrases: linesToArray(draft.forbidden_phrases),
        preferred_phrases: linesToArray(draft.preferred_phrases),
        allowed_phrases: linesToArray(draft.preferred_phrases),
        followup_templates: linesToArray(draft.followup_templates),
      };
      const payload = await api.put("/ai-agent/settings", { tenant_id: tenantId, settings: next }, { headers });
      setSettings({ ...defaultSettings, ...(payload.settings || next) });
      setMessage("AI agent settings saved.");
    } catch (err) {
      setError(err?.message || "Failed to save AI agent settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div dir="ltr" className="min-h-full bg-[linear-gradient(180deg,#020617,#0f172a)] p-3 text-white md:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <section className="rounded-2xl border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-cyan-100"><Bot className="h-4 w-4" />AI Agent Control Center</div>
              <h1 className="mt-3 text-3xl font-black md:text-4xl">Sales Agent Settings</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Tenant-scoped controls for tone, sales rules, follow-ups, handoff triggers, and staff suggested replies.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadSettings} disabled={loading || saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-4 text-sm font-black text-white disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
              <button type="button" onClick={saveSettings} disabled={loading || saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save settings
              </button>
            </div>
          </div>
          {message ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100"><CheckCircle2 className="h-4 w-4" />{message}</div> : null}
          {error ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100"><AlertTriangle className="h-4 w-4" />{error}</div> : null}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={MessageSquareText} title="Personality & Tone">
            <Field label="Agent name"><TextInput value={settings.agent_name || ""} onChange={(event) => patch({ agent_name: event.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Egyptian tone level"><TextInput type="number" min="0" max="1" step="0.05" value={settings.egyptian_tone_level} onChange={(event) => patch({ egyptian_tone_level: Number(event.target.value), tone_intensity: Number(event.target.value) })} /></Field>
              <Field label="Emoji level"><TextInput type="number" min="0" max="1" step="0.05" value={settings.emoji_level} onChange={(event) => patch({ emoji_level: Number(event.target.value) })} /></Field>
              <Field label="Reply length"><SelectInput value={settings.reply_length} onChange={(event) => patch({ reply_length: event.target.value })}><option value="short">Short</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></SelectInput></Field>
              <Field label="Sales pressure"><SelectInput value={settings.sales_pressure} onChange={(event) => patch({ sales_pressure: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></SelectInput></Field>
            </div>
            <Field label="Forbidden phrases" hint="One phrase per line. These are stripped from AI sales replies."><TextArea value={draft.forbidden_phrases} onChange={(event) => setDraft((current) => ({ ...current, forbidden_phrases: event.target.value }))} /></Field>
            <Field label="Preferred phrases" hint="One phrase per line. Used as natural sales openers."><TextArea value={draft.preferred_phrases} onChange={(event) => setDraft((current) => ({ ...current, preferred_phrases: event.target.value }))} /></Field>
          </Section>

          <Section icon={ClipboardList} title="Sales Rules">
            <Toggle label="Allow auto draft creation" checked={settings.allow_auto_draft_creation !== false} onChange={(value) => patch({ allow_auto_draft_creation: value })} />
            <Toggle label="Require human approval before confirm" checked={settings.require_human_approval_before_confirm === true} onChange={(value) => patch({ require_human_approval_before_confirm: value })} />
            <Toggle label="Allow discount promises" checked={settings.allow_discount_promises === true} onChange={(value) => patch({ allow_discount_promises: value, discount_permission: value })} hint="Off by default. When off, AI can only say a staff member will review discounts." />
            <Field label="Max discount percent"><TextInput type="number" min="0" max="100" value={settings.max_discount_percent} onChange={(event) => patch({ max_discount_percent: Number(event.target.value) })} /></Field>
            <Field label="COD availability text"><TextArea value={settings.cod_availability_text || ""} onChange={(event) => patch({ cod_availability_text: event.target.value })} /></Field>
            <Field label="Exchange / return policy text"><TextArea value={settings.exchange_return_policy_text || ""} onChange={(event) => patch({ exchange_return_policy_text: event.target.value })} /></Field>
            <Field label="Delivery policy text"><TextArea value={settings.delivery_policy_text || ""} onChange={(event) => patch({ delivery_policy_text: event.target.value })} /></Field>
          </Section>

          <Section icon={RefreshCw} title="Follow-up Rules">
            <Toggle label="Enable follow-ups" checked={settings.followups_enabled !== false} onChange={(value) => patch({ followups_enabled: value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cooldown hours"><TextInput type="number" min="1" value={settings.followup_cooldown_hours} onChange={(event) => patch({ followup_cooldown_hours: Number(event.target.value) })} /></Field>
              <Field label="Max follow-ups per customer"><TextInput type="number" min="0" value={settings.max_followups_per_customer} onChange={(event) => patch({ max_followups_per_customer: Number(event.target.value) })} /></Field>
            </div>
            <Toggle label="Stop after rejection" checked={settings.stop_followups_after_rejection !== false} onChange={(value) => patch({ stop_followups_after_rejection: value })} />
            <Field label="Follow-up templates" hint="One template per line."><TextArea value={draft.followup_templates} onChange={(event) => setDraft((current) => ({ ...current, followup_templates: event.target.value }))} /></Field>
          </Section>

          <Section icon={AlertTriangle} title="Handoff Rules">
            <div className="grid gap-3">
              <Toggle label="Angry customer" checked={settings.handoff_rules?.angry_customer !== false} onChange={(value) => patchHandoff("angry_customer", value)} />
              <Toggle label="Low confidence" checked={settings.handoff_rules?.low_confidence !== false} onChange={(value) => patchHandoff("low_confidence", value)} />
              <Toggle label="Discount request" checked={settings.handoff_rules?.discount_request !== false} onChange={(value) => patchHandoff("discount_request", value)} />
              <Toggle label="Return/exchange complaint" checked={settings.handoff_rules?.return_exchange_complaint !== false} onChange={(value) => patchHandoff("return_exchange_complaint", value)} />
              <Toggle label="Stock conflict" checked={settings.handoff_rules?.stock_conflict !== false} onChange={(value) => patchHandoff("stock_conflict", value)} />
              <Toggle label="Payment issue" checked={settings.handoff_rules?.payment_issue !== false} onChange={(value) => patchHandoff("payment_issue", value)} />
            </div>
          </Section>

          <Section icon={Sparkles} title="Suggested Replies Rules">
            <Toggle label="Enable suggested replies" checked={settings.suggested_replies_enabled !== false} onChange={(value) => patch({ suggested_replies_enabled: value })} />
            <Field label="Suggestion count"><SelectInput value={settings.suggested_reply_count} onChange={(event) => patch({ suggested_reply_count: Number(event.target.value) })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></SelectInput></Field>
            <Field label="Tone source"><SelectInput value={settings.suggested_replies_tone_source || "ai_settings"} onChange={(event) => patch({ suggested_replies_tone_source: event.target.value })}><option value="ai_settings">AI settings</option></SelectInput></Field>
            <Toggle label="Require takeover before suggestions" checked={settings.require_takeover_before_suggestions !== false} onChange={(value) => patch({ require_takeover_before_suggestions: value })} />
          </Section>

          <Section icon={Settings2} title="Active Policy Snapshot">
            <div className="grid gap-2 text-sm leading-6 text-slate-300">
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">Discount promises: <b className="text-white">{settings.allow_discount_promises ? `Allowed up to ${settings.max_discount_percent || 0}%` : "Disabled"}</b></div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">Order drafts: <b className="text-white">{settings.allow_auto_draft_creation === false ? "Human only" : "AI can create drafts"}</b></div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">Confirmations: <b className="text-white">{settings.require_human_approval_before_confirm ? "Human approval required" : "AI can confirm existing drafts"}</b></div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">Suggested replies: <b className="text-white">{settings.suggested_replies_enabled === false ? "Disabled" : `${settings.suggested_reply_count || 3} suggestions`}</b></div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
