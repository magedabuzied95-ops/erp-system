// Teach the agent.
//
// Before this existed, the only things an owner could tell the agent were eleven predetermined blanks
// in the Smart Support Knowledge Base, each reachable only when the customer's message tripped one of
// nine keyword intents frozen in code. Anything written outside those blanks reached no customer on any
// channel. This is the surface where whatever the owner writes actually gets said.
//
// Two kinds, because they answer two different needs:
//   • رد ثابت — the owner writes the trigger words AND the exact sentence; it is sent verbatim.
//   • معلومة — a fact with no trigger; the agent uses it in its own words wherever it is relevant.
//
// The tester is not a nicety. A trigger is a rule that will run against real customers, and the only
// honest way to let someone verify one is to let them try a message and see which rule fires.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Check, GraduationCap, Lightbulb, Loader2, MessageSquareQuote, Pencil, Plus, TestTube2, Trash2, X } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSection, PanelSkeleton } from "../integrations/integrationsUi.jsx";
import { Field, TextArea, TextInput, Toggle } from "./controlCenterUi.jsx";

const EMPTY_DRAFT = { id: null, kind: "fixed_answer", title: "", triggers: "", answer: "", enabled: true, priority: 0 };

const triggersToText = (triggers = []) => (Array.isArray(triggers) ? triggers.join("، ") : "");

