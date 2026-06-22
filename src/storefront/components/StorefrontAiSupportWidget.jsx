import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  Camera,
  ChevronLeft,
  ImagePlus,
  MessageCircle,
  MessageCircleMore,
  RefreshCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "../../shared/api/api";

function AiVisualAttachments({ attachments = [], onOpenProduct, helpers }) {
  const { fallbackProductImage, imageFor, money } = helpers;
  const visualAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!visualAttachments.length) return null;

  return (
    <div className="mt-3 space-y-2.5">
      {visualAttachments.map((attachment, sectionIndex) => {
        if (attachment.type === "size_guide") {
          const sizes = Array.isArray(attachment.sizes) ? attachment.sizes.filter(Boolean) : [];
          if (!sizes.length) return null;
          return (
            <div key={`${attachment.type}-${sectionIndex}`} className="rounded-2xl border border-stone-200 bg-white/75 p-3 dark:border-white/10 dark:bg-white/10">
              <div className="text-xs font-black text-stone-700 dark:text-stone-100">{attachment.title || "دليل المقاسات"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sizes.slice(0, 14).map((size) => (
                  <span key={size} className="rounded-full bg-stone-950 px-2.5 py-1 text-[11px] font-black text-white dark:bg-white dark:text-stone-950">{size}</span>
                ))}
              </div>
              {attachment.note ? <p className="mt-2 text-[11px] font-bold leading-5 text-stone-500 dark:text-stone-300">{attachment.note}</p> : null}
            </div>
          );
        }

        if (attachment.url) {
          return (
            <button
              key={`${attachment.type || "image"}-${sectionIndex}`}
              type="button"
              onClick={() => onOpenProduct?.({ id: attachment.product_id, product_url: attachment.product_url, name: attachment.title })}
              className="w-full rounded-2xl border border-stone-200 bg-white/75 p-2 text-right shadow-sm transition hover:-translate-y-0.5 active:scale-[0.99] dark:border-white/10 dark:bg-white/10"
            >
              <img src={imageFor(attachment.url)} onError={fallbackProductImage} alt={attachment.title || "صورة المنتج"} className="aspect-square w-full rounded-xl object-cover" loading="lazy" decoding="async" />
              <span className="mt-2 block truncate text-[11px] font-black text-stone-950 dark:text-white">{attachment.title || "صورة المنتج"}</span>
              {attachment.subtitle ? <span className="mt-0.5 block truncate text-[10px] font-bold text-stone-500 dark:text-stone-300">{attachment.subtitle}</span> : null}
            </button>
          );
        }

        const items = Array.isArray(attachment.items) ? attachment.items.filter((item) => item?.image_url) : [];
        if (!items.length) return null;
        return (
          <div key={`${attachment.type}-${sectionIndex}`} className="rounded-2xl border border-stone-200 bg-white/75 p-2.5 dark:border-white/10 dark:bg-white/10">
            <div className="mb-2 px-1 text-xs font-black text-stone-700 dark:text-stone-100">{attachment.title || "صور مقترحة"}</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {items.slice(0, 8).map((item, index) => (
                <button
                  key={`${item.id || item.product_id || index}`}
                  type="button"
                  onClick={() => onOpenProduct?.({ id: item.product_id || item.id, product_url: item.product_url, name: item.title })}
                  className="min-w-[8.5rem] max-w-[8.5rem] rounded-2xl border border-stone-200 bg-white p-2 text-right shadow-sm transition hover:-translate-y-0.5 active:scale-[0.99] dark:border-white/10 dark:bg-[#080d1a]"
                >
                  <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt={item.title || "صورة المنتج"} className="aspect-square w-full rounded-xl object-cover" loading="lazy" decoding="async" />
                  <span className="mt-2 block truncate text-[11px] font-black text-stone-950 dark:text-white">{item.title || "منتج"}</span>
                  {item.subtitle ? <span className="mt-0.5 block truncate text-[10px] font-bold text-stone-500 dark:text-stone-300">{item.subtitle}</span> : null}
                  <span className="mt-1 flex items-center justify-between gap-1 text-[10px] font-black text-stone-600 dark:text-stone-300">
                    <span>{Number(item.price || 0) > 0 ? money(item.price) : "السعر غير محدد"}</span>
                    <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StorefrontAiSupportWidget({ onAddToCart, helpers }) {
  const {
    AI_SUPPORT_HINT_DISMISSED_KEY,
    aiAvailabilityText,
    aiSuggestedProductImage,
    aiSuggestedProductPriceText,
    aiSuggestedProductUrl,
    cleanDisplayText,
    clearAiProductUiState,
    countAiProductUiCards,
    fallbackProductImage,
    firstDisplayVariant,
    getAiSupportSessionId,
    getProductColorGroups,
    getUnifiedAiReply,
    isAiGreetingOnlyResponse,
    isAiSupportDebugEnabled,
    loadAiSupportContext,
    logImageSearchSuggestedProductRanking,
    mergeAiSupportContext,
    mirrorProductTitle,
    normalizeAiSupportCardContext,
    productFromDetailsResponse,
    resolveRenderedAiImageAnswer,
    resolveStorefrontTenantId,
    saveAiSupportContext,
    sfText,
    storefrontApi,
    textOrEmpty,
    trackAiSupportCartOutcome,
    trackAiSupportClick,
    unifiedReplyActions,
    unifiedReplyImageCards,
    unifiedReplyProductCards,
    unifiedReplyQuickReplies,
    variantColorKey,
    variantColorName,
    variantHasStock,
    whatsappPhone,
  } = helpers;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => []);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showAssistantHint, setShowAssistantHint] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(AI_SUPPORT_HINT_DISMISSED_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const [hasUnreadResponse, setHasUnreadResponse] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const imagePreviewUrlsRef = useRef([]);
  const openRef = useRef(open);
  const sessionId = useMemo(() => getAiSupportSessionId(), [getAiSupportSessionId]);
  const tenantId = useMemo(() => resolveStorefrontTenantId(), [resolveStorefrontTenantId]);
  const [aiSupportContext, setAiSupportContext] = useState(() => loadAiSupportContext(sessionId));

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const dismissAssistantHint = useCallback(() => {
    setShowAssistantHint(false);
    try {
      localStorage.setItem(AI_SUPPORT_HINT_DISMISSED_KEY, "1");
    } catch {
      // Ignore local storage issues.
    }
  }, [AI_SUPPORT_HINT_DISMISSED_KEY]);

  useEffect(() => {
    if (!showAssistantHint) return undefined;
    const timeout = window.setTimeout(dismissAssistantHint, 4500);
    return () => window.clearTimeout(timeout);
  }, [dismissAssistantHint, showAssistantHint]);

  useEffect(() => () => {
    imagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    imagePreviewUrlsRef.current = [];
  }, []);

  useEffect(() => {
    setAiSupportContext(loadAiSupportContext(sessionId));
  }, [loadAiSupportContext, sessionId]);

  useEffect(() => {
    saveAiSupportContext(sessionId, aiSupportContext);
  }, [aiSupportContext, saveAiSupportContext, sessionId]);

  const supportHref = useMemo(() => {
    const text = encodeURIComponent(`محتاج مساعدة من الدعم بخصوص محادثة رقم ${sessionId}`);
    return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${text}` : "/shop/contact";
  }, [sessionId, whatsappPhone]);

  const pushAiSupportContext = useCallback((patch = {}) => {
    setAiSupportContext((current) => mergeAiSupportContext(current, patch));
  }, [mergeAiSupportContext]);

  const submitQuestion = useCallback(async (questionText, options = {}) => {
    if (aiSupportContext.handoff && !options.force) {
      setError(sfText("storefront.aiSupport.handoffActive", "A human is now handling this chat."));
      return;
    }
    const text = cleanDisplayText(questionText || input);
    if (!text || loading || imageLoading) return;
    setInput("");
    setError("");
    setLastQuestion(text);
    setMessages((items) => [...items, { id: `u_${Date.now()}`, role: "user", answer: text }]);
    setLoading(true);
    try {
      const contextualPayload = mergeAiSupportContext(aiSupportContext, options.context || {});
      const response = await api.post(
        "/ai-support/chat",
        {
          message: text,
          customer_message: text,
          session_id: sessionId,
          tenant_id: tenantId,
          metadata: {
            channel: "storefront_chat",
            surface: "shop",
            selected_product_context: contextualPayload.selected_product_context || null,
            selected_product_id: contextualPayload.selected_product_id || "",
            selected_variant_id: contextualPayload.selected_variant_id || "",
            selected_size: contextualPayload.selected_size || "",
            selected_color: contextualPayload.selected_color || "",
            selected_color_key: contextualPayload.selected_color_key || "",
            rejected_product_context: contextualPayload.rejected_product_context || null,
            last_action: contextualPayload.last_action || "",
            handoff: contextualPayload.handoff === true,
            selected_product_cards: contextualPayload.last_shown_product_cards || [],
            selected_image_cards: contextualPayload.last_shown_image_cards || [],
            ...(options.metadata || {}),
          },
        },
        { timeoutMs: 30000, headers: { "x-tenant-id": tenantId } }
      );
      if (isAiSupportDebugEnabled()) {
        console.debug("[storefront-ai] chat response suggested_products", {
          answer: response?.answer,
          detected_intent: response?.detected_intent,
          fallback_reason: response?.fallback_reason,
          suggested_products: response?.suggested_products,
        });
      }
      const unifiedReply = getUnifiedAiReply(response);
      const productCards = unifiedReplyProductCards(response);
      const imageCards = unifiedReplyImageCards(response);
      const quickReplies = unifiedReplyQuickReplies(response);
      const actions = unifiedReplyActions(response);
      pushAiSupportContext({
        last_shown_product_cards: productCards,
        last_shown_image_cards: imageCards,
        last_action: options.metadata?.last_action || contextualPayload.last_action || "",
        handoff: Boolean(unifiedReply?.handoff?.needs_human_support || response?.needs_human_support || contextualPayload.handoff),
      });
      if (isAiSupportDebugEnabled()) {
        console.debug("[storefront-ai] unified reply render payload", {
          channel: response?.channel || "storefront_chat",
          conversation_id: response?.session_id || sessionId,
          inbound_text: text,
          intent: unifiedReply?.intent || response?.detected_intent || "",
          products_count: Array.isArray(unifiedReply?.products) ? unifiedReply.products.length : 0,
          product_cards_count: Array.isArray(productCards) ? productCards.length : 0,
          image_cards_count: Array.isArray(imageCards) ? imageCards.length : 0,
          quick_replies_count: Array.isArray(quickReplies) ? quickReplies.length : 0,
          actions_count: Array.isArray(actions) ? actions.length : 0,
        });
      }
      const isGreetingOnly = isAiGreetingOnlyResponse(response);
      setMessages((items) => {
        const clearedCount = isGreetingOnly ? countAiProductUiCards(items) : 0;
        if (isGreetingOnly) {
          console.debug("[storefront-ai] greeting_only_ui_reset", {
            cleared_product_cards_count: clearedCount,
            detected_intent: response?.detected_intent,
          });
          console.debug("[storefront-ai] cleared_product_cards_count", clearedCount);
        }
        const baseItems = isGreetingOnly ? clearAiProductUiState(items) : items;
        return [
          ...baseItems,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            answer: unifiedReply?.text || response?.answer || "مش قادر أأكد الإجابة من بيانات المتجر حاليا. تواصل مع الدعم لو سمحت.",
            reply_text: unifiedReply?.text || response?.answer || "",
            confidence: Number(response?.confidence || 0),
            needs_human_support: Boolean(response?.needs_human_support),
            detected_intent: response?.detected_intent || "",
            greeting_only_mode: Boolean(response?.greeting_only_mode),
            suggested_products: isGreetingOnly ? [] : productCards,
            visual_attachments: isGreetingOnly ? [] : imageCards,
            unified_reply: isGreetingOnly ? null : unifiedReply,
            product_cards: isGreetingOnly ? [] : productCards,
            image_cards: isGreetingOnly ? [] : imageCards,
            quick_replies: isGreetingOnly ? [] : quickReplies,
            actions: isGreetingOnly ? [] : actions,
            handoff: unifiedReply?.handoff || response?.handoff || null,
            draft_order: unifiedReply?.draft_order || response?.draft_order || null,
          },
        ];
      });
      if (!openRef.current) setHasUnreadResponse(true);
    } catch {
      setError(sfText("storefront.toasts.aiReplyFailed", "There was a problem with the reply. Try again or contact support."));
    } finally {
      setLoading(false);
    }
  }, [aiSupportContext, cleanDisplayText, clearAiProductUiState, countAiProductUiCards, getUnifiedAiReply, imageLoading, input, isAiGreetingOnlyResponse, isAiSupportDebugEnabled, loading, mergeAiSupportContext, pushAiSupportContext, sessionId, sfText, tenantId, unifiedReplyActions, unifiedReplyImageCards, unifiedReplyProductCards, unifiedReplyQuickReplies]);

  const submitImage = useCallback(async (file) => {
    if (!file || loading || imageLoading) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(sfText("storefront.toasts.unsupportedImageType", "Unsupported image type. Use JPG, PNG, or WEBP."));
      toast.error(sfText("storefront.toasts.unsupportedImageType", "Unsupported image type. Use JPG, PNG, or WEBP."));
      return;
    }
    if (file.size <= 0) {
      setError(sfText("storefront.toasts.emptyImage", "The image is empty. Choose a clear image."));
      toast.error(sfText("storefront.toasts.emptyImage", "The image is empty. Choose a clear image."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(sfText("storefront.toasts.imageTooLarge", "The image is too large. Upload a smaller image."));
      toast.error(sfText("storefront.toasts.imageTooLarge", "The image is too large. Upload a smaller image."));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    imagePreviewUrlsRef.current.push(previewUrl);
    setError("");
    setLastQuestion("");
    setMessages((items) => [
      ...items,
      {
        id: `u_img_${Date.now()}`,
        role: "user",
        answer: "دي الصورة اللي بدور على شبهها",
        image_preview: previewUrl,
      },
    ]);
    setImageLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("tenant_id", tenantId);
      formData.append("session_id", sessionId);
      formData.append("metadata", JSON.stringify({ channel: "storefront_chat_image", surface: "shop" }));
      const response = await api.post("/ai-support/image-search", formData, { timeoutMs: 45000, headers: { "x-tenant-id": tenantId } });
      console.debug("[storefront-ai] image-search raw api response before render", response);
      logImageSearchSuggestedProductRanking(response);
      const renderedAnswer = resolveRenderedAiImageAnswer(response);
      console.debug("[storefront-ai] image-search render sync", {
        backend_answer: response?.answer,
        rendered_answer: renderedAnswer,
        exact_match_found: response?.exact_match_found,
        exact_match_variant_id: response?.exact_match_variant_id ?? response?.response_debug?.exact_match_variant_id ?? null,
        final_response_synced_with_variant: response?.final_response_synced_with_variant ?? response?.response_debug?.final_response_synced_with_variant ?? false,
      });
      if (isAiSupportDebugEnabled()) {
        console.debug("[storefront-ai] image-search response", {
          answer: response?.answer,
          fallback_reason: response?.fallback_reason,
          openai_error: response?.openai_error,
          openai_errors: response?.openai_errors,
          exact_match_found: response?.exact_match_found,
          exact_match_reason: response?.exact_match_reason,
          image_ranking_debug: response?.image_ranking_debug,
          response_debug: response?.response_debug,
          suggested_products: response?.suggested_products,
        });
      }
      const unifiedReply = getUnifiedAiReply(response);
      const productCards = unifiedReplyProductCards(response);
      const imageCards = unifiedReplyImageCards(response);
      const quickReplies = unifiedReplyQuickReplies(response);
      const actions = unifiedReplyActions(response);
      pushAiSupportContext({
        last_shown_product_cards: productCards,
        last_shown_image_cards: imageCards,
        last_action: "image_search",
        handoff: Boolean(unifiedReply?.handoff?.needs_human_support || response?.needs_human_support),
      });
      setMessages((items) => [
        ...items,
        {
          id: `a_img_${Date.now()}`,
          role: "assistant",
          answer: unifiedReply?.text || renderedAnswer,
          reply_text: unifiedReply?.text || renderedAnswer,
          confidence: Number(response?.confidence || 0),
          needs_human_support: Boolean(response?.needs_human_support),
          suggested_products: productCards,
          visual_attachments: imageCards,
          unified_reply: unifiedReply,
          product_cards: productCards,
          image_cards: imageCards,
          quick_replies: quickReplies,
          actions,
          handoff: unifiedReply?.handoff || response?.handoff || null,
          draft_order: unifiedReply?.draft_order || response?.draft_order || null,
          detected_style_model: response?.detected_style_model || "",
          image_ranking_debug: response?.image_ranking_debug || null,
          response_debug: response?.response_debug || null,
          exact_match_found: Boolean(response?.exact_match_found),
          exact_match_reason: response?.exact_match_reason || "",
        },
      ]);
      if (!openRef.current) setHasUnreadResponse(true);
    } catch (requestError) {
      console.error("[storefront-ai] image-search request failed", {
        status: requestError?.status,
        message: requestError?.message,
        responseBody: requestError?.responseBody,
        openai_error: requestError?.responseBody?.openai_error,
        openai_errors: requestError?.responseBody?.openai_errors,
      });
      const message =
        requestError?.responseBody?.answer ||
        requestError?.responseBody?.message ||
        (requestError?.message && requestError.message !== "Request Failed" ? requestError.message : "") ||
        "حصلت مشكلة أثناء تحليل الصورة، حاول مرة تانية.";
      setError(message);
      toast.error(message);
    } finally {
      setImageLoading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }, [getUnifiedAiReply, imageLoading, isAiSupportDebugEnabled, loading, logImageSearchSuggestedProductRanking, pushAiSupportContext, resolveRenderedAiImageAnswer, sessionId, sfText, tenantId, unifiedReplyActions, unifiedReplyImageCards, unifiedReplyProductCards, unifiedReplyQuickReplies]);

  const logWebsiteChatEvent = useCallback((eventName, extra = {}) => {
    if (import.meta.env.DEV) {
      console.debug(eventName, {
        channel: "website_chat",
        conversation_id: sessionId,
        provider_message_id: extra.provider_message_id || "",
        tenant_id: tenantId,
        intent: extra.intent || "",
        products_count: Number.isFinite(Number(extra.products_count)) ? Number(extra.products_count) : Number(aiSupportContext.last_shown_product_cards?.length || 0),
        product_cards_count: Number.isFinite(Number(extra.product_cards_count)) ? Number(extra.product_cards_count) : 0,
        image_cards_count: Number.isFinite(Number(extra.image_cards_count)) ? Number(extra.image_cards_count) : 0,
        actions_count: Number.isFinite(Number(extra.actions_count)) ? Number(extra.actions_count) : 0,
        early_return_reason: extra.early_return_reason || "",
        ...extra,
      });
    }
  }, [aiSupportContext.last_shown_product_cards, sessionId, tenantId]);

  const resolveAiSupportProductDetails = useCallback(async (candidateProduct = null) => {
    const normalized = normalizeAiSupportCardContext(candidateProduct);
    if (!normalized) return null;
    if (Array.isArray(normalized.variants) && normalized.variants.length) return normalized;
    const identifier = textOrEmpty(normalized.slug || normalized.id || normalized.product_id || normalized.productId || normalized.product_url || normalized.url);
    if (!identifier) return normalized;
    try {
      const response = await storefrontApi.getProductDetails(identifier, { headers: { "x-tenant-id": tenantId } });
      const product = productFromDetailsResponse(response);
      return product || normalized;
    } catch {
      return normalized;
    }
  }, [normalizeAiSupportCardContext, productFromDetailsResponse, storefrontApi, tenantId, textOrEmpty]);

  const resolveAiSupportVariantSelection = useCallback(async (candidateProduct = null, selection = {}) => {
    const product = await resolveAiSupportProductDetails(candidateProduct);
    if (!product) return { product: null, variant: null, reason: "missing_product" };
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (!variants.length) return { product, variant: null, reason: "missing_variants" };
    const selectedSize = textOrEmpty(selection.selected_size || aiSupportContext.selected_size || product.selected_size || product.size || "");
    const selectedColor = textOrEmpty(selection.selected_color || aiSupportContext.selected_color || product.selected_color || product.color || product.color_name || "");
    const selectedColorKey = textOrEmpty(selection.selected_color_key || aiSupportContext.selected_color_key || product.selected_color_key || product.color_key || "").toLowerCase();
    const requestedVariantId = textOrEmpty(selection.selected_variant_id || aiSupportContext.selected_variant_id || product.selected_variant_id || product.variant_id || product.matched_variant_id || "");
    const availableSizes = [...new Set(variants.filter(variantHasStock).map((variant) => String(variant.size || "").trim()).filter(Boolean))];
    const colorGroups = getProductColorGroups(product);
    if (availableSizes.length > 1 && !selectedSize) return { product, variant: null, reason: "missing_size", availableSizes, colorGroups };
    if (colorGroups.length > 1 && !selectedColor && !selectedColorKey) return { product, variant: null, reason: "missing_color", availableSizes, colorGroups };
    const colorMatchKey = selectedColorKey || selectedColor.toLowerCase();
    const matchedVariant = variants.find((variant) =>
      requestedVariantId && (
        String(variant.id) === String(requestedVariantId) ||
        String(variant.variant_id || "") === String(requestedVariantId) ||
        String(variant.selected_variant_id || "") === String(requestedVariantId) ||
        String(variant.edition_slug || "") === String(requestedVariantId)
      ) && variantHasStock(variant)
    ) || variants.find((variant) =>
      selectedSize &&
      String(variant.size || "").trim() === String(selectedSize).trim() &&
      (selectedColorKey ? variantColorKey(variant) === selectedColorKey : !selectedColor || variantColorName(variant).toLowerCase() === selectedColor.toLowerCase()) &&
      variantHasStock(variant)
    ) || variants.find((variant) =>
      selectedSize &&
      String(variant.size || "").trim() === String(selectedSize).trim() &&
      (!selectedColorKey && !selectedColor)
    ) || variants.find((variant) =>
      colorMatchKey && (variantColorKey(variant) === colorMatchKey || variantColorName(variant).toLowerCase() === colorMatchKey) && variantHasStock(variant)
    ) || firstDisplayVariant(variants);
    return {
      product,
      variant: matchedVariant || null,
      reason: matchedVariant ? "resolved" : "no_variant",
      availableSizes,
      colorGroups,
    };
  }, [aiSupportContext.selected_color, aiSupportContext.selected_color_key, aiSupportContext.selected_size, aiSupportContext.selected_variant_id, firstDisplayVariant, getProductColorGroups, resolveAiSupportProductDetails, textOrEmpty, variantColorKey, variantColorName, variantHasStock]);

  const openProduct = useCallback((product) => {
    const normalizedProduct = normalizeAiSupportCardContext(product);
    trackAiSupportClick({ tenantId, sessionId, productId: normalizedProduct?.id || normalizedProduct?.product_id });
    pushAiSupportContext({
      selected_product_context: normalizedProduct,
      selected_product_id: normalizedProduct?.product_id || normalizedProduct?.id || "",
      selected_variant_id: normalizedProduct?.selected_variant_id || normalizedProduct?.variant_id || "",
      selected_size: normalizedProduct?.selected_size || aiSupportContext.selected_size || "",
      selected_color: normalizedProduct?.selected_color || aiSupportContext.selected_color || "",
      selected_color_key: normalizedProduct?.selected_color_key || aiSupportContext.selected_color_key || "",
      handoff: false,
      last_action: "open_product",
    });
    navigate(aiSuggestedProductUrl(normalizedProduct));
    setOpen(false);
  }, [aiSuggestedProductUrl, aiSupportContext.selected_color, aiSupportContext.selected_color_key, aiSupportContext.selected_size, navigate, normalizeAiSupportCardContext, pushAiSupportContext, sessionId, tenantId, trackAiSupportClick]);

  const handleUnifiedActionClick = useCallback(async (action, context = {}) => {
    const raw = typeof action === "string"
      ? action
      : String(action?.action || action?.type || action?.id || action?.value || action?.label || action?.text || "").trim();
    const key = raw.toLowerCase();
    if (!key) return;

    const product = normalizeAiSupportCardContext(context.product || context.productCard || context.selectedProduct || context.card || null);
    const sizeFromAction = textOrEmpty(action?.size || action?.size_value || action?.value || action?.label || action?.text || context.size || context.selected_size || "").replace(/\s+/g, " ");
    const colorFromAction = textOrEmpty(action?.color || action?.color_value || action?.value || action?.label || action?.text || context.color || context.selected_color || "");
    const explicitSizeValue = /^\d{1,2}(?:\.\d)?$/.test(sizeFromAction || raw);
    const knownColorValues = ["black", "white", "gray", "grey", "red", "blue", "green", "beige", "brown", "pink", "yellow", "orange", "purple", "اسود", "أبيض", "ابيض", "رمادي", "احمر", "أحمر", "ازرق", "أزرق", "اخضر", "أخضر", "بيج", "بني", "وردي", "اصفر", "أصفر", "برتقالي", "بنفسجي"];
    const explicitColorValue = knownColorValues.some((value) => {
      const candidate = colorFromAction.toLowerCase();
      const target = String(value || "").toLowerCase();
      return candidate === target || candidate.includes(target) || target.includes(candidate);
    });
    const isSizeAction = ["choose_size", "select_size", "ask_size"].includes(key) || explicitSizeValue;
    const isColorAction = ["choose_color", "select_color", "ask_color"].includes(key) || explicitColorValue;
    const messageContext = {
      selected_product_context: product || aiSupportContext.selected_product_context || null,
      selected_product_id: product?.product_id || product?.id || aiSupportContext.selected_product_id || "",
      selected_variant_id: product?.selected_variant_id || product?.variant_id || aiSupportContext.selected_variant_id || "",
      selected_size: sizeFromAction || aiSupportContext.selected_size || "",
      selected_color: colorFromAction || aiSupportContext.selected_color || "",
      selected_color_key: textOrEmpty(action?.color_key || action?.selected_color_key || context.color_key || aiSupportContext.selected_color_key || "").toLowerCase(),
      rejected_product_context: aiSupportContext.rejected_product_context || null,
      last_action: key,
      handoff: aiSupportContext.handoff === true,
      last_shown_product_cards: aiSupportContext.last_shown_product_cards || [],
      last_shown_image_cards: aiSupportContext.last_shown_image_cards || [],
    };

    logWebsiteChatEvent("WEBSITE_CHAT_ACTION_CLICKED", {
      intent: key,
      products_count: Array.isArray(aiSupportContext.last_shown_product_cards) ? aiSupportContext.last_shown_product_cards.length : 0,
      product_cards_count: Array.isArray(aiSupportContext.last_shown_product_cards) ? aiSupportContext.last_shown_product_cards.length : 0,
      image_cards_count: Array.isArray(aiSupportContext.last_shown_image_cards) ? aiSupportContext.last_shown_image_cards.length : 0,
      actions_count: Array.isArray(action?.actions) ? action.actions.length : 0,
      selected_product_id: messageContext.selected_product_id,
      selected_variant_id: messageContext.selected_variant_id,
      selected_size: messageContext.selected_size,
      selected_color: messageContext.selected_color,
    });

    if (["choose_size", "select_size", "ask_size"].includes(key) || isSizeAction) {
      const selectedSize = explicitSizeValue ? (sizeFromAction || raw) : (context.size || context.selected_size || aiSupportContext.selected_size || "");
      pushAiSupportContext({ ...messageContext, selected_size: selectedSize, last_action: "choose_size" });
      await submitQuestion(selectedSize || "عايز مقاس", {
        metadata: {
          last_action: "choose_size",
          selected_size: selectedSize,
          selected_product_context: messageContext.selected_product_context,
          selected_product_id: messageContext.selected_product_id,
          selected_color: messageContext.selected_color,
        },
        context: { ...messageContext, selected_size: selectedSize },
      });
      return;
    }
    if (["choose_color", "select_color", "ask_color"].includes(key) || isColorAction) {
      const selectedColor = explicitColorValue ? (colorFromAction || raw) : (context.color || context.selected_color || aiSupportContext.selected_color || "");
      pushAiSupportContext({ ...messageContext, selected_color: selectedColor, last_action: "choose_color" });
      await submitQuestion(selectedColor || "الألوان المتاحة؟", {
        metadata: {
          last_action: "choose_color",
          selected_color: selectedColor,
          selected_product_context: messageContext.selected_product_context,
          selected_product_id: messageContext.selected_product_id,
          selected_size: messageContext.selected_size,
        },
        context: { ...messageContext, selected_color: selectedColor },
      });
      return;
    }
    if (["ask_for_more_images", "show_more_images", "more_images"].includes(key)) {
      pushAiSupportContext({ ...messageContext, last_action: "more_images" });
      await submitQuestion("صور أكتر", {
        metadata: {
          last_action: "more_images",
          selected_product_context: messageContext.selected_product_context,
          selected_product_id: messageContext.selected_product_id,
          selected_size: messageContext.selected_size,
          selected_color: messageContext.selected_color,
        },
        context: messageContext,
      });
      return;
    }
    if (["show_alternatives", "alternatives", "similar_products"].includes(key)) {
      pushAiSupportContext({ ...messageContext, rejected_product_context: messageContext.selected_product_context || messageContext.rejected_product_context || null, last_action: "show_alternatives" });
      await submitQuestion("مش عاجبني، وريني بدائل", {
        metadata: {
          last_action: "show_alternatives",
          selected_product_context: messageContext.selected_product_context,
          rejected_product_context: messageContext.selected_product_context || messageContext.rejected_product_context || null,
          selected_size: messageContext.selected_size,
          selected_color: messageContext.selected_color,
        },
        context: messageContext,
      });
      return;
    }
    if (["escalate_to_human", "human_handoff", "handoff", "contact_support"].includes(key)) {
      logWebsiteChatEvent("WEBSITE_CHAT_HANDOFF_TRIGGERED", { intent: "human_handoff", early_return_reason: "website_handoff_requested" });
      pushAiSupportContext({ ...messageContext, handoff: true, last_action: "escalate_to_human" });
      await submitQuestion("كلم بني آدم", {
        force: true,
        metadata: {
          last_action: "escalate_to_human",
          conversation_status: "human_takeover",
          handoff_requested: true,
          selected_product_context: messageContext.selected_product_context,
          selected_product_id: messageContext.selected_product_id,
        },
        context: { ...messageContext, handoff: true },
      });
      window.open(supportHref, "_blank", "noreferrer");
      return;
    }
    if (["add_to_cart", "buy_now", "buy_now_action", "checkout", "order_now"].includes(key)) {
      const selection = await resolveAiSupportVariantSelection(product || messageContext.selected_product_context, messageContext);
      if (!selection.product) {
        logWebsiteChatEvent("WEBSITE_CHAT_ACTION_FALLBACK", { intent: key, early_return_reason: "missing_product_context" });
        await submitQuestion("عايز أشتري", { metadata: { last_action: key, ...messageContext }, context: messageContext });
        return;
      }
      if (selection.reason === "missing_size") {
        logWebsiteChatEvent("WEBSITE_CHAT_ACTION_FALLBACK", { intent: key, early_return_reason: "missing_size" });
        await submitQuestion("عايز مقاس كام؟", {
          metadata: {
            last_action: key,
            selected_product_context: selection.product,
            selected_product_id: selection.product?.id || selection.product?.product_id || "",
            selected_color: messageContext.selected_color,
            selected_color_key: messageContext.selected_color_key,
          },
          context: { ...messageContext, selected_product_context: selection.product },
        });
        return;
      }
      if (selection.reason === "missing_color") {
        logWebsiteChatEvent("WEBSITE_CHAT_ACTION_FALLBACK", { intent: key, early_return_reason: "missing_color" });
        await submitQuestion("أي لون تفضل؟", {
          metadata: {
            last_action: key,
            selected_product_context: selection.product,
            selected_product_id: selection.product?.id || selection.product?.product_id || "",
            selected_size: messageContext.selected_size,
          },
          context: { ...messageContext, selected_product_context: selection.product },
        });
        return;
      }
      const resolvedProduct = selection.product;
      const resolvedVariant = selection.variant;
      if (!resolvedVariant) {
        logWebsiteChatEvent("WEBSITE_CHAT_ACTION_FALLBACK", { intent: key, early_return_reason: selection.reason || "variant_resolution_failed" });
        await submitQuestion("مش قادر أحدد النسخة المناسبة دلوقتي، جرب مرة تانية أو ابعت صورة أوضح.", {
          metadata: { last_action: key, selected_product_context: resolvedProduct },
          context: { ...messageContext, selected_product_context: resolvedProduct },
        });
        return;
      }
      logWebsiteChatEvent("WEBSITE_CHAT_VARIANT_RESOLVED", {
        intent: key,
        selected_product_id: resolvedProduct?.id || resolvedProduct?.product_id || "",
        selected_variant_id: resolvedVariant?.id || resolvedVariant?.variant_id || "",
        selected_size: resolvedVariant?.size || messageContext.selected_size || "",
        selected_color: resolvedVariant?.color || resolvedVariant?.color_name || messageContext.selected_color || "",
      });
      pushAiSupportContext({
        selected_product_context: resolvedProduct,
        selected_product_id: resolvedProduct?.id || resolvedProduct?.product_id || "",
        selected_variant_id: resolvedVariant?.id || resolvedVariant?.variant_id || "",
        selected_size: resolvedVariant?.size || messageContext.selected_size || "",
        selected_color: resolvedVariant?.color || resolvedVariant?.color_name || messageContext.selected_color || "",
        selected_color_key: variantColorKey(resolvedVariant),
        last_action: key,
      });
      const result = onAddToCart(resolvedProduct, resolvedVariant, 1);
      if (result === "capture_required") {
        logWebsiteChatEvent("WEBSITE_CHAT_ACTION_FALLBACK", { intent: key, early_return_reason: "customer_capture_required" });
        await submitQuestion("لازم أولًا أراجع بياناتك قبل ما أكمل الإضافة للسلة.", {
          force: true,
          metadata: {
            last_action: key,
            selected_product_context: resolvedProduct,
            selected_variant_id: resolvedVariant?.id || resolvedVariant?.variant_id || "",
          },
          context: { ...messageContext, selected_product_context: resolvedProduct, selected_variant_id: resolvedVariant?.id || resolvedVariant?.variant_id || "" },
        });
        return;
      }
      if (result === "added") {
        trackAiSupportCartOutcome({ tenantId, sessionId, productId: resolvedProduct?.id || resolvedProduct?.product_id || "" });
        logWebsiteChatEvent("WEBSITE_CHAT_ADD_TO_CART_SUCCESS", {
          intent: key,
          selected_product_id: resolvedProduct?.id || resolvedProduct?.product_id || "",
          selected_variant_id: resolvedVariant?.id || resolvedVariant?.variant_id || "",
          selected_size: resolvedVariant?.size || messageContext.selected_size || "",
          selected_color: resolvedVariant?.color || resolvedVariant?.color_name || messageContext.selected_color || "",
        });
        const confirmationText = `تمام، ضفت ${cleanDisplayText(mirrorProductTitle(resolvedProduct, resolvedVariant) || resolvedProduct.name || "المنتج")} ${resolvedVariant?.size ? `مقاس ${resolvedVariant.size}` : ""}${resolvedVariant?.color ? ` - ${resolvedVariant.color}` : ""} للسلة.`;
        setMessages((items) => [
          ...items,
          {
            id: `a_cart_${Date.now()}`,
            role: "assistant",
            answer: confirmationText,
            reply_text: confirmationText,
            confidence: 1,
            needs_human_support: false,
            detected_intent: "cart_confirmation",
            handoff: null,
            draft_order: null,
          },
        ]);
      }
      if (["buy_now", "buy_now_action", "checkout", "order_now"].includes(key)) {
        navigate("/shop/checkout");
      }
      return;
    }

    if (raw.length && raw.length <= 64) {
      await submitQuestion(raw, { context: messageContext, metadata: { last_action: key } });
    }
  }, [aiSupportContext, cleanDisplayText, logWebsiteChatEvent, mirrorProductTitle, navigate, normalizeAiSupportCardContext, onAddToCart, pushAiSupportContext, resolveAiSupportVariantSelection, sessionId, submitQuestion, supportHref, tenantId, textOrEmpty, trackAiSupportCartOutcome, variantColorKey]);

  const handleImageInputChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) submitImage(file);
  }, [submitImage]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type?.startsWith("image/"));
    if (file) submitImage(file);
  }, [submitImage]);

  const openAssistant = useCallback(() => {
    dismissAssistantHint();
    setHasUnreadResponse(false);
    setOpen(true);
  }, [dismissAssistantHint]);

  return (
    <section dir="rtl" className={`sf-ai-chat ${open ? "sf-ai-chat--open" : "sf-ai-chat--collapsed"}`} aria-label={t("storefront.aiSupport.aria", "Smart store assistant")}>
      {open ? (
        <div
          className={`sf-ai-chat-panel flex flex-col overflow-hidden rounded-[1.55rem] border bg-white/96 text-stone-950 shadow-[0_24px_70px_rgba(39,20,75,0.24)] backdrop-blur-2xl dark:bg-[#080d1a]/96 dark:text-stone-100 ${dragActive ? "border-[#d4af37] ring-4 ring-[#d4af37]/20" : "border-white/70 dark:border-white/10"}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) setDragActive(false);
          }}
          onDrop={handleDrop}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200/70 bg-gradient-to-l from-stone-950 via-[#111827] to-[#d4af37] px-3.5 py-3 text-white dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/15 shadow-inner">
                <Sparkles className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black">{t("storefront.aiSupport.title", "Store assistant")}</p>
                <p className="truncate text-[11px] font-bold text-white/70">{t("storefront.aiSupport.subtitle", "Answers from store data only")}</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-95" aria-label={t("storefront.aiSupport.closeChat", "Close chat")}>
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[#f7f4ee] px-3 py-3.5 dark:bg-[#070b16]">
            {messages.map((message) => (
              <div key={message.id} className={`sf-ai-chat-message-row flex ${message.role === "user" ? "sf-ai-chat-message-row--user justify-end" : "sf-ai-chat-message-row--assistant justify-start"}`}>
                <div className={`sf-ai-chat-bubble max-w-[82%] rounded-[1.35rem] px-3.5 py-2.5 text-[13px] font-bold leading-6 shadow-sm sm:max-w-[86%] ${message.role === "user" ? "sf-ai-chat-bubble--user rounded-tl-md" : "sf-ai-chat-bubble--assistant rounded-tr-md"}`}>
                  <p className="whitespace-pre-wrap break-words">{message.unified_reply?.text || message.reply_text || message.answer}</p>
                  {message.role === "assistant" && message.unified_reply ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone-500 dark:text-stone-300">
                      {message.unified_reply.intent ? <span className="rounded-full bg-white/70 px-2 py-1 dark:bg-white/10">Intent: {message.unified_reply.intent}</span> : null}
                      {Number.isFinite(Number(message.unified_reply.confidence)) ? <span className="rounded-full bg-white/70 px-2 py-1 dark:bg-white/10">Confidence: {Math.round(Number(message.unified_reply.confidence) * 100)}%</span> : null}
                    </div>
                  ) : null}
                  {message.image_preview ? <img src={message.image_preview} alt={t("storefront.aiSupport.uploadedImageAlt", "Uploaded image")} className="mt-2 max-h-44 w-full rounded-2xl object-cover ring-1 ring-white/30" /> : null}
                  {message.role === "assistant" && message.detected_style_model ? <p className="mt-2 rounded-2xl bg-white/60 px-3 py-2 text-[11px] font-black text-stone-600 dark:bg-white/10 dark:text-stone-200">{message.detected_style_model}</p> : null}
                  {message.role === "assistant" && Array.isArray(message.suggested_products) && message.suggested_products.length > 0 && !Array.isArray(message.product_cards) ? (
                    <div className="mt-3 grid gap-2">
                      {message.suggested_products.slice(0, 3).map((product, index) => (
                        <button key={`${product.id || product.sku || index}`} type="button" onClick={() => openProduct(product)} className="sf-ai-product-card flex min-w-0 items-center gap-2.5 rounded-2xl border p-2 text-right transition hover:-translate-y-0.5 active:scale-[0.99]">
                          <img src={aiSuggestedProductImage(product)} onError={fallbackProductImage} alt={product.name || t("storefront.aiSupport.suggestedProduct", "Suggested product")} className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-black">{product.name || t("storefront.aiSupport.suggestedProduct", "Suggested product")}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-stone-500 dark:text-stone-300">
                              <span>{aiSuggestedProductPriceText(product)}</span>
                              <span className={product.stock_status === "in_stock" || Number(product.total_stock || product.stock || 0) > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>{aiAvailabilityText(product)}</span>
                            </span>
                          </span>
                          <ChevronLeft className="h-4 w-4 text-stone-400" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.role === "assistant" ? (
                    <div className="mt-3 space-y-3">
                      {Array.isArray(message.product_cards) && message.product_cards.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {message.product_cards.slice(0, 3).map((product, index) => (
                            <button key={`product-card-${product.id || product.product_id || index}`} type="button" onClick={() => openProduct(product)} className="sf-ai-product-card flex min-w-0 gap-3 rounded-3xl border border-stone-200 bg-white/80 p-2.5 text-right transition hover:-translate-y-0.5 active:scale-[0.99] dark:border-white/10 dark:bg-white/5">
                              <img src={aiSuggestedProductImage(product)} onError={fallbackProductImage} alt={product.name || t("storefront.aiSupport.suggestedProduct", "Suggested product")} className="h-20 w-20 shrink-0 rounded-2xl object-cover" loading="lazy" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-black">{product.name || t("storefront.aiSupport.suggestedProduct", "Suggested product")}</span>
                                <span className="mt-1 block text-[11px] font-bold text-stone-500 dark:text-stone-300">{product.reason || product.match_reason || product.top_rank_reason || product.subtitle || ""}</span>
                                <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-stone-500 dark:text-stone-300">
                                  <span>{aiSuggestedProductPriceText(product)}</span>
                                  <span className={product.stock_status === "in_stock" || Number(product.total_stock || product.stock || 0) > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>{aiAvailabilityText(product)}</span>
                                </span>
                              </span>
                              <ChevronLeft className="h-4 w-4 shrink-0 text-stone-400" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {Array.isArray(message.image_cards) && message.image_cards.length > 0 ? <AiVisualAttachments attachments={message.image_cards} onOpenProduct={openProduct} helpers={helpers} /> : null}
                      {!Array.isArray(message.image_cards) && Array.isArray(message.visual_attachments) && message.visual_attachments.length > 0 ? <AiVisualAttachments attachments={message.visual_attachments} onOpenProduct={openProduct} helpers={helpers} /> : null}
                      {Array.isArray(message.quick_replies) && message.quick_replies.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {message.quick_replies.slice(0, 6).map((item, index) => {
                            const label = String(item?.label || item?.text || item?.title || item || "").trim();
                            if (!label) return null;
                            return (
                              <button
                                key={`quick-reply-${label}-${index}`}
                                type="button"
                                onClick={() => handleUnifiedActionClick(item, { product: message.product_cards?.[0] || message.suggested_products?.[0] || aiSupportContext.selected_product_context || null })}
                                className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 transition hover:-translate-y-0.5 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {Array.isArray(message.actions) && message.actions.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {message.actions.slice(0, 6).map((item, index) => {
                            const value = typeof item === "string" ? item : item?.label || item?.text || item?.title || item?.action || item?.type || "";
                            const key = String(value || "").trim();
                            if (!key) return null;
                            return (
                              <button
                                key={`action-${key}-${index}`}
                                type="button"
                                onClick={() => handleUnifiedActionClick(item, { product: message.product_cards?.[0] || message.suggested_products?.[0] || aiSupportContext.selected_product_context || null })}
                                className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-right text-[11px] font-black text-stone-700 transition hover:-translate-y-0.5 hover:border-[#d4af37]/45 hover:bg-[#f8e7b3]/10 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
                              >
                                {key}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.needs_human_support ? (
                    <a href={supportHref} target={whatsappPhone ? "_blank" : undefined} rel={whatsappPhone ? "noreferrer" : undefined} className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-emerald-900/20 transition hover:-translate-y-0.5">
                      <MessageCircle className="h-4 w-4" />
                      {t("storefront.aiSupport.contactSupport", "Contact support")}
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            {(loading || imageLoading) ? (
              <div className="flex justify-end">
                <div className="inline-flex max-w-[82%] items-center gap-2 rounded-[1.35rem] border border-stone-200 bg-white px-3.5 py-2.5 text-[13px] font-bold text-stone-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                  {imageLoading ? t("storefront.aiSupport.analyzingImage", "Analyzing image...") : t("storefront.aiSupport.checkingStore", "Checking store data...")}
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="rounded-3xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:border-rose-400/20 dark:bg-rose-950/30 dark:text-rose-200">
                <p>{error}</p>
                <button type="button" onClick={() => submitQuestion(lastQuestion)} className="mt-2 inline-flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-black text-white">
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t("common.retry", "Retry")}
                </button>
              </div>
            ) : null}
          </div>
          <div className="sf-ai-chat-composer shrink-0 border-t border-stone-200 bg-white px-3 pb-[calc(0.8rem+env(safe-area-inset-bottom))] pt-3 dark:border-white/10 dark:bg-[#080d1a]">
            <form className="sf-ai-chat-composer-row grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); submitQuestion(input); }}>
              <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={loading || imageLoading} className="sf-ai-chat-attach-button inline-grid place-items-center rounded-full transition active:scale-95 disabled:cursor-not-allowed" aria-label={t("storefront.aiSupport.openCamera", "Open camera")}>
                <Camera className="h-4 w-4" />
                <span className="hidden md:inline">{t("storefront.aiSupport.camera", "Camera")}</span>
              </button>
              <button type="button" onClick={() => galleryInputRef.current?.click()} disabled={loading || imageLoading} className="sf-ai-chat-attach-button inline-grid place-items-center rounded-full transition active:scale-95 disabled:cursor-not-allowed" aria-label={t("storefront.aiSupport.chooseGalleryImage", "Choose image from gallery")}>
                <ImagePlus className="h-4 w-4" />
                <span className="hidden md:inline">{t("storefront.aiSupport.gallery", "Gallery")}</span>
              </button>
              <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={handleImageInputChange} />
              <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageInputChange} />
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("storefront.aiSupport.inputPlaceholder", "Type your question here...")} disabled={imageLoading} className="sf-ai-chat-input h-12 min-w-0 rounded-full border px-4 text-sm font-bold outline-none transition" />
              <button type="submit" disabled={loading || imageLoading || !cleanDisplayText(input)} className="sf-ai-chat-send grid h-12 w-12 shrink-0 place-items-center rounded-full shadow-lg transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed" aria-label={t("common.send", "Send")}>
                <Send className="h-[18px] w-[18px]" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          {showAssistantHint ? <button type="button" onClick={openAssistant} className="sf-ai-chat-hint" aria-label={t("storefront.aiSupport.openAssistant", "Open AI shopping assistant")}>{t("storefront.aiSupport.hint", "Ask about size or model")} ✨</button> : null}
          <button type="button" onClick={openAssistant} className="sf-ai-chat-launcher group" aria-label={t("storefront.aiSupport.openAssistant", "Open AI shopping assistant")}>
            <span className="sf-ai-chat-launcher__halo" aria-hidden="true" />
            <span className="sf-ai-chat-launcher__icon">
              <Sparkles className="sf-ai-chat-launcher__sparkle" aria-hidden="true" />
              <MessageCircleMore className="sf-ai-chat-launcher__message" aria-hidden="true" />
            </span>
            <span className="hidden text-right md:block">
              <span className="block text-sm font-black">{t("storefront.aiSupport.askAssistant", "Ask assistant")}</span>
              <span className="block text-[11px] font-bold opacity-70">{t("storefront.aiSupport.launcherSubtitle", "Prices, sizes, and policies")}</span>
            </span>
            {hasUnreadResponse ? <span className="sf-ai-chat-unread" aria-hidden="true" /> : null}
          </button>
        </>
      )}
    </section>
  );
}
