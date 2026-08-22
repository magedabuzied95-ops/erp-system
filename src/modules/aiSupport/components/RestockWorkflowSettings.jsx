import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, RefreshCw, X } from "lucide-react";

import {
  getRestockRecovery,
  getRestockMessagingMode,
  getRestockNotifications,
  getRestockMessageTemplate,
  setRestockMessageTemplate,
  previewRestockMessageTemplate,
  setRestockMessagingMode,
  setTenantAutomation,
  setWorkflowEnabled,
  grantWorkflowTool,
  revokeWorkflowTool,
  seedRestockRecoveryTemplate,
} from "../../aiStudio/services/aiStudioApi";

// Every gate a restock request has to pass before a customer hears anything,
// in one modal: global automation (env, read-only here), tenant automation, the
// "Restock Customer Recovery" workflow, its restock.recover grant, the messaging
// mode, and the message template itself. The effective outcome is derived from
// all of them so staff never have to reason about which switch is the one still off.
const MODES = ["off", "preview_only", "approval_send", "auto_send"];
const MODE_LABEL_KEY = { off: "aiStudio.restock.messaging.off", preview_only: "aiStudio.restock.messaging.previewOnly", approval_send: "aiStudio.restock.messaging.approvalSend", auto_send: "aiStudio.restock.messaging.autoSend" };
const MODE_TITLE_KEY = { off: "aiStudio.restock.messaging.titleOff", preview_only: "aiStudio.restock.messaging.titlePreviewOnly", approval_send: "aiStudio.restock.messaging.titleApprovalSend", auto_send: "aiStudio.restock.messaging.titleAutoSend" };
const EFFECTIVE_KEY = { manual: "aiSupport.inbox.customer360.restockEffective.manual", preview: "aiSupport.inbox.customer360.restockEffective.preview", approval: "aiSupport.inbox.customer360.restockEffective.approval", auto: "aiSupport.inbox.customer360.restockEffective.auto" };
const PLACEHOLDER_HINT_KEY = {
  greeting: "aiSupport.inbox.customer360.restockPlaceholderGreeting",
  name: "aiSupport.inbox.customer360.restockPlaceholderName",
  product: "aiSupport.inbox.customer360.restockPlaceholderProduct",
  color: "aiSupport.inbox.customer360.restockPlaceholderColor",
  size: "aiSupport.inbox.customer360.restockPlaceholderSize",
};
const RECOVER_TOOL = "restock.recover";

const Toggle = ({ on, busy, disabled, onClick, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={busy || disabled}
    onClick={onClick}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${
      on ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)] bg-[var(--surface)]"
    }`}
  >
    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-[3px] rtl:-translate-x-[3px]"}`} />
    {busy ? <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-[var(--text)]" /> : null}
  </button>
);

const Row = ({ title, hint, children }) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
    <div className="min-w-0">
      <div className="text-xs font-black text-[var(--text)]">{title}</div>
      {hint ? <div className="mt-0.5 text-[10px] leading-4 text-[var(--muted)]">{hint}</div> : null}
    </div>
    {children}
  </div>
);

