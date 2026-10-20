// WhatsApp message templates — inbox top bar → WhatsApp → Templates.
//
// A list of every template the official number has (local drafts plus what Meta already holds,
// pulled in by "Sync from Meta"), and an editor beside a live WhatsApp-style preview. A draft is
// saved here first and only reaches Meta on Submit; Meta's verdict (pending / approved /
// rejected + reason) comes back on the next sync. Server: server/routes/whatsappTemplates.js.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Image as ImageIcon, Plus, RefreshCw, Save, Send, Trash2, Upload, Video } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton, TextInput, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 413, 500, 502] };

const EMPTY = Object.freeze({
  id: null,
  name: "",
  language: "ar",
  category: "MARKETING",
  header_format: "NONE",
  header_text: "",
  header_example: "",
  header_media_url: "",
  header_handle: "",
  body_text: "",
  body_examples: [],
  footer_text: "",
  buttons: [],
  status: "DRAFT",
  rejection_reason: "",
  meta_template_id: "",
  quality_score: "",
  last_synced_at: null,
  editable: true,
});

const LANGUAGES = ["ar", "en", "en_US", "en_GB", "fr", "de", "es", "tr"];
const STATUS_TONE = {
  DRAFT: "border-white/10 bg-white/[0.06] text-slate-200",
  PENDING: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  APPROVED: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  REJECTED: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  PAUSED: "border-orange-300/25 bg-orange-400/10 text-orange-100",
  DISABLED: "border-rose-300/25 bg-rose-400/10 text-rose-200",
};

const variableCount = (value = "") => new Set([...String(value).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => match[1])).size;
const fillVariables = (value = "", examples = []) =>
  String(value).replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index) => clean(examples[Number(index) - 1]) || whole);

