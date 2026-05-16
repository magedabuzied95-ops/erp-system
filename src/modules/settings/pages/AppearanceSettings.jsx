import { Check, Paintbrush, Palette, RotateCcw, Sparkles, SplitSquareHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../../theme/useTheme";
import { ACCENTS, DEFAULT_ACCENT_ID } from "../../../theme/themes";

function AppearanceSettings() {
  const { themeId, theme, themes, accentId, density, setTheme, setAccent, setDensity, resetTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <section className="theme-card p-6 shadow-[0_24px_80px_var(--shadow)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 text-[var(--primary)]">
              <Paintbrush className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.24em]">{t("sidebar.appearance")}</span>
            </div>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--text)]">{t("appearance.title")}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
              {t("appearance.subtitle")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="theme-panel px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">{t("appearance.activeTheme")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{theme.name}</div>
            </div>
            <button
              type="button"
              onClick={resetTheme}
              className="theme-button-soft px-4 py-3 text-sm"
            >
              <RotateCcw className="h-4 w-4" />
              {t("appearance.reset")}
            </button>
          </div>
        </div>
      </section>

      <section className="theme-card p-6 shadow-[0_24px_80px_var(--shadow)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-[var(--text)]">{t("appearance.themePresets")}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{t("appearance.themePresetsHint")}</p>
          </div>
          <div className="theme-badge">
            <Sparkles className="h-4 w-4 text-[var(--primary)]" />
            {themes.length} {t("appearance.themesCount")}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {themes.map((item) => {
            const active = item.id === themeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTheme(item.id)}
                className={`relative overflow-hidden rounded-[28px] border p-4 text-left transition hover:-translate-y-0.5 ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] shadow-lg"
                    : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-soft)]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">{t("appearance.themeLabel")}</div>
                    <h3 className="mt-1 text-xl font-black text-[var(--text)]">{item.name}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.description}</p>
                  </div>
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                    }`}
                  >
                    {active ? <Check className="h-4 w-4" /> : null}
                  </div>
                </div>

                <ThemePreview preview={item.preview} t={t} />

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="theme-badge">
                    <span className="inline-block h-2 w-2 rounded-full bg-[var(--primary)]" />
                    {item.mode === "light" ? t("appearance.lightMode") : t("appearance.darkMode")}
                  </span>
                  <span className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                    {active ? t("appearance.selected") : t("appearance.clickToApply")}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
        <div className="theme-card p-6 shadow-[0_24px_80px_var(--shadow)]">
          <div className="flex items-center gap-3">
            <Palette className="h-5 w-5 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-black text-[var(--text)]">{t("appearance.accentTitle")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("appearance.accentSubtitle")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ACCENTS.map((accent) => {
              const active = accentId === accent.id;
              const isDefault = accent.id === DEFAULT_ACCENT_ID;
              const primary = accent.primary || theme.variables.primary;
              const primarySoft = accent.primarySoft || theme.variables.primarySoft;

              return (
                <button
                  key={accent.id}
                  type="button"
                  onClick={() => setAccent(accent.id)}
                  className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                      : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-soft)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                        {isDefault ? t("appearance.accentDefault") : t("appearance.accentTitle")}
                      </div>
                      <h3 className="mt-1 text-base font-black text-[var(--text)]">{accent.name}</h3>
                    </div>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full border ${active ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>
                      {active ? <Check className="h-4 w-4" /> : null}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <span className="h-8 w-8 rounded-full border border-black/10" style={{ backgroundColor: primary }} />
                    <span className="h-8 w-14 rounded-full border border-black/10" style={{ backgroundColor: primarySoft }} />
                    <span className="text-xs font-semibold text-[var(--muted)]">
                      {isDefault ? t("appearance.accentUsesTheme") : t("appearance.accentOverrides")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="theme-card p-6 shadow-[0_24px_80px_var(--shadow)]">
          <div className="flex items-center gap-3">
            <SplitSquareHorizontal className="h-5 w-5 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-black text-[var(--text)]">{t("appearance.densityTitle")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("appearance.densitySubtitle")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <DensityButton
              active={density === "normal"}
              title={t("appearance.normal")}
              description={t("appearance.densityNormalDescription")}
              onClick={() => setDensity("normal")}
            />
            <DensityButton
              active={density === "compact"}
              title={t("appearance.compact")}
              description={t("appearance.densityCompactDescription")}
              onClick={() => setDensity("compact")}
            />
          </div>

          <div className="mt-5 rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">{t("appearance.currentAppearance")}</div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <AppearanceStat label={t("appearance.theme")} value={theme.name} />
              <AppearanceStat label={t("appearance.accent")} value={ACCENTS.find((item) => item.id === accentId)?.name || t("appearance.accentDefault")} />
              <AppearanceStat label={t("appearance.density")} value={density === "compact" ? t("appearance.compact") : t("appearance.normal")} />
              <AppearanceStat label={t("appearance.mode")} value={theme.mode === "light" ? t("appearance.lightMode") : t("appearance.darkMode")} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ThemePreview({ preview, t }) {
  const colors = [
    { label: t("appearance.previewSidebar"), value: preview.sidebar },
    { label: t("appearance.previewCard"), value: preview.card },
    { label: t("appearance.previewButton"), value: preview.button },
    { label: t("appearance.previewText"), value: preview.text },
    { label: t("appearance.previewBorder"), value: preview.border },
  ];

  return (
    <div className="mt-4 overflow-hidden rounded-[24px] border border-black/5 bg-[var(--surface)] p-3">
      <div className="grid grid-cols-[1fr_1.2fr] gap-3">
        <div className="rounded-2xl border border-black/10 p-3" style={{ backgroundColor: preview.sidebar }}>
          <div className="space-y-2">
            <div className="h-2 w-12 rounded-full bg-white/40" />
            <div className="h-2 w-20 rounded-full bg-white/28" />
            <div className="h-2 w-16 rounded-full bg-white/20" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border border-black/10 p-3" style={{ backgroundColor: preview.card }}>
            <div className="flex items-center justify-between">
              <div className="h-2 w-16 rounded-full" style={{ backgroundColor: preview.text }} />
              <div className="h-6 w-12 rounded-full" style={{ backgroundColor: preview.button }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            {colors.map((item) => (
              <div key={item.label} className="rounded-2xl border border-black/5 bg-[var(--surface)] p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span>{item.label}</span>
                  <span className="h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: item.value }} />
                </div>
                <div className="h-1.5 rounded-full" style={{ backgroundColor: item.value }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DensityButton({ active, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-soft)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-[var(--text)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-full border ${active ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>
          {active ? <Check className="h-4 w-4" /> : null}
        </div>
      </div>
    </button>
  );
}

function AppearanceStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

export default AppearanceSettings;
