// Site Studio — the one place the public storefront's look is decided.
//
// It edits a single stored record (`storefront.site_design`) that re-points the
// CSS tokens the site is already built on, so a change here reaches every
// storefront page at once: the header, the product cards, the footer, the
// homepage layer and the hero video overlay. It does not touch the ERP — the
// generated stylesheet is scoped to `body.storefront-shell`.
//
// The preview on the right is not a mock-up. It renders the real hero markup
// through the real stylesheet (see `:is(.storefront-shell, .sf-hero-preview)`
// in index.css) with the real clip behind it, and the swatch panel is fed the
// same custom properties the storefront will get. What you see is what ships.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, CreditCard, Eye, EyeOff, Globe, Headphones, LayoutGrid, LayoutList, Loader2, Monitor, Moon, Palette, Plus, RefreshCcw, RotateCcw, Save, Sun, Trash2, Truck, Type, Video } from "lucide-react";

import { Badge, Button, Input, PageHeader, Select, Switch, Textarea } from "../../../shared/ui/M1UI";
import { api } from "../../../shared/api/api";
import { resetPublicSettingsCache } from "../../../shared/api/publicSettings";
import { hasPermission } from "../../../shared/auth/authStorage";
import {
  ARABIC_FONTS,
  LATIN_FONTS,
  arabicFontStack,
  ensureCatalogFontsLoaded,
  latinFontStack,
} from "../../../theme/appearance";
import {
  DEFAULT_SITE_DESIGN,
  HERO_TEXT_ALIGNMENTS,
  HERO_TEXT_POSITIONS,
  PALETTE_FIELDS,
  SITE_DESIGN_SETTING_KEY,
  CARD_TEMPLATES,
  SITE_RADIUS_PROFILES,
  STRIP_MAX_ITEMS,
  TITLED_HOME_SECTIONS,
  GENDER_LABELS,
  HOME_FILTER_ROW_MAP,
  HOME_SECTION_MAP,
  isSafeCssColor,
  normalizeSiteDesign,
  resolveCardLook,
  resolveHeroCopy,
  resolveHomeSections,
  resolveSectionTitle,
  resolveStripItems,
  siteDesignPreviewVariables,
} from "../../../../shared/siteDesign.js";
// The homepage stylesheet, so the card templates preview through the rules the
// storefront actually uses. Every selector in it is scoped to ".m1h", which only
// the preview stage below carries, so it cannot reach the rest of the ERP.
import "../../../storefront/home/home.css";
import "./SiteStudio.m1.css";

const TABS = [
  { id: "colors", icon: Palette },
  { id: "type", icon: Type },
  { id: "hero", icon: Video },
  { id: "cards", icon: LayoutGrid },
  { id: "bands", icon: LayoutList },
  { id: "sections", icon: LayoutList },
];

// The five promises the storefront falls back to when the owner has written
// none of their own. They are read from the storefront's own bundle, which the
// ERP already loads as a branch of its dictionary, so the preview shows the
// real sentences instead of a second copy that can drift from them.
const DEFAULT_PROMISE_KEYS = ["fastShipping", "exchange", "cod", "premium", "todayDeals"];

const localized = (value, language) => (value && typeof value === "object" ? value[language] || value.en : value);

