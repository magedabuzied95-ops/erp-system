import i18n from "../../i18n/i18n";

/**
 * Storefront copy resolver shared by the pages that render outside (or before)
 * the main Storefront module: link-only pages such as the address and order
 * confirmation links, lazy chunks, and framework-free helpers.
 *
 * It is the same call the Storefront module makes — one `translation`
 * namespace, keys addressed as "storefront.<path>" — so a page can use either
 * import interchangeably. Components must still subscribe through
 * `useTranslation()` so a language switch re-renders them.
 */
export const sfText = (key, fallback, options = {}) => i18n.t(String(key || ""), { defaultValue: fallback, ...options });

export default sfText;
