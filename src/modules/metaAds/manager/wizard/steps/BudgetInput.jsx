import { WzInput } from "../parts";

// Money input with the account currency as suffix ("0.00 USD").
export function BudgetInput({ value, currency, onChange, invalid, placeholder = "0.00", ariaLabel }) {
  return (
    <WzInput
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      dir="ltr"
      value={value ?? ""}
      placeholder={placeholder}
      aria-label={ariaLabel}
      invalid={invalid}
      suffix={currency || "USD"}
      onChange={(event) => onChange(event.target.value)}
      className="wz-money"
    />
  );
}
