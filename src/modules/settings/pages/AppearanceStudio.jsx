// Appearance Studio — the one place fonts, corner shape, control size, density
// and colour mode are chosen for the whole ERP.
//
// It edits nothing but the M1 token layer (see src/theme/appearance.js), so
// every change is applied live to the real application, and the gallery on the
// right renders the real M1UI primitives — not a lookalike. What you see is
// what every page gets.
//
// Persistence has two levels: this browser (localStorage, instant) and the
// store default (general.appearance_profile, applied to every user who has not
// chosen their own). Mode and density keep their existing storage.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Check, Download, Moon, Paintbrush, Plus, RotateCcw, Save, Search, Sun, Trash2, User } from "lucide-react";

import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  Input,
  MetricCard,
  Radio,
  SearchInput,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "../../../shared/ui/M1UI";
import { useTheme } from "../../../theme/useTheme";
import {
  APPEARANCE_PRESETS,
  ARABIC_FONTS,
  ARABIC_FONT_MAP,
  CONTROL_PROFILES,
  CONTROL_PROFILE_MAP,
  LATIN_FONTS,
  LATIN_FONT_MAP,
  RADIUS_PROFILES,
  RADIUS_PROFILE_MAP,
  arabicFontStack,
  ensureCatalogFontsLoaded,
  latinFontStack,
} from "../../../theme/appearance";
import { api } from "../../../shared/api/api";
import { resetPublicSettingsCache } from "../../../shared/api/publicSettings";
import { hasPermission } from "../../../shared/auth/authStorage";
import "./AppearanceStudio.m1.css";

// Script specimens are not UI copy: they are the pangram each script is
// previewed with, identical in both interface languages.
const SPECIMEN_AR = "أبجد هوز حطي كلمن — ١٢٣٤٥";
const SPECIMEN_EN = "The quick brown fox — 12345";
const SPECIMEN_AR_SHORT = "أبجد هوز";
const SPECIMEN_EN_SHORT = "Aa Bg 12";
const PREVIEW_LANGUAGES = [
  { value: "ar", text: "عربي" },
  { value: "en", text: "English" },
];

const localized = (value, language) => (value && typeof value === "object" ? value[language] || value.en : value);

// Inline token overrides let a preset card preview its own shape and control
// height without touching the document — the card is its own tiny token scope.
const presetScopeStyle = (preset) => ({
  ...Object.fromEntries(Object.entries(RADIUS_PROFILE_MAP[preset.radius].values).map(([key, value]) => [`--${key}`, value])),
  ...Object.fromEntries(Object.entries(CONTROL_PROFILE_MAP[preset.controls].values).map(([key, value]) => [`--${key}`, value])),
  "--control-height": CONTROL_PROFILE_MAP[preset.controls].values["control-height-md"],
  "--font-ar": arabicFontStack(preset.fontAr),
  "--font-en": latinFontStack(preset.fontEn, preset.fontAr),
});

function SectionHeading({ title, hint }) {
  return (
    <header className="m1-appearance__section-head">
      <h2 className="m1-section-title">{title}</h2>
      {hint ? <p className="m1-caption m1-muted">{hint}</p> : null}
    </header>
  );
}

