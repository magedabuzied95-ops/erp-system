/*
 * The AI suggested-reply card — ONE implementation for both inbox surfaces.
 *
 * The desktop workspace could resolve an ambiguous product, pick a colour, tick
 * a batch of recommended or variant-option cards, and drop or swap the attached
 * product before approving. The phone could only edit, approve or dismiss the
 * text — so the same suggestion produced a different outcome depending on where
 * the operator happened to be standing. This is that card, shared.
 */
import { useTranslation } from "react-i18next";

import { clean } from "../lib/conversationHelpers";
import {
  assistedSendButtonText,
  assistedVariantSendButtonText,
  productSelectionKey,
  selectedCountText,
  selectedVariantCountText,
} from "../lib/productSelection.js";

// The exact text an Instagram share carries, previewed before it is sent.
const instagramShareText = (card = {}) => {
  const name = clean(card.name || card.product_name || card.title || "");
  const color = clean(card.color || "");
  const price = card.display_price ?? card.price ?? null;
  const url = clean(card.storefront_url || card.product_url || card.url || "");
  return [
    name,
    color ? `اللون: ${color}` : "",
    // Parity with the server's formatCloserPrice: only a POSITIVE price is a price. A 0 (no canonical price)
    // is dropped from the line there, so previewing "السعر: 0 جنيه" here would be preview-vs-sent drift.
    (Number.isFinite(Number(price)) && Number(price) > 0) ? `السعر: ${Math.round(Number(price))} جنيه` : "",
    url ? "عرض المنتج:" : "",
    url || "",
  ].filter(Boolean).join("\n");
};