// Literal keys so a missing translation stays greppable.
const statusLabel = (t, status) => {
  if (status === "PENDING") return t("aiSupport.waTemplates.status.pending");
  if (status === "APPROVED") return t("aiSupport.waTemplates.status.approved");
  if (status === "REJECTED") return t("aiSupport.waTemplates.status.rejected");
  if (status === "PAUSED") return t("aiSupport.waTemplates.status.paused");
  if (status === "DISABLED") return t("aiSupport.waTemplates.status.disabled");
  return t("aiSupport.waTemplates.status.draft");
};
const categoryLabel = (t, category) => {
  if (category === "UTILITY") return t("aiSupport.waTemplates.category.utility");
  if (category === "AUTHENTICATION") return t("aiSupport.waTemplates.category.authentication");
  return t("aiSupport.waTemplates.category.marketing");
};
const headerLabel = (t, format) => {
  if (format === "TEXT") return t("aiSupport.waTemplates.header.text");
  if (format === "IMAGE") return t("aiSupport.waTemplates.header.image");
  if (format === "VIDEO") return t("aiSupport.waTemplates.header.video");
  if (format === "DOCUMENT") return t("aiSupport.waTemplates.header.document");
  return t("aiSupport.waTemplates.header.none");
};
const buttonTypeLabel = (t, type) => {
  if (type === "URL") return t("aiSupport.waTemplates.buttons.url");
  if (type === "PHONE_NUMBER") return t("aiSupport.waTemplates.buttons.phone");
  if (type === "COPY_CODE") return t("aiSupport.waTemplates.buttons.copyCode");
  return t("aiSupport.waTemplates.buttons.quickReply");
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${STATUS_TONE[status] || STATUS_TONE.DRAFT}`}>
      {statusLabel(t, status)}
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

const textareaClass =
  "w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/40 disabled:opacity-60";
const selectTrigger = "h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white";

// The phone on the right: what the customer will see, with examples filled in.
function TemplatePreview({ draft }) {
  const { t } = useTranslation();
  const body = fillVariables(draft.body_text, draft.body_examples);
  const header = draft.header_format === "TEXT" ? fillVariables(draft.header_text, [draft.header_example]) : "";
  const MediaIcon = draft.header_format === "VIDEO" ? Video : draft.header_format === "DOCUMENT" ? FileText : ImageIcon;
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[34px] border-[6px] border-slate-800 bg-slate-900 p-1 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
      <div className="overflow-hidden rounded-[26px] bg-[#efe7dd]">
        <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-black">M1</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold">{t("aiSupport.waTemplates.preview.business")}</div>
            <div className="text-[10px] opacity-75">{t("aiSupport.waTemplates.preview.online")}</div>
          </div>
        </div>
        <div className="min-h-[360px] space-y-2 p-3">
          <div className="mx-auto w-fit rounded-md bg-[#fdf4c5] px-2 py-1 text-center text-[10px] text-slate-600">{t("aiSupport.waTemplates.preview.encrypted")}</div>
          <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white text-slate-900 shadow-sm">
            {["IMAGE", "VIDEO", "DOCUMENT"].includes(draft.header_format) ? (
              draft.header_media_url && draft.header_format === "IMAGE" ? (
                <img src={draft.header_media_url} alt="" className="h-36 w-full object-cover" />
              ) : (
                <div className="grid h-28 place-items-center bg-slate-200 text-slate-500"><MediaIcon className="h-8 w-8" aria-hidden="true" /></div>
              )
            ) : null}
            <div className="px-2.5 pb-1.5 pt-2">
              {header ? <div dir="auto" className="mb-1 text-[13px] font-black">{header}</div> : null}
              <div dir="auto" className="whitespace-pre-wrap text-[13px] leading-5">{body || <span className="text-slate-400">{t("aiSupport.waTemplates.preview.bodyPlaceholder")}</span>}</div>
              {draft.footer_text ? <div dir="auto" className="mt-1 text-[11px] text-slate-500">{draft.footer_text}</div> : null}
              <div className="mt-0.5 text-end text-[10px] text-slate-400">12:00</div>
            </div>
            {draft.buttons.length ? (
              <div className="border-t border-slate-200">
                {draft.buttons.map((button, index) => (
                  <div key={index} dir="auto" className="border-b border-slate-100 py-2 text-center text-[13px] font-bold text-[#00a5f4] last:border-b-0">
                    {button.type === "COPY_CODE" ? t("aiSupport.waTemplates.buttons.copyCodeLabel") : button.text || buttonTypeLabel(t, button.type)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppTemplatesPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);
  const fileRef = useRef(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/whatsapp/templates", { headers, ...SUPPRESSED });
      if (mountedRef.current) setTemplates(Array.isArray(payload?.templates) ? payload.templates : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waTemplates.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (key, task, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await task();
      if (mountedRef.current && okText) setNotice({ ok: true, text: okText(result) });
      return result;
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waTemplates.actionFailed") });
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [t]);

  const sync = () => run("sync", async () => {
    const payload = await api.post("/whatsapp/templates/sync", {}, { headers, ...SUPPRESSED });
    setTemplates(Array.isArray(payload?.templates) ? payload.templates : []);
    return payload?.summary || {};
  }, (summary) => t("aiSupport.waTemplates.synced", { remote: summary.remote || 0, imported: summary.imported || 0 }));

  const save = async () => {
    const body = { ...draft };
    const saved = await run("save", async () => {
      const payload = draft.id
        ? await api.patch(`/whatsapp/templates/${draft.id}`, body, { headers, ...SUPPRESSED })
        : await api.post("/whatsapp/templates", body, { headers, ...SUPPRESSED });
      return payload?.template;
    }, () => t("aiSupport.waTemplates.saved"));
    if (saved) {
      setDraft(saved);
      await load();
    }
    return saved;
  };

  const submit = async () => {
    const saved = await save();
    if (!saved?.id) return;
    const submitted = await run("submit", async () => {
      const payload = await api.post(`/whatsapp/templates/${saved.id}/submit`, {}, { headers, ...SUPPRESSED });
      return payload?.template;
    }, () => t("aiSupport.waTemplates.submitted"));
    if (submitted) {
      setDraft(submitted);
      await load();
    }
  };

  const remove = async () => {
    if (!draft?.id) { setDraft(null); return; }
    const message = draft.meta_template_id ? t("aiSupport.waTemplates.confirmDeleteMeta") : t("aiSupport.waTemplates.confirmDelete");
    if (!window.confirm(message)) return;
    const done = await run("delete", () => api.delete(`/whatsapp/templates/${draft.id}`, { headers, ...SUPPRESSED }), () => t("aiSupport.waTemplates.deleted"));
    if (done) {
      setDraft(null);
      await load();
    }
  };

  const uploadSample = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const localUrl = URL.createObjectURL(file);
    const result = await run("upload", () => api.post("/whatsapp/templates/header-sample", form, { headers, ...SUPPRESSED }), () => t("aiSupport.waTemplates.sampleUploaded"));
    if (result?.handle) setDraft((current) => ({ ...current, header_handle: result.handle, header_media_url: localUrl }));
  };

  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const bodyVars = variableCount(draft?.body_text);
  const headerVars = draft?.header_format === "TEXT" ? variableCount(draft?.header_text) : 0;
  const locked = draft ? !draft.editable && Boolean(draft.id) : false;
  const nameLocked = Boolean(draft?.meta_template_id);

  const visible = useMemo(() => {
    const needle = clean(query).toLowerCase();
    return templates.filter((item) => (filter === "ALL" || item.status === filter) && (!needle || clean(item.name).toLowerCase().includes(needle) || clean(item.body_text).toLowerCase().includes(needle)));
  }, [filter, query, templates]);

  const counts = useMemo(() => templates.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}), [templates]);

  if (loading) return <PanelSkeleton rows={3} />;

  if (!draft) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-black text-white">{t("aiSupport.waTemplates.title")}</h2>
            <p className="text-xs text-slate-400">{t("aiSupport.waTemplates.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <ActionButton icon={RefreshCw} loading={busy === "sync"} onClick={sync}>{t("aiSupport.waTemplates.sync")}</ActionButton>
            <ActionButton tone="primary" icon={Plus} onClick={() => { setNotice(null); setDraft({ ...EMPTY }); }}>{t("aiSupport.waTemplates.new")}</ActionButton>
          </div>
        </div>
        {notice ? <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p> : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {["ALL", "DRAFT", "PENDING", "APPROVED", "REJECTED"].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`h-8 rounded-full border px-3 text-[11px] font-black transition ${filter === key ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}
            >
              {key === "ALL" ? t("aiSupport.waTemplates.all") : statusLabel(t, key)} {key === "ALL" ? templates.length : counts[key] || 0}
            </button>
          ))}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("aiSupport.waTemplates.search")}
            className="ms-auto h-8 w-56 rounded-full border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-start text-xs">
            <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("aiSupport.waTemplates.columns.name")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waTemplates.columns.language")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waTemplates.columns.category")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waTemplates.columns.status")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waTemplates.columns.metaId")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waTemplates.columns.synced")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} onClick={() => { setNotice(null); setDraft(item); }} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                  <td className="px-3 py-2.5 font-black" dir="ltr">{item.name}</td>
                  <td className="px-3 py-2.5" dir="ltr">{item.language}</td>
                  <td className="px-3 py-2.5">{categoryLabel(t, item.category)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={item.status} /></td>
                  <td className="px-3 py-2.5 text-slate-500" dir="ltr">{item.meta_template_id || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-500">{formatDateTime(item.last_synced_at)}</td>
                </tr>
              ))}
              {!visible.length ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.waTemplates.empty")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDraft(null)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.waTemplates.backToList")}</button>
          <span className="text-slate-600">/</span>
          <span className="text-sm font-black text-white" dir="ltr">{draft.name || t("aiSupport.waTemplates.new")}</span>
          <StatusBadge status={draft.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton tone="rose" icon={Trash2} loading={busy === "delete"} onClick={remove}>{t("aiSupport.waTemplates.delete")}</ActionButton>
          <ActionButton icon={Save} loading={busy === "save"} disabled={locked} onClick={save}>{t("aiSupport.waTemplates.saveDraft")}</ActionButton>
          <ActionButton tone="emerald" icon={Send} loading={busy === "submit"} disabled={locked} onClick={submit}>{t("aiSupport.waTemplates.submit")}</ActionButton>
        </div>
      </div>

      {/* Draft → Pending → Approved / Rejected, the way Meta moves it. */}
      <div className="flex overflow-hidden rounded-xl border border-white/10 text-[11px] font-black">
        {["DRAFT", "PENDING", "APPROVED", "REJECTED"].map((step) => (
          <span key={step} className={`flex-1 px-3 py-2 text-center ${draft.status === step ? "bg-cyan-400/15 text-cyan-100" : "text-slate-500"}`}>{statusLabel(t, step)}</span>
        ))}
      </div>

      {notice ? <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p> : null}
      {draft.status === "REJECTED" && draft.rejection_reason ? (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{t("aiSupport.waTemplates.rejectionReason")}: {draft.rejection_reason}</p>
      ) : null}
      {locked ? <p className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-xs font-bold text-amber-100">{t("aiSupport.waTemplates.lockedPending")}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
          <TextInput
            label={t("aiSupport.waTemplates.fields.name")}
            hint={t("aiSupport.waTemplates.fields.nameHint")}
            dir="ltr"
            maxLength={512}
            disabled={nameLocked}
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") })}
          />
          <Field label={t("aiSupport.waTemplates.fields.language")}>
            <ThemedSelect
              value={draft.language}
              disabled={nameLocked}
              onChange={(value) => patch({ language: value })}
              options={LANGUAGES.map((code) => ({ value: code, label: code }))}
              triggerClassName={selectTrigger}
            />
          </Field>
          <Field label={t("aiSupport.waTemplates.fields.category")} hint={t("aiSupport.waTemplates.fields.categoryHint")}>
            <ThemedSelect
              value={draft.category}
              onChange={(value) => patch({ category: value })}
              options={["MARKETING", "UTILITY", "AUTHENTICATION"].map((value) => ({ value, label: categoryLabel(t, value) }))}
              triggerClassName={selectTrigger}
            />
          </Field>
          <Field label={t("aiSupport.waTemplates.fields.headerFormat")}>
            <ThemedSelect
              value={draft.header_format}
              onChange={(value) => patch({ header_format: value, header_handle: "", header_media_url: "" })}
              options={["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"].map((value) => ({ value, label: headerLabel(t, value) }))}
              triggerClassName={selectTrigger}
            />
          </Field>

          {draft.header_format === "TEXT" ? (
            <>
              <TextInput label={t("aiSupport.waTemplates.fields.headerText")} hint={t("aiSupport.waTemplates.fields.headerTextHint")} dir="auto" maxLength={60} value={draft.header_text} onChange={(event) => patch({ header_text: event.target.value })} />
              {headerVars ? <TextInput label={t("aiSupport.waTemplates.fields.headerExample")} dir="auto" value={draft.header_example} onChange={(event) => patch({ header_example: event.target.value })} /> : <span />}
            </>
          ) : null}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(draft.header_format) ? (
            <div className="md:col-span-2">
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waTemplates.fields.headerSample")}</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={draft.header_format === "IMAGE" ? "image/jpeg,image/png" : draft.header_format === "VIDEO" ? "video/mp4" : "application/pdf"}
                  onChange={(event) => { void uploadSample(event.target.files?.[0]); event.target.value = ""; }}
                />
                <ActionButton icon={Upload} loading={busy === "upload"} onClick={() => fileRef.current?.click()}>{t("aiSupport.waTemplates.fields.uploadSample")}</ActionButton>
                <span className={`text-[11px] font-bold ${draft.header_handle ? "text-emerald-200" : "text-slate-500"}`}>
                  {draft.header_handle ? t("aiSupport.waTemplates.fields.sampleReady") : t("aiSupport.waTemplates.fields.sampleMissing")}
                </span>
              </div>
            </div>
          ) : null}

          <div className="md:col-span-2">
            <Field label={`${t("aiSupport.waTemplates.fields.body")} (${draft.body_text.length}/1024)`} hint={t("aiSupport.waTemplates.fields.bodyHint")}>
              <textarea rows={6} dir="auto" maxLength={1024} value={draft.body_text} onChange={(event) => patch({ body_text: event.target.value })} className={textareaClass} />
            </Field>
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => patch({ body_text: `${draft.body_text}{{${bodyVars + 1}}}` })} className="h-7 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-black text-cyan-100 hover:bg-white/10">
                + {t("aiSupport.waTemplates.fields.addVariable")}
              </button>
            </div>
          </div>
          {bodyVars ? (
            <div className="grid gap-2 md:col-span-2 md:grid-cols-3">
              {Array.from({ length: bodyVars }, (_, index) => (
                <TextInput
                  key={index}
                  label={`${t("aiSupport.waTemplates.fields.example")} {{${index + 1}}}`}
                  dir="auto"
                  value={draft.body_examples[index] || ""}
                  onChange={(event) => {
                    const next = [...draft.body_examples];
                    next[index] = event.target.value;
                    patch({ body_examples: next });
                  }}
                />
              ))}
            </div>
          ) : null}
          <TextInput className="md:col-span-2" label={t("aiSupport.waTemplates.fields.footer")} dir="auto" maxLength={60} value={draft.footer_text} onChange={(event) => patch({ footer_text: event.target.value })} />

          <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-white">{t("aiSupport.waTemplates.buttons.title")} ({draft.buttons.length}/10)</span>
              <ActionButton icon={Plus} disabled={draft.buttons.length >= 10} onClick={() => patch({ buttons: [...draft.buttons, { type: "QUICK_REPLY", text: "", url: "", phone_number: "", example: "" }] })}>
                {t("aiSupport.waTemplates.buttons.add")}
              </ActionButton>
            </div>
            <div className="mt-2 space-y-2">
              {draft.buttons.map((button, index) => {
                const update = (changes) => patch({ buttons: draft.buttons.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
                return (
                  <div key={index} className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-2 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <ThemedSelect
                      value={button.type}
                      onChange={(value) => update({ type: value })}
                      options={["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE"].map((value) => ({ value, label: buttonTypeLabel(t, value) }))}
                      triggerClassName={selectTrigger}
                    />
                    {button.type === "COPY_CODE" ? (
                      <TextInput placeholder={t("aiSupport.waTemplates.buttons.codeExample")} dir="ltr" value={button.example} onChange={(event) => update({ example: event.target.value })} />
                    ) : (
                      <TextInput placeholder={t("aiSupport.waTemplates.buttons.text")} dir="auto" maxLength={25} value={button.text} onChange={(event) => update({ text: event.target.value })} />
                    )}
                    {button.type === "URL" ? (
                      <TextInput placeholder="https://m1store-egy.com/track/{{1}}" dir="ltr" value={button.url} onChange={(event) => update({ url: event.target.value })} />
                    ) : button.type === "PHONE_NUMBER" ? (
                      <TextInput placeholder="+201000000000" dir="ltr" value={button.phone_number} onChange={(event) => update({ phone_number: event.target.value })} />
                    ) : <span />}
                    <button type="button" onClick={() => patch({ buttons: draft.buttons.filter((_, i) => i !== index) })} className="grid h-10 w-10 place-items-center rounded-xl text-rose-200 hover:bg-rose-400/10" aria-label={t("aiSupport.waTemplates.delete")}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {button.type === "URL" && /\{\{\s*1\s*\}\}/.test(button.url) ? (
                      <TextInput className="md:col-span-4" placeholder={t("aiSupport.waTemplates.buttons.urlExample")} dir="ltr" value={button.example} onChange={(event) => update({ example: event.target.value })} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {draft.id ? (
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400 md:col-span-2 md:grid-cols-3">
              <div>{t("aiSupport.waTemplates.columns.metaId")}: <span dir="ltr" className="font-black text-slate-200">{draft.meta_template_id || "—"}</span></div>
              <div>{t("aiSupport.waTemplates.columns.synced")}: <span className="font-black text-slate-200">{formatDateTime(draft.last_synced_at)}</span></div>
              <div>{t("aiSupport.waTemplates.quality")}: <span className="font-black text-slate-200">{draft.quality_score || "—"}</span></div>
            </div>
          ) : null}
        </fieldset>
        <TemplatePreview draft={draft} />
      </div>
    </div>
  );
}