function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div className="m1-appearance__segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FontList({ fonts, value, onChange, language, specimen, dir }) {
  return (
    <div className="m1-appearance__fonts" role="radiogroup">
      {fonts.map((font) => {
        const active = font.id === value;
        const family = font.family ? `"${font.family}", sans-serif` : "system-ui, sans-serif";
        return (
          <button
            key={font.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`m1-appearance__font${active ? " is-active" : ""}`}
            onClick={() => onChange(font.id)}
          >
            <span className="m1-appearance__font-specimen" dir={dir} style={{ fontFamily: family }}>
              {specimen}
            </span>
            <span className="m1-appearance__font-meta">
              <strong>{font.name}</strong>
              <small>{localized(font.note, language)}</small>
            </span>
            <span className="m1-appearance__font-check" aria-hidden="true">{active ? <Check size={15} /> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function AppearanceStudio() {
  const { t, i18n } = useTranslation();
  const language = i18n.language?.startsWith("ar") ? "ar" : "en";
  const tr = (key) => t(`appearance.${key}`);
  const {
    theme,
    themes,
    setTheme,
    density,
    setDensity,
    appearance,
    setAppearance,
    applyAppearancePreset,
    resetAppearance,
    hasLocalAppearance,
    tenantAppearance,
    setTenantAppearanceDefault,
  } = useTheme();

  const canEditTenant = hasPermission("settings.edit");
  const [previewLanguage, setPreviewLanguage] = useState(language);
  const [savingTenant, setSavingTenant] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);

  useEffect(() => {
    ensureCatalogFontsLoaded();
  }, []);

  const update = (patch) => setAppearance({ ...appearance, ...patch, preset: "custom" });

  const sourceLabel = hasLocalAppearance ? tr("sourceLocal") : tenantAppearance ? tr("sourceTenant") : tr("sourceBuiltIn");

  const saveTenantDefault = async () => {
    if (!canEditTenant || savingTenant) return;
    setSavingTenant(true);
    try {
      const profile = { version: appearance.version, preset: appearance.preset, fontAr: appearance.fontAr, fontEn: appearance.fontEn, radius: appearance.radius, controls: appearance.controls };
      await api.put("/settings/general", { settings: { "general.appearance_profile": profile } }, { perfComponent: "AppearanceStudio.saveTenant" });
      resetPublicSettingsCache();
      setTenantAppearanceDefault(profile);
      toast.success(tr("saveTenantDone"));
    } catch (error) {
      const message = String(error?.response?.data?.message || error?.message || "");
      toast.error(/No valid settings/i.test(message) ? tr("saveTenantNeedsBackend") : `${tr("saveTenantFailed")} ${message}`.trim());
    } finally {
      setSavingTenant(false);
    }
  };

  const previewDir = previewLanguage === "ar" ? "rtl" : "ltr";
  const previewFont = previewLanguage === "ar" ? "var(--font-ar)" : "var(--font-en)";
  const sample = useMemo(
    () => ({
      orders: [
        { id: "#10482", customer: previewLanguage === "ar" ? "ماجد أبوزيد" : "Maged Abouzeid", total: "3,060", tone: "success", status: tr("badgeSuccess") },
        { id: "#10481", customer: previewLanguage === "ar" ? "سارة محمود" : "Sara Mahmoud", total: "1,850", tone: "warning", status: tr("badgeWarning") },
        { id: "#10479", customer: previewLanguage === "ar" ? "أحمد علي" : "Ahmed Ali", total: "650", tone: "info", status: tr("badgeInfo") },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewLanguage, language]
  );

  const activePreset = APPEARANCE_PRESETS.find((preset) => preset.id === appearance.preset);

  return (
    <div className="m1-page m1-appearance">
      <header className="m1-appearance__hero">
        <div>
          <div className="m1-appearance__eyebrow">
            <Paintbrush size={15} aria-hidden="true" />
            {tr("eyebrow")}
          </div>
          <h1 className="m1-page-title">{tr("title")}</h1>
          <p className="m1-body m1-muted m1-appearance__subtitle">{tr("subtitle")}</p>
        </div>
        <div className="m1-appearance__hero-actions">
          <Button icon={RotateCcw} onClick={() => { resetAppearance(); toast.success(tr("resetDone")); }} disabled={!hasLocalAppearance}>
            {tr("reset")}
          </Button>
          <Button variant="primary" icon={Save} loading={savingTenant} onClick={saveTenantDefault} disabled={!canEditTenant} title={tr("saveTenantHint")}>
            {tr("saveTenant")}
          </Button>
        </div>
      </header>

      <section className="m1-appearance__current" aria-label={tr("currentTitle")}>
        <div className="m1-appearance__current-item">
          <span>{tr("currentTitle")}</span>
          <strong>{activePreset ? localized(activePreset.name, language) : tr("presetCustom")}</strong>
        </div>
        <div className="m1-appearance__current-item">
          <span>{tr("currentFonts")}</span>
          <strong>{ARABIC_FONT_MAP[appearance.fontAr].name} · {LATIN_FONT_MAP[appearance.fontEn].name}</strong>
        </div>
        <div className="m1-appearance__current-item">
          <span>{tr("currentShape")}</span>
          <strong>{localized(RADIUS_PROFILE_MAP[appearance.radius].label, language)}</strong>
        </div>
        <div className="m1-appearance__current-item">
          <span>{tr("currentControls")}</span>
          <strong>{localized(CONTROL_PROFILE_MAP[appearance.controls].label, language)}</strong>
        </div>
        <div className="m1-appearance__current-item">
          <span>{tr("currentMode")}</span>
          <strong>{theme.mode === "dark" ? tr("darkMode") : tr("lightMode")}</strong>
        </div>
        <div className="m1-appearance__current-item">
          <span>{tr("currentDensity")}</span>
          <strong>{density === "compact" ? tr("compact") : tr("normal")}</strong>
        </div>
        <Badge tone={hasLocalAppearance ? "primary" : "neutral"} className="m1-appearance__source">{sourceLabel}</Badge>
      </section>

      {!canEditTenant ? <p className="m1-appearance__notice">{tr("readOnly")}</p> : null}

      <div className="m1-appearance__layout">
        {/* ------------------------------------------------------ controls */}
        <div className="m1-appearance__controls">
          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("modeTitle")} hint={tr("modeHint")} />
            <div className="m1-appearance__modes" role="radiogroup" aria-label={tr("modeTitle")}>
              {[
                { id: "light", icon: Sun, label: tr("lightMode") },
                { id: "dark", icon: Moon, label: tr("darkMode") },
              ].map((mode) => {
                const preview = themes.find((item) => item.id === mode.id)?.preview || theme.preview;
                const active = theme.id === mode.id;
                return (
                  <button key={mode.id} type="button" role="radio" aria-checked={active} className={`m1-appearance__mode${active ? " is-active" : ""}`} onClick={() => setTheme(mode.id)}>
                    <span className="m1-appearance__mode-swatch" style={{ background: preview.card, borderColor: preview.border }} aria-hidden="true">
                      <i style={{ background: preview.sidebar }} />
                      <b style={{ background: preview.button }} />
                      <u style={{ background: preview.text }} />
                    </span>
                    <span className="m1-appearance__mode-label"><mode.icon size={15} aria-hidden="true" />{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("presetsTitle")} hint={tr("presetsHint")} />
            <div className="m1-appearance__presets">
              {APPEARANCE_PRESETS.map((preset) => {
                const active = appearance.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    className={`m1-appearance__preset${active ? " is-active" : ""}`}
                    style={presetScopeStyle(preset)}
                    onClick={() => applyAppearancePreset(preset.id)}
                  >
                    <span className="m1-appearance__preset-specimen">
                      <span dir="rtl" style={{ fontFamily: "var(--font-ar)" }}>{SPECIMEN_AR_SHORT}</span>
                      <span dir="ltr" style={{ fontFamily: "var(--font-en)" }}>{SPECIMEN_EN_SHORT}</span>
                    </span>
                    <span className="m1-appearance__preset-buttons" aria-hidden="true">
                      <span className="m1-button m1-button--primary m1-button--sm">{tr("primary")}</span>
                      <span className="m1-button m1-button--sm">{tr("secondary")}</span>
                      <span className="m1-button m1-button--outline m1-button--sm">{tr("outline")}</span>
                    </span>
                    <span className="m1-appearance__preset-meta">
                      <strong>{localized(preset.name, language)}{active ? <Badge tone="primary">{tr("presetActive")}</Badge> : null}</strong>
                      <small>{localized(preset.description, language)}</small>
                    </span>
                  </button>
                );
              })}
              {appearance.preset === "custom" ? (
                <div className="m1-appearance__preset is-active is-custom" aria-current="true">
                  <span className="m1-appearance__preset-meta">
                    <strong>{tr("presetCustom")}<Badge tone="primary">{tr("presetActive")}</Badge></strong>
                    <small>{tr("presetCustomHint")}</small>
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("fontArTitle")} hint={tr("fontArHint")} />
            <FontList fonts={ARABIC_FONTS} value={appearance.fontAr} onChange={(fontAr) => update({ fontAr })} language={language} specimen={SPECIMEN_AR} dir="rtl" />
          </section>

          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("fontEnTitle")} hint={tr("fontEnHint")} />
            <FontList fonts={LATIN_FONTS} value={appearance.fontEn} onChange={(fontEn) => update({ fontEn })} language={language} specimen={SPECIMEN_EN} dir="ltr" />
          </section>

          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("radiusTitle")} hint={tr("radiusHint")} />
            <Segmented
              ariaLabel={tr("radiusTitle")}
              value={appearance.radius}
              onChange={(radius) => update({ radius })}
              options={RADIUS_PROFILES.map((item) => ({ value: item.id, label: localized(item.label, language) }))}
            />
            <div className="m1-appearance__radius-preview" aria-hidden="true">
              {RADIUS_PROFILES.map((item) => (
                <span key={item.id} className={item.id === appearance.radius ? "is-active" : ""} style={{ borderRadius: item.values["radius-control"] }} />
              ))}
            </div>
          </section>

          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("controlsTitle")} hint={tr("controlsHint")} />
            <Segmented
              ariaLabel={tr("controlsTitle")}
              value={appearance.controls}
              onChange={(controls) => update({ controls })}
              options={CONTROL_PROFILES.map((item) => ({ value: item.id, label: `${localized(item.label, language)} · ${item.values["control-height-md"]}` }))}
            />
          </section>

          <section className="m1-card m1-appearance__section">
            <SectionHeading title={tr("densityTitle")} hint={tr("densityHint")} />
            <Segmented
              ariaLabel={tr("densityTitle")}
              value={density}
              onChange={setDensity}
              options={[
                { value: "normal", label: tr("normal") },
                { value: "compact", label: tr("compact") },
              ]}
            />
          </section>
        </div>

        {/* ------------------------------------------------------- gallery */}
        <aside className="m1-appearance__preview">
          <div className="m1-card m1-appearance__preview-card">
            <header className="m1-appearance__preview-head">
              <div>
                <h2 className="m1-section-title">{tr("previewTitle")}</h2>
                <p className="m1-caption m1-muted">{tr("previewHint")}</p>
              </div>
              <Segmented
                ariaLabel={tr("previewLanguage")}
                value={previewLanguage}
                onChange={setPreviewLanguage}
                options={PREVIEW_LANGUAGES.map((item) => ({ value: item.value, label: item.text }))}
              />
            </header>

            <div className="m1-appearance__gallery" dir={previewDir} lang={previewLanguage} style={{ fontFamily: previewFont, "--app-font": previewFont, "--font-ui": previewFont }}>
              <section className="m1-appearance__gallery-block">
                <h3 className="m1-label m1-muted">{tr("galleryButtons")}</h3>
                {["sm", "md", "lg"].map((size) => (
                  <div key={size} className="m1-appearance__row">
                    <span className="m1-appearance__row-label">{tr(`size${size[0].toUpperCase()}${size.slice(1)}`)}</span>
                    <Button variant="primary" size={size} icon={Plus}>{tr("primary")}</Button>
                    <Button variant="secondary" size={size}>{tr("secondary")}</Button>
                    <Button variant="outline" size={size} icon={Download}>{tr("outline")}</Button>
                    <Button variant="ghost" size={size}>{tr("ghost")}</Button>
                    <Button variant="danger" size={size} icon={Trash2}>{tr("danger")}</Button>
                    <IconButton icon={Search} label={tr("sampleSearch")} size={size} variant="outline" />
                  </div>
                ))}
                <div className="m1-appearance__row">
                  <span className="m1-appearance__row-label" />
                  <Button variant="primary" loading>{tr("loading")}</Button>
                  <Button variant="secondary" disabled>{tr("disabled")}</Button>
                  <Button variant="primary" size="lg" icon={Save}>{tr("saveTenant")}</Button>
                </div>
              </section>

              <section className="m1-appearance__gallery-block">
                <h3 className="m1-label m1-muted">{tr("galleryInputs")}</h3>
                <div className="m1-appearance__grid-2">
                  <Input label={tr("sampleInput")} placeholder={tr("sampleInputPlaceholder")} leading={<User size={15} />} defaultValue="" />
                  <Select label={tr("sampleSelect")} defaultValue="main">
                    <option value="main">{previewLanguage === "ar" ? "الفرع الرئيسي" : "Main branch"}</option>
                    <option value="alex">{previewLanguage === "ar" ? "الإسكندرية" : "Alexandria"}</option>
                  </Select>
                  <SearchInput placeholder={tr("sampleSearch")} defaultValue="" />
                  <Textarea label={tr("sampleTextarea")} rows={2} defaultValue="" />
                </div>
                <div className="m1-appearance__row m1-appearance__row--wrap">
                  <Checkbox label={tr("sampleCheckbox")} defaultChecked />
                  <Radio label={tr("sampleRadio")} name="appearance-sample-radio" defaultChecked />
                  <Switch label={tr("sampleSwitch")} checked={switchOn} onChange={(event) => setSwitchOn(event.target.checked)} />
                </div>
              </section>

              <section className="m1-appearance__gallery-block">
                <h3 className="m1-label m1-muted">{tr("galleryCards")}</h3>
                <div className="m1-appearance__grid-3">
                  <MetricCard label={tr("sampleMetric")} value="48,250" change={tr("sampleMetricChange")} tone="primary" />
                  <MetricCard label={tr("sampleMetric2")} value="37" density="compact" />
                  <MetricCard label={tr("sampleMetric3")} value="12" density="compact" tone="warning" />
                </div>
                <div className="m1-appearance__row m1-appearance__row--wrap">
                  <Badge tone="success">{tr("badgeSuccess")}</Badge>
                  <Badge tone="warning">{tr("badgeWarning")}</Badge>
                  <Badge tone="danger">{tr("badgeDanger")}</Badge>
                  <Badge tone="info">{tr("badgeInfo")}</Badge>
                  <Badge tone="primary">{tr("presetActive")}</Badge>
                  <Badge>{tr("badgeNeutral")}</Badge>
                </div>
              </section>

              <section className="m1-appearance__gallery-block">
                <h3 className="m1-label m1-muted">{tr("galleryTable")}</h3>
                <TableContainer>
                  <Table density={density === "compact" ? "compact" : "comfortable"} interactive>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>{tr("tableOrder")}</TableHeaderCell>
                        <TableHeaderCell>{tr("tableCustomer")}</TableHeaderCell>
                        <TableHeaderCell numeric>{tr("tableTotal")}</TableHeaderCell>
                        <TableHeaderCell>{tr("tableStatus")}</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sample.orders.map((row, index) => (
                        <TableRow key={row.id} selected={index === 0}>
                          <TableCell>{row.id}</TableCell>
                          <TableCell>{row.customer}</TableCell>
                          <TableCell numeric>{row.total}</TableCell>
                          <TableCell><Badge tone={row.tone}>{row.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </section>

              <section className="m1-appearance__gallery-block">
                <h3 className="m1-label m1-muted">{tr("galleryTypography")}</h3>
                <dl className="m1-appearance__type">
                  {[
                    ["typeDisplay", "m1-display"],
                    ["typePageTitle", "m1-page-title"],
                    ["typeSectionTitle", "m1-section-title"],
                    ["typeBody", "m1-body"],
                    ["typeLabel", "m1-label"],
                    ["typeCaption", "m1-caption"],
                  ].map(([key, className]) => (
                    <div key={key}>
                      <dt className="m1-caption m1-muted">{tr(key)}</dt>
                      <dd className={className}>{previewLanguage === "ar" ? SPECIMEN_AR : SPECIMEN_EN}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