function Pill({ children, tone = "zinc", className = "" }) {
  const classes = {
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/20 bg-violet-400/10 text-violet-100",
    zinc: "border-white/10 bg-white/[0.055] text-slate-200",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${classes[tone] || classes.zinc} ${className}`}>{children}</span>;
}

function CardPriceLine({ price, label = "", as: Tag = "span", className = "" }) {
  const value = Number(price);
  const known = Number.isFinite(value) && value > 0;
  return (
    <Tag className={`font-bold ${known ? "text-emerald-200" : "text-amber-200"}${className ? ` ${className}` : ""}`}>
      {known ? `${value} جنيه` : label}
    </Tag>
  );
}

function SuggestionProductToSend({ card = null, choices = [], ambiguous = false, colorChoices = [], colorRequired = false, removed = false, deliveryFormat = "", instagramDelivery = false, recommendationMode = false, variantOptionsMode = false, recommendationSelectedKeys = null, onToggleRecommendation, onRemove, onChange, onChoose }) {
  const { t } = useTranslation();
  const hasCard = Boolean(card && (card.product_id || card.id));
  // Phase 13.4 — RECOMMENDATION multi-select: the operator ticks the grounded products to send with the reply.
  // Distinct from single-select identity disambiguation (below) which resolves ONE product.
  const showRecommendation = recommendationMode && !removed && Array.isArray(choices) && choices.length > 0;
  const showChoices = !recommendationMode && ambiguous && !hasCard && !removed && Array.isArray(choices) && choices.length > 0;
  // Phase 12.2 — requested size available in >1 colour, none picked yet → require a colour before a card is definitive.
  const showColorChoices = colorRequired && !hasCard && !removed && Array.isArray(colorChoices) && colorChoices.length > 0;
  // Phase 13.4.1 — VARIANT OPTIONS multi-select: identity is grounded, the customer named a size but no colour, so
  // these colours are AVAILABLE OPTIONS, not a "which one did you mean?" question. Ticking never sends.
  const showVariantOptions = showColorChoices && variantOptionsMode;
  if (removed) {
    return (
      <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-2 text-[11px] font-bold text-slate-300">
        تم حذف كارت المنتج — هيتبعت الرد بس.
        <button type="button" onClick={onChange} className="mr-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black text-cyan-100">➕ إضافة منتج</button>
      </div>
    );
  }
  if (showVariantOptions) {
    const selKeys = recommendationSelectedKeys instanceof Set ? recommendationSelectedKeys : new Set();
    const selectedCount = selKeys.size;
    return (
      <div className="mt-2 rounded-xl border border-cyan-300/25 bg-cyan-400/[0.08] p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">{t("aiSupport.inbox.panel.chooseColours")}</div>
          <span className={`rounded-lg border px-1.5 py-0.5 text-[9px] font-black ${selectedCount > 0 ? "border-cyan-300/25 bg-cyan-400/15 text-cyan-100" : "border-white/12 bg-white/[0.04] text-slate-300"}`}>
            {selectedCount > 0 ? selectedVariantCountText(selectedCount) : "تقدر تختار أكتر من لون"}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {colorChoices.map((c) => {
            // Keyed by CANONICAL product+variant identity — never by colour text, so two similar colour labels
            // cannot collide and several variants of the same product are distinct selections.
            const key = productSelectionKey(c);
            const picked = selKeys.has(key);
            const img = c.image_url || c.image || c.thumbnail_url || "";
            const price = c.display_price ?? c.price ?? null;
            return (
              <div key={key || `${c.product_id}:${c.color}`} className={`flex items-start gap-2 rounded-lg border p-1.5 transition ${picked ? "border-cyan-300 bg-cyan-400/20 ring-1 ring-cyan-300/40" : "border-white/12 bg-white/[0.04] hover:border-cyan-300/30 hover:bg-white/[0.07]"}`}>
                <button
                  type="button"
                  onClick={() => onToggleRecommendation?.(c)}
                  aria-pressed={picked}
                  title={picked ? "اضغط لإلغاء الاختيار" : "اضغط لاختيار اللون ده"}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-right"
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[9px] font-black ${picked ? "border-cyan-300 bg-cyan-400 text-slate-900" : "border-white/35 bg-white/[0.06] text-transparent"}`}>✓</span>
                  {img ? <img src={img} alt={clean(c.color)} className="h-9 w-9 shrink-0 rounded border border-white/10 object-cover" /> : null}
                  <span className="min-w-0 flex-1 text-[11px] leading-4 text-slate-100">
                    <span className="block truncate font-black">{clean(c.color) || "لون"}</span>
                    {c.size ? <span className="block text-slate-300">{t("aiSupport.inbox.panel.size")} {clean(c.size)}</span> : null}
                    <CardPriceLine price={price} label={t("aiSupport.inbox.panel.priceUnavailable")} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (showColorChoices) {
    return (
      <div className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/10 p-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">{t("aiSupport.inbox.panel.sizeMultiColour")}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {colorChoices.map((c) => (
            <button key={c.variant_id || `${c.product_id}:${c.color}`} type="button" onClick={() => onChoose?.(c)} className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-slate-100 hover:bg-white/[0.1]">
              {(c.image_url || c.image) ? <img src={c.image_url || c.image} alt={clean(c.color)} className="h-6 w-6 rounded border border-white/10 object-cover" /> : null}
              {clean(c.color) || "لون"}
              {" — "}
              <CardPriceLine price={c.display_price} label={t("aiSupport.inbox.panel.priceUnavailable")} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (showRecommendation) {
    const selKeys = recommendationSelectedKeys instanceof Set ? recommendationSelectedKeys : new Set();
    const selectedCount = selKeys.size;
    return (
      <div className="mt-2 rounded-xl border border-cyan-300/25 bg-cyan-400/[0.08] p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">{t("aiSupport.inbox.panel.chooseProducts")}</div>
          {selectedCount > 0 ? <span className="rounded-lg border border-cyan-300/25 bg-cyan-400/15 px-1.5 py-0.5 text-[9px] font-black text-cyan-100">{selectedCountText(selectedCount)}</span> : null}
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {choices.map((c) => {
            const key = productSelectionKey(c);
            const picked = selKeys.has(key);
            const name = clean(c.name || c.product_name);
            const img = c.image_url || c.image || c.thumbnail_url || "";
            const price = c.display_price ?? c.price ?? null;
            const url = c.storefront_url || c.product_url || c.url || "";
            return (
              <div key={c.product_id || c.id} className={`flex items-start gap-2 rounded-lg border p-1.5 transition ${picked ? "border-cyan-300/50 bg-cyan-400/15" : "border-white/12 bg-white/[0.04]"}`}>
                <button type="button" onClick={() => onToggleRecommendation?.(c)} aria-pressed={picked} className="flex min-w-0 flex-1 items-start gap-2 text-right">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[9px] font-black ${picked ? "border-cyan-300 bg-cyan-400 text-slate-900" : "border-white/25 text-transparent"}`}>✓</span>
                  {img ? <img src={img} alt={name} className="h-9 w-9 shrink-0 rounded border border-white/10 object-cover" /> : null}
                  <span className="min-w-0 flex-1 text-[11px] leading-4 text-slate-100">
                    <span className="block truncate font-black">{name}</span>
                    <CardPriceLine price={price} label={t("aiSupport.inbox.panel.priceUnavailable")} />
                  </span>
                </button>
                {url ? <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 text-[9px] font-black text-cyan-200 underline">{t("aiSupport.inbox.panel.openProduct")}</a> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (showChoices) {
    return (
      <div className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/10 p-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">{t("aiSupport.inbox.panel.multipleMatches")}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {choices.map((c) => (
            <button key={c.product_id || c.id} type="button" onClick={() => onChoose?.(c)} className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-slate-100 hover:bg-white/[0.1]">
              {clean(c.name || c.product_name)}
              {" — "}
              <CardPriceLine price={c.display_price} label={t("aiSupport.inbox.panel.priceUnavailable")} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (!hasCard) return null;
  const name = clean(card.name || card.product_name);
  const img = card.image_url || card.image || card.thumbnail_url || "";
  const price = card.display_price ?? card.price ?? null;
  return (
    <div className="mt-2 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100">{t("aiSupport.inbox.panel.productToSend")}</div>
        {deliveryFormat ? <span className="rounded-lg border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-black text-slate-200">{deliveryFormat}</span> : null}
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        {img ? <img src={img} alt={name} className="h-14 w-14 shrink-0 rounded-lg border border-white/10 object-cover" /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-white/10 bg-slate-800 text-[9px] text-slate-400">{t("aiSupport.inbox.panel.noImage")}</div>}
        <div className="min-w-0 flex-1 text-[11px] leading-5 text-slate-100">
          <div className="truncate font-black">{name}</div>
          {card.color ? <div className="text-slate-300">{t("aiSupport.inbox.panel.colourLabel")} {clean(card.color)}</div> : null}
          {card.size ? <div className="text-slate-300">{t("aiSupport.inbox.panel.sizeLabel")} {clean(card.size)}</div> : null}
          <CardPriceLine as="div" price={price} label={t("aiSupport.inbox.panel.priceUnavailable")} />
          <div className={`font-bold ${card.in_stock === false ? "text-rose-300" : "text-emerald-300"}`}>{card.in_stock === false ? "غير متاح" : "متاح"}</div>
          {(card.storefront_url || card.product_url) ? <a href={card.storefront_url || card.product_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-cyan-200 underline">{t("aiSupport.inbox.panel.viewProduct")}</a> : null}
        </div>
      </div>
      {instagramDelivery ? (
        <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/60 p-2">
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-cyan-200/80">{t("aiSupport.inbox.panel.whatCustomerGets")}</div>
          <pre dir="rtl" className="mt-1 whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-slate-100">{instagramShareText(card)}</pre>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onRemove} className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-200 hover:bg-white/[0.08]">🗑️ حذف المنتج</button>
        <button type="button" onClick={onChange} className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-black text-violet-100 hover:bg-violet-400/15">🔁 تغيير المنتج</button>
      </div>
    </div>
  );
}

function AiSuggestionCard({
  text = "",
  onEdit,
  onApprove,
  onDismiss,
  editing = false,
  reviewNeeded = false,
  productCard = null,
  productChoices = [],
  productAmbiguous = false,
  colorChoices = [],
  colorRequired = false,
  productRemoved = false,
  deliveryFormat = "",
  channelName = "",
  instagramDelivery = false,
  recommendationMode = false,
  variantOptionsMode = false,
  recommendationSelectedKeys = null,
  onToggleRecommendation,
  onRemoveProduct,
  onChangeProduct,
  onChooseProduct,
  editText = "",
  onEditTextChange,
  onCancelEdit,
}) {
  const { t } = useTranslation();
  const value = clean(text);
  if (!value) return null;
  // The text that Approve & Send will actually send: the inline edit while editing, else the AI suggestion.
  const finalText = editing ? editText : value;
  // Phase 13.4 — recommendation batch count drives the Approve button label ("اعتماد وإرسال (N منتجات)").
  // Phase 13.4.1 — variant options use the same count with colour wording ("اعتماد وإرسال (N اختيارات)").
  const multiSelectMode = recommendationMode || variantOptionsMode;
  const recommendationCount = multiSelectMode && recommendationSelectedKeys instanceof Set ? recommendationSelectedKeys.size : 0;
  const approveLabel = recommendationCount > 0
    ? (variantOptionsMode ? assistedVariantSendButtonText(recommendationCount) : assistedSendButtonText(recommendationCount))
    : "اعتماد وإرسال";
  // Phase 13.4.1 — an options suggestion answers "which colours do we show?", so approving with nothing ticked
  // would send a reply that promises options and delivers none. Disable rather than fail on click.
  const approveDisabled = variantOptionsMode && recommendationCount === 0;

  return (
    <div className={`mb-2 rounded-2xl border p-2.5 ${editing ? "border-violet-300/30 bg-violet-400/10" : "border-cyan-300/15 bg-cyan-300/8"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">{editing ? "تعديل اقتراح الذكاء الاصطناعي" : "اقتراح الذكاء الاصطناعي"}</div>
            {clean(channelName) ? <span className="rounded-lg border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-black text-slate-200">{clean(channelName)}</span> : null}
            {clean(deliveryFormat) ? <span className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-black text-cyan-100">{t("aiSupport.inbox.panel.delivery")} {clean(deliveryFormat)}</span> : null}
            {/* Phase 13.3 — ONE compact operator-facing review cue; replaces the large validation/confidence panels. */}
            {reviewNeeded ? <span className="rounded-lg border border-amber-300/30 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-black text-amber-100">⚠ يحتاج مراجعة</span> : null}
          </div>
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => onEditTextChange?.(e.target.value)}
              rows={4}
              dir="auto"
              autoFocus
              className="mt-2 w-full resize-y rounded-xl border border-violet-300/40 bg-slate-950/80 p-3 text-sm leading-7 text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
              placeholder={t("aiSupport.inbox.panel.editAiReply")}
            />
          ) : (
            <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-slate-950/75 p-3 text-sm leading-7 text-slate-100">
              {value}
            </div>
          )}
          {/* Phase 13.3 — presentation-only: show only the exact text that will be sent. The technical grounding
              facts block, context-provenance chip, match type and stock counts are hidden from the operator
              view (grounding still runs and is enforced server-side; only the display is simplified). */}
          <div className="mt-1 text-[10px] font-bold text-slate-400">{t("aiSupport.inbox.panel.textToSend")} <span className="text-slate-100">{clean(finalText) || "—"}</span></div>
        </div>
        {editing ? <Pill tone="violet" className="shrink-0 px-2 py-0.5 text-[10px] font-black">{t("aiSupport.inbox.panel.editing")}</Pill> : null}
      </div>
      <SuggestionProductToSend
        card={productCard}
        choices={productChoices}
        ambiguous={productAmbiguous}
        colorChoices={colorChoices}
        colorRequired={colorRequired}
        removed={productRemoved}
        deliveryFormat={deliveryFormat}
        instagramDelivery={instagramDelivery}
        recommendationMode={recommendationMode}
        variantOptionsMode={variantOptionsMode}
        recommendationSelectedKeys={recommendationSelectedKeys}
        onToggleRecommendation={onToggleRecommendation}
        onRemove={onRemoveProduct}
        onChange={onChangeProduct}
        onChoose={onChooseProduct}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={editing ? onCancelEdit : onEdit}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-[11px] font-black text-violet-100 transition hover:bg-violet-400/15"
        >
          {editing ? "↩️ إلغاء التعديل" : "✏️ تعديل الرد"}
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={approveDisabled}
          title={approveDisabled ? "اختار لون واحد على الأقل قبل الإرسال" : undefined}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-[11px] font-black text-emerald-100 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-emerald-400/10"
        >
          ✅ {approveLabel}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-200 transition hover:bg-white/[0.08]"
        >
          ❌ تجاهل
        </button>
      </div>
    </div>
  );
}

export default AiSuggestionCard;
export { SuggestionProductToSend };
