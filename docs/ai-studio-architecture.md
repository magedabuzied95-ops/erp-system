# AI Studio — Architecture

_Design for a centralized AI control plane inside the ERP. Companion to `docs/ai-studio-audit.md`._

---

## 1. Guiding principle: control plane, not a new engine

AI Studio is a **control plane** that surfaces, organizes, and configures the AI functionality that **already exists**. The existing ERP services remain the **execution layer**. Studio never re-implements inbox, decision engines, automation, or the knowledge base.

```
                        AI STUDIO  (control plane — configure + observe)
                             │
   ┌───────────┬────────────┼────────────┬───────────┐
   ↓           ↓            ↓             ↓           ↓
 Overview   Agents/      Channels/     Knowledge   Executions/
            Settings     Triggers                  Approvals
   │           │            │             │           │
   └───────────┴────────────┼─────────────┴───────────┘
                             ↓  (reads settings + telemetry, deep-links to existing pages)
        Existing execution layer (UNCHANGED)
   aiUnifiedDecisionService → aiBrainV2Service → aiSalesAgentService
   → aiConversationOrchestrator → openaiSupportService (optional LLM)
   → aiBusinessToolsService / aiAgentOrderService (tools) → channels
                             ↓
        Customers / Products / Stock / Orders / CRM / Social channels
```

**Interaction rules**
- Studio talks to the backend **only through existing HTTP endpoints** (e.g. `/ai-agent/*`, `/ai-support/*`, `/marketing/ai-center/*`) with existing RBAC (`permit(...)`).
- Studio does **not** import backend engine modules or add tight coupling.
- Studio reads **real** telemetry (`ai_reply_traces`, `ai_event_logs`, follow-ups, channel status). No mock data.

---

## 2. Navigation model (only expose what exists)

Target taxonomy vs. what maps to real functionality **today**:

| Studio section | Backed by (existing) | Status now |
|---|---|---|
| **Overview** | `/ai-agent/analytics`, `/ai-agent/channels/status`, `/ai-agent/settings`, `/ai-agent/followups` | **Build now** (real data + module hub) |
| **Agents & Settings** | AiAgentSettings (`/ai-agent/settings`), AiSettings | Link/reuse |
| **Channels** (Triggers) | AiChannels (`/ai-agent/channels/status`) | Link/reuse |
| **Knowledge** | AiSupportKnowledgeBase (`/ai-support/knowledge-base`) | Link/reuse |
| **Executions / Observability** | AiAgentAnalytics + `ai_reply_traces`/`ai_event_logs` (`/ai-agent/analytics`, `/ai-agent/event-logs/summary`) | Link/reuse |
| **Approvals** | reply-mode policy (`ai_channels.ai_reply_mode`) + AiFollowups | Surface policy + link |
| **Marketing AI** | AiMarketingCenter etc. | Cross-link |
| **Inbox (operational)** | AiInbox / `/inbox` | Cross-link (stays operational) |
| **Workflows** | _no visual builder infra yet_ | **Deferred to Phase 2** (documented, not built) |
| **Tools / Models / Prompts** | tools = direct fns; single provider; inline prompts | **Deferred** (no CRUD surface exists to reuse) |

**Consolidation is additive:** a new "AI Studio" sidebar section is added; **all existing AI nav items and routes keep working** unchanged (no redirects removed, no URLs renamed).

---

## 3. What gets built now (smallest correct foundation)

1. **Route** `ai-studio` (+ `ai-studio/overview`) as a child of `ErpMainRoute` in `src/App.jsx`, gated by existing RBAC (`settings.view`). Old routes untouched.
2. **`AiStudio` shell page** (`src/modules/aiStudio/pages/AiStudio.jsx`) matching the existing dark-glass Tailwind idiom + lucide icons (not the `M1UI` kit), rendered in `MainLayout`'s Outlet.
3. **Overview**: real metric cards from existing endpoints (graceful "Not available" when an aggregate doesn't exist) + a **module directory** grouping every existing AI page under the target taxonomy, each card deep-linking to the real page and permission-gated. This is the consolidation hub.
4. **Sidebar entry** added to `RAW_SIDEBAR_SECTIONS` (`rbacStore.js`) — a new "AI Studio" section with the Overview link (additive).

No new DB tables, no new backend endpoints, no new engines, no large dependencies (no React Flow), no changes to inbox/automation/engines.

---

## 4. Safety / RBAC / privacy

- Studio route + every module card respects existing `permit(...)`/`adminOnly` gates; a user only sees cards they can access.
- Sensitive AI tools (`confirmAiOrder`, `updateAiOrderStatus`, customer sends) stay behind reply-mode policy + RBAC + human takeover — Studio only **displays** the policy, never escalates it.
- Executions/telemetry views must never render API keys, tokens, or unnecessary customer PII.

---

## 5. Deferred (explicitly out of this foundation)

- **Visual Workflow Builder** (node editor) — no supporting infra exists; adding React Flow is a large dependency. Requires a backend workflow definition/execution model first. See the Phase-2 recommendation at the end of the implementation report.
- **Agent abstraction / Tools registry / Prompt manager / Model registry** — would be net-new frameworks; premature. Reuse `ai_agent_settings` + reply-mode + existing tools until a real need is proven.
- **Merging duplicates** (two settings pages, three orchestrators/memory services) — documented in the audit; a later refactor, not part of the additive foundation.
