// Public legal pages: /privacy, /terms, /data-deletion.
//
// These are intentionally outside every ProtectedRoute — a platform reviewer must
// be able to read them with no account. Content lives in ./legalContent.js in both
// Arabic and English; this file is presentation only.
//
// Language: the page follows the application's stored language by default (same
// helpers as the rest of the app), and can be forced with ?lang=ar / ?lang=en so a
// single canonical URL can be handed to an English-speaking reviewer. The route
// itself never changes — /privacy stays /privacy.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Image,
  KeyRound,
  Languages,
  Mail,
  MessageCircle,
  Plug,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
  Users,
  FileText,
} from "lucide-react";

import { getLanguageDirection, normalizeLanguage, resolveInitialLanguage } from "../../i18n/i18n";
import {
  LEGAL_LAST_UPDATED,
  SUPPORT_EMAIL,
  legalMetaFor,
  legalSectionsFor,
  legalUiStrings,
} from "./legalContent";

const cardClass =
  "rounded-[1.6rem] border border-slate-200/80 bg-white/88 p-5 shadow-[0_18px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,11,22,0.96),rgba(7,11,22,0.88))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]";
const badgeClass =
  "inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-300/20 dark:text-emerald-200";

const pageIcon = { privacy: ShieldCheck, terms: FileText, "data-deletion": Trash2 };

const sectionIcons = {
  users: Users,
  message: MessageCircle,
  shield: ShieldCheck,
  sparkles: Sparkles,
  trash: Trash2,
  mail: Mail,
  plug: Plug,
  key: KeyRound,
  media: Image,
  send: Send,
  settings: Settings2,
  unlink: Unlink,
  external: ExternalLink,
};

const accentMap = {
  emerald: {
    shell:
      "border-emerald-200/55 bg-[radial-gradient(circle_at_16%_0%,rgba(16,185,129,0.22),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(236,253,245,0.6))] dark:border-emerald-300/15 dark:bg-[radial-gradient(circle_at_16%_0%,rgba(16,185,129,0.16),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(16,185,129,0.06))]",
    hero:
      "from-emerald-500/18 via-white/65 to-white/90 dark:from-emerald-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-emerald-300/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100",
  },
  amber: {
    shell:
      "border-amber-200/55 bg-[radial-gradient(circle_at_84%_0%,rgba(245,158,11,0.22),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,251,235,0.64))] dark:border-amber-300/15 dark:bg-[radial-gradient(circle_at_84%_0%,rgba(245,158,11,0.16),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(245,158,11,0.06))]",
    hero:
      "from-amber-500/18 via-white/65 to-white/90 dark:from-amber-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-amber-300/25 bg-amber-500/10 text-amber-800 dark:text-amber-100",
  },
  rose: {
    shell:
      "border-rose-200/55 bg-[radial-gradient(circle_at_84%_0%,rgba(244,63,94,0.18),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,241,242,0.66))] dark:border-rose-300/15 dark:bg-[radial-gradient(circle_at_84%_0%,rgba(244,63,94,0.14),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(244,63,94,0.06))]",
    hero:
      "from-rose-500/18 via-white/65 to-white/90 dark:from-rose-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-rose-300/25 bg-rose-500/10 text-rose-800 dark:text-rose-100",
  },
};

const CANONICAL_ORIGIN = "https://m1store-egy.com";
const canonicalPath = { privacy: "/privacy", terms: "/terms", "data-deletion": "/data-deletion" };

// Legal pages must stay indexable and must advertise both language variants, so a
// crawler (and a reviewer following a link) reaches the right one.
const applyHeadTags = ({ pageKey, language, title, description }) => {
  if (typeof document === "undefined") return;
  document.title = title;

  const upsert = (selector, tag, attributes) => {
    let node = document.head.querySelector(selector);
    if (!node) {
      node = document.createElement(tag);
      document.head.appendChild(node);
    }
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  };

  upsert('meta[name="description"]', "meta", { name: "description", content: description });
  // The canonical stays language-neutral: one public URL per policy, exactly the
  // URLs already registered with third parties.
  upsert('link[rel="canonical"]', "link", { rel: "canonical", href: `${CANONICAL_ORIGIN}${canonicalPath[pageKey]}` });
  upsert('meta[name="robots"]', "meta", { name: "robots", content: "index, follow" });
  upsert('link[rel="alternate"][hreflang="ar"]', "link", {
    rel: "alternate", hreflang: "ar", href: `${CANONICAL_ORIGIN}${canonicalPath[pageKey]}?lang=ar`,
  });
  upsert('link[rel="alternate"][hreflang="en"]', "link", {
    rel: "alternate", hreflang: "en", href: `${CANONICAL_ORIGIN}${canonicalPath[pageKey]}?lang=en`,
  });
  upsert('meta[property="og:title"]', "meta", { property: "og:title", content: title });
  upsert('meta[property="og:description"]', "meta", { property: "og:description", content: description });
  upsert('meta[property="og:url"]', "meta", { property: "og:url", content: `${CANONICAL_ORIGIN}${canonicalPath[pageKey]}` });
  document.documentElement.setAttribute("lang", language);
};

