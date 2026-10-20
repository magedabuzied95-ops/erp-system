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
import { addressRulesFor, inferCustomerGender } from "../utils/customerGender.js";
import { buildToolRegistry } from "./aiToolRegistryService.js";
import { findCustomerOrders } from "./aiBusinessToolsService.js";
import { expandSearchAliasTerms } from "./productAliasEngine.js";
import { buildOrderTrackingUrl } from "../utils/whatsapp.js";
import { loadPersona, DEFAULT_PERSONA } from "./aiPersonaService.js";
import { loadSupportKnowledgeBase } from "./aiSupportKnowledgeBaseService.js";
import { markAiSupportConversationEscalated } from "./aiSupportLogService.js";
import {
  getSharedOpenAiClient,
  isTextGenerationAvailable,
  noteOpenAiFailure,
  noteOpenAiSuccess,
  resolveSupportSamplingParams,
} from "./openaiSupportService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";
// Picked on the playground scenario run (2026-10-20): gpt-4o and gpt-5.1 invented grades, lost the
// model across turns and skipped tool calls; gpt-5.5 searched, offered the closest model honestly and
// quoted grades and prices from the data. Only the sales agent uses it — every other AI path keeps
// AI_SUPPORT_MODEL. AI_SALES_AGENT_OPENAI_MODEL overrides.
export const DEFAULT_OPENAI_AGENT_MODEL = "gpt-5.5";
const MAX_TOOL_ROUNDS = 5;
const DEFAULT_DEADLINE_MS = 25_000;
const HISTORY_ROWS = 24;
const ESCALATION_MARK_DELAY_MS = 20_000;

/** Never written by the agent: the sale's own steps and the owner's fixed answers. */
export const SKIP_INTENTS = Object.freeze([
  "greeting",
  "human_takeover",
  "post_product_order_confirmation",
  "post_product_color_selected",
  "post_product_size_selected",
  "post_product_color_list",
]);

/*
 * Provider: the same agent runs on Claude (Anthropic SDK) or on OpenAI (the Responses API key the
 * shop already pays for — the owner, 2026-10-20: "جرب كل حاجه ب Open Ai"). AI_SALES_AGENT_PROVIDER
 * picks; left empty it is Claude when an Anthropic key exists, otherwise OpenAI.
 */
export const agentProvider = () => {
  const explicit = text(process.env.AI_SALES_AGENT_PROVIDER).toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") return explicit;
  return text(process.env.ANTHROPIC_API_KEY) ? "anthropic" : "openai";
};

const providerReady = () =>
  agentProvider() === "anthropic"
    ? Boolean(text(process.env.ANTHROPIC_API_KEY))
    : Boolean(sharedOpenAi) || (isTextGenerationAvailable() && Boolean(getSharedOpenAiClient()));

export const isClaudeAgentEnabled = () =>
  (envFlagEnabled(process.env.AI_SALES_AGENT_ENABLED) || envFlagEnabled(process.env.AI_CLAUDE_AGENT_ENABLED)) && providerReady();
export const isSalesAgentEnabled = isClaudeAgentEnabled;

/*
 * Who gets it. "test" (the default): the AI playground and the owner's test numbers
 * (ai_channels.ai_test_contacts) only — real customers keep brain V2's reply until the owner
 * switches AI_SALES_AGENT_SCOPE to "all".
 */
const agentScope = () => (text(process.env.AI_SALES_AGENT_SCOPE).toLowerCase() === "all" ? "all" : "test");
export const agentAppliesTo = async (inbound = {}, { loadTestContacts } = {}) => {
  if (agentScope() === "all") return true;
  if (text(inbound.metadata?.source) === "ai_playground") return true;
  try {
    const { isAiTestContact, parseAiTestContacts } = await import("../utils/aiAutoReplyGate.js");
    const raw = loadTestContacts
      ? await loadTestContacts()
      : await import("./settingsService.js").then((settings) => settings.getSetting("ai_channels.ai_test_contacts", ""));
    const contacts = parseAiTestContacts(raw || "");
    return [inbound.metadata?.customer_phone, inbound.externalCustomerId]
      .map(text)
      .filter(Boolean)
      .some((phone) => isAiTestContact(contacts, phone));
  } catch {
    return false;
  }
};

const agentModel = () =>
  agentProvider() === "openai"
    ? text(process.env.AI_SALES_AGENT_OPENAI_MODEL) || DEFAULT_OPENAI_AGENT_MODEL
    : text(process.env.AI_CLAUDE_AGENT_MODEL) || DEFAULT_AGENT_MODEL;
// Chat is a low-effort workload: at "low" the model skips thinking on simple turns, which is what
// a customer waiting on WhatsApp feels.
const agentEffort = () => text(process.env.AI_CLAUDE_AGENT_EFFORT).toLowerCase() || "low";
const agentDeadlineMs = () => positiveNumber(process.env.AI_SALES_AGENT_DEADLINE_MS || process.env.AI_CLAUDE_AGENT_DEADLINE_MS, DEFAULT_DEADLINE_MS);

