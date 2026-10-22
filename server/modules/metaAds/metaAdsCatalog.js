// Marketing API vocabulary used by the Ads Manager wizard and by server validation.
// Codes only — the frontend owns the wording (src/locales/*/metaAds*.json) so the
// same catalog serves Arabic and English. Served to the browser by GET /bootstrap.

export const OBJECTIVES = [
  { code: "OUTCOME_AWARENESS", icon: "Megaphone", goodFor: ["reach", "brandAwareness", "videoViews", "storeAwareness"] },
  { code: "OUTCOME_TRAFFIC", icon: "MousePointerClick", goodFor: ["linkClicks", "landingPageViews", "instagramProfileVisits", "calls"] },
  { code: "OUTCOME_ENGAGEMENT", icon: "MessageCircleHeart", goodFor: ["messengerWhatsapp", "videoViews", "postEngagement", "eventResponses"] },
  { code: "OUTCOME_LEADS", icon: "UserPlus", goodFor: ["instantForms", "messengerInstagram", "conversions", "calls"] },
  { code: "OUTCOME_APP_PROMOTION", icon: "TabletSmartphone", goodFor: ["appInstalls", "appEvents"] },
  { code: "OUTCOME_SALES", icon: "ShoppingCart", goodFor: ["conversions", "catalogSales", "messengerWhatsapp"] },
];

