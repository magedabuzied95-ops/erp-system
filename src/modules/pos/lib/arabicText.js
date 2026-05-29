export const POS_ARABIC_TEXT = {
  account: "الحساب",
  accountSelected: "الحساب المحدد",
  available: "المتاح",
  customerCreditHelp: "رصيد محفوظ للعميل من مرتجعات أو رصيد سابق",
  customerService: "خدمة العملاء",
  defaultVariant: "افتراضي",
  discounts: "الخصومات",
  earnedPoints: "النقاط المكتسبة",
  finalTotal: "الإجمالي النهائي",
  invoice: "رقم الفاتورة",
  invoiceNumber: "رقم الفاتورة",
  item: "المنتج",
  noItems: "لا توجد منتجات.",
  notEnoughCredit: "رصيد محفظة العميل غير كاف",
  notEnoughTreasuryBalance: "رصيد الحساب غير كاف",
  oneSize: "مقاس واحد",
  paymentMethod: "طريقة الدفع",
  product: "منتج",
  quantity: "الكمية",
  rateFacebook: "قيّمنا على فيسبوك",
  rateGoogle: "قيّمنا على جوجل",
  receiptTitle: "فاتورة بيع",
  remainingPoints: "المتبقية",
  required: "المطلوب",
  scanToView: "امسح لعرض الفاتورة",
  seller: "البائع",
  service: "الخدمة",
  serviceFee: "رسوم الخدمة",
  shortage: "العجز",
  sizeColor: "المقاس / اللون",
  subtotal: "المجموع الفرعي",
  thankYou: "شكراً لثقتكم بنا",
  total: "الإجمالي",
  totalQuantity: "إجمالي الكمية",
  transfer: "تحويل",
  usedPoints: "المستخدمة",
  wallet: "المحفظة",
  walletPaid: "المدفوع من المحفظة",
  walletRemaining: "المتبقي نقدي/بطاقة",
  walletBalanceAfter: "رصيد المحفظة بعد العملية",
  followInstagram: "تابعنا على إنستجرام",
};

const MOJIBAKE_PATTERN =
  /[ØÙÃÂâ]|(?:ط[±µ§¹­®¯£¥©¨¬؛؟])|(?:ظ[‚ƒ„…†‡ˆ‰‹ٹپچژکگںھہۃیې])/;

export const hasArabicMojibake = (value) =>
  MOJIBAKE_PATTERN.test(String(value ?? ""));

export const safeArabicText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  if (!text || hasArabicMojibake(text)) return fallback;
  return text;
};