let sharedClient = null;
let sharedOpenAi = null;
const client = () => {
  if (!sharedClient) sharedClient = new Anthropic({ maxRetries: 1 });
  return sharedClient;
};
const openai = () => sharedOpenAi || getSharedOpenAiClient();
/** Tests hand in a fake client; production never calls this. */
export const __setAgentClientForTests = (fake) => {
  sharedClient = fake;
};
export const __setOpenAiClientForTests = (fake) => {
  sharedOpenAi = fake;
};

// Reasoning models (gpt-5, o-series) take an effort and reject temperature; chat models the reverse.
const openAiSampling = (model) =>
  /^(gpt-5|o\d)/i.test(text(model)) ? { reasoning: { effort: "low" } } : resolveSupportSamplingParams(model);

const OPENAI_TOOLS = () => AGENT_TOOLS.map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.input_schema,
  strict: false,
}));

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
- لما العميل يسأل عن موديل، ابعت كروت بتغطي كل الدرجات المتاحة منه (مصري / مستورد فيتنامي / ميرور اوريجينال — من grade_label) وألوان مختلفة، لحد 6 كروت؛ متبعتش كارت واحد غير لو العميل حدد لون أو درجة. في show_products ابعت card_id لكل كارت (product_id لوحده = كل ألوان الموديل ده).
- system_findings فيها الكروت الجاهزة للرسالة دي، وهتتبعت زي ما هي. لو مش هي اللي العميل عايزها، استدعي search_products باسم الموديل، وبعدين show_products بالـ product_id اللي تختارها. show_products بقايمة فاضية = متبعتش كروت.
- النظام ساعات بيفهم الرسالة غلط ويجهّز كروت ملهاش علاقة (مثلًا العميل بيسأل عن أوردر أو بيدردش). لو الكروت الجاهزة مش ليها علاقة بكلام العميل، لازم تستدعي show_products بقايمة فاضية قبل ما ترد.
- نفس الكلام على draft_answer: لو مش رد على كلام العميل (مثلًا العميل سأل سؤال تاني في نص البحث)، جاوب على اللي سأله هو، وبعدين رجّعه لخطوة البحث في سطر لو مناسب.
- «النية اللي النظام فهمها» تخمين، وممكن تكون غلط: «بكام الجوردن؟» سؤال سعر مش اعتراض. متردش على اعتراض العميل ما قالوش.
- لو draft_answer سؤال خطوة (زي «مقاس كام؟» أو «تحب أنهي درجة؟»): يا تسأله بأسلوبك، يا تعرض كروت — مش الاتنين لازقين في جملة واحدة. لو بعت كروت، السؤال ييجي بعد سطر الكروت في سطر لوحده.
- لما العميل يقول «بكام؟» أو «في منه أسود؟» أو «ده أصلي؟» من غير اسم موديل، يبقى يقصد آخر موديل اتكلمتوا عنه في المحادثة أو آخر كروت اتبعتت — متسألوش عن اسمه تاني.
- لو الموديل اللي طلبه بالظبط مش موجود بس فيه قريب منه في نتيجة search_products (نفس الموديل بلون أو درجة تانية، أو نفس العيلة زي «Air Max» لما يطلب «Air Max 90»)، قول بصراحة إن المطلوب بالظبط مش موجود واعرض القريب بالاسم وابعته بـ show_products. متقولش «مش متوفر» وبس وفيه بديل قدامك.
- سؤال السعر يتجاوب بالرقم من الكروت أو من search_products. لو الألوان/الدرجات أسعارها مختلفة قول من كام لكام.
- الدرجة والـ«أصلي»: من grade_label بس. لو grade_label مش موجود في البيانات، متسميش أي درجة (ممنوع تألّف «درجة أولى» أو «هاي كوبي»)، وقول إنك هتأكدله التصنيف. ممنوع تقول «أصلي/أوريجينال» إلا لو grade_label بيقول كده.
- سؤال برّه الشغل (حساب، سياسة، واجب، نكت): اعتذر في سطر واحد بلطف إنك هنا للمحل، ورجّعه للمنتجات — من غير كروت (show_products بقايمة فاضية).
- السعر والتوفر والمقاس واللون: من الكروت أو من نتيجة أداة في المحادثة دي بس. get_inventory هي الطريقة الوحيدة تتأكد إن مقاس ولون معين متاح.
- المقاسات: متقولش إن موديل «مقاسه مظبوط» أو «بيطلع كبير/صغير» أو «خد مقاس أكبر» إلا لو ده مكتوب في owner_knowledge. لو مش مكتوب، اسأل العميل بيلبس مقاس كام عادةً في الكوتشيات. ونفس الكلام على تحويل السنتي لمقاس (27 سم = كام): من owner_knowledge بس، مش من معلوماتك العامة.
- الدرجات (grade_label) حقيقية ومتسجلة: قولها زي ما هي من غير مبالغة، ومتقولش «أصلي» على حاجة مش متسجلة كده.
- لو العميل سأل عن الشحن لمحافظة معينة استدعي get_shipping_quote.
- لو سأل عن أوردر عمله («الأوردر بتاعي وصل لفين»، «الأوردر 2203»): استدعي get_order_status — برقم الأوردر لو قاله، ومن غير رقم لو مقالش. قول الحالة بكلام بسيط (اتأكد وبيتجهز / اتشحن مع شركة الشحن ورقم التتبع / اتسلم) من النتيجة بس، ومتخترعش ميعاد وصول. لو مفيش أوردر على رقمه قول كده واسأله عن رقم الأوردر أو الموبايل اللي طلب بيه. لو الأوردر متأخر أو فيه مشكلة، حوّل لزميل.
</products_and_cards>

