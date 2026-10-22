// Pure wizard model shared by the browser (wizard UI) and the server (draft save,
// /validate, publisher). No React, no Node APIs — the server imports this file
// directly (server/modules/metaAds/manager/wizard/*), so keep it dependency-free.
//
// `catalog` is metaAdsCatalog() (server/modules/metaAds/metaAdsCatalog.js), served to
// the browser by GET /api/meta-ads/manager/bootstrap.

export const CONVERSION_EVENTS = [
  "PURCHASE",
  "ADD_TO_CART",
  "INITIATED_CHECKOUT",
  "ADD_PAYMENT_INFO",
  "ADD_TO_WISHLIST",
  "LEAD",
  "COMPLETE_REGISTRATION",
  "CONTENT_VIEW",
  "SEARCH",
  "CONTACT",
];

export const MESSAGING_DESTINATIONS = ["MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT", "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP"];

// call_to_action.value.app_destination per messaging destination.
export const APP_DESTINATION = {
  MESSENGER: "MESSENGER",
  WHATSAPP: "WHATSAPP",
  INSTAGRAM_DIRECT: "INSTAGRAM_DIRECT",
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: "MESSENGER",
};

export const LOCATION_SEARCH_TYPES = ["country", "region", "city", "zip", "geo_market"];
export const PIN_RADII = [1, 2, 5, 10, 15, 25, 40, 50, 80];
export const MAX_CAROUSEL_CARDS = 10;
export const MIN_CAROUSEL_CARDS = 2;
export const LIMITS = { primaryText: 125, headline: 40, description: 27 };

const FALLBACK_LOCATION_TYPES = { home_recent: ["home", "recent"], home: ["home"], recent: ["recent"] };
const ALL_PLATFORMS = ["facebook", "instagram", "audience_network", "messenger"];

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

// ------------------------------------------------------------------ defaults

export const emptyCard = () => ({ headline: "", link: "", media: null });

export const defaultCampaignSpec = () => ({
  name: "",
  objective: "",
  special_ad_category: "",
  ab_test: false,
  cbo: false,
  budget_type: "daily",
  budget: "",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  publish_status: "ACTIVE",
  // Sales objective only: the Meta catalogue the campaign promotes (Advantage+ catalog ads).
  product_catalog_id: "",
});

export const defaultAdsetSpec = () => ({
  name: "",
  conversion_location: "",
  optimization_goal: "",
  billing_event: "IMPRESSIONS",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  bid_amount: "",
  conversion_event: "",
  // Catalog campaigns: the product set this ad set's ads render.
  product_set_id: "",
  budget_type: "daily",
  budget: "",
  start_time: "",
  end_time: "",
  locations: [],
  location_type: "home_recent",
  advantage_audience: true,
  age_min: 18,
  age_max: 65,
  gender: "all",
  interests: [],
  exclusions: [],
  locales: [],
  custom_audiences: [],
  excluded_custom_audiences: [],
  placements: "advantage",
  devices: "all",
  platforms: [...ALL_PLATFORMS],
  positions: {},
});

export const defaultAdSpec = () => ({
  name: "",
  use_instagram: true,
  format: "single",
  media: null,
  cards: [emptyCard(), emptyCard()],
  primary_text: "",
  primary_text_options: [],
  headline: "",
  description: "",
  cta: "",
  link: "",
  display_link: "",
  url_tags: "",
  advantage_creative: false,
  track_pixel: true,
  lead_form_id: "",
});

// A catalog ad: its ad set promotes a product set (or the ad was synced as one). Such an ad has
// no media of its own; Meta renders one card per product from the template headline/description.
export const isCatalogAd = (adSpec, adsetSpec) => adSpec?.format === "catalog" || Boolean(text(adsetSpec?.product_set_id));

// Fill a stored spec with the current defaults (older drafts miss newer keys).
export const withDefaults = (level, spec = {}) => {
  const base = level === "campaign" ? defaultCampaignSpec() : level === "adset" ? defaultAdsetSpec() : defaultAdSpec();
  const merged = { ...base, ...(spec && typeof spec === "object" ? spec : {}) };
  if (level === "ad" && (!Array.isArray(merged.cards) || !merged.cards.length)) merged.cards = [emptyCard(), emptyCard()];
  return merged;
};

// ------------------------------------------------------------------ catalog helpers

export const locationsFor = (objective, catalog) => (catalog?.conversion_locations?.[objective] || []);
export const locationFor = (objective, code, catalog) => locationsFor(objective, catalog).find((row) => row.code === code) || null;

