// How the agent speaks and how far it may go on its own.
//
// Same knobs as the /admin/ai-agent-settings page and the same i18n keys, moved inside the inbox so the
// person watching the conversations can change them without leaving the conversations. It reads and writes
// `PUT /ai-agent/settings`, which since 2026-09-19 splits the payload and sends these keys to
// `ai_agent_settings` — the per-tenant row the agent actually reads (see server/utils/aiSettingsPartition.js).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ClipboardList, MessageSquareText, RefreshCw, Settings2, Sparkles } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { PanelSection, PanelSkeleton } from "../integrations/integrationsUi.jsx";
import { Field, SaveBar, SelectInput, TextArea, TextInput, Toggle } from "./controlCenterUi.jsx";

const asArray = (value) => (Array.isArray(value) ? value : []);
const linesToArray = (value = "") => String(value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
const arrayToLines = (value = []) => asArray(value).join("\n");

export const AGENT_BEHAVIOUR_DEFAULTS = {
  agent_name: "AI Sales Agent",
  egyptian_tone_level: 0.72,
  emoji_level: 0.2,
  reply_length: "balanced",
  sales_pressure: "medium",
  forbidden_phrases: ["أنا مساعد ذكي", "كنموذج لغوي", "لا أستطيع"],
  preferred_phrases: ["أيوه يا فندم", "تمام", "اختيار حلو", "أرشحلك"],
  allow_auto_draft_creation: true,
  require_human_approval_before_confirm: false,
  allow_discount_promises: false,
  max_discount_percent: 0,
  cod_availability_text: "",
  exchange_return_policy_text: "",
  delivery_policy_text: "",
  followups_enabled: true,
  followup_cooldown_hours: 24,
  max_followups_per_customer: 3,
  stop_followups_after_rejection: true,
  followup_templates: [],
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

export default function AgentBehaviourPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(AGENT_BEHAVIOUR_DEFAULTS);
  const [draft, setDraft] = useState({ forbidden_phrases: "", preferred_phrases: "", followup_templates: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const patch = useCallback((updates) => {
    setSettings((current) => ({ ...current, ...updates }));
    setDirty(true);
    setMessage("");
  }, []);

  const patchHandoff = useCallback((key, value) => {
    setSettings((current) => ({ ...current, handoff_rules: { ...(current.handoff_rules || {}), [key]: value } }));
    setDirty(true);
    setMessage("");
  }, []);

  const patchDraft = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage("");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/settings", { params: { tenant_id: tenantId }, headers });
      const next = { ...AGENT_BEHAVIOUR_DEFAULTS, ...(payload?.settings || {}) };
      setSettings(next);
      setDraft({
        forbidden_phrases: arrayToLines(next.forbidden_phrases),
        preferred_phrases: arrayToLines(next.preferred_phrases || next.allowed_phrases),
        followup_templates: arrayToLines(next.followup_templates),
      });
      setDirty(false);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
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
      setSettings({ ...AGENT_BEHAVIOUR_DEFAULTS, ...(payload?.settings || next) });
      setDirty(false);
      setMessage(t("aiSupport.controlCenter.saved"));
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.saveError"));
    } finally {
      setSaving(false);
    }
  }, [draft, headers, settings, t, tenantId]);

  const snapshot = useMemo(() => ({
    discounts: settings.allow_discount_promises
      ? t("aiSupport.agentSettings.snapshot.discountAllowed", { percent: settings.max_discount_percent || 0 })
      : t("aiSupport.agentSettings.snapshot.disabled"),
    drafts: settings.allow_auto_draft_creation === false
      ? t("aiSupport.agentSettings.snapshot.humanOnly")
      : t("aiSupport.agentSettings.snapshot.aiCanDraft"),
    confirmations: settings.require_human_approval_before_confirm
      ? t("aiSupport.agentSettings.snapshot.approvalRequired")
      : t("aiSupport.agentSettings.snapshot.aiCanConfirm"),
    suggested: settings.suggested_replies_enabled === false
      ? t("aiSupport.agentSettings.snapshot.disabled")
      : t("aiSupport.agentSettings.snapshot.suggestionCount", { count: settings.suggested_reply_count || 3 }),
  }), [settings, t]);

  if (loading) return <PanelSkeleton rows={4} />;

  return (
    <div className="space-y-4">
      <PanelSection icon={MessageSquareText} title={t("aiSupport.agentSettings.tone.title")}>
        <div className="grid gap-4">
          <Field label={t("aiSupport.agentSettings.tone.agentName")}>
            <TextInput value={settings.agent_name || ""} onChange={(event) => patch({ agent_name: event.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("aiSupport.agentSettings.tone.egyptianLevel")}>
              <TextInput
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={settings.egyptian_tone_level}
                onChange={(event) => patch({ egyptian_tone_level: Number(event.target.value), tone_intensity: Number(event.target.value) })}
              />
            </Field>
            <Field label={t("aiSupport.agentSettings.tone.emojiLevel")}>
              <TextInput type="number" min="0" max="1" step="0.05" value={settings.emoji_level} onChange={(event) => patch({ emoji_level: Number(event.target.value) })} />
            </Field>
            <Field label={t("aiSupport.agentSettings.tone.replyLength")}>
              <SelectInput value={settings.reply_length} onChange={(event) => patch({ reply_length: event.target.value })}>
                <option value="short">{t("aiSupport.agentSettings.tone.short")}</option>
                <option value="balanced">{t("aiSupport.agentSettings.tone.balanced")}</option>
                <option value="detailed">{t("aiSupport.agentSettings.tone.detailed")}</option>
              </SelectInput>
            </Field>
            <Field label={t("aiSupport.agentSettings.tone.salesPressure")}>
              <SelectInput value={settings.sales_pressure} onChange={(event) => patch({ sales_pressure: event.target.value })}>
                <option value="low">{t("aiSupport.agentSettings.tone.low")}</option>
                <option value="medium">{t("aiSupport.agentSettings.tone.medium")}</option>
                <option value="high">{t("aiSupport.agentSettings.tone.high")}</option>
              </SelectInput>
            </Field>
          </div>
          <Field label={t("aiSupport.agentSettings.tone.forbidden")} hint={t("aiSupport.agentSettings.tone.forbiddenHint")}>
            <TextArea value={draft.forbidden_phrases} onChange={(event) => patchDraft("forbidden_phrases", event.target.value)} />
          </Field>
          <Field label={t("aiSupport.agentSettings.tone.preferred")} hint={t("aiSupport.agentSettings.tone.preferredHint")}>
            <TextArea value={draft.preferred_phrases} onChange={(event) => patchDraft("preferred_phrases", event.target.value)} />
          </Field>
        </div>
      </PanelSection>

      <PanelSection icon={ClipboardList} title={t("aiSupport.agentSettings.sales.title")}>
        <div className="grid gap-3">
          <Toggle label={t("aiSupport.agentSettings.sales.autoDraft")} checked={settings.allow_auto_draft_creation !== false} onChange={(value) => patch({ allow_auto_draft_creation: value })} />
          <Toggle label={t("aiSupport.agentSettings.sales.requireApproval")} checked={settings.require_human_approval_before_confirm === true} onChange={(value) => patch({ require_human_approval_before_confirm: value })} />
          <Toggle
            label={t("aiSupport.agentSettings.sales.allowDiscount")}
            hint={t("aiSupport.agentSettings.sales.allowDiscountHint")}
            checked={settings.allow_discount_promises === true}
            onChange={(value) => patch({ allow_discount_promises: value, discount_permission: value })}
          />
          <Field label={t("aiSupport.agentSettings.sales.maxDiscount")}>
            <TextInput type="number" min="0" max="100" value={settings.max_discount_percent} onChange={(event) => patch({ max_discount_percent: Number(event.target.value) })} />
          </Field>
          <Field label={t("aiSupport.agentSettings.sales.codText")}>
            <TextArea value={settings.cod_availability_text || ""} onChange={(event) => patch({ cod_availability_text: event.target.value })} />
          </Field>
          <Field label={t("aiSupport.agentSettings.sales.exchangeText")}>
            <TextArea value={settings.exchange_return_policy_text || ""} onChange={(event) => patch({ exchange_return_policy_text: event.target.value })} />
          </Field>
          <Field label={t("aiSupport.agentSettings.sales.deliveryText")}>
            <TextArea value={settings.delivery_policy_text || ""} onChange={(event) => patch({ delivery_policy_text: event.target.value })} />
          </Field>
        </div>
      </PanelSection>

      <PanelSection icon={RefreshCw} title={t("aiSupport.agentSettings.followups.title")}>
        <div className="grid gap-3">
          <Toggle label={t("aiSupport.agentSettings.followups.enable")} checked={settings.followups_enabled !== false} onChange={(value) => patch({ followups_enabled: value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("aiSupport.agentSettings.followups.cooldown")}>
              <TextInput type="number" min="1" value={settings.followup_cooldown_hours} onChange={(event) => patch({ followup_cooldown_hours: Number(event.target.value) })} />
            </Field>
            <Field label={t("aiSupport.agentSettings.followups.maxPerCustomer")}>
              <TextInput type="number" min="0" value={settings.max_followups_per_customer} onChange={(event) => patch({ max_followups_per_customer: Number(event.target.value) })} />
            </Field>
          </div>
          <Toggle label={t("aiSupport.agentSettings.followups.stopAfterRejection")} checked={settings.stop_followups_after_rejection !== false} onChange={(value) => patch({ stop_followups_after_rejection: value })} />
          <Field label={t("aiSupport.agentSettings.followups.templates")} hint={t("aiSupport.agentSettings.followups.templatesHint")}>
            <TextArea value={draft.followup_templates} onChange={(event) => patchDraft("followup_templates", event.target.value)} />
          </Field>
        </div>
      </PanelSection>

      <PanelSection icon={AlertTriangle} title={t("aiSupport.agentSettings.handoff.title")}>
        <div className="grid gap-3">
          <Toggle label={t("aiSupport.agentSettings.handoff.angry")} checked={settings.handoff_rules?.angry_customer !== false} onChange={(value) => patchHandoff("angry_customer", value)} />
          <Toggle label={t("aiSupport.agentSettings.handoff.lowConfidence")} checked={settings.handoff_rules?.low_confidence !== false} onChange={(value) => patchHandoff("low_confidence", value)} />
          <Toggle label={t("aiSupport.agentSettings.handoff.discount")} checked={settings.handoff_rules?.discount_request !== false} onChange={(value) => patchHandoff("discount_request", value)} />
          <Toggle label={t("aiSupport.agentSettings.handoff.returnExchange")} checked={settings.handoff_rules?.return_exchange_complaint !== false} onChange={(value) => patchHandoff("return_exchange_complaint", value)} />
          <Toggle label={t("aiSupport.agentSettings.handoff.stock")} checked={settings.handoff_rules?.stock_conflict !== false} onChange={(value) => patchHandoff("stock_conflict", value)} />
          <Toggle label={t("aiSupport.agentSettings.handoff.payment")} checked={settings.handoff_rules?.payment_issue !== false} onChange={(value) => patchHandoff("payment_issue", value)} />
        </div>
      </PanelSection>

      <PanelSection icon={Sparkles} title={t("aiSupport.agentSettings.suggested.title")}>
        <div className="grid gap-3">
          <Toggle label={t("aiSupport.agentSettings.suggested.enable")} checked={settings.suggested_replies_enabled !== false} onChange={(value) => patch({ suggested_replies_enabled: value })} />
          <Field label={t("aiSupport.agentSettings.suggested.count")}>
            <SelectInput value={settings.suggested_reply_count} onChange={(event) => patch({ suggested_reply_count: Number(event.target.value) })}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </SelectInput>
          </Field>
          <Toggle label={t("aiSupport.agentSettings.suggested.requireTakeover")} checked={settings.require_takeover_before_suggestions !== false} onChange={(value) => patch({ require_takeover_before_suggestions: value })} />
        </div>
      </PanelSection>

      <PanelSection icon={Settings2} title={t("aiSupport.agentSettings.snapshot.title")}>
        <div className="grid gap-2 text-sm leading-6 text-slate-300">
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">{t("aiSupport.agentSettings.snapshot.discounts")} <b className="text-white">{snapshot.discounts}</b></div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">{t("aiSupport.agentSettings.snapshot.drafts")} <b className="text-white">{snapshot.drafts}</b></div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">{t("aiSupport.agentSettings.snapshot.confirmations")} <b className="text-white">{snapshot.confirmations}</b></div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">{t("aiSupport.agentSettings.snapshot.suggested")} <b className="text-white">{snapshot.suggested}</b></div>
        </div>
      </PanelSection>

      <SaveBar
        onSave={save}
        saving={saving}
        dirty={dirty}
        message={message}
        error={error}
        saveLabel={saving ? t("aiSupport.controlCenter.saving") : t("aiSupport.controlCenter.save")}
        savedLabel={t("aiSupport.controlCenter.unsaved")}
      />
    </div>
  );
}