<faq>
قبل ما تجاوب على سياسة أو دفع أو شحن أو استبدال أو مواعيد: اعتمد على company_info و owner_knowledge، ولو مش موجودة فيهم استدعي get_policy. لو برضه مفيش، متخمنش: قول إنك هتتأكد، وحوّل لزميل.
</faq>

<tone_and_style>
<language>
رد بنفس لغة العميل: لو كتب إنجليزي رد إنجليزي بسيط ودود، ولو كتب فرانكو أو عربي رد بالعامية المصرية بالحروف العربي.
</language>
<egyptian_arabic_register>
دافي بس محترم — عامية مصرية مهذبة، مش فصحى ومش سوقي. ممنوع الفصحى حتى لو بتنقل سياسة: لا «يمكنك» ولا «يجب» ولا «لديك» ولا «وفق الشروط» — «تقدر»، «لازم»، «عندك»، «بشرط».
- عامية بس: «ابعت» مش «أرسل»، «تمام» مش «حسنًا»، «شوف» مش «انظر»، «عايز» مش «تريد».
- كلمات أساسية: تمام / حاضر / مظبوط / بإذن الله / تحت أمرك / ماشي / تسلم.
- روابط: علشان (مش لأن)، دلوقتي، كده.
- الاعتذار: «معلش يا فندم» أو «آسفين على الإزعاج» — مش «نعتذر» ولا «أعتذر».
- الموافقة: «تمام يا فندم» / «حاضر» / «تحت أمرك».
</egyptian_arabic_register>
<honorifics>
- خاطب العميل بـ«حضرتك» مش «انت». «يا فندم» تنفع بس متكترش منها.
- النوع (ذكر/أنثى) وصيغة الأفعال والألقاب: من gender_and_address بس. ممنوع تقرر النوع من الاسم.
- اسم العميل يتكتب بنفس الحروف بالظبط: لو مكتوب بالإنجليزي «Nada» يفضل «Nada» — ممنوع تكتبه «ندى». لو الاسم يوزرنيم أو رموز، متقولوش خالص. لو العميل قال «دكتور/دكتورة» عن نفسه، استخدمها.
- قبل ما تبعت، راجع كل فعل وضمير بيكلّم العميل إنه بنفس الصيغة من أول الرد لآخره (متخلطش «تقدر» مع «تستلميه»).
</honorifics>
<voice_rules>
- اتكلم عن اللي هتعمله بالمستقبل: «هبعتلك»، «هأكدلك»، «هحوّلك» — مش أوامر.
- لو العميل متضايق أو متردد، طمّنه في كلمتين قبل الحل.
- اقفل الكلام اللي خلص بدفا: «ربنا يخليك»، «في خدمة حضرتك دايمًا» — بس لما المحادثة تخلص فعلًا. ممنوع جمل الحشو في آخر كل رسالة زي «لو في أي حاجة تانية أنا تحت أمرك» أو «عشان أقدر أساعدك بشكل أفضل».
- الخصم وآخر سعر: جاوب من قواعد الخصومات في company_info. متوعدش إنك «هتشوف لو فيه خصم» ومتفاوضش على السعر.
- لو العميل بيهزر أو بيدردش، رد على كلامه نفسه الأول («الحمد لله يا فندم، تسلم» على «عامل إيه؟»)، وبعدين رجّعه للي بيدوّر عليه.
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
- لو system_findings فيها draft_answer و must_keep_facts = true: كل رقم ورابط ومدة وشرط فيها لازم يتقال زي ما هو بالظبط؛ الصياغة بس هي اللي بإيدك — بالعامية وباختصار، وبس الجزء اللي العميل سأل عنه (لو سأل عن الاستبدال، متسردش سياسة الاسترجاع كلها).
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

