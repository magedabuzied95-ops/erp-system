/*
 * Load the AI Inbox analysis engines the way the application loads them.
 *
 * The engines are TypeScript with extensionless imports (`../core/AIContext`),
 * which Vite resolves and Node does not — so for as long as they had no tests,
 * "does this code run at all" was an open question. It is answered here by
 * loading them through Vite's own SSR pipeline: same resolver, same transform,
 * same module graph the browser gets.
 *
 * One Vite server is created for the whole test file and reused; starting it
 * costs about a second, and each subsequent module load is cached.
 */
import { createServer } from "vite";

let serverPromise = null;

const viteServer = () => {
  if (!serverPromise) {
    serverPromise = createServer({
      configFile: false,
      logLevel: "error",
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      appType: "custom",
    });
  }
  return serverPromise;
};

export const loadAiEngines = async () => {
  const server = await viteServer();
  const [orchestrator, registry, crm, conversation, decision, copilot, learning] = await Promise.all([
    server.ssrLoadModule("/src/modules/aiSupport/core/AIOrchestrator.ts"),
    server.ssrLoadModule("/src/modules/aiSupport/core/EngineRegistry.ts"),
    server.ssrLoadModule("/src/modules/aiSupport/utils/crm/crmIntelligence.ts"),
    server.ssrLoadModule("/src/modules/aiSupport/intelligence/ConversationIntelligence.ts"),
    server.ssrLoadModule("/src/modules/aiSupport/decision/DecisionEngine.ts"),
    server.ssrLoadModule("/src/modules/aiSupport/copilot/CopilotEngine.ts"),
    server.ssrLoadModule("/src/modules/aiSupport/learning/LearningEngine.ts"),
  ]);
  return {
    AIOrchestrator: orchestrator.AIOrchestrator,
    EngineRegistry: registry.EngineRegistry,
    buildCrmIntelligence: crm.buildCrmIntelligence,
    analyzeConversation: conversation.analyzeConversation,
    makeDecision: decision.makeDecision,
    analyzeCopilot: copilot.analyzeConversation,
    LearningEngine: learning.LearningEngine,
  };
};

export const closeAiEngines = async () => {
  if (!serverPromise) return;
  const server = await serverPromise;
  serverPromise = null;
  await server.close();
};

/*
 * The engine list, mirrored from useAIInboxAnalysis.getOrchestrator().
 *
 * Duplicated rather than imported because the hook is a React module. The
 * mirror is asserted against the hook's source in the test, so the two cannot
 * drift without failing.
 */
export const buildOrchestrator = (engines, { AIOrchestrator, EngineRegistry }) =>
  new AIOrchestrator(new EngineRegistry(engines));

export const inboxEngines = ({ buildCrmIntelligence, analyzeConversation, makeDecision }, tone = () => "") => [
  {
    name: "crm",
    version: "1.0.0",
    execute: ({ input }) => buildCrmIntelligence(input.customer, { ...input.customer, orders: input.orders }, tone),
  },
  {
    name: "conversation",
    version: "1.0.0",
    dependencies: ["crm"],
    execute: ({ input, results }) => analyzeConversation({
      conversation: input.conversation.messages,
      customer: input.customer,
      orders: input.orders,
      products: input.products,
      crmIntelligence: results.crm,
      currentAgent: input.currentAgent,
      currentChannel: input.conversation.channel,
    }),
  },
  {
    name: "decision",
    version: "1.0.0",
    dependencies: ["crm", "conversation"],
    execute: ({ input, results }) => makeDecision({
      conversationIntelligence: results.conversation,
      crmIntelligence: results.crm,
      inventory: input.inventory,
      customer: input.customer,
      orders: input.orders,
      campaigns: input.campaigns,
      currentConversation: {
        id: input.conversation.id,
        waitingMinutes: input.conversation.waitingMinutes,
        channel: input.conversation.channel,
      },
      businessRules: input.businessRules,
    }),
  },
];

/** The shape normalizeInput() in useAIInboxAnalysis produces. */
export const analysisInput = ({ messages = [], customer = {}, orders = [], products = [], channel = "whatsapp", waitingMinutes = 0, campaigns = [], currentAgent = { id: 1, name: "Agent" }, businessRules } = {}) => ({
  conversation: {
    id: customer.session_id || "whatsapp:test",
    messages,
    updatedAt: messages.at(-1)?.created_at,
    lastMessageTimestamp: messages.at(-1)?.created_at,
    channel,
    waitingMinutes,
  },
  customer: { orders, products: { viewed: [], purchased: [], wishlist: [] }, metrics: {}, ...customer },
  orders,
  inventory: { products },
  products,
  campaigns,
  currentAgent,
  businessRules,
});