// promoted: which promoted_object the ad set needs ("page" | "pixel" | "app" | "").
export const OPTIMIZATION_GOALS = [
  { code: "REACH", promoted: "page", destination: "", objectives: ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_SALES"] },
  { code: "IMPRESSIONS", promoted: "page", destination: "", objectives: ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_SALES"] },
  { code: "LINK_CLICKS", promoted: "", destination: "", objectives: ["OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION"] },
  { code: "LANDING_PAGE_VIEWS", promoted: "", destination: "", objectives: ["OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_SALES"] },
  { code: "POST_ENGAGEMENT", promoted: "page", destination: "ON_POST", objectives: ["OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS"] },
  { code: "PAGE_LIKES", promoted: "page", destination: "ON_PAGE", objectives: ["OUTCOME_ENGAGEMENT"] },
  { code: "VIDEO_VIEWS", promoted: "page", destination: "", objectives: ["OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"] },
  { code: "THRUPLAY", promoted: "page", destination: "", objectives: ["OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"] },
  { code: "LEAD_GENERATION", promoted: "page", destination: "", objectives: ["OUTCOME_LEADS"] },
  { code: "OFFSITE_CONVERSIONS", promoted: "pixel", destination: "", objectives: ["OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION"] },
  { code: "APP_INSTALLS", promoted: "app", destination: "", objectives: ["OUTCOME_APP_PROMOTION"] },
  { code: "VALUE", promoted: "pixel", destination: "", objectives: ["OUTCOME_SALES", "OUTCOME_APP_PROMOTION"] },
  { code: "QUALITY_CALL", promoted: "page", destination: "", objectives: ["OUTCOME_LEADS"] },
  { code: "CONVERSATIONS", promoted: "page", destination: "MESSENGER", objectives: ["OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES"] },
  { code: "AD_RECALL_LIFT", promoted: "page", destination: "", objectives: ["OUTCOME_AWARENESS"] },
  { code: "REPLIES", promoted: "page", destination: "MESSENGER", objectives: ["OUTCOME_ENGAGEMENT"] },
];

// Billing events and the goals that may be billed by them.
export const BILLING_EVENTS = [
  { code: "IMPRESSIONS", goals: ["*"] },
  { code: "LINK_CLICKS", goals: ["LINK_CLICKS"] },
  { code: "VIDEO_VIEWS", goals: ["VIDEO_VIEWS"] },
  { code: "THRUPLAY", goals: ["THRUPLAY"] },
  { code: "POST_ENGAGEMENT", goals: ["POST_ENGAGEMENT"] },
  { code: "PAGE_LIKES", goals: ["PAGE_LIKES"] },
  { code: "APP_INSTALLS", goals: ["APP_INSTALLS"] },
];

// "مكان التحويل" per objective. destination = ad set destination_type sent to Meta.
// goals = what "هدف الأداء" offers for that location (first = default).
const WEB_GOALS = ["LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"];
const MSG_GOALS = ["CONVERSATIONS", "LINK_CLICKS"];
export const CONVERSION_LOCATIONS = {
  OUTCOME_AWARENESS: [],
  OUTCOME_TRAFFIC: [
    { code: "WEBSITE", destination: "WEBSITE", goals: WEB_GOALS },
    { code: "APP", destination: "APP", goals: ["LINK_CLICKS"] },
    { code: "MESSENGER", destination: "MESSENGER", goals: MSG_GOALS },
    { code: "WHATSAPP", destination: "WHATSAPP", goals: MSG_GOALS },
    { code: "INSTAGRAM_DIRECT", destination: "INSTAGRAM_DIRECT", goals: MSG_GOALS },
    { code: "MESSAGING_APPS", destination: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP", goals: MSG_GOALS },
    { code: "INSTAGRAM_PROFILE", destination: "INSTAGRAM_PROFILE", goals: ["LINK_CLICKS", "REACH"] },
    { code: "CALLS", destination: "PHONE_CALL", goals: ["LINK_CLICKS"] },
  ],
  OUTCOME_ENGAGEMENT: [
    { code: "ON_AD", destination: "ON_POST", goals: ["POST_ENGAGEMENT", "THRUPLAY", "VIDEO_VIEWS", "IMPRESSIONS", "REACH"] },
    { code: "ON_PAGE", destination: "ON_PAGE", goals: ["PAGE_LIKES"] },
    { code: "MESSENGER", destination: "MESSENGER", goals: ["CONVERSATIONS", "LINK_CLICKS", "REPLIES"] },
    { code: "WHATSAPP", destination: "WHATSAPP", goals: MSG_GOALS },
    { code: "INSTAGRAM_DIRECT", destination: "INSTAGRAM_DIRECT", goals: MSG_GOALS },
    { code: "MESSAGING_APPS", destination: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP", goals: MSG_GOALS },
    { code: "WEBSITE", destination: "WEBSITE", goals: ["OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"] },
  ],
  OUTCOME_LEADS: [
    { code: "INSTANT_FORMS", destination: "ON_AD", goals: ["LEAD_GENERATION"] },
    { code: "MESSENGER", destination: "MESSENGER", goals: ["CONVERSATIONS", "LEAD_GENERATION"] },
    { code: "WHATSAPP", destination: "WHATSAPP", goals: ["CONVERSATIONS"] },
    { code: "INSTAGRAM_DIRECT", destination: "INSTAGRAM_DIRECT", goals: ["CONVERSATIONS", "LEAD_GENERATION"] },
    { code: "WEBSITE", destination: "WEBSITE", goals: ["OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS"] },
    { code: "CALLS", destination: "PHONE_CALL", goals: ["QUALITY_CALL"] },
  ],
  OUTCOME_APP_PROMOTION: [
    { code: "APP", destination: "APP", goals: ["APP_INSTALLS", "LINK_CLICKS", "OFFSITE_CONVERSIONS", "VALUE"] },
  ],
  OUTCOME_SALES: [
    { code: "WEBSITE", destination: "WEBSITE", goals: ["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"] },
    { code: "APP", destination: "APP", goals: ["OFFSITE_CONVERSIONS", "VALUE", "LINK_CLICKS"] },
    { code: "MESSENGER", destination: "MESSENGER", goals: MSG_GOALS },
    { code: "WHATSAPP", destination: "WHATSAPP", goals: MSG_GOALS },
    { code: "INSTAGRAM_DIRECT", destination: "INSTAGRAM_DIRECT", goals: MSG_GOALS },
    { code: "MESSAGING_APPS", destination: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP", goals: MSG_GOALS },
    { code: "CALLS", destination: "PHONE_CALL", goals: ["LINK_CLICKS"] },
  ],
};

// Awareness has no conversion location; its goals come straight from here.
export const AWARENESS_GOALS = ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY", "VIDEO_VIEWS"];

export const CTA_TYPES = [
  "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "BOOK_NOW", "DOWNLOAD", "INSTALL_MOBILE_APP", "USE_MOBILE_APP",
  "GET_DIRECTIONS", "CONTACT_US", "APPLY_NOW", "BUY_NOW", "GET_OFFER", "GET_QUOTE", "CALL_NOW", "MESSAGE_PAGE",
  "SUBSCRIBE", "WATCH_MORE", "LISTEN_MUSIC", "PLAY_GAME", "REQUEST_TIME", "SEE_MENU", "DONATE_NOW", "ORDER_NOW",
  "WHATSAPP_MESSAGE", "INSTAGRAM_MESSAGE", "NO_BUTTON",
];

export const CTA_BY_OBJECTIVE = {
  OUTCOME_AWARENESS: ["LEARN_MORE", "SHOP_NOW", "CONTACT_US", "SUBSCRIBE", "WATCH_MORE", "SEE_MENU", "GET_DIRECTIONS", "NO_BUTTON"],
  OUTCOME_TRAFFIC: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "BOOK_NOW", "CONTACT_US", "APPLY_NOW", "BUY_NOW", "GET_OFFER", "GET_QUOTE", "ORDER_NOW", "SUBSCRIBE", "WATCH_MORE", "SEE_MENU", "DOWNLOAD", "NO_BUTTON"],
  OUTCOME_ENGAGEMENT: ["LEARN_MORE", "MESSAGE_PAGE", "WATCH_MORE", "SUBSCRIBE", "SEE_MENU", "CONTACT_US", "GET_OFFER", "NO_BUTTON"],
  OUTCOME_LEADS: ["SIGN_UP", "LEARN_MORE", "APPLY_NOW", "BOOK_NOW", "GET_QUOTE", "SUBSCRIBE", "CONTACT_US", "DOWNLOAD", "GET_OFFER", "MESSAGE_PAGE", "CALL_NOW"],
  OUTCOME_APP_PROMOTION: ["INSTALL_MOBILE_APP", "USE_MOBILE_APP", "DOWNLOAD", "PLAY_GAME", "LISTEN_MUSIC", "SHOP_NOW", "LEARN_MORE", "SIGN_UP", "BOOK_NOW"],
  OUTCOME_SALES: ["SHOP_NOW", "BUY_NOW", "ORDER_NOW", "LEARN_MORE", "SIGN_UP", "BOOK_NOW", "GET_OFFER", "CONTACT_US", "SUBSCRIBE", "DONATE_NOW", "MESSAGE_PAGE", "NO_BUTTON"],
};

// Messaging destinations force the matching CTA on the creative.
export const MESSAGING_CTA = {
  MESSENGER: "MESSAGE_PAGE",
  WHATSAPP: "WHATSAPP_MESSAGE",
  INSTAGRAM_DIRECT: "INSTAGRAM_MESSAGE",
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: "MESSAGE_PAGE",
};

export const SPECIAL_AD_CATEGORIES = ["FINANCIAL_PRODUCTS_SERVICES", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING"];

export const BID_STRATEGIES = ["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP"];

export const LOCATION_TYPES = [
  { code: "home_recent", value: ["home", "recent"] },
  { code: "home", value: ["home"] },
  { code: "recent", value: ["recent"] },
];

export const DEVICE_OPTIONS = ["all", "mobile", "desktop"];

// Manual placements: platform → groups → positions (Marketing API position names).
export const PLACEMENT_TREE = [
  {
    platform: "facebook",
    field: "facebook_positions",
    groups: [
      { code: "feeds", positions: ["feed", "profile_feed", "marketplace", "video_feeds", "right_hand_column"] },
      { code: "stories_reels", positions: ["story", "facebook_reels"] },
      { code: "in_stream", positions: ["instream_video"] },
      { code: "search", positions: ["search"] },
    ],
  },
  {
    platform: "instagram",
    field: "instagram_positions",
    groups: [
      { code: "feeds", positions: ["stream", "profile_feed", "explore", "explore_home"] },
      { code: "stories_reels", positions: ["story", "reels"] },
      { code: "search", positions: ["ig_search"] },
    ],
  },
  {
    platform: "audience_network",
    field: "audience_network_positions",
    groups: [{ code: "apps_sites", positions: ["classic", "rewarded_video"] }],
  },
  {
    platform: "messenger",
    field: "messenger_positions",
    groups: [
      { code: "messages", positions: ["messenger_home"] },
      { code: "stories_reels", positions: ["story"] },
    ],
  },
];

// Each chart breakdown → the Graph `breakdowns` fields it needs. A composite one (placement =
// platform + position) is stored as "instagram / instagram_reels" so one column holds every kind.
export const BREAKDOWNS = {
  age: ["age"],
  gender: ["gender"],
  platform: ["publisher_platform"],
  placement: ["publisher_platform", "platform_position"],
  device: ["device_platform"],
  country: ["country"],
  region: ["region"],
  hour: ["hourly_stats_aggregated_by_advertiser_time_zone"],
};

const cleanText = (value) => (value === undefined || value === null ? "" : String(value).trim());

export const breakdownValueOf = (row = {}, breakdown = "") => {
  const fields = BREAKDOWNS[breakdown] || [];
  const parts = fields.map((field) => cleanText(row[field])).filter(Boolean);
  // Meta labels an hour "00:00:00 - 00:59:59"; the chart wants "00:00".
  if (breakdown === "hour" && parts[0]) return parts[0].slice(0, 5);
  return parts.join(" / ") || "unknown";
};

// EU/EEA: ad sets targeting these need the DSA beneficiary/payer fields.
export const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"];

// Which action_type counts as the "result" for a given optimization goal.
export const RESULT_ACTION_BY_GOAL = {
  CONVERSATIONS: "onsite_conversion.messaging_conversation_started_7d",
  REPLIES: "onsite_conversion.messaging_conversation_started_7d",
  LINK_CLICKS: "link_click",
  LANDING_PAGE_VIEWS: "landing_page_view",
  POST_ENGAGEMENT: "post_engagement",
  PAGE_LIKES: "like",
  VIDEO_VIEWS: "video_view",
  THRUPLAY: "video_thruplay_watched_actions",
  LEAD_GENERATION: "lead",
  OFFSITE_CONVERSIONS: "offsite_conversion.fb_pixel_purchase",
  VALUE: "offsite_conversion.fb_pixel_purchase",
  APP_INSTALLS: "mobile_app_install",
  QUALITY_CALL: "onsite_conversion.call_confirm_grouped",
};

export const metaAdsCatalog = () => ({
  objectives: OBJECTIVES,
  optimization_goals: OPTIMIZATION_GOALS,
  billing_events: BILLING_EVENTS,
  conversion_locations: CONVERSION_LOCATIONS,
  awareness_goals: AWARENESS_GOALS,
  cta_types: CTA_TYPES,
  cta_by_objective: CTA_BY_OBJECTIVE,
  messaging_cta: MESSAGING_CTA,
  special_ad_categories: SPECIAL_AD_CATEGORIES,
  bid_strategies: BID_STRATEGIES,
  location_types: LOCATION_TYPES,
  device_options: DEVICE_OPTIONS,
  placement_tree: PLACEMENT_TREE,
  breakdowns: Object.keys(BREAKDOWNS),
  eu_countries: EU_COUNTRIES,
});
