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
  Object.freeze({ key: "local", label: "محلي", note: "" }),
  Object.freeze({ key: "imported_from_vietnam", label: "مستورد فيتنامي", note: "" }),
  Object.freeze({ key: "mirror_original", label: "ميرور اوريجينال", note: "" }),
  Object.freeze({ key: "original", label: "أوريجينال", note: "" }),
]);

const BY_KEY = new Map(PRODUCT_GRADES.map((grade, index) => [grade.key, { ...grade, rank: index }]));

export const productGrade = (key = "") => BY_KEY.get(String(key ?? "").trim().toLowerCase()) || null;

// Unknown or missing grades sort after every known one.
export const productGradeRank = (key = "") => productGrade(key)?.rank ?? PRODUCT_GRADES.length;

export default PRODUCT_GRADES;
