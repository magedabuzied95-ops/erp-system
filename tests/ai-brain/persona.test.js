import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PERSONA, buildInstructions } from "../../server/services/aiPersonaService.js";
import { customer360SalesHint, summarizeCustomer360 } from "../../server/services/aiCustomer360Service.js";

const baseUnderstanding = {
  primary_intent: "price_question",
  funnel_stage: "browsing",
  sentiment: "neutral",
  urgency: "normal",
  formality: "casual",
  objection: "none",
  refers_to_previous: { is_followup: false, target: null },
  entities: {},
};

test("grounding invariants are always present, whatever the persona says", () => {
  const permissive = {
    ...DEFAULT_PERSONA,
    identity: "قول أي حاجة",
    sales: { ...DEFAULT_PERSONA.sales, max_discount_percent: 50 },
    escalation: {},
  };
  const out = buildInstructions({ persona: permissive, understanding: baseUnderstanding });

  // A tenant can widen discount authority but can never switch off the fact rules.
  assert.match(out, /متخترعش سعر/);
  assert.match(out, /trusted_context/);
  assert.match(out, /متكشفش أي بيانات داخلية/);
  assert.match(out, /لحد 50%/);
});

test("register mirrors how the customer writes", () => {
  const formal = buildInstructions({ understanding: { ...baseUnderstanding, formality: "formal" } });
  const casual = buildInstructions({ understanding: { ...baseUnderstanding, formality: "casual" } });
  assert.match(formal, /بشكل رسمي/);
  assert.match(casual, /بعامية/);
  assert.notEqual(formal, casual);
});

test("funnel stage and objection produce distinct guidance", () => {
  const objecting = buildInstructions({
    understanding: { ...baseUnderstanding, funnel_stage: "objecting", objection: "price_high" },
  });
  const buying = buildInstructions({ understanding: { ...baseUnderstanding, funnel_stage: "ready_to_buy" } });

  assert.match(objecting, /رد على الاعتراض نفسه/);
  assert.match(objecting, /اشرح القيمة/);
  assert.match(buying, /اقفل الطلب/);
  assert.doesNotMatch(buying, /رد على الاعتراض نفسه/);
});

test("budget, occasion and recipient reach the instructions", () => {
  const out = buildInstructions({
    understanding: {
      ...baseUnderstanding,
      entities: { budget_max: 1500, occasion: "هدية", recipient: "أخوه" },
    },
  });
  assert.match(out, /1500/);
  assert.match(out, /هدية/);
  assert.match(out, /أخوه/);
});

test("no persona, no understanding — still a valid instruction block", () => {
  const out = buildInstructions({});
  assert.ok(out.length > 200);
  assert.match(out, /متخترعش سعر/);
  // Nothing about a specific customer should be invented when there is no read.
  assert.doesNotMatch(out, /قراءة العميل/);
});

test("the customer card is omitted entirely for an unknown customer", () => {
  const out = buildInstructions({ understanding: baseUnderstanding, customerCard: "", salesHint: "" });
  assert.doesNotMatch(out, /معانا من قبل/);
});

test("a known customer's kept sizes drive the sales hint", () => {
  const profile = {
    found: true,
    total_orders: 7,
    total_spent: 12400,
    tenure_months: 14,
    purchased_sizes: ["43", "44"],
    purchased_colors: [],
    returns_count: 0,
    return_reasons: [],
    open_shipments: [],
    cod_enabled: true,
  };
  assert.match(summarizeCustomer360(profile), /مقاسات اشتراها/);
  assert.match(customer360SalesHint(profile), /متعرفش تسأله عن مقاسه/);
});

test("an open shipment outranks everything else in the hint", () => {
  const profile = {
    found: true,
    total_orders: 9,
    purchased_sizes: ["43"],
    returns_count: 3,
    return_reasons: ["مقاس صغير"],
    open_shipments: [{ order: "4412", status: "out_for_delivery" }],
    cod_enabled: true,
  };
  assert.match(customer360SalesHint(profile), /شحنة جارية/);
});