/** Chat turns as the APIs want them: user first, same-role neighbours merged. */
const mergeTurns = (turns = []) => {
  const clean = asArray(turns)
    .map((turn) => ({ role: turn?.role === "assistant" ? "assistant" : "user", content: text(turn?.content).slice(0, 800) }))
    .filter((turn) => turn.content);
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean.reduce((acc, turn) => {
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
      properties: { query: { type: "string", description: "اسم الموديل أو البراند بالإنجليزي زي ما مكتوب في الكتالوج (New Balance 530، Air Force 1، Skechers) — مش جملة العميل كلها. لو رجعت صفر جرّب تاني باسم أقصر (البراند لوحده) قبل ما تقول مش موجود." } },
    },
  },
  {
    name: "show_products",
    description: "اختار الكروت اللي هتتبعت تحت رسالتك بدل الكروت الجاهزة. ابعت card_id من system_findings أو من نتيجة search_products (product_id لوحده = كل ألوانه). لحد 6 كروت بيغطوا الدرجات والألوان. قايمة فاضية = متبعتش كروت.",
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
    description: "أوردرات العميل وحالتها (اتأكد/اتشحن مع مين ورقم التتبع/اتسلم). استخدمها لما العميل يسأل عن أوردر عمله. لو قال رقم الأوردر ابعته، ولو مقالش ابعتها من غير رقم وهترجع آخر أوردراته. الأوردر بيظهر بس لرقم الموبايل اللي اتعمل بيه: على واتساب رقمه معروف، وفي الماسنجر والإنستجرام لو رجعت phone_needed اطلب منه رقم الموبايل اللي طلب بيه وابعته في phone.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        order_number: { type: "string", description: "رقم الأوردر لو العميل قاله (زي 2203 أو WEB-2203)." },
        phone: { type: "string", description: "رقم الموبايل اللي العميل كتبه في الشات، لو مش على واتساب." },
      },
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

// One key per CARD, not per product: every colour of New Balance 530 is product 180, so keying by
// product id kept one colour and dropped the rest (owner's WhatsApp test, 2026-10-20).
const cardKey = (card = {}) => {
  const productId = text(card.product_id || card.id);
  const variant = text(card.variant_id || card.selected_variant_id || card.matched_variant_id || card.color || card.matched_variant_color);
  return variant ? `${productId}:${variant}` : productId;
};

const cardSummary = (card = {}, safeProductFacts) => {
  const facts = safeProductFacts(card);
  return {
    card_id: cardKey(card),
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

// Words too common to tell one model from another («air» is in Air Max and Air Force alike).
const GENERIC_MODEL_WORDS = new Set(["air", "new", "nike", "adidas", "puma", "four", "one", "two", "low", "high", "mid", "men", "women", "kids", "shoes", "sneakers", "the", "and", "for"]);
/*
 * Brain V2's cards, kept only when they name the model the customer named. «عندكم جوردن 4؟» came
 * with ASICS and a Nike B347 among twelve Jordan 4 cards (live re-test, 2026-10-20). No telling
 * word in the message (a generic «عايز كوتشي») → the cards stay as they were; nothing would remain
 * → they stay too.
 */
export const cardsNamingTheModel = (cards = [], message = "") => {
  const words = new Set(
    expandSearchAliasTerms(message)
      .flatMap((term) => String(term).toLowerCase().split(/[^a-z]+/))
      .filter((word) => word.length >= 3 && !GENERIC_MODEL_WORDS.has(word))
  );
  if (!words.size || !asArray(cards).length) return cards;
  const kept = cards.filter((card) => {
    const name = text(card.title || card.name || card.product_name).toLowerCase();
    return [...words].some((word) => name.includes(word));
  });
  return kept.length ? kept : cards;
};
// The customer asked for one grade by name — then only that grade is shown.
const NAMED_GRADE = /(ميرور|مرور|فيتنام|مستورد|مصري|اوريجينال|أوريجينال|اورجينال|أصلي|اصلي|mirror|original|vietnam|egypt)/i;

const deadlineLeft = (deadline) => {
  const remaining = deadline - Date.now();
  if (remaining < 1_500) throw Object.assign(new Error("deadline"), { reason: "deadline" });
  return remaining;
};

/** Claude: cached system block, findings as a mid-conversation system message, thinking passed back. */
const runAnthropicTurns = async ({ model = agentModel(), stablePrompt, dynamicContext, findings, history, customerMessage, deadline, usage, executeCalls }) => {
  const system = [
    { type: "text", text: stablePrompt, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicContext },
  ];
  const messages = [
    ...history,
    { role: "user", content: customerMessage.slice(0, 2000) },
    // Operator channel, after the customer's turn: what the store's systems found. A system
    // message cannot be impersonated by the customer the way text inside their turn could.
    { role: "system", content: findings },
  ];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client().beta.messages.create(
      {
        model,
        max_tokens: 2_000,
        system,
        tools: AGENT_TOOLS,
        messages,
        output_config: { effort: agentEffort() },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { timeout: deadlineLeft(deadline) }
    );
    usage.input += Number(response.usage?.input_tokens || 0);
    usage.output += Number(response.usage?.output_tokens || 0);
    usage.cache_read += Number(response.usage?.cache_read_input_tokens || 0);
    usage.cache_write += Number(response.usage?.cache_creation_input_tokens || 0);
    if (response.stop_reason === "refusal") throw Object.assign(new Error("refusal"), { reason: "refusal" });
    if (response.stop_reason === "max_tokens") throw Object.assign(new Error("max_tokens"), { reason: "max_tokens" });

    const toolUses = asArray(response.content).filter((block) => block.type === "tool_use");
    if (!toolUses.length || response.stop_reason !== "tool_use") {
      return asArray(response.content).filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    }
    // The whole assistant turn goes back unchanged — thinking blocks included.
    messages.push({ role: "assistant", content: response.content });
    const done = await executeCalls(toolUses.map((block) => ({ id: block.id, name: block.name, input: block.input })));
    messages.push({
      role: "user",
      content: done.map(({ call, result }) => ({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result ?? {}).slice(0, 6_000),
        ...(result?.error ? { is_error: true } : {}),
      })),
    });
  }
  throw Object.assign(new Error("max_rounds"), { reason: "max_rounds" });
};

/**
 * OpenAI (Responses API): the stable prompt is `instructions`, so its prefix caches automatically;
 * per-customer context and the findings ride as developer messages, never inside the customer's turn.
 */
const runOpenAiTurns = async ({ model = agentModel(), stablePrompt, dynamicContext, findings, history, customerMessage, deadline, usage, executeCalls }) => {
  const input = [
    { role: "developer", content: dynamicContext },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: customerMessage.slice(0, 2000) },
    { role: "developer", content: findings },
  ];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let response;
    try {
      response = await openai().responses.create(
        {
          model,
          instructions: stablePrompt,
          input,
          tools: OPENAI_TOOLS(),
          max_output_tokens: 2_000,
          ...openAiSampling(model),
        },
        { timeout: deadlineLeft(deadline), maxRetries: 0 }
      );
      noteOpenAiSuccess();
    } catch (error) {
      if (!error?.reason) noteOpenAiFailure(error);
      throw error;
    }
    usage.input += Number(response.usage?.input_tokens || 0);
    usage.output += Number(response.usage?.output_tokens || 0);
    usage.cache_read += Number(response.usage?.input_tokens_details?.cached_tokens || 0);

    const calls = asArray(response.output).filter((item) => item?.type === "function_call");
    if (!calls.length) {
      if (response.status === "incomplete") throw Object.assign(new Error("incomplete"), { reason: "max_tokens" });
      return text(response.output_text);
    }
    // Reasoning items go back with the calls: reasoning models refuse a turn whose items were dropped.
    input.push(...asArray(response.output));
    const done = await executeCalls(calls.map((call) => {
      let parsed = {};
      try {
        parsed = JSON.parse(call.arguments || "{}");
      } catch {
        parsed = {};
      }
      return { id: call.call_id, name: call.name, input: parsed };
    }));
    for (const { call, result } of done) {
      input.push({ type: "function_call_output", call_id: call.id, output: JSON.stringify(result ?? {}).slice(0, 6_000) });
    }
  }
  throw Object.assign(new Error("max_rounds"), { reason: "max_rounds" });
};

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
  if (!(await agentAppliesTo(inbound, { loadTestContacts: loaders.testContacts }))) return null;

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
      (loaders.history || (() => (
        // The playground keeps its own transcript (its test chat is never logged).
        text(inbound.metadata?.source) === "ai_playground" && Array.isArray(inbound.metadata?.agent_history)
          ? Promise.resolve(mergeTurns(inbound.metadata.agent_history))
          : loadHistory({ tenantId, sessionId, currentMessage: customerMessage })
      )))().catch(() => []),
      (loaders.customerCard || (() => import("./aiCustomer360Service.js").then(async (customer360) => {
        if (!customerPhone) return "";
        const profile = await customer360.loadCustomer360({ tenantId, phone: customerPhone });
        return profile?.found ? customer360.summarizeCustomer360(profile) : "";
      })))().catch(() => ""),
    ]);

    const preparedCards = asArray(decision.product_cards);
    const cardPool = new Map(preparedCards.map((card) => [cardKey(card), card]));
    // get_order_status's answer, for the tracking button under the reply.
    let trackedOrders = null;
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
          for (const card of cards) cardPool.set(cardKey(card), card);
          return { query: text(input.query), count: cards.length, products: cards.slice(0, 8).map((card) => cardSummary(card, safeProductFacts)) };
        }
        case "show_products": {
          const ids = asArray(input.product_ids).map(text).filter(Boolean);
          // A card_id picks that card; a bare product_id picks every colour of that model.
          const picked = [];
          const unknown = [];
          for (const id of ids) {
            const matches = cardPool.has(id) ? [cardPool.get(id)] : [...cardPool.values()].filter((card) => cardId(card) === id);
            if (!matches.length) unknown.push(id);
            for (const card of matches) if (!picked.includes(card)) picked.push(card);
          }
          // The model in its other grades rides along unless the customer named one: «فيه نيوبالانس 530»
          // came back Egyptian-only while the Vietnamese and mirror pairs sat in the same search
          // (owner, 2026-10-20). Same model = same name before " - <colour>".
          const gradesAdded = [];
          if (picked.length && !NAMED_GRADE.test(customerMessage)) {
            const gradeOf = (card) => text(safeProductFacts(card).grade).toLowerCase();
            const baseOf = (card) => text(safeProductFacts(card).name).toLowerCase().split(" - ")[0].replace(/\s+/g, " ").trim();
            const shownGrades = new Set(picked.map(gradeOf).filter(Boolean));
            const bases = new Set(picked.map(baseOf).filter(Boolean));
            const perGrade = new Map();
            for (const card of cardPool.values()) {
              const grade = gradeOf(card);
              if (!grade || shownGrades.has(grade) || picked.includes(card) || !bases.has(baseOf(card))) continue;
              if ((perGrade.get(grade) || 0) >= 3) continue;
              perGrade.set(grade, (perGrade.get(grade) || 0) + 1);
              picked.push(card);
              if (!gradesAdded.includes(grade)) gradesAdded.push(grade);
            }
          }
          chosenCards = picked.slice(0, 12);
          return {
            ok: true,
            will_send: chosenCards.length,
            unknown_ids: unknown.length ? unknown : undefined,
            other_grades_added: gradesAdded.length ? gradesAdded.map((grade) => chosenCards.map((card) => safeProductFacts(card)).find((facts) => text(facts.grade).toLowerCase() === grade)?.grade_label || grade) : undefined,
          };
        }
        case "escalate_to_human":
          escalation = { reason: text(input.reason) || "agent_escalation" };
          return { ok: true, next: "اكتب للعميل جملة واحدة إن زميل هيكمل معاه دلوقتي." };
        case "get_inventory":
          return registry.execute("get_inventory", { product_id: input.product_id, size: input.size || null, color: input.color || null });
        case "get_shipping_quote":
          return registry.execute("get_shipping_quote", { governorate: input.governorate, city: input.city || null, area: null });
        case "get_order_status": {
          const phone = text(input.phone) || customerPhone;
          const found = await findCustomerOrders({ tenantId, orderNumber: text(input.order_number), phone });
          if (found?.found) {
            trackedOrders = { phone, orders: found.orders };
            found.orders = found.orders.map((order) => ({ ...order, tracking_page: "هيتبعت للعميل زرار «تتبع الأوردر» تحت ردك" }));
          }
          return found;
        }
        case "get_policy":
        case "get_customer_history":
          return registry.execute(name, input);
        default:
          return { error: "unknown_tool", tool: name };
      }
    };

    const stablePrompt = buildStablePrompt({ kb, persona });
    const dynamicContext = buildDynamicContext({
      customerName: inbound.customerName,
      customerPhone,
      channel: inbound.channel,
      gender: customerGender,
      customerCard,
      memory,
    });
    const findings = findingsFor({ decision, preparedCards, safeProductFacts, mustKeepFacts });
    const toolTrace = [];
    const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

    const executeCalls = async (calls) => Promise.all(calls.map(async (call) => {
      const result = await runTool(call.name, call.input || {}).catch((error) => ({ error: "tool_failed", message: error?.message }));
      // What it asked and what came back, in a few words — enough to see a wrong query in the logs.
      toolTrace.push({
        tool: call.name,
        ok: !result?.error,
        input: JSON.stringify(call.input || {}).slice(0, 160),
        found: Number.isFinite(Number(result?.count)) ? Number(result.count) : result?.will_send ?? result?.found ?? undefined,
      });
      return { call, result };
    }));

    // The playground may try another model of the same provider, to compare before switching.
    const model = (text(inbound.metadata?.source) === "ai_playground" && text(inbound.metadata?.agent_model)) || agentModel();
    let reply = agentProvider() === "openai"
      ? await runOpenAiTurns({ model, stablePrompt, dynamicContext, findings, history, customerMessage, deadline, usage, executeCalls })
      : await runAnthropicTurns({ model, stablePrompt, dynamicContext, findings, history, customerMessage, deadline, usage, executeCalls });

    reply = reply.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
    if (!reply) throw Object.assign(new Error("empty"), { reason: "empty_reply" });
    // A hand-over line goes alone: cards under "a colleague will take over" read as a sales push.
    const cards = escalation && chosenCards === null ? [] : chosenCards ?? cardsNamingTheModel(preparedCards, customerMessage);
    const images = cards
      .map((card) => ({
        id: text(card.image_id || card.image_url || card.product_id || card.id),
        url: text(card.image_url || card.url || card.image),
        image_url: text(card.image_url || card.url || card.image),
        product_id: text(card.product_id || card.id),
      }))
      .filter((image) => image.url);
    const cardsChanged = chosenCards !== null || Boolean(escalation && preparedCards.length) || cards.length !== preparedCards.length;
    const activeProductId = cardId(cards[0] || {});
    const memoryPatch = cardsChanged && cards.length
      ? { active_product_id: activeProductId, selected_product_id: activeProductId, last_product_id: activeProductId, last_product_cards: cards }
      : {};

    // A playground conversation is not a real one: nothing to hand over.
    if (escalation && sessionId && text(inbound.metadata?.source) !== "ai_playground") {
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
    // WhatsApp sends cards only for product intents; a «general» reply carrying cards went out as a
    // website link instead (owner's test, «فيه نيوبالانس 530»).
    const productIntent = /product|color|size|image|catalog|grade/i.test(intent);
    const intentPatch = cardsChanged && cards.length && !productIntent ? { intent: "product_search", detected_intent: "product_search" } : {};
    // The order the reply is about — the one asked for, or the latest — gets a tracking button.
    const trackedOrder = trackedOrders?.orders?.[0] || null;
    const trackingUrl = trackedOrder ? buildOrderTrackingUrl(trackedOrder.order_number, trackedOrders.phone) : "";
    const isWhatsapp = /whatsapp/i.test(text(inbound.channel));
    // Messenger and Instagram have no button here: the link rides in the text.
    if (trackingUrl && !isWhatsapp && !reply.includes(trackingUrl)) reply = `${reply}\n\nتتبع الأوردر من هنا: ${trackingUrl}`;
    return {
      ...decision,
      ...intentPatch,
      ...(trackingUrl && isWhatsapp
        ? { order_tracking_cta: { url: trackingUrl, order_number: trackedOrder.order_number, title: "📦 تتبع أوردرك", button: "تتبع الأوردر" } }
        : {}),
      text: reply,
      answer: reply,
      ...(cardsChanged
        ? {
            products: cards,
            suggested_products: cards,
            product_cards: cards,
            images,
            image_cards: images,
            active_product_id: activeProductId || decision.active_product_id,
            // Graded runs pass the channels' default 6; the senders cap by this (as brain V2 does).
            ...(cards.length > 6 ? { metadata: { ...(decision.metadata || {}), product_card_limit: cards.length } } : {}),
          }
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
        claude_agent: { applied: true, provider: agentProvider(), model, ms: Date.now() - startedAt, tools: toolTrace, escalated: Boolean(escalation), usage },
      },
    };
  } catch (error) {
    const reason = error?.reason || (error?.status ? `api_${error.status}` : "error");
    console.warn("[claude-agent] skipped — brain V2 reply kept", { session_id: sessionId, intent, reason, message: error?.message, ms: Date.now() - startedAt });
    return null;
  }
};

