// Marketing automation settings — Comment-to-DM rules and their logs.
//
// The Meta CONNECTION half of this page (OAuth wizard, page/Instagram
// selection, capability cards, webhook diagnostics, token entry) has moved to
// the AI Inbox integrations center and is not duplicated here. Connections and
// the rules that ride on them are different jobs with different owners, and
// having two screens able to rewrite the same Meta credentials meant neither
// one could be trusted as the current state.

import { useEffect, useMemo, useState } from "react";
import { Bot, ExternalLink, MessageCircle, Plug, Plus, Settings2, Trash2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import MarketingStudioHeader from "../components/MarketingStudioHeader";

import {
  createCommentDmRule,
  deleteCommentDmRule,
  getCommentDmLogs,
  getCommentDmRules,
  testCommentDmRule,
  updateCommentDmRule,
} from "../services/marketingApi";

const blankRule = {
  name: "",
  platform: "facebook",
  post_id: "",
  platform_post_id: "",
  trigger_keywords: "",
  excluded_keywords: "",
  match_mode: "any",
  response_message: "مرحبًا {{commenter_name}}، شكرًا لتعليقك. أرسل لنا المقاس وسنساعدك في الطلب.",
  fallback_reply: "Thanks for your message. A team member will follow up shortly.",
  ai_generated_replies: true,
  template_name: "Default lead reply",
  is_active: true,
};

const listToInput = (value) => (Array.isArray(value) ? value.join(", ") : String(value || ""));

const inputToList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function MarketingSettings() {
  const { t } = useTranslation();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [aiSettings, setAiSettings] = useState({
    autoReply: true,
    intentDetection: true,
    humanEscalation: true,
    smartLeadDetection: true,
  });
  const [simulator, setSimulator] = useState({
    commenter_name: "Customer",
    comment_text: "price",
  });
  const [ruleForm, setRuleForm] = useState(blankRule);
  const [editingRuleId, setEditingRuleId] = useState(null);

  const applyRuleToForm = (rule = {}) => {
    setEditingRuleId(rule.id || null);
    setRuleForm({
      ...blankRule,
      ...rule,
      post_id: rule.post_id || "",
      trigger_keywords: listToInput(rule.trigger_keywords),
      excluded_keywords: listToInput(rule.excluded_keywords),
      is_active: Boolean(rule.is_active),
    });
  };

  const loadCommentDm = async () => {
    const [loadedRules, loadedLogs] = await Promise.all([getCommentDmRules(), getCommentDmLogs()]);
    setRules(Array.isArray(loadedRules) ? loadedRules : []);
    setLogs(Array.isArray(loadedLogs) ? loadedLogs : []);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        await loadCommentDm();
      } catch (err) {
        if (!active) return;
        setError(err?.message || t("marketing.automation.commentDm.loadFailed"));
        toast.error(err?.message || t("marketing.automation.commentDm.loadFailed"));
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const section = new URLSearchParams(location.search).get("section");
    if (!section) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`marketing-settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.search]);

  const saveRule = async () => {
    setSaving(true);
    try {
      const payload = {
        ...ruleForm,
        post_id: ruleForm.post_id || null,
        trigger_keywords: inputToList(ruleForm.trigger_keywords),
        excluded_keywords: inputToList(ruleForm.excluded_keywords),
      };
      if (editingRuleId) {
        await updateCommentDmRule(editingRuleId, payload);
        toast.success(t("marketing.automation.commentDm.updated"));
      } else {
        await createCommentDmRule(payload);
        toast.success(t("marketing.automation.commentDm.created"));
      }
      setEditingRuleId(null);
      setRuleForm(blankRule);
      await loadCommentDm();
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id) => {
    if (!window.confirm(t("marketing.automation.commentDm.deleteConfirm"))) return;
    try {
      await deleteCommentDmRule(id);
      toast.success(t("marketing.automation.commentDm.deleted"));
      if (editingRuleId === id) {
        setEditingRuleId(null);
        setRuleForm(blankRule);
      }
      await loadCommentDm();
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.deleteFailed"));
    }
  };

  const runRuleTest = async (rule) => {
    try {
      const result = await testCommentDmRule(rule.id, {
        commenter_name: "Customer",
        comment_text: inputToList(listToInput(rule.trigger_keywords))[0] || "price",
      });
      toast(result?.matched ? t("marketing.automation.commentDm.testMatched", { message: result.message }) : t("marketing.automation.commentDm.testNotMatched"));
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.testFailed"));
    }
  };

  const activeRulesCount = useMemo(() => rules.filter((rule) => rule.is_active !== false).length, [rules]);
  const successfulRuleCount = useMemo(() => logs.filter((log) => log.status === "sent").length, [logs]);
  const failedRuleCount = useMemo(() => logs.filter((log) => log.status === "failed").length, [logs]);

  return (
    <div dir="rtl" className="min-h-full bg-[var(--card)] text-[var(--text)]">
      <div className="mx-auto flex w-full flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
        <MarketingStudioHeader />
        <section className="rounded-[var(--radius-card)] border border-amber-400/15 bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="space-y-2">
            <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
              <Settings2 className="h-4 w-4" />
              {t("marketing.automation.commentDm.eyebrow")}
            </div>
            <h1 className="m1-display">{t("marketing.automation.commentDm.title")}</h1>
            <p className="max-w-3xl text-base leading-7 text-[var(--muted)]">
              {t("marketing.settings.capabilities.automationHelp", "قواعد التعليق إلى الرسالة والردود التلقائية وسجلات الأتمتة.")}
            </p>
          </div>
        </section>

        {/* Deliberately a link, not an embedded panel: one owner for the
            connection, and it is not this page. */}
        <Link
          to="/admin/ai-inbox?integrations=meta"
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] transition hover:border-amber-400/25 md:flex-row md:items-center md:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-400/25 bg-amber-400/10 text-amber-200">
              <Plug className="h-5 w-5" />
            </span>
            <div>
              <div className="font-black text-[var(--text)]">{t("marketing.settings.integrationsMoved.title")}</div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{t("marketing.settings.integrationsMoved.body")}</p>
            </div>
          </div>
          <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/25 bg-amber-400/10 px-4 text-sm font-black text-amber-100">
            <ExternalLink className="h-4 w-4" />
            {t("marketing.settings.integrationsMoved.action")}
          </span>
        </Link>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section id="marketing-settings-automation" className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
                <MessageCircle className="h-4 w-4" />
                {t("marketing.automation.commentDm.eyebrow")}
              </div>
              <h2 className="m1-section-title mt-3">{t("marketing.automation.commentDm.title")}</h2>
              <p className="mt-2 text-base leading-7 text-[var(--muted)]">
                {t("marketing.settings.capabilities.activeRules", "القواعد النشطة")}: {activeRulesCount}
                {loading ? ` — ${t("marketing.common.loading")}` : ""}
              </p>
            </div>
            <button onClick={() => { setEditingRuleId(null); setRuleForm(blankRule); }} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)]">
              <Plus className="h-4 w-4" />
              {t("marketing.automation.newRule")}
            </button>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-[var(--text)]">
                <Bot className="h-4 w-4 text-primary" />
                AI automation controls
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["autoReply", "الرد التلقائي بالذكاء الاصطناعي"],
                  ["intentDetection", "اكتشاف النية بالذكاء الاصطناعي"],
                  ["humanEscalation", "قواعد التصعيد البشري"],
                  ["smartLeadDetection", "اكتشاف العملاء المحتملين الذكي"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)]">
                    <span>{label}</span>
                    <input type="checkbox" checked={Boolean(aiSettings[key])} onChange={(event) => setAiSettings((current) => ({ ...current, [key]: event.target.checked }))} />
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-sm font-black text-[var(--text)]">{t("marketing.metaSettings.events.commentToMessagePerformance")}</div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["القواعد النشطة", activeRulesCount],
                  ["Sent replies", successfulRuleCount],
                  ["الردود الفاشلة", failedRuleCount],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="text-[11px] text-[var(--muted)]">{label}</div>
                    <div className="mt-1 text-lg font-black text-[var(--text)]">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.ruleName")}</span>
                  <input value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.social.platform")}</span>
                  <select value={ruleForm.platform} onChange={(event) => setRuleForm((current) => ({ ...current, platform: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none">
                    <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
                    <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.matchMode")}</span>
                  <select value={ruleForm.match_mode} onChange={(event) => setRuleForm((current) => ({ ...current, match_mode: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none">
                    <option value="any">{t("marketing.automation.matchModes.any")}</option>
                    <option value="all">{t("marketing.automation.matchModes.all")}</option>
                    <option value="exact">{t("marketing.automation.matchModes.exact")}</option>
                  </select>
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.triggerKeywords")}</span>
                  <input value={ruleForm.trigger_keywords} onChange={(event) => setRuleForm((current) => ({ ...current, trigger_keywords: event.target.value }))} placeholder={t("marketing.automation.placeholders.triggerKeywords")} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.excludedKeywords")}</span>
                  <input value={ruleForm.excluded_keywords} onChange={(event) => setRuleForm((current) => ({ ...current, excluded_keywords: event.target.value }))} placeholder={t("marketing.automation.placeholders.excludedKeywords")} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.erpPostId")}</span>
                  <input value={ruleForm.post_id} onChange={(event) => setRuleForm((current) => ({ ...current, post_id: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.platformPostId")}</span>
                  <input value={ruleForm.platform_post_id} onChange={(event) => setRuleForm((current) => ({ ...current, platform_post_id: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.dmMessage")}</span>
                  <textarea value={ruleForm.response_message} onChange={(event) => setRuleForm((current) => ({ ...current, response_message: event.target.value }))} rows={4} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.preview.template")}</span>
                  <input value={ruleForm.template_name || ""} onChange={(event) => setRuleForm((current) => ({ ...current, template_name: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={Boolean(ruleForm.ai_generated_replies)} onChange={(event) => setRuleForm((current) => ({ ...current, ai_generated_replies: event.target.checked }))} />
                  الردود المُولدة بالذكاء الاصطناعي
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.preview.fallbackReply")}</span>
                  <textarea value={ruleForm.fallback_reply || ""} onChange={(event) => setRuleForm((current) => ({ ...current, fallback_reply: event.target.value }))} rows={2} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={Boolean(ruleForm.is_active)} onChange={(event) => setRuleForm((current) => ({ ...current, is_active: event.target.checked }))} />
                  {t("marketing.campaigns.status.active")}
                </label>
                <button onClick={saveRule} disabled={saving} className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-semibold text-[var(--primary-contrast)] disabled:opacity-60">
                  {editingRuleId ? t("marketing.automation.updateRule") : t("marketing.automation.createRule")}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="text-sm font-black text-[var(--text)]">{t("marketing.metaSettings.preview.simulator")}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input value={simulator.commenter_name} onChange={(event) => setSimulator((current) => ({ ...current, commenter_name: event.target.value }))} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none" />
                  <input value={simulator.comment_text} onChange={(event) => setSimulator((current) => ({ ...current, comment_text: event.target.value }))} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none" />
                </div>
                <div className="mt-3 rounded-xl bg-[var(--surface)] p-3 text-sm leading-6 text-[var(--text)]">
                  {(ruleForm.response_message || ruleForm.fallback_reply || "").replace(/\{\{\s*commenter_name\s*\}\}/g, simulator.commenter_name || "Customer")}
                </div>
              </div>
              {rules.length ? rules.map((rule) => (
                <div key={rule.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-semibold text-[var(--text)]">{rule.name}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{rule.platform} / {rule.match_mode} / {rule.is_active ? t("marketing.campaigns.status.active") : t("marketing.campaigns.status.paused")}</div>
                      <div className="mt-2 text-sm text-[var(--muted)]">{listToInput(rule.trigger_keywords) || t("marketing.automation.allComments")}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => applyRuleToForm(rule)} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)]">{t("marketing.common.edit")}</button>
                      <button onClick={() => runRuleTest(rule)} className="rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">{t("marketing.automation.test")}</button>
                      <button onClick={() => removeRule(rule.id)} className="rounded-[var(--radius-control)] border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">{t("marketing.automation.commentDm.empty")}</div>
              )}

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.recentLogs")}</div>
                <div className="mt-3 space-y-2">
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                      <span className="truncate">{log.comment_text}</span>
                      <span className={log.status === "sent" ? "text-emerald-300" : "text-rose-300"}>{log.status}</span>
                    </div>
                  ))}
                  {!logs.length ? <div className="text-sm text-[var(--muted)]">{t("marketing.automation.noLogs")}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
