// WhatsApp developer access - inbox top bar → WhatsApp → API Keys / API Webhooks.
//
// mode="keys": API keys an external system uses to send WhatsApp messages through the official
// number (POST /api/public/whatsapp/messages). The plaintext key is shown once, at creation.
// mode="webhooks": URLs that receive our WhatsApp events, signed with HMAC-SHA256. The signing
// secret is shown once, at creation. Server: server/routes/whatsappApiAccess.js.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, KeyRound, Plus, Power, Send, Trash2, Webhook, X } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, CopyRow, PanelSkeleton, StatusPill, TextInput, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 401, 403, 404, 409, 500, 502] };
const EVENTS = ["message.received", "message.status", "message.sent"];
const selectTrigger = "h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white";

// Literal keys so a missing translation stays greppable.
const eventLabel = (t, event) => {
  if (event === "message.received") return t("aiSupport.waDeveloper.events.received");
  if (event === "message.status") return t("aiSupport.waDeveloper.events.status");
  return t("aiSupport.waDeveloper.events.sent");
};

const accountLabel = (t, accounts, phoneNumberId) => {
  if (!phoneNumberId) return t("aiSupport.waDeveloper.defaultAccount");
  const match = accounts.find((item) => item.phone_number_id === phoneNumberId);
  return match ? clean(match.display_phone_number) || clean(match.verified_name) || match.phone_number_id : phoneNumberId;
};

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>
      {notice.text}
    </p>
  );
}

function Code({ children }) {
  return (
    <pre dir="ltr" className="overflow-x-auto whitespace-pre rounded-xl border border-white/10 bg-slate-950/70 p-3 text-start text-[11px] leading-5 text-slate-200">
      {children}
    </pre>
  );
}

// Shown once after creation: the only time the plaintext ever reaches the browser.
function RevealBox({ title, label, value, extra, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
          <div>
            <div className="text-sm font-black text-white">{title}</div>
            <p className="mt-1 text-xs leading-5 text-amber-100">{t("aiSupport.waDeveloper.showOnceWarning")}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-white/10" aria-label={t("aiSupport.waDeveloper.done")}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <CopyRow label={label} value={value} copyLabel={t("aiSupport.waDeveloper.copy")} />
      {extra}
      <ActionButton tone="primary" onClick={onClose}>{t("aiSupport.waDeveloper.savedIt")}</ActionButton>
    </div>
  );
}

const Th = ({ children }) => <th className="px-3 py-2 text-start">{children}</th>;

function ActiveBadge({ active }) {
  const { t } = useTranslation();
  return <StatusPill state={active ? "connected" : "off"}>{active ? t("aiSupport.waDeveloper.active") : t("aiSupport.waDeveloper.inactive")}</StatusPill>;
}

