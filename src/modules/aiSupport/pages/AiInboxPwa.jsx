import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Bot,
  Camera,
  CheckCheck,
  ChevronLeft,
  Clock3,
  Download,
  Globe,
  Image,
  Layers3,
  Loader2,
  MessageCircleMore,
  MoreHorizontal,
  PackagePlus,
  Search,
  Send,
  ShieldBan,
  ShoppingBag,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { VirtualList } from "../../../shared/components/VirtualList";
import { formatCurrency } from "../../../shared/lib/currency";
import { getPosSellableProducts } from "../../pos/services/posProductsApi";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const money = (value) => formatCurrency(Number(value || 0));
const normalizeKey = (value = "") => clean(value).toLowerCase();

const getVariantRows = (product = {}) => [
  ...(Array.isArray(product.variants) ? product.variants : []),
  ...(Array.isArray(product.product_variants) ? product.product_variants : []),
  ...(Array.isArray(product.productVariants) ? product.productVariants : []),
  ...(Array.isArray(product.variantRows) ? product.variantRows : []),
  ...(Array.isArray(product.variant_options) ? product.variant_options : []),
].filter(Boolean);

const tenantIdFromAuth = () => {
  const tenant = getCurrentTenant?.() || {};
  const user = getCurrentUser?.() || {};
  return String(user.tenant_id || user.tenantId || tenant.id || tenant.tenant_id || "1");
};

const encodeConversationId = (value = "") => {
  const raw = clean(value);
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch {
    return encodeURIComponent(raw);
  }
};

const aiInboxConversationEndpoint = (sessionId = "", suffix = "") =>
  `/ai-inbox/conversations/${encodeConversationId(sessionId)}${suffix}`;
const aiAgentInboxEndpoint = (sessionId = "", suffix = "") =>
  `/ai-agent/inbox/${encodeConversationId(sessionId)}${suffix}`;

const normalizeConversationChannel = (conversation = {}) => {
  const raw = clean(
    conversation.channel ||
      conversation.source ||
      conversation.provider ||
      conversation.platform ||
      ""
  ).toLowerCase();
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("instagram_comment")) return "instagram_comment";
  if (raw.includes("facebook_comment")) return "facebook_comment";
  if (raw.includes("instagram")) return "instagram";
  if (raw.includes("facebook") || raw.includes("messenger")) return "messenger";
  if (raw.includes("web")) return "web";
  return raw || "unknown";
};

const conversationKey = (conversation = {}) =>
  `${normalizeConversationChannel(conversation)}:${clean(
    conversation.session_id || conversation.conversation_id || conversation.id
  )}`;

const normalizeProductCardsValue = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") return [value];
  return [];
};

const isConversationAiEnabled = (conversation = {}) => conversation?.ai_enabled !== false;

const needsHumanAttention = (conversation = {}) =>
  conversation?.human_takeover === true ||
  conversation?.ai_paused === true ||
  conversation?.conversation_status === "human_takeover" ||
  conversation?.needs_human_support === true ||
  Boolean(clean(conversation?.escalation_reason || conversation?.ai_escalation_reason));

const conversationUnreadCount = (conversation = {}) =>
  Number(
    conversation.unread_count ??
      conversation.unseen_count ??
      conversation.pending_count ??
      conversation.unread ??
      0
  ) || 0;

const conversationLastActivityTime = (conversation = {}) =>
  new Date(conversation.last_activity_at || conversation.updated_at || 0).getTime() || 0;

const applyLocalReadState = (conversation = {}, readAtByConversation = {}) => {
  const key = conversation.conversation_key || conversationKey(conversation);
  const readAt = readAtByConversation[key];
  if (!readAt) return conversation;

  const readTime = new Date(readAt).getTime() || 0;
  if (conversationLastActivityTime(conversation) > readTime) return conversation;

  return {
    ...conversation,
    unread_count: 0,
    unseen_count: 0,
    pending_count: 0,
    unread: false,
  };
};

const relativeTime = (value) => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 1) return "Now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
};

const relativeSeenLabel = (value) => {
  const label = relativeTime(value);
  return label ? `Last seen ${label}` : "No recent activity";
};

