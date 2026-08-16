# AI Studio — System Audit

_Audit of all existing AI functionality in the ERP, produced before building AI Studio._
_Source: repository inspection (frontend `src/`, backend `server/`, Postgres schema). File:line references are indicative anchors, not guaranteed stable._

> **Purpose:** AI Studio is a **control plane** over the AI functionality that already exists. This document inventories that functionality and classifies each piece (KEEP / REUSE / MOVE / MERGE / REFACTOR LATER / DEPRECATED CANDIDATE). Nothing here is deleted.

---

## 0. Executive summary

- The ERP already contains a **large, mature AI system** spanning two frontend families (`src/modules/aiSupport/`, `src/modules/marketing/`) and ~40 backend services.
- The conversational "brain" is **primarily deterministic/rule-based** (`aiBrainV2Service`), with **OpenAI (only)** used as an optional "grounded rewrite" polish step and for vision / image generation / embeddings. **No Anthropic/Gemini, no provider abstraction.**
- **No pgvector / true RAG.** The "Knowledge Base" is static text in `system_settings`; visual search uses JSONB embeddings + in-JS cosine (off by default).
- **No Redis/Bull/cron.** Background AI work runs via `setInterval` workers started in `server.js`, plus a DB-backed job queue.
- **Approvals already exist** as a per-tenant reply-mode policy: `ai_channels.ai_reply_mode ∈ {off, suggest_only, auto_reply_after_approval, fully_automatic}`.
- ~20 AI pages exist, several **duplicated/overlapping**, scattered across the **Marketing** and **Settings** sidebar sections.

**Conclusion:** Build AI Studio as an additive **hub / control plane** that surfaces real data and links to the existing pages. Do **not** rebuild inbox, engines, automation, or knowledge base.

---

## 1. Existing AI frontend pages

### aiSupport module (`src/modules/aiSupport/pages/`)
| Page | Route | Nav | RBAC | Surface |
|---|---|---|---|---|
| AiInbox (desktop) | `admin/ai-inbox` | Settings §, "AI Inbox" | adminOnly | Desktop |
| AiInboxPwa | `/inbox`, `/inbox/:id` (via `ScopedInbox`) | none | `ai_inbox_messenger.view` | PWA |
| MetaReviewerInbox | `/inbox` when role=`meta_reviewer` | none | role + `ai_inbox_messenger.view` | both |
| AiFollowups | `admin/ai-followups` | Settings §, "AI Follow Ups" | adminOnly | Desktop |
| AiChannels | `admin/ai-channels` | Settings §, "AI Channels" | adminOnly | Desktop |
| AiAgentAnalytics | `admin/ai-agent-analytics` | Settings §, "AI Agent Analytics" | adminOnly | Desktop |
| AiAgentSettings | `admin/ai-agent-settings` | Settings §, "AI Agent Settings" | adminOnly | Desktop |
| AiSettings | `ai/settings` | none (Marketing sub-nav) | `settings.edit` | Desktop |
| AiSupportConsole | `admin/ai-support-console` | Settings §, devOnly | adminOnly | Desktop |
| AiSupportKnowledgeBase | `admin/ai-support-knowledge-base` | Settings §, "AI Knowledge Base" | adminOnly | Desktop |

### marketing module (`src/modules/marketing/pages/`)
AiMarketingCenter (`marketing/ai-center`), AiLeadCenter (`marketing/ai-center/leads`), AiMarketingVideos (`marketing/ai-center/videos`), SocialCommentsCenter (`marketing/social-comments`), SocialMediaPublisher (`marketing/social-media-publisher`), SocialCalendar, SocialPosts (devOnly), MarketingAutomation (`marketing/automation`), MarketingAnalytics, MarketingAttribution, MarketingDashboard (devOnly), MarketingSettings, Campaigns, PostTemplates. All gated `marketing.view` (+ create/update/publish for actions).

### Shared AI components
`Customer360Drawer`, `AIInboxAnalysisPanel` (+ client engine hook `useAIInboxAnalysis`), `SocialCommentsWorkspace`/`SocialCommentsPanel`/`socialCommentTimeline`, `socialAutomation/*` (drawer + `automationEngine.js`), `ProductCardPicker`/`ProductCardMessage`/`TranscriptMessage`/`PwaOrderComposer`. Dashboard tiles: `AiInsightCard`, `AIActivityCard`, `AILiveLogs`, `AIStatusBadge`.