function LegalShell({ pageKey }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // ?lang= wins so a fixed link can be handed to a reviewer; otherwise the page
  // follows whatever language the visitor already uses on the site.
  const requestedLanguage = searchParams.get("lang");
  const [language, setLanguage] = useState(() =>
    normalizeLanguage(requestedLanguage || resolveInitialLanguage())
  );

  useEffect(() => {
    if (!requestedLanguage) return;
    setLanguage(normalizeLanguage(requestedLanguage));
  }, [requestedLanguage]);

  const meta = useMemo(() => legalMetaFor(pageKey, language), [pageKey, language]);
  const sections = useMemo(() => legalSectionsFor(pageKey, language), [pageKey, language]);
  const ui = legalUiStrings[language] || legalUiStrings.ar;
  const direction = getLanguageDirection(language);
  const accent = accentMap[meta.accent];
  const Icon = pageIcon[pageKey];

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    const previousLang = document.documentElement.getAttribute("lang");
    applyHeadTags({ pageKey, language, title: meta.title, description: meta.description });
    return () => {
      document.title = previousTitle;
      if (previousLang) document.documentElement.setAttribute("lang", previousLang);
    };
  }, [pageKey, language, meta.title, meta.description]);

  const toggleLanguage = useCallback(() => {
    const next = language === "ar" ? "en" : "ar";
    setLanguage(next);
    // Reflected in the URL so the chosen language is shareable and survives a
    // reload, without changing the route itself.
    const params = new URLSearchParams(searchParams);
    params.set("lang", next);
    setSearchParams(params, { replace: true });
  }, [language, searchParams, setSearchParams]);

  const quickLinks = [
    { to: "/privacy", label: ui.privacy },
    { to: "/terms", label: ui.terms },
    { to: "/data-deletion", label: ui.dataDeletion },
  ];

  return (
    <main
      dir={direction}
      lang={language}
      className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f7f4ee_0%,#ffffff_38%,#f2f7f5_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_top,rgba(7,11,22,1),rgba(2,6,23,1)_60%,rgba(3,7,18,1)_100%)] dark:text-white"
    >
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_12%_18%,rgba(212,175,55,0.12),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.12),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.05),transparent_28%)] dark:bg-[radial-gradient(circle_at_12%_18%,rgba(212,175,55,0.10),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.08),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.05),transparent_28%)]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className={`overflow-hidden rounded-[2rem] border px-5 py-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-2xl ${accent.shell}`}>
          <div className="rounded-[1.6rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,255,255,0.68))] p-5 dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-2xl">
                <span className={badgeClass}>{meta.label}</span>
                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{meta.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">{meta.lead}</p>
                <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  {ui.lastUpdatedLabel} {LEGAL_LAST_UPDATED}
                </p>
              </div>
              <div className={`grid h-16 w-16 place-items-center rounded-[1.5rem] border border-white/70 bg-white text-slate-950 shadow-[0_18px_40px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-white/5 dark:text-white ${accent.pill}`}>
                <Icon className="h-8 w-8" />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {/* Language switch keeps the same URL and only adds ?lang=, so the
                  public /privacy and /terms links never break. */}
              <button
                type="button"
                onClick={toggleLanguage}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-400 dark:border-white/15 dark:bg-white/[0.06] dark:text-slate-100"
              >
                <Languages className="h-4 w-4" />
                {ui.languageSwitchLabel}
              </button>
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:border-white/20"
              >
                <ArrowLeft className="h-4 w-4" />
                {ui.backToShop}
              </Link>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-800 transition hover:-translate-y-0.5 hover:bg-emerald-500/15 dark:text-emerald-100"
              >
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          {sections.map((section) => {
            const SectionIcon = sectionIcons[section.icon] || ShieldCheck;
            return (
              <article key={section.title} className={cardClass}>
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-black tracking-tight">{section.title}</h2>
                </div>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className={`${cardClass} ${accent.hero}`}>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/60 bg-white text-slate-950 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-white">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">{ui.officialContact}</h2>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{ui.officialContactLead}</p>
              </div>
            </div>
            <div className="mt-4 rounded-[1.3rem] border border-slate-200 bg-white/90 p-4 text-sm leading-7 text-slate-700 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-200">
              <p className="font-bold">{ui.entity}</p>
              <p className="mt-2">
                {ui.approvedEmail}{" "}
                <a
                  className="font-black text-emerald-700 underline decoration-emerald-300 decoration-2 underline-offset-4 dark:text-emerald-200"
                  href={`mailto:${SUPPORT_EMAIL}`}
                >
                  {SUPPORT_EMAIL}
                </a>
              </p>
              <p className="mt-2">{ui.contactNote}</p>
            </div>
          </article>

          <article className={cardClass}>
            <h2 className="text-lg font-black tracking-tight">{ui.quickLinks}</h2>
            <div className="mt-4 grid gap-3">
              {quickLinks.map((link) => (
                <Link
                  key={link.to}
                  to={`${link.to}?lang=${language}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:text-emerald-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-emerald-200"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

export function PrivacyPage() {
  return <LegalShell pageKey="privacy" />;
}

export function TermsPage() {
  return <LegalShell pageKey="terms" />;
}

export function DataDeletionPage() {
  return <LegalShell pageKey="data-deletion" />;
}
