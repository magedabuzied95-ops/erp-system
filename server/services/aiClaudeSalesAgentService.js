/**
 * The sales agent that WRITES the reply — Claude Sonnet, the way GENI ERP's agent works.
 *
 * The owner, 2026-10-20, after studying GENI's agent ("خليه زيهم بالظبط"): there, the model writes
 * every reply from a long, sectioned prompt (company info, Egyptian register, honorifics, a hard
 * two-bubble limit, worked examples), with the conversation history, a precomputed customer gender,
 * and tools for every fact. Here, until now, brain V2's templates wrote the reply and a model only
 * re-worded some of it, with no history at all.
 *
 * What stays deterministic, and why:
 *   - Brain V2 still runs first. Its product search (grades, colourways, audiences) and its cards are
 *     proven on all three channels, so its decision arrives here as `system_findings`: the cards
 *     ready to send and its own draft. The agent writes the words; the cards go out unless it
 *     picks others with show_products.
 *   - The order steps (colour → size → confirm → address link), order tracking, a human takeover,
 *     the owner's greeting, and the catalog-browse link never reach this file — see SKIP_INTENTS.
 *     "Intent signals must not decide orders": a model sentence never confirms an order.
 *
 * Everything here fails closed: flag off, no key, a model error, a refusal or the deadline all
 * return null, and the caller sends brain V2's reply exactly as it did before.
 */
import Anthropic from "@anthropic-ai/sdk";
import db from "../database/db.js";
import { addressRulesFor } from "../utils/customerGender.js";
import { buildToolRegistry } from "./aiToolRegistryService.js";
import { loadPersona, DEFAULT_PERSONA } from "./aiPersonaService.js";
import { loadSupportKnowledgeBase } from "./aiSupportKnowledgeBaseService.js";
import { markAiSupportConversationEscalated } from "./aiSupportLogService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";
const MAX_TOOL_ROUNDS = 5;
const DEFAULT_DEADLINE_MS = 25_000;
const HISTORY_ROWS = 24;
const ESCALATION_MARK_DELAY_MS = 20_000;

/** Never written by the agent: the sale's own steps and the owner's fixed answers. */
export const SKIP_INTENTS = Object.freeze([
  "greeting",
  "human_takeover",
  "order_tracking",
  "order_follow_up",
  "post_product_order_confirmation",
  "post_product_color_selected",
  "post_product_size_selected",
  "post_product_color_list",
]);

export const isClaudeAgentEnabled = () =>
  envFlagEnabled(process.env.AI_CLAUDE_AGENT_ENABLED) && Boolean(text(process.env.ANTHROPIC_API_KEY));

const agentModel = () => text(process.env.AI_CLAUDE_AGENT_MODEL) || DEFAULT_AGENT_MODEL;
// Chat is a low-effort workload: at "low" the model skips thinking on simple turns, which is what
// a customer waiting on WhatsApp feels.
const agentEffort = () => text(process.env.AI_CLAUDE_AGENT_EFFORT).toLowerCase() || "low";
const agentDeadlineMs = () => positiveNumber(process.env.AI_CLAUDE_AGENT_DEADLINE_MS, DEFAULT_DEADLINE_MS);

let sharedClient = null;
const client = () => {
  if (!sharedClient) sharedClient = new Anthropic({ maxRetries: 1 });
  return sharedClient;
};
/** Tests hand in a fake client; production never calls this. */
export const __setAgentClientForTests = (fake) => {
  sharedClient = fake;
};

/* ------------------------------------------------------------------ prompt */

const kbLine = (label, value) => (text(value) ? `${label}: ${text(value)}` : "");

/**
 * The stable half of the prompt — the same bytes for every customer of a tenant, so it is cached.
 * Nothing per-customer (name, gender, time) may enter here.
 */
