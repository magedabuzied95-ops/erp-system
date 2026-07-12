import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Bell, Box, ChevronDown,
  CircleDollarSign, Clock3, FileText, Gauge, Home, Languages, Menu,
  MoreHorizontal, PackageCheck, Plus, RefreshCw, Search, Settings,
  ShoppingBag, ShoppingCart, Sun, Moon, Truck, Users, WalletCards, X,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./DashboardPrototype.css";

const sales = [
  { day: "1 يوليو", revenue: 18500, orders: 18 }, { day: "2 يوليو", revenue: 22400, orders: 22 },
  { day: "3 يوليو", revenue: 19800, orders: 19 }, { day: "4 يوليو", revenue: 28600, orders: 29 },
  { day: "5 يوليو", revenue: 31200, orders: 31 }, { day: "6 يوليو", revenue: 27400, orders: 26 },
  { day: "اليوم", revenue: 34850, orders: 34 },
];

const orders = [
  { id: "INV-2841", customer: "أحمد سامح", channel: "نقطة البيع", total: "2,450 ج.م", status: "مكتمل", time: "10:42 ص" },
  { id: "INV-2840", customer: "سارة محمد", channel: "المتجر الإلكتروني", total: "1,890 ج.م", status: "قيد التجهيز", time: "10:31 ص" },
  { id: "INV-2839", customer: "محمد علي", channel: "نقطة البيع", total: "3,120 ج.م", status: "مكتمل", time: "10:08 ص" },
  { id: "INV-2838", customer: "نور خالد", channel: "المتجر الإلكتروني", total: "760 ج.م", status: "بانتظار الدفع", time: "9:54 ص" },
  { id: "INV-2837", customer: "كريم حسن", channel: "نقطة البيع", total: "1,340 ج.م", status: "مكتمل", time: "9:37 ص" },
];

const nav = [
  [Home, "لوحة التحكم", true], [ShoppingBag, "المبيعات"], [ShoppingCart, "الطلبات"],
  [Box, "المنتجات والمخزون"], [Truck, "المشتريات"], [Users, "العملاء والموظفون"],
  [WalletCards, "المالية"], [Gauge, "التقارير والتحليلات"],
];

