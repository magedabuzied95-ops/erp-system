import { useState } from "react";
import { Bot, Check, Loader2, MessageSquareText, ShoppingBag, Sparkles, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

const clean = (value = "") => String(value ?? "").trim();

const MODE_OPTIONS = [
  { value: "off", labelKey: "aiSupport.inbox.ui.offLabel" },
  { value: "draft", labelKey: "aiSupport.inbox.ui.draftOnly" },
  { value: "manual_approval", labelKey: "aiSupport.inbox.ui.manualApproval" },
  { value: "full_auto", labelKey: "aiSupport.inbox.ui.fullAuto" },
];

function TogglePill({ label, active, onClick, light }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center rounded-xl px-3 text-[11px] font-black transition ${
        active
          ? light
            ? "bg-[#b98508] text-white"
            : "bg-amber-400 text-slate-950"
          : light
            ? "border border-[#ddd1b6] bg-white text-[#756c5b]"
            : "border border-white/10 bg-white/[0.04] text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function Section({ title, hint, action, children, light }) {
  return (
    <section className={`rounded-2xl border p-4 ${light ? "border-[#ddd3be] bg-[#fffdf9]" : "border-white/10 bg-white/[0.035]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black">{title}</div>
          {hint ? <div className={`mt-1 text-[11px] leading-5 ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{hint}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ModeSelect({ value, onChange, light, t }) {
  return (
    <select
      value={value || "manual_approval"}
      onChange={(event) => onChange(event.target.value)}
      className={`mt-3 h-10 w-full rounded-xl border px-3 text-sm font-black outline-none transition ${
        light ? "border-[#ddd1b6] bg-white text-[#28251f] focus:border-[#b98508]" : "border-white/10 bg-black/20 text-white"
      }`}
    >
      {MODE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
      ))}
    </select>
  );
}

function SaveButton({ onClick, saving, label, light }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-black transition disabled:opacity-50 ${
        light ? "bg-[#b98508] text-white hover:bg-[#9f7107]" : "bg-amber-400 text-slate-950"
      }`}
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

export function CommentsSettingsPanel({
  globalSettings = {},
  onGlobalSettingsChange,
  onSaveGlobalSettings,
  selectedPost = null,
  selectedTemplate = { template: null, loading: false, error: "" },
  onTemplateChange,
  onSaveTemplate,
  onOpenAutomation,
  onOpenProductLinks,
  postToolsEnabled = false,
  light = false,
}) {
  const { t } = useTranslation();
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const template = selectedTemplate?.template || null;
  const hasPost = Boolean(selectedPost);
  const postTitle = clean(selectedPost?.caption || selectedPost?.post_caption || selectedPost?.title || "");

  const patchGlobal = (patch) => onGlobalSettingsChange?.((current) => ({ ...current, ...patch }));
  const patchTemplate = (patch) =>
    onTemplateChange?.((current) => ({ ...current, template: { ...(current?.template || {}), ...patch } }));

  const saveGlobal = async () => {
    // Full auto replies without review — keep the confirmation that used to live in the workspace.
    if (clean(globalSettings.mode) === "full_auto" && !window.confirm(t("aiSupport.inbox.socialWorkspace.confirmGlobalFullAuto"))) return;
    setSavingGlobal(true);
    try {
      await onSaveGlobalSettings?.();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.commentsSettings.saveError"));
    } finally {
      setSavingGlobal(false);
    }
  };

  const saveTemplate = async () => {
    if (clean(template?.mode) === "full_auto" && !window.confirm(t("aiSupport.inbox.socialWorkspace.confirmPostFullAuto"))) return;
    setSavingTemplate(true);
    try {
      await onSaveTemplate?.();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.commentsSettings.saveError"));
    } finally {
      setSavingTemplate(false);
    }
  };

  const stateLabel = (on) => (on ? t("aiSupport.commentsSettings.on") : t("aiSupport.commentsSettings.off"));

  return (
    <div className="space-y-3">
      <Section
        light={light}
        title={t("aiSupport.commentsSettings.globalTitle")}
        hint={t("aiSupport.commentsSettings.globalHint")}
        action={<SaveButton onClick={() => void saveGlobal()} saving={savingGlobal} label={t("aiSupport.commentsSettings.save")} light={light} />}
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <TogglePill
            light={light}
            label={globalSettings.generic_enabled ? t("aiSupport.commentsSettings.enabled") : t("aiSupport.commentsSettings.disabled")}
            active={Boolean(globalSettings.generic_enabled)}
            onClick={() => patchGlobal({ generic_enabled: !globalSettings.generic_enabled })}
          />
          <TogglePill
            light={light}
            label={`${t("aiSupport.commentsSettings.like")} ${stateLabel(globalSettings.generic_like_enabled !== false)}`}
            active={globalSettings.generic_like_enabled !== false}
            onClick={() => patchGlobal({ generic_like_enabled: !(globalSettings.generic_like_enabled !== false) })}
          />
          <TogglePill
            light={light}
            label={`${t("aiSupport.commentsSettings.reply")} ${stateLabel(globalSettings.generic_reply_enabled !== false)}`}
            active={globalSettings.generic_reply_enabled !== false}
            onClick={() => patchGlobal({ generic_reply_enabled: !(globalSettings.generic_reply_enabled !== false) })}
          />
        </div>

        <ModeSelect light={light} t={t} value={globalSettings.mode} onChange={(mode) => patchGlobal({ mode })} />

        <textarea
          value={globalSettings.generic_template || ""}
          onChange={(event) => patchGlobal({ generic_template: event.target.value })}
          rows={4}
          placeholder={t("aiSupport.commentsSettings.templatePlaceholder")}
          className={`mt-3 w-full resize-none rounded-xl border p-3 text-sm leading-6 outline-none transition ${
            light ? "border-[#ddd1b6] bg-white text-[#28251f] focus:border-[#b98508]" : "border-white/10 bg-black/20 text-white"
          }`}
        />
        {clean(globalSettings.mode) === "full_auto" ? (
          <div className={`mt-2 rounded-xl border px-3 py-2 text-[11px] font-bold leading-5 ${light ? "border-[#e8c98a] bg-[#fff8e7] text-[#8a6100]" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
            {t("aiSupport.commentsSettings.fullAutoWarning")}
          </div>
        ) : null}
      </Section>

      <Section
        light={light}
        title={t("aiSupport.commentsSettings.postTitle")}
        hint={hasPost ? postTitle || t("aiSupport.commentsSettings.postHint") : t("aiSupport.commentsSettings.noPost")}
        action={hasPost ? <SaveButton onClick={() => void saveTemplate()} saving={savingTemplate} label={t("aiSupport.commentsSettings.save")} light={light} /> : null}
      >
        {!hasPost ? null : selectedTemplate?.loading ? (
          <div className="grid h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /></div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <TogglePill
                light={light}
                label={template?.enabled ? t("aiSupport.commentsSettings.enabled") : t("aiSupport.commentsSettings.disabled")}
                active={Boolean(template?.enabled)}
                onClick={() => patchTemplate({ enabled: !template?.enabled })}
              />
              <TogglePill
                light={light}
                label={`${t("aiSupport.commentsSettings.like")} ${stateLabel(template?.like_enabled !== false)}`}
                active={template?.like_enabled !== false}
                onClick={() => patchTemplate({ like_enabled: !(template?.like_enabled !== false) })}
              />
              <TogglePill
                light={light}
                label={`${t("aiSupport.commentsSettings.reply")} ${stateLabel(template?.reply_enabled !== false)}`}
                active={template?.reply_enabled !== false}
                onClick={() => patchTemplate({ reply_enabled: !(template?.reply_enabled !== false) })}
              />
            </div>

            <ModeSelect light={light} t={t} value={template?.mode} onChange={(mode) => patchTemplate({ mode })} />

            <textarea
              value={template?.template || ""}
              onChange={(event) => patchTemplate({ template: event.target.value })}
              rows={5}
              placeholder={t("aiSupport.commentsSettings.postTemplatePlaceholder")}
              className={`mt-3 w-full resize-none rounded-xl border p-3 text-sm leading-6 outline-none transition ${
                light ? "border-[#ddd1b6] bg-white text-[#28251f] focus:border-[#b98508]" : "border-white/10 bg-black/20 text-white"
              }`}
            />
            {selectedTemplate?.error ? (
              <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[11px] font-bold text-rose-300">{selectedTemplate.error}</div>
            ) : null}
          </>
        )}
      </Section>

      {postToolsEnabled ? (
        <Section light={light} title={t("aiSupport.commentsSettings.toolsTitle")} hint={hasPost ? "" : t("aiSupport.commentsSettings.noPost")}>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!hasPost}
              onClick={() => onOpenAutomation?.()}
              className={`flex items-start gap-3 rounded-xl border p-3 text-right transition disabled:opacity-40 ${
                light ? "border-[#ddd1b6] bg-white hover:border-[#cdbb8f]" : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${light ? "bg-[#fff3d2] text-[#9a6a00]" : "bg-amber-400/10 text-amber-300"}`}><Bot className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-black">{t("aiSupport.commentsSettings.automation")}</span>
                <span className={`mt-1 block text-[11px] leading-5 ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.commentsSettings.automationHint")}</span>
              </span>
            </button>
            <button
              type="button"
              disabled={!hasPost}
              onClick={() => onOpenProductLinks?.()}
              className={`flex items-start gap-3 rounded-xl border p-3 text-right transition disabled:opacity-40 ${
                light ? "border-[#ddd1b6] bg-white hover:border-[#cdbb8f]" : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${light ? "bg-[#fff3d2] text-[#9a6a00]" : "bg-amber-400/10 text-amber-300"}`}><ShoppingBag className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-black">{t("aiSupport.commentsSettings.productLinks")}</span>
                <span className={`mt-1 block text-[11px] leading-5 ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.commentsSettings.productLinksHint")}</span>
              </span>
            </button>
          </div>
        </Section>
      ) : (
        <div className={`flex items-start gap-3 rounded-2xl border border-dashed p-4 ${light ? "border-[#d8c9a7] bg-[#fffaf0] text-[#746b5b]" : "border-white/10 text-slate-400"}`}>
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 text-[11px] leading-5">{t("aiSupport.commentsSettings.openCommentsHint")}</div>
        </div>
      )}
    </div>
  );
}

export function CommentsSettingsModal({ open, onClose, light = false, ...panelProps }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[#17130d]/60 p-3 backdrop-blur-sm md:items-center"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section className={`flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border shadow-[0_30px_100px_rgba(47,35,12,0.36)] ${light ? "border-[#d8cba9] bg-[#f8f4eb] text-[#28251f]" : "border-amber-300/15 bg-[#181a18] text-white"}`}>
        <header className={`flex items-center justify-between gap-3 border-b px-4 py-4 md:px-5 ${light ? "border-[#ded4bd] bg-[#f5efe2]" : "border-white/10 bg-[#171917]"}`}>
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${light ? "bg-[#fff8e7] text-[#a87400] ring-1 ring-[#e6d4a6]" : "bg-amber-400/10 text-amber-200"}`}><MessageSquareText className="h-5 w-5" /></span>
            <div>
              <div className="text-lg font-black">{t("aiSupport.commentsSettings.title")}</div>
              <div className={`text-xs ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.commentsSettings.subtitle")}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className={`grid h-10 w-10 place-items-center rounded-xl transition ${light ? "bg-white text-[#625b4d] ring-1 ring-[#e3dbc9] hover:bg-[#f5efe2]" : "bg-white/[0.06] text-slate-300 hover:bg-white/10"}`}><X className="h-5 w-5" /></button>
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto p-3 md:p-4 ${light ? "bg-[#f3eee4]" : "bg-black/10"}`}>
          <CommentsSettingsPanel light={light} {...panelProps} />
        </div>
      </section>
    </div>
  );
}

export default CommentsSettingsPanel;