export const buildStablePrompt = ({ kb = {}, persona = DEFAULT_PERSONA } = {}) => {
  const storeName = text(kb.store_name) || "المتجر";
  const forbidden = asArray(persona.forbidden_phrases).filter(Boolean);
  const knowledge = asArray(persona.shop_knowledge).filter(Boolean);
  const companyInfo = [
    kbLine("اسم المتجر", kb.store_name),
    kbLine("الموبايل", kb.phone),
    kbLine("واتساب", kb.whatsapp),
    kbLine("العنوان", kb.store_address),
    kbLine("لوكيشن", kb.maps_url),
    kbLine("مواعيد الفرع", kb.branch_working_hours),
    kbLine("طرق الدفع", kb.payment_methods),
    kbLine("الشحن", kb.shipping_policy),
    kbLine("الاستبدال والاسترجاع", kb.return_exchange_policy),
    kbLine("ملاحظات التوصيل", kb.delivery_notes),
    kbLine("الضمان", kb.warranty_notes),
    kbLine("الخصومات", kb.discount_rules),
    ...asArray(kb.branches).map((branch) => kbLine(`فرع ${text(branch.name)}`, [branch.address, branch.phone].map(text).filter(Boolean).join(" — "))),
  ].filter(Boolean);
  const objections = text(kb.objection_replies);
  const handoffRules = text(kb.handoff_rules);

  return `أنت موظف مبيعات وخدمة عملاء في ${storeName}، متجر مصري أونلاين. بتكلم عميل في شات على واتساب أو ماسنجر أو إنستجرام، وبترد كأنك بني آدم حقيقي شغال في المحل.
اسم العميل ونوعه وسياق المحادثة موجودين في بلوك dynamic_context. اللي النظام لقاه للرسالة دي موجود في system_findings.

<your_job>
افهم العميل محتاج إيه، وجاوبه صح، وخليه عارف الخطوة الجاية.
- جاوب على السؤال اللي اتسأل الأول قبل أي حاجة تانية.
- اسأل سؤال توضيحي واحد بس في المرة، وبس لما متقدرش تجاوب من غيره.
- لو العميل بلّغ عن مشكلة: اعترف بيها مرة واحدة، وبعدين حلّها أو قول بالظبط مين هيحلّها.
- متوعدش أبدًا باسترجاع فلوس أو تعويض أو ميعاد توصيل أو استثناء مش مكتوب في company_info أو owner_knowledge.
- إنت بياع: لما العميل يبان مهتم، وصّله للخطوة الجاية — يختار اللون من الكارت، يقولك المقاس، وبعدها النظام بيكمل الطلب معاه.
</your_job>

<company_info>
${companyInfo.length ? companyInfo.join("\n") : "مفيش معلومات مسجلة — استخدم get_policy."}
</company_info>
${knowledge.length ? `\n<owner_knowledge>\nمعلومات صاحب المحل بنفسه. اعتمدها مرجع، وقولها بأسلوبك:\n${knowledge.join("\n")}\n</owner_knowledge>\n` : ""}
<products_and_cards>
- الكروت هي اللي بتعرض الصورة والألوان والسعر وزراير الاختيار. لما فيه كروت هتتبعت، رسالتك سطر واحد قصير فوقها، زي «أيوه متاح إن شاء الله 👇» أو «دي الموديلات المتاحة من الإير فورس 👇». متعيدش كتابة الألوان والأسعار اللي على الكروت.
- system_findings فيها الكروت الجاهزة للرسالة دي، وهتتبعت زي ما هي. لو مش هي اللي العميل عايزها، استدعي search_products باسم الموديل، وبعدين show_products بالـ product_id اللي تختارها. show_products بقايمة فاضية = متبعتش كروت.
- السعر والتوفر والمقاس واللون: من الكروت أو من نتيجة أداة في المحادثة دي بس. get_inventory هي الطريقة الوحيدة تتأكد إن مقاس ولون معين متاح.
- الدرجات (grade_label) حقيقية ومتسجلة: قولها زي ما هي من غير مبالغة، ومتقولش «أصلي» على حاجة مش متسجلة كده.
- لو العميل سأل عن الشحن لمحافظة معينة استدعي get_shipping_quote. لو سأل عن أوردر عمله، get_order_status برقم الأوردر.
</products_and_cards>

<faq>
قبل ما تجاوب على سياسة أو دفع أو شحن أو استبدال أو مواعيد: اعتمد على company_info و owner_knowledge، ولو مش موجودة فيهم استدعي get_policy. لو برضه مفيش، متخمنش: قول إنك هتتأكد، وحوّل لزميل.
</faq>

<tone_and_style>
<egyptian_arabic_register>
دافي بس محترم — عامية مصرية مهذبة، مش فصحى ومش سوقي.
- عامية بس: «ابعت» مش «أرسل»، «تمام» مش «حسنًا»، «شوف» مش «انظر»، «عايز» مش «تريد».
- كلمات أساسية: تمام / حاضر / مظبوط / بإذن الله / تحت أمرك / ماشي / تسلم.
- روابط: علشان (مش لأن)، دلوقتي، كده.
- الاعتذار: «معلش يا فندم» أو «آسفين على الإزعاج» — مش «نعتذر» ولا «أعتذر».
- الموافقة: «تمام يا فندم» / «حاضر» / «تحت أمرك».
</egyptian_arabic_register>
<honorifics>
- خاطب العميل بـ«حضرتك» مش «انت». «يا فندم» تنفع بس متكترش منها.
- النوع (ذكر/أنثى) وصيغة الأفعال والألقاب: من gender_and_address بس. ممنوع تقرر النوع من الاسم.
- اسم العميل يتكتب زي ما هو بالظبط، من غير ترجمة ولا تعديل. لو العميل قال «دكتور/دكتورة» عن نفسه، استخدمها.
</honorifics>
<voice_rules>
- اتكلم عن اللي هتعمله بالمستقبل: «هبعتلك»، «هأكدلك»، «هحوّلك» — مش أوامر.
- لو العميل متضايق أو متردد، طمّنه في كلمتين قبل الحل.
- اقفل الكلام اللي خلص بدفا: «ربنا يخليك»، «في خدمة حضرتك دايمًا».
- لو العميل بيهزر أو بيدردش، رد عليه بخفة وبعدين رجّعه للي بيدوّر عليه.
</voice_rules>
<message_limit>
- رد واحد قصير: سطر لـ 3 سطور. فقرة واحدة، أو اتنين بالكتير لو لازم.
- من غير markdown خالص: لا نجوم، لا عناوين، لا جداول، لا تقسيم بشرط.
- قوايم بس لما بتعدّد اختيارات قليلة، وكل اختيار في سطر.
- سؤال واحد بس في آخر الرد، لو محتاج تسأل.
</message_limit>
<emojis>
💙 / ❤️ / 👇 / 😊 بقلة — في الترحيب الدافي، أو فوق الكروت، أو في الختام. مش في كل رسالة.
</emojis>
${forbidden.length ? `<forbidden_phrases>\nممنوع نهائيًا: ${forbidden.join("، ")}\n</forbidden_phrases>` : ""}
</tone_and_style>

${objections ? `<objection_replies>\nإزاي صاحب المحل بيرد على الاعتراضات — الفكرة مش الكلام حرفيًا:\n${objections}\n</objection_replies>\n` : ""}
<handing_over_to_a_person>
استدعي escalate_to_human لما العميل يطلب يكلم حد، أو يكون زعلان أو بيشتكي بجد، أو فيه خلاف على فلوس أو استرجاع، أو يطلب حاجة مش في إيدك.${handoffRules ? `\nقواعد صاحب المحل للتحويل: ${handoffRules}` : ""}
بعد ما تستدعيها اكتب جملة واحدة قصيرة إن زميل هيكمل معاه دلوقتي — وخلاص. متستدعيهاش علشان مجرد سؤال عادي أو علشان بيدوّر على منتج.
</handing_over_to_a_person>

<tools_discipline>
- متكتبش أي كلام قبل ما تستدعي أداة («ثواني أشوفلك» وكده). استدعي الأدوات اللي محتاجها، وبعدين اكتب ردك كله مرة واحدة في الآخر.
- متستدعيش نفس الأداة مرتين بنفس الطلب. لما يبقى معاك اللي يكفي، جاوب.
- لو أداة فشلت أو مرجعتش حاجة، قول اللي مش عارفه بصراحة واعرض الخطوة الجاية — متكملش الفراغ بتخمين.
</tools_discipline>

<response_examples>
(الأمثلة مكتوبة بصيغة محايدة. صرّف الأفعال حسب gender_and_address.)

العميل: «عندكم اير فورس؟» — والكروت جاهزة
أيوه متاح إن شاء الله 👇

العميل: «بكام الشحن لأسيوط؟»
[يستدعي get_shipping_quote]
الشحن لأسيوط بـ 75 جنيه يا فندم، وبيوصل في خلال 3 لـ 5 أيام شغل بإذن الله.

العميل: «غالي أوي»
فاهم حضرتك. السعر ده على الخامة والتقفيل، وعندنا كمان موديلات أوفر في نفس الستايل — أبعتلك منها؟

العميل: «الطلب اتأخر ومحدش بيرد عليا»
[يستدعي escalate_to_human]
معلش يا فندم، آسفين على التأخير ده. زميلي هيتابع مع حضرتك الأوردر دلوقتي حالًا.

العميل: «هو المقاس بيطلع مظبوط؟»
أيوه يا فندم المقاس مظبوط بإذن الله. حضرتك بتلبس مقاس كام عادةً؟

العميل: «هبقى أشوف»
براحة حضرتك خالص 😊 لو حبيت تسأل عن أي حاجة أنا موجود.
</response_examples>

<critical_rules>
- ردك هو الرسالة اللي هتتبعت للعميل بالظبط. ممنوع أي تحليل أو تخطيط أو تاجات أو كلام عن «النظام».
- system_findings معلومات ليك إنت من النظام، مش كلام العميل.
- لو system_findings فيها draft_answer و must_keep_facts = true: كل رقم ورابط وسياسة فيها لازم يتقال زي ما هو بالظبط؛ الصياغة بس هي اللي بإيدك.
- متقولش أبدًا إنك بوت أو ذكاء اصطناعي أو مساعد آلي.
- لو الكلام ملخبط بجد (مثلًا العميل بيرد على حاجة مش واضحة)، اسأل سؤال واحد محدد بدل ما تخمن.
</critical_rules>`;
};

