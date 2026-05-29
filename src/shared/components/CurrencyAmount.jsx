import { formatCurrencyParts } from "../lib/currency";

export default function CurrencyAmount({ value, language, className = "", title, signed = false }) {
  const numericValue = Number(value || 0);
  const sign = signed && numericValue < 0 ? "-" : "";
  const parts = formatCurrencyParts(Math.abs(numericValue), language || {});
  const amount = `${sign}${parts.amount}`;
  const displayTitle = title || (parts.isRtl ? `${amount} ${parts.symbol}` : `${parts.symbol} ${amount}`);

  return (
    <span
      dir="ltr"
      className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${className}`.trim()}
      title={displayTitle}
    >
      {parts.isRtl ? (
        <>
          <span>{amount}</span>
          <span>{parts.symbol}</span>
        </>
      ) : (
        <>
          <span>{parts.symbol}</span>
          <span>{amount}</span>
        </>
      )}
    </span>
  );
}

export function CurrencyText({ value, className = "" }) {
  const text = String(value ?? "").trim();
  const rtlMatch = text.match(/^(-?\d[\d,]*(?:\.\d{1,2})?)\s+(.+)$/);
  const ltrMatch = text.match(/^([A-Z]{2,4}|\$|€)\s+(-?\d[\d,]*(?:\.\d{1,2})?)$/);

  if (rtlMatch) {
    return (
      <span dir="ltr" className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${className}`.trim()} title={text}>
        <span>{rtlMatch[1]}</span>
        <span>{rtlMatch[2]}</span>
      </span>
    );
  }

  if (ltrMatch) {
    return (
      <span dir="ltr" className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${className}`.trim()} title={text}>
        <span>{ltrMatch[1]}</span>
        <span>{ltrMatch[2]}</span>
      </span>
    );
  }

  return value;
}
