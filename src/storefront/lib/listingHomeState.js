// Small decisions the listing page and the homepage make about what to keep on
// screen. Kept free of React and the Storefront module so they can be tested
// on their own.

// A bootstrap copy older than a day is not painted: it can show sold-out pairs
// and old prices for the seconds the live request takes.
export const STOREFRONT_HOME_PERSISTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const persistedStorefrontHomeData = (cached, nowMs = Date.now()) => {
  const at = Number(cached?.at);
  if (!cached?.data || !Number.isFinite(at) || nowMs - at > STOREFRONT_HOME_PERSISTED_MAX_AGE_MS) return null;
  return cached.data;
};

export const hasStorefrontHomeContent = (state = {}) =>
  Boolean(state?.hero || state?.mirrorProducts?.length || state?.collections?.length);

// A filtered homepage row opens on its first audience. When that audience has
// nothing right now and the visitor has not picked one, the row moves on to the
// next audience instead of hiding a row that has products for someone else.
// Returns the audience to switch to, or "" to stay.
export const nextHomeFilterRowAudience = ({ genders = [], gender = "", answeredGender = "", loading = false, cardCount = 0, picked = false } = {}) => {
  if (picked || loading || cardCount > 0 || answeredGender !== gender) return "";
  const index = genders.indexOf(gender);
  return index >= 0 && index + 1 < genders.length ? genders[index + 1] : "";
};

// Whether the row keeps its header and audience switch while it has no cards.
// It does whenever there is another audience to switch to - unless nobody chose
// anything and every audience has already come back empty, which is a row with
// nothing to offer anyone.
export const keepHomeFilterRowWhenEmpty = ({ genders = [], gender = "", picked = false } = {}) => {
  if (genders.length < 2) return false;
  if (picked) return true;
  return genders.indexOf(gender) < genders.length - 1;
};

// A ?page= past the last page, judged only on an answer that belongs to the
// request on screen.
export const listingPageOutOfRange = ({ page = 1, pageSize = 24, total = 0, settled = false, error = "" } = {}) => {
  if (!settled || error || !(Number(total) > 0)) return false;
  return Number(page) > Math.max(1, Math.ceil(Number(total) / Math.max(1, Number(pageSize) || 1)));
};
