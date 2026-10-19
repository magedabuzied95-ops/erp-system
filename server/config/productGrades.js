/*
 * The product grades of products.grade, in the order the AI presents them to a customer: the
 * local pairs first, then the imported and mirror ones. `label` is what the customer reads
 * (the same names the Telegram catalog uses).
 *
 * `note` is the owner's own explanation of what sets the grade apart (material, sole, finish).
 * The AI explains the difference between grades ONLY with these notes — an empty note means
 * it names the grade and says nothing about its material.
 */
export const PRODUCT_GRADES = Object.freeze([
  // The owner's words, 2026-10-19. The customer never reads "محلي": the local grade is "مصري".
  Object.freeze({ key: "local", label: "مصري", note: "خامة محترمة" }),
  Object.freeze({ key: "imported_from_vietnam", label: "مستورد فيتنامي", note: "خامة أعلى وتشطيب أنضف من المصري، وعمره أطول" }),
  Object.freeze({ key: "mirror_original", label: "ميرور اوريجينال", note: "نسخة طبق الأصل من الأوريجينال في الشكل والخامة والنعل والتفاصيل" }),
  Object.freeze({ key: "original", label: "أوريجينال", note: "" }),
]);

// Cards for a model sold in several grades: every grade gets its own run of up to
// GRADE_CARD_LIMIT colours (one Messenger / Instagram carousel holds 10), local first.
// A single 6-card budget shared by all grades left the mirror Air Force — one product in
// 16 colours — at 3 cards.
export const GRADE_CARD_LIMIT = 10;
export const GRADED_CARDS_TOTAL_LIMIT = 20;

const BY_KEY = new Map(PRODUCT_GRADES.map((grade, index) => [grade.key, { ...grade, rank: index }]));

export const productGrade = (key = "") => BY_KEY.get(String(key ?? "").trim().toLowerCase()) || null;

// Unknown or missing grades sort after every known one.
export const productGradeRank = (key = "") => productGrade(key)?.rank ?? PRODUCT_GRADES.length;

export default PRODUCT_GRADES;

const BY_LABEL = new Map(PRODUCT_GRADES.map((grade) => [grade.label, grade]));

/*
 * The line that goes out right above a grade's cards, the same on WhatsApp, Messenger and
 * Instagram: "🔹 مصري — خامة محترمة", then that grade's carousel. Takes the grade key or the
 * label a card carries.
 */
export const gradeHeaderLine = (gradeOrLabel = "") => {
  const value = String(gradeOrLabel ?? "").trim();
  const grade = productGrade(value) || BY_LABEL.get(value) || null;
  if (!grade) return value ? `🔹 ${value}` : "";
  return `🔹 ${grade.label}${grade.note ? ` — ${grade.note}` : ""}`;
};
