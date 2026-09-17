const WEEKDAYS = {
  ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

const DEFAULT_RULES = {
  late_threshold_minutes: 30,
  late_penalty_days: 0.5,
  monthly_late_permissions: 2,
  late_permission_max_minutes: 120,
  absence_penalty_days: 2,
  monthly_paid_leave_days: 3,
  forbidden_leave_weekdays: [4, 5, 6],
};

const joinList = (items, isArabic) => {
  if (items.length <= 1) return items.join("");
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(isArabic ? " و" : ", ")}${isArabic ? " و" : " and "}${last}`;
};

const daysLabel = (days, isArabic) => {
  const value = Number(days) || 0;
  if (!isArabic) return value === 0.5 ? "half a day" : value === 1 ? "one day" : `${value} days`;
  if (value === 0.5) return "نص يوم";
  if (value === 0.25) return "ربع يوم";
  if (value === 1) return "يوم";
  if (value === 2) return "يومين";
  return `${value} أيام`;
};

const durationLabel = (minutes, isArabic) => {
  const value = Number(minutes) || 0;
  if (!isArabic) return value % 60 === 0 ? `${value / 60} hour${value === 60 ? "" : "s"}` : `${value} minutes`;
  if (value === 30) return "نص ساعة";
  if (value === 60) return "ساعة";
  if (value === 120) return "ساعتين";
  if (value % 60 === 0) return `${value / 60} ساعات`;
  return `${value} دقيقة`;
};

export const buildAttendanceRules = (policy, isArabic) => {
  const rules = { ...DEFAULT_RULES, ...(policy?.rules || {}) };
  const balances = policy?.balances || null;
  const blocked = joinList(
    (rules.forbidden_leave_weekdays || []).map((day) => WEEKDAYS[isArabic ? "ar" : "en"][Number(day)]).filter(Boolean),
    isArabic
  );
  const grace = durationLabel(rules.late_threshold_minutes, isArabic);
  const permissionCap = durationLabel(rules.late_permission_max_minutes, isArabic);

  if (isArabic) {
    return {
      rights: [
        {
          text: `${rules.monthly_paid_leave_days} أيام إجازة مدفوعة كل شهر.`,
          balance: balances ? `باقيلك ${balances.paid_leave_left} من ${balances.paid_leave_total}` : "",
        },
        {
          text: `${rules.monthly_late_permissions} إذن تأخير كل شهر، والإذن الواحد يغطي لحد ${permissionCap}.`,
          balance: balances ? `باقيلك ${balances.late_permissions_left} من ${balances.late_permissions_total}` : "",
        },
        { text: `سماحية ${grace} بعد ميعاد ورديتك (12 الظهر أو 3 العصر) من غير أي خصم.` },
        { text: "تشوف حضورك وخصوماتك ومرتبك أول بأول من البوابة." },
        { text: "تطلب سلفة أو إجازة أو إذن من البوابة، والمدير بيرد عليك." },
        { text: "لو شايف خصم غلط، اكتب للإدارة من «كلم الإدارة» وهي تراجعه." },
        { text: "عمولتك ونقطك ومكافآتك بتبان لك في البوابة." },
      ],
      duties: [
        { text: "سجّل حضورك من البوابة أول ما توصل، وانصرافك قبل ما تمشي." },
        { text: "الميعاد 12 الظهر أو 3 العصر حسب ورديتك." },
        { text: `التأخير أكتر من ${grace} يتخصم عليه ${daysLabel(rules.late_penalty_days, true)}.` },
        { text: "اطلب إذن التأخير من البوابة قبل ميعادك، مش بعد ما تتأخر." },
        { text: "اللي بيفتح الفرع الساعة 12 ممنوع ياخد إذن تأخير نهائيًا." },
        { text: `الغياب من غير إجازة متوافق عليها يتخصم عليه ${daysLabel(rules.absence_penalty_days, true)}.` },
        ...(blocked ? [{ text: `مفيش إجازات أيام ${blocked}.` }] : []),
        { text: "اطلب الإجازة بدري، وماتعتبرهاش موافق عليها غير لما المدير يوافق." },
        { text: "ماتقفلش الوردية غير لما تسلّمها للي بعدك." },
        { text: "الالتزام بالزي والتعامل باحترام مع العميل وزمايلك." },
      ],
    };
  }

  return {
    rights: [
      {
        text: `${rules.monthly_paid_leave_days} paid leave days every month.`,
        balance: balances ? `${balances.paid_leave_left} of ${balances.paid_leave_total} left` : "",
      },
      {
        text: `${rules.monthly_late_permissions} late permissions every month, each covering up to ${permissionCap}.`,
        balance: balances ? `${balances.late_permissions_left} of ${balances.late_permissions_total} left` : "",
      },
      { text: `A ${grace} grace period after your shift start (12 PM or 3 PM), with no deduction.` },
      { text: "See your attendance, deductions and salary in the portal as they happen." },
      { text: "Ask for an advance, leave or permission from the portal and get the manager's answer." },
      { text: "If a deduction looks wrong, write to management from “Talk to management” for a review." },
      { text: "Your commission, points and rewards show in the portal." },
    ],
    duties: [
      { text: "Check in from the portal when you arrive and check out before you leave." },
      { text: "Your shift starts at 12 PM or 3 PM, as scheduled." },
      { text: `Arriving more than ${grace} late costs ${daysLabel(rules.late_penalty_days, false)}.` },
      { text: "Ask for a late permission before your shift starts, not after you are late." },
      { text: "Whoever opens the branch at 12 PM may never take a late permission." },
      { text: `A day off without approved leave costs ${daysLabel(rules.absence_penalty_days, false)}.` },
      ...(blocked ? [{ text: `No leave on ${blocked}.` }] : []),
      { text: "Ask for leave early, and count it only once the manager approves." },
      { text: "Do not close your shift before handing it over to the next person." },
      { text: "Wear the uniform and treat customers and colleagues with respect." },
    ],
  };
};

