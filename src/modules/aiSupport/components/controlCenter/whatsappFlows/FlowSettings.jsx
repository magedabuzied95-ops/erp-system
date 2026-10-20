// Flow-level settings shown in the builder's side panel when no node is selected:
// trigger, which numbers run it, a test send, and the recent sessions.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Send } from "lucide-react";

import { api } from "../../../../../shared/api/api";
import { formatDateTime } from "../../integrations/integrationsUi.jsx";
import { Field, SelectInput, TextInput } from "../controlCenterUi.jsx";
import { apiErrorText, errorText, sessionStatusLabel } from "./flowLabels.js";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 422, 500, 502] };

export default function FlowSettings({ flowId, trigger, numbers, phoneNumberIds, onTrigger, onNumbers, headers, dirty, locked = false }) {
  const { t } = useTranslation();
  const [keywordsText, setKeywordsText] = useState((trigger.keywords || []).join(", "));
  const [testPhone, setTestPhone] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => { setKeywordsText((trigger.keywords || []).join(", ")); }, [flowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSessions = useCallback(async () => {
    if (!flowId) return;
    setLoadingSessions(true);
    try {
      const payload = await api.get(`/whatsapp-official/flows/${flowId}/sessions?limit=30`, { headers, ...SUPPRESSED });
      setSessions(Array.isArray(payload?.sessions) ? payload.sessions : []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [flowId, headers]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const commitKeywords = (value) => {
    setKeywordsText(value);
    onTrigger({ ...trigger, keywords: value.split(/[,،\n]/).map((item) => item.trim()).filter(Boolean) });
  };

  const toggleNumber = (id) => {
    const set = new Set(phoneNumberIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    onNumbers([...set]);
  };

  const runTest = async () => {
    setTesting(true);
    setTestNotice(null);
    try {
      await api.post(`/whatsapp-official/flows/${flowId}/test`, { to: testPhone, phone_number_id: testNumber || undefined }, { headers, ...SUPPRESSED });
      setTestNotice({ ok: true, text: t("waOfficialFlows.test.sent") });
      void loadSessions();
    } catch (error) {
      const body = error?.responseBody || {};
      const firstError = Array.isArray(body.errors) && body.errors.length ? errorText(t, body.errors[0]) : "";
      setTestNotice({ ok: false, text: firstError || apiErrorText(t, body.code, error?.message) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 p-3">
      <section className="space-y-3">
        <h3 className="text-sm font-black text-white">{t("waOfficialFlows.settings.triggerTitle")}</h3>
        <fieldset disabled={locked} className="space-y-3">
          <Field label={t("waOfficialFlows.settings.trigger")}>
            <SelectInput value={trigger.type || "any_message"} onChange={(event) => onTrigger({ ...trigger, type: event.target.value })}>
              <option value="any_message">{t("waOfficialFlows.settings.triggerAny")}</option>
              <option value="first_message">{t("waOfficialFlows.settings.triggerFirst")}</option>
              <option value="keywords">{t("waOfficialFlows.settings.triggerKeywords")}</option>
            </SelectInput>
          </Field>
          {trigger.type === "keywords" ? (
            <Field label={t("waOfficialFlows.settings.keywords")} hint={t("waOfficialFlows.settings.keywordsHint")}>
              <TextInput dir="auto" value={keywordsText} onChange={(event) => commitKeywords(event.target.value)} />
            </Field>
          ) : null}
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("waOfficialFlows.settings.numbers")}</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("waOfficialFlows.settings.numbersHint")}</p>
            <div className="mt-2 space-y-1.5">
              {numbers.length ? numbers.map((number) => (
                <label key={number.phone_number_id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-slate-950/50 px-2.5 py-2 text-xs font-bold text-slate-200">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={phoneNumberIds.includes(number.phone_number_id)} onChange={() => toggleNumber(number.phone_number_id)} />
                  <span dir="auto" className="min-w-0 truncate">{number.label}</span>
                </label>
              )) : <p className="text-[11px] text-slate-500">{t("waOfficialFlows.settings.noNumbers")}</p>}
            </div>
          </div>
          <p className="rounded-lg border border-cyan-300/15 bg-cyan-400/[0.06] p-2 text-[11px] leading-5 text-cyan-100/80">{t("waOfficialFlows.settings.accountHint")}</p>
        </fieldset>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-4">
        <h3 className="text-sm font-black text-white">{t("waOfficialFlows.test.title")}</h3>
        <p className="text-[11px] leading-5 text-slate-500">{t("waOfficialFlows.test.hint")}</p>
        <TextInput dir="ltr" inputMode="tel" value={testPhone} placeholder="2010xxxxxxxx" onChange={(event) => setTestPhone(event.target.value)} />
        {numbers.length > 1 ? (
          <SelectInput value={testNumber} onChange={(event) => setTestNumber(event.target.value)}>
            <option value="">{t("waOfficialFlows.test.defaultNumber")}</option>
            {numbers.map((number) => <option key={number.phone_number_id} value={number.phone_number_id}>{number.label}</option>)}
          </SelectInput>
        ) : null}
        {dirty ? <p className="text-[11px] font-bold text-amber-200">{t("waOfficialFlows.test.saveFirst")}</p> : null}
        <button
          type="button"
          onClick={runTest}
          disabled={testing || dirty || testPhone.replace(/\D/g, "").length < 8}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 text-xs font-black text-white transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("waOfficialFlows.test.send")}
        </button>
        {testNotice ? (
          <p className={`rounded-lg border p-2 text-[11px] font-bold ${testNotice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>{testNotice.text}</p>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-white/10 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-white">{t("waOfficialFlows.sessions.title")}</h3>
          <button type="button" onClick={loadSessions} aria-label={t("waOfficialFlows.sessions.refresh")} className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/10">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingSessions ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
        {sessions.length ? (
          <ul className="space-y-1.5">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-lg border border-white/10 bg-slate-950/50 px-2.5 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span dir="auto" className="min-w-0 truncate font-black text-slate-100">{session.customer_name || <span dir="ltr">{session.customer_phone}</span>}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${session.status === "active" ? "bg-emerald-400/15 text-emerald-200" : "bg-white/[0.06] text-slate-400"}`}>
                    {sessionStatusLabel(t, session.status)}{session.is_test ? ` · ${t("waOfficialFlows.sessions.test")}` : ""}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-500">{formatDateTime(session.last_at)} · {t("waOfficialFlows.sessions.steps", { count: Number(session.run_count) || 0 })}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-[11px] text-slate-500">{loadingSessions ? "…" : t("waOfficialFlows.sessions.empty")}</p>}
      </section>
    </div>
  );
}