export const goalsFor = (objective, locationCode, catalog) => {
  if (!objective) return [];
  if (objective === "OUTCOME_AWARENESS") return catalog?.awareness_goals || [];
  return locationFor(objective, locationCode, catalog)?.goals || [];
};

export const goalMeta = (code, catalog) => (catalog?.optimization_goals || []).find((row) => row.code === code) || null;

export const billingEventsFor = (goal, catalog) =>
  (catalog?.billing_events || [])
    .filter((row) => row.goals.includes("*") || row.goals.includes(goal))
    .map((row) => row.code);

export const destinationFor = (objective, adsetSpec, catalog) => {
  if (!objective || objective === "OUTCOME_AWARENESS") return "";
  return locationFor(objective, adsetSpec?.conversion_location, catalog)?.destination || "";
};

export const isMessagingDestination = (destination) => MESSAGING_DESTINATIONS.includes(destination);
export const needsBidAmount = (strategy) => strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP";
export const effectiveBidStrategy = (campaignSpec, adsetSpec) =>
  (campaignSpec?.cbo ? campaignSpec.bid_strategy : adsetSpec?.bid_strategy) || "LOWEST_COST_WITHOUT_CAP";
export const isLifetimeBudget = (campaignSpec, adsetSpec) =>
  (campaignSpec?.cbo ? campaignSpec.budget_type : adsetSpec?.budget_type) === "lifetime";

export const ctaOptionsFor = (objective, catalog) => catalog?.cta_by_objective?.[objective] || catalog?.cta_types || [];

// The CTA that will actually be sent: messaging destinations force theirs.
export const resolveCta = ({ adSpec, objective, destination, catalog }) => {
  const forced = catalog?.messaging_cta?.[destination];
  if (forced) return forced;
  const options = ctaOptionsFor(objective, catalog);
  if (adSpec?.cta && (options.includes(adSpec.cta) || !options.length)) return adSpec.cta;
  return options[0] || "LEARN_MORE";
};

export const usesInstantForm = (objective, adsetSpec) => objective === "OUTCOME_LEADS" && adsetSpec?.conversion_location === "INSTANT_FORMS";

// Destinations whose ad needs a website URL typed by the user.
export const adNeedsWebsite = (destination) => destination === "WEBSITE";

// ------------------------------------------------------------------ promoted object

export const promotedObjectFor = ({ objective, adsetSpec, account = {}, catalog }) => {
  const goal = adsetSpec?.optimization_goal;
  const meta = goalMeta(goal, catalog);
  const destination = destinationFor(objective, adsetSpec, catalog);
  const pageId = text(account.page_id);
  // A catalog ad set promotes its product set; the pixel rides along so purchases count.
  if (text(adsetSpec?.product_set_id)) {
    const out = { product_set_id: text(adsetSpec.product_set_id) };
    if (account.pixel_id) Object.assign(out, { pixel_id: text(account.pixel_id), custom_event_type: adsetSpec.conversion_event || "PURCHASE" });
    return out;
  }
  if (meta?.promoted === "pixel") {
    if (!account.pixel_id) return {};
    return { pixel_id: text(account.pixel_id), custom_event_type: adsetSpec.conversion_event || "PURCHASE" };
  }
  if (meta?.promoted === "app" || destination === "APP") {
    const out = {};
    if (account.application_id) out.application_id = text(account.application_id);
    if (account.app_store_url) out.object_store_url = text(account.app_store_url);
    return out;
  }
  if (isMessagingDestination(destination)) {
    const out = pageId ? { page_id: pageId } : {};
    if ((destination === "WHATSAPP" || destination === "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP") && account.whatsapp_phone_number) {
      out.whatsapp_phone_number = text(account.whatsapp_phone_number);
    }
    return out;
  }
  if (meta?.promoted === "page" || ["ON_POST", "ON_PAGE", "ON_AD", "PHONE_CALL"].includes(destination)) {
    return pageId ? { page_id: pageId } : {};
  }
  // Website conversions for sales / leads: attach the pixel when the user picked an event.
  if (destination === "WEBSITE" && account.pixel_id && adsetSpec?.conversion_event && ["OUTCOME_SALES", "OUTCOME_LEADS"].includes(objective)) {
    return { pixel_id: text(account.pixel_id), custom_event_type: adsetSpec.conversion_event };
  }
  return {};
};

