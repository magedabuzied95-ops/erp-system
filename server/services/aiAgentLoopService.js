/**
 * Bounded tool-calling loop.
 *
 * The composer this sits beside (aiSalesReplyComposerService) is 1,926 lines of
 * template branches that never call a model at all. It is precise where a branch
 * exists and silent where one does not, which is why unusual phrasing produces a
 * generic reply. This loop is the other half: the model reasons, but it can only
 * state facts it fetched from the ERP through the tool registry.
 *
 * Bounds, all deliberate:
 *   - MAX_ITERATIONS tool rounds. An agent that can loop forever will, on the one
 *     conversation you cannot afford to be slow on.
 *   - A wall-clock deadline shared across rounds, because a customer waiting on
 *     WhatsApp does not care why it was slow.
 *   - Duplicate tool calls are answered from the round's own cache rather than
 *     re-queried, which is the most common way these loops waste their budget.
 *   - Read-only tools only. Nothing here sends, reserves or charges.
 *
 * It returns a DRAFT plus the provenance of every tool it called. It does not send,
 * and it does not replace the grounding gate — the gate still runs afterwards and
 * still wins. This is a better first draft, not a new authority on facts.
 */
import {
  getSharedOpenAiClient,
  isTextGenerationAvailable,
  resolveSupportMaxRetries,
  resolveSupportModel,
} from "./openaiSupportService.js";
import { buildToolRegistry } from "./aiToolRegistryService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_ITERATIONS = 4;
const DEFAULT_DEADLINE_MS = 20_000;

export const isAgentLoopEnabled = () => envFlagEnabled(process.env.AI_AGENT_LOOP_ENABLED);
const agentLoopDeadlineMs = () => positiveNumber(process.env.AI_AGENT_LOOP_DEADLINE_MS, DEFAULT_DEADLINE_MS);

const replySchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "needs_human_support", "facts_used"],
  properties: {
    answer: { type: "string", description: "The reply to the customer, in their language." },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_human_support: { type: "boolean" },
    facts_used: {
      type: "array",
      description: "Every concrete claim in the answer, each tied to the tool that produced it.",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "tool"],
        properties: {
          claim: { type: "string", description: "The specific fact stated, e.g. 'price is 1450'." },
          tool: { type: "string", description: "The tool whose result supports it." },
        },
      },
    },
  },
};

const TOOL_DISCIPLINE = [
  "",
  "# Tools:",
  "You cannot see the catalog, stock, prices, shipping or orders directly — you must call a tool for each.",
  "Never state a price, a stock level, a delivery cost or an order status you did not get from a tool result in THIS conversation.",
  "Availability specifically: only say something is available after get_inventory returns exact_match_in_stock true for the size and colour asked for. If it returns null or false, do not claim availability — say what is actually available, or ask.",
  "Do not call the same tool twice with the same arguments.",
  "When you have enough to answer, answer. Do not keep calling tools to be thorough.",
  "If a tool fails or returns nothing, say what you do not know and offer the next useful step. Never fill the gap with a guess.",
  "List every concrete claim you make in facts_used with the tool it came from.",
].join("\n");

const argumentsOf = (call) => {
  try {
    return JSON.parse(call.arguments || "{}");
  } catch {
    return {};
  }
};

const callSignature = (call) => `${call.name}:${text(call.arguments)}`;

/**
 * Runs the loop.
 *
 * Always resolves. On any failure — flag off, no credentials, model error, deadline —
 * it returns `{ ok: false, reason }` so the caller keeps its existing composer path
 * rather than losing the reply.
 */