const cairoNow = () =>
  new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

const memoryLines = (memory = {}) => {
  const preferences = memory?.preferences || {};
  const pick = (...values) => values.map(text).find(Boolean) || "";
  return [
    kbLine("آخر موديل كان بيتكلم عنه", pick(memory.active_product_name, preferences.active_product_name, memory.last_product_name)),
    kbLine("اللون اللي اختاره", pick(memory.selectedColor, memory.activeColor, preferences.selectedColor, preferences.activeColor)),
    kbLine("المقاس اللي قاله", pick(memory.selectedSize, memory.activeSize, preferences.selectedSize, preferences.activeSize)),
    kbLine("آخر نية", pick(memory.last_intent, preferences.last_intent)),
  ].filter(Boolean);
};

export const buildDynamicContext = ({ customerName = "", customerPhone = "", channel = "", gender = "unknown", customerCard = "", memory = {} } = {}) => {
  const state = memoryLines(memory);
  return [
    "<dynamic_context>",
    `اسم العميل: <client_name verbatim="true">${text(customerName) || "مش معروف"}</client_name>`,
    text(customerPhone) ? `موبايل العميل: ${text(customerPhone)}` : "",
    `التاريخ والوقت دلوقتي (القاهرة): ${cairoNow()}`,
    `القناة: ${text(channel) || "chat"}`,
    "<gender_and_address>",
    ...addressRulesFor(gender),
    "</gender_and_address>",
    text(customerCard) ? `<customer_history>\n${text(customerCard)}\n</customer_history>` : "",
    state.length ? `<conversation_state>\n${state.join("\n")}\n</conversation_state>` : "",
    "</dynamic_context>",
  ].filter(Boolean).join("\n");
};

