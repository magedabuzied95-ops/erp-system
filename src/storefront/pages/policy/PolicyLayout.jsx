import { Link } from "react-router-dom";
import { Mail, MessageCircle } from "lucide-react";
import "./policy.css";

/*
 * One frame for the shop's help and policy pages — FAQ, returns, privacy, terms, data deletion —
 * in the homepage look. Presentation only: every string arrives as a prop, because the legal pages
 * render outside the storefront shell with their own language switch and cannot read the
 * storefront's i18n. Markup carries the shared `sfx-*` primitives (page head, title, chip, button,
 * surface, input, empty state) and paints from `--m1h-*` tokens. A page rendered outside the shell
 * passes `theme` ("light" | "dark"): the root becomes `.sfx-scope` with that `data-theme`, and
 * policy.css gives the scope the default palette so a legal page opened straight from a reviewer's
 * link still paints correctly in both themes.
 */

export function PolicyTabs({ links = [], label = "" }) {
  if (!links.length) return null;
  return (
    <nav className="sfp-tabs" aria-label={label}>
      {links.map((link) => (
        <Link key={link.to} to={link.to} className={`sfp-tab sfx-chip${link.active ? " is-active" : ""}`} aria-current={link.active ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function PolicyHelp({ title, text, whatsappHref = "", whatsappLabel = "", email = "", emailLabel = "" }) {
  return (
    <aside className="sfp-help sfx-surface">
      <div className="sfp-help__copy">
        <h2 className="sfp-help__title sfx-h2">{title}</h2>
        {text ? <p className="sfp-help__text">{text}</p> : null}
      </div>
      <div className="sfp-help__actions">
        {whatsappHref ? (
          <a href={whatsappHref} target="_blank" rel="noreferrer" className="sfp-btn sfp-btn--whatsapp sfx-btn sfx-btn--whatsapp">
            <MessageCircle size={16} aria-hidden="true" />
            {whatsappLabel}
          </a>
        ) : null}
        {email ? (
          <a href={`mailto:${email}`} className="sfp-btn sfp-btn--outline sfx-btn sfx-btn--secondary">
            <Mail size={16} aria-hidden="true" />
            {emailLabel || email}
          </a>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * sections: [{ id, title, content }] — rendered in order, listed in the side contents on wide
 * screens. `intro` sits between the heading and the sections (facts, a search box).
 */
export default function PolicyLayout({
  as: Tag = "section",
  theme = "",
  dir,
  lang,
  tabs = null,
  title,
  lead = "",
  meta = null,
  actions = null,
  intro = null,
  sections = [],
  contentsLabel = "",
  help = null,
  children = null,
}) {
  const showContents = sections.length > 2 && contentsLabel;
  return (
    <Tag
      className={`sfp${theme ? " sfx-scope" : ""}`}
      data-theme={theme ? (theme === "light" ? "light" : "dark") : undefined}
      dir={dir}
      lang={lang}
    >
      <div className="sfp-wrap sfx-wrap">
        {tabs}
        <header className="sfp-head sfx-page-head">
          <div className="sfp-head__text sfx-page-head__text">
            <h1 className="sfp-title sfx-title">{title}</h1>
            {lead ? <p className="sfp-lead sfx-subtitle">{lead}</p> : null}
            {meta ? <p className="sfp-meta">{meta}</p> : null}
          </div>
          {actions ? <div className="sfp-head__actions sfx-page-head__actions">{actions}</div> : null}
        </header>

        {intro}

        <div className={`sfp-grid${showContents ? " has-contents" : ""}`}>
          {showContents ? (
            <nav className="sfp-contents" aria-label={contentsLabel}>
              <p className="sfp-contents__label">{contentsLabel}</p>
              <ol>
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="sfp-body">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="sfp-section" aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`} className="sfp-h2 sfx-h2">{section.title}</h2>
                {section.content}
              </section>
            ))}
            {children}
          </div>
        </div>

        {help}
      </div>
    </Tag>
  );
}

/** A plain clause list: the shape every policy section already has. */
export function PolicyList({ items = [] }) {
  return (
    <ul className="sfp-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
