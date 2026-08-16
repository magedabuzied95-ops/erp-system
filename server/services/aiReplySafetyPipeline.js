/**
 * The canonical sequence that runs AFTER a reply is composed, in one place.
 *
 * The two pipelines were never two reply engines — both already call
 * `composeAiSalesReply`. What diverged was the safety sequence wrapped around that
 * shared composer, and it diverged silently because nothing named it:
 *
 *   AI Inbox   composer -> agent loop -> grounding gate -> validation -> confidence
 *   Channel    composer                                                            (nothing)
 *
 * So the same draft text was scrutinised on the surface a human approves and shipped
 * unexamined on the surfaces that reply to customers directly. Every stage added to
 * one had to be remembered for the other, and one of them always lost.
 *
 * ORDER IS THE SAFETY ARGUMENT, not a preference:
 *
 * 1. The agent loop may REWRITE the prose, so it runs first — anything after it must
 *    judge the sentence that actually ended up in the draft.
 * 2. The grounding gate corrects claims against the catalog. It runs after generation
 *    and wins over it, so a model sentence is never the last word on a fact.
 * 3. Validation reads the final text. Running it before the gate would score a draft
 *    that is not the one being sent.
 * 4. Confidence consumes validation, so it is last.
 *
 * Every stage is failure-isolated and every stage is optional. A stage that throws,
 * times out, or is switched off leaves the draft exactly as it arrived. The worst case
 * of adding this to a pipeline is the behaviour that pipeline already had.
 *
 * It deliberately does NOT own card enrichment or send-package assembly. Those are
 * inbox concerns tied to an operator UI that picks between ambiguous products, and
 * pulling them in here would couple the channel path to a review workflow it has no
 * part in.
 */
const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

/** Neutral results used when a stage is skipped, so callers never branch on undefined. */
export const NEUTRAL_VALIDATION = Object.freeze({
  is_valid: true,
  confidence: 1,
  violations: [],
  warnings: [],
  suggested_action: "keep_draft",
});

export const NEUTRAL_CONFIDENCE = Object.freeze({
  confidence_score: 50,
  confidence_level: "medium",
  decision: "review",
  reasons: [],
  risk_flags: {},
});

/**
 * The tenant's own voice, plus what we know about this customer.
 *
 * Built here when a caller supplies no instructions, because otherwise the agent loop
 * writes in a default voice — and a shop's assistant sounding like a generic bot is
 * exactly what the persona layer exists to prevent. The AI Inbox already built these;
 * the channel path did not, so Messenger and WhatsApp would have spoken in a different
 * voice from the inbox for the same tenant.
 *
 * Failure-isolated: a missing persona row or an unreachable customer profile returns
 * the default persona rather than blocking the reply.
 */
const buildDefaultInstructions = async ({ tenantId, understanding, customerPhone }) => {
  try {
    const [{ buildInstructions, loadPersona }, customer360] = await Promise.all([
      import("./aiPersonaService.js"),
      import("./aiCustomer360Service.js").catch(() => null),
    ]);

    const persona = await loadPersona({ tenantId }).catch(() => undefined);
    let profile = null;
    if (customer360 && text(customerPhone)) {
      profile = await customer360.loadCustomer360({ tenantId, phone: text(customerPhone) }).catch(() => null);
    }

    return buildInstructions({
      ...(persona ? { persona } : {}),
      understanding: understanding || null,
      customerCard: profile ? customer360.summarizeCustomer360(profile) : "",
      salesHint: profile ? customer360.customer360SalesHint(profile) : "",
    });
  } catch (error) {
    console.warn("[ai-reply-safety] persona instructions skipped", { tenantId, message: error?.message });
    return "";
  }
};

/**
 * Stage 1 — the model may rewrite the PROSE, and only the prose.
 *
 * Cards, actions and attachments stay as the deterministic composer built them. A
 * draft whose claims do not all trace back to a successful tool call is dropped whole
 * rather than shipped for the parts that happen to be true: a fact attributed to a
 * tool that was never called is a confident hallucination, and the confident half is
 * the dangerous half.
 */
const runAgentLoopStage = async ({ tenantId, message, sessionId, history, customerPhone, instructions, understanding, searchProducts, draft, trace }) => {
  if (typeof searchProducts !== "function") return draft;

  try {
    const { isAgentLoopEnabled, runAgentLoop, verifyFactProvenance } = await import("./aiAgentLoopService.js");
    if (!isAgentLoopEnabled()) return draft;

    // A caller that already built instructions keeps them; anyone else gets the
    // tenant's persona rather than a default voice.
    const voice = text(instructions) || (await buildDefaultInstructions({ tenantId, understanding, customerPhone }));
    trace.persona = text(instructions) ? "caller" : "pipeline";

    const startedAt = Date.now();
    const result = await runAgentLoop({
      tenantId,
      conversationId: sessionId,
      message,
      history: asArray(history),
      customerPhone: text(customerPhone),
      instructions: voice,
      searchProducts,
    });
    trace.agent_loop_ms = Date.now() - startedAt;

    if (!result?.ok) {
      trace.agent_loop = result?.reason || "not_ok";
      return draft;
    }

    const provenance = verifyFactProvenance(result);
    if (!provenance.verified) {
      trace.agent_loop = "rejected_unverified_provenance";
      console.warn("[ai-reply-safety] agent draft rejected on provenance", {
        tenant_id: tenantId,
        unsupported: provenance.unsupported_claims.map((claim) => claim.tool),
      });
      return draft;
    }

    trace.agent_loop = "applied";
    return {
      ...draft,
      answer: result.answer,
      text: result.answer,
      confidence: result.confidence,
      generation_source: "agent_loop",
    };
  } catch (error) {
    trace.agent_loop = "threw";
    console.warn("[ai-reply-safety] agent loop skipped", { tenantId, message: error?.message });
    return draft;
  }
};

