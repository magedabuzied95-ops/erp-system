// The layout half of the Invoice Studio: reorder the invoice by dragging, hide a
// section from one output without hiding it everywhere, and drop new blocks anywhere.
//
// Drag and drop is the native HTML5 kind on purpose — a vertical list of a dozen rows
// does not need a drag library, and the studio already carries enough weight.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";

import {
  BLOCK_ALIGNMENTS,
  BLOCK_TEXT_SIZES,
  BARCODE_SOURCES,
  BUILT_IN_BLOCK_TYPES,
  CUSTOM_BLOCK_TYPES,
  FIELD_ROW_SOURCES,
  INVOICE_BLOCK_OUTPUTS,
  QR_SOURCES,
  createInvoiceBlock,
  isBlockVisibleIn,
  moveInvoiceBlock,
  normalizeInvoiceBlocks,
  toggleBlockOutput,
} from "../../../../shared/invoiceBlocks.js";

const FALLBACK_BLOCK_LABELS = {
  brand: "الترويسة (الشعار، الاسم، رقم الفاتورة والتاريخ)",
  customer_meta: "بيانات العميل",
  items_table: "جدول المنتجات",
  totals: "الإجماليات",
  policy: "سياسة الاستبدال",
  social: "أزرار التقييم",
  store_contact: "تذييل بيانات المحل",
  text: "نص حر",
  image: "صورة",
  qr: "كود QR",
  barcode: "باركود",
  field_row: "صف بيانات",
  divider: "خط فاصل",
  spacer: "مسافة",
};

const FALLBACK_OUTPUT_LABELS = {
  card: "داخل النظام",
  public: "رابط العميل",
  print: "مطبوعة A4",
  thermal: "حراري",
};

const controlClass =
  "h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 px-3 text-sm font-bold text-white outline-none transition focus:border-primary/40 disabled:opacity-50";