export const promotedNeeds = ({ objective, adsetSpec, catalog }) => {
  const meta = goalMeta(adsetSpec?.optimization_goal, catalog);
  const destination = destinationFor(objective, adsetSpec, catalog);
  return {
    pixel: meta?.promoted === "pixel",
    app: meta?.promoted === "app" || destination === "APP",
    page: meta?.promoted === "page" || isMessagingDestination(destination) || ["ON_POST", "ON_PAGE", "ON_AD", "PHONE_CALL"].includes(destination),
  };
};

// ------------------------------------------------------------------ targeting

const locationTypesFor = (code, catalog) => {
  const row = (catalog?.location_types || []).find((item) => item.code === code);
  return row?.value || FALLBACK_LOCATION_TYPES[code] || FALLBACK_LOCATION_TYPES.home_recent;
};

const geoFrom = (list) => {
  const geo = {};
  const push = (field, value) => {
    geo[field] = geo[field] || [];
    geo[field].push(value);
  };
  for (const loc of list) {
    switch (loc.type) {
      case "country":
        push("countries", text(loc.key));
        break;
      case "region":
        push("regions", { key: text(loc.key) });
        break;
      case "city": {
        const city = { key: text(loc.key) };
        if (amount(loc.radius)) Object.assign(city, { radius: Number(loc.radius), distance_unit: "kilometer" });
        push("cities", city);
        break;
      }
      case "zip":
        push("zips", { key: text(loc.key) });
        break;
      case "geo_market":
        push("geo_markets", { key: text(loc.key) });
        break;
      case "custom":
        push("custom_locations", {
          latitude: Number(loc.latitude),
          longitude: Number(loc.longitude),
          radius: Number(loc.radius) || 10,
          distance_unit: "kilometer",
        });
        break;
      default:
        break;
    }
  }
  return geo;
};

// Wizard audience/placement spec → Marketing API `targeting`.
export const targetingFromSpec = (spec = {}, catalog = null) => {
  const s = withDefaults("adset", spec);
  const includes = s.locations.filter((loc) => !loc.exclude);
  const excludes = s.locations.filter((loc) => loc.exclude);
  const targeting = {
    geo_locations: { ...geoFrom(includes), location_types: locationTypesFor(s.location_type, catalog) },
    age_min: Number(s.age_min) || 18,
    age_max: Number(s.age_max) || 65,
  };
  if (excludes.length) targeting.excluded_geo_locations = geoFrom(excludes);
  if (s.gender === "men") targeting.genders = [1];
  if (s.gender === "women") targeting.genders = [2];
  if (s.interests.length) targeting.flexible_spec = [{ interests: s.interests.map((row) => ({ id: text(row.id), name: text(row.name) })) }];
  if (s.exclusions.length) targeting.exclusions = { interests: s.exclusions.map((row) => ({ id: text(row.id), name: text(row.name) })) };
  if (s.locales.length) targeting.locales = s.locales.map((row) => Number(row.key)).filter(Number.isFinite);
  if (s.custom_audiences.length) targeting.custom_audiences = s.custom_audiences.map((row) => ({ id: text(row.id) }));
  if (s.excluded_custom_audiences.length) targeting.excluded_custom_audiences = s.excluded_custom_audiences.map((row) => ({ id: text(row.id) }));
  if (s.placements === "manual") {
    const platforms = s.platforms.filter((p) => ALL_PLATFORMS.includes(p));
    targeting.publisher_platforms = platforms;
    targeting.device_platforms = s.devices === "mobile" ? ["mobile"] : s.devices === "desktop" ? ["desktop"] : ["mobile", "desktop"];
    for (const node of catalog?.placement_tree || []) {
      const chosen = (s.positions?.[node.platform] || []).filter(Boolean);
      if (platforms.includes(node.platform) && chosen.length) targeting[node.field] = chosen;
    }
  }
  targeting.targeting_automation = { advantage_audience: s.advantage_audience ? 1 : 0 };
  return targeting;
};