export default function TeachAgentPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);

  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Mined on demand, never on mount: it reads 60 days of conversations, which is not a cost to pay
  // for someone who only opened this tab to add one rule.
  const [suggestions, setSuggestions] = useState(null);
  const [mining, setMining] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/knowledge", { params: { tenant_id: tenantId }, headers });
      setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fixedAnswers = useMemo(() => entries.filter((entry) => entry.kind === "fixed_answer"), [entries]);
  const knowledge = useMemo(() => entries.filter((entry) => entry.kind === "knowledge"), [entries]);

  const startCreate = (kind) => setDraft({ ...EMPTY_DRAFT, kind });
  const startEdit = (entry) =>
    setDraft({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      triggers: triggersToText(entry.triggers),
      answer: entry.answer,
      enabled: entry.enabled !== false,
      priority: entry.priority || 0,
    });

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        tenant_id: tenantId,
        kind: draft.kind,
        title: draft.title,
        answer: draft.answer,
        enabled: draft.enabled,
        priority: Number(draft.priority) || 0,
        // The server splits on newlines and both comma shapes, so the owner can type either.
        triggers: draft.kind === "fixed_answer" ? draft.triggers : [],
      };
      if (draft.id) await api.patch(`/ai-agent/knowledge/${draft.id}`, body, { headers });
      else await api.post("/ai-agent/knowledge", body, { headers });
      setDraft(null);
      setTestResult(null);
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.saveError"));
    } finally {
      setSaving(false);
    }
  }, [draft, headers, load, t, tenantId]);

  const toggleEnabled = useCallback(async (entry) => {
    try {
      await api.patch(`/ai-agent/knowledge/${entry.id}`, { tenant_id: tenantId, enabled: !entry.enabled }, { headers });
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.saveError"));
    }
  }, [headers, load, t, tenantId]);

  const remove = useCallback(async (entry) => {
    if (!window.confirm(t("aiSupport.controlCenter.teach.confirmDelete", { title: entry.title || "" }))) return;
    try {
      await api.delete(`/ai-agent/knowledge/${entry.id}`, { params: { tenant_id: tenantId }, headers });
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.saveError"));
    }
  }, [headers, load, t, tenantId]);

  const runTest = useCallback(async () => {
    if (!String(testMessage || "").trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const payload = await api.post("/ai-agent/knowledge/test", { tenant_id: tenantId, message: testMessage }, { headers });
      setTestResult(payload || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.teach.testError"));
    } finally {
      setTesting(false);
    }
  }, [headers, t, tenantId, testMessage]);

  const loadSuggestions = useCallback(async () => {
    setMining(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/knowledge/suggestions", { params: { tenant_id: tenantId }, headers });
      setSuggestions(payload || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.teach.suggestionsError"));
    } finally {
      setMining(false);
    }
  }, [headers, t, tenantId]);

  if (loading) return <PanelSkeleton rows={4} />;

  const renderRow = (entry) => (
    <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div dir="auto" className="text-sm font-black text-white">
            {entry.title || t("aiSupport.controlCenter.teach.untitled")}
          </div>
          {entry.kind === "fixed_answer" && entry.triggers?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entry.triggers.map((trigger) => (
                <span
                  key={trigger}
                  dir="auto"
                  className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black text-cyan-100"
                >
                  {trigger}
                </span>
              ))}
            </div>
          ) : null}
          <div dir="auto" className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-400">{entry.answer}</div>
          {entry.match_count > 0 ? (
            <div className="mt-1 text-[10px] font-bold text-emerald-200/70">
              {t("aiSupport.controlCenter.teach.usedCount", { count: entry.match_count })}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => toggleEnabled(entry)}
            title={entry.enabled ? t("aiSupport.controlCenter.teach.disable") : t("aiSupport.controlCenter.teach.enable")}
            className={`grid h-8 w-8 place-items-center rounded-lg ${
              entry.enabled ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-500/10 text-slate-500"
            }`}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => startEdit(entry)}
            className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => remove(entry)}
            className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{error}</div>
      ) : null}

      {draft ? (
        <PanelSection
          icon={draft.kind === "fixed_answer" ? MessageSquareQuote : BookOpen}
          title={
            draft.kind === "fixed_answer"
              ? t("aiSupport.controlCenter.teach.fixedTitle")
              : t("aiSupport.controlCenter.teach.knowledgeTitle")
          }
          subtitle={
            draft.kind === "fixed_answer"
              ? t("aiSupport.controlCenter.teach.fixedSubtitle")
              : t("aiSupport.controlCenter.teach.knowledgeSubtitle")
          }
          action={
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-slate-300"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          }
        >
          <div className="grid gap-4">
            <Field label={t("aiSupport.controlCenter.teach.name")}>
              <TextInput value={draft.title} onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))} />
            </Field>
            {draft.kind === "fixed_answer" ? (
              <Field label={t("aiSupport.controlCenter.teach.triggers")} hint={t("aiSupport.controlCenter.teach.triggersHint")}>
                <TextArea
                  className="min-h-20"
                  value={draft.triggers}
                  placeholder={t("aiSupport.controlCenter.teach.triggersPlaceholder")}
                  onChange={(event) => setDraft((d) => ({ ...d, triggers: event.target.value }))}
                />
              </Field>
            ) : null}
            <Field
              label={
                draft.kind === "fixed_answer"
                  ? t("aiSupport.controlCenter.teach.exactAnswer")
                  : t("aiSupport.controlCenter.teach.theFact")
              }
              hint={
                draft.kind === "fixed_answer"
                  ? t("aiSupport.controlCenter.teach.exactAnswerHint")
                  : t("aiSupport.controlCenter.teach.theFactHint")
              }
            >
              <TextArea
                value={draft.answer}
                maxLength={2000}
                onChange={(event) => setDraft((d) => ({ ...d, answer: event.target.value }))}
              />
            </Field>
            <Toggle
              label={t("aiSupport.controlCenter.teach.enabledLabel")}
              checked={draft.enabled}
              onChange={(value) => setDraft((d) => ({ ...d, enabled: value }))}
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || !String(draft.answer || "").trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 transition disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              {t("aiSupport.controlCenter.save")}
            </button>
          </div>
        </PanelSection>
      ) : null}

      <PanelSection
        icon={MessageSquareQuote}
        title={t("aiSupport.controlCenter.teach.fixedListTitle")}
        subtitle={t("aiSupport.controlCenter.teach.fixedListSubtitle")}
        action={
          <ActionButton tone="ghost" icon={Plus} onClick={() => startCreate("fixed_answer")}>
            {t("aiSupport.controlCenter.teach.add")}
          </ActionButton>
        }
      >
        {fixedAnswers.length ? (
          <div className="grid gap-2">{fixedAnswers.map(renderRow)}</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            {t("aiSupport.controlCenter.teach.fixedEmpty")}
          </div>
        )}
      </PanelSection>

      <PanelSection
        icon={BookOpen}
        title={t("aiSupport.controlCenter.teach.knowledgeListTitle")}
        subtitle={t("aiSupport.controlCenter.teach.knowledgeListSubtitle")}
        action={
          <ActionButton tone="ghost" icon={Plus} onClick={() => startCreate("knowledge")}>
            {t("aiSupport.controlCenter.teach.add")}
          </ActionButton>
        }
      >
        {knowledge.length ? (
          <div className="grid gap-2">{knowledge.map(renderRow)}</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            {t("aiSupport.controlCenter.teach.knowledgeEmpty")}
          </div>
        )}
      </PanelSection>

      <PanelSection
        icon={Lightbulb}
        title={t("aiSupport.controlCenter.teach.suggestionsTitle")}
        subtitle={t("aiSupport.controlCenter.teach.suggestionsSubtitle")}
        action={
          <ActionButton tone="ghost" icon={Lightbulb} loading={mining} onClick={loadSuggestions}>
            {t("aiSupport.controlCenter.teach.suggestionsRun")}
          </ActionButton>
        }
      >
        {suggestions === null ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            {t("aiSupport.controlCenter.teach.suggestionsIdle")}
          </div>
        ) : !suggestions.enough_history ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold leading-5 text-slate-400">
            {t("aiSupport.controlCenter.teach.suggestionsThin", { count: suggestions.pairs_examined || 0 })}
          </div>
        ) : suggestions.suggestions?.length ? (
          <div className="grid gap-2">
            {suggestions.suggestions.map((item, index) => (
              <div key={`${item.question}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black text-amber-100">
                    {t("aiSupport.controlCenter.teach.askedCount", { count: item.asked_count })}
                  </span>
                </div>
                <div dir="auto" className="mt-1.5 text-sm font-black text-white">{item.question}</div>
                <div dir="auto" className="mt-1 line-clamp-3 text-[11px] leading-5 text-slate-400">{item.suggested_answer}</div>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...EMPTY_DRAFT,
                      kind: "fixed_answer",
                      title: item.question.slice(0, 120),
                      triggers: (item.suggested_triggers || []).join("، "),
                      answer: item.suggested_answer,
                    })
                  }
                  className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-3 text-[11px] font-black text-cyan-100"
                >
                  <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("aiSupport.controlCenter.teach.teachThis")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            {t("aiSupport.controlCenter.teach.suggestionsNone")}
          </div>
        )}
      </PanelSection>

      <PanelSection
        icon={TestTube2}
        title={t("aiSupport.controlCenter.teach.testTitle")}
        subtitle={t("aiSupport.controlCenter.teach.testSubtitle")}
      >
        <div className="grid gap-3">
          <TextInput
            value={testMessage}
            placeholder={t("aiSupport.controlCenter.teach.testPlaceholder")}
            onChange={(event) => setTestMessage(event.target.value)}
          />
          <ActionButton tone="ghost" icon={TestTube2} loading={testing} onClick={runTest}>
            {t("aiSupport.controlCenter.teach.testRun")}
          </ActionButton>
          {testResult ? (
            testResult.matched ? (
              <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3">
                <div className="text-[11px] font-black text-emerald-100">
                  {t("aiSupport.controlCenter.teach.testMatched", {
                    title: testResult.matched.title || "",
                    trigger: testResult.matched.trigger || "",
                  })}
                </div>
                <div dir="auto" className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white">
                  {testResult.matched.answer}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold leading-5 text-slate-400">
                {t("aiSupport.controlCenter.teach.testNoMatch", { count: testResult.knowledge_lines || 0 })}
              </div>
            )
          ) : null}
        </div>
      </PanelSection>

      <p className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
        <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("aiSupport.controlCenter.teach.note")}
      </p>
    </div>
  );
}