export default function RestockWorkflowSettings({ open = false, onClose = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState({ automation: null, workflow: null, mode: "off", pendingApproval: 0 });
  const [template, setTemplate] = useState({ saved: "", draft: "", defaultTemplate: "", isDefault: true, placeholders: [], preview: "" });
  const previewTimer = useRef(null);
  const textareaRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const [recovery, mode, notifications, tpl] = await Promise.all([
        getRestockRecovery(),
        getRestockMessagingMode(),
        getRestockNotifications(undefined, "pending_approval").catch(() => null),
        getRestockMessageTemplate().catch(() => null),
      ]);
      setState({
        automation: recovery?.automation || null,
        workflow: recovery?.workflow || null,
        mode: MODES.includes(mode?.mode) ? mode.mode : "off",
        pendingApproval: Array.isArray(notifications?.notifications) ? notifications.notifications.length : 0,
      });
      if (tpl?.template !== undefined) {
        setTemplate({ saved: tpl.template, draft: tpl.template, defaultTemplate: tpl.defaultTemplate || "", isDefault: Boolean(tpl.isDefault), placeholders: Array.isArray(tpl.placeholders) ? tpl.placeholders : [], preview: tpl.preview || "" });
      }
    } catch (error) {
      setMsg(error?.responseBody?.message || error?.message || t("aiStudio.restock.failed"));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  // Escape closes, like every other dialog in the inbox.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const run = async (key, action) => {
    setBusy(key);
    setMsg("");
    try {
      const result = await action();
      if (result?.success === false) setMsg(result?.message || t("aiStudio.restock.failed"));
      await load();
    } catch (error) {
      setMsg(error?.responseBody?.message || error?.message || t("aiStudio.restock.failed"));
    }
    setBusy("");
  };

  const changeMode = (mode) => {
    if (mode === state.mode) return;
    // Both sending modes reach a real customer; auto_send does it with nobody reading the draft.
    if (mode === "auto_send" && !window.confirm(t("aiStudio.restock.confirm.enableAutoSend"))) return;
    if (mode === "approval_send" && !window.confirm(t("aiStudio.restock.confirm.enableApprovalSend"))) return;
    void run(`mode:${mode}`, () => setRestockMessagingMode(mode));
  };

  // The preview is rendered server-side with the same function that renders the
  // real message, so what staff see here is exactly what the customer gets.
  const updateDraft = (value) => {
    setTemplate((current) => ({ ...current, draft: value }));
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const res = await previewRestockMessageTemplate(value);
        if (typeof res?.preview === "string") setTemplate((current) => (current.draft === value ? { ...current, preview: res.preview } : current));
      } catch { /* keep the last preview */ }
    }, 300);
  };
  const insertPlaceholder = (key) => {
    const token = `{${key}}`;
    const el = textareaRef.current;
    const value = template.draft;
    if (!el) { updateDraft(`${value}${token}`); return; }
    const start = el.selectionStart ?? value.length, end = el.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    updateDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };
  const saveTemplate = () => run("template", async () => {
    const res = await setRestockMessageTemplate(template.draft);
    if (res?.success !== false) setMsg(t("aiSupport.inbox.customer360.restockTemplateSaved"));
    return res;
  });
  const resetTemplate = () => {
    if (!window.confirm(t("aiSupport.inbox.customer360.restockTemplateResetConfirm"))) return;
    void run("template", () => setRestockMessageTemplate(""));
  };
  const templateDirty = template.draft !== template.saved;

  if (!open || typeof document === "undefined") return null;

  const automation = state.automation || {};
  const workflow = state.workflow;
  const globalOn = Boolean(automation.global_enabled);
  const tenantOn = Boolean(automation.tenant_enabled);
  const workflowOn = Boolean(workflow?.enabled);
  const granted = Boolean(workflow?.granted);
  const pipelineLive = globalOn && tenantOn && workflowOn && granted;
  const effective = !pipelineLive
    ? "manual"
    : state.mode === "auto_send"
      ? "auto"
      : state.mode === "approval_send"
        ? "approval"
        : state.mode === "preview_only"
          ? "preview"
          : "manual";
  const effectiveTone = effective === "auto" ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-700" : effective === "approval" ? "border-amber-300/60 bg-amber-500/10 text-amber-700" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]";

  return createPortal(
    <div className="m1-customer-360 fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("aiSupport.inbox.customer360.restockSettingsTitle")} className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <div className="text-sm font-black text-[var(--text)]">{t("aiSupport.inbox.customer360.restockSettingsTitle")}</div>
            <div className="text-[10px] text-[var(--muted)]">{t("aiSupport.inbox.customer360.restockCooldownNote")}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => onClose?.()} aria-label={t("aiSupport.inbox.customer360.cancel")} className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          <div className={`rounded-xl border px-3 py-2 text-xs font-black ${effectiveTone}`}>
            {t(EFFECTIVE_KEY[effective])}
          </div>

          <Row title={t("aiSupport.inbox.customer360.restockGlobalAutomation")} hint={globalOn ? t("aiSupport.inbox.customer360.restockGlobalOn") : t("aiSupport.inbox.customer360.restockGlobalOff")}>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${globalOn ? "border-emerald-300/60 text-emerald-700" : "border-rose-300/60 text-rose-600"}`}>{globalOn ? t("aiSupport.inbox.customer360.restockOn") : t("aiSupport.inbox.customer360.restockOff")}</span>
          </Row>

          <Row title={t("aiSupport.inbox.customer360.restockTenantAutomation")} hint={t("aiSupport.inbox.customer360.restockTenantAutomationHint")}>
            <Toggle on={tenantOn} busy={busy === "tenant"} label={t("aiSupport.inbox.customer360.restockTenantAutomation")} onClick={() => void run("tenant", () => setTenantAutomation(!tenantOn))} />
          </Row>

          <Row title={t("aiSupport.inbox.customer360.restockWorkflow")} hint={workflow ? t("aiSupport.inbox.customer360.restockWorkflowHint") : t("aiSupport.inbox.customer360.restockWorkflowMissing")}>
            {workflow ? (
              <Toggle on={workflowOn} busy={busy === "workflow"} label={t("aiSupport.inbox.customer360.restockWorkflow")} onClick={() => void run("workflow", () => setWorkflowEnabled(workflow.id, !workflowOn))} />
            ) : (
              <button type="button" disabled={busy === "seed"} onClick={() => void run("seed", () => seedRestockRecoveryTemplate())} className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-2.5 py-1 text-[10px] font-black text-[var(--primary)] disabled:opacity-50">
                {busy === "seed" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{t("aiSupport.inbox.customer360.restockWorkflowCreate")}
              </button>
            )}
          </Row>

          <Row title={t("aiSupport.inbox.customer360.restockGrant")} hint={t("aiSupport.inbox.customer360.restockGrantHint")}>
            <Toggle
              on={granted}
              busy={busy === "grant"}
              disabled={!workflow}
              label={t("aiSupport.inbox.customer360.restockGrant")}
              onClick={() => void run("grant", () => (granted ? revokeWorkflowTool(workflow.id, RECOVER_TOOL) : grantWorkflowTool(workflow.id, RECOVER_TOOL)))}
            />
          </Row>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <div className="text-xs font-black text-[var(--text)]">{t("aiStudio.restock.messaging.label")}</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {MODES.map((mode) => {
                const active = state.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    title={t(MODE_TITLE_KEY[mode])}
                    disabled={busy.startsWith("mode:")}
                    onClick={() => changeMode(mode)}
                    className={`rounded-lg border px-2 py-1.5 text-start text-[11px] font-black transition disabled:opacity-50 ${
                      active ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--text)]" : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:border-[var(--primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-1">{busy === `mode:${mode}` ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{t(MODE_LABEL_KEY[mode])}</div>
                    <div className="mt-0.5 text-[10px] font-semibold leading-4 text-[var(--muted)]">{t(MODE_TITLE_KEY[mode])}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Message template: placeholders are the only dynamic content, so staff
              can reword freely but can never make the message claim something
              the system does not know. */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-black text-[var(--text)]">{t("aiSupport.inbox.customer360.restockTemplateTitle")}</div>
              {template.isDefault ? <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-black text-[var(--muted)]">{t("aiSupport.inbox.customer360.restockTemplateDefaultBadge")}</span> : null}
            </div>
            <div className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{t("aiSupport.inbox.customer360.restockTemplateHint")}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {template.placeholders.map((key) => (
                <button key={key} type="button" onClick={() => insertPlaceholder(key)} title={t(PLACEHOLDER_HINT_KEY[key] || "")} className="rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-0.5 font-mono text-[10px] font-black text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                  {`{${key}}`}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={template.draft}
              onChange={(event) => updateDraft(event.target.value)}
              dir="auto"
              rows={5}
              maxLength={1000}
              className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
            <div className="mt-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">{t("aiSupport.inbox.customer360.restockTemplatePreview")}</div>
              <div dir="auto" className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--text)]">{template.preview || "—"}</div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button type="button" onClick={resetTemplate} disabled={busy === "template" || template.isDefault} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-black text-[var(--text-secondary)] disabled:opacity-50">{t("aiSupport.inbox.customer360.restockTemplateReset")}</button>
              <button type="button" onClick={saveTemplate} disabled={busy === "template" || !templateDirty} className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-1.5 text-[11px] font-black text-[var(--primary)] disabled:opacity-50">
                {busy === "template" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{t("aiSupport.inbox.customer360.restockTemplateSave")}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button type="button" onClick={() => { onClose?.(); navigate("/ai-studio/restock-recovery"); }} className="inline-flex items-center gap-1 text-[11px] font-black text-[var(--primary)]">
              {t("aiSupport.inbox.customer360.restockOpenStudio", { count: state.pendingApproval })} <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          {msg ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">{msg}</div> : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
