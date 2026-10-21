import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Search, Send, X } from "lucide-react";
import { api } from "../../../shared/api/api";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";

/*
 * Send Template (Genie's conversation menu): an approved WhatsApp template to
 * this customer through the official number — the way back into a chat after
 * WhatsApp's 24-hour window. Pick a template, fill its {{n}} values (the first
 * starts as the customer's name), send. The server writes it into the thread.
 */

const clean = (value) => String(value ?? "").trim();
const placeholdersOf = (body = "") => [...new Set([...String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const fill = (body = "", values = []) => String(body).replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index) => clean(values[Number(index) - 1]) || whole);

export default function TemplateSendModal({ open = false, conversation = null, customerName = "", headers, onClose, onSent }) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [values, setValues] = useState([]);
  const [sending, setSending] = useState(false);
  const sessionId = clean(conversation?.session_id || conversation?.conversation_id);

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let alive = true;
    setTemplates(null);
    setError("");
    setPicked(null);
    setQuery("");
    api.get(aiInboxConversationEndpoint(sessionId, "/templates"), { headers, suppressErrorStatuses: [400, 404, 409, 500, 502, 503] })
      .then((payload) => { if (alive) setTemplates(Array.isArray(payload?.templates) ? payload.templates : []); })
      .catch((err) => { if (alive) { setTemplates([]); setError(err?.message || t("aiSupport.inbox.templateSend.loadFailed")); } });
    return () => { alive = false; };
  }, [headers, open, sessionId, t]);

  const placeholders = useMemo(() => placeholdersOf(picked?.body), [picked]);
  useEffect(() => {
    if (!picked) return;
    const next = placeholders.map((index) => (index === 1 ? clean(customerName) : ""));
    setValues(next);
  }, [customerName, picked, placeholders]);

  if (!open) return null;

  const visible = (templates || []).filter((template) => !query || `${template.name} ${template.body}`.toLowerCase().includes(query.toLowerCase()));
  const send = async () => {
    if (!picked || sending) return;
    setSending(true);
    setError("");
    try {
      const positional = [];
      placeholders.forEach((index, position) => { positional[index - 1] = clean(values[position]); });
      await api.post(aiInboxConversationEndpoint(sessionId, "/send-template"), {
        template_id: picked.id,
        language: picked.language,
        variables: Array.from(positional, (value) => value ?? ""),
      }, { headers, timeoutMs: 20000 });
      onSent?.(picked);
      onClose?.();
    } catch (err) {
      setError(err?.message || t("aiSupport.inbox.templateSend.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2147482500] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose?.(); }}
    >
      <div role="dialog" aria-label={t("aiSupport.inbox.templateSend.title")} className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 font-bold">
            <FileText className="h-5 w-5 text-emerald-600" />
            {t("aiSupport.inbox.templateSend.title")}
          </div>
          <button type="button" onClick={() => !sending && onClose?.()} aria-label={t("aiSupport.inbox.templateSend.close")} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        {!picked ? (
          <>
            <div className="p-3">
              <label className="relative flex h-9 items-center rounded-lg border border-border bg-surface-soft">
                <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("aiSupport.inbox.templateSend.search")} className="h-9 w-full bg-transparent ps-8 pe-2 text-sm outline-none" />
              </label>
            </div>
            <div className="min-h-[200px] flex-1 overflow-y-auto px-2 pb-2">
              {templates === null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("aiSupport.inbox.templateSend.loading")}</div>
              ) : visible.length ? (
                visible.map((template) => (
                  <button key={`${template.id}:${template.language}`} type="button" onClick={() => setPicked(template)} className="mb-1 block w-full rounded-xl px-3 py-2.5 text-start hover:bg-surface-hover">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold">{template.name}</span>
                      <span className="shrink-0 rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">{template.language} · {template.category}</span>
                    </div>
                    <p dir="auto" className="mt-1 line-clamp-2 text-xs text-text-muted">{template.body}</p>
                  </button>
                ))
              ) : (
                <p className="px-4 py-10 text-center text-sm text-text-muted">{error || t("aiSupport.inbox.templateSend.empty")}</p>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <button type="button" onClick={() => setPicked(null)} className="mb-3 text-xs font-bold text-primary hover:underline">{t("aiSupport.inbox.templateSend.back")}</button>
            <div className="mb-3 text-sm font-bold">{picked.name}</div>
            <div dir="auto" className="mb-4 whitespace-pre-wrap rounded-xl bg-emerald-500/10 p-3 text-sm leading-6">{fill(picked.body, (() => { const out = []; placeholders.forEach((index, position) => { out[index - 1] = values[position]; }); return out; })())}</div>
            {placeholders.length ? (
              <div className="space-y-2">
                {placeholders.map((index, position) => (
                  <label key={index} className="block">
                    <span className="mb-1 block text-xs font-semibold text-text-muted">{`{{${index}}}`}</span>
                    <input
                      dir="auto"
                      value={values[position] ?? ""}
                      onChange={(event) => setValues((current) => { const next = [...current]; next[position] = event.target.value; return next; })}
                      className="h-9 w-full rounded-lg border border-border bg-surface-soft px-3 text-sm outline-none focus:border-primary"
                    />
                  </label>
                ))}
              </div>
            ) : null}
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          </div>
        )}
        {picked ? (
          <div className="flex justify-end border-t border-border p-3">
            <button
              type="button"
              onClick={send}
              disabled={sending || placeholders.some((_, position) => !clean(values[position]))}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("aiSupport.inbox.templateSend.send")}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.fullscreenElement || document.body
  );
}
