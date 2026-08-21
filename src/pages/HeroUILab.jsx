/* ============================================================================
   HeroUI v3 — TRIAL PAGE (route: /heroui-lab)
   ----------------------------------------------------------------------------
   Throwaway evaluation surface. It is NOT wired into the sidebar, NOT part of
   the M1 design system, and imports nothing from src/theme.

   The point of this page is to answer two questions with the real library
   instead of with documentation:
     1. Does HeroUI v3 behave correctly in Arabic RTL? (toggle top-right)
     2. What does adopting it cost us next to M1? (see heroui-lab.css)

   Everything renders inside `.heroui-lab`, which also carries HeroUI's own
   `light`/`dark` theme class. HeroUI scopes its entire token set to those
   classes, so the palette here is HeroUI's, container-scoped, and M1's tokens
   on <html> are left untouched.

   To delete this trial:  rm src/pages/HeroUILab.jsx src/pages/heroui-lab.css
                          drop the /heroui-lab route from src/App.jsx
                          npm uninstall @heroui/react
   ========================================================================== */
import { useState } from "react";
import { I18nProvider } from "@react-aria/i18n";
import {
  Alert,
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  Pagination,
  Select,
  Switch,
  Table,
  Tabs,
  TextField,
} from "@heroui/react";

import "./heroui-lab.css";

const ORDERS = [
  { id: "INV-10482", customer: "أحمد محمود", total: "1,250.00", state: "مدفوع" },
  { id: "INV-10483", customer: "سارة عبد الله", total: "480.50", state: "آجل" },
  { id: "INV-10484", customer: "محمد إبراهيم", total: "2,190.00", state: "مدفوع" },
  { id: "INV-10485", customer: "نورهان سيد", total: "75.00", state: "مرتجع" },
];

const BRANCHES = [
  { id: "main", label: "الفرع الرئيسي" },
  { id: "nasr", label: "فرع مدينة نصر" },
  { id: "alex", label: "فرع الإسكندرية" },
];

