import { useState } from "react";
import { Filter, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  Button, IconButton, Input, Textarea, Select, Checkbox, Radio, Switch, SearchInput,
  Card, StatusBadge, Modal, Drawer, Tabs, TabPanel, PageHeader, Toolbar, ToolbarGroup,
  ToolbarSpacer, FilterBar,
} from "../shared/ui";

// Phase 2A proving ground. This is a contract showcase, not decoration: every
// canonical primitive appears here in its representative states so the contract
// can be reviewed in light/dark, LTR/RTL and both densities using the toggles in
// the ComponentsPreview topbar. No production business logic.
export default function ComponentsPreviewPrimitives() {
  const [tab, setTab] = useState("all");
  const [drawer, setDrawer] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState("نايك");
  const [notify, setNotify] = useState(true);
  const [channel, setChannel] = useState("pos");

  return (
    <div className="components-preview__grid components-preview__grid--full">
      <Card title="PageHeader / Toolbar / FilterBar" subtitle="عناصر تركيبية تلتف بأمان على الشاشات الصغيرة.">
        <PageHeader
          title="المنتجات"
          description="إدارة الكتالوج والمخزون عبر الفروع."
          breadcrumbs={<span>الرئيسية / المنتجات</span>}
          actions={<><Button variant="primary" icon={Plus}>منتج جديد</Button><Button variant="outline">تصدير</Button></>}
        />
        <Toolbar>
          <ToolbarGroup><SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="ابحث بالاسم أو الباركود" /></ToolbarGroup>
          <ToolbarSpacer />
          <ToolbarGroup><IconButton icon={Filter} label="تصفية" /><IconButton icon={Pencil} label="تعديل" /><IconButton icon={Trash2} label="حذف" variant="danger" /></ToolbarGroup>
        </Toolbar>
        <FilterBar actions={<Button variant="ghost" icon={RotateCcw}>إعادة تعيين</Button>}>
          <Select label="الفرع" defaultValue="cairo"><option value="cairo">القاهرة</option><option value="giza">الجيزة</option></Select>
          <Select label="الحالة" defaultValue="active"><option value="active">نشط</option><option value="archived">مؤرشف</option></Select>
          <Input label="أقل سعر" type="number" placeholder="0" />
        </FilterBar>
      </Card>

      <Card title="Button / IconButton" subtitle="خمسة أنماط، ثلاثة مقاسات، مع حالات التحميل والتعطيل.">
        <div className="components-preview__button-row">
          <Button variant="primary">أساسي</Button>
          <Button>ثانوي</Button>
          <Button variant="outline">محدّد</Button>
          <Button variant="ghost">هادئ</Button>
          <Button variant="danger">حذف</Button>
        </div>
        <div className="components-preview__button-row">
          <Button size="sm">صغير</Button>
          <Button size="md">متوسط</Button>
          <Button size="lg">كبير</Button>
          <Button loading>جاري الحفظ</Button>
          <Button disabled>معطّل</Button>
          <Button variant="primary" icon={Plus} iconAfter={Pencil}>أيقونتان</Button>
        </div>
        <div className="components-preview__button-row">
          <IconButton icon={Plus} label="إضافة" size="sm" />
          <IconButton icon={Pencil} label="تعديل" />
          <IconButton icon={Trash2} label="حذف" variant="danger" size="lg" />
          <IconButton icon={Filter} label="تصفية" variant="outline" disabled />
        </div>
      </Card>

      <Card title="حقول النماذج" subtitle="عناصر أصلية مع ربط صحيح بين التسمية والنص المساعد وحالة الخطأ.">
        <div className="components-preview__fields">
          <Input label="اسم المنتج" placeholder="مثال: حذاء رياضي" hint="الاسم كما يظهر للعميل" />
          <Input label="الباركود" defaultValue="6221" error="هذا الباركود مستخدم بالفعل" />
          <Input label="غير متاح" placeholder="معطّل" disabled />
          <Select label="القناة" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="pos">نقطة البيع</option>
            <option value="web">المتجر الإلكتروني</option>
          </Select>
          <Textarea label="الوصف" placeholder="وصف اختياري للمنتج" />
          <Textarea label="ملاحظات" defaultValue="نص غير صالح" invalid error="الوصف طويل جدًا" />
        </div>
        <div className="components-preview__button-row">
          <Checkbox label="متاح للبيع" defaultChecked />
          <Checkbox label="مميز" />
          <Checkbox label="معطّل" disabled />
          <Radio name="preview-grade" label="درجة أولى" defaultChecked />
          <Radio name="preview-grade" label="درجة ثانية" />
          <Switch label="إشعارات المخزون" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <Switch label="معطّل" disabled />
        </div>
      </Card>

      <Card title="Tabs / Badge" subtitle="التبويبات لا تملك الحالة — تُمرَّر من الصفحة أو من التوجيه.">
        <Tabs
          ariaLabel="تصفية الطلبات"
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "الكل", panelId: "panel-all" },
            { value: "open", label: "مفتوحة", panelId: "panel-open" },
            { value: "closed", label: "مغلقة", panelId: "panel-closed", disabled: true },
          ]}
        />
        <TabPanel id="panel-all" tabValue="all" active={tab === "all"}>كل الطلبات.</TabPanel>
        <TabPanel id="panel-open" tabValue="open" active={tab === "open"}>الطلبات المفتوحة فقط.</TabPanel>
        <div className="components-preview__statuses">
          <StatusBadge>محايد</StatusBadge>
          <StatusBadge tone="primary">أساسي</StatusBadge>
          <StatusBadge tone="success">نجاح</StatusBadge>
          <StatusBadge tone="warning">تحذير</StatusBadge>
          <StatusBadge tone="danger">خطر</StatusBadge>
          <StatusBadge tone="info">معلومة</StatusBadge>
        </div>
      </Card>

      <Card title="Modal / Drawer" subtitle="يُغلقان بمفتاح Escape وبالنقر على الخلفية فقط. الاتجاه منطقي (start/end).">
        <div className="components-preview__button-row">
          <Button onClick={() => setConfirm(true)}>فتح مودال</Button>
          <Button onClick={() => setDrawer("end")}>درج (end)</Button>
          <Button onClick={() => setDrawer("start")}>درج (start)</Button>
        </div>
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="تأكيد الحذف"
        description="مثال فقط — غير متصل بأي عملية."
        footer={<><Button onClick={() => setConfirm(false)}>إلغاء</Button><Button variant="danger" onClick={() => setConfirm(false)}>حذف</Button></>}
      >
        هل تريد حذف هذا العنصر؟
      </Modal>

      <Drawer
        open={Boolean(drawer)}
        placement={drawer || "end"}
        onClose={() => setDrawer(null)}
        title="تفاصيل المنتج"
        description={`الاتجاه: ${drawer || ""}`}
        footer={<Button variant="primary" onClick={() => setDrawer(null)}>تم</Button>}
      >
        <div className="components-preview__fields">
          <Input label="الاسم" defaultValue="حذاء رياضي" />
          <Textarea label="ملاحظات" />
        </div>
      </Drawer>
    </div>
  );
}
