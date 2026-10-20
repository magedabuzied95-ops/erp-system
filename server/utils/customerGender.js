/*
 * Who are we talking to — a man or a woman — read from the name the channel gives us, so every
 * reply uses the right Arabic forms (تحب / تحبي، بيك / بيكي). The owner asked for this after
 * seeing GENI ERP's agent (2026-10-20): it never mixes up a customer's gender, because the gender is
 * decided ONCE, in its own step, and the reply writer is told the answer instead of guessing.
 *
 * Rules, in order:
 *   1. A title or kunya decides: أم / om_ / Miss / دكتورة → female; أبو / abo_ / Mr / دكتور → male.
 *   2. Only the FIRST name counts. The second word of an Egyptian name is the father's name, so
 *      "nosha magdy12" must never become male because of "magdy".
 *   3. Known name lists (Arabic and Franco spellings).
 *   4. Endings, with the exceptions that make them unsafe on their own: ة/ه is female except حمزة،
 *      أسامة، طه، عبدالله…; ا / ء is female except رضا، مينا، زكريا، بهاء…; ى/ي and Latin -y decide
 *      nothing without the list (مصطفى، يحيى، سامي are men, منى، هدى، أماني are women).
 *   5. Anything else — a shop name, emojis, digits, "." or a shared name (نور، Alaa) — is "unknown",
 *      and the reply stays neutral. Guessing wrong is worse than not guessing.
 */

export const CUSTOMER_GENDERS = Object.freeze(["male", "female", "unknown"]);

const text = (value = "") => String(value ?? "").trim();

const normalizeArabic = (value = "") =>
  text(value)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");

const words = (list) => new Set(list.split(/\s+/).filter(Boolean).map(normalizeArabic));
const latin = (list) => new Set(list.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase()));

const ARABIC_MALE = words(`
  محمد احمد محمود مصطفي علي عمر عمرو كريم خالد حسن حسين ابراهيم اسماعيل يوسف يحيي زكريا رضا طه
  حمزه اسامه طلحه عبيده معاويه عطيه سلامه شحاته حماده جمعه خليفه عرفه وهبه
  مينا بيشوي جرجس مايكل بيتر بولا يوحنا ابانوب كيرلس مارك جورج ميلاد اسحاق يعقوب موسي عيسي
  شادي رامي هاني سامي فادي مجدي حمدي فتحي شريف اشرف طارق وائل تامر هشام عادل سامح ماجد مازن
  زياد ياسين انس ادم معاذ بلال سيف مهند عصام عماد ايهاب اسلام ايمن جمال كمال صلاح سعيد ناصر
  منصور ممدوح محسن رافت عاطف حازم حاتم باسم نبيل نادر وليد رامز عبده سيد السيد حسام عاصم ياسر
  شوقي فوزي رمضان شعبان عثمان عمار عز عزت مدحت ممدوح نصر نشات هيثم هادي يسري رشاد رشدي فريد
  مراد صابر صبري جابر عبد ابو بهاء ضياء مرتضي مجتبي
`);

const ARABIC_FEMALE = words(`
  مريم ياسمين ايمان هند ريم شيماء اسماء اسراء دعاء رحاب عبير نسرين نرمين شيرين ميرفت سمر سحر
  امل هديل روان جني ملك هاجر نهال منار اماني مني هدي سلمي ليلي نجلاء رشا رنا دينا رانيا نادين
  انجي مي ميار جيهان نيفين سوزان زينب سعاد وفاء صفاء هناء ثناء سناء لمياء علياء نهي رضوي يارا
  لبني شهد تسنيم نوران مها دنيا ندي سلوي نجوي بشري يسرا شروق مارينا ماري نانسي كريستين ساندرا
  مارتينا فيرونيكا ايريني دميانه مرفت ابتسام ايناس الهام سهام وداد نعمات هيام منال امال اميره
  عزه علا اسيل جودي رهف لارا لمار سيلين كارما ريتاج
`);

// A name both men and women carry in Egypt. The photo might settle it; the name alone never does.
const ARABIC_SHARED = words(`نور علاء رجاء شمس صباح فرح`);

