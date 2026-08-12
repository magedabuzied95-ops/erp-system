import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  ImageIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Tag,
  ToggleLeft,
  ToggleRight,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  createAutoReplyRule,
  getAutoReplyRules,
  getCommentEvents,
  getMarketingConversations,
  getMetaWebhookStatus,
  simulateMarketingComment,
  updateAutoReplyRule,
} from "../services/marketingApi";
import { getProductsWithVariants } from "../../products/services/productsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const suggestedKeywords = ["بكام", "السعر", "متاح", "مقاس", "لون", "شحن", "price", "available"];
const defaultKeywords = ["بكام", "السعر", "سعر", "كام", "price", "available", "متاح", "مقاس"];

const DEFAULT_PRIVATE_REPLY_TEMPLATE = "أهلاً بحضرتك ❤️\nالموديل {{product_name}} سعره: {{price}} ج.م\n\nالمتاح حاليًا:\n{{variants}}\n\nتحب أأكد لحضرتك المقاس واللون؟";

const blankRule = {
  platform: "facebook",
  enabled: true,
  name: "Price & availability auto reply",
  keywords: defaultKeywords,
  match_mode: "any",
  public_reply_template: "",
  private_reply_template: DEFAULT_PRIVATE_REPLY_TEMPLATE,
  like_comment: true,
  reply_publicly: false,
  send_private_reply: true,
};

const splitKeywords = (value) =>
  String(value || "")
    .split(/[،,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const unique = (items = []) => Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const normalizeArabic = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const includesAny = (message, terms) => {
  const text = normalizeArabic(message);
  return terms.some((term) => text.includes(normalizeArabic(term)));
};

export const detectPriceIntent = (message = "") =>
  includesAny(message, ["بكام", "كام", "السعر", "سعر", "تمن", "ثمن", "price", "how much", "cost"]);

export const detectAvailabilityIntent = (message = "") =>
  includesAny(message, ["متاح", "موجود", "لسه", "فيه", "available", "stock", "in stock"]);

export const detectVariantIntent = (message = "") =>
  includesAny(message, ["مقاس", "مقاسات", "لون", "الوان", "ألوان", "نمرة", "size", "color"]);

const scoreLead = (message = "") => {
  if (includesAny(message, ["عاوز", "عايز", "احجز", "ابعت", "فين", "محتاج", "اطلب", "order", "reserve"])) return "high";
  if (includesAny(message, ["بكام", "متاح", "السعر", "price", "available"])) return "medium";
  return "low";
};

const money = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : String(value || "");
};

const renderTemplate = (template, context) =>
  String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(context[key] ?? ""));

const getProductImage = (product = {}) => {
  const gallery = Array.isArray(product.gallery_images) ? product.gallery_images : [];
  const firstGallery = gallery.find(Boolean);
  return resolveProductImageUrl(product.image_url || product.variant_image_url || firstGallery || "");
};

const productContext = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const priceCandidates = [product.sale_price, product.price, ...variants.map((variant) => variant.sale_price || variant.price)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const price = priceCandidates.length ? Math.min(...priceCandidates) : Number(product.price || 0);
  const stock = variants.length ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0) : Number(product.stock || 0);
  const colors = unique(variants.map((variant) => variant.color));
  const sizes = unique(variants.map((variant) => variant.size));
  const variantLines = variants.length
    ? variants.slice(0, 8).map((variant) => {
        const label = [variant.color, variant.size].filter(Boolean).join(" / ") || "Variant";
        return `${label}: ${Number(variant.stock || 0) > 0 ? `متاح (${variant.stock})` : "غير متاح"}`;
      }).join("\n")
    : stock > 0 ? `متاح (${stock})` : "غير متاح حاليًا";

  return {
    product_name: product.name || "Product",
    price: money(price),
    variants: variantLines,
    brand: product.brand_name || product.brand || "",
    store_name: "Store",
    product_image: getProductImage(product),
    stock,
    colors,
    sizes,
  };
};

