const clean = (value = "") => String(value ?? "").trim();

export const buildCodOrderConfirmationMessage = ({ customerName = "عميلنا", confirmationLink = "" } = {}) => {
  const name = clean(customerName) || "عميلنا";
  const link = clean(confirmationLink);

  return `أهلاً يا ${name}

طلبك جاهز للتأكيد

✅ تأكيد الطلب
✏️ تعديل الطلب
❌ إلغاء الطلب

اضغط على الرابط التالي لاختيار الإجراء المناسب:

${link}

بمجرد التأكيد سيبدأ فريقنا تجهيز الطلب للشحن.

⏳ الرابط صالح لفترة محدودة.

شكراً لاختيارك M1 Store ❤️`;
};
