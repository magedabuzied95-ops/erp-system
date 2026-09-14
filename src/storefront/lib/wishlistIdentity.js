/*
 * Who a wishlist entry is.
 *
 * A listing card's id is `product:colour`. The wishlist keeps one entry per hearted colour (`key`),
 * while the server row behind it keeps the model (`id`): Number("785:uuid") is NaN, which the
 * server answered with a 401 and the client with a logout. An entry without a colour (the product
 * page heart, a row synced from the server) stands for every colour of its model.
 */

export const wishlistIdOf = (item = {}) =>
  String(item?.parent_product_id || item?.product_id || item?.id || "").split(":")[0].trim();

export const wishlistColourOf = (item = {}) => {
  const own = String(item?.color_key || item?.display_color_key || "").trim();
  if (own) return own;
  const id = String(item?.id || "");
  return id.includes(":") ? id.slice(id.indexOf(":") + 1).trim() : "";
};

export const wishlistKeyOf = (item = {}) => {
  const id = wishlistIdOf(item);
  const colour = wishlistColourOf(item);
  return id && colour ? `${id}:${colour}` : id;
};

export const wishlistEntryMatches = (entry, product) => {
  if (!wishlistIdOf(product) || wishlistIdOf(entry) !== wishlistIdOf(product)) return false;
  const entryColour = wishlistColourOf(entry);
  const productColour = wishlistColourOf(product);
  return !entryColour || !productColour || entryColour === productColour;
};

export const isInWishlist = (wishlist, product) =>
  (Array.isArray(wishlist) ? wishlist : []).some((entry) => wishlistEntryMatches(entry, product));

/**
 * What a heart does to the list: every entry the product matches goes, or the new entry comes in
 * first. `serverChange` is null when the server row (the model) stays as it is — a colour left while
 * another colour of the same model is still saved.
 */
export const toggleWishlistEntries = (entries, product, entry) => {
  const list = Array.isArray(entries) ? entries : [];
  const exists = list.some((current) => wishlistEntryMatches(current, product));
  const next = exists ? list.filter((current) => !wishlistEntryMatches(current, product)) : [entry, ...list];
  const modelStays = exists && next.some((current) => wishlistIdOf(current) === entry.id);
  return { next, serverChange: modelStays ? null : exists ? "remove" : "add" };
};

/**
 * A signed-in browser's list against the server's, by model. `baseIds` are the models this browser
 * last knew the server to hold for this phone (null: it never synced, so every entry here is a
 * guest heart to add). A model here but not on the server was removed on another device when the
 * base has it -- dropped here, never re-created -- and hearted here since when it does not. The old
 * merge could not tell the two apart, so a removal came back from every stale device.
 * Returns the merged entries and the model ids to POST.
 */
export const reconcileWishlistWithServer = ({ local = [], remote = [], baseIds = null } = {}) => {
  const localList = Array.isArray(local) ? local : [];
  const remoteList = Array.isArray(remote) ? remote : [];
  const remoteIds = new Set(remoteList.map(wishlistIdOf).filter(Boolean));
  const base = Array.isArray(baseIds) ? new Set(baseIds.map((id) => String(id))) : null;
  const kept = localList.filter((entry) => {
    const id = wishlistIdOf(entry);
    return remoteIds.has(id) || !base || !base.has(id);
  });
  const keptIds = new Set(kept.map(wishlistIdOf));
  return {
    merged: [...kept, ...remoteList.filter((entry) => !keptIds.has(wishlistIdOf(entry)))],
    toAdd: [...keptIds].filter((id) => id && !remoteIds.has(id)),
  };
};

/**
 * Removing several entries with a toggle each: a colour-less entry matches every colour of its
 * model, and a toggle on an entry already gone would add it back, so only the entries still matched
 * by what is left get their toggle.
 */
export const entriesToToggleForClear = (entries) => {
  let left = Array.isArray(entries) ? entries : [];
  return left.filter((entry) => {
    if (!left.some((other) => wishlistEntryMatches(other, entry))) return false;
    left = left.filter((other) => !wishlistEntryMatches(other, entry));
    return true;
  });
};

/**
 * Putting removed entries back, oldest first (a toggle puts its entry first). A colour-less entry
 * beside a colour of its own model is left out: its toggle would take that colour out again, and
 * the colour already carries the model.
 */
export const entriesToToggleForRestore = (current, saved) => {
  const restorable = (Array.isArray(saved) ? saved : []).filter(
    (entry) => entry.color_key || !saved.some((other) => other.id === entry.id && other.color_key)
  );
  let list = Array.isArray(current) ? current : [];
  return [...restorable].reverse().filter((entry) => {
    if (isInWishlist(list, entry)) return false;
    list = [entry, ...list];
    return true;
  });
};
