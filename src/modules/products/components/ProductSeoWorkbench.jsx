import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Check,
  FileText,
  Globe,
  Link2,
  Loader2,
  Monitor,
  RefreshCw,
  Search,
  Share2,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";

import MultiVersionGenerator from "./MultiVersionGenerator";
import { SECTION_PANEL_CLASSES, buttonClasses } from "../lib/formChrome";
import { generateProductSeoMetadata } from "../services/productsApi";
import {
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  META_TITLE_MAX,
  META_TITLE_MIN,
  SLUG_MAX,
  auditProductSeo,
  countWords,
  joinKeywords,
  seoLengthTone,
  slugifyProductSlug,
  splitKeywords,
} from "../../../shared/lib/productSeoAudit";
import { STOREFRONT_ORIGIN, buildProductSeo } from "../../../shared/lib/productSeo";

/* Product Content & SEO workbench — one component for the Add and Edit routes.
 *
 * The parent owns every value (it already has the state, the touched flags and
 * the save payload). This component only renders, audits, previews and asks the
 * server for AI metadata; it hands results back through onChange / onApplySeo.
 *
 * The Google preview is not a mock-up: it is the same buildProductSeo() the
 * server-rendered product page uses, fed with the values on screen, so what the
 * merchant sees here is what the crawler will receive after save.
 */

const TAB_STORAGE_KEY = "erp.products.seoWorkbenchTab";
const TABS = ["description", "metadata", "preview"];
const STOREFRONT_HOST = STOREFRONT_ORIGIN.replace(/^https?:\/\//, "");

const readStoredTab = () => {
  if (typeof window === "undefined") return "description";
  try {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
    return TABS.includes(saved) ? saved : "description";
  } catch {
    return "description";
  }
};

const text = (value = "") => String(value ?? "").trim();

const ScoreRing = ({ score = 0, grade = "weak" }) => {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const tone = grade === "excellent" ? "text-success" : grade === "good" ? "text-warning" : "text-danger";
  return (
    <svg viewBox="0 0 64 64" className={`h-16 w-16 shrink-0 ${tone}`} aria-hidden="true">
      <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-border" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
        style={{ transition: "stroke-dashoffset 300ms ease" }}
      />
      <text x="32" y="37" textAnchor="middle" className="fill-current text-[15px] font-black">
        {score}
      </text>
    </svg>
  );
};

const LengthMeter = ({ length = 0, min = 0, max = 1, label = "" }) => {
  const tone = seoLengthTone(length, min, max);
  const percent = Math.min(100, Math.round((length / (max * 1.15)) * 100));
  const bar = tone === "ok" ? "bg-success" : tone === "empty" ? "bg-border" : "bg-warning";
  const toneText = tone === "ok" ? "text-success" : tone === "empty" ? "text-text-muted" : "text-warning";
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-text-muted">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={toneText}>{label}</span>
    </div>
  );
};

const checkLabel = (t, id) => {
  switch (id) {
    case "metaTitle":
      return t("products.editor.seoWorkbench.checks.metaTitle");
    case "metaDescription":
      return t("products.editor.seoWorkbench.checks.metaDescription");
    case "slug":
      return t("products.editor.seoWorkbench.checks.slug");
    case "keywords":
      return t("products.editor.seoWorkbench.checks.keywords");
    case "descriptionAr":
      return t("products.editor.seoWorkbench.checks.descriptionAr");
    case "descriptionEn":
      return t("products.editor.seoWorkbench.checks.descriptionEn");
    case "coverImage":
      return t("products.editor.seoWorkbench.checks.coverImage");
    case "brandInTitle":
      return t("products.editor.seoWorkbench.checks.brandInTitle");
    default:
      return id;
  }
};

const lengthLabel = (t, length, min, max) => {
  const tone = seoLengthTone(length, min, max);
  const count = t("products.editor.seoWorkbench.charsCount", { count: length });
  if (tone === "empty") return t("products.editor.seoWorkbench.lengthEmpty");
  if (tone === "short") return `${count} · ${t("products.editor.seoWorkbench.lengthShort")}`;
  if (tone === "long") return `${count} · ${t("products.editor.seoWorkbench.lengthLong")}`;
  return `${count} · ${t("products.editor.seoWorkbench.lengthOk")}`;
};

