// Side panel that edits the selected node. Every change goes straight into the node's data;
// the builder's Save writes the whole graph.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, CircleStop, Flag, Loader2, Plus, Trash2, Upload, X } from "lucide-react";

import { api } from "../../../../../shared/api/api";
import { Field, SelectInput, TextArea, TextInput, Toggle } from "../controlCenterUi.jsx";
import { LIMITS, VARIABLES, templateVariableCount, uid } from "./flowModel.js";
import { kindTitle } from "./flowLabels.js";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 413, 422, 500, 502] };

function Counter({ value, max }) {
  const length = String(value || "").length;
  return <span className={`text-[10px] font-bold ${length > max ? "text-rose-300" : "text-slate-500"}`}>{length}/{max}</span>;
}

function LimitedInput({ label, value, max, onChange, placeholder = "", dir = "auto" }) {
  return (
    <Field label={<span className="flex items-center justify-between gap-2"><span>{label}</span><Counter value={value} max={max} /></span>}>
      <TextInput dir={dir} value={value || ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function VariableChips({ onInsert }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-bold text-slate-500">{t("waOfficialFlows.editor.insertVariable")}</span>
      {VARIABLES.map((variable) => (
        <button key={variable} type="button" dir="ltr" onClick={() => onInsert(variable)} className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black text-cyan-100 hover:bg-cyan-400/20">
          {variable}
        </button>
      ))}
    </div>
  );
}

function BodyField({ label, value, max, onChange, rows = 4 }) {
  return (
    <div className="space-y-1.5">
      <Field label={<span className="flex items-center justify-between gap-2"><span>{label}</span><Counter value={value} max={max} /></span>}>
        <TextArea dir="auto" rows={rows} value={value || ""} onChange={(event) => onChange(event.target.value)} className="min-h-24" />
      </Field>
      <VariableChips onInsert={(variable) => onChange(`${value || ""}${value && !/\s$/.test(value) ? " " : ""}${variable}`)} />
    </div>
  );
}

const ACCEPT = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/3gpp",
  audio: "audio/*,.ogg,.opus,.mp3,.m4a,.aac,.amr",
  document: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv",
};

function MediaField({ label, kind, value, onChange, onFileName, headers }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const payload = await api.post("/whatsapp-official/flows/upload", form, { headers, ...SUPPRESSED });
      if (payload?.media?.url) {
        onChange(payload.media.url);
        onFileName?.(payload.media.file_name || file.name);
      }
    } catch (uploadError) {
      setError(uploadError?.message || t("waOfficialFlows.editor.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Field label={label} hint={t("waOfficialFlows.editor.mediaHint")}>
      <div className="flex gap-2">
        <TextInput dir="ltr" value={value || ""} placeholder="https://" onChange={(event) => onChange(event.target.value)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title={t("waOfficialFlows.editor.upload")}
          aria-label={t("waOfficialFlows.editor.upload")}
          className="grid h-[var(--control-height-lg)] w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT[kind] || ""} className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
      </div>
      {error ? <span className="mt-1 block text-[11px] font-bold text-rose-300">{error}</span> : null}
    </Field>
  );
}

function RemoveButton({ onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-30">
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function AddButton({ onClick, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-2.5 text-[11px] font-black text-slate-300 hover:bg-white/[0.05] disabled:opacity-40">
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />{children}
    </button>
  );
}

function ButtonsEditor({ buttons = [], max, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("waOfficialFlows.editor.buttons", { count: buttons.length, max })}</div>
      {buttons.map((button, index) => (
        <div key={button.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <TextInput dir="auto" value={button.title || ""} placeholder={t("waOfficialFlows.editor.buttonPlaceholder", { index: index + 1 })} onChange={(event) => onChange(buttons.map((item) => (item.id === button.id ? { ...item, title: event.target.value } : item)))} />
          </div>
          <Counter value={button.title} max={LIMITS.buttonTitle} />
          <RemoveButton label={t("waOfficialFlows.editor.remove")} disabled={buttons.length <= 1} onClick={() => onChange(buttons.filter((item) => item.id !== button.id))} />
        </div>
      ))}
      <AddButton disabled={buttons.length >= max} onClick={() => onChange([...buttons, { id: uid("b"), title: "" }])}>{t("waOfficialFlows.editor.addButton")}</AddButton>
    </div>
  );
}

function HeaderFooter({ data, set }) {
  const { t } = useTranslation();
  return (
    <>
      <LimitedInput label={t("waOfficialFlows.fields.header")} value={data.header} max={LIMITS.header} onChange={(value) => set({ header: value })} />
      <BodyField label={t("waOfficialFlows.fields.body")} value={data.body} max={LIMITS.body} onChange={(value) => set({ body: value })} />
      <LimitedInput label={t("waOfficialFlows.fields.footer")} value={data.footer} max={LIMITS.footer} onChange={(value) => set({ footer: value })} />
    </>
  );
}

function ListEditor({ data, set }) {
  const { t } = useTranslation();
  const sections = data.sections || [];
  const totalRows = sections.reduce((sum, section) => sum + (section.rows || []).length, 0);
  const setSections = (next) => set({ sections: next });
  const patchSection = (id, patch) => setSections(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  return (
    <>
      <HeaderFooter data={data} set={set} />
      <LimitedInput label={t("waOfficialFlows.fields.listButton")} value={data.button_label} max={LIMITS.listButton} onChange={(value) => set({ button_label: value })} />
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("waOfficialFlows.editor.rows", { count: totalRows, max: LIMITS.listRows })}</div>
      {sections.map((section) => (
        <div key={section.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <LimitedInput label={t("waOfficialFlows.fields.sectionTitle")} value={section.title} max={LIMITS.sectionTitle} onChange={(value) => patchSection(section.id, { title: value })} />
            </div>
            <RemoveButton label={t("waOfficialFlows.editor.remove")} disabled={sections.length <= 1} onClick={() => setSections(sections.filter((item) => item.id !== section.id))} />
          </div>
          {(section.rows || []).map((row) => (
            <div key={row.id} className="space-y-1.5 rounded-lg bg-slate-950/40 p-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput dir="auto" value={row.title || ""} placeholder={t("waOfficialFlows.fields.rowTitle")} onChange={(event) => patchSection(section.id, { rows: section.rows.map((item) => (item.id === row.id ? { ...item, title: event.target.value } : item)) })} />
                </div>
                <Counter value={row.title} max={LIMITS.rowTitle} />
                <RemoveButton label={t("waOfficialFlows.editor.remove")} disabled={totalRows <= 1} onClick={() => patchSection(section.id, { rows: section.rows.filter((item) => item.id !== row.id) })} />
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput dir="auto" value={row.description || ""} placeholder={t("waOfficialFlows.fields.rowDescription")} onChange={(event) => patchSection(section.id, { rows: section.rows.map((item) => (item.id === row.id ? { ...item, description: event.target.value } : item)) })} />
                </div>
                <Counter value={row.description} max={LIMITS.rowDescription} />
              </div>
            </div>
          ))}
          <AddButton disabled={totalRows >= LIMITS.listRows} onClick={() => patchSection(section.id, { rows: [...(section.rows || []), { id: uid("r"), title: "", description: "" }] })}>
            {t("waOfficialFlows.editor.addRow")}
          </AddButton>
        </div>
      ))}
      <AddButton
        disabled={sections.length >= LIMITS.listSections || totalRows >= LIMITS.listRows}
        onClick={() => setSections([...sections, { id: uid("s"), title: "", rows: [{ id: uid("r"), title: "", description: "" }] }])}
      >
        {t("waOfficialFlows.editor.addSection")}
      </AddButton>
    </>
  );
}

function CarouselEditor({ data, set, headers }) {
  const { t } = useTranslation();
  const cards = data.cards || [];
  const patchCard = (id, patch) => set({ cards: cards.map((card) => (card.id === id ? { ...card, ...patch } : card)) });
  return (
    <>
      <BodyField label={t("waOfficialFlows.fields.body")} value={data.body} max={LIMITS.body} onChange={(value) => set({ body: value })} rows={3} />
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("waOfficialFlows.editor.cards", { count: cards.length, min: LIMITS.carouselMin, max: LIMITS.carouselMax })}</div>
      {cards.map((card, index) => (
        <div key={card.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black text-white">{t("waOfficialFlows.editor.card", { index: index + 1 })}</span>
            <RemoveButton label={t("waOfficialFlows.editor.remove")} disabled={cards.length <= LIMITS.carouselMin} onClick={() => set({ cards: cards.filter((item) => item.id !== card.id) })} />
          </div>
          <MediaField label={t("waOfficialFlows.fields.image")} kind="image" value={card.image_url} headers={headers} onChange={(value) => patchCard(card.id, { image_url: value })} />
          <LimitedInput label={t("waOfficialFlows.fields.cardBody")} value={card.body} max={LIMITS.cardBody} onChange={(value) => patchCard(card.id, { body: value })} />
          <ButtonsEditor buttons={card.buttons || []} max={LIMITS.cardButtons} onChange={(buttons) => patchCard(card.id, { buttons })} />
        </div>
      ))}
      <AddButton
        disabled={cards.length >= LIMITS.carouselMax}
        onClick={() => set({ cards: [...cards, { id: uid("c"), image_url: "", body: "", buttons: (cards[0]?.buttons || [{}]).map(() => ({ id: uid("b"), title: "" })) }] })}
      >
        {t("waOfficialFlows.editor.addCard")}
      </AddButton>
      <p className="text-[11px] leading-5 text-slate-500">{t("waOfficialFlows.editor.carouselHint")}</p>
    </>
  );
}

function TemplateEditor({ data, set, templates, headers }) {
  const { t } = useTranslation();
  const template = templates.find((item) => Number(item.id) === Number(data.template_id)) || null;
  const pick = (value) => {
    const chosen = templates.find((item) => String(item.id) === String(value));
    if (!chosen) {
      set({ template_id: null, template_name: "", buttons: [], variables: [], preview_body: "" });
      return;
    }
    const buttons = (Array.isArray(chosen.buttons) ? chosen.buttons : [])
      .map((button, index) => ({ button, index }))
      .filter(({ button }) => String(button?.type || "").toUpperCase() === "QUICK_REPLY")
      .map(({ button, index }) => ({ id: uid("b"), title: button.text || "", index }));
    set({
      template_id: Number(chosen.id),
      template_name: chosen.name,
      language: chosen.language,
      header_format: chosen.header_format || "NONE",
      preview_body: chosen.body_text || "",
      variables: Array.from({ length: templateVariableCount(chosen.body_text) }, (unused, index) => data.variables?.[index] || ""),
      header_variable: "",
      header_media_url: "",
      button_variables: {},
      buttons,
    });
  };
  const bodyCount = templateVariableCount(template?.body_text || data.preview_body);
  const headerFormat = String(template?.header_format || data.header_format || "NONE").toUpperCase();
  const urlButtons = (Array.isArray(template?.buttons) ? template.buttons : [])
    .map((button, index) => ({ button, index }))
    .filter(({ button }) => String(button?.type || "").toUpperCase() === "URL" && templateVariableCount(button.url));

  return (
    <>
      <Field label={t("waOfficialFlows.fields.template")} hint={templates.length ? "" : t("waOfficialFlows.editor.noApprovedTemplates")}>
        <SelectInput value={data.template_id ? String(data.template_id) : ""} onChange={(event) => pick(event.target.value)}>
          <option value="">{t("waOfficialFlows.editor.chooseTemplate")}</option>
          {templates.map((item) => <option key={item.id} value={String(item.id)}>{`${item.name} · ${item.language}`}</option>)}
        </SelectInput>
      </Field>
      {data.template_id && !template ? <p className="text-[11px] font-bold text-amber-200">{t("waOfficialFlows.editor.templateGone")}</p> : null}
      {data.preview_body ? <div dir="auto" className="whitespace-pre-wrap rounded-lg bg-[#d9fdd3] px-3 py-2 text-xs leading-5 text-slate-900">{data.preview_body}</div> : null}
      {headerFormat === "TEXT" && templateVariableCount(template?.header_text) ? (
        <Field label={t("waOfficialFlows.editor.headerVariable")}>
          <TextInput dir="auto" value={data.header_variable || ""} onChange={(event) => set({ header_variable: event.target.value })} />
        </Field>
      ) : null}
      {["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) ? (
        <MediaField label={t("waOfficialFlows.editor.headerMedia")} kind={headerFormat.toLowerCase()} value={data.header_media_url} headers={headers} onChange={(value) => set({ header_media_url: value })} />
      ) : null}
      {Array.from({ length: bodyCount }, (unused, index) => (
        <Field key={index} label={t("waOfficialFlows.editor.bodyVariable", { index: index + 1 })}>
          <TextInput dir="auto" value={data.variables?.[index] || ""} placeholder="{{name}}" onChange={(event) => {
            const variables = Array.from({ length: bodyCount }, (u, i) => data.variables?.[i] || "");
            variables[index] = event.target.value;
            set({ variables });
          }} />
        </Field>
      ))}
      {bodyCount ? <VariableChips onInsert={(variable) => {
        const variables = Array.from({ length: bodyCount }, (u, i) => data.variables?.[i] || "");
        const empty = variables.findIndex((item) => !item);
        variables[empty >= 0 ? empty : bodyCount - 1] = variable;
        set({ variables });
      }} /> : null}
      {urlButtons.map(({ button, index }) => (
        <Field key={index} label={t("waOfficialFlows.editor.urlVariable", { title: button.text || index + 1 })}>
          <TextInput dir="ltr" value={data.button_variables?.[index] || ""} onChange={(event) => set({ button_variables: { ...(data.button_variables || {}), [index]: event.target.value } })} />
        </Field>
      ))}
      {(data.buttons || []).length ? <p className="text-[11px] leading-5 text-slate-500">{t("waOfficialFlows.editor.templateRepliesHint")}</p> : null}
    </>
  );
}

export default function NodeEditor({ node, onChange, onSetStart, onClose, templates = [], headers, locked = false }) {
  const { t } = useTranslation();
  if (!node) return null;
  const data = node.data || {};
  const set = (patch) => onChange(node.id, patch);

  let body;
  switch (node.type) {
    case "interactive_buttons":
      body = (
        <>
          <HeaderFooter data={data} set={set} />
          <ButtonsEditor buttons={data.buttons || []} max={LIMITS.buttons} onChange={(buttons) => set({ buttons })} />
        </>
      );
      break;
    case "interactive_list":
      body = <ListEditor data={data} set={set} />;
      break;
    case "cta_url":
      body = (
        <>
          <HeaderFooter data={data} set={set} />
          <LimitedInput label={t("waOfficialFlows.fields.ctaText")} value={data.display_text} max={LIMITS.ctaText} onChange={(value) => set({ display_text: value })} />
          <Field label={t("waOfficialFlows.fields.url")} hint={t("waOfficialFlows.editor.httpsOnly")}>
            <TextInput dir="ltr" value={data.url || ""} placeholder="https://" onChange={(event) => set({ url: event.target.value })} />
          </Field>
        </>
      );
      break;
    case "carousel":
      body = <CarouselEditor data={data} set={set} headers={headers} />;
      break;
    case "template":
      body = <TemplateEditor data={data} set={set} templates={templates} headers={headers} />;
      break;
    case "text":
      body = <BodyField label={t("waOfficialFlows.fields.message")} value={data.body} max={LIMITS.text} onChange={(value) => set({ body: value })} rows={6} />;
      break;
    default:
      body = (
        <>
          <MediaField
            label={t("waOfficialFlows.fields.file")}
            kind={node.type}
            value={data.url}
            headers={headers}
            onChange={(value) => set({ url: value })}
            onFileName={node.type === "document" ? (name) => set({ filename: name }) : undefined}
          />
          {node.type === "document" ? (
            <Field label={t("waOfficialFlows.fields.filename")}>
              <TextInput dir="auto" value={data.filename || ""} onChange={(event) => set({ filename: event.target.value })} />
            </Field>
          ) : null}
          {node.type !== "audio" ? (
            <BodyField label={t("waOfficialFlows.fields.caption")} value={data.caption} max={LIMITS.caption} onChange={(value) => set({ caption: value })} rows={3} />
          ) : null}
        </>
      );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{kindTitle(t, node.type)}</div>
          <div dir="auto" className="truncate text-sm font-black text-white">{data.label || kindTitle(t, node.type)}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("waOfficialFlows.editor.close")} className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/10">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <fieldset disabled={locked} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 disabled:opacity-60">
        <Field label={t("waOfficialFlows.fields.nodeName")}>
          <TextInput dir="auto" value={data.label || ""} placeholder={kindTitle(t, node.type)} onChange={(event) => set({ label: event.target.value })} />
        </Field>
        {body}
        <div className="space-y-2 border-t border-white/10 pt-3">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("waOfficialFlows.editor.actions")}</div>
          <Toggle
            label={<span className="inline-flex items-center gap-1.5"><Flag className="h-3.5 w-3.5" aria-hidden="true" />{t("waOfficialFlows.editor.startNode")}</span>}
            hint={t("waOfficialFlows.editor.startNodeHint")}
            checked={data.is_start === true}
            onChange={(value) => onSetStart(node.id, value)}
          />
          <Toggle
            label={<span className="inline-flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" aria-hidden="true" />{t("waOfficialFlows.node.notifyTeam")}</span>}
            hint={t("waOfficialFlows.editor.notifyTeamHint")}
            checked={data.notify_team === true}
            onChange={(value) => set({ notify_team: value })}
          />
          <Toggle
            label={<span className="inline-flex items-center gap-1.5"><CircleStop className="h-3.5 w-3.5" aria-hidden="true" />{t("waOfficialFlows.node.endSession")}</span>}
            hint={t("waOfficialFlows.editor.endSessionHint")}
            checked={data.end_session === true}
            onChange={(value) => set({ end_session: value })}
          />
        </div>
      </fieldset>
    </div>
  );
}
