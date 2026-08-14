import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Loader2, MessageSquareText, ShoppingBag, Sparkles, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";

const DEFAULT_AUTOMATION = {
  auto_like_enabled: false,
  auto_public_reply_enabled: false,
  auto_private_message_enabled: false,
  min_confidence: 0.9,
  public_reply_template: "",
  public_reply_rotation_enabled: true,
  public_reply_openers: [],
  private_message_template: "",
  greeting_private_message_template: "",
};

const normalizeAutomation = (value = {}) => ({
  auto_like_enabled: Boolean(value.auto_like_enabled),
  auto_public_reply_enabled: Boolean(value.auto_public_reply_enabled),
  auto_private_message_enabled: Boolean(value.auto_private_message_enabled),
  min_confidence: Math.min(1, Math.max(0, Number(value.min_confidence ?? DEFAULT_AUTOMATION.min_confidence) || DEFAULT_AUTOMATION.min_confidence)),
  public_reply_template: String(value.public_reply_template ?? ""),
  public_reply_rotation_enabled: value.public_reply_rotation_enabled !== false,
  public_reply_openers: (Array.isArray(value.public_reply_openers) ? value.public_reply_openers : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean),
  private_message_template: String(value.private_message_template ?? ""),
  greeting_private_message_template: String(value.greeting_private_message_template ?? ""),
});

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

function SwitchRow({ label, hint, checked, onClick, light }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-right transition ${
        checked
          ? light ? "border-[#cdae63] bg-[#fdf3da]" : "border-emerald-300/25 bg-emerald-400/10"
          : light ? "border-[#ddd1b6] bg-white" : "border-white/10 bg-black/20"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-xs font-black">{label}</span>
        {hint ? <span className={`mt-1 block text-[11px] leading-5 ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{hint}</span> : null}
      </span>
      <span className={`h-6 w-11 shrink-0 rounded-full p-1 transition ${checked ? (light ? "bg-[#b98508]" : "bg-emerald-300") : light ? "bg-[#e3dbc9]" : "bg-white/10"}`}>
        <span className={`block h-4 w-4 rounded-full transition ${light ? "bg-white" : "bg-slate-950"} ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function SocialAutomationSection({ light }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(DEFAULT_AUTOMATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.getSocialAutomationSettings({ perfComponent: "CommentsSettings.loadSocialAutomation" });
      setSettings(normalizeAutomation(payload?.settings || {}));
    } catch (loadError) {
      const message = loadError?.responseBody?.message || loadError?.message || "";
      setError(message === "Request Failed" || !message ? t("aiSupport.commentsSettings.automationLoadFailed") : message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = await api.updateSocialAutomationSettings(normalizeAutomation(settings), {
        perfComponent: "CommentsSettings.saveSocialAutomation",
      });
      setSettings(normalizeAutomation(payload?.settings || {}));
      toast.success(t("aiSupport.commentsSettings.automationSaved"));
    } catch (saveError) {
      const message = saveError?.responseBody?.message || saveError?.message || "";
      const text = message === "Request Failed" || !message ? t("aiSupport.commentsSettings.automationSaveFailed") : message;
      setError(text);
      toast.error(text);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = `w-full rounded-xl border p-3 text-sm leading-6 outline-none transition ${
    light ? "border-[#ddd1b6] bg-white text-[#28251f] focus:border-[#b98508]" : "border-white/10 bg-black/20 text-white"
  }`;

  return (
    <Section
      light={light}
      title={t("aiSupport.commentsSettings.automationTitle")}
      hint={t("settings.social.appliesToInbox")}
      action={<SaveButton onClick={() => void save()} saving={saving} label={t("aiSupport.commentsSettings.save")} light={light} />}
    >
      <div className={`mt-3 rounded-xl border px-3 py-2 text-[11px] font-bold leading-5 ${light ? "border-[#e8c98a] bg-[#fff8e7] text-[#8a6100]" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
        {t("aiSupport.commentsSettings.automationWarning")}
      </div>
      {error ? (
        <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[11px] font-bold text-rose-300">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /></div>
      ) : (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <SwitchRow
            light={light}
            label={t("settings.social.enableAutoLike")}
            checked={settings.auto_like_enabled}
            onClick={() => patch("auto_like_enabled", !settings.auto_like_enabled)}
          />
          <SwitchRow
            light={light}
            label={t("settings.social.enableAutoPublicReply")}
            checked={settings.auto_public_reply_enabled}
            onClick={() => patch("auto_public_reply_enabled", !settings.auto_public_reply_enabled)}
          />
          <SwitchRow
            light={light}
            label={t("settings.social.enableAutoDm")}
            checked={settings.auto_private_message_enabled}
            onClick={() => patch("auto_private_message_enabled", !settings.auto_private_message_enabled)}
          />
          <SwitchRow
            light={light}
            label={t("settings.social.rotateOpeners")}
            hint={t("settings.social.rotateOpenersHint")}
            checked={settings.public_reply_rotation_enabled}
            onClick={() => patch("public_reply_rotation_enabled", !settings.public_reply_rotation_enabled)}
          />

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-xs font-black">{t("settings.social.minConfidence")}</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={settings.min_confidence}
              onChange={(event) => patch("min_confidence", event.target.value)}
              className={`${inputClass} h-11 py-0`}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-xs font-black">{t("settings.social.openersLabel")}</span>
            <textarea
              rows={6}
              value={(settings.public_reply_openers || []).join("\n")}
              onChange={(event) => patch("public_reply_openers", event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))}
              placeholder={t("settings.social.openerPlaceholder")}
              className={`${inputClass} resize-none`}
            />
            <span className={`mt-2 block text-[11px] ${light ? "text-[#756c5b]" : "text-slate-400"}`}>
              {t("settings.social.use")} <bdi>{"{{customer_name}}"}</bdi> {t("settings.social.useHint")}
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-xs font-black">{t("settings.social.fixedReplyText")}</span>
            <textarea
              rows={4}
              value={settings.public_reply_template}
              onChange={(event) => patch("public_reply_template", event.target.value)}
              className={`${inputClass} resize-none`}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-xs font-black">{t("settings.social.dmTemplate")}</span>
            <textarea
              rows={4}
              value={settings.private_message_template}
              onChange={(event) => patch("private_message_template", event.target.value)}
              placeholder={t("settings.social.optional")}
              className={`${inputClass} resize-none`}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-xs font-black">{t("aiSupport.commentsSettings.greetingTemplate")}</span>
            <textarea
              rows={4}
              value={settings.greeting_private_message_template}
              onChange={(event) => patch("greeting_private_message_template", event.target.value)}
              placeholder={t("aiSupport.commentsSettings.greetingPlaceholder")}
              className={`${inputClass} resize-none`}
            />
            <span className={`mt-2 block text-[11px] leading-5 ${light ? "text-[#756c5b]" : "text-slate-400"}`}>
              {t("aiSupport.commentsSettings.greetingHint")}
            </span>
          </label>
        </div>
      )}
    </Section>
  );
}

export function CommentsSettingsPanel({
  selectedPost = null,
  onOpenAutomation,
  onOpenProductLinks,
  postToolsEnabled = false,
  light = false,
}) {
  const { t } = useTranslation();
  const hasPost = Boolean(selectedPost);

  return (
    <div className="space-y-3">
      <SocialAutomationSection light={light} />
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
