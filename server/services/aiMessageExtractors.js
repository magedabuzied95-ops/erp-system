export function extractShoeSize(message = "") {
  const text = String(message);
  const match = text.match(/\b(20|21|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40|41|42|43|44|45|46|47|48)\b/);
  return match ? match[1] : null;
}
