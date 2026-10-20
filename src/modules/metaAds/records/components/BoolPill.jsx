import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";

// Boolean cell / field drawn as a small switch with ✓ / ✗ (like the reference grid).
// Clickable only when onToggle is given.
export default function BoolPill({ value, onToggle, disabled = false }) {
  const { t } = useTranslation();
  const on = Boolean(value);
  const label = on ? t("metaAds.common.yes") : t("metaAds.common.no");
  const className = `mar-bool ${on ? "is-on" : "is-off"}`;
  const knob = <span className="mar-bool__knob">{on ? <Check size={11} aria-hidden="true" /> : <X size={11} aria-hidden="true" />}</span>;
  if (!onToggle) {
    return <span className={className} role="img" aria-label={label} title={label}>{knob}</span>;
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      className={`${className} is-interactive`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(!on);
      }}
    >
      {knob}
    </button>
  );
}
