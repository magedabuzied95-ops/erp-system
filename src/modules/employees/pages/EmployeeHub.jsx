import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BadgeDollarSign,
  BarChart3,
  CalendarClock,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageCircle,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import usePermission from "../../permissions/hooks/usePermission";

const AttendanceCenter = lazy(() => import("../../attendance/components/AttendanceCenter"));
const AttendanceWorkspace = lazy(() => import("../../attendance/components/AttendanceWorkspace"));
const Expenses = lazy(() => import("../../accounting/pages/Expenses"));
const SalesEmployees = lazy(() => import("../../sales/pages/SalesEmployees"));
const EmployeeAnalyticsWorkspace = lazy(() => import("../components/EmployeeAnalyticsWorkspace"));
const EmployeeChatInbox = lazy(() => import("./EmployeeChatInbox"));
const HRRequestsWorkspace = lazy(() => import("../components/HRRequestsWorkspace"));
const StaffTasks = lazy(() => import("./StaffTasks"));

const tabDefinitions = [
  { id: "overview", labelKey: "overview", icon: LayoutDashboard },
  { id: "employees", labelKey: "employees", icon: UsersRound },
  { id: "attendance", labelKey: "attendance", icon: CalendarClock },
  { id: "payroll", labelKey: "payroll", icon: BadgeDollarSign },
  { id: "tasks", labelKey: "tasks", icon: ClipboardList },
  { id: "requests", labelKey: "requests", icon: ClipboardList },
  { id: "advances", labelKey: "advances", icon: WalletCards },
  { id: "chat", labelKey: "chat", icon: MessageCircle },
  { id: "analytics", labelKey: "analytics", icon: BarChart3 },
  { id: "reports", labelKey: "reports", icon: FileText },
];

const validTabs = new Set(tabDefinitions.map((tab) => tab.id));
const legacyTabRedirects = {
  commissions: "analytics",
  "top-performers": "analytics",
  "sales-performance": "analytics",
  shifts: "attendance",
};

class WorkspaceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (typeof this.props.onError === "function") this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div className="theme-card p-5 text-sm font-bold text-[var(--muted)]">مساحة العمل غير متاحة.</div>;
    }
    return this.props.children;
  }
}