/**
 * Stage 2 — the catalog, not the model, decides what is true.
 *
 * Corrects the draft so an incompatible product is never presented and availability is
 * never claimed without exact-variant stock evidence. When it refuses a claim it also
 * clears the cards: leaving them would re-assert in pictures the availability the text
 * just declined to state.
 */
const runGroundingStage = async ({ tenantId, message, sessionId, contextMessages, styleProfile, draft, trace }) => {
  try {
    const { applyInboxGroundingGate } = await import("./aiInboxGroundingGate.js");
    const startedAt = Date.now();
    const result = await applyInboxGroundingGate({
      tenantId,
      message,
      contextMessages: asArray(contextMessages).length ? contextMessages : null,
      sessionId: text(sessionId),
      styleProfile: styleProfile || null,
      reply: {
        answer: text(draft?.answer || draft?.text),
        suggested_products: asArray(draft?.suggested_products),
        product_cards: asArray(draft?.product_cards),
      },
    });
    trace.grounding_ms = Date.now() - startedAt;

    if (!result?.changed) {
      trace.grounding = "unchanged";
      return { draft, grounding: result || null };
    }

    trace.grounding = result.action || "changed";
    return {
      draft: {
        ...draft,
        answer: result.answer,
        text: result.answer,
        suggested_products: asArray(result.suggested_products),
        product_cards: [],
        image_cards: [],
        visual_attachments: [],
        grounding: result.grounding || null,
        grounded_by_gate: true,
      },
      grounding: result,
    };
  } catch (error) {
    trace.grounding = "threw";
    console.warn("[ai-reply-safety] grounding skipped", { tenantId, message: error?.message });
    return { draft, grounding: null };
  }
};

/** Stage 3 and 4 — score the text that is actually going out. */
const runScoringStage = async ({ message, harness, draft, intent, trace }) => {
  let validation = NEUTRAL_VALIDATION;
  let confidence = NEUTRAL_CONFIDENCE;

  try {
    const { validateAiReply } = await import("./aiReplyValidatorService.js");
    const startedAt = Date.now();
    validation = await validateAiReply({ replyText: text(draft?.answer || draft?.text), harness: harness || null });
    trace.validation_ms = Date.now() - startedAt;
  } catch (error) {
    validation = { ...NEUTRAL_VALIDATION, confidence: 0.5, warnings: [`validateAiReply failed: ${error?.message}`] };
    trace.validation = "threw";
  }

  try {
    const { buildAiConfidenceEngine } = await import("./aiConfidenceEngineService.js");
    const startedAt = Date.now();
    confidence = await buildAiConfidenceEngine({
      harness: harness || null,
      tool_context: harness?.tool_context || null,
      validation,
      draft: {
        text: text(draft?.answer || draft?.text),
        detected_intent: intent,
        customer_question: message,
        validation,
      },
      correction_context: harness?.correction_context || null,
    });
    trace.confidence_ms = Date.now() - startedAt;
  } catch (error) {
    confidence = { ...NEUTRAL_CONFIDENCE, reasons: [`buildAiConfidenceEngine failed: ${error?.message}`], risk_flags: { engine_error: true } };
    trace.confidence = "threw";
  }

  return { validation, confidence };
};

/**
 * Runs the whole sequence over a composed draft.
 *
 * @returns {{ draft, validation, confidence, grounding, trace }} — `draft` is always a
 *          usable reply, even when every stage failed.
 */
export const applyReplySafetyPipeline = async ({
  tenantId,
  message = "",
  sessionId = "",
  draft = {},
  intent = "",
  history = [],
  contextMessages = [],
  customerPhone = "",
  instructions = "",
  understanding = null,
  styleProfile = null,
  harness = null,
  searchProducts = null,
  stages = {},
} = {}) => {
  const trace = {};
  const enabled = {
    agentLoop: stages.agentLoop !== false,
    grounding: stages.grounding !== false,
    scoring: stages.scoring !== false,
  };

  let current = draft;
  let grounding = null;

  if (enabled.agentLoop && tenantId) {
    current = await runAgentLoopStage({
      tenantId, message, sessionId, history, customerPhone, instructions, understanding, searchProducts, draft: current, trace,
    });
  }

  if (enabled.grounding && tenantId) {
    const result = await runGroundingStage({
      tenantId, message, sessionId, contextMessages, styleProfile, draft: current, trace,
    });
    current = result.draft;
    grounding = result.grounding;
  }

  let validation = NEUTRAL_VALIDATION;
  let confidence = NEUTRAL_CONFIDENCE;
  if (enabled.scoring) {
    const scored = await runScoringStage({ message, harness, draft: current, intent, trace });
    validation = scored.validation;
    confidence = scored.confidence;
  }

  return { draft: current, validation, confidence, grounding, trace };
};

/**
 * Stages 3 and 4 on their own, for callers that own the earlier stages.
 *
 * The AI Inbox interleaves grounding with send-ready card enrichment and an operator
 * choice list, which this module deliberately does not own — pulling that in would
 * couple the channel path to a review UI it has no part in. Scoring has no such
 * entanglement, so the inbox shares it directly rather than keeping a second copy that
 * drifts.
 */
export const scoreComposedReply = async ({ message = "", harness = null, draft = {}, intent = "" } = {}) => {
  const trace = {};
  const scored = await runScoringStage({ message, harness, draft, intent, trace });
  return { ...scored, trace };
};

/** Whether the channel path should run this sequence at all. */
export const isChannelSafetyPipelineEnabled = () => envFlagEnabled(process.env.AI_CHANNEL_GROUNDING_ENABLED);

export const __testing = { runAgentLoopStage, runGroundingStage, runScoringStage };