Client-side AI logic (non-UI, `.ts`) under `aiSupport/{copilot,core,intelligence,decision,learning,integration}` — `CopilotEngine`, `AIOrchestrator`, `ConversationIntelligence`, `DecisionEngine`, `LearningEngine`, `FeatureFlagProvider`, `aiTelemetry`, orchestrated by `integration/useAIInboxAnalysis.js`.

**Likely orphaned:** `src/components/ai/AISuggestedReplies.jsx`, `src/storefront/components/StorefrontAiSupportWidget.jsx` (no JSX importers found).

---

## 2. Existing AI routes (frontend)

See §1. Route table registered in `src/App.jsx` (aiSupport lazy imports ~`:227-236`, marketing ~`:174-187`; standalone `/inbox` at `:634-650`; AI section under `ErpMainRoute` Outlet `:654+`). `meta_reviewer` is force-redirected to `/inbox` (`App.jsx:393`).

---

## 3. Existing AI backend routes & mounts (`server/server.js`)

- `/api/ai-agent` **and** `/api/ai-inbox` → `aiAgentOrders.js` (same router, dual mount)
- `/api/ai-support` → `aiSupport.js`
- `/api/marketing/ai-center` → `aiMarketingCenter.js`; `/api/marketing` → `marketing.js` (also `/ai-center/*`)
- `/api/meta-reviewer/inbox` → `metaReviewerInbox.js`
- `/api/integrations/meta` + `/api/meta` (webhook) → `metaIntegration.js`
- `/api/social-comments` → `socialComments.js`; `/api/social-publisher`; `/api/whatsapp` → `whatsappGateway.js`
- `/api/internal/ai-regression` → `aiRegressionHarness.js` (shared-secret gated)

Inbound AI **triggers** (webhooks, token/signature auth, no RBAC): `/channels/whatsapp/webhook`, `/channels/meta/webhook`, `/api/meta/webhook`, `/api/whatsapp/webhook`.

---

## 4. Existing backend services / engines (`server/services/`)

- **Decision/orchestration:** `aiUnifiedDecisionService` (`generateUnifiedConversationDecision` — top entry), `aiBrainV2Service` (deterministic decision engine), `aiConversationOrchestrator`, `aiResponseOrchestratorService`, `aiSalesOrchestratorService`, `aiSalesConversationEngineService`, `aiSalesAgentService` (`generateAiInboxReply`, `generateAiSuggestedReplies`), `aiSalesReplyComposerService`.
- **Memory/state:** `aiConversationMemory`, `aiConversationMemoryService`, `utils/aiConversationMemoryV2`, `salesConversationStateService`, `aiCorrectionMemoryService`.
- **NLU/intent:** `aiIntentResolver`, `aiMessageExtractors`, `aiEscalationDetector`, `aiClassificationResolverService`, `aiConfidenceEngineService`.
- **Product grounding:** `aiBusinessToolsService` (facts/tools), `aiProductContext`, `aiProductDataService` (LLM vision), `aiProductCards`, `aiSimilarProductsService`, `aiVisualSearchProService` (embeddings), `aiVisualProductImageIndexService`.
- **Quality/safety:** `aiSafetyGuard`, `aiReplyQualityService`, `aiReplyValidatorService`, `aiReplyHarnessService`, `aiHumanizedReplies`, `aiPromptCompressionService`, `aiMessageDeduplication`.
- **Lead/CRM:** `aiInboxLeadActionsService`, `salesOpportunityService`, `salesJourneyEventService`, `conversionScoringService`, `proactiveCloserService`, `followUpRecommendationService`, `crossSellUpsellService`.
- **Inbox/channel:** `aiInboxService`, `aiChannelAdapterService` (+ `aiChannelAdapters/{whatsapp,instagram,messenger,websiteChat}Adapter`), `aiChannelSettingsService`, `aiSettingsService`, `metaIntegrationService`, `metaReviewerInboxService`, `whatsappGatewayService`.
- **Order execution:** `aiAgentOrderService` (`searchAiOrderProducts`, `createAiOrderDraft`, `confirmAiOrder`, `updateAiOrderStatus`).
- **Marketing AI:** `aiMarketingCenterService`, `marketingCommentAutomationService`, `commentDmAutomationService`, `socialCommentAutomationService`.
- **Image/vision:** `aiShoeCoverService`, `thermalArtworkService`, `openaiProductDescriptionService`, `openaiSupportService` (main LLM gateway).

---