export const runAgentLoop = async ({
  tenantId,
  message = "",
  instructions = "",
  history = [],
  customerPhone = "",
  searchProducts,
  conversationId = "",
} = {}) => {
  if (!isAgentLoopEnabled()) return { ok: false, reason: "disabled" };
  if (!isTextGenerationAvailable()) return { ok: false, reason: "text_generation_unavailable" };
  if (!text(message)) return { ok: false, reason: "empty_message" };

  const client = getSharedOpenAiClient();
  if (!client) return { ok: false, reason: "no_client" };

  const registry = buildToolRegistry({ tenantId, customerPhone, searchProducts });
  const deadline = Date.now() + agentLoopDeadlineMs();
  const model = resolveSupportModel();

  const input = [
    ...asArray(history)
      .slice(-6)
      .map((turn) => ({
        role: text(turn?.role) === "customer" ? "user" : "assistant",
        content: text(turn?.text).slice(0, 400),
      }))
      .filter((turn) => turn.content),
    { role: "user", content: text(message).slice(0, 2000) },
  ];

  const toolTrace = [];
  const seenCalls = new Map();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1_000) {
      return { ok: false, reason: "deadline_exceeded", tool_trace: toolTrace, iterations: iteration };
    }

    let response;
    try {
      response = await client.responses.create(
        {
          model,
          instructions: [instructions, TOOL_DISCIPLINE].filter(Boolean).join("\n"),
          input,
          tools: registry.definitions,
          // The final turn must be the structured reply, so the schema is only
          // attached once the model has stopped asking for tools.
          ...(iteration === MAX_ITERATIONS - 1
            ? { text: { format: { type: "json_schema", name: "agent_reply", strict: true, schema: replySchema } } }
            : {}),
        },
        { timeout: remainingMs, maxRetries: iteration === 0 ? resolveSupportMaxRetries() : 0 }
      );
    } catch (error) {
      console.warn("[ai-agent-loop] model call failed", {
        tenant_id: tenantId,
        conversation_id: conversationId,
        iteration,
        message: error?.message,
      });
      return { ok: false, reason: "model_error", tool_trace: toolTrace, iterations: iteration };
    }

    const toolCalls = asArray(response.output).filter((item) => item?.type === "function_call");

    if (!toolCalls.length) {
      let parsed = null;
      try {
        parsed = JSON.parse(response.output_text);
      } catch {
        parsed = null;
      }
      // Without the schema attached the model may answer in prose; that is still a
      // usable draft, just with no provenance to check.
      const answer = text(parsed?.answer) || text(response.output_text);
      if (!answer) return { ok: false, reason: "empty_answer", tool_trace: toolTrace, iterations: iteration };

      return {
        ok: true,
        answer,
        confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0.6,
        needs_human_support: parsed?.needs_human_support === true,
        facts_used: asArray(parsed?.facts_used),
        tool_trace: toolTrace,
        iterations: iteration + 1,
        structured: Boolean(parsed),
        model,
      };
    }

    input.push(...toolCalls);

    for (const call of toolCalls) {
      const signature = callSignature(call);
      // Re-asking the same question is the most common way these loops burn their
      // budget; serve it from this round's cache instead.
      const cached = seenCalls.get(signature);
      const result = cached ?? (await registry.execute(call.name, argumentsOf(call)));
      if (!cached) {
        seenCalls.set(signature, result);
        toolTrace.push({ tool: call.name, arguments: argumentsOf(call), ok: !result?.error });
      }

      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result).slice(0, 6_000),
      });
    }
  }

  return { ok: false, reason: "max_iterations", tool_trace: toolTrace, iterations: MAX_ITERATIONS };
};

/**
 * Cross-checks the draft's own provenance. A claim the model listed against a tool it
 * never called is the exact shape of a confident hallucination, and it is cheap to
 * catch here — before the grounding gate, which only re-verifies product facts.
 */
export const verifyFactProvenance = (result = {}) => {
  const calledTools = new Set(asArray(result.tool_trace).filter((entry) => entry.ok).map((entry) => entry.tool));
  const unsupported = asArray(result.facts_used).filter((fact) => !calledTools.has(text(fact.tool)));
  return {
    verified: unsupported.length === 0,
    unsupported_claims: unsupported,
    tools_called: [...calledTools],
  };
};