const absoluteTime = (value) => {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  return time.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const messageKey = (message = {}) =>
  String(
    message.dedupe_key ||
      message.external_message_id ||
      message.id ||
      `${message.sender_type || ""}:${message.created_at || ""}:${message.customer_message || message.ai_answer || message.staff_message || ""}`
  );

const uniqueMessages = (messages = []) => {
  const seen = new Set();
  return asArray(messages).filter((message) => {
    const key = messageKey(message);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const channelMeta = (value = "") => {
  const key = normalizeConversationChannel({ channel: value });
  if (key === "whatsapp") return { label: "WhatsApp", icon: MessageCircleMore, tone: "text-emerald-600" };
  if (key === "instagram" || key === "instagram_comment") return { label: "Instagram", icon: Camera, tone: "text-rose-500" };
  if (key === "messenger" || key === "facebook_comment") return { label: "Messenger", icon: MessageCircleMore, tone: "text-blue-600" };
  return { label: "Web", icon: Globe, tone: "text-slate-500" };
};

const conversationName = (conversation = {}) =>
  clean(
    conversation.customer_name ||
      conversation.customer?.name ||
      conversation.customer_profile?.name ||
      conversation.customer_profile?.full_name ||
      [conversation.first_name, conversation.last_name].filter(Boolean).join(" ") ||
      conversation.external_customer_id ||
      conversation.phone ||
      "Customer"
  );

const productImage = (card = {}) =>
  clean(
    card.image_url ||
      card.product_image_url ||
      card.variant_image_url ||
      card.image ||
      card.thumbnail_url ||
      ""
  );

const customerAvatarUrl = (conversation = {}) =>
  clean(
    conversation.customer_avatar_url ||
      conversation.profile_pic_url ||
      conversation.profile_pic ||
      conversation.avatar_url ||
      conversation.customer_profile?.customer_avatar_url ||
      conversation.customer_profile?.avatar_url ||
      conversation.customer_profile?.profile_pic_url ||
      conversation.customer_profile?.profile_pic ||
      conversation.channel_metadata?.profile_pic ||
      conversation.channel_metadata?.messenger_profile?.profile_pic
  );

const conversationPreview = (conversation = {}) => {
  const latestCards = normalizeProductCardsValue(
    conversation.last_product_cards ||
      conversation.latest_product_cards ||
      conversation.channel_metadata?.last_product_cards
  );
  const preview = clean(
    conversation.latest_message_preview ||
      conversation.last_message_preview ||
      conversation.latest_message ||
      conversation.last_message ||
      conversation.last_customer_message ||
      conversation.customer_message_preview
  );
  if (preview) return preview;
  if (latestCards.length) return productCardPreviewText(latestCards) || "Product card sent";
  const latestMessage = [...uniqueMessages(conversation.messages)].reverse().find((message) =>
    clean(message.customer_message || message.staff_message || message.ai_answer)
  );
  return clean(
    latestMessage?.customer_message ||
      latestMessage?.staff_message ||
      latestMessage?.ai_answer ||
      ""
  );
};

const productUrl = (card = {}) => {
  const raw = clean(card.product_url || card.storefront_url || card.url || "");
  if (raw) return raw;
  const productId = card.product_id || card.id || "";
  if (!productId) return "";
  return `/shop/product/${encodeURIComponent(productId)}`;
};

const buildProductCardUrl = (product = {}, variant = null, selectedColor = "") => {
  const productId = product.product_id ?? product.id ?? "";
  if (!productId) return "";

  const baseUrl = `/shop/product/${encodeURIComponent(productId)}`;
  const color = clean(selectedColor).toLowerCase();
  if (!color) return baseUrl;

  const variantId = clean(variant?.id ?? "");
  if (!variantId) return `${baseUrl}?color=${encodeURIComponent(color)}`;

  return `${baseUrl}?variant=${encodeURIComponent(variantId)}&color=${encodeURIComponent(color)}`;
};

const productCardPreviewText = (cards = []) => {
  const first = asArray(cards)[0] || {};
  const name = clean(first.product_name || first.name || first.title || "");
  const color = clean(first.color || "");
  const size = clean(first.size || "");
  const price = Number(first.price ?? first.final_price ?? 0);
  return [name, color, size, price > 0 ? money(price) : ""].filter(Boolean).join(" - ");
};

const buildProductCardPayload = (product = {}, variant = null, selectedColor = "") => ({
  product_id: product.product_id ?? product.id ?? null,
  variant_id: variant?.variant_id ?? variant?.id ?? null,
  product_name: clean(product.name || product.product_name || product.title || ""),
  image_url: clean(
    variant?.image_url ||
      variant?.variant_image_url ||
      variant?.image ||
      product.product_image_url ||
      product.image_url ||
      product.image ||
      ""
  ),
  price: Number(
    variant?.price ??
      variant?.final_price ??
      variant?.regular_price ??
      product.final_price ??
      product.price ??
      0
  ) || 0,
  color: clean(selectedColor || variant?.color || variant?.color_name || ""),
  size: clean(variant?.size || variant?.size_name || ""),
  product_url: buildProductCardUrl(product, variant, selectedColor),
  storefront_url: buildProductCardUrl(product, variant, selectedColor),
});

const productColors = (product = {}) =>
  [...new Set(
    getVariantRows(product)
      .flatMap((variant) => [
        clean(variant.color || variant.color_name || variant.variant_color || variant.selected_color),
        clean(variant.variant?.color || variant.variant?.color_name || ""),
        clean(product.color || product.color_name || product.variant_color || ""),
      ])
      .filter(Boolean)
  )];

const productSizes = (product = {}, color = "") => {
  const normalizedColor = normalizeKey(color);
  return [
    ...new Set(
      getVariantRows(product)
        .filter((variant) => {
          if (!normalizedColor) return true;
          return normalizeKey(variant.color || variant.color_name || variant.variant_color || variant.selected_color) === normalizedColor;
        })
        .flatMap((variant) => [
          clean(variant.size || variant.size_name || variant.variant_size || variant.selected_size),
          clean(variant.variant?.size || variant.variant?.size_name || ""),
          clean(product.size || product.size_name || product.variant_size || ""),
        ])
        .filter(Boolean)
    ),
  ];
};

const findVariant = (product = {}, color = "", size = "") => {
  const normalizedColor = normalizeKey(color);
  const normalizedSize = normalizeKey(size);
  const variants = getVariantRows(product);
  return (
    variants.find((variant) => {
      const variantColor = normalizeKey(variant.color || variant.color_name || variant.variant_color || variant.selected_color);
      const variantSize = normalizeKey(variant.size || variant.size_name || variant.variant_size || variant.selected_size);
      const colorMatch = !normalizedColor || variantColor === normalizedColor;
      const sizeMatch = !normalizedSize || variantSize === normalizedSize;
      return colorMatch && sizeMatch;
    }) ||
    variants.find((variant) => normalizeKey(variant.color || variant.color_name || variant.variant_color || variant.selected_color) === normalizedColor) ||
    variants.find((variant) => normalizeKey(variant.size || variant.size_name || variant.variant_size || variant.selected_size) === normalizedSize) ||
    variants[0] ||
    null
  );
};

const resolveLeadStage = (conversation = {}) => {
  const temperature = clean(
    conversation.lead_temperature ||
      conversation.lead_metadata?.lead_temperature ||
      conversation.lead?.lead_temperature
  ).toLowerCase();
  const action = clean(
    conversation.recommended_sales_action ||
      conversation.lead_metadata?.recommended_sales_action ||
      conversation.lead?.recommended_sales_action
  ).toLowerCase();
  const draftCount = asArray(conversation.draft_orders).length;
  const status = clean(conversation.conversation_status || conversation.status).toLowerCase();

  if (draftCount > 0 || (status === "closed" && (temperature === "ready_to_buy" || action.includes("payment")))) {
    return "won";
  }
  if (temperature === "ready_to_buy" || action.includes("payment") || action.includes("order")) {
    return "ready_to_buy";
  }
  if (temperature === "hot" || temperature === "warm" || needsHumanAttention(conversation)) {
    return "interested";
  }
  return "new_lead";
};

const LEAD_STAGES = [
  { key: "new_lead", label: "New Lead" },
  { key: "interested", label: "Interested" },
  { key: "ready_to_buy", label: "Ready To Buy" },
  { key: "won", label: "Won" },
];

const NAV_ITEMS = [
  { key: "conversations", label: "Conversations", icon: MessageCircleMore },
  { key: "leads", label: "Leads", icon: Layers3 },
  { key: "more", label: "More", icon: MoreHorizontal },
];

function PwaChip({ children, tone = "slate" }) {
  const classes = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${classes[tone] || classes.slate}`}>
      {children}
    </span>
  );
}

function MessageText({ text = "" }) {
  const value = String(text || "");
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p dir="auto" className="whitespace-pre-wrap break-words text-[14px] leading-5.5 text-inherit">
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>;
        return (
          <a
            key={`${index}-${part}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-sky-600 underline underline-offset-2"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}

function ConversationListItem({ conversation, active, onSelect }) {
  const meta = channelMeta(conversation.channel || conversation.source);
  const Icon = meta.icon;
  const unreadCount = conversationUnreadCount(conversation);
  const avatar = customerAvatarUrl(conversation);
  const preview = conversationPreview(conversation) || "No messages yet";
  const unread = unreadCount > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation)}
      className={`flex w-full items-start gap-3 rounded-2xl px-2 py-2 text-left transition ${
        active
          ? "bg-slate-900 text-white"
          : unread
            ? "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
            : "bg-transparent text-slate-900 hover:bg-white"
      }`}
    >
      {avatar ? (
        <img
          src={avatar}
          alt={conversationName(conversation)}
          className={`h-11 w-11 shrink-0 rounded-full object-cover ${unread && !active ? "ring-2 ring-emerald-200" : "ring-1 ring-slate-200"}`}
          loading="lazy"
        />
      ) : (
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${active ? "bg-white/12 text-white" : unread ? "bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200" : "bg-slate-200 text-slate-600"}`}>
          <UserRound className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={`truncate text-[14px] leading-5 ${unread && !active ? "font-bold" : "font-semibold"}`}>{conversationName(conversation)}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
                <Icon className={`h-3 w-3 ${active ? "text-white" : meta.tone}`} />
                {meta.label}
              </span>
              {needsHumanAttention(conversation) ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-300/20 text-amber-100" : "bg-amber-50 text-amber-700"}`}>
                  Needs Human
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className={`text-[11px] font-medium ${active ? "text-slate-300" : "text-slate-500"}`}>
              {relativeTime(conversation.last_activity_at || conversation.updated_at)}
            </div>
            {unreadCount > 0 ? (
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-slate-900" : "bg-emerald-500 text-white"}`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        <div className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-4.5 ${active ? "text-slate-300" : unread ? "text-slate-700" : "text-slate-500"}`}>
          <CheckCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unread && !active ? "text-emerald-600" : ""}`} />
          <span className={`line-clamp-2 text-left ${unread && !active ? "font-medium" : ""}`}>{preview}</span>
        </div>
      </div>
    </button>
  );
}

const Transcript = memo(function Transcript({ conversation, loadingOlder, onLoadOlder }) {
  const messages = uniqueMessages(conversation?.messages || []);
  if (!messages.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No messages yet.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5 pb-3">
      {conversation?.older_messages_available ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-60"
          >
            {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
            Load older
          </button>
        </div>
      ) : null}
      {messages.map((message) => {
        const cards = normalizeProductCardsValue(message.product_cards || message.productCards);
        const hasProductCards = cards.length > 0;
        const isCustomer = Boolean(clean(message.customer_message));
        const isAi = Boolean(clean(message.ai_answer));
        const isStaff = Boolean(clean(message.staff_message)) && !hasProductCards;
        if (!isCustomer && !isAi && !isStaff && !hasProductCards) return null;

        return (
          <div key={messageKey(message)} className="space-y-1.5">
            {hasProductCards ? (
              <div className="flex justify-start">
                <div className="w-[82%] max-w-sm space-y-1.5">
                  <div className="px-1 text-left text-[10px] font-medium text-slate-500">{absoluteTime(message.created_at)}</div>
                  {cards.map((card, index) => {
                    const image = productImage(card);
                    const href = productUrl(card);
                    return (
                      <div key={`${card.product_id || card.variant_id || index}`} className="overflow-hidden rounded-[20px] rounded-bl-md border border-slate-200 bg-white shadow-sm">
                        {image ? <img src={image} alt={card.product_name || "Product"} className="aspect-[4/3] w-full object-cover" loading="lazy" /> : null}
                        <div className="space-y-2 p-2.5">
                          <div className="text-sm font-semibold text-slate-900">{card.product_name || card.name || "Product"}</div>
                          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                            {Number(card.price || card.final_price || 0) > 0 ? <span>{money(card.price || card.final_price)}</span> : null}
                            {card.color ? <span>{card.color}</span> : null}
                            {card.size ? <span>{card.size}</span> : null}
                          </div>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                            >
                              Open Product
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {!hasProductCards && isCustomer ? (
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-[20px] rounded-br-md bg-emerald-50 px-3 py-2 shadow-sm ring-1 ring-emerald-100">
                  <div className="mb-1 text-right text-[10px] font-medium text-emerald-700/70">{absoluteTime(message.created_at)}</div>
                  <div className="text-slate-900">
                    <MessageText text={message.customer_message} />
                  </div>
                </div>
              </div>
            ) : null}
            {!hasProductCards && isAi ? (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-[20px] rounded-bl-md bg-sky-50 px-3 py-2 shadow-sm ring-1 ring-sky-100">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-sky-700">
                    <Bot className="h-3.5 w-3.5" />
                    AI
                  </div>
                  <div className="text-slate-800">
                    <MessageText text={message.ai_answer} />
                  </div>
                </div>
              </div>
            ) : null}
            {!hasProductCards && isStaff ? (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-[20px] rounded-bl-md bg-slate-900 px-3 py-2 text-white shadow-sm">
                  <div className="mb-1 text-[10px] font-medium text-slate-300">
                    {message.message_type === "internal_note" ? "Internal Note" : "Team"} · {absoluteTime(message.created_at)}
                  </div>
                  <p dir="auto" className="whitespace-pre-wrap break-words text-[14px] leading-5.5 text-white">{message.staff_message}</p>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

function ProductSheet({
  open,
  products,
  loading,
  query,
  onQueryChange,
  onClose,
  onSend,
  sending,
  selectedConversation,
}) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [view, setView] = useState("list");

  const filteredProducts = useMemo(() => {
    const normalized = clean(query).toLowerCase();
    if (!normalized) return products;
    return products.filter((product) => {
      const searchable = [
        product.name,
        product.product_name,
        product.title,
        product.brand,
        product.brand_name,
        product.category,
        product.category_name,
        product.sku,
        product.barcode,
        ...getVariantRows(product).flatMap((variant) => [
          variant.color,
          variant.color_name,
          variant.variant_color,
          variant.size,
          variant.size_name,
          variant.variant_size,
          variant.sku,
          variant.barcode,
          variant.article_code,
        ]),
      ]
        .map((item) => clean(item).toLowerCase())
        .filter(Boolean);
      return searchable.some((item) => item.includes(normalized));
    });
  }, [products, query]);

  useEffect(() => {
    if (!open) return;
    setView("list");
    const firstId = String(filteredProducts[0]?.product_id || filteredProducts[0]?.id || "");
    if (!selectedProductId || !filteredProducts.some((product) => String(product.product_id || product.id || "") === selectedProductId)) {
      setSelectedProductId(firstId);
    }
  }, [filteredProducts, open, selectedProductId]);

  const selectedProduct = useMemo(
    () =>
      filteredProducts.find((product) => String(product.product_id || product.id || "") === String(selectedProductId)) ||
      filteredProducts[0] ||
      null,
    [filteredProducts, selectedProductId]
  );

  const colors = useMemo(() => productColors(selectedProduct || {}), [selectedProduct]);
  const sizes = useMemo(() => productSizes(selectedProduct || {}, selectedColor), [selectedColor, selectedProduct]);
  const requiresVariantSelection = colors.length > 0 || sizes.length > 0;

  useEffect(() => {
    if (!selectedProduct) return;
    setSelectedColor("");
    setSelectedSize("");
  }, [selectedProductId, selectedProduct]);

  useEffect(() => {
    if (!selectedProduct || view !== "detail") return;
    if (colors.length === 1 && normalizeKey(selectedColor) !== normalizeKey(colors[0])) {
      setSelectedColor(colors[0]);
    }
    if (colors.length > 1 && selectedColor && !colors.some((color) => normalizeKey(color) === normalizeKey(selectedColor))) {
      setSelectedColor("");
    }
  }, [colors, selectedColor, selectedProduct, view]);

  useEffect(() => {
    if (!selectedProduct || view !== "detail") return;
    if (sizes.length === 1 && normalizeKey(selectedSize) !== normalizeKey(sizes[0])) {
      setSelectedSize(sizes[0]);
    }
    if (sizes.length > 1 && selectedSize && !sizes.some((size) => normalizeKey(size) === normalizeKey(selectedSize))) {
      setSelectedSize("");
    }
  }, [selectedProduct, selectedSize, sizes, view]);

  const variant = useMemo(() => {
    if (!selectedProduct) return null;
    if (requiresVariantSelection) {
      if (!clean(selectedColor) || !clean(selectedSize)) return null;
      return findVariant(selectedProduct || {}, selectedColor, selectedSize);
    }
    return findVariant(selectedProduct || {}, "", "");
  }, [requiresVariantSelection, selectedColor, selectedProduct, selectedSize]);
  const card = useMemo(
    () => (selectedProduct ? buildProductCardPayload(selectedProduct, variant, selectedColor) : null),
    [selectedColor, selectedProduct, variant]
  );
  const canSend = Boolean(
    selectedConversation?.session_id &&
      selectedProduct &&
      (!requiresVariantSelection || (clean(selectedColor) && clean(selectedSize))) &&
      (requiresVariantSelection ? Boolean(variant) : true)
  );
  const previewImage = useMemo(
    () => productImage(selectedProduct || {}, variant || null) || productImage(selectedProduct || {}),
    [selectedProduct, variant]
  );
  const previewPrice = Number(variant?.price ?? selectedProduct?.final_price ?? selectedProduct?.price ?? 0) || 0;
  const previewStock = Number(variant?.stock_quantity ?? variant?.stock ?? selectedProduct?.total_stock ?? selectedProduct?.stock ?? 0) || 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 px-2 pb-2 pt-14 sm:px-4 sm:pb-4 sm:pt-16" onClick={onClose}>
      <div
        className="flex h-[82dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-16px_40px_rgba(15,23,42,0.18)] sm:h-[min(88dvh,52rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 px-4 pb-2 pt-3 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[17px] font-semibold text-slate-900">Send Product</h3>
                <p className="text-xs text-slate-500">
                  {selectedConversation ? `Sending to ${conversationName(selectedConversation)}` : "Select a product card"}
                </p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              {view === "list" ? (
                <>
                  <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Search product"
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-[16px] leading-normal outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>

              <div className="space-y-2 pb-4">
                {loading ? (
                  <div className="grid min-h-32 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : filteredProducts.length ? (
                  filteredProducts.slice(0, 80).map((product) => {
                    const active = String(product.product_id || product.id || "") === String(selectedProduct?.product_id || selectedProduct?.id || "");
                    const previewImage = productImage(product);
                    return (
                      <button
                        key={`${product.product_id || product.id}`}
                        type="button"
                        onClick={() => {
                          setSelectedProductId(String(product.product_id || product.id || ""));
                          setSelectedColor("");
                          setSelectedSize("");
                          setView("detail");
                        }}
                        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                          active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"
                        }`}
                      >
                        {previewImage ? (
                          <img src={previewImage} alt={product.name || "Product"} className="h-14 w-14 rounded-xl object-cover" loading="lazy" />
                        ) : (
                          <div className={`grid h-14 w-14 place-items-center rounded-xl ${active ? "bg-white/10" : "bg-slate-100"}`}>
                            <ShoppingBag className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{product.name || product.product_name}</div>
                          <div className={`mt-1 text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                            {Number(product.final_price || product.price || 0) > 0 ? money(product.final_price || product.price) : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No products match this search.
                  </div>
                )}
              </div>
                </>
              ) : (
                <div className="space-y-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setView("list")}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Back to products
                    </button>
                    <a
                      href={selectedProduct?.storefront_url || selectedProduct?.product_url || selectedProduct?.url || productUrl(selectedProduct)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Open Product
                    </a>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                    {previewImage ? (
                      <img src={previewImage} alt={selectedProduct?.name || selectedProduct?.product_name || "Product"} className="h-[170px] w-full object-contain bg-slate-50 p-2" loading="lazy" />
                    ) : (
                      <div className="grid h-[170px] w-full place-items-center bg-slate-50">
                        <ShoppingBag className="h-6 w-6 text-slate-400" />
                      </div>
                    )}
                    <div className="space-y-1.5 p-3">
                      <div className="text-base font-semibold text-slate-900">{selectedProduct?.name || selectedProduct?.product_name || "Select a product"}</div>
                      {previewPrice > 0 ? <div className="text-sm font-medium text-emerald-700">{money(previewPrice)}</div> : null}
                      <div className="flex flex-wrap gap-2">
                        {selectedColor ? <PwaChip>{selectedColor}</PwaChip> : null}
                        {selectedSize ? <PwaChip>{selectedSize}</PwaChip> : null}
                        {variant?.available !== undefined ? (
                          <PwaChip tone={variant.available ? "emerald" : "rose"}>{variant.available ? `In stock ${previewStock}` : "Out of stock"}</PwaChip>
                        ) : previewStock > 0 ? (
                          <PwaChip tone="emerald">{`In stock ${previewStock}`}</PwaChip>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-medium text-slate-700">Color</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {colors.length ? (
                        colors.map((color) => {
                          const active = normalizeKey(selectedColor) === normalizeKey(color);
                          return (
                            <button
                              key={color}
                              type="button"
                              onClick={() => {
                                setSelectedColor(color);
                                setSelectedSize("");
                              }}
                              className={`rounded-full px-3 py-2 text-sm ${
                                active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {color}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs text-slate-500">No color data available.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-medium text-slate-700">Size</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sizes.length ? (
                        sizes.map((size) => {
                          const active = normalizeKey(selectedSize) === normalizeKey(size);
                          return (
                            <button
                              key={size}
                              type="button"
                              onClick={() => setSelectedSize(size)}
                              className={`rounded-full px-3 py-2 text-sm ${
                                active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {size}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs text-slate-500">No size data available.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <button
              type="button"
              onClick={() => card && onSend([card])}
              disabled={!canSend}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Product
            </button>
            {!selectedConversation ? (
              <div className="mt-2 text-xs text-slate-500">Open a conversation first to send a product card.</div>
            ) : requiresVariantSelection && (!clean(selectedColor) || !clean(selectedSize)) ? (
              <div className="mt-2 text-xs text-slate-500">Select color and size to enable Send Product.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeadsView({ conversations, onOpenConversation }) {
  const columns = useMemo(() => {
    return LEAD_STAGES.map((stage) => ({
      ...stage,
      items: conversations.filter((conversation) => resolveLeadStage(conversation) === stage.key),
    }));
  }, [conversations]);

  return (
    <div className="space-y-3 pb-28">
      {columns.map((stage) => (
        <section key={stage.key} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">{stage.label}</div>
            <PwaChip>{stage.items.length}</PwaChip>
          </div>
          {stage.items.length ? (
            <div className="space-y-2">
              {stage.items.slice(0, 8).map((conversation) => (
                <button
                  key={conversation.conversation_key}
                  type="button"
                  onClick={() => onOpenConversation(conversation)}
                  className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-left"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">{conversationName(conversation)}</div>
                    <div className="mt-1 text-xs text-slate-500">{channelMeta(conversation.channel || conversation.source).label}</div>
                  </div>
                  <div className="text-xs text-slate-500">{relativeTime(conversation.last_activity_at || conversation.updated_at)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No conversations in this stage.
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function MoreView({ installAvailable, onInstall }) {
  return (
    <div className="space-y-3 pb-28">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-slate-100 p-3">
            <SmartphoneIcon />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">Standalone PWA Shell</div>
            <div className="mt-1 text-sm text-slate-500">This route is isolated from the ERP chrome and optimized for mobile conversation work.</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onInstall}
        disabled={!installAvailable}
        className="flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm disabled:opacity-50"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">Install App</div>
          <div className="text-xs text-slate-500">Add AI Inbox to the home screen.</div>
        </div>
        <Download className="h-4 w-4 text-slate-500" />
      </button>
      <Link to="/admin/ai-inbox" className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm">
        <div>
          <div className="text-sm font-semibold text-slate-900">Open Admin Inbox</div>
          <div className="text-xs text-slate-500">Go back to the full ERP console when needed.</div>
        </div>
        <ChevronLeft className="h-4 w-4 rotate-180 text-slate-500" />
      </Link>
    </div>
  );
}

function SmartphoneIcon() {
  return <MessageCircleMore className="h-5 w-5 text-slate-700" />;
}

export default function AiInboxPwa() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const tenantId = tenantIdFromAuth();
  const conversationParam = clean(params.conversationId);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [composerText, setComposerText] = useState("");
  const [composerMode, setComposerMode] = useState("reply");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiToggling, setAiToggling] = useState(false);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [productSending, setProductSending] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  const [readAtByConversation, setReadAtByConversation] = useState({});
  const [installPrompt, setInstallPrompt] = useState(null);
  const [conversationHeaderHeight, setConversationHeaderHeight] = useState(0);
  const mainScrollRef = useRef(null);
  const conversationHeaderRef = useRef(null);
  const imageInputRef = useRef(null);
  const pollRef = useRef(null);
  const restoreScrollStateRef = useRef(null);
  const markReadSignatureRef = useRef("");
  const readAtByConversationRef = useRef({});

  useEffect(() => {
    readAtByConversationRef.current = readAtByConversation;
  }, [readAtByConversation]);

  const tab = useMemo(() => {
    const value = new URLSearchParams(location.search).get("tab");
    return NAV_ITEMS.some((item) => item.key === value) ? value : "conversations";
  }, [location.search]);

  const updateUrlState = useCallback(
    ({ nextConversationId = conversationParam, nextTab = tab, replace = false } = {}) => {
      const searchParams = new URLSearchParams(location.search);
      if (nextTab && nextTab !== "conversations") searchParams.set("tab", nextTab);
      else searchParams.delete("tab");
      const searchText = searchParams.toString();
      const nextPath = nextConversationId ? `/inbox/${encodeConversationId(nextConversationId)}` : "/inbox";
      navigate(`${nextPath}${searchText ? `?${searchText}` : ""}`, { replace });
    },
    [conversationParam, location.search, navigate, tab]
  );

  const patchConversation = useCallback((targetId, updater) => {
    setConversations((current) =>
      current.map((conversation) => {
        const matches =
          conversation.conversation_key === targetId ||
          clean(conversation.session_id) === clean(targetId) ||
          encodeConversationId(conversation.session_id) === clean(targetId);
        return matches ? updater(conversation) : conversation;
      })
    );
  }, []);

  const loadProducts = useCallback(async () => {
    if (productLoading || products.length) return;
    setProductLoading(true);
    try {
      const payload = await getPosSellableProducts();
      setProducts(asArray(payload));
    } catch (loadError) {
      toast.error(loadError?.message || "Failed to load products");
    } finally {
      setProductLoading(false);
    }
  }, [productLoading, products.length]);

  const loadConversations = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const payload = await api.get("/ai-inbox/conversations", {
          params: {
            tenant_id: tenantId,
            search: debouncedSearch,
            limit: 100,
            message_limit: conversationParam ? 50 : 20,
          },
          headers,
          perfComponent: "AiInboxPwa.conversations",
        });

        const nextConversations = asArray(payload.conversations)
          .map((conversation) => ({
            ...applyLocalReadState(conversation, readAtByConversationRef.current),
            conversation_key: conversation.conversation_key || conversationKey(conversation),
            messages: uniqueMessages(conversation.messages),
          }))
          .sort((left, right) => {
            const leftTime = new Date(left.last_activity_at || left.updated_at || 0).getTime() || 0;
            const rightTime = new Date(right.last_activity_at || right.updated_at || 0).getTime() || 0;
            return rightTime - leftTime;
          });

        setConversations(nextConversations);

        if (conversationParam) {
          const exists = nextConversations.some(
            (conversation) =>
              clean(conversation.session_id) === conversationParam ||
              encodeConversationId(conversation.session_id) === conversationParam ||
              clean(conversation.conversation_key) === conversationParam
          );
          if (!exists && nextConversations[0]?.session_id && tab === "conversations") {
            updateUrlState({ nextConversationId: nextConversations[0].session_id, replace: true });
          }
        }
      } catch (loadError) {
        setError(loadError?.message || "Failed to load AI Inbox");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [conversationParam, debouncedSearch, headers, tab, tenantId, updateUrlState]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "AI Inbox";
      document.documentElement.style.backgroundColor = "#f8fafc";
      document.body.style.backgroundColor = "#f8fafc";
    }
    try {
      localStorage.setItem("ai_inbox_last_url", `${location.pathname}${location.search}`);
      localStorage.setItem("portal_last_url", `${location.pathname}${location.search}`);
    } catch {
      // Ignore storage errors.
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    navigator.serviceWorker.register("/inbox-sw.js?v=1", { scope: "/inbox" }).catch(() => null);
    return undefined;
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (!productSheetOpen) return;
    void loadProducts();
  }, [loadProducts, productSheetOpen]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollRef.current = window.setInterval(() => {
      void loadConversations({ silent: true });
    }, 15000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadConversations]);

  const filteredConversations = useMemo(() => {
    const normalized = debouncedSearch.toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !normalized || [
        conversationName(conversation),
        conversation.external_customer_id,
        conversation.phone,
        conversation.latest_message_preview,
      ]
        .map((item) => clean(item).toLowerCase())
        .some((item) => item.includes(normalized));
      if (!matchesSearch) return false;
      if (filter === "unread") return conversationUnreadCount(conversation) > 0;
      if (filter === "needs_reply") return needsHumanAttention(conversation) || conversationUnreadCount(conversation) > 0;
      return true;
    });
  }, [conversations, debouncedSearch, filter]);

  const selectedConversation = useMemo(() => {
    if (!conversationParam) return null;
    return (
      conversations.find(
        (conversation) =>
          clean(conversation.session_id) === conversationParam ||
          encodeConversationId(conversation.session_id) === conversationParam ||
          clean(conversation.conversation_key) === conversationParam
      ) || null
    );
  }, [conversationParam, conversations]);

  const markConversationAsRead = useCallback(
    async (conversation) => {
      const sessionId = clean(conversation?.session_id);
      if (!sessionId) return false;

      const conversationIdentifier = conversation.conversation_key || sessionId;
      const readAt = new Date().toISOString();
      readAtByConversationRef.current = {
        ...readAtByConversationRef.current,
        [conversationIdentifier]: readAt,
      };

      setReadAtByConversation((current) => ({
        ...current,
        [conversationIdentifier]: readAt,
      }));

      patchConversation(conversationIdentifier, (currentConversation) => ({
        ...currentConversation,
        unread_count: 0,
        unseen_count: 0,
        pending_count: 0,
        unread: false,
      }));

      const endpoints = [
        aiInboxConversationEndpoint(sessionId, "/read"),
        aiAgentInboxEndpoint(sessionId, "/read"),
      ];

      for (const endpoint of endpoints) {
        try {
          await api.post(
            endpoint,
            { tenant_id: tenantId, conversation_id: sessionId, channel: conversation.channel || conversation.source || "" },
            { headers, perfComponent: "AiInboxPwa.markRead", suppressErrorStatuses: [404, 405] }
          );
          await loadConversations({ silent: true });
          return true;
        } catch (markError) {
          if (markError?.status === 404 || markError?.status === 405) continue;
          return false;
        }
      }

      return false;
    },
    [headers, loadConversations, patchConversation, tenantId]
  );

  const openConversation = useCallback(
    (conversation) => {
      setComposerMode("reply");
      setMenuOpen(false);
      updateUrlState({ nextConversationId: conversation.session_id, nextTab: "conversations" });
    },
    [updateUrlState]
  );

  const backToList = useCallback(() => {
    setMenuOpen(false);
    markReadSignatureRef.current = "";
    updateUrlState({ nextConversationId: "", nextTab: "conversations" });
  }, [updateUrlState]);

  const handleBackNavigation = useCallback(() => {
    setMenuOpen(false);
    const historyState = window.history.state;
    if (historyState && typeof historyState.idx === "number" && historyState.idx > 0) {
      navigate(-1);
      return;
    }
    backToList();
  }, [backToList, navigate]);

  useEffect(() => {
    if (!selectedConversation) return undefined;
    const onPopState = () => {
      const historyState = window.history.state;
      if (historyState && typeof historyState.idx === "number" && historyState.idx > 0) return;
      backToList();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [backToList, selectedConversation]);

  useEffect(() => {
    if (!selectedConversation?.session_id) {
      markReadSignatureRef.current = "";
    }
  }, [selectedConversation?.session_id]);

  useEffect(() => {
    const sessionId = clean(selectedConversation?.session_id);
    if (!sessionId || tab !== "conversations") return;

    const unreadCount = conversationUnreadCount(selectedConversation);
    if (unreadCount <= 0) return;

    const signature = `${sessionId}:${selectedConversation.last_activity_at || selectedConversation.updated_at || ""}`;
    if (markReadSignatureRef.current === signature) return;
    markReadSignatureRef.current = signature;

    void markConversationAsRead(selectedConversation);
  }, [markConversationAsRead, selectedConversation, tab]);

  useLayoutEffect(() => {
    if (!selectedConversation || tab !== "conversations") return undefined;
    const scroller = mainScrollRef.current;
    if (!scroller) return undefined;

    const restoreState = restoreScrollStateRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (!scroller) return;
      if (restoreState) {
        scroller.scrollTop = Math.max(0, restoreState.scrollTop + (scroller.scrollHeight - restoreState.scrollHeight));
        restoreScrollStateRef.current = null;
        return;
      }
      scroller.scrollTop = scroller.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedConversation, selectedConversation?.last_activity_at, selectedConversation?.messages?.length, selectedConversation?.updated_at, tab]);

  useLayoutEffect(() => {
    if (!selectedConversation || tab !== "conversations") {
      setConversationHeaderHeight(0);
      return undefined;
    }

    const updateHeaderHeight = () => {
      const header = conversationHeaderRef.current;
      if (!header) return;
      setConversationHeaderHeight(Math.ceil(header.getBoundingClientRect().height));
    };

    updateHeaderHeight();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(updateHeaderHeight);
    if (conversationHeaderRef.current) {
      observer.observe(conversationHeaderRef.current);
    }

    return () => observer.disconnect();
  }, [selectedConversation, tab]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedConversation?.session_id || olderLoading) return;
    const before = selectedConversation.next_messages_before || selectedConversation.messages?.[0]?.created_at || "";
    if (!before) return;
    const scroller = mainScrollRef.current;
    if (scroller) {
      restoreScrollStateRef.current = {
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      };
    }
    setOlderLoading(true);
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversation.session_id, "/messages"), {
        params: { tenant_id: tenantId, before, limit: 30 },
        headers,
        perfComponent: "AiInboxPwa.messages",
      });
      patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => {
        const mergedMessages = uniqueMessages([...asArray(payload.messages), ...asArray(conversation.messages)]);
        return {
          ...conversation,
          messages: mergedMessages,
          older_messages_available: Boolean(payload.has_more),
          next_messages_before: payload.next_before || mergedMessages[0]?.created_at || "",
        };
      });
    } catch (loadError) {
      toast.error(loadError?.message || "Failed to load older messages");
    } finally {
      setOlderLoading(false);
    }
  }, [headers, olderLoading, patchConversation, selectedConversation, tenantId]);

  const sendManualReply = useCallback(async () => {
    const message = clean(composerText);
    if (!selectedConversation?.session_id || !message) return;
    setSending(true);
    try {
      const payload =
        composerMode === "note"
          ? await api.post(
              aiInboxConversationEndpoint(selectedConversation.session_id, "/reply"),
              { tenant_id: tenantId, message },
              { headers, perfComponent: "AiInboxPwa.note" }
            )
          : await api.post(
              aiInboxConversationEndpoint(selectedConversation.session_id, "/send"),
              { tenant_id: tenantId, message },
              { headers, perfComponent: "AiInboxPwa.send" }
            );

      const returnedMessage =
        payload?.message ||
        (composerMode === "note"
          ? {
              id: `note:${Date.now()}`,
              staff_message: message,
              message_type: "internal_note",
              created_at: new Date().toISOString(),
            }
          : null);

      if (returnedMessage) {
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          messages: uniqueMessages([...asArray(conversation.messages), returnedMessage]),
          latest_message_preview: message,
          last_activity_at: returnedMessage.created_at || new Date().toISOString(),
          updated_at: returnedMessage.created_at || new Date().toISOString(),
          ai_paused: composerMode === "note" ? conversation.ai_paused : true,
          human_takeover: composerMode === "note" ? conversation.human_takeover : true,
          conversation_status: composerMode === "note" ? conversation.conversation_status : "human_takeover",
        }));
      }

      toast.success(composerMode === "note" ? "Internal note saved" : "Message sent");
      setComposerText("");
      if (composerMode === "note") setComposerMode("reply");
    } catch (sendError) {
      toast.error(sendError?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }, [composerMode, composerText, headers, patchConversation, selectedConversation, tenantId]);

  const sendProductCards = useCallback(
    async (cards = []) => {
      if (!selectedConversation?.session_id || !cards.length) return;
      setProductSending(true);
      try {
        const sentCards = cards.map((card) => {
          const exactUrl = clean(card.product_url || card.storefront_url || productUrl(card));
          return {
            ...card,
            product_url: exactUrl,
            storefront_url: exactUrl,
          };
        });
        const payload = await api.post(
          aiInboxConversationEndpoint(selectedConversation.session_id, "/product-card/send"),
          {
            tenant_id: tenantId,
            product_cards: sentCards,
          },
          { headers, perfComponent: "AiInboxPwa.productCard" }
        );

        const returnedMessage = payload?.message || null;
        const returnedCards = normalizeProductCardsValue(returnedMessage?.product_cards || returnedMessage?.productCards);
        const normalizedCards = returnedCards.length
          ? returnedCards.map((card, index) => {
              const fallbackCard = sentCards[index] || sentCards[0] || {};
              const exactUrl = clean(
                card.product_url ||
                  card.storefront_url ||
                  card.url ||
                  fallbackCard.product_url ||
                  fallbackCard.storefront_url ||
                  productUrl(card) ||
                  productUrl(fallbackCard)
              );
              return {
                ...fallbackCard,
                ...card,
                product_url: exactUrl,
                storefront_url: exactUrl,
              };
            })
          : sentCards;
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          messages: returnedMessage
            ? uniqueMessages([
                ...asArray(conversation.messages),
                {
                  ...returnedMessage,
                  product_cards: normalizedCards,
                },
              ])
            : conversation.messages,
          latest_message_preview:
            productCardPreviewText(sentCards) ||
            returnedMessage?.staff_message ||
            returnedMessage?.message_text ||
            "Product sent",
          last_activity_at: returnedMessage?.created_at || new Date().toISOString(),
          updated_at: returnedMessage?.created_at || new Date().toISOString(),
        }));

        setProductSheetOpen(false);
        toast.success("Product sent");
      } catch (sendError) {
        toast.error(sendError?.message || "Failed to send product");
      } finally {
        setProductSending(false);
      }
    },
    [headers, patchConversation, selectedConversation, tenantId]
  );

  const openImagePicker = useCallback(() => {
    if (!imageInputRef.current) return;
    imageInputRef.current.value = "";
    imageInputRef.current.click();
  }, []);

  const handleImageAttachmentChange = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    toast.error("إرسال الصور غير مدعوم حالياً");
  }, []);

  const toggleConversationAi = useCallback(async () => {
    if (!selectedConversation?.session_id) return;
    setAiToggling(true);
    try {
      const nextEnabled = !isConversationAiEnabled(selectedConversation);
      await api.patch(
        aiInboxConversationEndpoint(selectedConversation.session_id, "/ai-enabled"),
        {
          tenant_id: tenantId,
          conversation_id: selectedConversation.session_id,
          ai_enabled: nextEnabled,
          channel: selectedConversation.channel || selectedConversation.source || "",
          external_conversation_id: selectedConversation.external_conversation_id || "",
        },
        { headers, perfComponent: "AiInboxPwa.aiToggle" }
      );
      patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
        ...conversation,
        ai_enabled: nextEnabled,
      }));
      toast.success(nextEnabled ? "AI enabled" : "AI paused");
      setMenuOpen(false);
    } catch (toggleError) {
      toast.error(toggleError?.message || "Failed to update AI state");
    } finally {
      setAiToggling(false);
    }
  }, [headers, patchConversation, selectedConversation, tenantId]);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }, [installPrompt]);

  const contentScreen = Boolean(selectedConversation);
  const showComposer = contentScreen && tab === "conversations";
  const selectedMeta = channelMeta(selectedConversation?.channel || selectedConversation?.source || "");
  const SelectedChannelIcon = selectedMeta.icon;
  const selectedAvatar = customerAvatarUrl(selectedConversation || {});
  const selectedLastSeen = relativeSeenLabel(
    selectedConversation?.last_activity_at || selectedConversation?.updated_at
  );
  const isRtlLayout =
    typeof document !== "undefined" &&
    ((document.documentElement.dir || document.body?.dir || "").toLowerCase() === "rtl");

  return (
    <div className="h-dvh overflow-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto flex h-full w-full max-w-[430px] flex-col bg-slate-50">
        {contentScreen && tab === "conversations" ? (
          <header
            ref={conversationHeaderRef}
            className="fixed inset-x-0 top-0 z-[60] mx-auto w-full max-w-[430px] border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur"
          >
            <div className="flex items-center justify-between gap-2" style={{ flexDirection: isRtlLayout ? "row-reverse" : "row" }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleBackNavigation}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                  aria-label="Back to conversations"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {selectedAvatar ? (
                  <img
                    src={selectedAvatar}
                    alt={conversationName(selectedConversation)}
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                    loading="lazy"
                  />
                ) : (
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                    <UserRound className="h-4.5 w-4.5" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold leading-5 text-slate-900">{conversationName(selectedConversation)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                      <SelectedChannelIcon className={`h-3 w-3 ${selectedMeta.tone}`} />
                      {selectedMeta.label}
                    </span>
                    <span className="truncate">{selectedLastSeen}</span>
                  </div>
                </div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((current) => !current)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                >
                  <MoreHorizontal className="h-4.5 w-4.5" />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-12 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                    <button type="button" onClick={toggleConversationAi} disabled={aiToggling} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 disabled:opacity-50">
                      {aiToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      {isConversationAiEnabled(selectedConversation) ? "Pause AI" : "Enable AI"}
                    </button>
                    <button type="button" onClick={() => { setProductSheetOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                      <PackagePlus className="h-4 w-4" />
                      Send Product
                    </button>
                    <button type="button" onClick={() => { setComposerMode("note"); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                      <Sparkles className="h-4 w-4" />
                      Internal Note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        toast("No existing block API is wired in this build.");
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm text-rose-600 hover:bg-rose-50"
                    >
                      <ShieldBan className="h-4 w-4" />
                      Block Customer
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>
        ) : (
          <header className="border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur">
            <div className="space-y-2.5">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">AI Inbox</h1>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search conversations"
                  className="h-10 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 text-[16px] leading-normal outline-none transition focus:border-slate-400"
                />
              </label>
              {tab === "conversations" ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFilter("all")} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>All</button>
                  <button type="button" onClick={() => setFilter("unread")} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === "unread" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Unread</button>
                  <button type="button" onClick={() => setFilter("needs_reply")} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === "needs_reply" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Needs Reply</button>
                </div>
              ) : null}
            </div>
          </header>
        )}
        <main
          ref={mainScrollRef}
          className={`flex-1 min-h-0 overflow-y-auto px-2 ${contentScreen && tab === "conversations" ? "" : "pt-1.5"} ${showComposer ? "pb-[calc(5.9rem+env(safe-area-inset-bottom))]" : "pb-[calc(4.1rem+env(safe-area-inset-bottom))]"}`}
          style={contentScreen && tab === "conversations" ? { paddingTop: `${conversationHeaderHeight || 88}px` } : undefined}
        >
          {error && !loading ? (
            <div className="mb-3 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {tab === "conversations" ? (
            contentScreen ? (
              <Transcript conversation={selectedConversation} loadingOlder={olderLoading} onLoadOlder={loadOlderMessages} />
          ) : loading ? (
              <div className="grid min-h-60 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              </div>
            ) : filteredConversations.length ? (
              <VirtualList
                items={filteredConversations}
                estimateSize={72}
                className="h-[calc(100vh-7.85rem-env(safe-area-inset-bottom))]"
                itemKey={(conversation) => conversation.conversation_key}
                renderItem={(conversation) => (
                  <div className="border-b border-slate-100 py-0.5">
                    <ConversationListItem
                      conversation={conversation}
                      active={false}
                      onSelect={openConversation}
                    />
                  </div>
                )}
              />
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No conversations match the current filters.
              </div>
            )
          ) : null}

          {tab === "leads" ? <LeadsView conversations={conversations} onOpenConversation={openConversation} /> : null}
          {tab === "more" ? <MoreView installAvailable={Boolean(installPrompt)} onInstall={installApp} /> : null}
        </main>

        {showComposer ? (
          <div className={`fixed inset-x-0 z-20 mx-auto w-full max-w-[430px] px-2 ${contentScreen ? "bottom-[max(0.4rem,env(safe-area-inset-bottom))]" : "bottom-[calc(4rem+env(safe-area-inset-bottom))]"}`}>
            <div className="rounded-[24px] border border-slate-200 bg-white p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
              {composerMode === "note" ? (
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Internal note mode
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductSheetOpen(true)}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-100"
                  aria-label="Send product"
                >
                  <PackagePlus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={openImagePicker}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                  aria-label="Attach image"
                  title="Attach image"
                >
                  <Image className="h-5 w-5" />
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageAttachmentChange}
                  className="hidden"
                  aria-hidden="true"
                />
                <textarea
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  rows={1}
                  placeholder={composerMode === "note" ? "Write an internal note" : "Type a reply"}
                  dir="auto"
                  className="max-h-28 min-h-12 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] leading-normal outline-none transition focus:border-slate-400 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={sendManualReply}
                  disabled={!clean(composerText) || sending}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white disabled:opacity-50"
                  aria-label={composerMode === "note" ? "Save note" : "Send reply"}
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!contentScreen ? (
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-slate-200 bg-white/95 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
          <div className="grid grid-cols-3 gap-1">
            {NAV_ITEMS.map((item) => {
              const active = tab === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => updateUrlState({ nextConversationId: item.key === "conversations" ? conversationParam : "", nextTab: item.key })}
                  className={`flex flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[10px] font-medium ${
                    active ? "bg-slate-900 text-white" : "text-slate-500"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
        ) : null}

        <ProductSheet
          open={productSheetOpen}
          products={products}
          loading={productLoading}
          query={productQuery}
          onQueryChange={setProductQuery}
          onClose={() => setProductSheetOpen(false)}
          onSend={sendProductCards}
          sending={productSending}
          selectedConversation={selectedConversation}
        />
      </div>
    </div>
  );
}