export default function WhatsAppDeveloperPanel({ headers, mode = "keys" }) {
  const { t } = useTranslation();
  const isKeys = mode !== "webhooks";
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null);
  const [revealed, setRevealed] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const [list, accountPayload] = await Promise.all([
        api.get(isKeys ? "/whatsapp/developer/keys" : "/whatsapp/developer/webhooks", { headers, ...SUPPRESSED }),
        api.get("/whatsapp/developer/accounts", { headers, ...SUPPRESSED }).catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setRows(Array.isArray(isKeys ? list?.keys : list?.webhooks) ? (isKeys ? list.keys : list.webhooks) : []);
      setAccounts(Array.isArray(accountPayload?.accounts) ? accountPayload.accounts : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waDeveloper.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, isKeys, t]);

  useEffect(() => {
    setLoading(true);
    setRows([]);
    setForm(null);
    setRevealed(null);
    setNotice(null);
    void load();
  }, [load]);

  const run = useCallback(async (key, task, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await task();
      if (mountedRef.current && okText) setNotice({ ok: true, text: okText });
      return result;
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waDeveloper.actionFailed") });
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [t]);

  const base = isKeys ? "/whatsapp/developer/keys" : "/whatsapp/developer/webhooks";
  const accountOptions = useMemo(() => [
    { value: "", label: t("aiSupport.waDeveloper.defaultAccount") },
    ...accounts.map((item) => ({ value: item.phone_number_id, label: accountLabel(t, accounts, item.phone_number_id) })),
  ], [accounts, t]);

  const create = async () => {
    const body = isKeys
      ? { name: clean(form?.name), phone_number_id: form?.phone_number_id || "" }
      : { callback_url: clean(form?.callback_url), events: form?.events || EVENTS, phone_number_id: form?.phone_number_id || "" };
    if (isKeys && !body.name) { setNotice({ ok: false, text: t("aiSupport.waDeveloper.nameRequired") }); return; }
    if (!isKeys && !body.callback_url) { setNotice({ ok: false, text: t("aiSupport.waDeveloper.urlRequired") }); return; }
    if (!isKeys && !body.events.length) { setNotice({ ok: false, text: t("aiSupport.waDeveloper.eventsRequired") }); return; }
    const payload = await run("create", () => api.post(base, body, { headers, ...SUPPRESSED }));
    if (!payload) return;
    setForm(null);
    setRevealed(isKeys ? { value: payload.plaintext } : { value: payload.secret });
    await load();
  };

  const toggle = async (row) => {
    const done = await run(`toggle-${row.id}`, () => api.patch(`${base}/${row.id}`, { is_active: !row.is_active }, { headers, ...SUPPRESSED }));
    if (done) await load();
  };

  const remove = async (row) => {
    if (!window.confirm(isKeys ? t("aiSupport.waDeveloper.confirmDeleteKey") : t("aiSupport.waDeveloper.confirmDeleteWebhook"))) return;
    const done = await run(`delete-${row.id}`, () => api.delete(`${base}/${row.id}`, { headers, ...SUPPRESSED }), t("aiSupport.waDeveloper.deleted"));
    if (done) await load();
  };

  const test = async (row) => {
    setBusy(`test-${row.id}`);
    setNotice(null);
    try {
      const result = await api.post(`${base}/${row.id}/test`, {}, { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      setNotice(result?.ok
        ? { ok: true, text: t("aiSupport.waDeveloper.testOk", { status: result.status }) }
        : { ok: false, text: t("aiSupport.waDeveloper.testFailed", { error: result?.error || "" }) });
      await load();
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waDeveloper.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading) return <PanelSkeleton rows={3} />;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const curl = `curl -X POST "${origin}/api/public/whatsapp/messages" \\
  -H "X-API-Key: m1wa_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"201000000000","text":"Hello from our system"}'`;
  const curlTemplate = `curl -X POST "${origin}/api/public/whatsapp/messages/template" \\
  -H "Authorization: Bearer m1wa_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"201000000000","template_name":"order_update","language":"ar","variables":["Ahmed","#1042"]}'`;
  const verifySnippet = `// Node.js - verify X-M1-Signature on the RAW request body
const crypto = require("crypto");
const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-m1-signature"] || ""));`;

  const columns = isKeys
    ? ["name", "key", "user", "account", "active", "lastUsed", "created"]
    : ["callbackUrl", "account", "events", "active", "failures", "lastSuccess", "lastError"];
  const columnLabel = (column) => {
    if (column === "name") return t("aiSupport.waDeveloper.columns.name");
    if (column === "key") return t("aiSupport.waDeveloper.columns.key");
    if (column === "user") return t("aiSupport.waDeveloper.columns.user");
    if (column === "account") return t("aiSupport.waDeveloper.columns.account");
    if (column === "active") return t("aiSupport.waDeveloper.columns.active");
    if (column === "lastUsed") return t("aiSupport.waDeveloper.columns.lastUsed");
    if (column === "created") return t("aiSupport.waDeveloper.columns.created");
    if (column === "callbackUrl") return t("aiSupport.waDeveloper.columns.callbackUrl");
    if (column === "events") return t("aiSupport.waDeveloper.columns.events");
    if (column === "failures") return t("aiSupport.waDeveloper.columns.failures");
    if (column === "lastSuccess") return t("aiSupport.waDeveloper.columns.lastSuccess");
    return t("aiSupport.waDeveloper.columns.lastError");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The page header already names the section; only the explainer here. */}
        <p className="text-xs text-slate-400">{isKeys ? t("aiSupport.waDeveloper.keysSubtitle") : t("aiSupport.waDeveloper.webhooksSubtitle")}</p>
        {!form ? (
          <ActionButton
            tone="primary"
            icon={Plus}
            onClick={() => { setNotice(null); setRevealed(null); setForm(isKeys ? { name: "", phone_number_id: "" } : { callback_url: "", events: [...EVENTS], phone_number_id: "" }); }}
          >
            {isKeys ? t("aiSupport.waDeveloper.newKey") : t("aiSupport.waDeveloper.newWebhook")}
          </ActionButton>
        ) : null}
      </div>

      <Notice notice={notice} />

      {revealed ? (
        <RevealBox
          title={isKeys ? t("aiSupport.waDeveloper.keyCreated") : t("aiSupport.waDeveloper.webhookCreated")}
          label={isKeys ? t("aiSupport.waDeveloper.yourKey") : t("aiSupport.waDeveloper.signingSecret")}
          value={revealed.value}
          extra={isKeys ? null : (
            <div className="space-y-1.5">
              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waDeveloper.verifyTitle")}</div>
              <Code>{verifySnippet}</Code>
            </div>
          )}
          onClose={() => setRevealed(null)}
        />
      ) : null}

      {form ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            {isKeys ? <KeyRound className="h-4 w-4" aria-hidden="true" /> : <Webhook className="h-4 w-4" aria-hidden="true" />}
            {isKeys ? t("aiSupport.waDeveloper.newKey") : t("aiSupport.waDeveloper.newWebhook")}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {isKeys ? (
              <TextInput
                label={t("aiSupport.waDeveloper.fields.name")}
                hint={t("aiSupport.waDeveloper.fields.nameHint")}
                dir="auto"
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            ) : (
              <TextInput
                label={t("aiSupport.waDeveloper.fields.callbackUrl")}
                hint={t("aiSupport.waDeveloper.fields.callbackUrlHint")}
                dir="ltr"
                type="url"
                placeholder="https://example.com/whatsapp/events"
                value={form.callback_url}
                onChange={(event) => setForm((current) => ({ ...current, callback_url: event.target.value }))}
              />
            )}
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waDeveloper.fields.account")}</span>
              <div className="mt-1">
                <ThemedSelect
                  value={form.phone_number_id}
                  onChange={(value) => setForm((current) => ({ ...current, phone_number_id: value }))}
                  options={accountOptions}
                  triggerClassName={selectTrigger}
                />
              </div>
            </label>
            {!isKeys ? (
              <div className="md:col-span-2">
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waDeveloper.fields.events")}</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {EVENTS.map((event) => {
                    const on = form.events.includes(event);
                    return (
                      <button
                        key={event}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setForm((current) => ({ ...current, events: on ? current.events.filter((item) => item !== event) : [...current.events, event] }))}
                        className={`h-8 rounded-full border px-3 text-[11px] font-black transition ${on ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}
                      >
                        {eventLabel(t, event)} <span dir="ltr" className="text-slate-500">{event}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton tone="primary" icon={Plus} loading={busy === "create"} onClick={create}>{t("aiSupport.waDeveloper.create")}</ActionButton>
            <ActionButton onClick={() => setForm(null)}>{t("aiSupport.waDeveloper.cancel")}</ActionButton>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              {columns.map((column) => <Th key={column}>{columnLabel(column)}</Th>)}
              <Th>{t("aiSupport.waDeveloper.columns.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                {isKeys ? (
                  <>
                    <td className="px-3 py-2.5 font-black" dir="auto">{row.name}</td>
                    <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.key_prefix}...</td>
                    <td className="px-3 py-2.5" dir="auto">{row.user_name || "-"}</td>
                    <td className="px-3 py-2.5" dir="auto">{accountLabel(t, accounts, row.phone_number_id)}</td>
                    <td className="px-3 py-2.5"><ActiveBadge active={row.is_active} /></td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(row.last_used_at, t("aiSupport.waDeveloper.never"))}</td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(row.created_at)}</td>
                  </>
                ) : (
                  <>
                    <td className="max-w-[260px] truncate px-3 py-2.5 font-black" dir="ltr" title={row.callback_url}>{row.callback_url}</td>
                    <td className="px-3 py-2.5" dir="auto">{accountLabel(t, accounts, row.phone_number_id)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(row.events || []).map((event) => (
                          <span key={event} className="inline-flex h-6 items-center rounded-full border border-white/10 bg-white/[0.06] px-2 text-[10.5px] font-black text-slate-200">{eventLabel(t, event)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><ActiveBadge active={row.is_active} /></td>
                    <td className={`px-3 py-2.5 font-black ${row.failure_count ? "text-rose-200" : "text-slate-400"}`}>{row.failure_count}</td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(row.last_success_at, t("aiSupport.waDeveloper.never"))}</td>
                    <td className="max-w-[220px] px-3 py-2.5 text-slate-500" title={row.last_error || ""}>
                      {row.last_error ? (
                        <>
                          <span className="block truncate text-rose-200" dir="auto">{row.last_error}</span>
                          <span className="block text-[10.5px]">{formatDateTime(row.last_error_at)}</span>
                        </>
                      ) : "-"}
                    </td>
                  </>
                )}
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {!isKeys ? (
                      <ActionButton icon={Send} loading={busy === `test-${row.id}`} onClick={() => test(row)}>{t("aiSupport.waDeveloper.test")}</ActionButton>
                    ) : null}
                    <ActionButton tone={row.is_active ? "amber" : "emerald"} icon={Power} loading={busy === `toggle-${row.id}`} onClick={() => toggle(row)}>
                      {row.is_active ? t("aiSupport.waDeveloper.disable") : t("aiSupport.waDeveloper.enable")}
                    </ActionButton>
                    <ActionButton tone="rose" icon={Trash2} loading={busy === `delete-${row.id}`} onClick={() => remove(row)} aria-label={t("aiSupport.waDeveloper.delete")} />
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr><td colSpan={columns.length + 1} className="px-3 py-10 text-center text-slate-500">{isKeys ? t("aiSupport.waDeveloper.emptyKeys") : t("aiSupport.waDeveloper.emptyWebhooks")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-xs font-black text-white">{isKeys ? t("aiSupport.waDeveloper.howToCall") : t("aiSupport.waDeveloper.howToReceive")}</div>
        {isKeys ? (
          <>
            <p className="text-[11px] leading-5 text-slate-400">{t("aiSupport.waDeveloper.howToCallHint")}</p>
            <Code>{curl}</Code>
            <p className="text-[11px] leading-5 text-slate-400">{t("aiSupport.waDeveloper.templateHint")}</p>
            <Code>{curlTemplate}</Code>
            <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waDeveloper.rateLimitHint")}</p>
          </>
        ) : (
          <>
            <p className="text-[11px] leading-5 text-slate-400">{t("aiSupport.waDeveloper.howToReceiveHint")}</p>
            <Code>{`POST <callback_url>
X-M1-Event: message.received
X-M1-Signature: sha256=<hmac>

{"event":"message.received","created_at":"...","data":{"from":"2010...","message_id":"wamid....","type":"text","text":"...","timestamp":"..."}}`}</Code>
            <Code>{verifySnippet}</Code>
            <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waDeveloper.autoDisableHint")}</p>
          </>
        )}
      </div>
    </div>
  );
}
