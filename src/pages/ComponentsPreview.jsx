import { useState } from "react";
import { Box, Check, FileText, Moon, Package, Plus, Search, ShoppingCart, Sun } from "lucide-react";
import { useTheme } from "../theme/useTheme";
import { Button, Card, DataTable, EmptyState, Field, LoadingState, MetricCard, Modal, Pagination, Skeleton, StatusBadge } from "../shared/ui";
import ComponentsPreviewPrimitives from "./ComponentsPreviewPrimitives";
import "./ComponentsPreview.css";

const rows = [
  { id: "INV-2841", customer: "أحمد سامح", channel: "نقطة البيع", total: "2,450 ج.م", status: "completed", time: "10:42 ص" },
  { id: "INV-2840", customer: "سارة محمد", channel: "المتجر الإلكتروني", total: "1,890 ج.م", status: "processing", time: "10:31 ص" },
  { id: "INV-2839", customer: "محمد علي", channel: "نقطة البيع", total: "3,120 ج.م", status: "completed", time: "10:08 ص" },
  { id: "INV-2838", customer: "نور خالد", channel: "المتجر الإلكتروني", total: "760 ج.م", status: "pending", time: "9:54 ص" },
];
const statusMap = { completed: <StatusBadge tone="success">مكتمل</StatusBadge>, processing: <StatusBadge tone="warning">قيد التجهيز</StatusBadge>, pending: <StatusBadge>بانتظار الدفع</StatusBadge> };
const columns = [
  { key: "id", label: "رقم الفاتورة" }, { key: "customer", label: "العميل" }, { key: "channel", label: "القناة" },
  { key: "total", label: "الإجمالي" }, { key: "status", label: "الحالة", render: (row) => statusMap[row.status] }, { key: "time", label: "الوقت" },
];

export default function ComponentsPreview() {
  const { theme, setTheme, density, setDensity } = useTheme();
  const [language, setLanguage] = useState("ar");
  const [modalOpen, setModalOpen] = useState(false);
  const dark = theme.mode === "dark";
  return <main className="components-preview m1-page" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="components-preview__topbar"><div><strong>M1 UI</strong><span>مكتبة مكونات النظام</span></div><div className="components-preview__tools"><Button size="sm" icon={dark ? Sun : Moon} onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? "فاتح" : "داكن"}</Button><Button size="sm" onClick={() => setLanguage(language === "ar" ? "en" : "ar")}>{language === "ar" ? "EN" : "عربي"}</Button><Button size="sm" onClick={() => setDensity(density === "compact" ? "normal" : "compact")}>{density === "compact" ? "مريح" : "مضغوط"}</Button></div></header>
    <div className="components-preview__content">
      <div className="components-preview__heading"><div><span>المرحلة الثالثة</span><h1>المكونات المشتركة</h1><p>أساس موحّد لكل صفحات ERP قبل بدء ترحيل الوحدات.</p></div><Button variant="primary" icon={Plus} onClick={() => setModalOpen(true)}>عملية بيع جديدة</Button></div>
      <section className="components-preview__metrics"><MetricCard tone="primary" label="إجمالي المبيعات" value="34,850 ج.م" change="+12.4% عن الفترة السابقة" icon={FileText} /><MetricCard label="الطلبات" value="34" change="+8.2%" icon={ShoppingCart} /><MetricCard tone="success" label="المخزون المتوفر" value="1,248" change="12 منتجًا منخفضًا" icon={Package} /><MetricCard label="متوسط الطلب" value="1,025 ج.م" change="+3.1%" icon={Box} /></section>
      <div className="components-preview__grid"><Card title="الأزرار والحالات" subtitle="الذهبي للإجراء الأساسي، والأخضر للنجاح والمخزون فقط."><div className="components-preview__button-row"><Button variant="primary" icon={Plus}>إجراء أساسي</Button><Button icon={FileText}>إجراء ثانوي</Button><Button variant="ghost">إجراء هادئ</Button><Button disabled>غير متاح</Button></div><div className="components-preview__statuses"><StatusBadge tone="success">مكتمل</StatusBadge><StatusBadge tone="warning">قيد المراجعة</StatusBadge><StatusBadge tone="danger">ملغي</StatusBadge><StatusBadge tone="info">معلومة</StatusBadge><StatusBadge>مسودة</StatusBadge></div></Card>
        <Card title="حقول الإدخال" subtitle="مقاسات ثابتة وحالات واضحة للنماذج كثيفة البيانات."><div className="components-preview__fields"><Field label="اسم العميل" placeholder="ابحث عن عميل..." /><Field as="select" label="الفرع" defaultValue="cairo"><option value="cairo">فرع القاهرة</option><option value="giza">فرع الجيزة</option></Field><Field label="كود المنتج" error="هذا الحقل مطلوب" placeholder="SKU-000" /></div></Card></div>
      <Card title="أحدث الطلبات" subtitle="جدول موحد قابل للاستخدام في المبيعات والمخزون والحسابات." action={<Button size="sm" icon={Search}>بحث وتصفية</Button>}><DataTable columns={columns} rows={rows} /><Pagination page={1} pages={6} /></Card>
      <div className="components-preview__grid components-preview__grid--three"><Card title="الحالة الفارغة"><EmptyState title="لا توجد طلبات" description="ستظهر الطلبات الجديدة هنا بمجرد تسجيل أول عملية بيع." action={<Button variant="primary" size="sm" icon={Plus}>إنشاء طلب</Button>} /></Card><Card title="حالة التحميل"><div className="components-preview__loading"><LoadingState /><Skeleton className="components-preview__skeleton-wide" /><Skeleton /><Skeleton className="components-preview__skeleton-short" /></div></Card><Card title="مبادئ الاستخدام"><ul className="components-preview__rules"><li><Check size={16} /> وضوح البيانات أهم من الزخرفة.</li><li><Check size={16} /> نفس السلوك في RTL وLTR.</li><li><Check size={16} /> استجابة كاملة لكل المقاسات.</li></ul></Card></div>
      <ComponentsPreviewPrimitives />
    </div>
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إنشاء عملية بيع" description="مثال للمودال الموحد دون توصيله بأي API."><div className="components-preview__modal-fields"><Field label="العميل" placeholder="اختر العميل" /><Field label="ملاحظات" placeholder="ملاحظات اختيارية" /></div><div className="components-preview__modal-actions"><Button onClick={() => setModalOpen(false)}>إلغاء</Button><Button variant="primary" onClick={() => setModalOpen(false)}>حفظ العملية</Button></div></Modal>
  </main>;
}