const LATIN_MALE = latin(`
  mohamed mohammed muhammad mohammad mohamad mo7amed ahmed ahmad mahmoud mahmood mostafa mustafa moustafa
  ali omar amr karim kareem khaled khalid hassan hasan hussein hossam ibrahim ismail youssef yousef
  yousif joseph yehia yahia yahya zakaria zakariya reda redaa taha hamza osama usama talha ziad zeyad
  mina mena beshoy bishoy gerges george michael mikel peter bola paula youhanna abanoub kirollos kerolos
  mark marc milad moussa mousa issa eissa shady shadi ramy rami hany hani samy sami fady fadi magdy
  magdi hamdy hamdi fathy fathi sherif ashraf tarek tarik wael tamer hesham hisham adel sameh maged
  mazen yassin yasin anas adam moaz belal bilal seif saif mohanad essam emad ehab islam ayman gamal
  kamal salah saeed said nasser mansour mamdouh mohsen raafat atef hazem hatem basem bassem nabil nader
  walid waleed ramez abdo sayed hossam assem yasser shawky fawzy ramadan shaaban osman ammar ezz ezzat
  medhat haitham haytham hady yousry rashad rushdy farid morad mourad saber sabry gaber abdelrahman
  abdallah abdullah abdalla bahaa diaa akram samir sameer kamel kamal khalil aboud ehab hamada
`);

const LATIN_FEMALE = latin(`
  mariam maryam meriam yasmin yasmine yasmeen eman iman hend hind reem shaimaa shimaa asmaa esraa israa
  doaa rehab abeer nesreen nisreen nermeen nermin shereen sherine shirin mervat samar sahar amal hadeel
  rawan jana malak hagar hager nihal nehal manar amany amani mona mouna hoda huda salma laila layla
  leila nagla rasha rana dina rania nadine engy inji mai may mayar gihan nevine nivin suzan zeinab
  zainab soad wafaa safaa hanaa sanaa lamiaa nouran noha radwa yara lobna shahd tasneem maha donia
  dunia nada salwa nagwa boshra yousra yosra shrouk marina mary nancy christine sandra martina veronica
  irene sara sarah heba ola aya alyaa aliaa nourhan menna menna rahma fatma fatima khadija aisha
  aya amira ameera aziza basma ghada hala hana hanan heba lamia lina lana maram marwa mirna nermine
  rofaida rokaya roqaya samah samira shahenda shorouk soha somaya sondos taghreed walaa yomna
  elham ilham nadia nada isra
`);

const LATIN_SHARED = latin(`nour noor alaa alae shams farah ragaa regaa ragaa sabah`);

// Endings are a weaker sign than the list; these men end like women.
const ARABIC_MALE_ENDINGS_EXCEPTIONS = ARABIC_MALE;
const LATIN_A_ENDING_MEN = latin(`
  mostafa mustafa moustafa reda redaa zakaria zakariya yehia yahia yahya hamza osama usama taha talha
  mina mena bola paula youhanna moussa mousa issa eissa bahaa diaa abdalla attia salama
`);

const FEMALE_TITLES = /^(?:ام|um|umm|om|mrs|miss|ms|mme|madam|دكتوره|الدكتوره|استاذه|الاستاذه|مدام|انسه|الانسه)$/;
const MALE_TITLES = /^(?:ابو|abo|abu|abou|mr|دكتور|الدكتور|استاذ|الاستاذ|المهندس|مهندس|الحاج|حاج|haj|hag)$/;
// Titles that say nothing about gender: skip them and read the next word.
const NEUTRAL_TITLES = /^(?:د|dr|doctor|eng|ph|م|ا|أ|cap|captain|كابتن|prof)$/;