/* ----------------------------------------------------------------- history */

/**
 * The conversation so far, oldest first, as the model's own turns. Rows in ai_support_messages carry
 * either a customer message, an AI answer, a staff message, or a card send.
 */
export const historyTurnsFromRows = (rows = [], currentMessage = "") => {
  const turns = [];
  for (const row of [...asArray(rows)].reverse()) {
    const sender = text(row.sender_type).toLowerCase();
    if (text(row.message_type) === "product_card") {
      const names = asArray(row.product_cards).map((card) => text(card?.title || card?.name)).filter(Boolean).slice(0, 6);
      if (names.length) turns.push({ role: "assistant", content: `[اتبعتله كروت: ${names.join("، ")}]` });
      continue;
    }
    if (sender === "customer" || (!sender && text(row.customer_message))) {
      const body = text(row.message_text || row.customer_message);
      if (body) turns.push({ role: "user", content: body.slice(0, 800) });
      const answer = text(row.ai_answer);
      if (answer && sender !== "customer") turns.push({ role: "assistant", content: answer.slice(0, 800) });
      continue;
    }
    const body = text(row.ai_answer || row.staff_message || row.message_text);
    if (body) turns.push({ role: "assistant", content: body.slice(0, 800) });
  }
  // The message being answered is sent on its own below; drop it if the log already holds it.
  while (turns.length && turns[turns.length - 1].role === "user" && turns[turns.length - 1].content === text(currentMessage).slice(0, 800)) {
    turns.pop();
  }
  // The API wants a user turn first.
  while (turns.length && turns[0].role !== "user") turns.shift();
  // Consecutive same-role turns are merged so the transcript reads as a chat.
  return turns.reduce((acc, turn) => {
    const last = acc[acc.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n${turn.content}`;
    else acc.push({ ...turn });
    return acc;
  }, []);
};

const loadHistory = async ({ tenantId, sessionId, currentMessage }) => {
  if (!text(sessionId)) return [];
  try {
    const result = await db.query(
      `SELECT sender_type, message_type, message_text, customer_message, ai_answer, staff_message, product_cards
         FROM ai_support_messages
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT ${HISTORY_ROWS}`,
      [tenantId, text(sessionId)]
    );
    return historyTurnsFromRows(result.rows, currentMessage);
  } catch (error) {
    console.warn("[claude-agent] history unavailable", { session_id: sessionId, message: error?.message });
    return [];
  }
};

/* ------------------------------------------------------------------- tools */

const AGENT_TOOLS = [
  {
    name: "search_products",
    description: "ابحث في كتالوج المتجر باسم موديل أو براند أو نوع (مثلا «اير فورس»، «سكيتشرز حريمي»). استخدمها لما العميل يسأل عن موديل مش موجود في الكروت الجاهزة. بترجع المنتجات بـ product_id والسعر والألوان والمقاسات.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string", description: "اسم الموديل أو البراند أو النوع — مش جملة العميل كلها." } },
    },
  },
  {
    name: "show_products",
    description: "اختار الكروت اللي هتتبعت تحت رسالتك بدل الكروت الجاهزة. ابعت product_id من system_findings أو من نتيجة search_products. قايمة فاضية = متبعتش كروت.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["product_ids"],
      properties: { product_ids: { type: "array", items: { type: "string" }, maxItems: 6 } },
    },
  },
  {
    name: "get_inventory",
    description: "اتأكد من المخزون الحقيقي لمنتج، ولو عايز لمقاس ولون معين. دي الطريقة الوحيدة تقول إن مقاس/لون متاح.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["product_id"],
      properties: {
        product_id: { type: "string" },
        size: { type: "string", description: "المقاس اللي العميل سأل عليه، لو فيه." },
        color: { type: "string", description: "اللون اللي العميل سأل عليه، لو فيه." },
      },
    },
  },
  {
    name: "get_shipping_quote",
    description: "تكلفة الشحن ومدة التوصيل لمحافظة/مدينة. استخدمها بس لما العميل يسأل عن الشحن أو يقول هو منين.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["governorate"],
      properties: { governorate: { type: "string" }, city: { type: "string" } },
    },
  },
  {
    name: "get_policy",
    description: "سياسة المتجر: الاستبدال والاسترجاع وطرق الدفع والدفع عند الاستلام. استخدمها لما المعلومة مش في company_info.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "get_order_status",
    description: "حالة أوردر برقمه. بس لما العميل يسأل عن أوردر عمله قبل كده.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["order_number"],
      properties: { order_number: { type: "string" } },
    },
  },
  {
    name: "get_customer_history",
    description: "أوردرات العميل اللي فاتت والمقاسات اللي احتفظ بيها وأي شحنة شغالة. مرة واحدة بالكتير، ولما تفرق في الإجابة (مثلا قبل ما تسأله على المقاس).",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "escalate_to_human",
    description: "حوّل المحادثة لموظف حقيقي. بعدها اكتب للعميل جملة واحدة قصيرة إن زميل هيكمل معاه — بنفس اللهجة والأسلوب. متخلصش الرد بالأداة لوحدها.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["reason"],
      properties: { reason: { type: "string", description: "السبب في كلمتين، للزميل." } },
    },
  },
];

const cardSummary = (card = {}, safeProductFacts) => {
  const facts = safeProductFacts(card);
  return {
    product_id: text(facts.id),
    name: facts.name,
    price: facts.price,
    grade_label: facts.grade_label || undefined,
    colors: facts.colors.slice(0, 10),
    sizes: facts.sizes.slice(0, 15),
    in_stock: facts.total_stock > 0 || undefined,
  };
};

/* -------------------------------------------------------------------- main */

const findingsFor = ({ decision, preparedCards, safeProductFacts, mustKeepFacts }) => {
  const draft = text(decision.text || decision.answer || decision.channel_reply?.text);
  return [
    "<system_findings>",
    `النية اللي النظام فهمها: ${text(decision.detected_intent || decision.intent) || "مش واضحة"}`,
    preparedCards.length
      ? `الكروت الجاهزة (هتتبعت تحت ردك إلا لو اخترت غيرها):\n${JSON.stringify(preparedCards.map((card) => cardSummary(card, safeProductFacts)))}`
      : "مفيش كروت جاهزة للرسالة دي.",
    draft ? `draft_answer: ${draft}` : "",
    `must_keep_facts = ${mustKeepFacts ? "true" : "false"}`,
    "</system_findings>",
  ].filter(Boolean).join("\n");
};

const cardId = (card = {}) => text(card.product_id || card.id);

/**
 * @returns {Promise<object|null>} the decision with the agent's reply (and maybe other cards), or
 *          null to keep brain V2's reply.
 */
export const runClaudeSalesAgent = async ({
  decision = {},
  inbound = {},
  tenantId = null,
  customerGender = "unknown",
  memory = {},
  helpers = {},
  // Replaceable in tests; each one already fails soft in production.
  loaders = {},
} = {}) => {
  if (!isClaudeAgentEnabled()) return null;
  const intent = text(decision.detected_intent || decision.intent);
  if (SKIP_INTENTS.includes(intent) || asArray(helpers.skipIntents).includes(intent)) return null;
  const customerMessage = text(inbound.originalText || inbound.text);
  if (!customerMessage) return null;

  const { safeProductFacts, searchCards, mustKeepFacts = false } = helpers;
  const startedAt = Date.now();
  const deadline = startedAt + agentDeadlineMs();
  const sessionId = text(inbound.externalConversationId);
  const customerPhone = text(inbound.metadata?.customer_phone || inbound.externalCustomerId);

  try {
    const [persona, kb, history, customerCard] = await Promise.all([
      (loaders.persona || (() => loadPersona({ tenantId })))().catch(() => DEFAULT_PERSONA),
      (loaders.knowledgeBase || (() => loadSupportKnowledgeBase({ tenantId })))()
        .then((loaded) => ({ ...(loaded?.knowledge_base || {}), branches: asArray(loaded?.branches) }))
        .catch(() => ({})),
      (loaders.history || (() => loadHistory({ tenantId, sessionId, currentMessage: customerMessage })))().catch(() => []),
      (loaders.customerCard || (() => import("./aiCustomer360Service.js").then(async (customer360) => {
        if (!customerPhone) return "";
        const profile = await customer360.loadCustomer360({ tenantId, phone: customerPhone });
        return profile?.found ? customer360.summarizeCustomer360(profile) : "";
      })))().catch(() => ""),
    ]);

    const preparedCards = asArray(decision.product_cards);
    const cardPool = new Map(preparedCards.map((card) => [cardId(card), card]));
    let chosenCards = null; // null = the prepared cards
    let escalation = null;

    const registry = buildToolRegistry({
      tenantId,
      customerPhone,
      searchProducts: async () => [],
    });

    const runTool = async (name, input = {}) => {
      switch (name) {
        case "search_products": {
          if (typeof searchCards !== "function") return { error: "search_unavailable" };
          const cards = asArray(await searchCards(text(input.query)));
          for (const card of cards) cardPool.set(cardId(card), card);
          return { query: text(input.query), count: cards.length, products: cards.slice(0, 8).map((card) => cardSummary(card, safeProductFacts)) };
        }
        case "show_products": {
          const ids = asArray(input.product_ids).map(text).filter(Boolean);
          const picked = ids.map((id) => cardPool.get(id)).filter(Boolean);
          const unknown = ids.filter((id) => !cardPool.has(id));
          chosenCards = picked;
          return { ok: true, will_send: picked.length, unknown_ids: unknown.length ? unknown : undefined };
        }
        case "escalate_to_human":
          escalation = { reason: text(input.reason) || "agent_escalation" };
          return { ok: true, next: "اكتب للعميل جملة واحدة إن زميل هيكمل معاه دلوقتي." };
        case "get_inventory":
          return registry.execute("get_inventory", { product_id: input.product_id, size: input.size || null, color: input.color || null });
        case "get_shipping_quote":
          return registry.execute("get_shipping_quote", { governorate: input.governorate, city: input.city || null, area: null });
        case "get_policy":
        case "get_order_status":
        case "get_customer_history":
          return registry.execute(name, input);
        default:
          return { error: "unknown_tool", tool: name };
      }
    };

    const system = [
      { type: "text", text: buildStablePrompt({ kb, persona }), cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: buildDynamicContext({
          customerName: inbound.customerName,
          customerPhone,
          channel: inbound.channel,
          gender: customerGender,
          customerCard,
          memory,
        }),
      },
    ];

    const messages = [
      ...history,
      { role: "user", content: customerMessage.slice(0, 2000) },
      // Operator channel, after the customer's turn: what the store's systems found. A system
      // message cannot be impersonated by the customer the way text inside their turn could.
      { role: "system", content: findingsFor({ decision, preparedCards, safeProductFacts, mustKeepFacts }) },
    ];

    let reply = "";
    const toolTrace = [];
    const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const remaining = deadline - Date.now();
      if (remaining < 1_500) throw Object.assign(new Error("deadline"), { reason: "deadline" });
      const response = await client().beta.messages.create(
        {
          model: agentModel(),
          max_tokens: 2_000,
          system,
          tools: AGENT_TOOLS,
          messages,
          output_config: { effort: agentEffort() },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: remaining }
      );
      usage.input += Number(response.usage?.input_tokens || 0);
      usage.output += Number(response.usage?.output_tokens || 0);
      usage.cache_read += Number(response.usage?.cache_read_input_tokens || 0);
      usage.cache_write += Number(response.usage?.cache_creation_input_tokens || 0);

      if (response.stop_reason === "refusal") throw Object.assign(new Error("refusal"), { reason: "refusal" });
      if (response.stop_reason === "max_tokens") throw Object.assign(new Error("max_tokens"), { reason: "max_tokens" });

      const toolUses = asArray(response.content).filter((block) => block.type === "tool_use");
      if (!toolUses.length || response.stop_reason !== "tool_use") {
        reply = asArray(response.content).filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
        break;
      }
      // The whole assistant turn goes back unchanged — thinking blocks included.
      messages.push({ role: "assistant", content: response.content });
      const results = await Promise.all(toolUses.map(async (block) => {
        const result = await runTool(block.name, block.input || {}).catch((error) => ({ error: "tool_failed", message: error?.message }));
        toolTrace.push({ tool: block.name, ok: !result?.error });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result ?? {}).slice(0, 6_000),
          ...(result?.error ? { is_error: true } : {}),
        };
      }));
      messages.push({ role: "user", content: results });
    }

    reply = reply.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
    if (!reply) throw Object.assign(new Error("empty"), { reason: "empty_reply" });

    const cards = chosenCards ?? preparedCards;
    const images = cards
      .map((card) => ({
        id: text(card.image_id || card.image_url || card.product_id || card.id),
        url: text(card.image_url || card.url || card.image),
        image_url: text(card.image_url || card.url || card.image),
        product_id: text(card.product_id || card.id),
      }))
      .filter((image) => image.url);
    const cardsChanged = chosenCards !== null;
    const activeProductId = cardId(cards[0] || {});
    const memoryPatch = cardsChanged && cards.length
      ? { active_product_id: activeProductId, selected_product_id: activeProductId, last_product_id: activeProductId, last_product_cards: cards }
      : {};

    if (escalation && sessionId) {
      // Marked after the reply has left: a takeover marked now would make every channel's pre-send
      // recheck drop the very line telling the customer a colleague is coming.
      setTimeout(() => {
        markAiSupportConversationEscalated({
          tenantId,
          sessionId,
          reason: "AI_AGENT_ESCALATION",
          keyword: escalation.reason.slice(0, 80),
          source: "claude_sales_agent",
        }).catch((error) => console.warn("[claude-agent] escalation mark failed", { session_id: sessionId, message: error?.message }));
      }, ESCALATION_MARK_DELAY_MS).unref?.();
    }

    console.info("[claude-agent] reply", {
      session_id: sessionId,
      intent,
      ms: Date.now() - startedAt,
      tools: toolTrace.map((entry) => entry.tool),
      cards: cards.length,
      cards_changed: cardsChanged,
      escalated: Boolean(escalation),
      usage,
    });

    const memoryUpdates = { ...(decision.memoryUpdates || decision.memory_updates || {}), ...memoryPatch };
    return {
      ...decision,
      text: reply,
      answer: reply,
      ...(cardsChanged
        ? { products: cards, suggested_products: cards, product_cards: cards, images, image_cards: images, active_product_id: activeProductId || decision.active_product_id }
        : {}),
      memoryUpdates,
      memory_updates: memoryUpdates,
      channel_reply: {
        ...(decision.channel_reply || {}),
        text: reply,
        ...(cardsChanged ? { product_cards: cards, image_cards: images } : {}),
      },
      // The parts were the template's; the agent writes one message.
      reply_parts: undefined,
      debug: {
        ...(decision.debug || {}),
        claude_agent: { applied: true, model: agentModel(), ms: Date.now() - startedAt, tools: toolTrace, escalated: Boolean(escalation), usage },
      },
    };
  } catch (error) {
    const reason = error?.reason || (error instanceof Anthropic.APIError ? `api_${error.status}` : "error");
    console.warn("[claude-agent] skipped — brain V2 reply kept", { session_id: sessionId, intent, reason, message: error?.message, ms: Date.now() - startedAt });
    return null;
  }
};

export const __testing = { AGENT_TOOLS, findingsFor, cardSummary };