export default function EmployeeHub() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const isRtl = String(i18n.language || "").toLowerCase().startsWith("ar");
  const direction = isRtl ? "rtl" : "ltr";
  const canViewStaffTasks = usePermission("staff_tasks.view");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const handleSelectedEmployeeChange = useCallback((employee) => {
    console.count("[hr-loop] onSelectedEmployeeChange");
    setSelectedEmployee(employee);
  }, []);
  const payrollVisibleTabs = useMemo(() => ["payroll", "penalties"], []);
  const advancesVisibleTabs = useMemo(() => ["advances", "approvals", "reports"], []);
  const visibleTabDefinitions = useMemo(
    () => tabDefinitions.filter((tab) => tab.id !== "tasks" || canViewStaffTasks),
    [canViewStaffTasks]
  );
  const tabs = useMemo(
    () => visibleTabDefinitions.map((tab) => ({
      ...tab,
      label: t(
        `common.employeeHub.tabs.${tab.labelKey}`,
        tab.id === "analytics"
          ? t("common.analytics", "Analytics")
          : tab.id === "tasks"
            ? (isRtl ? "المهام" : "Tasks")
            : tab.labelKey
      ),
    })),
    [isRtl, t, visibleTabDefinitions]
  );
  const activeTab = validTabs.has(params.tab) ? params.tab : "overview";
  const selectedEmployeeId = String(selectedEmployee?.id || selectedEmployee?.employee_id || "");
  useEffect(() => {
    console.log("[hr-loop]", "employee_hub_selection", {
      employee_id: selectedEmployeeId,
      selectedEmployeeId,
      editingEmployeeId: "",
    });
  }, [selectedEmployeeId]);
  if (legacyTabRedirects[params.tab]) {
    return <Navigate to={`/employees/${legacyTabRedirects[params.tab]}`} replace />;
  }

  const activeMeta = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  return (
    <div className="space-y-5" dir={direction}>
      <section className="theme-card p-5">
        <div className="flex flex-col gap-2">
          <div>
            <p className={isRtl ? "text-[11px] font-black leading-5 text-[var(--muted)]" : "text-[11px] font-black uppercase tracking-[0.22em] text-[var(--muted)]"}>{t("common.employeeHub.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text)]">{t("common.employeeHub.title")}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              {t("common.employeeHub.subtitle")}
            </p>
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.id}
                to={`/employees/${tab.id}`}
                className={({ isActive }) =>
                  [
                    "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-black transition",
                    isActive || activeTab === tab.id
                      ? "border-[var(--border)] bg-[var(--primary-soft)] text-[var(--text)]"
                      : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card)] hover:text-[var(--text)]",
                  ].join(" ")
                }
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </section>

      {activeTab === "overview" ? <EmployeeOverview onSelectTab={(tab) => navigate(`/employees/${tab}`)} t={t} isRtl={isRtl} /> : null}
      <Suspense fallback={<div className="theme-card p-5 text-sm font-bold text-[var(--muted)]">{t("common.loading", "Loading...")}</div>}>
        {activeTab === "employees" ? <HREmployeesWorkspace selectedEmployeeId={selectedEmployeeId} onSelectedEmployeeChange={handleSelectedEmployeeChange} /> : null}
        {activeTab === "attendance" ? <AttendanceCenter /> : null}
        {activeTab === "payroll" ? (
          <WorkspaceErrorBoundary
            fallback={<div className="theme-card p-5 text-sm font-bold text-[var(--muted)]">تعذر تحميل مساحة الرواتب. يرجى تحديث الصفحة.</div>}
            onError={(error) => console.error("[employee-hub-payroll-boundary]", error)}
          >
            <SalesEmployees defaultTab="payroll" visibleTabs={payrollVisibleTabs} embedded />
          </WorkspaceErrorBoundary>
        ) : null}
        {activeTab === "tasks" ? (
          canViewStaffTasks ? (
            <WorkspaceErrorBoundary
              fallback={<div className="theme-card p-5 text-sm font-bold text-[var(--muted)]">تعذر تحميل مهام الموظفين. يرجى تحديث الصفحة.</div>}
              onError={(error) => console.error("[employee-hub-staff-tasks-boundary]", error)}
            >
              <StaffTasks />
            </WorkspaceErrorBoundary>
          ) : (
            <div className="theme-card p-5 text-sm font-bold text-[var(--muted)]">
              {isRtl ? "ليس لديك صلاحية عرض إدارة المهام." : "You do not have permission to view task management."}
            </div>
          )
        ) : null}
        {activeTab === "requests" ? <HRRequestsWorkspace /> : null}
        {activeTab === "advances" ? <Expenses defaultTab="advances" visibleTabs={advancesVisibleTabs} embedded /> : null}
        {activeTab === "chat" ? <EmployeeChatInbox selectedEmployee={selectedEmployee} selectedEmployeeId={selectedEmployeeId} onSelectedEmployeeChange={handleSelectedEmployeeChange} /> : null}
        {activeTab === "analytics" ? <EmployeeAnalyticsWorkspace embedded /> : null}
      </Suspense>
      {activeTab === "reports" ? <EmployeeReports onSelectTab={(tab) => navigate(`/employees/${tab}`)} t={t} isRtl={isRtl} /> : null}

      <div className="sr-only" aria-live="polite">
        {t("common.employeeHub.currentSection", { section: activeMeta.label })}
      </div>
    </div>
  );
}

function HREmployeesWorkspace({ selectedEmployeeId = "", onSelectedEmployeeChange = null }) {
  const { i18n } = useTranslation();
  const isRtl = String(i18n.language || "").toLowerCase().startsWith("ar");
  const employeeDirectoryVisibleTabs = useMemo(() => ["employees"], []);
  useEffect(() => {
    console.log("[hr-loop]", "employee_directory_props", {
      employee_id: String(selectedEmployeeId || ""),
      selectedEmployeeId: String(selectedEmployeeId || ""),
      editingEmployeeId: "",
    });
  }, [selectedEmployeeId]);
  return (
    <div className="space-y-4">
      <section className="theme-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">
              إدارة الموظفين
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              دليل الموظفين أولاً
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              {isRtl
                ? "أضف الموظفين وعدل بياناتهم من الدليل الرئيسي، ثم انتقل لإعدادات البائعين والعمولات عند الحاجة."
                : "أضف الموظفين وعدل بياناتهم من الدليل الرئيسي أولاً، ثم انتقل إلى إعدادات فريق المبيعات والعمولات عند الحاجة."}
            </p>
          </div>
        </div>
      </section>

      <AttendanceWorkspace defaultTab="employees" visibleTabs={employeeDirectoryVisibleTabs} embedded hideMetrics selectedEmployeeId={selectedEmployeeId} onSelectedEmployeeChange={onSelectedEmployeeChange} />
    </div>
  );
}