function Section({ title, note, children }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 className="text-base font-semibold mb-1">{title}</h2>
      {note ? <p className="text-sm text-muted mb-3">{note}</p> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default function HeroUILab() {
  const [dir, setDir] = useState("rtl");
  const [scheme, setScheme] = useState("light");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [notify, setNotify] = useState(true);

  const locale = dir === "rtl" ? "ar-EG" : "en-US";

  return (
    <I18nProvider locale={locale}>
      {/* The theme class must sit on an ANCESTOR of whatever paints with the
          tokens. Painting on the same element that declares them leaves the
          inline var() resolved against the previous theme when the class
          flips — the variables update, the background does not. */}
      <div dir={dir} lang={dir === "rtl" ? "ar" : "en"} className={`heroui-lab ${scheme}`}>
      <div
        style={{
          minHeight: "100vh",
          padding: "2rem",
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "inherit",
        }}
      >
        {/* ---- lab controls (plain HTML on purpose: never under test) ---- */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "1.5rem",
            paddingBottom: "1rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <strong style={{ marginInlineEnd: "auto" }}>HeroUI v3 — معمل تجربة</strong>
          <button type="button" onClick={() => setDir(dir === "rtl" ? "ltr" : "rtl")}>
            الاتجاه: {dir.toUpperCase()}
          </button>
          <button
            type="button"
            onClick={() => setScheme(scheme === "light" ? "dark" : "light")}
          >
            الثيم: {scheme}
          </button>
        </div>

        <Section title="الأزرار" note="أشكال ومقاسات مختلفة">
          <Button variant="primary">حفظ الفاتورة</Button>
          <Button variant="secondary">مسودة</Button>
          <Button variant="tertiary">إلغاء</Button>
          <Button variant="danger">حذف</Button>
          <Button variant="primary" size="sm">
            صغير
          </Button>
          <Button variant="primary" isDisabled>
            معطّل
          </Button>
        </Section>

        <Section title="الكروت">
          <Card style={{ maxWidth: 360 }}>
            <Card.Header>
              <Card.Title>ملخص المبيعات</Card.Title>
              <Card.Description>آخر تحديث من دقيقتين</Card.Description>
            </Card.Header>
            <Card.Content>
              <p className="text-sm">
                إجمالي مبيعات اليوم <strong>12,480.00</strong> جنيه من 37 فاتورة.
              </p>
            </Card.Content>
            <Card.Footer>
              <Button variant="secondary" size="sm">
                فتح التقرير
              </Button>
            </Card.Footer>
          </Card>
        </Section>

        <Section title="حقول الإدخال" note="لاحظ مكان الليبل وعلامة الاتجاه">
          <TextField value={name} onChange={setName} style={{ maxWidth: 320 }}>
            <Label>اسم العميل</Label>
            <Input placeholder="اكتب اسم العميل" />
            <Description>الاسم كما سيظهر على الفاتورة</Description>
          </TextField>

          <Select
            selectedKey={branch}
            onSelectionChange={(key) => setBranch(String(key))}
            style={{ maxWidth: 260 }}
          >
            <Label>الفرع</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {BRANCHES.map((b) => (
                  <ListBox.Item key={b.id} id={b.id}>
                    {b.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </Section>

        <Section title="مفاتيح التبديل">
          <Switch isSelected={notify} onChange={setNotify}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
            <Label>إرسال إشعار واتساب للعميل</Label>
          </Switch>
        </Section>

        <Section title="الوسوم والتنبيهات">
          <Chip>مدفوع</Chip>
          <Chip variant="secondary">آجل</Chip>
          <Alert style={{ maxWidth: 480 }}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>المخزون منخفض</Alert.Title>
              <Alert.Description>3 أصناف وصلت لحد إعادة الطلب.</Alert.Description>
            </Alert.Content>
          </Alert>
        </Section>

        <Section
          title="الجدول"
          note="أهم اختبار: زوايا الجدول وأسهم الترتيب هي المكان المعروف بمشاكل RTL"
        >
          <div style={{ width: "100%", maxWidth: 720 }}>
            <Table>
              <Table.Content aria-label="فواتير المبيعات">
                <Table.Header>
                  <Table.Column isRowHeader>رقم الفاتورة</Table.Column>
                  <Table.Column>العميل</Table.Column>
                  <Table.Column>الإجمالي</Table.Column>
                  <Table.Column>الحالة</Table.Column>
                </Table.Header>
                <Table.Body>
                  {ORDERS.map((o) => (
                    <Table.Row key={o.id} id={o.id}>
                      <Table.Cell>{o.id}</Table.Cell>
                      <Table.Cell>{o.customer}</Table.Cell>
                      <Table.Cell>{o.total}</Table.Cell>
                      <Table.Cell>{o.state}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table>
          </div>
        </Section>

        {/* GitHub issue #6445 names Pagination chevrons + table corners as the
            two RTL offenders. Both are exercised above/here on purpose. */}
        <Section title="ترقيم الصفحات" note="الأسهم لازم تنعكس مع الاتجاه">
          <Pagination>
            <Pagination.Summary>صفحة 2 من 9</Pagination.Summary>
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous>
                  <Pagination.PreviousIcon />
                </Pagination.Previous>
              </Pagination.Item>
              <Pagination.Item>
                <Pagination.Link>1</Pagination.Link>
              </Pagination.Item>
              <Pagination.Item>
                <Pagination.Link data-current>2</Pagination.Link>
              </Pagination.Item>
              <Pagination.Item>
                <Pagination.Link>3</Pagination.Link>
              </Pagination.Item>
              <Pagination.Item>
                <Pagination.Ellipsis />
              </Pagination.Item>
              <Pagination.Item>
                <Pagination.Next>
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </Section>

        <Section title="التبويبات">
          <div style={{ width: "100%", maxWidth: 560 }}>
            <Tabs defaultSelectedKey="sales">
              <Tabs.List aria-label="أقسام">
                <Tabs.Tab id="sales">المبيعات</Tabs.Tab>
                <Tabs.Tab id="stock">المخزون</Tabs.Tab>
                <Tabs.Tab id="returns">المرتجعات</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel id="sales">محتوى تبويب المبيعات.</Tabs.Panel>
              <Tabs.Panel id="stock">محتوى تبويب المخزون.</Tabs.Panel>
              <Tabs.Panel id="returns">محتوى تبويب المرتجعات.</Tabs.Panel>
            </Tabs>
          </div>
        </Section>

        <Section title="النوافذ المنبثقة">
          <Modal>
            <Modal.Trigger>
              <Button variant="primary">تأكيد الحذف</Button>
            </Modal.Trigger>
            <Modal.Backdrop>
              <Modal.Container>
                <Modal.Dialog>
                  <Modal.Header>
                    <Modal.Heading>تأكيد الحذف</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    هل أنت متأكد من حذف الفاتورة INV-10485؟ لا يمكن التراجع.
                  </Modal.Body>
                  <Modal.Footer>
                    <Modal.CloseTrigger>
                      <Button variant="secondary">رجوع</Button>
                    </Modal.CloseTrigger>
                    <Modal.CloseTrigger>
                      <Button variant="danger">حذف</Button>
                    </Modal.CloseTrigger>
                  </Modal.Footer>
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          </Modal>
        </Section>
      </div>
      </div>
    </I18nProvider>
  );
}
