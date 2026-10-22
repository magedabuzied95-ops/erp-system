import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

import { META_ADS_ROOT, META_ADS_SECTIONS, pagePath, sectionForPath } from "./metaAdsNav";
import "./metaAds.css";

const MENU_WIDTH = 220;
const EDGE = 8;

// Where the open menu sits, from its button. The menu is portaled to <body>:
// the section buttons live in a horizontal scroller, and iOS Safari clips a
// position:fixed child of an overflow-x:auto ancestor, so on a phone the menu
// opened invisible. Aligned to the button's inline-start, kept on screen.
const menuPositionFor = (button) => {
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth || window.innerWidth;
  const maxStart = Math.max(EDGE, viewport - EDGE - MENU_WIDTH);
  const rtl = getComputedStyle(button).direction === "rtl";
  const top = rect.bottom;
  return rtl
    ? { top, right: Math.min(Math.max(EDGE, viewport - rect.right), maxStart) }
    : { top, left: Math.min(Math.max(EDGE, rect.left), maxStart) };
};

// The module bar: one button per section; each opens the list of its pages.
// The "Ads Manager" chip at the end is the module's home.
export default function MetaAdsSectionBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState("");
  const [menuStyle, setMenuStyle] = useState(null);
  const barRef = useRef(null);
  const menuRef = useRef(null);
  const buttonRefs = useRef({});
  const active = sectionForPath(pathname);

  useEffect(() => {
    setOpen("");
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (barRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen("");
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen("");
    };
    // The menu is pinned to where the button was; any scroll or resize would
    // leave it floating somewhere else, so close it instead.
    const onMove = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setOpen("");
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const toggleSection = (key) => {
    if (open === key) {
      setOpen("");
      return;
    }
    setMenuStyle(menuPositionFor(buttonRefs.current[key]));
    setOpen(key);
  };

  const isHome = pathname.replace(/\/+$/, "") === META_ADS_ROOT;
  const openSection = META_ADS_SECTIONS.find((section) => section.key === open) || null;

  return (
    <nav ref={barRef} className="meta-ads-bar" aria-label={t("metaAds.nav.menuAria")}>
      <div className="meta-ads-bar__sections">
        {META_ADS_SECTIONS.map((section) => (
          <div key={section.key} className="meta-ads-bar__section">
            <button
              ref={(node) => {
                buttonRefs.current[section.key] = node;
              }}
              type="button"
              className={`meta-ads-bar__button${active === section.key ? " is-active" : ""}`}
              aria-expanded={open === section.key}
              aria-haspopup="menu"
              onClick={() => toggleSection(section.key)}
            >
              {t(`metaAds.nav.sections.${section.key}`)}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <Link to={META_ADS_ROOT} className={`meta-ads-bar__home${isHome ? " is-active" : ""}`}>
        {t("metaAds.nav.pages.adsManager")}
      </Link>
      {openSection && menuStyle
        ? createPortal(
            <div ref={menuRef} className="meta-ads-bar__menu" role="menu" style={menuStyle}>
              {openSection.pages.map((page) => {
                const to = pagePath(page);
                const current = pathname.replace(/\/+$/, "") === to || (page.resource && pathname.startsWith(`${to}/`));
                return (
                  <Link key={page.key} role="menuitem" to={to} className={`meta-ads-bar__item${current ? " is-current" : ""}`}>
                    {t(`metaAds.nav.pages.${page.key}`)}
                  </Link>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </nav>
  );
}