export default function DashboardPrototype() {
  const [lang, setLang] = useState("ar");
  const [mobileNav, setMobileNav] = useState(false);
  const [range, setRange] = useState("آخر 7 أيام");
  const [dark, setDark] = useState(false);
  const rtl = lang === "ar";
  const metrics = useMemo(() => [
    { label: "إجمالي المبيعات", value: "34,850 ج.م", delta: "+12.4%", icon: CircleDollarSign, accent: true },
    { label: "الطلبات", value: "34", delta: "+8.2%", icon: ShoppingCart },
    { label: "متوسط قيمة الطلب", value: "1,025 ج.م", delta: "+3.1%", icon: FileText },
    { label: "منتجات منخفضة", value: "12", delta: "تحتاج متابعة", icon: AlertTriangle, warning: true },
  ], []);

  return (
    <div className={`m1p ${dark ? "is-dark" : ""}`} dir={rtl ? "rtl" : "ltr"}>
      <aside className={`m1p-sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="m1p-brand"><div className="m1p-mark">M1</div><div><strong>M1 Store</strong><span>مساحة العمل</span></div><button onClick={() => setMobileNav(false)} className="m1p-close"><X size={18}/></button></div>
        <div className="m1p-search"><Search size={17}/><span>ابحث في النظام</span><kbd>⌘ K</kbd></div>
        <nav>
          <p className="m1p-nav-label">الرئيسية</p>
          {nav.map(([Icon, label, active]) => <button className={active ? "active" : ""} key={label}><Icon size={18}/><span>{label}</span>{!active && <ChevronDown size={14}/>}</button>)}
        </nav>
        <div className="m1p-sidebar-bottom"><button><Settings size={18}/><span>الإعدادات</span></button><div className="m1p-user"><div className="m1p-avatar">م</div><div><strong>ماجد أبو زيد</strong><span>مدير النظام</span></div><MoreHorizontal size={18}/></div></div>
      </aside>

      {mobileNav && <button aria-label="إغلاق القائمة" className="m1p-scrim" onClick={() => setMobileNav(false)}/>} 
      <main className="m1p-main">
        <header className="m1p-topbar">
          <button className="m1p-menu" onClick={() => setMobileNav(true)}><Menu size={21}/></button>
          <div className="m1p-top-search"><Search size={17}/><span>بحث سريع عن طلب، منتج أو عميل...</span></div>
          <div className="m1p-top-actions"><button aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"} onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button onClick={() => setLang(lang === "ar" ? "en" : "ar")}><Languages size={18}/><span>{lang === "ar" ? "EN" : "AR"}</span></button><button className="m1p-bell"><Bell size={19}/><i>3</i></button><div className="m1p-status"><span/>النظام متصل</div></div>
        </header>

        <div className="m1p-content">
          <section className="m1p-pagehead">
            <div><p>مركز التحكم التنفيذي</p><h1>صباح الخير، ماجد</h1><span>إليك ملخص أداء M1 Store اليوم</span></div>
            <div className="m1p-head-actions"><button className="m1p-secondary"><RefreshCw size={16}/>تحديث</button><button className="m1p-primary"><Plus size={17}/>عملية بيع جديدة</button></div>
          </section>

          <section className="m1p-commandbar"><button className="active"><ShoppingCart size={16}/>نقطة البيع</button><button><PackageCheck size={16}/>إضافة منتج</button><button><Truck size={16}/>فاتورة شراء</button><span/><button className="m1p-filter">اليوم<ChevronDown size={14}/></button></section>

          <section className="m1p-metrics">
            {metrics.map((m) => <article key={m.label} className={`${m.accent ? "accent" : ""} ${m.warning ? "warning" : ""}`}><div className="m1p-metric-icon"><m.icon size={19}/></div><div><p>{m.label}</p><strong>{m.value}</strong><span>{m.delta}</span></div></article>)}
          </section>

          <section className="m1p-grid">
            <article className="m1p-panel m1p-chart-panel">
              <div className="m1p-panel-head"><div><h2>أداء المبيعات</h2><p>الإيرادات والطلبات خلال الفترة المحددة</p></div><select value={range} onChange={e => setRange(e.target.value)}><option>آخر 7 أيام</option><option>هذا الشهر</option><option>آخر 90 يومًا</option></select></div>
              <div className="m1p-chart-summary"><div><span>إجمالي الإيرادات</span><strong>182,750 ج.م</strong><small><ArrowUpRight size={13}/> 12.4% عن الفترة السابقة</small></div><div><span>إجمالي الطلبات</span><strong>179</strong></div></div>
              <div className="m1p-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={sales}><defs><linearGradient id="m1gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b48916" stopOpacity={0.22}/><stop offset="100%" stopColor="#b48916" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#eceae5" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:"#79766f",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"#79766f",fontSize:11}}/><Tooltip contentStyle={{borderRadius:8,border:"1px solid #dedbd3",fontFamily:"Cairo"}}/><Area type="monotone" dataKey="revenue" stroke="#9a7310" strokeWidth={2.3} fill="url(#m1gold)"/></AreaChart></ResponsiveContainer></div>
            </article>

            <aside className="m1p-sidecards">
              <article className="m1p-panel"><div className="m1p-panel-head"><div><h2>حالة المخزون</h2><p>نظرة سريعة على التوفر</p></div><button><MoreHorizontal size={18}/></button></div><div className="m1p-stock-ring"><div><strong>88%</strong><span>متوفر</span></div></div><ul className="m1p-legend"><li><i className="good"/>متوفر <strong>1,248</strong></li><li><i className="low"/>منخفض <strong>12</strong></li><li><i className="out"/>نفد <strong>4</strong></li></ul></article>
              <article className="m1p-panel m1p-activity"><div className="m1p-panel-head"><div><h2>آخر النشاطات</h2><p>تحديث مباشر</p></div><button>عرض الكل</button></div><div><i className="sale"><ArrowDownLeft size={15}/></i><p><strong>عملية بيع جديدة</strong><span>INV-2841 بقيمة 2,450 ج.م</span></p><time>منذ دقيقتين</time></div><div><i className="stock"><Box size={15}/></i><p><strong>تحديث مخزون</strong><span>تم استلام 24 قطعة</span></p><time>منذ 18 دقيقة</time></div><div><i className="order"><Clock3 size={15}/></i><p><strong>طلب بانتظار التجهيز</strong><span>الطلب INV-2840</span></p><time>منذ 31 دقيقة</time></div></article>
            </aside>
          </section>

          <section className="m1p-panel m1p-orders">
            <div className="m1p-panel-head"><div><h2>أحدث الطلبات</h2><p>آخر العمليات المسجلة عبر جميع قنوات البيع</p></div><button className="m1p-text-btn">عرض كل الطلبات <ArrowUpRight size={15}/></button></div>
            <div className="m1p-table-wrap"><table><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>القناة</th><th>الإجمالي</th><th>الحالة</th><th>الوقت</th><th/></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><strong>{o.id}</strong></td><td>{o.customer}</td><td>{o.channel}</td><td><strong>{o.total}</strong></td><td><span className={`m1p-badge ${o.status === "مكتمل" ? "done" : o.status === "قيد التجهيز" ? "progress" : "pending"}`}>{o.status}</span></td><td>{o.time}</td><td><button><MoreHorizontal size={17}/></button></td></tr>)}</tbody></table></div>
          </section>
        </div>
      </main>
    </div>
  );
}