const tokensOf = (rawName = "") =>
  text(rawName)
    .normalize("NFKC")
    // Letters only: emojis, digits, dots and underscores all split words ("om_yousef", "ahmed.tours").
    .split(/[^\p{L}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

const isArabicWord = (token = "") => /\p{Script=Arabic}/u.test(token);

const classifyFirstName = (token = "") => {
  if (isArabicWord(token)) {
    const word = normalizeArabic(token);
    if (ARABIC_SHARED.has(word)) return { gender: "unknown", reason: `shared name ${token}` };
    if (ARABIC_MALE.has(word) || word.startsWith("عبد") || word.endsWith("الله")) return { gender: "male", reason: `male name ${token}` };
    if (ARABIC_FEMALE.has(word)) return { gender: "female", reason: `female name ${token}` };
    if (word.length >= 3 && word.endsWith("ه") && !ARABIC_MALE_ENDINGS_EXCEPTIONS.has(word)) {
      return { gender: "female", reason: `ends in ة: ${token}` };
    }
    if (word.length >= 3 && (word.endsWith("ا") || word.endsWith("اء")) && !ARABIC_MALE_ENDINGS_EXCEPTIONS.has(word)) {
      return { gender: "female", reason: `ends in ا/اء: ${token}` };
    }
    return { gender: "unknown", reason: `no sign in ${token}` };
  }
  const word = token.toLowerCase();
  if (word.length < 3) return { gender: "unknown", reason: `too short: ${token}` };
  if (LATIN_SHARED.has(word)) return { gender: "unknown", reason: `shared name ${token}` };
  if (LATIN_MALE.has(word) || /^abd(?:el|al|ul)?[a-z]+/.test(word)) return { gender: "male", reason: `male name ${token}` };
  if (LATIN_FEMALE.has(word)) return { gender: "female", reason: `female name ${token}` };
  // A name-length word only: "nadakalabala" is a username, and its ending says nothing.
  if (word.length <= 8 && /(?:a|aa|ah)$/.test(word) && !LATIN_A_ENDING_MEN.has(word)) return { gender: "female", reason: `ends in -a: ${token}` };
  return { gender: "unknown", reason: `no sign in ${token}` };
};

/**
 * @returns {{ gender: "male"|"female"|"unknown", reason: string }}
 */
export const inferCustomerGender = (rawName = "") => {
  const tokens = tokensOf(rawName);
  if (!tokens.length) return { gender: "unknown", reason: "no name" };
  for (let index = 0; index < Math.min(tokens.length, 3); index += 1) {
    const token = tokens[index];
    const key = isArabicWord(token) ? normalizeArabic(token) : token.toLowerCase();
    if (FEMALE_TITLES.test(key)) return { gender: "female", reason: `title ${token}` };
    if (MALE_TITLES.test(key)) return { gender: "male", reason: `title ${token}` };
    if (NEUTRAL_TITLES.test(key)) continue;
    // The first real word is the first name; whatever it says (even "unknown") is the answer.
    return classifyFirstName(token);
  }
  return { gender: "unknown", reason: "titles only" };
};

/** A staff override ("male"/"female"/"unknown") wins over the name. */
export const resolveCustomerGender = ({ name = "", override = "" } = {}) => {
  const forced = text(override).toLowerCase();
  if (CUSTOMER_GENDERS.includes(forced)) return { gender: forced, reason: "set by staff" };
  return inferCustomerGender(name);
};

/*
 * Templates in the brain were written to a man ("تحب أحجزهولك؟", "أهلاً بيك"). For a woman the
 * same sentence goes out in the feminine. Only words that are clearly said TO the customer are on
 * this list; a word the shop says about itself is left alone. Men and unknown customers get the
 * template exactly as written.
 */
const FEMININE_FORMS = [
  ["تحب", "تحبي"], ["تحبه", "تحبيه"], ["تحبها", "تحبيها"], ["تحبهم", "تحبيهم"], ["تحبش", "تحبيش"],
  ["عايز", "عايزة"], ["عاوز", "عاوزة"], ["حابب", "حابة"], ["محتاج", "محتاجة"],
  ["بيك", "بيكي"], ["ليك", "ليكي"], ["عليك", "عليكي"], ["معاك", "معاكي"],
  ["انت", "انتي"], ["إنت", "إنتي"], ["أنت", "أنتي"],
  ["تقدر", "تقدري"], ["تعرف", "تعرفي"], ["تفضل", "تفضلي"], ["تختار", "تختاري"], ["تشوف", "تشوفي"],
  ["تطلب", "تطلبي"], ["تجرب", "تجربي"], ["تلبس", "تلبسي"], ["تكمل", "تكملي"], ["تحجز", "تحجزي"],
  ["تبعت", "تبعتي"], ["تبعتلي", "تبعتيلي"], ["تبعتلنا", "تبعتيلنا"], ["تستلم", "تستلمي"],
  ["تدفع", "تدفعي"], ["تحتاج", "تحتاجي"], ["تأكد", "تأكدي"], ["اتأكد", "اتأكدي"],
  ["ابعت", "ابعتي"], ["ابعتلي", "ابعتيلي"], ["ابعتلنا", "ابعتيلنا"], ["اختار", "اختاري"],
  ["قولي", "قوليلي"], ["قوللي", "قوليلي"], ["نورت", "نورتي"], ["منور", "منورة"],
  ["حبيبي", "حبيبتي"], ["يا باشا", "يا فندم"], ["يا معلم", "يا فندم"], ["يا برنس", "يا فندم"],
  ["يا أستاذ", "يا أستاذة"],
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FEMININE_PATTERNS = FEMININE_FORMS.map(([masculine, feminine]) => [
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(masculine)}(?![\\p{L}\\p{N}])`, "gu"),
  feminine,
]);

export const genderizeReply = (reply = "", gender = "unknown") => {
  const value = String(reply ?? "");
  if (gender !== "female" || !value) return value;
  return FEMININE_PATTERNS.reduce((acc, [pattern, feminine]) => acc.replace(pattern, feminine), value);
};

/** The same, applied to every customer-facing text field of a brain decision. */
export const genderizeDecision = (decision = {}, gender = "unknown") => {
  if (gender !== "female" || !decision || typeof decision !== "object") return decision;
  const swap = (value) => (typeof value === "string" ? genderizeReply(value, gender) : value);
  return {
    ...decision,
    text: swap(decision.text),
    answer: swap(decision.answer),
    ...(decision.channel_reply && typeof decision.channel_reply === "object"
      ? { channel_reply: { ...decision.channel_reply, text: swap(decision.channel_reply.text) } }
      : {}),
    ...(Array.isArray(decision.reply_parts) ? { reply_parts: decision.reply_parts.map(swap) } : {}),
  };
};

/*
 * What the reply writer (the model) is told. It never decides the gender itself — the same rule
 * GENI's prompt opens with.
 */
export const addressRulesFor = (gender = "unknown") => {
  const head = "نوع العميل محسوب قبل كده ومكتوب هنا. متستنتجوش من الاسم ولا تغيّره أبدًا.";
  if (gender === "male") {
    return [
      head,
      "العميل راجل: كل فعل وضمير بصيغة المذكر (حابب، عايز، تحب، تختار، بيك، معاك).",
      "ممكن تقول «يا أستاذ» + اسمه من تاني رد، و«يا فندم» / «حضرتك» تنفع برضه.",
    ];
  }
  if (gender === "female") {
    return [
      head,
      "العميلة ست: كل فعل وضمير بصيغة المؤنث (حابة، عايزة، تحبي، تختاري، بيكي، معاكي).",
      "ممكن تقول «يا أستاذة» + اسمها من تاني رد، و«يا فندم» / «حضرتك» تنفع برضه.",
    ];
  }
  return [
    head,
    "نوع العميل مش معروف: ممنوع «أستاذ» أو «أستاذة»، وممنوع تلزق لقب بالاسم.",
    "استخدم «حضرتك» و«يا فندم» بس، ومتصرّفش فعل على العميل — اتكلم من ناحيتك («أحجزهولك؟»، «أبعتلك الصور؟»، «ممكن أعرض على حضرتك؟»).",
    "ممنوع أي كلمة بتبيّن النوع: لا «متأكد/متأكدة»، ولا «عايز/عايزة»، ولا «تحب/تحبي»، ولا «عندك/معاك» من غير «حضرتك».",
    "بدل «لو حضرتك مش متأكد» اكتب «لو فيه أي تردد». بدل «لو عندك موديل في بالك» اكتب «لو فيه موديل معين في بال حضرتك». بدل «تحب أحجزهولك؟» اكتب «أحجزهولك؟».",
  ];
};
