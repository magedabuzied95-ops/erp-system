// One node on the chatbot flow canvas: coloured header (icon, name, copy/delete), the WhatsApp
// bubble as the customer will see it, and one output handle per button / row / card button.
import { memo, useContext, useEffect, useMemo } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { AudioLines, Bell, CircleStop, Copy, ExternalLink, FileText, Flag, Trash2, Video } from "lucide-react";

import { resolveChatMediaUrl as resolveMediaUrl } from "../../../../../shared/lib/imageUrls.js";
import { KINDS, LIMITS, outputsOf } from "./flowModel.js";
import { kindTitle } from "./flowLabels.js";
import { FlowBuilderContext } from "./flowBuilderContext.js";

const HANDLE_CLASS = "!h-3 !w-3 !border-2 !border-[#0b1120] !bg-emerald-400";

function OutputRow({ id, children, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      {children}
      <Handle type="source" position={Position.Right} id={id} className={`${HANDLE_CLASS} !-right-[18px]`} />
    </div>
  );
}

function Bubble({ data, showHeader = true }) {
  return (
    <div className="rounded-lg bg-[#d9fdd3] px-2.5 py-2 text-[11px] leading-[1.45] text-slate-900 shadow-sm">
      {showHeader && data.header ? <div dir="auto" className="mb-1 font-bold">{data.header}</div> : null}
      <div dir="auto" className="line-clamp-6 whitespace-pre-wrap break-words">{data.body || <span className="text-slate-500">…</span>}</div>
      {data.footer ? <div dir="auto" className="mt-1 text-[10px] text-slate-500">{data.footer}</div> : null}
    </div>
  );
}

function ChoiceButton({ title, placeholder }) {
  return (
    <div dir="auto" className="truncate rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-center text-[11px] font-bold text-sky-200">
      {title || <span className="text-slate-500">{placeholder}</span>}
    </div>
  );
}

