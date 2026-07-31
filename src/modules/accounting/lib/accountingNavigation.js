export const getAccountingNavigation = (isArabic = true) => [
  { to: "/accounting", label: isArabic ? "لوحة الحسابات" : "Overview", end: true },
  { to: "/accounting/treasury", label: isArabic ? "الخزينة" : "Treasury" },
  { to: "/accounting/financial-accounts", label: isArabic ? "الحسابات المالية" : "Financial accounts" },
  { to: "/accounting/payment-method-mappings", label: isArabic ? "ربط طرق الدفع" : "Payment routing" },
  { to: "/accounting/journal-entries", label: isArabic ? "القيود اليومية" : "Journal entries" },
  { to: "/accounting/accounts", label: isArabic ? "دليل الحسابات" : "Chart of accounts" },
  { to: "/accounting/general-ledger", label: isArabic ? "دفتر الأستاذ" : "General ledger" },
  { to: "/accounting/trial-balance", label: isArabic ? "ميزان المراجعة" : "Trial balance" },
  { to: "/accounting/reports", label: isArabic ? "التقارير التنفيذية" : "Executive reports" },
  { to: "/accounting/profit-loss", label: isArabic ? "الأرباح والخسائر" : "Profit & loss" },
  { to: "/accounting/cost-fix", label: isArabic ? "مراجعة التكلفة" : "Cost review" },
  { to: "/accounting/audit-trail", label: isArabic ? "سجل التدقيق" : "Audit trail" },
];