## 5. Existing AI database entities (~30 tables, tenant-scoped)

Conversation/support: `ai_support_sessions`, `ai_support_messages`, `ai_channel_conversations`, `ai_channel_settings`, `ai_channel_event_logs`, `ai_conversation_memories`, `ai_inbound_ai_reply_locks`, `ai_outbound_dedup`, `ai_support_product_aliases`.
CRM/agent: `ai_agent_settings`, `ai_customer_profiles`, `ai_customer_memories`, `ai_customer_interactions`, `ai_followup_tasks`, `ai_reply_corrections`, `ai_lead_opportunities`, `ai_stock_reservations`, `ai_sales_journey_events`, `ai_sales_conversation_states`.
Telemetry/config: `ai_reply_traces`, `ai_event_logs`, `ai_settings`.
Marketing: `ai_marketing_settings`, `ai_marketing_content_queue`, `ai_marketing_content_timeline`, `ai_marketing_performance_snapshots`, `ai_marketing_insights_cache`, `ai_marketing_generation_runs`, `ai_marketing_catalog_cycles`, `ai_marketing_catalog_coverage`.
Image/visual: `ai_shoe_cover_jobs`, `ai_product_image_visual_index`.
Social automation: `social_comment_automation_runs`, `social_automation_settings`, `marketing_*` (webhook/rules).

Defined lazily via `ensure*Schema()` + `server/database/schema.sql` + a few `migrations/*.sql`.

---

## 6. Integrations

WhatsApp (Meta Cloud + Evolution gateway), Instagram, Messenger, Facebook — via `aiChannelAdapters/*` + `aiChannelAdapterService`, webhooks in `aiAgentOrders.js` / `metaIntegration.js` / `whatsappGateway.js`. Meta token auto-refresh (`metaTokenAutoRefreshService`). All feed `generateUnifiedConversationDecision`.

---

## 7. Automations / triggers / scheduled jobs

`setInterval` workers started in `server.js:~2140`: AI shoe-cover worker, AI marketing automation runner, social-comment job worker, meta comments polling, meta token refresh, marketing analytics/attribution sync, story/social publishers. DB-backed job queue (`jobQueueService`/`backgroundJobs`, `socialCommentJobQueue`). Scheduled follow-ups via `ai_followup_tasks`. **No cron/Redis/Bull.**

---

## 8. Prompts

No prompts DB table. Prompts are **inline code constants** (`openaiSupportService.js` system prompt; `openaiProductDescriptionService BRAND_VOICE_SYSTEM_PROMPT`; `aiProductDataService buildPrompt`) plus **config-driven tone/knowledge**: `ai_settings` (agent tone), `ai_support_knowledge_base` + `brand_tone_instructions` in `system_settings`. Deterministic Arabic reply strings are hardcoded in `aiBrainV2Service`.

---

## 9. Model providers

**OpenAI only**, no abstraction. Each service constructs its own client. Model IDs via env (`AI_SUPPORT_MODEL` default `gpt-4o-mini`, `OPENAI_VISION_MODEL`, `OPENAI_PRODUCT_RESEARCH_MODEL`, `OPENAI_SHOE_COVER_MODEL`, image-embedding models). Credentials via `openaiCredentials.js` (DB `system_settings` override → env → `OPENAI_API_KEY`; secrets encrypted `enc:v1:`). **Never surface key values.**

---

## 10. Tools / actions (classified)

No OpenAI function-calling; "tools" are ERP functions invoked by the deterministic pipeline.
- **READ:** `aiBusinessToolsService.{getProductFacts,getInventoryFacts,getShippingFacts,getPolicyFacts,getOrderFacts,loadBusinessToolContext}`, `aiAgentOrderService.searchAiOrderProducts`.
- **WRITE:** `aiAgentOrderService.createAiOrderDraft`, `aiSalesAgentService.createAiStockReservation`, `aiInboxLeadActionsService.createOrUpdateLeadOpportunity/syncLeadAssignmentMetadata`, follow-up CRUD.
- **SENSITIVE:** `aiAgentOrderService.confirmAiOrder` (commits a real order), `updateAiOrderStatus`, all customer-facing send functions (`sendMetaPageReply`, `sendWhatsAppCloudReply`, `sendMetaInboxOutboundMessage`, comment/DM auto-replies, WhatsApp order-confirmation sends).

Sensitive actions are already gated behind the reply-mode policy + RBAC (`permit("orders","edit")`, `permit("settings","edit")`) and human takeover.