/**
 * One follow-up message for a customer who went quiet — a message sequence's "ai" step. Written
 * from the same prompt and the same conversation as a live reply, so the nudge picks up where the
 * talk stopped ("لسه حابب الإير فورس الأبيض مقاس 42؟") instead of a generic "لسه مهتم؟".
 *
 * @returns {Promise<string>} the text, or "" so the sequence falls back to its fixed text.
 */
export const writeFollowUpMessage = async ({
  tenantId = null,
  sessionId = "",
  customerName = "",
  instruction = "",
  stepNumber = 1,
  totalSteps = 1,
  loaders = {},
} = {}) => {
  if (!isClaudeAgentEnabled() || !text(instruction)) return "";
  const startedAt = Date.now();
  try {
    const [persona, kb, history] = await Promise.all([
      (loaders.persona || (() => loadPersona({ tenantId })))().catch(() => DEFAULT_PERSONA),
      (loaders.knowledgeBase || (() => loadSupportKnowledgeBase({ tenantId })))()
        .then((loaded) => ({ ...(loaded?.knowledge_base || {}), branches: asArray(loaded?.branches) }))
        .catch(() => ({})),
      (loaders.history || (() => loadHistory({ tenantId, sessionId, currentMessage: "" })))().catch(() => []),
    ]);
    const task = [
      "<follow_up_task>",
      "الرسالة دي من المتجر ليك إنت، مش من العميل. العميل بطّل يرد من آخر رسالة.",
      `المطلوب في المتابعة دي: ${text(instruction)}`,
      `دي متابعة رقم ${stepNumber} من ${totalSteps}.`,
      "اكتب رسالة متابعة واحدة قصيرة (سطر أو اتنين) طبيعية، مبنية على اللي اتكلمتوا فيه فعلًا — اذكر الموديل أو المقاس لو كانوا اتقالوا.",
      "من غير ضغط ولا إلحاح، ومتكررش متابعة قديمة بنفس الكلام. متخترعش عرض ولا خصم ولا سعر مش مكتوب.",
      "اكتب نص الرسالة بس.",
      "</follow_up_task>",
    ].join("\n");
    const stablePrompt = buildStablePrompt({ kb, persona });
    const dynamicContext = buildDynamicContext({ customerName, channel: "", gender: inferCustomerGender(customerName).gender });
    let raw = "";
    if (agentProvider() === "openai") {
      const model = agentModel();
      const response = await openai().responses.create(
        {
          model,
          instructions: stablePrompt,
          input: [
            { role: "developer", content: dynamicContext },
            ...history.map((turn) => ({ role: turn.role, content: turn.content })),
            // The store's own instruction: a developer message, never a fake customer turn.
            { role: "developer", content: task },
          ],
          max_output_tokens: 600,
          ...openAiSampling(model),
        },
        { timeout: agentDeadlineMs(), maxRetries: 0 }
      );
      raw = text(response.output_text);
    } else {
      const response = await client().beta.messages.create(
        {
          model: agentModel(),
          max_tokens: 600,
          system: [
            { type: "text", text: stablePrompt, cache_control: { type: "ephemeral" } },
            { type: "text", text: dynamicContext },
          ],
          // The task closes the transcript as a user turn: the API needs one last, and the system half
          // above says it is the store speaking.
          messages: [...history, { role: "user", content: task }],
          output_config: { effort: agentEffort() },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: agentDeadlineMs() }
      );
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return "";
      raw = asArray(response.content).filter((block) => block.type === "text").map((block) => block.text).join("\n");
    }
    const written = raw.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
    console.info("[claude-agent] follow-up written", { session_id: sessionId, step: stepNumber, ms: Date.now() - startedAt, chars: written.length });
    return written;
  } catch (error) {
    console.warn("[claude-agent] follow-up not written", { session_id: sessionId, message: error?.message, ms: Date.now() - startedAt });
    return "";
  }
};

