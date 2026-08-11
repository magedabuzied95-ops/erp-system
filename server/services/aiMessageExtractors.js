// Phase 10.6: normalize Arabic-Indic digits (٤٤ → 44) before extracting a footwear size, so "مقاس ٤٤"
// and "مقاس 44" both resolve to "44". No new size system — just digit normalization on the same ranges.
const toAsciiDigits = (value = "") =>
  String(value)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

export function extractShoeSize(message = "") {
  const text = toAsciiDigits(message);
  const match = text.match(/\b(20|21|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40|41|42|43|44|45|46|47|48)\b/);
  return match ? match[1] : null;
}