function Labelled({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-black text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function InvoiceLayoutEditor({ blocks, onChange, disabled = false }) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key, fallback, options) => t(`settings.invoiceStudio.${key}`, { defaultValue: fallback, ...(options || {}) }),
    [t]
  );
  const blockLabel = (type) => tr(`blocks.${type}`, FALLBACK_BLOCK_LABELS[type] || type);
  const outputLabel = (output) => tr(`outputsShort.${output}`, FALLBACK_OUTPUT_LABELS[output] || output);

  const list = normalizeInvoiceBlocks(blocks);
  const [openId, setOpenId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [adding, setAdding] = useState(false);

  const commit = (next) => {
    if (disabled) return;
    onChange(next);
  };

  const patchBlock = (id, partial) =>
    commit(list.map((block) => (block.id === id ? { ...block, ...partial } : block)));

  const move = (from, to) => commit(moveInvoiceBlock(list, from, to));

  const addBlock = (type) => {
    setAdding(false);
    const block = createInvoiceBlock(type);
    commit([...list, block]);
    setOpenId(block.id);
  };

  const removeBlock = (id) => commit(list.filter((block) => block.id !== id));

  const onDrop = (index) => {
    if (dragIndex === null) return;
    move(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="grid gap-3">
      <p className="text-[11px] leading-4 text-slate-500">
        {tr("layout.note", "اسحب أي عنصر لتغيير ترتيبه في الفاتورة. الترتيب واحد لكل المخارج، وتقدر تخفي أي عنصر من مخرج معيّن.")}
      </p>

      <div className="grid gap-2">
        {list.map((block, index) => {
          const isCustom = CUSTOM_BLOCK_TYPES.includes(block.type);
          const open = openId === block.id;
          return (
            <div
              key={block.id}
              draggable={!disabled}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                event.preventDefault();
                setOverIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={() => onDrop(index)}
              className={`rounded-[var(--radius-control)] border transition ${
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "border-primary/60 bg-primary/10"
                  : "border-white/10 bg-slate-950/55"
              } ${dragIndex === index ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-2 p-2.5">
                <GripVertical className={`h-4 w-4 shrink-0 ${disabled ? "text-slate-700" : "cursor-grab text-slate-500"}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-black text-white">{blockLabel(block.type)}</span>

                <div className="hidden flex-wrap items-center gap-1 sm:flex">
                  {INVOICE_BLOCK_OUTPUTS.map((output) => {
                    const visible = isBlockVisibleIn(block, output);
                    return (
                      <button
                        key={output}
                        type="button"
                        disabled={disabled}
                        onClick={() => patchBlock(block.id, toggleBlockOutput(block, output, !visible))}
                        title={outputLabel(output)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black transition disabled:opacity-40 ${
                          visible ? "border-primary/40 bg-primary/15 text-white" : "border-white/10 text-slate-500 line-through"
                        }`}
                      >
                        {outputLabel(output)}
                      </button>
                    );
                  })}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" disabled={disabled || index === 0} onClick={() => move(index, index - 1)} className="rounded p-1 text-slate-400 disabled:opacity-30" title={tr("layout.up", "لأعلى")}>
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" disabled={disabled || index === list.length - 1} onClick={() => move(index, index + 1)} className="rounded p-1 text-slate-400 disabled:opacity-30" title={tr("layout.down", "لأسفل")}>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {isCustom ? (
                    <>
                      <button type="button" disabled={disabled} onClick={() => setOpenId(open ? null : block.id)} className="rounded px-2 py-1 text-[11px] font-black text-primary disabled:opacity-40">
                        {open ? tr("layout.close", "إغلاق") : tr("layout.edit", "تعديل")}
                      </button>
                      <button type="button" disabled={disabled} onClick={() => removeBlock(block.id)} className="rounded p-1 text-rose-300 disabled:opacity-40" title={tr("delete", "حذف")}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {/* The output chips wrap under the row on a narrow screen instead of
                  squeezing the label out of it. */}
              <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2.5 sm:hidden">
                {INVOICE_BLOCK_OUTPUTS.map((output) => {
                  const visible = isBlockVisibleIn(block, output);
                  return (
                    <button
                      key={output}
                      type="button"
                      disabled={disabled}
                      onClick={() => patchBlock(block.id, toggleBlockOutput(block, output, !visible))}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-black transition disabled:opacity-40 ${
                        visible ? "border-primary/40 bg-primary/15 text-white" : "border-white/10 text-slate-500 line-through"
                      }`}
                    >
                      {outputLabel(output)}
                    </button>
                  );
                })}
              </div>

              {open && isCustom ? (
                <div className="grid gap-3 border-t border-white/10 p-3">
                  {block.type === "text" ? (
                    <>
                      <Labelled label={tr("layout.textAr", "النص (عربي)")}>
                        <textarea rows={3} disabled={disabled} value={block.content.ar} onChange={(e) => patchBlock(block.id, { content: { ...block.content, ar: e.target.value } })} className={`${controlClass} h-auto py-2`} />
                      </Labelled>
                      <Labelled label={tr("layout.textEn", "النص (إنجليزي)")}>
                        <textarea rows={2} disabled={disabled} value={block.content.en} onChange={(e) => patchBlock(block.id, { content: { ...block.content, en: e.target.value } })} className={`${controlClass} h-auto py-2`} />
                      </Labelled>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Labelled label={tr("layout.size", "حجم الخط")}>
                          <select disabled={disabled} value={block.size} onChange={(e) => patchBlock(block.id, { size: e.target.value })} className={controlClass}>
                            {BLOCK_TEXT_SIZES.map((size) => <option key={size} value={size} className="bg-slate-950">{tr(`layout.sizes.${size}`, size)}</option>)}
                          </select>
                        </Labelled>
                        <Labelled label={tr("layout.align", "المحاذاة")}>
                          <select disabled={disabled} value={block.align} onChange={(e) => patchBlock(block.id, { align: e.target.value })} className={controlClass}>
                            {BLOCK_ALIGNMENTS.map((align) => <option key={align} value={align} className="bg-slate-950">{tr(`layout.aligns.${align}`, align)}</option>)}
                          </select>
                        </Labelled>
                        <div className="flex items-end gap-2">
                          <button type="button" disabled={disabled} onClick={() => patchBlock(block.id, { bold: !block.bold })} className={`h-[var(--control-height-md)] flex-1 rounded-[var(--radius-control)] border text-xs font-black ${block.bold ? "border-primary/40 bg-primary/15 text-white" : "border-white/10 text-slate-400"}`}>{tr("layout.bold", "غامق")}</button>
                          <button type="button" disabled={disabled} onClick={() => patchBlock(block.id, { boxed: !block.boxed })} className={`h-[var(--control-height-md)] flex-1 rounded-[var(--radius-control)] border text-xs font-black ${block.boxed ? "border-primary/40 bg-primary/15 text-white" : "border-white/10 text-slate-400"}`}>{tr("layout.boxed", "بإطار")}</button>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {block.type === "image" ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <Labelled label={tr("layout.imageUrl", "رابط الصورة")}>
                          <input disabled={disabled} value={block.url} onChange={(e) => patchBlock(block.id, { url: e.target.value })} className={controlClass} placeholder="https://" />
                        </Labelled>
                      </div>
                      <Labelled label={tr("layout.width", "العرض %")}>
                        <input type="number" min={10} max={100} disabled={disabled} value={block.width_pct} onChange={(e) => patchBlock(block.id, { width_pct: Number(e.target.value) })} className={controlClass} />
                      </Labelled>
                    </div>
                  ) : null}

                  {block.type === "qr" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Labelled label={tr("layout.qrSource", "محتوى الكود")}>
                        <select disabled={disabled} value={block.source} onChange={(e) => patchBlock(block.id, { source: e.target.value })} className={controlClass}>
                          {QR_SOURCES.map((source) => <option key={source} value={source} className="bg-slate-950">{tr(`layout.qrSources.${source}`, source)}</option>)}
                        </select>
                      </Labelled>
                      {block.source === "custom" ? (
                        <Labelled label={tr("layout.qrValue", "الرابط")}>
                          <input disabled={disabled} value={block.value} onChange={(e) => patchBlock(block.id, { value: e.target.value })} className={controlClass} placeholder="https://" />
                        </Labelled>
                      ) : null}
                      <Labelled label={tr("layout.qrSize", "الحجم (بكسل)")}>
                        <input type="number" min={48} max={320} disabled={disabled} value={block.size_px} onChange={(e) => patchBlock(block.id, { size_px: Number(e.target.value) })} className={controlClass} />
                      </Labelled>
                      <Labelled label={tr("layout.qrCaption", "نص تحت الكود")}>
                        <input disabled={disabled} value={block.caption.ar} onChange={(e) => patchBlock(block.id, { caption: { ...block.caption, ar: e.target.value } })} className={controlClass} />
                      </Labelled>
                    </div>
                  ) : null}

                  {block.type === "barcode" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Labelled label={tr("layout.barcodeSource", "قيمة الباركود")}>
                        <select disabled={disabled} value={block.source} onChange={(e) => patchBlock(block.id, { source: e.target.value })} className={controlClass}>
                          {BARCODE_SOURCES.map((source) => <option key={source} value={source} className="bg-slate-950">{tr(`layout.barcodeSources.${source}`, source)}</option>)}
                        </select>
                      </Labelled>
                      {block.source === "custom" ? (
                        <Labelled label={tr("layout.barcodeValue", "القيمة")}>
                          <input disabled={disabled} value={block.value} onChange={(e) => patchBlock(block.id, { value: e.target.value })} className={controlClass} />
                        </Labelled>
                      ) : null}
                    </div>
                  ) : null}

                  {block.type === "field_row" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Labelled label={tr("layout.rowLabelAr", "الاسم (عربي)")}>
                        <input disabled={disabled} value={block.label.ar} onChange={(e) => patchBlock(block.id, { label: { ...block.label, ar: e.target.value } })} className={controlClass} />
                      </Labelled>
                      <Labelled label={tr("layout.rowLabelEn", "الاسم (إنجليزي)")}>
                        <input disabled={disabled} value={block.label.en} onChange={(e) => patchBlock(block.id, { label: { ...block.label, en: e.target.value } })} className={controlClass} />
                      </Labelled>
                      <Labelled label={tr("layout.rowSource", "القيمة من")}>
                        <select disabled={disabled} value={block.source} onChange={(e) => patchBlock(block.id, { source: e.target.value })} className={controlClass}>
                          {FIELD_ROW_SOURCES.map((source) => <option key={source} value={source} className="bg-slate-950">{tr(`layout.rowSources.${source}`, source)}</option>)}
                        </select>
                      </Labelled>
                      {block.source === "custom" ? (
                        <Labelled label={tr("layout.rowValue", "القيمة")}>
                          <input disabled={disabled} value={block.value} onChange={(e) => patchBlock(block.id, { value: e.target.value })} className={controlClass} />
                        </Labelled>
                      ) : null}
                    </div>
                  ) : null}

                  {block.type === "spacer" ? (
                    <Labelled label={tr("layout.height", "الارتفاع (بكسل)")}>
                      <input type="number" min={4} max={200} disabled={disabled} value={block.height_px} onChange={(e) => patchBlock(block.id, { height_px: Number(e.target.value) })} className={controlClass} />
                    </Labelled>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="relative">
        <button type="button" disabled={disabled} onClick={() => setAdding((value) => !value)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-white/20 px-4 text-xs font-black text-white disabled:opacity-50">
          <Plus className="h-4 w-4" />
          {tr("layout.add", "إضافة عنصر")}
        </button>
        {adding ? (
          <div className="mt-2 flex flex-wrap gap-2 rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 p-2">
            {CUSTOM_BLOCK_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => addBlock(type)} className="rounded-[var(--radius-control)] border border-white/10 px-3 py-1.5 text-xs font-black text-slate-200 hover:border-primary/40 hover:text-white">
                {blockLabel(type)}
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[11px] leading-4 text-slate-500">
          {tr("layout.builtInNote", "الأقسام الأساسية ({{count}}) تتحرك وتختفي لكن لا تُحذف — إخفاؤها من كل المخارج هو نفس الحذف.", { count: BUILT_IN_BLOCK_TYPES.length })}
        </p>
      </div>
    </div>
  );
}
