export const DAY_FIRST_INPUT_LOCALE = "en-GB";
export const DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"]';

const applyDayFirstLocale = (element) => {
  if (!element?.matches?.(DATE_INPUT_SELECTOR)) return;
  element.setAttribute("lang", DAY_FIRST_INPUT_LOCALE);
  element.setAttribute("dir", "ltr");
};

const applyWithin = (root) => {
  applyDayFirstLocale(root);
  root?.querySelectorAll?.(DATE_INPUT_SELECTOR).forEach(applyDayFirstLocale);
};

export const installDayFirstDateInputs = () => {
  if (typeof document === "undefined") return () => {};

  applyWithin(document);

  if (typeof MutationObserver === "undefined") return () => {};

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node?.nodeType === 1) applyWithin(node);
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
};
