// Evolution refuses a send to a number with no WhatsApp account with a 400 whose body is
// {"jid":"2011…@s.whatsapp.net","exists":false,"number":"2011…"} (INV-1625). That is a wrong
// or non-WhatsApp number the operator must fix with the customer, not a gateway outage.
export const isWhatsappNumberMissingError = (error) => {
  const haystack = [error?.message, error?.payload && JSON.stringify(error.payload), error?.responseBody && JSON.stringify(error.responseBody)]
    .filter(Boolean)
    .join(" ");
  return /"exists"\s*:\s*false/i.test(haystack);
};

export const WHATSAPP_NUMBER_MISSING_MESSAGE = "الرقم ده مش عليه واتساب، فالرسالة ماتبعتتش. اتأكد من رقم الواتساب مع العميل وعدّله في الأوردر، أو ضيفه كرقم تاني.";