const inputClasses =
  "w-full rounded-[var(--radius-control)] border border-border bg-surface px-3.5 text-sm text-text outline-none transition placeholder:text-text-muted hover:border-primary/40 focus:border-primary";

const ProductSeoWorkbench = ({
  t,
  values = {},
  placeholders = {},
  onChange,
  onApplySeo,
  descriptionContext = {},
  descriptionGenerating = { ar: false, en: false },
  onRegenerateDescriptions,
  onApplyVersion,
  resolveImageUrl = (value) => value,
}) => {
  const [activeTab, setActiveTab] = useState(readStoredTab);
  const [seoGenerating, setSeoGenerating] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [previewDevice, setPreviewDevice] = useState("desktop");

  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      // Storage can be unavailable; the tab still works for this render.
    }
  }, [activeTab]);

  const name = text(values.name);
  const brand = text(values.brand);
  const metaTitle = String(values.metaTitle ?? "");
  const seoDescription = String(values.seoDescription ?? "");
  const seoKeywords = String(values.seoKeywords ?? "");
  const canonicalSlug = String(values.canonicalSlug ?? "");
  const descriptionAr = String(values.descriptionAr ?? "");
  const descriptionEn = String(values.descriptionEn ?? "");
  const tone = String(values.tone ?? "");
  const coverImage = values.coverImage || "";

  const keywords = useMemo(() => splitKeywords(seoKeywords), [seoKeywords]);
  const audit = useMemo(
    () =>
      auditProductSeo({
        name,
        brand,
        metaTitle,
        seoDescription,
        seoKeywords,
        canonicalSlug,
        descriptionAr,
        descriptionEn,
        coverImage,
      }),
    [brand, canonicalSlug, coverImage, descriptionAr, descriptionEn, metaTitle, name, seoDescription, seoKeywords]
  );

  const previewSeo = useMemo(
    () =>
      buildProductSeo({
        name: name || t("products.editor.seoWorkbench.previewEmptyTitle"),
        brand,
        meta_title: metaTitle || placeholders.metaTitle || "",
        seo_description: seoDescription || placeholders.seoDescription || "",
        description_ar: descriptionAr,
        description_en: descriptionEn,
        seo_keywords: seoKeywords,
        canonical_slug: canonicalSlug || placeholders.canonicalSlug || "",
        image_url: coverImage ? resolveImageUrl(coverImage) : "",
      }),
    [brand, canonicalSlug, coverImage, descriptionAr, descriptionEn, metaTitle, name, placeholders, resolveImageUrl, seoDescription, seoKeywords, t]
  );

  const previewPath = previewSeo.canonical.replace(STOREFRONT_ORIGIN, "");
  const previewDescription = previewSeo.description || t("products.editor.seoWorkbench.previewEmptyDescription");

  const gradeLabel =
    audit.grade === "excellent"
      ? t("products.editor.seoWorkbench.gradeExcellent")
      : audit.grade === "good"
        ? t("products.editor.seoWorkbench.gradeGood")
        : t("products.editor.seoWorkbench.gradeWeak");

  const emit = (field, value) => {
    if (typeof onChange === "function") onChange(field, value);
  };

  const commitKeywords = (next) => emit("seo_keywords", joinKeywords(next));

  const addKeywordFromDraft = () => {
    const additions = splitKeywords(keywordDraft);
    if (!additions.length) return;
    commitKeywords([...keywords, ...additions]);
    setKeywordDraft("");
  };

  const removeKeyword = (index) => commitKeywords(keywords.filter((_, position) => position !== index));

  const handleKeywordKeyDown = (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addKeywordFromDraft();
      return;
    }
    if (event.key === "Backspace" && !keywordDraft && keywords.length) {
      event.preventDefault();
      removeKeyword(keywords.length - 1);
    }
  };

  const generateSeoWithAi = async () => {
    if (!name) {
      toast.error(t("products.editor.seoWorkbench.nameRequired"));
      return;
    }
    setSeoGenerating(true);
    try {
      const result = await generateProductSeoMetadata({
        prompt_customization: tone,
        current: {
          ...descriptionContext,
          product_name: name,
          brand: brand || descriptionContext.brand,
          description_ar: descriptionAr,
          description_en: descriptionEn,
        },
      });
      const next = {
        meta_title: text(result?.meta_title),
        seo_description: text(result?.meta_description),
        seo_keywords: joinKeywords(Array.isArray(result?.keywords) ? result.keywords : []),
        canonical_slug: slugifyProductSlug(result?.slug || ""),
      };
      if (!next.meta_title && !next.seo_description) {
        throw new Error(t("products.editor.seoWorkbench.generateFailed"));
      }
      if (typeof onApplySeo === "function") onApplySeo(next);
      if (result?.source && result.source !== "LOCAL_FALLBACK") toast.success(t("products.editor.seoWorkbench.generatedAi"));
      else toast(t("products.editor.seoWorkbench.generatedLocal"));
    } catch (error) {
      console.error("[product-seo-workbench] generation failed", error);
      // The frontend ships from Vercel on push while the backend is deployed
      // separately; until the route exists the merchant still gets metadata.
      if (Number(error?.status) === 404) {
        applyLocalTemplate();
        toast(t("products.editor.seoWorkbench.generatedLocal"));
        return;
      }
      toast.error(error?.message || t("products.editor.seoWorkbench.generateFailed"));
    } finally {
      setSeoGenerating(false);
    }
  };

  const applyLocalTemplate = () => {
    if (typeof onApplySeo !== "function") return;
    onApplySeo({
      meta_title: text(placeholders.metaTitle),
      seo_description: text(placeholders.seoDescription),
      seo_keywords: joinKeywords(splitKeywords(placeholders.seoKeywords || "")),
      canonical_slug: slugifyProductSlug(placeholders.canonicalSlug || `${brand} ${name}`),
    });
  };

  const tabButton = (id, Icon, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setActiveTab(id)}
      aria-pressed={activeTab === id}
      className={`inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border px-3 text-xs font-bold transition ${
        activeTab === id
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-surface-soft text-text hover:border-border-strong hover:bg-surface-hover"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  const descriptionTab = (
    <div className="space-y-4">
      <div className={`${SECTION_PANEL_CLASSES} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-text">{t("products.editor.customerDescriptionShortTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t("products.editor.seoWorkbench.descriptionHelp")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onRegenerateDescriptions?.("ar")}
              disabled={descriptionGenerating.ar}
              className={buttonClasses("secondary", "h-[var(--control-height-md)] rounded-[var(--radius-control)] px-3 text-xs")}
            >
              {descriptionGenerating.ar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {descriptionGenerating.ar ? t("products.editor.generatingArabic") : t("products.editor.regenerateArabic")}
            </button>
            <button
              type="button"
              onClick={() => onRegenerateDescriptions?.("en")}
              disabled={descriptionGenerating.en}
              className={buttonClasses("secondary", "h-[var(--control-height-md)] rounded-[var(--radius-control)] px-3 text-xs")}
            >
              {descriptionGenerating.en ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {descriptionGenerating.en ? t("products.editor.generatingEnglish") : t("products.editor.regenerateEnglish")}
            </button>
            <button
              type="button"
              onClick={() => onRegenerateDescriptions?.("all")}
              disabled={descriptionGenerating.ar || descriptionGenerating.en}
              className={buttonClasses("primary", "h-[var(--control-height-md)] rounded-[var(--radius-control)] px-3 text-xs")}
            >
              {descriptionGenerating.ar && descriptionGenerating.en ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {descriptionGenerating.ar && descriptionGenerating.en ? t("products.editor.generating") : t("products.editor.regenerateAll")}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <label className="text-sm font-semibold text-text">{t("products.editor.promptCustomization")}</label>
            <input
              value={tone}
              onChange={(event) => emit("tone", event.target.value)}
              placeholder={t("products.editor.promptPlaceholder")}
              className={`${inputClasses} mt-1.5 h-[var(--control-height-lg)]`}
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-text">{t("products.editor.arabicDescription")}</label>
              <span className="text-[11px] font-semibold text-text-muted">{t("products.editor.seoWorkbench.wordsCount", { count: countWords(descriptionAr) })}</span>
            </div>
            <textarea
              value={descriptionAr}
              onChange={(event) => emit("description_ar", event.target.value)}
              rows={7}
              dir="rtl"
              placeholder={placeholders.descriptionAr || ""}
              className={`${inputClasses} mt-1.5 py-3 leading-6`}
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-text">{t("products.editor.englishDescription")}</label>
              <span className="text-[11px] font-semibold text-text-muted">{t("products.editor.seoWorkbench.wordsCount", { count: countWords(descriptionEn) })}</span>
            </div>
            <textarea
              value={descriptionEn}
              onChange={(event) => emit("description_en", event.target.value)}
              rows={7}
              dir="ltr"
              placeholder={placeholders.descriptionEn || ""}
              className={`${inputClasses} mt-1.5 py-3 leading-6`}
            />
          </div>
        </div>
      </div>

      <MultiVersionGenerator context={descriptionContext} onApplyVersion={onApplyVersion} t={t} />
    </div>
  );

  const metadataTab = (
    <div className={`${SECTION_PANEL_CLASSES} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-text">{t("products.editor.seoMetadata")}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">{t("products.editor.seoWorkbench.metadataHelp")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyLocalTemplate}
            disabled={seoGenerating}
            className={buttonClasses("secondary", "h-[var(--control-height-md)] rounded-[var(--radius-control)] px-3 text-xs")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("products.editor.seoWorkbench.applyTemplate")}
          </button>
          <button
            type="button"
            onClick={generateSeoWithAi}
            disabled={seoGenerating}
            className={buttonClasses("primary", "h-[var(--control-height-md)] rounded-[var(--radius-control)] px-3 text-xs")}
          >
            {seoGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {seoGenerating ? t("products.editor.seoWorkbench.generating") : t("products.editor.seoWorkbench.generateAi")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <label className="text-sm font-semibold text-text">{t("products.editor.seoWorkbench.metaTitle")}</label>
          <p className="mt-0.5 text-[11px] text-text-muted">{t("products.editor.seoWorkbench.metaTitleHelp")}</p>
          <input
            value={metaTitle}
            dir="auto"
            onChange={(event) => emit("meta_title", event.target.value)}
            placeholder={placeholders.metaTitle || ""}
            className={`${inputClasses} mt-1.5 h-[var(--control-height-lg)] font-semibold`}
          />
          <LengthMeter length={metaTitle.trim().length} min={META_TITLE_MIN} max={META_TITLE_MAX} label={lengthLabel(t, metaTitle.trim().length, META_TITLE_MIN, META_TITLE_MAX)} />
        </div>

        <div className="lg:col-span-2">
          <label className="text-sm font-semibold text-text">{t("products.editor.seoWorkbench.metaDescription")}</label>
          <p className="mt-0.5 text-[11px] text-text-muted">{t("products.editor.seoWorkbench.metaDescriptionHelp")}</p>
          <textarea
            value={seoDescription}
            dir="auto"
            onChange={(event) => emit("seo_description", event.target.value)}
            rows={3}
            placeholder={placeholders.seoDescription || ""}
            className={`${inputClasses} mt-1.5 py-2.5 leading-6`}
          />
          <LengthMeter
            length={seoDescription.trim().length}
            min={META_DESCRIPTION_MIN}
            max={META_DESCRIPTION_MAX}
            label={lengthLabel(t, seoDescription.trim().length, META_DESCRIPTION_MIN, META_DESCRIPTION_MAX)}
          />
        </div>

        <div>
          <label className="text-sm font-semibold text-text">{t("products.editor.seoWorkbench.keywords")}</label>
          <p className="mt-0.5 text-[11px] text-text-muted">{t("products.editor.seoWorkbench.keywordsHelp")}</p>
          <div className={`${inputClasses} mt-1.5 flex min-h-[var(--control-height-lg)] flex-wrap items-center gap-1.5 py-1.5`}>
            {keywords.map((keyword, index) => (
              <span
                key={`${keyword}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
              >
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(index)}
                  aria-label={t("products.editor.seoWorkbench.removeKeyword")}
                  className="rounded-full p-0.5 transition hover:bg-primary/20"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              value={keywordDraft}
              dir="auto"
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={handleKeywordKeyDown}
              onBlur={addKeywordFromDraft}
              placeholder={keywords.length ? "" : t("products.editor.seoWorkbench.keywordPlaceholder")}
              className="min-w-[140px] flex-1 bg-transparent py-1 text-sm text-text outline-none placeholder:text-text-muted"
            />
          </div>
          <p className="mt-1.5 text-[11px] font-semibold text-text-muted">{t("products.editor.seoWorkbench.keywordsCount", { count: keywords.length })}</p>
        </div>

        <div>
          <label className="text-sm font-semibold text-text">{t("products.editor.seoWorkbench.slug")}</label>
          <p className="mt-0.5 text-[11px] text-text-muted">{t("products.editor.seoWorkbench.slugHelp")}</p>
          <div className="mt-1.5 flex items-stretch gap-2">
            <div className={`${inputClasses} flex h-[var(--control-height-lg)] min-w-0 flex-1 items-center gap-1 font-mono text-[13px]`} dir="ltr">
              <span className="shrink-0 text-text-muted">{`${STOREFRONT_HOST}/product/`}</span>
              <input
                value={canonicalSlug}
                dir="ltr"
                onChange={(event) => emit("canonical_slug", event.target.value)}
                onBlur={(event) => {
                  const cleaned = slugifyProductSlug(event.target.value);
                  if (cleaned !== event.target.value) emit("canonical_slug", cleaned);
                }}
                placeholder={placeholders.canonicalSlug || ""}
                maxLength={SLUG_MAX}
                className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-muted"
              />
            </div>
            <button
              type="button"
              onClick={() => emit("canonical_slug", slugifyProductSlug(`${brand} ${name}`))}
              disabled={!name}
              className={buttonClasses("secondary", "h-[var(--control-height-lg)] shrink-0 rounded-[var(--radius-control)] px-3 text-xs")}
            >
              <Link2 className="h-3.5 w-3.5" />
              {t("products.editor.seoWorkbench.slugFromName")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const googleCard = (
    <div className={`${SECTION_PANEL_CLASSES} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
          <Search size={14} />
          {t("products.editor.googlePreview")}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setPreviewDevice("desktop")}
            aria-pressed={previewDevice === "desktop"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[11px] font-bold transition ${previewDevice === "desktop" ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface-soft text-text-muted"}`}
          >
            <Monitor size={13} />
            {t("products.editor.seoWorkbench.googleDesktop")}
          </button>
          <button
            type="button"
            onClick={() => setPreviewDevice("mobile")}
            aria-pressed={previewDevice === "mobile"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[11px] font-bold transition ${previewDevice === "mobile" ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface-soft text-text-muted"}`}
          >
            <Smartphone size={13} />
            {t("products.editor.seoWorkbench.googleMobile")}
          </button>
        </div>
      </div>
      {/* Deliberate white matte: a Google result is always white, in both themes. */}
      <div className={`mt-3 rounded-[var(--radius-card)] border border-border bg-white p-4 text-[#202124] ${previewDevice === "mobile" ? "mx-auto max-w-[380px]" : ""}`} dir="auto">
        <div className="flex items-center gap-2.5" dir="ltr">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dadce0] bg-[#f1f3f4] text-[#5f6368]">
            <Globe size={14} />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-medium text-[#202124]">{STOREFRONT_HOST}</p>
            <p className="truncate text-[12px] text-[#4d5156]">{`${STOREFRONT_HOST}${previewPath}`}</p>
          </div>
        </div>
        <p className={`mt-2 text-[#1a0dab] ${previewDevice === "mobile" ? "line-clamp-2 text-[18px] leading-6" : "line-clamp-1 text-[20px] leading-7"}`}>{previewSeo.title}</p>
        <p className="mt-1 line-clamp-2 text-[14px] leading-[22px] text-[#4d5156]">{previewDescription}</p>
      </div>
    </div>
  );

  const socialCard = (
    <div className={`${SECTION_PANEL_CLASSES} p-4`}>
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
        <Share2 size={14} />
        {t("products.editor.facebookWhatsappPreview")}
      </div>
      <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {/* White matte on purpose: product photography is shot on white and the
            Open Graph card must not follow the theme. */}
        <div className="relative aspect-[1.91/1] w-full overflow-hidden bg-white">
          {coverImage ? (
            <img src={resolveImageUrl(coverImage)} alt={t("products.editor.openGraphPreviewAlt")} className="h-full w-full bg-white object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-soft">
              <Share2 className="text-text-muted" size={28} />
            </div>
          )}
        </div>
        <div className="border-t border-border bg-surface-soft p-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted" dir="ltr">{STOREFRONT_HOST}</p>
          <p className="mt-1 line-clamp-1 text-sm font-black text-text">{previewSeo.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">{previewDescription}</p>
        </div>
      </div>
    </div>
  );

  const crawlerCard = (
    <div className={`${SECTION_PANEL_CLASSES} p-4`}>
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
        <FileText size={14} />
        {t("products.editor.seoWorkbench.whatGoogleSees")}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
        <dt className="font-semibold text-text-muted">{t("products.editor.seoWorkbench.canonicalUrl")}</dt>
        <dd className="truncate font-mono text-text" dir="ltr">{previewSeo.canonical}</dd>
        <dt className="font-semibold text-text-muted">{t("products.editor.seoWorkbench.robots")}</dt>
        <dd className="font-mono text-text" dir="ltr">{previewSeo.robots}</dd>
        <dt className="font-semibold text-text-muted">{t("products.editor.seoWorkbench.language")}</dt>
        <dd className="font-mono text-text" dir="ltr">{previewSeo.locale}</dd>
        <dt className="font-semibold text-text-muted">{t("products.editor.seoWorkbench.structuredData")}</dt>
        <dd className="text-text">{t("products.editor.seoWorkbench.structuredDataHelp")}</dd>
        <dt className="font-semibold text-text-muted">{t("products.editor.seoWorkbench.keywords")}</dt>
        <dd className="text-text" dir="auto">{keywords.length ? keywords.join("، ") : t("products.editor.notSet")}</dd>
      </dl>
    </div>
  );

  const previewTab = (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {googleCard}
        {crawlerCard}
      </div>
      {socialCard}
    </div>
  );

  return (
    <div className="mt-4 space-y-4">
      <div className={`${SECTION_PANEL_CLASSES} p-4`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <ScoreRing score={audit.score} grade={audit.grade} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-black text-text">{t("products.editor.seoWorkbench.score")}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                    audit.grade === "excellent"
                      ? "border border-success/25 bg-success-subtle text-success"
                      : audit.grade === "good"
                        ? "border border-warning/25 bg-warning-subtle text-warning"
                        : "border border-danger/25 bg-danger-subtle text-danger"
                  }`}
                >
                  {gradeLabel}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">{t("products.editor.seoWorkbench.scoreHelp")}</p>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:min-w-[440px]">
            {audit.checks.map((check) => (
              <li key={check.id} className="flex items-center gap-2 text-xs font-semibold text-text">
                {check.status === "pass" ? (
                  <Check size={14} className="shrink-0 text-success" />
                ) : check.status === "warn" ? (
                  <AlertTriangle size={14} className="shrink-0 text-warning" />
                ) : (
                  <X size={14} className="shrink-0 text-danger" />
                )}
                <span className={check.status === "pass" ? "text-text-muted" : "text-text"}>{checkLabel(t, check.id)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-2">
          {tabButton("description", FileText, t("products.editor.seoWorkbench.tabDescription"))}
          {tabButton("metadata", Search, t("products.editor.seoWorkbench.tabMetadata"))}
          {tabButton("preview", Globe, t("products.editor.seoWorkbench.tabPreview"))}
        </div>
      </div>

      {activeTab === "description" ? descriptionTab : null}
      {activeTab === "metadata" ? metadataTab : null}
      {activeTab === "preview" ? previewTab : null}
    </div>
  );
};

export default ProductSeoWorkbench;