function EmployeeOverview({ onSelectTab, t, isRtl }) {
  const cards = [
    {
      tab: "employees",
      title: t("common.employeeHub.cards.employees.title"),
      text: t("common.employeeHub.cards.employees.text"),
      icon: UserRound,
    },
    {
      tab: "attendance",
      title: t("common.employeeHub.cards.attendance.title"),
      text: t("common.employeeHub.cards.attendance.text"),
      icon: CalendarClock,
    },
    {
      tab: "payroll",
      title: t("common.employeeHub.cards.payroll.title"),
      text: t("common.employeeHub.cards.payroll.text"),
      icon: BadgeDollarSign,
    },
    {
      tab: "requests",
      title: t("common.employeeHub.cards.requests.title", isRtl ? "طلبات الموارد البشرية" : "HR Requests"),
      text: t("common.employeeHub.cards.requests.text", isRtl ? "طلبات الإجازات والسلف وملاحظات الموارد البشرية المرتبطة بكل موظف." : "Vacation requests, advance requests, and HR notes linked to each employee."),
      icon: ClipboardList,
    },
    {
      tab: "advances",
      title: t("common.employeeHub.cards.advances.title"),
      text: t("common.employeeHub.cards.advances.text"),
      icon: WalletCards,
    },
    {
      tab: "chat",
      title: t("common.employeeHub.cards.chat.title", "شات الموظفين"),
      text: t("common.employeeHub.cards.chat.text", "متابعة رسائل الموظفين من بوابة الموظف والرد عليها من الإدارة."),
      icon: MessageCircle,
    },
    {
      tab: "analytics",
      title: t("common.employeeHub.cards.salesPerformance.title"),
      text: t("common.employeeHub.cards.salesPerformance.text"),
      icon: BarChart3,
    },
    {
      tab: "reports",
      title: t("common.employeeHub.cards.reports.title"),
      text: t("common.employeeHub.cards.reports.text"),
      icon: ClipboardList,
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <button
            key={card.tab}
            type="button"
            onClick={() => onSelectTab(card.tab)}
            className={`theme-card group min-h-[168px] p-5 transition hover:-translate-y-0.5 hover:border-[var(--primary)] ${isRtl ? "text-right" : "text-left"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-[var(--text)]">{card.title}</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{card.text}</p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function EmployeeReports({ onSelectTab, t, isRtl }) {
  const reports = [
    { tab: "payroll", label: t("common.employeeHub.reports.payroll.label"), description: t("common.employeeHub.reports.payroll.description") },
    { tab: "attendance", label: t("common.employeeHub.reports.attendance.label"), description: t("common.employeeHub.reports.attendance.description") },
    { tab: "analytics", label: t("common.employeeHub.reports.commission.label"), description: t("common.employeeHub.reports.commission.description") },
    { tab: "analytics", label: t("common.employeeHub.reports.performance.label"), description: t("common.employeeHub.reports.performance.description") },
  ];

  return (
    <section className="theme-card p-5">
      <div className="flex flex-col gap-2 border-b border-[var(--border)] pb-4">
        <h2 className="text-2xl font-black text-[var(--text)]">{t("common.employeeHub.reports.title")}</h2>
        <p className="text-sm leading-6 text-[var(--muted)]">{t("common.employeeHub.reports.subtitle")}</p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {reports.map((report) => (
          <button
            key={report.label}
            type="button"
            onClick={() => onSelectTab(report.tab)}
            className={`rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)] ${isRtl ? "text-right" : "text-left"}`}
          >
            <div className="text-base font-black text-[var(--text)]">{report.label}</div>
            <div className="mt-2 text-sm leading-6 text-[var(--muted)]">{report.description}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
