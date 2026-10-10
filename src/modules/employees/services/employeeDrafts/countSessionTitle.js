/**
 * What to call a stock count.
 *
 * Every count is born as "جرد جديد", so a list of them says nothing: five rows,
 * one name. A count of ONE model IS that model, and that is the name the
 * employee recognises. A count the employee named keeps its name.
 *
 * A count spanning several models used to keep the generic name, on the grounds
 * that no single model speaks for it — but in a list that just brought the five
 * identical rows back. It now leads with the model on top of the sheet and says
 * how many more are under it ("Adidas Running +2"), which is both recognisable
 * and honest about not being the whole story. A count with NOTHING on its sheet
 * has nothing to be named after and keeps the generic name.
 *
 * Pure and framework-free so the rule is testable on its own, and shared by the
 * list and the open count so the two can never disagree about what to call it.
 */

// The titles a count is BORN with, in both languages — a count created on an
// Arabic phone is stored as "جرد جديد" and read on an English one, so the
// current translation alone does not recognise it. A title outside this set was
// typed by a person and is never replaced.
export const UNNAMED_COUNT_TITLES = new Set(["جرد جديد", "new stock count", "جرد جديد "]);

const clean = (value) => String(value ?? "").trim();

export const isUnnamedCountTitle = (title) => {
  const text = clean(title);
  return !text || UNNAMED_COUNT_TITLES.has(text) || UNNAMED_COUNT_TITLES.has(text.toLowerCase());
};

/**
 * @param {object} row  a count: `title`, plus `cover_product_name` and
 *                      `model_count` describing what is on its sheet.
 * @returns {string}    the name to show, or "" when there is nothing to show.
 */
export const countSessionTitle = (row = {}) => {
  const title = clean(row.title);
  const model = clean(row.cover_product_name);
  if (!isUnnamedCountTitle(title)) return title;
  if (!model) return title;
  // The server counts the models; an old row that cannot say how many still
  // has its cover, and one model is the safest thing to read that as.
  const models = Math.max(1, Number(row.model_count) || 1);
  return models > 1 ? `${model} +${models - 1}` : model;
};

/** Whether the name on screen came from the sheet rather than from a person. */
export const countTitleIsModelName = (row = {}) =>
  Boolean(clean(row.cover_product_name)) && isUnnamedCountTitle(row.title);