function Footnote({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-white/[0.06] text-slate-400",
    emerald: "bg-emerald-400/10 text-emerald-200",
    orange: "bg-orange-400/10 text-orange-200",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[9.5px] font-black ${tones[tone] || tones.slate}`}>{children}</span>;
}

function MediaPreview({ kind, url, filename }) {
  const resolved = resolveMediaUrl(url);
  if (kind === "image") {
    return resolved
      ? <img src={resolved} alt="" className="h-28 w-full rounded-md object-cover" draggable={false} />
      : <div className="grid h-20 place-items-center rounded-md bg-white/[0.05] text-[10px] text-slate-500">—</div>;
  }
  const Icon = kind === "video" ? Video : kind === "audio" ? AudioLines : FileText;
  return (
    <div className="flex items-center gap-2 rounded-md bg-white/[0.05] px-2 py-2 text-[10.5px] text-slate-300">
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span dir="auto" className="min-w-0 truncate">{filename || (url ? url.split("/").pop() : "—")}</span>
    </div>
  );
}

function NodeBody({ node, t }) {
  const data = node.data || {};
  const placeholder = t("waOfficialFlows.node.untitledButton");
  switch (node.type) {
    case "interactive_buttons":
      return (
        <div className="space-y-1.5">
          <Bubble data={data} />
          {(data.buttons || []).map((button) => (
            <OutputRow key={button.id} id={button.id}><ChoiceButton title={button.title} placeholder={placeholder} /></OutputRow>
          ))}
          <Footnote tone="emerald">{t("waOfficialFlows.node.buttonsOnly", { count: LIMITS.buttons })}</Footnote>
        </div>
      );
    case "interactive_list":
      return (
        <div className="space-y-1.5">
          <Bubble data={data} />
          {data.button_label ? <ChoiceButton title={`☰ ${data.button_label}`} placeholder="" /> : null}
          {(data.sections || []).map((section) => (
            <div key={section.id} className="space-y-1">
              {section.title ? <div dir="auto" className="px-1 pt-1 text-[9.5px] font-black uppercase tracking-wider text-orange-300">{section.title}</div> : null}
              {(section.rows || []).map((row) => (
                <OutputRow key={row.id} id={row.id}>
                  <div className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
                    <div dir="auto" className="truncate text-[11px] font-bold text-slate-100">{row.title || <span className="text-slate-500">{placeholder}</span>}</div>
                    {row.description ? <div dir="auto" className="truncate text-[10px] text-slate-400">{row.description}</div> : null}
                  </div>
                </OutputRow>
              ))}
            </div>
          ))}
          <Footnote tone="orange">{t("waOfficialFlows.node.rowsMax", { count: LIMITS.listRows })}</Footnote>
        </div>
      );
    case "cta_url":
      return (
        <OutputRow id="next" className="space-y-1.5">
          <Bubble data={data} />
          <div className="flex items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-[11px] font-bold text-sky-200">
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span dir="auto" className="truncate">{data.display_text || "—"}</span>
          </div>
          <div dir="ltr" className="truncate px-1 text-[9.5px] text-slate-500">{data.url}</div>
        </OutputRow>
      );
    case "carousel":
      return (
        <div className="space-y-1.5">
          <Bubble data={data} showHeader={false} />
          {(data.cards || []).map((card) => (
            <div key={card.id} className="space-y-1 rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
              <MediaPreview kind="image" url={card.image_url} />
              {card.body ? <div dir="auto" className="line-clamp-2 px-0.5 text-[10.5px] text-slate-300">{card.body}</div> : null}
              {(card.buttons || []).map((button) => (
                <OutputRow key={button.id} id={button.id}><ChoiceButton title={button.title} placeholder={placeholder} /></OutputRow>
              ))}
            </div>
          ))}
          <Footnote tone="emerald">{t("waOfficialFlows.node.cardsInfo", { count: (data.cards || []).length })}</Footnote>
        </div>
      );
    case "template": {
      const replies = data.buttons || [];
      const body = (
        <div className="space-y-1.5">
          <div className="rounded-lg bg-[#d9fdd3] px-2.5 py-2 text-[11px] leading-[1.45] text-slate-900">
            <div dir="auto" className="mb-1 font-bold">{data.template_name || t("waOfficialFlows.node.noTemplate")}</div>
            {data.preview_body ? <div dir="auto" className="line-clamp-5 whitespace-pre-wrap">{data.preview_body}</div> : null}
          </div>
          {replies.map((button) => (
            <OutputRow key={button.id} id={button.id}><ChoiceButton title={button.title} placeholder={placeholder} /></OutputRow>
          ))}
        </div>
      );
      return replies.length ? body : <OutputRow id="next">{body}</OutputRow>;
    }
    case "text":
      return <OutputRow id="next"><Bubble data={data} /></OutputRow>;
    case "image":
    case "video":
    case "audio":
    case "document":
      return (
        <OutputRow id="next" className="space-y-1.5">
          <MediaPreview kind={node.type} url={data.url} filename={data.filename} />
          {node.type !== "audio" ? (
            <div dir="auto" className="px-1 text-[10px] text-slate-400">{data.caption || t("waOfficialFlows.node.noCaption")}</div>
          ) : null}
        </OutputRow>
      );
    default:
      return null;
  }
}

function FlowNode({ id, type, data, selected }) {
  const { t } = useTranslation();
  const { onCopy, onDelete, nodeErrors, locked } = useContext(FlowBuilderContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const meta = KINDS[type] || KINDS.text;
  const Icon = meta.icon;
  const node = useMemo(() => ({ id, type, data }), [id, type, data]);
  const handleSignature = outputsOf(node).map((output) => output.id).join("|");

  // Handles come and go with buttons/rows; xyflow must re-measure them or edges attach to nothing.
  useEffect(() => { updateNodeInternals(id); }, [handleSignature, id, updateNodeInternals]);

  const errors = nodeErrors?.[id] || [];
  const ring = errors.length ? "ring-2 ring-rose-400" : selected ? "ring-2 ring-cyan-300" : "ring-1 ring-white/10";

  return (
    <div className={`w-[240px] rounded-xl bg-slate-900 shadow-[0_8px_30px_rgba(0,0,0,0.35)] ${ring}`}>
      <Handle type="target" position={Position.Left} className={`${HANDLE_CLASS} !-left-[7px] !bg-sky-300`} />
      <div className="flex items-center gap-1.5 rounded-t-xl px-2.5 py-1.5 text-white" style={{ backgroundColor: meta.color }}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[11.5px] font-black">{data?.label || kindTitle(t, type)}</span>
        {data?.is_start ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 text-[9px] font-black">
            <Flag className="h-2.5 w-2.5" aria-hidden="true" />{t("waOfficialFlows.node.start")}
          </span>
        ) : null}
        {!locked ? (
          <>
            <button type="button" onClick={(event) => { event.stopPropagation(); onCopy(id); }} title={t("waOfficialFlows.node.copy")} aria-label={t("waOfficialFlows.node.copy")} className="nodrag grid h-5 w-5 place-items-center rounded hover:bg-white/20">
              <Copy className="h-3 w-3" aria-hidden="true" />
            </button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(id); }} title={t("waOfficialFlows.node.delete")} aria-label={t("waOfficialFlows.node.delete")} className="nodrag grid h-5 w-5 place-items-center rounded hover:bg-white/20">
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      <div className="p-2.5">
        <NodeBody node={node} t={t} />
        {data?.notify_team || data?.end_session ? (
          <div className="mt-2 space-y-0.5 border-t border-white/10 pt-1.5 text-[10px] font-bold">
            {data.notify_team ? <div className="flex items-center gap-1 text-amber-300"><Bell className="h-3 w-3" aria-hidden="true" />{t("waOfficialFlows.node.notifyTeam")}</div> : null}
            {data.end_session ? <div className="flex items-center gap-1 text-rose-300"><CircleStop className="h-3 w-3" aria-hidden="true" />{t("waOfficialFlows.node.endSession")}</div> : null}
          </div>
        ) : null}
        {errors.length ? <div className="mt-2 rounded-md bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-200">{t("waOfficialFlows.node.problems", { count: errors.length })}</div> : null}
      </div>
    </div>
  );
}

export default memo(FlowNode);
