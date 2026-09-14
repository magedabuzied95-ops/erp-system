import { Link } from "react-router-dom";
import { Mail, MessageCircle } from "lucide-react";
import "./policy.css";

/*
 * One frame for the shop's help and policy pages — FAQ, returns, privacy, terms, data deletion —
 * in the homepage look. Presentation only: every string arrives as a prop, because the legal pages
 * render outside the storefront shell with their own language switch and cannot read the
 * storefront's i18n. Colours are `--m1h-*` tokens with the homepage's light values as fallbacks,
 * so a legal page opened straight from a reviewer's link still paints correctly.
 */

export function PolicyTabs({ links = [], label = "" }) {
  if (!links.length) return null;
  return (
    <nav className="sfp-tabs" aria-label={label}>
      {links.map((link) => (
        <Link key={link.to} to={link.to} className={`sfp-tab${link.active ? " is-active" : ""}`} aria-current={link.active ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function PolicyHelp({ title, text, whatsappHref = "", whatsappLabel = "", email = "", emailLabel = "" }) {
  return (
    <aside className="sfp-help">
      <div className="sfp-help__copy">
        <h2 className="sfp-help__title">{title}</h2>
        {text ? <p className="sfp-help__text">{text}</p> : null}
      </div>
      <div className="sfp-help__actions">
        {whatsappHref ? (
          <a href={whatsappHref} target="_blank" rel="noreferrer" className="sfp-btn sfp-btn--whatsapp">
            <MessageCircle size={16} aria-hidden="true" />
            {whatsappLabel}
          </a>
        ) : null}
        {email ? (
          <a href={`mailto:${email}`} className="sfp-btn sfp-btn--outline">
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
    <Tag className="sfp" dir={dir} lang={lang}>
      <div className="sfp-wrap">
        {tabs}
        <header className="sfp-head">
          <h1 className="sfp-title">{title}</h1>
          {lead ? <p className="sfp-lead">{lead}</p> : null}
          {meta || actions ? (
            <div className="sfp-head__row">
              {meta ? <span className="sfp-meta">{meta}</span> : null}
              {actions ? <div className="sfp-head__actions">{actions}</div> : null}
            </div>
          ) : null}
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
                <h2 id={`${section.id}-title`} className="sfp-h2">{section.title}</h2>
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