const relativeTime = (value) => {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const PlatformIcon = ({ platform }) =>
  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${platform === "instagram" ? "bg-pink-500/20 text-pink-100" : "bg-primary/20 text-primary"}`}>
    {platform === "instagram" ? "IG" : "FB"}
  </span>;

const leadScoreClass = {
  high: "border-rose-400/30 bg-rose-400/10 text-rose-100",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  low: "border-slate-400/20 bg-slate-400/10 text-slate-200",
};

const normalizeActionStatus = (actions = {}, key, legacyKey) => {
  const value = actions[key] ?? actions?.details?.[key]?.status ?? actions[legacyKey];
  if (value === true) return "success";
  if (value === false || !value) return "skipped";
  if (typeof value === "object") return value.status || "skipped";
  return String(value);
};

const actionTone = {
  success: "bg-emerald-400/10 text-emerald-100",
  error: "bg-rose-400/10 text-rose-100",
  skipped: "bg-white/5 text-slate-400",
};

const ActionStatus = ({ icon: Icon, label, status }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${actionTone[status] || actionTone.skipped}`}>
    <Icon className="h-3 w-3" /> {label}: {status}
  </span>
);

export default function MarketingAutomation() {
  const { t } = useTranslation();
  const [loadingPrimary, setLoadingPrimary] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [rules, setRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [sampleComment, setSampleComment] = useState("بكام ومتاح مقاس 42؟");
  const [form, setForm] = useState(blankRule);

  const deferredPrivateTemplate = useDeferredValue(form.private_reply_template);

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === String(selectedProductId)) || products[0] || {},
    [products, selectedProductId]
  );
  const previewContext = useMemo(() => productContext(selectedProduct), [selectedProduct]);
  const privatePreview = useMemo(() => renderTemplate(deferredPrivateTemplate, previewContext), [deferredPrivateTemplate, previewContext]);
  const webhookPayloadPreview = useMemo(() => {
    if (!webhookStatus?.recent_payload_preview) return t("marketing.automation.noPayload");
    try {
      return JSON.stringify(webhookStatus.recent_payload_preview, null, 2);
    } catch {
      return String(webhookStatus.recent_payload_preview);
    }
  }, [webhookStatus]);
  const intents = useMemo(() => ({
    price: detectPriceIntent(sampleComment),
    availability: detectAvailabilityIntent(sampleComment),
    variant: detectVariantIntent(sampleComment),
  }), [sampleComment]);

  const applyRule = (rule) => {
    setSelectedRuleId(rule?.id || null);
    setForm({
      ...blankRule,
      ...rule,
      keywords: Array.isArray(rule?.keywords) ? rule.keywords : blankRule.keywords,
    });
  };

  const loadPrimary = async () => {
    setLoadingPrimary(true);
    try {
      const [loadedRules, loadedProducts] = await Promise.all([
        getAutoReplyRules(),
        getProductsWithVariants({ timeoutMs: 15000 }),
      ]);
      setRules(loadedRules);
      setProducts(loadedProducts);
      if (!selectedRuleId) applyRule(loadedRules[0] || blankRule);
      if (!selectedProductId && loadedProducts[0]) setSelectedProductId(loadedProducts[0].id);
    } catch (error) {
      toast.error(error?.message || t("marketing.automation.loadSetupFailed"));
    } finally {
      setLoadingPrimary(false);
    }
  };

  const loadActivity = async () => {
    setLoadingActivity(true);
    try {
      const [loadedEvents, loadedConversations, loadedWebhookStatus] = await Promise.all([
        getCommentEvents(),
        getMarketingConversations(),
        getMetaWebhookStatus(),
      ]);
      setEvents(loadedEvents);
      setConversations(loadedConversations);
      setWebhookStatus(loadedWebhookStatus);
    } catch (error) {
      toast.error(error?.message || t("marketing.automation.loadActivityFailed"));
    } finally {
      setLoadingActivity(false);
    }
  };

  useEffect(() => {
    void loadPrimary();
    const timer = window.setTimeout(() => {
      void loadActivity();
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  const addKeywords = (value) => {
    const next = splitKeywords(value);
    if (!next.length) return;
    setForm((current) => ({ ...current, keywords: unique([...(current.keywords || []), ...next]) }));
    setKeywordDraft("");
  };

  const removeKeyword = (keyword) => {
    setForm((current) => ({ ...current, keywords: (current.keywords || []).filter((item) => item !== keyword) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        keywords: form.keywords || [],
        reply_publicly: false,
        public_reply_template: "",
      };
      const saved = selectedRuleId ? await updateAutoReplyRule(selectedRuleId, payload) : await createAutoReplyRule(payload);
      toast.success(selectedRuleId ? t("marketing.automation.updated") : t("marketing.automation.created"));
      setSelectedRuleId(saved.id);
      await loadPrimary();
      void loadActivity();
    } catch (error) {
      toast.error(error?.message || t("marketing.automation.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const simulateComment = async () => {
    setSimulating(true);
    try {
      await simulateMarketingComment({
        platform: form.platform,
        post_id: "simulated-post",
        message: sampleComment,
        username: "Simulated Customer",
      });
      toast.success(t("marketing.automation.simulatedSaved"));
      await loadActivity();
    } catch (error) {
      toast.error(error?.message || t("marketing.automation.simulateFailed"));
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="min-h-full overflow-x-hidden bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-5 md:px-6 lg:px-8">
        <section className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_34%),linear-gradient(135deg,#0b1020,#080914_58%,#10101b)] p-4 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                <Bot className="h-3.5 w-3.5" />
                {t("marketing.automation.eyebrow")}
              </div>
              <h1 className="m1-page-title mt-3">{t("marketing.automation.title")}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{t("marketing.automation.subtitle")}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
                <div className="text-xl font-black">{rules.length}</div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.rules")}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
                <div className="text-xl font-black">{conversations.length}</div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.leads")}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
                <div className="text-xl font-black">{events.length}</div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.comments")}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_420px]">
          <aside className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="m1-section-title">{t("marketing.automation.rules")}</h2>
                <p className="text-xs text-slate-400">{t("marketing.automation.playbooks")}</p>
              </div>
              <button type="button" onClick={() => applyRule(blankRule)} className="inline-flex h-[var(--control-height-md)] w-9 items-center justify-center rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 text-primary">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => applyRule(rule)}
                  className={`w-full rounded-[var(--radius-control)] border p-3 text-left transition ${selectedRuleId === rule.id ? "border-primary/50 bg-primary/10 shadow-[0_0_28px_rgba(34,211,238,0.12)]" : "border-white/10 bg-slate-950/50 hover:bg-white/[0.07]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-white">{rule.name}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <PlatformIcon platform={rule.platform} />
                        <span>{rule.platform}</span>
                        <span>{rule.match_mode}</span>
                      </div>
                    </div>
                    {rule.enabled ? <ToggleRight className="h-5 w-5 text-emerald-300" /> : <ToggleLeft className="h-5 w-5 text-slate-500" />}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(rule.keywords || []).slice(0, 4).map((keyword) => (
                      <span key={keyword} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">{keyword}</span>
                    ))}
                  </div>
                </button>
              ))}
              {!rules.length && !loadingPrimary ? <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-400">{t("marketing.automation.noRules")}</div> : null}
            </div>
          </aside>

          <main className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="m1-section-title">{t("marketing.automation.ruleEditor")}</h2>
                <p className="text-sm text-slate-400">{t("marketing.automation.ruleEditorDescription")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setForm((current) => ({ ...current, enabled: !current.enabled }))} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-semibold">
                  {form.enabled ? <ToggleRight className="h-5 w-5 text-emerald-300" /> : <ToggleLeft className="h-5 w-5 text-slate-400" />}
                  {form.enabled ? t("marketing.automation.enabled") : t("marketing.campaigns.status.paused")}
                </button>
                <button type="button" onClick={() => { void loadPrimary(); void loadActivity(); }} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold">
                  <RefreshCw className="h-4 w-4" />
                  {t("marketing.common.refresh")}
                </button>
                <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  <Save className="h-4 w-4" />
                  {t("marketing.common.save")}
                </button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <label className="space-y-1.5 lg:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.fields.ruleName")}</span>
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm outline-none transition focus:border-primary/40" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("marketing.social.platform")}</span>
                <select value={form.platform} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm outline-none">
                  <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
                  <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.fields.matchMode")}</span>
                <select value={form.match_mode} onChange={(event) => setForm((current) => ({ ...current, match_mode: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm outline-none">
                  <option value="any">{t("marketing.automation.matchModes.anySmart")}</option>
                  <option value="all">{t("marketing.automation.matchModes.all")}</option>
                  <option value="exact">{t("marketing.automation.matchModes.exact")}</option>
                </select>
              </label>
            </div>

            <section className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold"><Tag className="h-4 w-4 text-primary" /> {t("marketing.automation.fields.keywords")}</div>
                  <p className="text-xs text-slate-400">{t("marketing.automation.keywordsHelp")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedKeywords.map((keyword) => (
                    <button key={keyword} type="button" onClick={() => addKeywords(keyword)} className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{keyword}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
                {(form.keywords || []).map((keyword) => (
                  <span key={keyword} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs text-white">
                    {keyword}
                    <button type="button" onClick={() => removeKeyword(keyword)} className="text-slate-300 hover:text-white"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <input
                  value={keywordDraft}
                  onChange={(event) => setKeywordDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "," || event.key === "،") {
                      event.preventDefault();
                      addKeywords(keywordDraft);
                    }
                  }}
                  onBlur={() => addKeywords(keywordDraft)}
                  placeholder={t("marketing.automation.placeholders.addKeyword")}
                  className="min-w-[150px] flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-500"
                />
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">{t("marketing.automation.privateDmTemplate")}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                    {["{{product_name}}", "{{price}}", "{{variants}}", "{{brand}}", "{{store_name}}", "{{product_image}}"].map((item) => <span key={item} className="rounded-full bg-white/5 px-2 py-1">{item}</span>)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-slate-300">
                  {["like_comment", "send_private_reply"].map((key) => (
                    <label key={key} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5">
                      <input type="checkbox" checked={Boolean(form[key])} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))} />
                      {t(`marketing.automation.actions.${key}`)}
                    </label>
                  ))}
                </div>
              </div>
              <textarea rows={8} value={form.private_reply_template} onChange={(event) => setForm((current) => ({ ...current, private_reply_template: event.target.value }))} className="w-full resize-y rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2 text-sm leading-6 outline-none" />
            </section>
          </main>

          <aside className="space-y-3">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="m1-section-title">{t("marketing.automation.webhook.title")}</h2>
                  <p className="text-xs text-slate-400">{webhookStatus?.verify_token_configured && webhookStatus?.signature_validation_enabled ? t("marketing.automation.webhook.ready") : t("marketing.automation.webhook.incomplete")}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${webhookStatus?.verify_token_configured && webhookStatus?.signature_validation_enabled ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
                  {webhookStatus?.verify_token_configured && webhookStatus?.signature_validation_enabled ? t("marketing.settings.status.connected") : t("marketing.automation.pending")}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-2">
                  <div className="text-slate-400">{t("marketing.automation.webhook.verifyToken")}</div>
                  <div className={webhookStatus?.verify_token_configured ? "mt-1 font-bold text-emerald-200" : "mt-1 font-bold text-amber-200"}>
                    {webhookStatus?.verify_token_configured ? t("marketing.automation.configured") : t("marketing.settings.status.missing")}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-2">
                  <div className="text-slate-400">{t("marketing.automation.webhook.signature")}</div>
                  <div className={webhookStatus?.signature_validation_enabled ? "mt-1 font-bold text-emerald-200" : "mt-1 font-bold text-amber-200"}>
                    {webhookStatus?.signature_validation_enabled ? t("marketing.automation.enabled") : t("marketing.settings.status.missing")}
                  </div>
                </div>
                <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-2">
                  <div className="text-slate-400">{t("marketing.automation.webhook.lastEvent")}</div>
                  <div className="mt-1 font-bold text-slate-100">{webhookStatus?.last_event_at ? relativeTime(webhookStatus.last_event_at) : t("marketing.automation.webhook.noEvents")}</div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/60 p-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.webhook.url")}</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-2 py-1.5 text-xs text-primary">{webhookStatus?.webhook_url || "/api/marketing/webhooks/meta"}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(webhookStatus?.webhook_url || "/api/marketing/webhooks/meta");
                      toast.success(t("marketing.automation.webhook.urlCopied"));
                    }}
                    className="shrink-0 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-semibold"
                  >
                    {t("marketing.common.copy")}
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/60 p-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.webhook.subscribeFields")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(webhookStatus?.subscribed_fields || ["messages", "messaging_postbacks", "feed"]).map((field) => (
                    <span key={field} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] text-primary">{field}</span>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("marketing.automation.webhook.recentPayload")}</div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-[11px] leading-5 text-slate-300">{webhookPayloadPreview}</pre>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="m1-section-title">{t("marketing.automation.preview.title")}</h2>
                  <p className="text-xs text-slate-400">{t("marketing.automation.preview.subtitle")}</p>
                </div>
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm outline-none">
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>

              <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <div className="flex gap-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                    {previewContext.product_image ? <img src={previewContext.product_image} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-500"><ImageIcon className="h-6 w-6" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{previewContext.product_name}</div>
                    <div className="mt-1 text-lg font-black text-emerald-300">{previewContext.price} ج.م</div>
                    <div className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${Number(previewContext.stock) > 0 ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>
                      {Number(previewContext.stock) > 0 ? t("marketing.automation.preview.inStock", { count: previewContext.stock }) : t("marketing.automation.preview.outOfStock")}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-300">
                  <div className="flex flex-wrap gap-1.5">{previewContext.colors.slice(0, 6).map((color) => <span key={color} className="rounded-full bg-white/8 px-2 py-1">{color}</span>)}</div>
                  <div className="flex flex-wrap gap-1.5">{previewContext.sizes.slice(0, 8).map((size) => <span key={size} className="rounded-full border border-white/10 px-2 py-1">{size}</span>)}</div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-emerald-400/20 bg-[#0b1411] p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-100"><MessageCircle className="h-4 w-4" /> {t("marketing.automation.preview.whatsappDm")}</div>
                <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-emerald-500/20 px-3 py-2 text-sm leading-6 text-emerald-50 shadow-lg shadow-emerald-950/30">
                  <p className="whitespace-pre-wrap">{privatePreview}</p>
                  <div className="mt-2 flex justify-end gap-1 text-[10px] text-emerald-200"><span>{t("marketing.social.preview.now")}</span><Check className="h-3 w-3" /></div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="m1-section-title">{t("marketing.automation.intent.title")}</h2>
                  <p className="text-xs text-slate-400">{t("marketing.automation.intent.subtitle")}</p>
                </div>
                <Zap className="h-4 w-4 text-amber-300" />
              </div>
              <input value={sampleComment} onChange={(event) => setSampleComment(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2 text-sm outline-none" />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                {[
                  [t("marketing.automation.intent.price"), intents.price],
                  [t("marketing.automation.intent.availability"), intents.availability],
                  [t("marketing.automation.intent.variant"), intents.variant],
                ].map(([label, active]) => (
                  <div key={label} className={`rounded-xl border px-2 py-2 ${active ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/5 text-slate-400"}`}>{label}</div>
                ))}
              </div>
              <button type="button" onClick={simulateComment} disabled={simulating} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary disabled:opacity-60">
                <Send className="h-4 w-4" />
                {simulating ? t("marketing.automation.simulating") : t("marketing.automation.simulateComment")}
              </button>
            </section>
          </aside>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/20">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m1-section-title">{t("marketing.automation.marketingLeads")}</h2>
              {loadingActivity ? <Clock3 className="h-4 w-4 animate-pulse text-slate-400" /> : null}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {conversations.slice(0, 8).map((lead) => {
                const score = lead.lead_score || scoreLead(lead.last_customer_message || lead.last_message);
                const productImage = resolveProductImageUrl(lead.product_image || "");
                return (
                  <div key={lead.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                    <div className="flex gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-emerald-400/20 text-primary"><UserRound className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-bold">{lead.username || lead.user_platform_id}</div>
                          <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${leadScoreClass[score] || leadScoreClass.low}`}>{score}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><PlatformIcon platform={lead.platform} /> {lead.status || t("marketing.automation.status.new")} / {relativeTime(lead.updated_at)}</div>
                      </div>
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                        {productImage ? <img src={productImage} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-500"><ImageIcon className="h-4 w-4" /></div>}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-100">{lead.product_name || t("marketing.automation.manualFollowUp")}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-400">{lead.last_customer_message || lead.last_message}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(lead.matched_keyword ? [lead.matched_keyword] : splitKeywords(lead.last_customer_message || lead.last_message).slice(0, 1)).map((keyword) => <span key={keyword} className="rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">{keyword}</span>)}
                    </div>
                  </div>
                );
              })}
              {!conversations.length && !loadingActivity ? <div className="text-sm text-slate-400">{t("marketing.automation.noLeads")}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/20">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m1-section-title">{t("marketing.automation.recentComments")}</h2>
              <button type="button" onClick={loadActivity} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200">{t("marketing.automation.reload")}</button>
            </div>
            <div className="space-y-2">
              {events.slice(0, 8).map((event) => {
                const actions = event.automation_actions || {};
                const likedStatus = normalizeActionStatus(actions, "liked");
                const publicReplyStatus = normalizeActionStatus(actions, "public_reply", "replied");
                const privateReplyStatus = normalizeActionStatus(actions, "private_reply", "dm_sent");
                const actionError = actions.error_message || event.error_message;
                const score = event.lead_score || scoreLead(event.message);
                return (
                  <div key={event.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold"><PlatformIcon platform={event.platform} /> {event.username || event.user_platform_id || t("marketing.automation.customer")}</div>
                        <p className="mt-1 text-sm leading-6 text-slate-100">{event.message}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${event.status === "failed" ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}>{event.status}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={`rounded-full px-2 py-1 ${leadScoreClass[score] || leadScoreClass.low}`}>{t("marketing.automation.score", { score })}</span>
                      {event.matched_keyword ? <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{event.matched_keyword}</span> : null}
                      <ActionStatus icon={CheckCircle2} label={t("marketing.automation.actionLabels.like")} status={likedStatus} />
                      <ActionStatus icon={CircleDot} label={t("marketing.automation.actionLabels.public")} status={publicReplyStatus} />
                      <ActionStatus icon={Send} label={t("marketing.automation.actionLabels.private")} status={privateReplyStatus} />
                    </div>
                    {actionError ? <div className="mt-2 rounded-lg bg-rose-400/10 px-2 py-1.5 text-[11px] leading-5 text-rose-100">{actionError}</div> : null}
                  </div>
                );
              })}
              {!events.length && !loadingActivity ? <div className="text-sm text-slate-400">{t("marketing.automation.noComments")}</div> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
