// Services the integrations area exposes to the rest of the module (record-page
// action buttons call these). Owned by integrations/.
//
// Contract (all async):
//   subscribeAccountWebhooks(ctx)            subscribe the app to the ad account's webhook fields → { fields, subscribed_at }
//   subscribePageLeadgen(ctx)                subscribe the linked Page to `leadgen` → { subscribed: true }
//   syncLeadsForForm(ctx, formId)            pull every lead of one lead form into meta_ads_leads (+ CRM link) → { leads }
//   scanCompetitor(tenantId, competitorId)   Ad Library scan + AI analysis for one competitor → { ads, new_ads }
//   analyzeCompetitorAd(tenantId, adId)      (re)run the AI analysis for one competitor ad → { ai_angle, ai_offer, ai_hook, ai_summary }
//   testConversionDataset(tenantId, datasetId)  send a test event → { ok, events_received }
//   sendConversionEvent(tenantId, { datasetId, eventName, customerId, value, currency, eventId, channel })  → { id, status }
//
// Also available to the rest of the ERP:
//   recordAdReferral({ tenantId, channel, conversationKey, senderId, contactName, referral, raw })  → click id | null
//   getAdContextForConversation(tenantId, conversationKey)  → { click, instructions[], chat_team_id } | null
//   handleLeadgenChange(tenantId|null, change.value)        one Page `leadgen` webhook change

export { subscribeAccountWebhooks, subscribePageLeadgen, syncLeadsForForm, handleLeadgenChange } from "./webhooks.js";
export { scanCompetitor, analyzeCompetitorAd } from "./competitors.js";
export { testConversionDataset, sendConversionEvent } from "./conversions.js";
export { recordAdReferral, getAdContextForConversation } from "./adClicks.js";
