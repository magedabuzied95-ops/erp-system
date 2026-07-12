import { useState } from "react";
import { Check, ChevronDown, Languages, Moon, Search, Sun, TriangleAlert, X } from "lucide-react";
import { useTheme } from "../theme/useTheme";
import "./ThemeFoundation.css";

const swatches = [
  ["Primary action", "--primary"], ["Success & stock", "--success"],
  ["Warning", "--warning"], ["Danger", "--danger"],
  ["Page canvas", "--bg"], ["Surface", "--surface"],
  ["Soft surface", "--surface-soft"], ["Border", "--border"],
];

const rows = [
  ["INV-2841", "أحمد سامح", "نقطة البيع", "2,450 ج.م", "مكتمل", "success"],
  ["INV-2840", "سارة محمد", "المتجر الإلكتروني", "1,890 ج.م", "قيد التجهيز", "warning"],
  ["INV-2838", "نور خالد", "المتجر الإلكتروني", "760 ج.م", "بانتظار الدفع", "neutral"],
];

export default function ThemeFoundation() {
  const { theme, setTheme, density, setDensity } = useTheme();
  const [language, setLanguage] = useState("ar");
  const isDark = theme.mode === "dark";
  const rtl = language === "ar";

  return (
    <div className="m1-page foundation" dir={rtl ? "rtl" : "ltr"} data-language={language}>
      <header className="foundation-topbar">
        <div className="foundation-brand"><span>M1</span><div><strong>M1 ERP Design Foundation</strong><small>Phase 1 · Tokens & themes</small></div></div>
        <div className="foundation-actions">
          <button className="m1-action-secondary" onClick={() => setDensity(density === "compact" ? "normal" : "compact")}>{density === "compact" ? "كثافة مريحة" : "كثافة مضغوطة"}</button>
          <button className="m1-action-secondary icon-action" onClick={() => setLanguage(rtl ? "en" : "ar")}><Languages size={17}/>{rtl ? "EN" : "AR"}</button>
          <button className="m1-action-primary icon-action" onClick={() => setTheme(isDark ? "light" : "dark")}>{isDark ? <Sun size={17}/> : <Moon size={17}/>} {isDark ? "Light" : "Dark"}</button>
        </div>
      </header>

      <main className="m1-container foundation-content">
        <section className="foundation-intro">
          <div><span className="foundation-eyebrow">M1 ERP · Design system</span><h1>{rtl ? "أساس واجهة موحّد لكل النظام" : "One interface foundation for the entire ERP"}</h1><p>{rtl ? "مرجع الألوان والخطوط والكثافة والمكوّنات قبل تطبيقها على الصفحات." : "Tokens, typography, density, and component behavior before page rollout."}</p></div>
          <div className="foundation-mode"><i/><span>{isDark ? "M1 Dark" : "M1 Light"}</span><small>{rtl ? "الوضع الحالي" : "Current mode"}</small></div>
        </section>

        <section className="foundation-section"><div className="section-title"><div><span>01</span><h2>Color tokens</h2></div><p>Semantic colors—not page-specific hex values.</p></div><div className="swatch-grid">{swatches.map(([label, token]) => <article className="m1-surface" key={token}><div className="swatch" style={{background:`var(${token})`}}/><strong>{label}</strong><code>{token}</code></article>)}</div></section>

        <section className="foundation-section"><div className="section-title"><div><span>02</span><h2>Typography & density</h2></div><p>Cairo for Arabic, Inter for English.</p></div><div className="type-grid"><article className="m1-surface type-sample"><small>العنوان الرئيسي · 28/700</small><h3>إدارة أعمالك بوضوح أكبر</h3><p>خط عربي واضح ومناسب للجداول والنماذج والشاشات كثيفة البيانات.</p></article><article className="m1-surface type-sample" dir="ltr"><small>Page title · 28/700</small><h3>Run operations with clarity</h3><p>Readable enterprise typography for dense tables, forms, and dashboards.</p></article></div></section>

        <section className="foundation-section"><div className="section-title"><div><span>03</span><h2>Controls & states</h2></div><p>Gold is for primary actions. Green is reserved for success and stock.</p></div><div className="control-grid"><article className="m1-surface control-card"><h3>Actions</h3><div className="control-row"><button className="m1-action-primary">حفظ التغييرات</button><button className="m1-action-secondary">إلغاء</button><button className="foundation-ghost">عرض التفاصيل</button></div></article><article className="m1-surface control-card"><h3>Fields</h3><label>اسم المنتج<div className="field"><Search size={16}/><input placeholder="ابحث عن منتج..."/></div></label><label>الفرع<div className="field"><span>الفرع الرئيسي</span><ChevronDown size={15}/></div></label></article><article className="m1-surface control-card"><h3>Status</h3><div className="status-stack"><span className="m1-status-success"><Check size={14}/> مكتمل</span><span className="m1-status-warning"><TriangleAlert size={14}/> يحتاج متابعة</span><span className="m1-status-danger"><X size={14}/> فشل</span><span className="m1-status-neutral">بانتظار المراجعة</span></div></article></div></section>

        <section className="foundation-section"><div className="section-title"><div><span>04</span><h2>Dense data table</h2></div><p>Compact, legible, RTL/LTR-safe rows.</p></div><div className="m1-surface table-demo"><table className="m1-data-table"><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>القناة</th><th>الإجمالي</th><th>الحالة</th></tr></thead><tbody>{rows.map(row=><tr key={row[0]}>{row.slice(0,4).map(cell=><td key={cell}>{cell}</td>)}<td><span className={`m1-status-${row[5]}`}>{row[4]}</span></td></tr>)}</tbody></table></div></section>
      </main>
    </div>
  );
}
