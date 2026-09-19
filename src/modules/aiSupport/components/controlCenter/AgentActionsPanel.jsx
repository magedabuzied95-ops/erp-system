// What the agent may DO on its own, one switch per action, each with a "when should it do this" box.
//
// The switches are not a new layer of settings: the server maps each one onto the flag that really gates
// that action (see server/services/aiAgentActionPolicy.js), so turning something off here turns it off
// everywhere. Two rules are visible on the surface rather than hidden in the code:
//   • a SENSITIVE action never runs automatically — switched on, it only prepares work for a human;
//   • handing a conversation to a human can never be switched off.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Sparkles, Workflow } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { PanelSection, PanelSkeleton } from "../integrations/integrationsUi.jsx";
import { SaveBar, TextArea, Toggle } from "./controlCenterUi.jsx";

const RISK_TONE = {
  READ: "border-slate-300/15 bg-slate-400/10 text-slate-200",
  WRITE: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
  SENSITIVE: "border-amber-300/25 bg-amber-400/10 text-amber-100",
};

// Literal keys, never an interpolated lookup, so a missing translation is visible in a grep.
const actionTitle = (t, id) => {
  if (id === "send_product_card") return t("aiSupport.controlCenter.actions.sendProductCard.title");
  if (id === "suggested_replies") return t("aiSupport.controlCenter.actions.suggestedReplies.title");
  if (id === "request_address") return t("aiSupport.controlCenter.actions.requestAddress.title");
  if (id === "create_draft_order") return t("aiSupport.controlCenter.actions.createDraftOrder.title");
  if (id === "followups") return t("aiSupport.controlCenter.actions.followups.title");
  if (id === "confirm_order") return t("aiSupport.controlCenter.actions.confirmOrder.title");
  if (id === "handoff_to_human") return t("aiSupport.controlCenter.actions.handoffToHuman.title");
  return id;
};

const actionHint = (t, id) => {
  if (id === "send_product_card") return t("aiSupport.controlCenter.actions.sendProductCard.hint");
  if (id === "suggested_replies") return t("aiSupport.controlCenter.actions.suggestedReplies.hint");
  if (id === "request_address") return t("aiSupport.controlCenter.actions.requestAddress.hint");
  if (id === "create_draft_order") return t("aiSupport.controlCenter.actions.createDraftOrder.hint");
  if (id === "followups") return t("aiSupport.controlCenter.actions.followups.hint");
  if (id === "confirm_order") return t("aiSupport.controlCenter.actions.confirmOrder.hint");
  if (id === "handoff_to_human") return t("aiSupport.controlCenter.actions.handoffToHuman.hint");
  return "";
};

const riskLabel = (t, risk) => {
  if (risk === "SENSITIVE") return t("aiSupport.controlCenter.risk.sensitive");
  if (risk === "WRITE") return t("aiSupport.controlCenter.risk.write");
  return t("aiSupport.controlCenter.risk.read");
};

export default function AgentActionsPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/settings/actions", { params: { tenant_id: tenantId }, headers });
      setActions(Array.isArray(payload?.actions) ? payload.actions : []);
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

  const patchAction = useCallback((id, updates) => {
    setActions((current) => current.map((action) => (action.id === id ? { ...action, ...updates } : action)));
    setDirty(true);
    setMessage("");
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updates = Object.fromEntries(
        actions.map((action) => [action.id, { enabled: action.enabled, guidance: action.guidance || "" }])
      );
      const payload = await api.put("/ai-agent/settings/actions", { tenant_id: tenantId, actions: updates }, { headers });
      setActions(Array.isArray(payload?.actions) ? payload.actions : actions);
      setDirty(false);
      setMessage(t("aiSupport.controlCenter.saved"));
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.saveError"));
    } finally {
      setSaving(false);
    }
  }, [actions, headers, t, tenantId]);

  const enabledCount = useMemo(() => actions.filter((action) => action.enabled).length, [actions]);

  if (loading) return <PanelSkeleton rows={4} />;

  return (
    <div className="space-y-4">
      <PanelSection
        icon={Workflow}
        title={t("aiSupport.controlCenter.actions.title")}
        subtitle={t("aiSupport.controlCenter.actions.subtitle", { enabled: enabledCount, total: actions.length })}
      >
        <div className="grid gap-3">
          {actions.map((action) => (
            <div key={action.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${RISK_TONE[action.risk] || RISK_TONE.READ}`}>
                  {riskLabel(t, action.risk)}
                </span>
                {action.never_automatic ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black text-amber-100">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    {t("aiSupport.controlCenter.neverAutomatic")}
                  </span>
                ) : null}
              </div>
              <Toggle
                label={actionTitle(t, action.id)}
                hint={actionHint(t, action.id)}
                checked={action.enabled === true}
                disabled={action.locked === true}
                locked={action.locked === true}
                lockNote={action.locked ? t("aiSupport.controlCenter.actions.handoffToHuman.locked") : ""}
                onChange={(value) => patchAction(action.id, { enabled: value })}
              />
              {action.enabled ? (
                <label className="mt-2 block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    {t("aiSupport.controlCenter.actions.guidanceLabel")}
                  </span>
                  <TextArea
                    className="mt-2 min-h-20"
                    maxLength={2000}
                    value={action.guidance || ""}
                    placeholder={t("aiSupport.controlCenter.actions.guidancePlaceholder")}
                    onChange={(event) => patchAction(action.id, { guidance: event.target.value })}
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>
      </PanelSection>

      <p className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("aiSupport.controlCenter.actions.note")}
      </p>

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
