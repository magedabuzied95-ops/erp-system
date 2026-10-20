import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

import { META_ADS_ROOT, META_ADS_SECTIONS, pagePath, sectionForPath } from "./metaAdsNav";
import "./metaAds.css";

// The module bar: one button per section; each opens the list of its pages.
// The "Ads Manager" chip at the end is the module's home.
export default function MetaAdsSectionBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState("");
  const barRef = useRef(null);
  const active = sectionForPath(pathname);

  useEffect(() => {
    setOpen("");
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (barRef.current && !barRef.current.contains(event.target)) setOpen("");
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen("");
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isHome = pathname.replace(/\/+$/, "") === META_ADS_ROOT;

  return (
    <nav ref={barRef} className="meta-ads-bar" aria-label={t("metaAds.nav.menuAria")}>
      <div className="meta-ads-bar__sections">
        {META_ADS_SECTIONS.map((section) => (
          <div key={section.key} className="meta-ads-bar__section">
            <button
              type="button"
              className={`meta-ads-bar__button${active === section.key ? " is-active" : ""}`}
              aria-expanded={open === section.key}
              aria-haspopup="menu"
              onClick={() => setOpen((current) => (current === section.key ? "" : section.key))}
            >
              {t(`metaAds.nav.sections.${section.key}`)}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {open === section.key ? (
              <div className="meta-ads-bar__menu" role="menu">
                {section.pages.map((page) => {
                  const to = pagePath(page);
                  const current = pathname.replace(/\/+$/, "") === to || (page.resource && pathname.startsWith(`${to}/`));
                  return (
                    <Link key={page.key} role="menuitem" to={to} className={`meta-ads-bar__item${current ? " is-current" : ""}`}>
                      {t(`metaAds.nav.pages.${page.key}`)}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <Link to={META_ADS_ROOT} className={`meta-ads-bar__home${isHome ? " is-active" : ""}`}>
        {t("metaAds.nav.pages.adsManager")}
      </Link>
    </nav>
  );
}
