// Client-side registry for the Meta Ads record pages. One entry per resource key
// (the server registry in server/modules/metaAds/records/resources.js has the same
// keys and column names).
//
// Labels are keys under `metaAdsRecords.l.*` (column headers and field labels);
// enum options come from recordsFormat.enumOptions(<enum>).
//
// Column: { key, label, type, enum?, editable?, currencyKey? }
//   type: text | enum | status | bool | number | money | date | datetime | link | custom
// Field:  { key, label, type, enum?, editable?, lookup?, display?, link?, help?, hideEmpty?, rows? }
//   editable: true | "draft" (only while is_draft) | "create" (only on a new record)
//   type adds: textarea | secret | lookup | list (array → chips)
// Tabs:   { key, label, kind: json | ai | image | video | carousel, field?, value?(record) }

import {
  Activity,
  BarChart3,
  Contact,
  Eye,
  FileText,
  FlaskConical,
  Folder,
  Image,
  Info,
  Layers,
  Megaphone,
  MessageSquare,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScanSearch,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  UserPlus,
  Users,
  Webhook,
} from "lucide-react";

const OBJECT_TABS_AI = { key: "ai", label: "tabs.aiInstructions", kind: "ai" };
const META_DATES = [
  { key: "meta_created_time", label: "l.metaCreatedTime", type: "datetime" },
  { key: "meta_updated_time", label: "l.metaUpdatedTime", type: "datetime" },
];
const LAST_ERROR = { key: "last_error", label: "l.lastError", type: "textarea", hideEmpty: true };
const CHAT_TEAM = { key: "chat_team_id", label: "l.chatTeam", type: "lookup", lookup: "chat-teams", editable: true, help: "help.chatTeam" };

const ACTION = {
  push_to_meta: { key: "push_to_meta", icon: Upload },
  update_on_meta: { key: "update_on_meta", icon: UploadCloud },
  delete_on_meta: { key: "delete_on_meta", icon: Trash2, confirm: true },
  pause: { key: "pause", icon: Pause },
  activate: { key: "activate", icon: Play },
};