/*
 * GENI's "AI Feedback" → prompt fixer, here: a colleague marks a reply as wrong and says why; the
 * model proposes ONE precise lesson — a new line of owner knowledge, or an edit to the line that
 * caused it. Nothing is saved until the owner approves it in the inbox. The lesson lands in
 * ai_agent_knowledge, which every reply already reads as <owner_knowledge>.
 */
const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "entry_id", "title", "triggers", "answer", "explanation"],
  properties: {
    action: { type: "string", enum: ["create", "update", "none"] },
    entry_id: { type: ["integer", "null"], description: "The knowledge entry to edit when action is update." },
    title: { type: "string" },
    triggers: { type: "array", items: { type: "string" } },
    answer: { type: "string", description: "The lesson, written as one or two lines the agent will read before every reply." },
    explanation: { type: "string", description: "One line, in Egyptian Arabic, for the owner: what was wrong and what this changes." },
  },
};

export const isClaudeConfigured = () => providerReady();

export const proposeAgentLesson = async ({
  tenantId = null,
  customerQuestion = "",
  aiReply = "",
  correctReply = "",
  correctionType = "other",
  feedback = "",
  loaders = {},
} = {}) => {
  if (!isClaudeConfigured()) throw Object.assign(new Error("No AI provider is configured"), { status: 503, code: "AI_NOT_CONFIGURED" });
  if (!text(aiReply) || !(text(correctReply) || text(feedback))) {
    throw Object.assign(new Error("The wrong reply and what was wrong with it are both needed"), { status: 400 });
  }
  const entries = await (loaders.knowledge || (async () => {
    const { listAgentKnowledge } = await import("./aiAgentKnowledgeService.js");
    return listAgentKnowledge({ tenantId, kind: "knowledge" });
  }))().catch(() => []);
  const current = asArray(entries)
    .filter((entry) => entry && entry.enabled !== false)
    .slice(0, 60)
    .map((entry) => ({ id: entry.id, title: text(entry.title), answer: text(entry.answer).slice(0, 600) }));

  const lessonSystem = [
        "إنت بتصلّح تعليمات موظف مبيعات (AI) في متجر مصري أونلاين. التعليمات الثابتة مش في إيدك؛ اللي في إيدك «معلومات صاحب المحل» (owner_knowledge): سطور قصيرة الإيجنت بيقراها قبل كل رد.",
        "زميل في المتجر علّم على رد غلط وقال الصح. اقترح تعديل واحد بس:",
        "- update: لو فيه سطر موجود هو اللي سبّب الغلط أو ناقص — عدّل السطر ده (entry_id) بالصيغة الجديدة كاملة.",
        "- create: لو مفيش سطر يخص الموضوع — سطر جديد.",
        "- none: لو الغلط مش معلومة ناقصة (مثلا مشكلة سعر أو مخزون في السيستم نفسه) — وقول ده في explanation.",
        "السطر لازم يكون قاعدة عامة تنفع لكل عميل، مش رد على العميل ده بالذات. قصير، محدد، بالعامية المصرية. متخترعش أرقام مش موجودة في كلام الزميل.",
        "triggers: 2–6 كلمات أو عبارات قصيرة العميل ممكن يقولها في الموضوع ده.",
  ].join("\n");
  const lessonInput = JSON.stringify({
    customer_question: text(customerQuestion).slice(0, 1500),
    wrong_ai_reply: text(aiReply).slice(0, 1500),
    correct_reply_from_colleague: text(correctReply).slice(0, 1500),
    what_was_wrong: text(feedback).slice(0, 800),
    correction_type: text(correctionType),
    current_owner_knowledge: current,
  }, null, 1);

  let raw = "";
  if (agentProvider() === "openai") {
    const model = agentModel();
    const response = await openai().responses.create(
      {
        model,
        instructions: lessonSystem,
        input: [{ role: "user", content: lessonInput }],
        text: { format: { type: "json_schema", name: "agent_lesson", strict: true, schema: LESSON_SCHEMA } },
        max_output_tokens: 2_000,
        ...openAiSampling(model),
      },
      { timeout: 45_000, maxRetries: 0 }
    );
    raw = text(response.output_text);
  } else {
    const response = await client().messages.create(
      {
        model: agentModel(),
        max_tokens: 2_000,
        system: lessonSystem,
        messages: [{ role: "user", content: lessonInput }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: LESSON_SCHEMA } },
      },
      { timeout: 45_000 }
    );
    if (response.stop_reason === "refusal") throw Object.assign(new Error("The model declined"), { status: 422 });
    raw = asArray(response.content).filter((block) => block.type === "text").map((block) => block.text).join("");
  }
  let lesson;
  try {
    lesson = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("The model's proposal could not be read"), { status: 502 });
  }
  const known = new Map(current.map((entry) => [Number(entry.id), entry]));
  // An edit to a line that does not exist becomes a new line rather than a silent no-op.
  if (lesson.action === "update" && !known.has(Number(lesson.entry_id))) lesson.action = "create";
  return {
    action: ["create", "update", "none"].includes(lesson.action) ? lesson.action : "none",
    entry_id: lesson.action === "update" ? Number(lesson.entry_id) : null,
    previous_answer: lesson.action === "update" ? known.get(Number(lesson.entry_id))?.answer || "" : "",
    title: text(lesson.title).slice(0, 160),
    triggers: asArray(lesson.triggers).map(text).filter(Boolean).slice(0, 12),
    answer: text(lesson.answer).slice(0, 2000),
    explanation: text(lesson.explanation).slice(0, 600),
  };
};

export const __testing = { AGENT_TOOLS, findingsFor, cardSummary, LESSON_SCHEMA };