// `<input type="color">` only speaks 6-digit hex. A palette entry may legally be
// an rgba() string (the dark borders are), so the swatch shows the nearest thing
// it can render and the text field beside it stays the source of truth.
const swatchValue = (value) => {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split("").map((digit) => digit + digit).join("")}`;
  }
  return "#000000";
};

const setIn = (design, path, value) => {
  const next = JSON.parse(JSON.stringify(design));
  let cursor = next;
  for (let index = 0; index < path.length - 1; index += 1) cursor = cursor[path[index]];
  cursor[path[path.length - 1]] = value;
  return next;
};

function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div className="m1-site__segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === value ? "is-active" : ""}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

// Two controls for one colour — a picker and the literal text — so an owner can
// point at a shade OR paste the exact brand hex. A `<label>` cannot wrap both
// (it would silently name only the first), so each carries its own name.
function ColorRow({ label, value, onChange }) {
  const invalid = !isSafeCssColor(value);
  return (
    <div className={`m1-site__color${invalid ? " is-invalid" : ""}`}>
      <span className="m1-site__color-label" id={`${label}-name`}>
        {label}
      </span>
      <span className="m1-site__color-controls">
        <input
          type="color"
          className="m1-site__color-swatch"
          value={swatchValue(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          invalid={invalid}
          spellCheck={false}
        />
      </span>
    </div>
  );
}

// Bilingual copy always edits both languages side by side. Splitting them into
// two tabs is how a store ends up shipping an English headline to Arabic
// readers for a month without anyone noticing.
function BilingualField({ label, value, onChange, long = false, maxLength }) {
  const Control = long ? Textarea : Input;
  return (
    <div className="m1-site__bilingual">
      <span className="m1-site__field-label">{label}</span>
      <div className="m1-site__bilingual-grid">
        <label>
          <span>AR</span>
          <Control
            value={value?.ar || ""}
            maxLength={maxLength}
            rows={long ? 2 : undefined}
            onChange={(event) => onChange({ ...value, ar: event.target.value })}
          />
        </label>
        <label>
          <span>EN</span>
          <Control
            value={value?.en || ""}
            maxLength={maxLength}
            rows={long ? 2 : undefined}
            onChange={(event) => onChange({ ...value, en: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

export default function SiteStudio() {
  const { t, i18n } = useTranslation();
  const language = i18n.language?.startsWith("en") ? "en" : "ar";
  const tr = useCallback((key, options) => t(`siteStudio.${key}`, options), [t]);

  const [design, setDesign] = useState(() => normalizeSiteDesign(DEFAULT_SITE_DESIGN));
  const [saved, setSaved] = useState(() => normalizeSiteDesign(DEFAULT_SITE_DESIGN));
  const [tab, setTab] = useState("colors");
  const [mode, setMode] = useState("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef(null);

  const canEdit = hasPermission("settings.edit");

  useEffect(() => {
    ensureCatalogFontsLoaded();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/settings/storefront", { perfComponent: "SiteStudio.load" })
      .then((response) => {
        if (cancelled) return;
        const rows = Array.isArray(response?.settings) ? response.settings : [];
        const stored = rows.find((row) => row?.key === SITE_DESIGN_SETTING_KEY)?.value;
        const next = normalizeSiteDesign(stored || DEFAULT_SITE_DESIGN);
        setDesign(next);
        setSaved(next);
      })
      .catch(() => {
        // A failed read leaves the shipped defaults on screen. Saving from there
        // is still correct — it writes exactly what the site already looks like.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The homepage running order, resolved exactly the way the storefront resolves
  // it. It is read this high up because the hero clip only exists while the hero
  // section is in that order: the play effect below has to run again when the
  // section comes back, or re-enabling it leaves a frozen first frame.
  const previewSections = useMemo(() => resolveHomeSections(design), [design]);
  const heroInPreview = previewSections.includes("heroVideo");

  // The preview clip is muted, looping scenery exactly as it is on the site;
  // the attribute (not the React prop) is what a browser's autoplay check reads.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.setAttribute("muted", "");
    const attempt = video.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
  }, [heroInPreview]);

  const dirty = useMemo(() => JSON.stringify(design) !== JSON.stringify(saved), [design, saved]);
  const previewVars = useMemo(() => siteDesignPreviewVariables(design, mode), [design, mode]);
  const heroCopy = useMemo(() => resolveHeroCopy(design, language), [design, language]);
  const cardLook = useMemo(() => resolveCardLook(design), [design]);
  const cardClassName = [
    "m1h-card",
    cardLook.className,
    cardLook.showBrand ? "" : "m1h-card--no-brand",
    cardLook.showBadge ? "" : "m1h-card--no-badge",
  ].filter(Boolean).join(" ");
  const fontStack = useMemo(
    () => (language === "ar" ? arabicFontStack(design.fontAr) : latinFontStack(design.fontEn, design.fontAr)),
    [design.fontAr, design.fontEn, language]
  );

  // ---- the preview, as a scale model of the homepage ---------------------
  //
  // Six tabs decide this record and the stage used to draw two of them. The
  // strip, the footer, the section order and the section headings had no
  // picture at all, so those tabs were being edited blind. The stage now renders
  // the page the record describes - strip, header, the sections in their stored
  // order, footer - through the storefront's own classes wherever they exist.
  //
  // Every section is drawn from the same registry Storefront.jsx renders from,
  // and an id with no drawing of its own falls through to a labelled band, so a
  // section added to HOME_SECTIONS appears here the day it is added instead of
  // being quietly missing from the preview.
  const hiddenSectionCount = design.sections.length - previewSections.length;

  // What the strip will actually say: the owner's promises when they wrote any,
  // the five shipped ones when they did not, and none at all when they are off -
  // with the band still drawn, because the language and theme controls live in
  // it and "off" has never meant "no strip".
  const stripPromises = useMemo(() => {
    const own = resolveStripItems(design, language);
    if (own === null) return [];
    return own.length ? own : DEFAULT_PROMISE_KEYS.map((key) => t(`storefront.header.announcements.${key}`));
  }, [design, language, t]);

  // Real card markup and the real home.css rules, not a lookalike: the whole
  // point of a card template picker is that the thing you pick is the thing you
  // get. Only the photograph is a stand-in.
  const previewCards = (
    <div className="m1-site__mock-grid">
      {[0, 1, 2, 3].map((index) => (
        <article key={index} className={cardClassName}>
          <div className="m1h-card__plate">
            {index === 1 ? <span className="m1h-badge m1h-badge--sale">-24%</span> : null}
            <span className="m1-site__mock-plate" aria-hidden="true" />
          </div>
          <div className="m1h-card__body">
            <p className="m1h-card__brand">{tr("mockBrand")}</p>
            {/* <p>, like every other line of copy in the stage: the preview is a
                picture of a page, and twenty-four <h3>s for products that do not
                exist would put a fake outline in front of a screen reader. */}
            <p className="m1h-card__name">{tr("mockProduct")}</p>
            <div className="m1h-card__price">
              <span className={`m1h-card__price-now${index === 1 ? " m1h-card__price-now--sale" : ""}`}>1,450</span>
              {index === 1 ? <span className="m1h-card__price-was">1,900</span> : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );

  // The hero is the one section that is not inside a shell: it bleeds to the
  // edges on the site, so it does here too. It renders through the REAL overlay
  // rules (:is(.storefront-shell, .sf-hero-preview) in index.css) with the real
  // clip behind it.
  const heroSection = (
    <div className="sf-hero-preview">
      <div className="sf-hero-video">
        <video
          ref={videoRef}
          className="sf-hero-video__media is-ready"
          src="/media/hero-walk.mp4"
          autoPlay
          muted
          loop
          playsInline
          controls={false}
          tabIndex={-1}
          aria-hidden="true"
        />
        {heroCopy ? (
          <div className={`sf-hero-video__overlay is-${heroCopy.position} is-align-${heroCopy.align}`}>
            <div className="sf-hero-video__scrim" aria-hidden="true" />
            <div className="sf-hero-video__copy">
              {heroCopy.eyebrow ? <span className="sf-hero-video__eyebrow">{heroCopy.eyebrow}</span> : null}
              <p className="sf-hero-video__title">{heroCopy.title}</p>
              {heroCopy.subtitle ? <p className="sf-hero-video__sub">{heroCopy.subtitle}</p> : null}
              <div className="sf-hero-video__actions">
                {heroCopy.primaryLabel ? <span className="sf-hero-video__cta">{heroCopy.primaryLabel}</span> : null}
                {heroCopy.secondaryLabel ? (
                  <span className="sf-hero-video__cta sf-hero-video__cta--ghost">{heroCopy.secondaryLabel}</span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  const previewBand = (id, children) => (
    <section key={id} className="m1h-block">
      <div className="m1h-shell">{children}</div>
    </section>
  );

  // Headings inside the stage are <p>, not <h2>: the preview is a picture of a
  // page, and a real heading outline for a page that is not this one would put a
  // second, fake document structure in front of a screen reader.
  const renderPreviewSection = (id) => {
    const label = localized(HOME_SECTION_MAP[id]?.label, language) || id;
    const filterRow = HOME_FILTER_ROW_MAP[id];

    if (id === "heroVideo") return <Fragment key={id}>{heroSection}</Fragment>;

    if (id === "productHero") {
      return previewBand(
        id,
        <div className="m1-site__mock-hero">
          <div className="m1-site__mock-hero-copy">
            <p className="m1h-hero__eyebrow">{tr("mockBrand")}</p>
            <p className="m1h-hero__title">{label}</p>
            <p className="m1h-hero__sub">{tr("mockProduct")}</p>
            <span className="m1h-btn m1h-btn--primary">{tr("mockCta")}</span>
          </div>
          <span className="m1-site__mock-frame" aria-hidden="true">
            <span className="m1-site__mock-plate" />
          </span>
        </div>
      );
    }

    if (id === "categories") {
      return previewBand(
        id,
        <>
          <div className="m1h-sec">
            <p className="m1h-sec__title">{resolveSectionTitle(design, "categories", language)}</p>
          </div>
          <div className="m1-site__mock-cats">
            {[0, 1, 2].map((index) => (
              <span key={index} className="m1h-cat">
                <span className="m1-site__mock-plate" aria-hidden="true" />
                <span className="m1h-cat__scrim" />
                <span className="m1h-cat__label">{tr("mockCategory")}</span>
              </span>
            ))}
          </div>
        </>
      );
    }

    // A filtered row carries its own heading, its own sentence and its audience
    // switch. None of the three is editable, and all three are part of what the
    // colours, the corner shape and the card template have to look right against.
    if (filterRow) {
      return previewBand(
        id,
        <>
          <div className="m1h-frow__head">
            <div className="m1h-frow__topline">
              <p className="m1h-sec__title">{localized(filterRow.label, language)}</p>
              {filterRow.genders.length > 1 ? (
                <div className="m1h-frow__tabs" aria-hidden="true">
                  {filterRow.genders.map((gender, index) => (
                    <span key={gender} className={`m1h-frow__tab${index === 0 ? " is-on" : ""}`}>
                      {localized(GENDER_LABELS[gender], language)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="m1h-frow__sub">{localized(filterRow.subtitle, language)}</p>
          </div>
          {previewCards}
        </>
      );
    }

    if (id === "offers") {
      return previewBand(
        id,
        <>
          <div className="m1h-sec">
            <p className="m1h-sec__title">{label}</p>
            <span className="m1h-sec__link">{tr("mockCta")}</span>
          </div>
          {previewCards}
          <div className="m1-site__mock-foot">
            <span className="m1-site__mock-pill">{tr("mockSale")}</span>
            <span className="m1-site__mock-cta">{tr("mockCta")}</span>
          </div>
        </>
      );
    }

    if (id === "brands") {
      return previewBand(
        id,
        <>
          <div className="m1h-sec">
            <p className="m1h-sec__title">{label}</p>
          </div>
          <div className="m1-site__mock-brands" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index} className="m1-site__mock-brand" />
            ))}
          </div>
        </>
      );
    }

    if (id === "trust") {
      return previewBand(
        id,
        <div className="m1h-trust">
          {[Truck, CreditCard, RefreshCcw, Headphones].map((Icon, index) => (
            <div key={index} className="m1h-trust__item">
              <Icon className="m1h-trust__icon" size={20} strokeWidth={1.6} aria-hidden="true" />
              <span className="m1-site__mock-line is-strong" aria-hidden="true" />
              <span className="m1-site__mock-line" aria-hidden="true" />
            </div>
          ))}
        </div>
      );
    }

    // A section this file has no drawing for still has a place in the order, so
    // it is shown as a named band rather than disappearing from the preview.
    return previewBand(
      id,
      <div className="m1-site__mock-band">
        <p className="m1h-sec__title">{label}</p>
      </div>
    );
  };

  const palette = design.palette[mode];
  const update = (path, value) => setDesign((current) => setIn(current, path, value));

  // Swaps a section with its neighbour. Order is stored as a list, not as an
  // index on each section, so a move is a swap and nothing else can drift.
  const moveSection = (index, delta) => {
    const target = index + delta;
    setDesign((current) => {
      if (target < 0 || target >= current.sections.length) return current;
      const sections = [...current.sections];
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, sections };
    });
  };

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const payload = normalizeSiteDesign(design);
      await api.put(
        "/settings/storefront",
        { settings: { [SITE_DESIGN_SETTING_KEY]: payload } },
        { perfComponent: "SiteStudio.save" }
      );
      // The storefront reads this out of /settings/public; without dropping the
      // shared cache the admin's own next visit would still see the old look.
      resetPublicSettingsCache();
      setSaved(payload);
      setDesign(payload);
      toast.success(tr("saved"));
    } catch (error) {
      toast.error(`${tr("saveFailed")} ${error?.message || ""}`.trim());
    } finally {
      setSaving(false);
    }
  };

  const modeOptions = [
    { id: "light", text: tr("light") },
    { id: "dark", text: tr("dark") },
  ];

  return (
    <div className="m1-site">
      <PageHeader
        title={tr("title")}
        description={tr("subtitle")}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setDesign(normalizeSiteDesign(DEFAULT_SITE_DESIGN))}
              disabled={!canEdit || saving}
            >
              <RotateCcw size={15} />
              {tr("reset")}
            </Button>
            <Button onClick={save} disabled={!canEdit || saving || !dirty}>
              {saving ? <Loader2 size={15} className="m1-site__spin" /> : <Save size={15} />}
              {tr("save")}
            </Button>
          </>
        }
      />

      {!canEdit ? <p className="m1-site__notice">{tr("readOnly")}</p> : null}
      {dirty ? <p className="m1-site__notice m1-site__notice--dirty">{tr("unsaved")}</p> : null}

      <div className="m1-site__layout">
        <div className="m1-site__controls">
          <div className="m1-site__tabs" role="tablist" aria-label={tr("title")}>
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? "is-active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={15} />
                  {tr(`tabs.${item.id}`)}
                </button>
              );
            })}
          </div>

          {tab === "colors" ? (
            <section className="m1-site__panel">
              <header className="m1-site__panel-head">
                <h2>{tr("colorsTitle")}</h2>
                <p>{tr("colorsHint")}</p>
              </header>
              <Segmented value={mode} options={modeOptions} onChange={setMode} ariaLabel={tr("modeLabel")} />
              <div className="m1-site__colors">
                {PALETTE_FIELDS.map((field) => (
                  <ColorRow
                    key={field.key}
                    label={localized(field.label, language)}
                    value={palette[field.key]}
                    onChange={(value) => update(["palette", mode, field.key], value)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {tab === "type" ? (
            <section className="m1-site__panel">
              <header className="m1-site__panel-head">
                <h2>{tr("typeTitle")}</h2>
                <p>{tr("typeHint")}</p>
              </header>
              <label className="m1-site__field">
                <span className="m1-site__field-label">{tr("fontAr")}</span>
                <Select value={design.fontAr} onChange={(event) => update(["fontAr"], event.target.value)}>
                  {ARABIC_FONTS.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </Select>
                <span className="m1-site__specimen" style={{ fontFamily: arabicFontStack(design.fontAr) }}>
                  {"أبجد هوز حطي كلمن — ١٢٣٤٥"}
                </span>
              </label>
              <label className="m1-site__field">
                <span className="m1-site__field-label">{tr("fontEn")}</span>
                <Select value={design.fontEn} onChange={(event) => update(["fontEn"], event.target.value)}>
                  {LATIN_FONTS.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </Select>
                <span className="m1-site__specimen" style={{ fontFamily: latinFontStack(design.fontEn, design.fontAr) }}>
                  The quick brown fox — 12345
                </span>
              </label>
              <div className="m1-site__field">
                <span className="m1-site__field-label">{tr("corners")}</span>
                <Segmented
                  value={design.radius}
                  options={SITE_RADIUS_PROFILES.map((profile) => ({ id: profile.id, text: localized(profile.label, language) }))}
                  onChange={(value) => update(["radius"], value)}
                  ariaLabel={tr("corners")}
                />
              </div>
            </section>
          ) : null}

          {tab === "hero" ? (
            <section className="m1-site__panel">
              <header className="m1-site__panel-head">
                <h2>{tr("heroTitle")}</h2>
                <p>{tr("heroHint")}</p>
              </header>
              <Switch
                label={tr("heroEnabled")}
                checked={design.hero.enabled}
                onChange={(event) => update(["hero", "enabled"], event.target.checked)}
              />
              <BilingualField
                label={tr("heroEyebrow")}
                value={design.hero.eyebrow}
                maxLength={48}
                onChange={(value) => update(["hero", "eyebrow"], value)}
              />
              <BilingualField
                label={tr("heroHeadline")}
                value={design.hero.title}
                maxLength={80}
                onChange={(value) => update(["hero", "title"], value)}
              />
              <BilingualField
                label={tr("heroSub")}
                value={design.hero.subtitle}
                maxLength={200}
                long
                onChange={(value) => update(["hero", "subtitle"], value)}
              />
              <BilingualField
                label={tr("heroPrimary")}
                value={design.hero.primaryLabel}
                maxLength={40}
                onChange={(value) => update(["hero", "primaryLabel"], value)}
              />
              <label className="m1-site__field">
                <span className="m1-site__field-label">{tr("heroPrimaryHref")}</span>
                <Input
                  value={design.hero.primaryHref}
                  spellCheck={false}
                  onChange={(event) => update(["hero", "primaryHref"], event.target.value)}
                />
                <span className="m1-site__hint">{tr("hrefHint")}</span>
              </label>
              <BilingualField
                label={tr("heroSecondary")}
                value={design.hero.secondaryLabel}
                maxLength={40}
                onChange={(value) => update(["hero", "secondaryLabel"], value)}
              />
              <label className="m1-site__field">
                <span className="m1-site__field-label">{tr("heroSecondaryHref")}</span>
                <Input
                  value={design.hero.secondaryHref}
                  spellCheck={false}
                  onChange={(event) => update(["hero", "secondaryHref"], event.target.value)}
                />
                <span className="m1-site__hint">{tr("secondaryHrefHint")}</span>
              </label>

              <div className="m1-site__field">
                <span className="m1-site__field-label">{tr("heroPosition")}</span>
                <Segmented
                  value={design.hero.position}
                  options={HERO_TEXT_POSITIONS.map((item) => ({ id: item.id, text: localized(item.label, language) }))}
                  onChange={(value) => update(["hero", "position"], value)}
                  ariaLabel={tr("heroPosition")}
                />
              </div>
              <div className="m1-site__field">
                <span className="m1-site__field-label">{tr("heroAlign")}</span>
                <Segmented
                  value={design.hero.align}
                  options={HERO_TEXT_ALIGNMENTS.map((item) => ({ id: item.id, text: localized(item.label, language) }))}
                  onChange={(value) => update(["hero", "align"], value)}
                  ariaLabel={tr("heroAlign")}
                />
              </div>

              <ColorRow
                label={tr("heroTextColor")}
                value={design.hero.textColor}
                onChange={(value) => update(["hero", "textColor"], value)}
              />
              <ColorRow
                label={tr("scrimColor")}
                value={design.hero.scrimColor}
                onChange={(value) => update(["hero", "scrimColor"], value)}
              />
              <label className="m1-site__field">
                <span className="m1-site__field-label">
                  {tr("scrimOpacity")} <b>{Math.round(design.hero.scrimOpacity * 100)}%</b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(design.hero.scrimOpacity * 100)}
                  onChange={(event) => update(["hero", "scrimOpacity"], Number(event.target.value) / 100)}
                />
                <span className="m1-site__hint">{tr("scrimOpacityHint")}</span>
              </label>
              <label className="m1-site__field">
                <span className="m1-site__field-label">
                  {tr("scrimHeight")} <b>{design.hero.scrimHeight}%</b>
                </span>
                <input
                  type="range"
                  min="20"
                  max="100"
                  step="1"
                  value={design.hero.scrimHeight}
                  onChange={(event) => update(["hero", "scrimHeight"], Number(event.target.value))}
                />
                <span className="m1-site__hint">{tr("scrimHeightHint")}</span>
              </label>
            </section>
          ) : null}

          {tab === "cards" ? (
            <section className="m1-site__panel">
              <header className="m1-site__panel-head">
                <h2>{tr("cardsTitle")}</h2>
                <p>{tr("cardsHint")}</p>
              </header>
              <div className="m1-site__templates">
                {CARD_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`m1-site__template${design.card.template === template.id ? " is-active" : ""}`}
                    aria-pressed={design.card.template === template.id}
                    onClick={() => update(["card", "template"], template.id)}
                  >
                    {/* A drawing of the layout, not a screenshot of it: the real
                        thing is one scroll away in the preview, and a thumbnail
                        that pretends to be a photograph goes stale the first
                        time the card changes. */}
                    <span className={`m1-site__template-art is-${template.id}`} aria-hidden="true">
                      <i />
                      <b />
                      <u />
                    </span>
                    <span className="m1-site__template-name">{localized(template.label, language)}</span>
                    <span className="m1-site__template-note">{localized(template.note, language)}</span>
                  </button>
                ))}
              </div>
              <Switch
                label={tr("cardShowBrand")}
                checked={design.card.showBrand}
                onChange={(event) => update(["card", "showBrand"], event.target.checked)}
              />
              <span className="m1-site__hint">{tr("cardShowBrandHint")}</span>
              <Switch
                label={tr("cardShowBadge")}
                checked={design.card.showBadge}
                onChange={(event) => update(["card", "showBadge"], event.target.checked)}
              />
              <span className="m1-site__hint">{tr("cardShowBadgeHint")}</span>
              <p className="m1-site__hint">{tr("cardImageNote")}</p>
            </section>
          ) : null}
          {tab === "bands" ? (
            <section className="m1-site__panel">
              <header className="m1-site__panel-head">
                <h2>{tr("bandsTitle")}</h2>
                <p>{tr("bandsHint")}</p>
              </header>

              <Switch
                label={tr("stripEnabled")}
                checked={design.strip.enabled}
                onChange={(event) => update(["strip", "enabled"], event.target.checked)}
              />
              <span className="m1-site__hint">{tr("stripEnabledHint")}</span>

              <div className="m1-site__field">
                <span className="m1-site__field-label">{tr("stripItems")}</span>
                <span className="m1-site__hint">{tr("stripItemsHint")}</span>
                {design.strip.items.map((item, index) => (
                  <div key={index} className="m1-site__row">
                    <div className="m1-site__row-main">
                      <BilingualField
                        label={`${index + 1}`}
                        value={item}
                        maxLength={80}
                        onChange={(value) => update(["strip", "items", index], value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="m1-site__icon-button"
                      aria-label={tr("removeItem")}
                      onClick={() => update(["strip", "items"], design.strip.items.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  disabled={design.strip.items.length >= STRIP_MAX_ITEMS}
                  onClick={() => update(["strip", "items"], [...design.strip.items, { ar: "", en: "" }])}
                >
                  <Plus size={15} />
                  {tr("addItem")}
                </Button>
              </div>

              <Segmented value={mode} options={modeOptions} onChange={setMode} ariaLabel={tr("modeLabel")} />
              <ColorRow
                label={tr("stripBackground")}
                value={design.strip[mode].background}
                onChange={(value) => update(["strip", mode, "background"], value)}
              />
              <ColorRow
                label={tr("stripText")}
                value={design.strip[mode].text}
                onChange={(value) => update(["strip", mode, "text"], value)}
              />
              <span className="m1-site__hint">{tr("stripColorHint")}</span>

              <header className="m1-site__panel-head">
                <h2>{tr("footerTitle")}</h2>
                <p>{tr("footerHint")}</p>
              </header>
              <ColorRow
                label={tr("footerBackground")}
                value={design.footer[mode].background}
                onChange={(value) => update(["footer", mode, "background"], value)}
              />
              <ColorRow
                label={tr("footerText")}
                value={design.footer[mode].text}
                onChange={(value) => update(["footer", mode, "text"], value)}
              />
              <ColorRow
                label={tr("footerBar")}
                value={design.footer[mode].bar}
                onChange={(value) => update(["footer", mode, "bar"], value)}
              />
              <ColorRow
                label={tr("footerBarText")}
                value={design.footer[mode].barText}
                onChange={(value) => update(["footer", mode, "barText"], value)}
              />
            </section>
          ) : null}

          {tab === "sections" ? (
            <section className="m1-site__panel">
              <header className="m1-site__panel-head">
                <h2>{tr("sectionsTitle")}</h2>
                <p>{tr("sectionsHint")}</p>
              </header>
              <ol className="m1-site__sections">
                {design.sections.map((entry, index) => {
                  const meta = HOME_SECTION_MAP[entry.id];
                  return (
                    <li key={entry.id} className={`m1-site__section${entry.enabled ? "" : " is-off"}`}>
                      <span className="m1-site__section-index">{index + 1}</span>
                      <span className="m1-site__section-name">{localized(meta?.label, language) || entry.id}</span>
                      <span className="m1-site__section-actions">
                        <button
                          type="button"
                          className="m1-site__icon-button"
                          aria-label={tr("moveUp")}
                          disabled={index === 0}
                          onClick={() => moveSection(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="m1-site__icon-button"
                          aria-label={tr("moveDown")}
                          disabled={index === design.sections.length - 1}
                          onClick={() => moveSection(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="m1-site__icon-button"
                          aria-label={entry.enabled ? tr("hideSection") : tr("showSection")}
                          aria-pressed={!entry.enabled}
                          onClick={() => update(["sections", index, "enabled"], !entry.enabled)}
                        >
                          {entry.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>

              <header className="m1-site__panel-head">
                <h2>{tr("sectionTitlesTitle")}</h2>
                <p>{tr("sectionTitlesHint")}</p>
              </header>
              {TITLED_HOME_SECTIONS.map((section) => (
                <BilingualField
                  key={section.id}
                  label={localized(section.label, language)}
                  value={design.sectionTitles[section.id]}
                  maxLength={60}
                  onChange={(value) => update(["sectionTitles", section.id], value)}
                />
              ))}
            </section>
          ) : null}
        </div>

        <aside className="m1-site__preview">
          <div className="m1-site__preview-head">
            <span>
              <Monitor size={14} />
              {tr("previewTitle")}
            </span>
            <div className="m1-site__preview-modes">
              <button
                type="button"
                className={mode === "light" ? "is-active" : ""}
                aria-label={tr("light")}
                onClick={() => setMode("light")}
              >
                <Sun size={14} />
              </button>
              <button
                type="button"
                className={mode === "dark" ? "is-active" : ""}
                aria-label={tr("dark")}
                onClick={() => setMode("dark")}
              >
                <Moon size={14} />
              </button>
            </div>
          </div>

          {/* Two elements, not one: the stage is the scroll box at panel width and
              the page inside it is the SITE, laid out at a real desktop width and
              then scaled down to fit. Scaling is what makes the preview honest —
              home.css sizes half the page from viewport media queries (a section
              heading is 28px above 768px), so a preview that simply shrank the
              tokens would show a layout no visitor ever gets. */}
          <div className="m1-site__stage">
            <div className="m1-site__page m1h" data-theme={mode} style={{ ...previewVars, fontFamily: fontStack }}>
              {/* The strip is drawn whether the promises are on or off: "off"
                  means no promises, never no band - the language switch and the
                  theme toggle live in it. Its dark default is `transparent`, so
                  what shows through here is the page colour, exactly as on site. */}
              <div className="m1-site__strip">
                <span className="m1-site__strip-corner" aria-hidden="true">
                  {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                </span>
                <div className="m1-site__strip-track">
                  {stripPromises.length ? (
                    stripPromises.map((promise, index) => (
                      // Index keys: a fixed list of promises, never reordered, and
                      // two promises may legitimately read the same.
                      <span key={index} className="m1-site__strip-item">
                        {promise}
                      </span>
                    ))
                  ) : (
                    <span className="m1-site__strip-item is-empty">{tr("stripOff")}</span>
                  )}
                </div>
                <span className="m1-site__strip-corner" aria-hidden="true">
                  <Globe size={14} />
                  {language.toUpperCase()}
                </span>
              </div>

              <div className="m1-site__mock-bar">
                <strong>{tr("mockStore")}</strong>
                <span>{tr("mockNav")}</span>
              </div>

              {previewSections.map((id) => renderPreviewSection(id))}

              {/* Not a section, by the same rule as the site: the footer is the end
                  of the page, and an owner who dragged it to the top would only be
                  reporting a bug. */}
              <div className="m1-site__footer">
                <div className="m1-site__footer-cols">
                  {[tr("mockFooterAbout"), tr("mockFooterCategories"), tr("mockFooterLinks")].map((heading) => (
                    <div key={heading} className="m1-site__footer-col">
                      <strong>{heading}</strong>
                      <span className="m1-site__mock-line" aria-hidden="true" />
                      <span className="m1-site__mock-line" aria-hidden="true" />
                      <span className="m1-site__mock-line" aria-hidden="true" />
                    </div>
                  ))}
                </div>
                <div className="m1-site__footer-bar">{tr("mockCopyright")}</div>
              </div>
            </div>
          </div>

          <p className="m1-site__preview-note">
            {loading ? tr("loading") : tr("previewNote")}
            {/* A hidden section leaves no gap in the preview, so the count is the
                only thing that says why the page is shorter than the list. */}
            {!loading && hiddenSectionCount > 0 ? (
              <Badge tone="warning">{tr("previewHidden", { n: hiddenSectionCount })}</Badge>
            ) : null}
            {!loading && !dirty ? <Badge tone="success">{tr("live")}</Badge> : null}
          </p>
        </aside>
      </div>
    </div>
  );
}