export const RECORD_RESOURCES = {
  "ad-accounts": {
    create: true,
    remove: false,
    duplicate: false,
    title: { key: "name", label: "l.accountName", editable: true },
    columns: [
      { key: "name", label: "l.accountName", type: "text", editable: true },
      { key: "ad_account_id", label: "l.adAccountId", type: "text" },
      { key: "currency", label: "l.currency", type: "text" },
      { key: "status", label: "l.status", type: "enum", enum: "accountStatus" },
      { key: "timezone", label: "l.timezone", type: "text" },
    ],
    smart: [
      { key: "insights", label: "smart.insights", icon: BarChart3, to: (r) => ({ resource: "ad-insights", query: { account_id: r.id } }) },
      { key: "campaigns", label: "smart.campaigns", icon: Folder, to: (r) => ({ resource: "campaigns", query: { account_id: r.id } }) },
      { key: "lead_forms", label: "smart.leadForms", icon: FileText, to: (r) => ({ resource: "lead-forms", query: { account_id: r.id } }) },
      { key: "audiences", label: "smart.audiences", icon: Users, to: (r) => ({ resource: "audiences", query: { account_id: r.id } }) },
    ],
    actions: [
      { key: "sync_campaigns", icon: RefreshCw },
      { key: "sync_insights", icon: RefreshCw },
      { key: "sync_page_insights", icon: RefreshCw },
      { key: "subscribe_webhook", icon: Webhook },
      { key: "subscribe_ads_webhooks", icon: Webhook },
      { key: "sync_info", icon: Info },
    ],
    sections: [
      {
        start: [
          { key: "ad_account_id", label: "l.adAccountId", type: "text", editable: "create" },
          { key: "user_access_token", label: "l.userAccessToken", type: "secret", editable: true, help: "help.userAccessToken" },
          { key: "app_id", label: "l.appId", type: "text", editable: true },
          { key: "app_secret", label: "l.appSecret", type: "secret", editable: true },
          { key: "business_id", label: "l.businessId", type: "text", editable: true },
          { key: "webhook_verify_token", label: "l.webhookVerifyToken", type: "text", editable: true, help: "help.webhookVerifyToken" },
          { key: "webhook_fields", label: "l.webhookFields", type: "list" },
          { key: "webhook_subscribed_at", label: "l.webhookSubscribedAt", type: "datetime" },
        ],
        end: [
          { key: "status", label: "l.status", type: "enum", enum: "accountStatus" },
          { key: "currency", label: "l.currency", type: "text" },
          { key: "timezone", label: "l.timezone", type: "text" },
          { key: "pixel_id", label: "l.defaultPixelId", type: "text", editable: true },
          { key: "application_id", label: "l.defaultApplicationId", type: "text", editable: true },
          { key: "app_store_url", label: "l.appStoreUrl", type: "text", editable: true },
          { key: "admins", label: "l.admins", type: "list" },
          { key: "users", label: "l.users", type: "list" },
          { key: "last_sync_error", label: "l.lastError", type: "textarea", hideEmpty: true },
        ],
      },
      {
        heading: "headings.linkedPage",
        start: [
          { key: "page_name", label: "l.page", type: "text", editable: true },
          { key: "page_id", label: "l.pageId", type: "text", editable: true },
        ],
        end: [
          { key: "instagram_username", label: "l.instagramUsername", type: "text", editable: true },
          { key: "instagram_user_id", label: "l.instagramUserId", type: "text", editable: true },
        ],
      },
    ],
    tabs: [{ key: "raw", label: "tabs.raw", kind: "json", field: "raw" }],
  },

  campaigns: {
    create: true,
    remove: "drafts",
    duplicate: true,
    aiInstructions: true,
    title: { key: "name", label: "l.campaignName", editable: true },
    columns: [
      { key: "name", label: "l.campaignName", type: "text", editable: true },
      { key: "objective", label: "l.objective", type: "enum", enum: "objective" },
      { key: "status", label: "l.status", type: "status", enum: "objectStatus" },
      { key: "effective_status", label: "l.effectiveStatus", type: "enum", enum: "effectiveStatus" },
      { key: "daily_budget", label: "l.dailyBudget", type: "number", digits: 2, editable: true },
      { key: "account_name", label: "l.adAccount", type: "text" },
    ],
    smart: [
      { key: "insights", label: "smart.insights", icon: BarChart3, to: (r) => ({ resource: "ad-insights", query: { object_meta_id: r.meta_id || "-" } }) },
      { key: "adsets", label: "smart.adsets", icon: Layers, to: (r) => ({ resource: "adsets", query: { campaign_id: r.id } }) },
      { key: "crm_leads", label: "smart.crmLeads", icon: Contact, to: (r) => ({ resource: "ad-clicks", query: { campaign_id: r.id } }) },
    ],
    actions: [
      ACTION.push_to_meta,
      ACTION.update_on_meta,
      ACTION.delete_on_meta,
      { key: "create_adset", icon: Plus },
      { key: "sync_adsets", icon: RefreshCw },
      ACTION.pause,
      ACTION.activate,
    ],
    sections: [
      {
        start: [
          { key: "meta_id", label: "l.campaignId", type: "text" },
          { key: "account_id", label: "l.adAccount", type: "lookup", lookup: "accounts", display: "account_name", editable: "create", link: "ad-accounts" },
          { key: "objective", label: "l.objective", type: "enum", enum: "objective", editable: true },
          { key: "status", label: "l.status", type: "status", enum: "objectStatus" },
          { key: "effective_status", label: "l.effectiveStatus", type: "enum", enum: "effectiveStatus" },
          CHAT_TEAM,
        ],
        end: [
          { key: "daily_budget", label: "l.dailyBudget", type: "money", editable: true },
          { key: "lifetime_budget", label: "l.lifetimeBudget", type: "money", editable: true },
          { key: "bid_strategy", label: "l.bidStrategy", type: "enum", enum: "bid", editable: true },
          { key: "start_time", label: "l.startTime", type: "datetime", editable: true },
          { key: "stop_time", label: "l.stopTime", type: "datetime", editable: true },
          ...META_DATES,
          LAST_ERROR,
        ],
      },
    ],
    tabs: [OBJECT_TABS_AI],
  },

  adsets: {
    create: true,
    remove: "drafts",
    duplicate: true,
    aiInstructions: true,
    title: { key: "name", label: "l.adSetNameTitle", editable: true },
    columns: [
      { key: "name", label: "l.adSetName", type: "text", editable: true },
      { key: "status", label: "l.status", type: "status", enum: "objectStatus" },
      { key: "effective_status", label: "l.effectiveStatus", type: "enum", enum: "effectiveStatus" },
      { key: "daily_budget", label: "l.dailyBudget", type: "number", digits: 2, editable: true },
      { key: "optimization_goal", label: "l.optimizationGoal", type: "enum", enum: "goal" },
      { key: "campaign_name", label: "l.campaign", type: "text" },
    ],
    smart: [
      { key: "insights", label: "smart.insights", icon: BarChart3, to: (r) => ({ resource: "ad-insights", query: { object_meta_id: r.meta_id || "-" } }) },
      { key: "ads", label: "smart.ads", icon: Megaphone, to: (r) => ({ resource: "ads", query: { adset_id: r.id } }) },
      { key: "crm_leads", label: "smart.crmLeads", icon: Contact, to: (r) => ({ resource: "ad-clicks", query: { adset_id: r.id } }) },
    ],
    actions: [
      ACTION.push_to_meta,
      ACTION.update_on_meta,
      { key: "create_ad", icon: Plus },
      { key: "create_creative", icon: Image },
      { key: "sync_ads", icon: RefreshCw },
      ACTION.pause,
      ACTION.activate,
    ],
    sections: [
      {
        start: [
          { key: "meta_id", label: "l.adSetId", type: "text" },
          { key: "campaign_id", label: "l.campaign", type: "lookup", lookup: "campaigns", display: "campaign_name", editable: "draft", link: "campaigns" },
          { key: "status", label: "l.status", type: "status", enum: "objectStatus" },
          { key: "effective_status", label: "l.effectiveStatus", type: "enum", enum: "effectiveStatus" },
          CHAT_TEAM,
          { key: "optimization_goal", label: "l.optimizationGoal", type: "enum", enum: "goal", editable: true },
          { key: "billing_event", label: "l.billingEvent", type: "enum", enum: "billing", editable: true },
        ],
        end: [
          { key: "start_time", label: "l.startTime", type: "datetime", editable: true },
          { key: "end_time", label: "l.stopTime", type: "datetime", editable: true },
          ...META_DATES,
          LAST_ERROR,
        ],
      },
    ],
    tabs: [{ key: "targeting", label: "tabs.targeting", kind: "json", value: (r) => ({ targeting: r.targeting || {}, promoted_object: r.promoted_object || {} }) }, OBJECT_TABS_AI],
  },

  ads: {
    create: true,
    remove: "drafts",
    duplicate: true,
    aiInstructions: true,
    title: { key: "name", label: "l.adNameTitle", editable: true },
    columns: [
      { key: "name", label: "l.adName", type: "text", editable: true },
      { key: "status", label: "l.status", type: "status", enum: "objectStatus" },
      { key: "effective_status", label: "l.effectiveStatus", type: "enum", enum: "effectiveStatus" },
      { key: "adset_name", label: "l.adSet", type: "text" },
      { key: "creative_meta_id", label: "l.creativeId", type: "text" },
    ],
    smart: [
      { key: "insights", label: "smart.insights", icon: BarChart3, to: (r) => ({ resource: "ad-insights", query: { object_meta_id: r.meta_id || "-" } }) },
      { key: "creative", label: "smart.creative", icon: Image, to: (r) => (r.creative_id ? { resource: "creatives", id: r.creative_id } : { resource: "creatives", query: { account_id: r.account_id } }) },
      { key: "crm_leads", label: "smart.crmLeads", icon: Contact, to: (r) => ({ resource: "leads", query: { ad_meta_id: r.meta_id || "-" } }) },
      { key: "ad_clicks", label: "smart.adClicks", icon: MousePointerClick, to: (r) => ({ resource: "ad-clicks", query: { ad_id: r.id } }) },
    ],
    actions: [{ key: "create_creative", icon: Plus }, ACTION.push_to_meta, ACTION.update_on_meta, ACTION.pause, ACTION.activate],
    sections: [
      {
        start: [
          { key: "meta_id", label: "l.adId", type: "text" },
          { key: "adset_id", label: "l.adSet", type: "lookup", lookup: "adsets", display: "adset_name", editable: "draft", link: "adsets" },
          { key: "status", label: "l.status", type: "status", enum: "objectStatus" },
          { key: "effective_status", label: "l.effectiveStatus", type: "enum", enum: "effectiveStatus" },
          CHAT_TEAM,
        ],
        end: [
          { key: "creative_id", label: "l.creative", type: "lookup", lookup: "creatives", display: "creative_name", editable: true, link: "creatives" },
          { key: "creative_meta_id", label: "l.creativeId", type: "text" },
          ...META_DATES,
          LAST_ERROR,
        ],
      },
    ],
    tabs: [{ key: "creativeData", label: "tabs.creativeData", kind: "json", value: (r) => r.raw?.creative || {} }, OBJECT_TABS_AI],
  },

  "ad-events": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "summary", label: "l.summary" },
    columns: [
      { key: "event_time", label: "l.eventTime", type: "datetime" },
      { key: "severity", label: "l.severity", type: "enum", enum: "severity" },
      { key: "webhook", label: "l.webhookUpper", type: "text" },
      { key: "summary", label: "l.summary", type: "text" },
      { key: "account_name", label: "l.adAccount", type: "text" },
      { key: "object_type", label: "l.objectType", type: "enum", enum: "objectType" },
      { key: "campaign_name", label: "l.campaign", type: "text" },
      { key: "ad_name", label: "l.ad", type: "text" },
      { key: "object_meta_id", label: "l.objectId", type: "text" },
      { key: "notified", label: "l.notified", type: "bool", editable: true },
      { key: "processed", label: "l.processed", type: "bool", editable: true },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "event_time", label: "l.eventTime", type: "datetime" },
          { key: "severity", label: "l.severity", type: "enum", enum: "severity" },
          { key: "webhook", label: "l.webhookUpper", type: "text" },
          { key: "account_id", label: "l.adAccount", type: "lookup", display: "account_name", link: "ad-accounts" },
          { key: "object_type", label: "l.objectType", type: "enum", enum: "objectType" },
          { key: "object_meta_id", label: "l.objectId", type: "text" },
        ],
        end: [
          { key: "campaign_id", label: "l.campaign", type: "lookup", display: "campaign_name", link: "campaigns" },
          { key: "ad_id", label: "l.ad", type: "lookup", display: "ad_name", link: "ads" },
          { key: "notified", label: "l.notified", type: "bool", editable: true },
          { key: "processed", label: "l.processed", type: "bool", editable: true },
        ],
      },
    ],
    tabs: [{ key: "payload", label: "tabs.payload", kind: "json", field: "payload" }],
  },

  "lead-forms": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "name", label: "l.formNameTitle" },
    columns: [
      { key: "name", label: "l.formName", type: "text" },
      { key: "status", label: "l.status", type: "enum", enum: "formStatus" },
      { key: "leads_count", label: "l.leads", type: "number" },
      { key: "webhook_enabled", label: "l.webhookUpper", type: "bool", editable: true },
      { key: "account_name", label: "l.adAccount", type: "text" },
    ],
    smart: [{ key: "leads", label: "smart.leads", icon: UserPlus, to: (r) => ({ resource: "leads", query: { form_id: r.id } }) }],
    actions: [{ key: "sync_leads", icon: RefreshCw }],
    sections: [
      {
        start: [
          { key: "meta_id", label: "l.formId", type: "text" },
          { key: "status", label: "l.status", type: "enum", enum: "formStatus" },
          { key: "locale", label: "l.locale", type: "text" },
          { key: "leads_count", label: "l.leads", type: "number" },
          { key: "account_id", label: "l.adAccount", type: "lookup", display: "account_name", link: "ad-accounts" },
        ],
        end: [
          { key: "page_id", label: "l.pageId", type: "text" },
          { key: "webhook_enabled", label: "l.webhookUpper", type: "bool", editable: true },
          { key: "privacy_policy_url", label: "l.privacyPolicyUrl", type: "link" },
          { key: "last_synced_at", label: "l.lastSyncedAt", type: "datetime" },
        ],
      },
    ],
    tabs: [
      { key: "questions", label: "tabs.questions", kind: "json", field: "questions" },
      { key: "raw", label: "tabs.raw", kind: "json", field: "raw" },
    ],
  },

  leads: {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "name", label: "l.name", editable: true },
    columns: [
      { key: "name", label: "l.name", type: "text", editable: true },
      { key: "email", label: "l.email", type: "text", editable: true },
      { key: "phone", label: "l.phone", type: "text", editable: true },
      { key: "status", label: "l.status", type: "enum", enum: "leadStatus" },
      { key: "customer_name", label: "l.crmLead", type: "text" },
      { key: "created", label: "l.created", type: "datetime" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "email", label: "l.email", type: "text", editable: true },
          { key: "phone", label: "l.phone", type: "text", editable: true },
          { key: "status", label: "l.status", type: "enum", enum: "leadStatus", editable: true },
          { key: "customer_id", label: "l.crmLead", type: "lookup", display: "customer_name" },
          { key: "created_time", label: "l.created", type: "datetime" },
        ],
        end: [
          { key: "form_id", label: "l.leadForm", type: "lookup", display: "form_name", link: "lead-forms" },
          { key: "platform", label: "l.platform", type: "text" },
          { key: "is_organic", label: "l.isOrganic", type: "bool" },
          { key: "campaign_meta_id", label: "l.campaignId", type: "text" },
          { key: "adset_meta_id", label: "l.adSetId", type: "text" },
          { key: "ad_meta_id", label: "l.adId", type: "text" },
        ],
      },
    ],
    tabs: [{ key: "fieldData", label: "tabs.fieldData", kind: "json", field: "field_data" }],
  },

  audiences: {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "name", label: "l.audienceNameTitle" },
    columns: [
      { key: "name", label: "l.audienceName", type: "text" },
      { key: "subtype", label: "l.subtype", type: "text" },
      { key: "approximate_count", label: "l.approxCount", type: "number" },
      { key: "status", label: "l.status", type: "text" },
      { key: "account_name", label: "l.adAccount", type: "text" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "meta_id", label: "l.audienceId", type: "text" },
          { key: "subtype", label: "l.subtype", type: "text" },
          { key: "approximate_count_lower", label: "l.approxCountLower", type: "number" },
          { key: "approximate_count_upper", label: "l.approxCountUpper", type: "number" },
        ],
        end: [
          { key: "status", label: "l.status", type: "text" },
          { key: "account_id", label: "l.adAccount", type: "lookup", display: "account_name", link: "ad-accounts" },
          { key: "description", label: "l.description", type: "textarea" },
          { key: "last_synced_at", label: "l.lastSyncedAt", type: "datetime" },
        ],
      },
    ],
    tabs: [{ key: "raw", label: "tabs.raw", kind: "json", field: "raw" }],
  },

  creatives: {
    create: true,
    remove: false,
    duplicate: true,
    title: { key: "name", label: "l.creativeNameTitle", editable: true },
    columns: [
      { key: "name", label: "l.creativeName", type: "text", editable: true },
      { key: "creative_type", label: "l.type", type: "enum", enum: "creativeType" },
      { key: "meta_id", label: "l.creativeId", type: "text" },
      { key: "page_id", label: "l.pageId", type: "text" },
      { key: "account_name", label: "l.adAccount", type: "text" },
    ],
    smart: [{ key: "ads", label: "smart.ads", icon: Megaphone, to: (r) => ({ resource: "ads", query: { creative_id: r.id } }) }],
    actions: [ACTION.push_to_meta],
    sections: [
      {
        start: [
          { key: "meta_id", label: "l.creativeId", type: "text" },
          { key: "account_id", label: "l.adAccount", type: "lookup", lookup: "accounts", display: "account_name", editable: "create", link: "ad-accounts" },
          { key: "creative_type", label: "l.creativeType", type: "enum", enum: "creativeType", editable: true },
          { key: "page_id", label: "l.pageId", type: "text", editable: true, help: "help.pageId" },
          { key: "instagram_user_id", label: "l.instagramUserId", type: "text", editable: true, help: "help.instagramUserId" },
        ],
        end: [
          { key: "primary_text", label: "l.primaryText", type: "textarea", editable: true, help: "help.primaryText" },
          { key: "destination_url", label: "l.destinationUrl", type: "text", editable: true },
          { key: "call_to_action", label: "l.callToAction", type: "enum", enum: "cta", editable: true, help: "help.callToAction" },
          { key: "image_hash", label: "l.imageHash", type: "text", editable: true },
          { key: "video_id", label: "l.videoId", type: "text", editable: true, help: "help.videoId" },
        ],
      },
    ],
    tabs: [
      { key: "image", label: "tabs.image", kind: "image" },
      { key: "video", label: "tabs.video", kind: "video" },
      { key: "carousel", label: "tabs.carousel", kind: "carousel" },
      { key: "raw", label: "tabs.rawResponse", kind: "json", field: "raw" },
    ],
  },

  "ad-insights": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "object_meta_id", label: "l.objectId" },
    columns: [
      { key: "level", label: "l.level", type: "enum", enum: "level" },
      { key: "object_meta_id", label: "l.objectId", type: "text" },
      { key: "account_name", label: "l.adAccount", type: "text" },
      { key: "impressions", label: "l.impressions", type: "number" },
      { key: "reach", label: "l.reach", type: "number" },
      { key: "clicks", label: "l.clicks", type: "number" },
      { key: "spend", label: "l.spend", type: "money" },
      { key: "ctr", label: "l.ctr", type: "number", digits: 2 },
      { key: "cpc", label: "l.cpc", type: "number", digits: 2 },
      { key: "cpm", label: "l.cpm", type: "number", digits: 2 },
      { key: "frequency", label: "l.frequency", type: "number", digits: 2 },
      { key: "date_start", label: "l.dateStart", type: "date" },
      { key: "date_stop", label: "l.dateStop", type: "date" },
      { key: "synced_at", label: "l.syncedAt", type: "datetime" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "level", label: "l.level", type: "enum", enum: "level" },
          { key: "account_id", label: "l.adAccount", type: "lookup", display: "account_name", link: "ad-accounts" },
          { key: "date_start", label: "l.dateStart", type: "date" },
          { key: "date_stop", label: "l.dateStop", type: "date" },
          { key: "results", label: "l.results", type: "number" },
          { key: "result_type", label: "l.resultType", type: "text" },
          { key: "synced_at", label: "l.syncedAt", type: "datetime" },
        ],
        end: [
          { key: "impressions", label: "l.impressions", type: "number" },
          { key: "reach", label: "l.reach", type: "number" },
          { key: "clicks", label: "l.clicks", type: "number" },
          { key: "spend", label: "l.spend", type: "money" },
          { key: "ctr", label: "l.ctr", type: "number", digits: 2 },
          { key: "cpc", label: "l.cpc", type: "number", digits: 2 },
          { key: "cpm", label: "l.cpm", type: "number", digits: 2 },
          { key: "frequency", label: "l.frequency", type: "number", digits: 2 },
        ],
      },
    ],
    tabs: [{ key: "actions", label: "tabs.actions", kind: "json", field: "actions" }],
  },

  "page-insights": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "page_name", label: "l.page" },
    columns: [
      { key: "page_name", label: "l.page", type: "text" },
      { key: "page_id", label: "l.pageId", type: "text" },
      { key: "metric", label: "l.metric", type: "text" },
      { key: "period", label: "l.period", type: "enum", enum: "period" },
      { key: "value", label: "l.value", type: "number" },
      { key: "date_start", label: "l.dateStart", type: "date" },
      { key: "date_stop", label: "l.dateStop", type: "date" },
      { key: "account_name", label: "l.adAccount", type: "text" },
      { key: "synced_at", label: "l.syncedAt", type: "datetime" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "page_id", label: "l.pageId", type: "text" },
          { key: "metric", label: "l.metric", type: "text" },
          { key: "period", label: "l.period", type: "enum", enum: "period" },
          { key: "value", label: "l.value", type: "number" },
        ],
        end: [
          { key: "date_start", label: "l.dateStart", type: "date" },
          { key: "date_stop", label: "l.dateStop", type: "date" },
          { key: "account_id", label: "l.adAccount", type: "lookup", display: "account_name", link: "ad-accounts" },
          { key: "synced_at", label: "l.syncedAt", type: "datetime" },
        ],
      },
    ],
    tabs: [],
  },

  "ad-clicks": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "ad_headline", label: "l.adHeadline" },
    columns: [
      { key: "clicked_at", label: "l.clickedAt", type: "datetime" },
      { key: "channel", label: "l.channel", type: "enum", enum: "channel" },
      { key: "customer_name", label: "l.lead", type: "text" },
      { key: "contact_name", label: "l.contact", type: "text" },
      { key: "ad_headline", label: "l.adHeadline", type: "text" },
      { key: "campaign_name", label: "l.campaign", type: "text" },
      { key: "adset_name", label: "l.adSet", type: "text" },
      { key: "ad_name", label: "l.ad", type: "text" },
      { key: "attribution_status", label: "l.attribution", type: "enum", enum: "attribution" },
      { key: "ad_meta_id", label: "l.adId", type: "text" },
      { key: "first_touch", label: "l.firstTouch", type: "bool" },
      { key: "source_url", label: "l.viewAdUpper", type: "link" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        startHeading: "headings.adClick",
        startSubheading: "headings.attribution",
        endHeading: "headings.adContent",
        start: [
          { key: "customer_id", label: "l.lead", type: "lookup", display: "customer_name" },
          { key: "contact_name", label: "l.contact", type: "text" },
          { key: "channel", label: "l.channel", type: "enum", enum: "channel" },
          { key: "clicked_at", label: "l.clickedAt", type: "datetime" },
          { key: "campaign_id", label: "l.campaign", type: "lookup", display: "campaign_name", link: "campaigns" },
          { key: "adset_id", label: "l.adSet", type: "lookup", display: "adset_name", link: "adsets" },
          { key: "ad_id", label: "l.ad", type: "lookup", display: "ad_name", link: "ads" },
          { key: "account_id", label: "l.adAccount", type: "lookup", display: "account_name", link: "ad-accounts" },
          { key: "attribution_status", label: "l.attribution", type: "enum", enum: "attribution" },
          { key: "first_touch", label: "l.firstTouch", type: "bool" },
        ],
        end: [
          { key: "ad_body", label: "l.primaryTextAr", type: "textarea" },
          { key: "ad_meta_id", label: "l.adId", type: "text" },
          { key: "post_id", label: "l.postId", type: "text" },
          { key: "source_type", label: "l.sourceType", type: "text" },
          { key: "source_url", label: "l.viewAd", type: "link" },
          { key: "media_url", label: "l.media", type: "link" },
          { key: "custom_ref", label: "l.customRef", type: "text" },
          { key: "ctwa_clid", label: "l.ctwaClid", type: "text" },
        ],
      },
    ],
    tabs: [{ key: "raw", label: "tabs.raw", kind: "json", field: "raw" }],
  },

  "conversion-datasets": {
    create: true,
    remove: true,
    duplicate: true,
    title: { key: "statement", label: "l.statement", editable: true },
    columns: [
      { key: "channel", label: "l.channel", type: "enum", enum: "channel", editable: true },
      { key: "statement", label: "l.statement", type: "text", editable: true },
      { key: "business_id", label: "l.businessObjectId", type: "text", editable: true },
      { key: "dataset_id", label: "l.datasetId", type: "text", editable: true },
      { key: "enabled", label: "l.enabled", type: "bool", editable: true },
      { key: "permission", label: "l.permission", type: "text" },
      { key: "required_permission", label: "l.requiredPermission", type: "text" },
      { key: "last_event_at", label: "l.lastEventUpper", type: "datetime" },
      { key: "failure_count", label: "l.failures", type: "number" },
    ],
    smart: [{ key: "conversion_events", label: "smart.conversionEvents", icon: Activity, to: (r) => ({ resource: "conversion-events", query: { dataset_id: r.id } }) }],
    actions: [{ key: "test_event", icon: FlaskConical }],
    sections: [
      {
        start: [
          { key: "channel", label: "l.channel", type: "enum", enum: "channel", editable: true },
          { key: "business_id", label: "l.businessObjectId", type: "text", editable: true },
          { key: "dataset_id", label: "l.datasetId", type: "text", editable: true },
          { key: "access_token", label: "l.accessToken", type: "secret", editable: true, help: "help.datasetToken" },
          { key: "enabled", label: "l.enabled", type: "bool", editable: true },
        ],
        end: [
          { key: "permission", label: "l.permission", type: "text", editable: true },
          { key: "required_permission", label: "l.requiredPermission", type: "text", editable: true },
          { key: "last_event_at", label: "l.lastEvent", type: "datetime" },
          { key: "failure_count", label: "l.failures", type: "number" },
        ],
      },
    ],
    tabs: [],
  },

  "conversion-events": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "event_name", label: "l.event" },
    columns: [
      { key: "event_time", label: "l.eventTime", type: "datetime" },
      { key: "event_name", label: "l.event", type: "text" },
      { key: "status", label: "l.status", type: "enum", enum: "eventStatus" },
      { key: "channel", label: "l.channel", type: "enum", enum: "channel" },
      { key: "lead_name", label: "l.lead", type: "text" },
      { key: "dataset_name", label: "l.dataset", type: "text" },
      { key: "attempts", label: "l.attempts", type: "number" },
      { key: "error", label: "l.error", type: "text" },
      { key: "sent_at", label: "l.sentAt", type: "datetime" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "event_time", label: "l.eventTime", type: "datetime" },
          { key: "status", label: "l.status", type: "enum", enum: "eventStatus" },
          { key: "channel", label: "l.channel", type: "enum", enum: "channel" },
          { key: "lead_name", label: "l.lead", type: "text" },
          { key: "dataset_id", label: "l.dataset", type: "lookup", display: "dataset_name", link: "conversion-datasets" },
          { key: "attempts", label: "l.attempts", type: "number" },
        ],
        end: [
          { key: "event_id", label: "l.eventId", type: "text" },
          { key: "sent_at", label: "l.sentAt", type: "datetime" },
          { key: "error", label: "l.error", type: "textarea" },
        ],
      },
    ],
    tabs: [{ key: "payload", label: "tabs.payload", kind: "json", field: "payload" }],
  },

  competitors: {
    create: true,
    remove: true,
    duplicate: true,
    title: { key: "name", label: "l.competitor", editable: true },
    columns: [
      { key: "name", label: "l.competitor", type: "text", editable: true },
      { key: "page_id", label: "l.pageId", type: "text", editable: true },
      { key: "facebook_url", label: "l.facebookUrl", type: "text", editable: true },
      { key: "instagram", label: "l.instagram", type: "text", editable: true },
      { key: "country", label: "l.country", type: "text", editable: true },
      { key: "is_own_page", label: "l.isOwnPage", type: "bool", editable: true },
      { key: "ads_tracked", label: "l.adsTracked", type: "number" },
      { key: "posts_tracked", label: "l.postsTracked", type: "number" },
      { key: "active", label: "l.active", type: "bool", editable: true },
      { key: "last_scanned_at", label: "l.lastScanned", type: "datetime" },
      { key: "posts_scanned_at", label: "l.postsScanned", type: "datetime" },
    ],
    smart: [
      { key: "competitor_ads", label: "smart.competitorAds", icon: Eye, to: (r) => ({ resource: "competitor-ads", query: { competitor_id: r.id } }) },
      { key: "competitor_posts", label: "smart.competitorPosts", icon: MessageSquare, to: (r) => ({ resource: "competitor-posts", query: { competitor_id: r.id } }) },
    ],
    actions: [{ key: "scan_now", icon: ScanSearch }, { key: "scan_posts", icon: RefreshCw }],
    sections: [
      {
        start: [
          { key: "page_id", label: "l.pageId", type: "text", editable: true, help: "help.competitorPage" },
          { key: "facebook_url", label: "l.facebookUrl", type: "text", editable: true, help: "help.facebookUrl" },
          { key: "instagram", label: "l.instagram", type: "text", editable: true },
          { key: "country", label: "l.country", type: "text", editable: true, help: "help.country" },
          { key: "is_own_page", label: "l.isOwnPage", type: "bool", editable: true, help: "help.isOwnPage" },
        ],
        end: [
          { key: "active", label: "l.active", type: "bool", editable: true },
          { key: "ads_tracked", label: "l.adsTrackedAr", type: "number" },
          { key: "last_scanned_at", label: "l.lastScannedAr", type: "datetime" },
          { key: "last_scan_error", label: "l.lastError", type: "textarea", hideEmpty: true },
          { key: "posts_tracked", label: "l.postsTracked", type: "number" },
          { key: "posts_scanned_at", label: "l.postsScanned", type: "datetime" },
          { key: "posts_scan_error", label: "l.postsScanError", type: "textarea", hideEmpty: true },
        ],
      },
    ],
    tabs: [],
  },

  "competitor-posts": {
    create: false,
    remove: true,
    duplicate: false,
    title: { key: "page_name", label: "l.pageName" },
    columns: [
      { key: "competitor_name", label: "l.competitor", type: "text" },
      { key: "body", label: "l.postText", type: "text" },
      { key: "media_type", label: "l.format", type: "enum", enum: "postFormat" },
      { key: "posted_at", label: "l.postedAt", type: "datetime" },
      { key: "likes", label: "l.reactions", type: "number" },
      { key: "comments", label: "l.comments", type: "number" },
      { key: "shares", label: "l.shares", type: "number" },
      { key: "views", label: "l.views", type: "number" },
      { key: "engagement", label: "l.engagement", type: "number" },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        startHeading: "headings.post",
        endHeading: "headings.engagement",
        start: [
          { key: "competitor_id", label: "l.competitor", type: "lookup", display: "competitor_name", link: "competitors" },
          { key: "page_name", label: "l.pageName", type: "text" },
          { key: "body", label: "l.postText", type: "textarea", rows: 8 },
          { key: "media_type", label: "l.format", type: "enum", enum: "postFormat" },
          { key: "url", label: "l.viewPost", type: "link", hideEmpty: true },
          { key: "thumbnail_url", label: "l.thumbnail", type: "link", hideEmpty: true },
        ],
        end: [
          { key: "posted_at", label: "l.postedAt", type: "datetime" },
          { key: "likes", label: "l.reactions", type: "number" },
          { key: "comments", label: "l.comments", type: "number" },
          { key: "shares", label: "l.shares", type: "number" },
          { key: "views", label: "l.views", type: "number" },
          { key: "engagement", label: "l.engagement", type: "number" },
          { key: "first_seen_at", label: "l.firstSeen", type: "datetime" },
          { key: "last_seen_at", label: "l.lastSeen", type: "datetime" },
        ],
      },
    ],
    tabs: [{ key: "raw", label: "tabs.raw", kind: "json", field: "raw" }],
  },

  "competitor-report-schedules": {
    create: true,
    remove: true,
    duplicate: true,
    title: { key: "name", label: "l.reportName", editable: true },
    columns: [
      { key: "name", label: "l.reportName", type: "text", editable: true },
      { key: "weekday", label: "l.sendDay", type: "enum", enum: "weekday", editable: true },
      { key: "days_window", label: "l.reportDays", type: "number", editable: true },
      { key: "telegram_chat_id", label: "l.telegramChatId", type: "text", editable: true },
      { key: "email_to", label: "l.emailTo", type: "text", editable: true },
      { key: "active", label: "l.active", type: "bool", editable: true },
      { key: "last_report_at", label: "l.lastReport", type: "datetime" },
    ],
    smart: [{ key: "competitor_reports", label: "smart.competitorReports", icon: FileText, to: (r) => ({ resource: "competitor-reports", query: { schedule_id: r.id } }) }],
    actions: [{ key: "generate_report", icon: Send }],
    sections: [
      {
        start: [
          { key: "weekday", label: "l.sendDay", type: "enum", enum: "weekday", editable: true, help: "help.sendDay" },
          { key: "days_window", label: "l.reportDays", type: "number", editable: true, help: "help.reportDays" },
          { key: "telegram_chat_id", label: "l.telegramChatId", type: "text", editable: true, help: "help.telegramChatId" },
          { key: "email_to", label: "l.emailTo", type: "text", editable: true, help: "help.emailTo" },
          { key: "notes", label: "l.notes", type: "textarea", editable: true },
        ],
        end: [
          { key: "active", label: "l.active", type: "bool", editable: true },
          { key: "last_report_at", label: "l.lastReport", type: "datetime" },
          { key: "last_error", label: "l.lastError", type: "textarea", hideEmpty: true },
        ],
      },
    ],
    tabs: [],
  },

  "competitor-reports": {
    create: false,
    remove: true,
    duplicate: false,
    title: { key: "title", label: "l.reportTitle" },
    columns: [
      { key: "title", label: "l.reportTitle", type: "text" },
      { key: "schedule_name", label: "l.reportName", type: "text" },
      { key: "status", label: "l.status", type: "enum", enum: "reportStatus" },
      { key: "competitors_count", label: "l.competitorsCount", type: "number" },
      { key: "posts_count", label: "l.postsCount", type: "number" },
      { key: "created_at", label: "l.createdAt", type: "datetime" },
      { key: "sent_telegram_at", label: "l.sentTelegram", type: "datetime" },
      { key: "sent_email_at", label: "l.sentEmail", type: "datetime" },
    ],
    smart: [],
    actions: [{ key: "send_report", icon: Send }],
    sections: [
      {
        start: [
          { key: "report_text", label: "l.reportText", type: "textarea" },
        ],
        end: [
          { key: "schedule_id", label: "l.reportName", type: "lookup", display: "schedule_name", link: "competitor-report-schedules" },
          { key: "status", label: "l.status", type: "enum", enum: "reportStatus" },
          { key: "period_start", label: "l.periodStart", type: "datetime" },
          { key: "period_end", label: "l.periodEnd", type: "datetime" },
          { key: "competitors_count", label: "l.competitorsCount", type: "number" },
          { key: "posts_count", label: "l.postsCount", type: "number" },
          { key: "sent_telegram_at", label: "l.sentTelegram", type: "datetime" },
          { key: "sent_email_at", label: "l.sentEmail", type: "datetime" },
          { key: "delivery_error", label: "l.lastError", type: "textarea", hideEmpty: true },
        ],
      },
    ],
    tabs: [{ key: "raw", label: "tabs.reportData", kind: "json", field: "report" }],
  },

  "competitor-ads": {
    create: false,
    remove: false,
    duplicate: false,
    title: { key: "headline", label: "l.headline" },
    columns: [
      { key: "competitor_name", label: "l.competitor", type: "text" },
      { key: "headline", label: "l.headline", type: "text" },
      { key: "format", label: "l.format", type: "enum", enum: "adFormat" },
      { key: "call_to_action", label: "l.cta", type: "text" },
      { key: "ai_angle", label: "l.aiAngle", type: "text" },
      { key: "is_active", label: "l.stillRunning", type: "bool" },
      { key: "days_running", label: "l.daysRunning", type: "number" },
      { key: "started_at", label: "l.started", type: "date" },
      { key: "last_seen_at", label: "l.lastSeen", type: "datetime" },
    ],
    smart: [],
    actions: [{ key: "analyze", icon: Sparkles }],
    sections: [
      {
        startHeading: "headings.ad",
        endHeading: "headings.trackingAi",
        start: [
          { key: "competitor_id", label: "l.competitor", type: "lookup", display: "competitor_name", link: "competitors" },
          { key: "archive_id", label: "l.archiveId", type: "text" },
          { key: "page_name", label: "l.pageName", type: "text" },
          { key: "body", label: "l.messageText", type: "textarea" },
          { key: "call_to_action", label: "l.callToAction", type: "text" },
          { key: "link_title", label: "l.linkTitle", type: "text" },
          { key: "format", label: "l.displayFormat", type: "enum", enum: "adFormat" },
          { key: "platforms", label: "l.platforms", type: "list" },
          { key: "media_urls", label: "l.mediaUrls", type: "list" },
          { key: "snapshot_url", label: "l.viewAd", type: "link", hideEmpty: true },
        ],
        end: [
          { key: "is_active", label: "l.stillRunning", type: "bool" },
          { key: "started_at", label: "l.adStarted", type: "date" },
          { key: "ended_at", label: "l.adEnded", type: "date" },
          { key: "days_running", label: "l.daysRunning", type: "number" },
          { key: "first_seen_at", label: "l.firstSeen", type: "datetime" },
          { key: "last_seen_at", label: "l.lastSeen", type: "datetime" },
          { key: "ai_angle", label: "l.aiAngle", type: "text" },
          { key: "ai_offer", label: "l.aiOffer", type: "text" },
          { key: "ai_hook", label: "l.aiHook", type: "text" },
          { key: "ai_summary", label: "l.aiSummary", type: "textarea" },
        ],
      },
    ],
    tabs: [{ key: "raw", label: "tabs.raw", kind: "json", field: "raw" }],
  },

  "optimization-goals": {
    create: false,
    remove: false,
    duplicate: false,
    catalog: true,
    title: { key: "code", label: "l.name", render: "goal" },
    columns: [
      { key: "name", label: "l.name", type: "custom", render: "goal", noFilter: true },
      { key: "code", label: "l.code", type: "text" },
      { key: "objectives", label: "l.allowedObjectives", type: "custom", render: "objectives", noFilter: true },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [
          { key: "code", label: "l.code", type: "text" },
          { key: "objectives", label: "l.allowedObjectives", type: "custom", render: "objectives" },
        ],
        end: [
          { key: "promoted", label: "l.promotedObject", type: "text" },
          { key: "destination", label: "l.destination", type: "text" },
        ],
      },
    ],
    tabs: [],
  },

  "billing-events": {
    create: false,
    remove: false,
    duplicate: false,
    catalog: true,
    title: { key: "code", label: "l.name", render: "billing" },
    columns: [
      { key: "name", label: "l.name", type: "custom", render: "billing", noFilter: true },
      { key: "code", label: "l.code", type: "text" },
      { key: "goals", label: "l.optimizationGoals", type: "custom", render: "goals", noFilter: true },
    ],
    smart: [],
    actions: [],
    sections: [
      {
        start: [{ key: "code", label: "l.code", type: "text" }],
        end: [{ key: "goals", label: "l.optimizationGoals", type: "custom", render: "goals" }],
      },
    ],
    tabs: [],
  },
};

export const getRecordResource = (key) => (Object.prototype.hasOwnProperty.call(RECORD_RESOURCES, key) ? RECORD_RESOURCES[key] : null);

// Fields that must be filled before a new record can be created (the server derives
// the rest — e.g. an ad set's account comes from its campaign).
export const CREATE_REQUIRED = {
  "ad-accounts": ["ad_account_id"],
  campaigns: ["account_id"],
  adsets: ["campaign_id"],
  ads: ["adset_id"],
  creatives: ["account_id"],
  "conversion-datasets": ["dataset_id"],
  competitors: ["name"],
  "competitor-report-schedules": ["name"],
};