// Marketing API `targeting` → wizard spec fields (opening a live ad set in the form).
export const specFromTargeting = (targeting = {}, catalog = null) => {
  const t = targeting && typeof targeting === "object" ? targeting : {};
  const locations = [];
  const readGeo = (geo, exclude) => {
    if (!geo) return;
    for (const code of geo.countries || []) locations.push({ key: code, name: code, type: "country", country_code: code, exclude });
    for (const row of geo.regions || []) locations.push({ key: text(row.key), name: text(row.name) || text(row.key), type: "region", country_code: text(row.country), exclude });
    for (const row of geo.cities || []) {
      locations.push({ key: text(row.key), name: text(row.name) || text(row.key), type: "city", country_code: text(row.country), region: text(row.region), radius: row.radius || "", exclude });
    }
    for (const row of geo.zips || []) locations.push({ key: text(row.key), name: text(row.name) || text(row.key), type: "zip", country_code: text(row.country), exclude });
    for (const row of geo.geo_markets || []) locations.push({ key: text(row.key), name: text(row.name) || text(row.key), type: "geo_market", country_code: text(row.country), exclude });
    for (const row of geo.custom_locations || []) {
      locations.push({
        key: `${row.latitude},${row.longitude}`,
        name: text(row.name) || text(row.address_string) || `${Number(row.latitude).toFixed(4)}, ${Number(row.longitude).toFixed(4)}`,
        type: "custom",
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        radius: Number(row.radius) || 10,
        country_code: text(row.country),
        exclude,
      });
    }
  };
  readGeo(t.geo_locations, false);
  readGeo(t.excluded_geo_locations, true);
  const types = (t.geo_locations?.location_types || []).slice().sort().join(",");
  const typeRow = (catalog?.location_types || []).find((row) => row.value.slice().sort().join(",") === types);
  const interests = [];
  for (const block of t.flexible_spec || []) for (const row of block.interests || []) interests.push({ id: text(row.id), name: text(row.name) });
  for (const row of t.interests || []) interests.push({ id: text(row.id), name: text(row.name) });
  const platforms = Array.isArray(t.publisher_platforms) && t.publisher_platforms.length ? t.publisher_platforms : null;
  const positions = {};
  for (const node of catalog?.placement_tree || []) if (Array.isArray(t[node.field])) positions[node.platform] = t[node.field];
  const devices = Array.isArray(t.device_platforms) && t.device_platforms.length === 1 ? t.device_platforms[0] : "all";
  const genders = Array.isArray(t.genders) ? t.genders.map(Number) : [];
  return {
    locations,
    location_type: typeRow?.code || "home_recent",
    age_min: Number(t.age_min) || 18,
    age_max: Number(t.age_max) || 65,
    gender: genders.length === 1 ? (genders[0] === 1 ? "men" : "women") : "all",
    interests,
    exclusions: (t.exclusions?.interests || []).map((row) => ({ id: text(row.id), name: text(row.name) })),
    locales: (t.locales || []).map((key) => ({ key: String(key), name: String(key) })),
    custom_audiences: (t.custom_audiences || []).map((row) => ({ id: text(row.id), name: text(row.name) || text(row.id) })),
    excluded_custom_audiences: (t.excluded_custom_audiences || []).map((row) => ({ id: text(row.id), name: text(row.name) || text(row.id) })),
    advantage_audience: Number(t.targeting_automation?.advantage_audience) === 1,
    placements: platforms ? "manual" : "advantage",
    platforms: platforms || [...ALL_PLATFORMS],
    positions,
    devices,
  };
};

// Countries an ad set reaches (for DSA + special ad category country).
export const targetedCountries = (adsetSpec = {}) => {
  const out = new Set();
  for (const loc of adsetSpec.locations || []) {
    if (loc.exclude) continue;
    const code = text(loc.type === "country" ? loc.key : loc.country_code).toUpperCase();
    if (code) out.add(code);
  }
  return [...out];
};

export const targetsEu = (adsetSpec, catalog) => {
  const eu = new Set(catalog?.eu_countries || []);
  return targetedCountries(adsetSpec).some((code) => eu.has(code));
};

// The audience part of an ad set spec ("حفظ الجمهور" stores exactly this).
export const AUDIENCE_KEYS = [
  "locations", "location_type", "advantage_audience", "age_min", "age_max", "gender", "interests", "exclusions",
  "locales", "custom_audiences", "excluded_custom_audiences",
];
export const audienceFromSpec = (spec = {}) => Object.fromEntries(AUDIENCE_KEYS.map((key) => [key, spec[key]]));

// ------------------------------------------------------------------ time (one Cairo clock)

const APP_TZ = "Africa/Cairo";

const tzOffsetMinutes = (date, timeZone = APP_TZ) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
};

// "2026-10-21T10:00" typed as Cairo wall time → ISO instant.
export const cairoLocalToIso = (value) => {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const offset = tzOffsetMinutes(guess);
  const instant = new Date(guess.getTime() - offset * 60000);
  const corrected = tzOffsetMinutes(instant);
  return new Date(guess.getTime() - corrected * 60000).toISOString();
};

// ISO instant → "YYYY-MM-DDTHH:mm" Cairo wall time (for datetime-local inputs).
export const isoToCairoLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};
