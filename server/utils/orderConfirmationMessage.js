const clean = (value = "") => String(value ?? "").trim();

const shortenConfirmationLink = (value = "") => {
  const link = clean(value);
  if (!link) return "";

  const extractCode = (input = "") => {
    const match = String(input).match(/(?:\/shop\/confirm\/|\/confirm\/|\/c\/)([^/?#]+)/i);
    return match?.[1] ? String(match[1]).trim() : "";
  };

  try {
    const parsed = new URL(link, "https://example.com");
    const code = extractCode(parsed.pathname);
    if (!code) return link;
    if (link.startsWith("/")) return `/c/${encodeURIComponent(code)}`;
    return `${parsed.origin}/c/${encodeURIComponent(code)}`;
  } catch {
    const code = extractCode(link);
    return code ? `/c/${encodeURIComponent(code)}` : link;
  }
};

export const buildCodOrderConfirmationMessage = ({ customerName = "عميلنا", confirmationLink = "" } = {}) => {
  const name = clean(customerName) || "عميلنا";
  const link = shortenConfirmationLink(confirmationLink);

  return `أهلاً يا ${name}

طلبك جاهز للتأكيد
اختار الإجراء المناسب:
✅ تأكيد الطلب
✏️ تعديل الطلب
❌ إلغاء الطلب

${link}

بعد التأكيد هنبدأ تجهيز الطلب للشحن
شكراً لاختيارك M1 Store ❤️`;
};
