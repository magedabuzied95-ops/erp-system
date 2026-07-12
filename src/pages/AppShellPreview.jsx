import { useState } from "react";
import {
  Bell, Box, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign,
  Gauge, Home, Languages, Menu, Moon, PackagePlus, Search, Settings,
  ShoppingBag, ShoppingCart, Sun, Truck, Users, Warehouse, X,
} from "lucide-react";
import { useTheme } from "../theme/useTheme";
import "./AppShellPreview.css";

const groups = [
  { title: "الرئيسية", items: [[Home, "لوحة التحكم", true], [Bell, "الإشعارات"]] },
  { title: "المبيعات", items: [[ShoppingBag, "نقطة البيع"], [ShoppingCart, "الطلبات"], [Users, "العملاء"]] },
  { title: "المنتجات والمخزون", items: [[Box, "المنتجات"], [PackagePlus, "إضافة منتج"], [Warehouse, "المخزون"], [Truck, "المخازن والتحويلات"]] },
  { title: "الإدارة", items: [[CircleDollarSign, "المالية والمحاسبة"], [Gauge, "التقارير والتحليلات"], [Settings, "إعدادات النظام"]] },
];

const metrics = [["مبيعات اليوم", "34,850 ج.م", "+12.4%"], ["الطلبات", "34", "+8.2%"], ["متوسط الطلب", "1,025 ج.م", "+3.1%"], ["مخزون منخفض", "12", "يحتاج متابعة"]];

export default function AppShellPreview() {
  const { theme, setTheme, density, setDensity } = useTheme();
  const [language, setLanguage] = useState("ar");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({ الرئيسية:true, المبيعات:true, "المنتجات والمخزون":true, الإدارة:true });
  const rtl = language === "ar";
  const dark = theme.mode === "dark";
  const CollapseIcon = rtl ? ChevronRight : ChevronLeft;

  const sidebar = (
    <aside className={`shell-sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="shell-brand"><span>M1</span>{!collapsed && <div><strong>M1 Store</strong><small>Workspace</small></div>}<button className="mobile-close" onClick={()=>setMobileOpen(false)} aria-label="إغلاق"><X size={18}/></button></div>
      {!collapsed && <div className="shell-search"><Search size={16}/><span>ابحث في النظام...</span><kbd>⌘ K</kbd></div>}
      <nav className="shell-nav">
        {groups.map(group => <section key={group.title}><button className="group-toggle" onClick={()=>setOpenGroups(v=>({...v,[group.title]:!v[group.title]}))}>{collapsed ? <i/> : <><span>{group.title}</span><ChevronDown size={13} className={openGroups[group.title]?"open":""}/></>}</button><div className={`group-items ${openGroups[group.title]||collapsed?"open":""}`}>{group.items.map(([Icon,label,active])=><button title={collapsed?label:undefined} className={active?"active":""} key={label}><Icon size={17}/>{!collapsed&&<span>{label}</span>}{label==="الإشعارات"&&!collapsed&&<b>3</b>}</button>)}</div></section>)}
      </nav>
      <div className="shell-user"><div className="user-avatar">م</div>{!collapsed&&<div><strong>ماجد أبو زيد</strong><small>مدير النظام</small></div>}</div>
      <button className="collapse-button" onClick={()=>setCollapsed(!collapsed)}><CollapseIcon size={16}/>{!collapsed&&<span>طي القائمة</span>}</button>
    </aside>
  );

  return <div className="shell-preview m1-page" dir={rtl?"rtl":"ltr"} data-language={language}>
    {sidebar}{mobileOpen&&<button className="shell-scrim" onClick={()=>setMobileOpen(false)} aria-label="إغلاق القائمة"/>}
    <div className="shell-stage">
      <header className="shell-topbar"><button className="mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><div className="topbar-search"><Search size={16}/><span>{rtl?"بحث سريع عن طلب، منتج أو عميل...":"Search orders, products, or customers..."}</span></div><div className="topbar-actions"><button onClick={()=>setDensity(density==="compact"?"normal":"compact")} title="الكثافة"><Gauge size={17}/></button><button onClick={()=>setLanguage(rtl?"en":"ar")}><Languages size={17}/><span>{rtl?"EN":"AR"}</span></button><button onClick={()=>setTheme(dark?"light":"dark")}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button><button className="notification"><Bell size={18}/><b>3</b></button><div className="system-live"><i/>النظام متصل</div></div></header>
      <main className="shell-content">
        <div className="shell-breadcrumb"><span>الرئيسية</span><b>/</b><strong>لوحة التحكم</strong></div>
        <section className="shell-pagehead"><div><span>مركز التحكم التنفيذي</span><h1>صباح الخير، ماجد</h1><p>إليك ملخص أداء M1 Store اليوم</p></div><div><button className="m1-action-secondary">تصدير التقرير</button><button className="m1-action-primary">عملية بيع جديدة</button></div></section>
        <section className="shell-metrics">{metrics.map((m,i)=><article key={m[0]} className={i===0?"primary-metric":""}><p>{m[0]}</p><strong>{m[1]}</strong><span className={i<3?"positive":"warning"}>{m[2]}</span></article>)}</section>
        <section className="shell-workspace"><article className="m1-surface shell-chart"><div className="panel-heading"><div><h2>أداء المبيعات</h2><p>الإيرادات والطلبات خلال آخر 7 أيام</p></div><button className="m1-action-secondary">آخر 7 أيام <ChevronDown size={14}/></button></div><div className="fake-chart"><div className="chart-grid"/><div className="chart-area"/></div></article><article className="m1-surface shell-activity"><div className="panel-heading"><div><h2>آخر النشاطات</h2><p>تحديث مباشر</p></div></div>{[["عملية بيع جديدة","2,450 ج.م","gold"],["تحديث مخزون","24 قطعة","green"],["طلب بانتظار التجهيز","INV-2840","neutral"]].map(x=><div className="activity-row" key={x[0]}><i className={x[2]}/><p><strong>{x[0]}</strong><span>{x[1]}</span></p><time>منذ دقائق</time></div>)}</article></section>
      </main>
    </div>
  </div>;
}
