// Public legal pages: /privacy, /terms, /data-deletion.
//
// These are intentionally outside every ProtectedRoute — a platform reviewer must
// be able to read them with no account. Content lives in ./legalContent.js in both
// Arabic and English; this file is presentation only, drawn in the frame the
// storefront's FAQ and returns pages share (./policy/PolicyLayout).
//
// Language: the page follows the application's stored language by default (same
// helpers as the rest of the app), and can be forced with ?lang=ar / ?lang=en so a
// single canonical URL can be handed to an English-speaking reviewer. The route
// itself never changes — /privacy stays /privacy.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Languages } from "lucide-react";

import { getLanguageDirection, normalizeLanguage, resolveInitialLanguage } from "../../i18n/i18n";
import {
  LEGAL_LAST_UPDATED,
  SUPPORT_EMAIL,
  legalMetaFor,
  legalSectionsFor,
  legalUiStrings,
} from "./legalContent";
import PolicyLayout, { PolicyHelp, PolicyList, PolicyTabs } from "./policy/PolicyLayout";

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

  const legalLink = (path) => `${path}?lang=${language}`;
  const tabs = [
    { to: "/faq", label: ui.faq },
    { to: "/returns", label: ui.returns },
    { to: legalLink("/privacy"), label: ui.privacy, active: pageKey === "privacy" },
    { to: legalLink("/terms"), label: ui.terms, active: pageKey === "terms" },
    { to: legalLink("/data-deletion"), label: ui.dataDeletion, active: pageKey === "data-deletion" },
  ];

  return (
    <PolicyLayout
      as="main"
      dir={direction}
      lang={language}
      tabs={<PolicyTabs label={ui.navLabel} links={tabs} />}
      title={meta.label}
      lead={meta.lead}
      meta={`${ui.lastUpdatedLabel} ${LEGAL_LAST_UPDATED}`}
      actions={(
        <>
          {/* Language switch keeps the same URL and only adds ?lang=, so the
              public /privacy and /terms links never break. */}
          <button type="button" onClick={toggleLanguage} className="sfp-btn sfp-btn--outline sfp-btn--sm">
            <Languages size={15} aria-hidden="true" />
            {ui.languageSwitchLabel}
          </button>
          <Link to="/" className="sfp-btn sfp-btn--outline sfp-btn--sm">
            <ArrowLeft size={15} aria-hidden="true" className="sfp-back-icon" />
            {ui.backToShop}
          </Link>
        </>
      )}
      contentsLabel={ui.contents}
      sections={sections.map((section, index) => ({
        id: `${pageKey}-${index + 1}`,
        title: section.title,
        content: <PolicyList items={section.items} />,
      }))}
      help={(
        <PolicyHelp
          title={ui.officialContact}
          text={`${ui.officialContactLead} ${ui.contactNote}`}
          email={SUPPORT_EMAIL}
        />
      )}
    />
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
