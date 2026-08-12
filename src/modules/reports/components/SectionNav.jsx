import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Section navigator for the long analytical page.
 *
 * Desktop only. On a phone the page is already collapsed section by section, and a bar
 * would eat scarce vertical space to solve a problem that does not exist there.
 *
 * Deliberately NOT sticky. The app shell sets overflow-x:hidden on <main>, on its inner
 * wrapper and on .m1-shell-content; each of those computes overflow-y:auto, which makes
 * them scroll containers. A sticky child then anchors to a container that never scrolls,
 * so it simply scrolls away. Making it stick would mean changing the shell's overflow
 * for every page in the ERP, which is not a change the Reporting Center should make on
 * its own. As a jump bar at the head of the analytics it still does its job.
 *
 * Scrolling uses the native scrollIntoView with the anchor's own id, so there is no
 * scroll library and no route change — the URL is reserved for filter state, and
 * pushing a hash would fight the filter hook for it.
 *
 * The active item is tracked with an IntersectionObserver rather than a scroll handler,
 * so nothing runs per scroll frame.
 */
export default function SectionNav({ sections = [] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(sections[0]?.id || null);

  useEffect(() => {
    const nodes = sections.map((section) => document.getElementById(section.id)).filter(Boolean);
    if (!nodes.length || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        // The entry closest to the top of the viewport wins, so a tall section does not
        // keep the highlight while a shorter one fills the screen.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -60% 0px", threshold: 0 }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  const go = (id) => {
    const node = document.getElementById(id);
    if (!node) return;
    // Honour a reduced-motion preference, and jump rather than animate wherever smooth
    // scrolling is unavailable — the point is to arrive at the section, not the travel.
    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    setActive(id);
  };

  return (
    <nav
      aria-label={t("salesAnalytics.nav.label")}
      className="-mx-1 hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-1 py-1 lg:block"
    >
      <ul className="flex items-center gap-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => go(section.id)}
              aria-current={active === section.id ? "true" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] 2xl:text-[13px] ${ active === section.id ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" }`}
            >
              {t(`salesAnalytics.nav.${section.key}`)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
