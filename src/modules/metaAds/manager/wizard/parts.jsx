import { ChevronDown, ChevronUp } from "lucide-react";

import ThemedSelect from "../../../../shared/ui/ThemedSelect";

// Small building blocks shared by the wizard steps (cards, radio cards, toggles…).

export function WzCard({ title, subtitle, action, field, children, className = "" }) {
  return (
    <section className={`wz-card ${className}`.trim()} data-wz-field={field || undefined}>
      {title || action ? (
        <header className="wz-card__head">
          <div className="wz-card__titles">
            {title ? <h3 className="wz-card__title">{title}</h3> : null}
            {subtitle ? <p className="wz-card__subtitle">{subtitle}</p> : null}
          </div>
          {action ? <div className="wz-card__action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function WzField({ label, hint, error, field, children, className = "" }) {
  return (
    <div className={`wz-field ${error ? "wz-field--error" : ""} ${className}`.trim()} data-wz-field={field || undefined}>
      {label ? <div className="wz-label">{label}</div> : null}
      {children}
      {error ? <div className="wz-error">{error}</div> : hint ? <div className="wz-hint">{hint}</div> : null}
    </div>
  );
}

export function RadioCard({ checked, onSelect, icon: Icon, title, description, children, disabled = false }) {
  return (
    <div className={`wz-radio-card ${checked ? "is-checked" : ""} ${disabled ? "is-disabled" : ""}`.trim()}>
      <button type="button" role="radio" aria-checked={checked} disabled={disabled} className="wz-radio-card__button" onClick={onSelect}>
        {Icon ? (
          <span className="wz-radio-card__icon" aria-hidden="true">
            <Icon size={20} />
          </span>
        ) : null}
        <span className="wz-radio-card__text">
          <span className="wz-radio-card__title">{title}</span>
          {description ? <span className="wz-radio-card__desc">{description}</span> : null}
        </span>
        <span className="wz-radio-dot" aria-hidden="true" />
      </button>
      {checked && children ? <div className="wz-radio-card__extra">{children}</div> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      className={`wz-toggle ${checked ? "is-on" : ""}`.trim()}
      onClick={() => onChange(!checked)}
    >
      <span className="wz-toggle__thumb" />
    </button>
  );
}

export function ToggleCard({ icon: Icon, title, description, checked, onChange }) {
  return (
    <div className="wz-toggle-card">
      <div className="wz-toggle-card__text">
        <div className="wz-toggle-card__title">
          {Icon ? <Icon size={16} className="wz-sparkle" aria-hidden="true" /> : null}
          <span>{title}</span>
        </div>
        {description ? <p className="wz-toggle-card__desc">{description}</p> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div className="wz-segmented" role="radiogroup" aria-label={ariaLabel}>
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

export function CharCount({ value, max }) {
  const length = String(value || "").length;
  return <div className={`wz-counter ${length > max ? "is-over" : ""}`.trim()}>{`${length}/${max}`}</div>;
}

export function MoreToggle({ open, onToggle, label }) {
  return (
    <button type="button" className="wz-link" onClick={onToggle} aria-expanded={open}>
      {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}

export function WzSelect({ value, onChange, options, placeholder, ariaLabel, disabled, className = "" }) {
  return (
    <ThemedSelect
      value={value ?? ""}
      onChange={(next) => onChange(next)}
      options={options}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
      className={`wz-select ${className}`.trim()}
      triggerClassName="wz-select__trigger"
    />
  );
}

export function WzInput({ invalid, suffix, prefix, className = "", ...props }) {
  return (
    <span className={`wz-input ${invalid ? "is-invalid" : ""} ${className}`.trim()}>
      {prefix ? <span className="wz-input__slot">{prefix}</span> : null}
      <input className="wz-input__control" {...props} />
      {suffix ? <span className="wz-input__slot wz-input__suffix">{suffix}</span> : null}
    </span>
  );
}

export function WzTextarea({ invalid, className = "", ...props }) {
  return <textarea className={`wz-textarea ${invalid ? "is-invalid" : ""} ${className}`.trim()} {...props} />;
}