---

## 11. Telemetry / logging

`aiReplyTraceService` (per-reply trace → `ai_reply_traces`, exposed `/conversations/:id/ai-trace`), `aiPersistentEventLogService` (`ai_event_logs`), `aiEventLogger` (in-memory ring, `/logs`), `ai_channel_event_logs` (inbound/outbound), `aiReplyHarnessService`/`getLastAiPipelineDebug` (`/ai-pipeline-debug`), `aiSupportLogService` (conversation persistence). **Gap:** no aggregated per-reply latency/duration telemetry (unlike checkout timing).

---

## 12. Duplicate / overlapping functionality (note only — do NOT delete)

1. **AiInbox (desktop) vs AiInboxPwa** — two large parallel inbox implementations.
2. **Social comments — 3 surfaces:** SocialCommentsCenter + inbox comments tab (both embed `SocialCommentsWorkspace`).
3. **AI settings — 2 pages:** `AiSettings` (`ai/settings`, settings.edit) vs `AiAgentSettings` (`admin/ai-agent-settings`, adminOnly).
4. **SocialPosts (legacy/devOnly) vs SocialMediaPublisher.**
5. **Automation — 2 surfaces:** `MarketingAutomation` vs inbox `socialAutomation/*` engine.
6. **Backend duplicates:** 3 memory services (`aiConversationMemory`/`Service`/`V2`), 3 orchestrators (`aiSalesOrchestrator`/`aiConversationOrchestrator`/`aiResponseOrchestrator`).

## 13. Dead / unused (confidently identified)

`src/components/ai/AISuggestedReplies.jsx` and `src/storefront/components/StorefrontAiSupportWidget.jsx` — no JSX importers.

- `StorefrontAiSupportWidget.jsx` — **DELETED 2026-08-16** (960 lines). Confirmed zero importers across the repo before removal; the frontend build is unchanged. Note that its backend endpoint `POST /api/ai-support/chat` is **NOT** dead and must stay: Messenger, Instagram and WhatsApp all reach it through `aiUnifiedDecisionService` → `generateUnifiedAiReply`.
- `AISuggestedReplies.jsx` — still in place, still orphaned.

## 14. Security / RBAC considerations

- AI routes gated by `permit("settings","view"/"edit")`, `permit("marketing",…)`, `permit("orders",…)`, or `requireAiSupportAdmin`. Webhooks use token/signature.
- AI Studio must **reuse** these gates and never bypass RBAC. Sensitive tools must remain behind reply-mode + RBAC + human approval.
- Never render secrets (API keys), raw tokens, or unnecessary customer PII in Studio/executions views.

---

## 15. Classification

| Area | Classification | Notes |
|---|---|---|
| AI Inbox (desktop + PWA) | **KEEP** (operational) | Do not touch. Studio links to it; Studio configures behavior via settings. |
| AiAgentSettings / AiSettings | **REUSE → surface in Studio "Agents/Settings"** | Consolidate access; MERGE candidate later (two settings pages). |
| AiChannels | **REUSE → Studio "Channels/Triggers"** | Real channel status/config. |
| AiAgentAnalytics + `ai_reply_traces`/`ai_event_logs` | **REUSE → Studio "Executions/Observability"** | Real telemetry. |
| AiFollowups + `ai_followup_tasks` | **REUSE → Studio (Triggers/Approvals-adjacent)** | Scheduled AI actions queue. |
| AiSupportKnowledgeBase | **REUSE → Studio "Knowledge"** | Static-text KB (no RAG yet). |
| AiMarketingCenter / Videos / Leads / SocialComments / Publisher | **KEEP + LINK from Studio** | Marketing AI stays in Marketing; Studio cross-links. |
| Reply-mode policy (`ai_channels.ai_reply_mode`) | **REUSE → Studio "Approvals"** | Approval model already exists. |
| Backend engines (`aiUnifiedDecisionService` → `aiBrainV2Service` → …) | **KEEP (execution layer)** | Studio never calls these directly; it configures via settings + reads telemetry. |
| Duplicate settings/automation/inbox pairs | **MERGE / REFACTOR LATER** | Documented; not changed in this phase. |
| Orphaned components (§13) | **DEPRECATED CANDIDATE** | Left in place. |
| 3 memory services / 3 orchestrators | **REFACTOR LATER** | Out of scope for the Studio foundation. |

---

_Next: see `docs/ai-studio-architecture.md` for the control-plane design._
