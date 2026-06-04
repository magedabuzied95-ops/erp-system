import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";

const dateLabel = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const money = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(amount);
};

const requestTabs = [
  { id: "vacation", type: "vacation", labelEn: "Vacation Requests", labelAr: "طلبات الإجازات" },
  { id: "advance", type: "advance", labelEn: "Advance Requests", labelAr: "طلبات السلف" },
  { id: "hr_note", type: "hr_note", labelEn: "HR Notes / HR Requests", labelAr: "ملاحظات وطلبات الموارد البشرية" },
];

export default function HRRequestsWorkspace() {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [activeTab, setActiveTab] = useState("vacation");
  const [portalRequests, setPortalRequests] = useState([]);
  const [portalRequestsLoading, setPortalRequestsLoading] = useState(false);
  const [portalRequestReviewing, setPortalRequestReviewing] = useState("");
  const [portalRequestNotes, setPortalRequestNotes] = useState({});
  const [autoCreateAdvance, setAutoCreateAdvance] = useState(true);

  const loadPortalRequests = async () => {
    try {
      setPortalRequestsLoading(true);
      const response = await api.get("/employees/portal-requests");
      setPortalRequests(response.requests || []);
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر تحميل طلبات الموارد البشرية." : "Unable to load HR requests."));
    } finally {
      setPortalRequestsLoading(false);
    }
  };

  useEffect(() => {
    void loadPortalRequests();
  }, []);

  const filteredRequests = useMemo(
    () => portalRequests.filter((request) => String(request.request_type || "").toLowerCase() === activeTab),
    [activeTab, portalRequests]
  );

  const pendingCount = useMemo(
    () => filteredRequests.filter((request) => String(request.status || "").toLowerCase() === "pending").length,
    [filteredRequests]
  );

  const reviewPortalRequest = async (requestId, status) => {
    try {
      setPortalRequestReviewing(`${requestId}:${status}`);
      const request = portalRequests.find((item) => String(item.id) === String(requestId)) || {};
      const response = await api.patch(`/employees/portal-requests/${requestId}`, {
        status,
        admin_note: portalRequestNotes[requestId] || "",
        create_advance: status === "approved" && request.request_type === "advance" && autoCreateAdvance,
      });
      if (response.request) {
        setPortalRequests((current) => current.map((item) => (String(item.id) === String(requestId) ? { ...item, ...response.request } : item)));
      }
      toast.success(
        status === "approved"
          ? (isArabic ? "تمت الموافقة على الطلب." : "Request approved.")
          : (isArabic ? "تم رفض الطلب." : "Request rejected.")
      );
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر تحديث الطلب." : "Unable to update employee request."));
    } finally {
      setPortalRequestReviewing("");
    }
  };

  return (
    <div className="space-y-4">
      <section className="theme-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className={isArabic ? "text-[11px] font-black text-[var(--muted)]" : "text-[11px] font-black uppercase tracking-[0.18em] text-[var(--muted)]"}>
              {isArabic ? "طلبات الموارد البشرية" : "HR Requests"}
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              {isArabic ? "طلبات الموظفين من البوابة" : "Employee requests from the portal"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              {isArabic
                ? "اعتمد أو ارفض طلبات الإجازات والسلف وملاحظات الموارد البشرية مع بقاء كل طلب مرتبطاً بالموظف."
                : "Review vacation requests, advance requests, and HR notes while keeping every request tied to the employee profile."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-black text-[var(--muted)]">
              <input type="checkbox" checked={autoCreateAdvance} onChange={(event) => setAutoCreateAdvance(event.target.checked)} />
              {isArabic ? "إنشاء سلفة عند الموافقة" : "Create advance on approval"}
            </label>
            <button type="button" onClick={loadPortalRequests} disabled={portalRequestsLoading} className="theme-button-soft h-11 justify-center px-4 text-sm disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${portalRequestsLoading ? "animate-spin" : ""}`} />
              {isArabic ? "تحديث" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {requestTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-black transition",
                  active
                    ? "border-[var(--border)] bg-[var(--primary-soft)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--text)]",
                ].join(" ")}
              >
                <span>{isArabic ? tab.labelAr : tab.labelEn}</span>
                {active && pendingCount ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] text-white">{pendingCount}</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="theme-card p-4">
        {filteredRequests.length ? (
          <div className="grid gap-2">
            {filteredRequests.map((request) => {
              const status = String(request.status || "pending").toLowerCase();
              const canReview = status === "pending";
              return (
                <article key={request.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(220px,0.7fr)] xl:items-start">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-black text-[var(--primary)]">
                          {isArabic ? requestTabs.find((tab) => tab.id === activeTab)?.labelAr : requestTabs.find((tab) => tab.id === activeTab)?.labelEn}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-black ${status === "approved" ? "bg-emerald-500/15 text-emerald-200" : status === "rejected" ? "bg-rose-500/15 text-rose-200" : "bg-amber-500/15 text-amber-100"}`}>
                          {status === "approved" ? (isArabic ? "موافق عليه" : "Approved") : status === "rejected" ? (isArabic ? "مرفوض" : "Rejected") : (isArabic ? "قيد المراجعة" : "Pending")}
                        </span>
                      </div>
                      <h4 className="mt-2 text-base font-black leading-6" dir="auto">{request.employee_name || (isArabic ? "موظف" : "Employee")}</h4>
                      <div className="mt-1 text-xs font-bold text-[var(--muted)]" dir="auto">
                        {request.employee_code || "-"} {request.branch_name ? `- ${request.branch_name}` : ""}
                      </div>
                    </div>

                    <div className="grid gap-1.5 text-xs font-bold text-[var(--muted)] sm:grid-cols-2 xl:grid-cols-1">
                      <div>{isArabic ? "تاريخ الإنشاء" : "Created at"}: <span dir="ltr">{dateLabel(request.created_at)}</span></div>
                      <div>{isArabic ? "الفرع" : "Branch"}: <span dir="auto">{request.branch_name || "-"}</span></div>
                      <div>{isArabic ? "الحالة" : "Status"}: {status}</div>
                      {request.amount ? <div>{isArabic ? "المبلغ" : "Amount"}: <span dir="ltr">{money(request.amount)}</span></div> : null}
                      {request.request_date ? <div>{isArabic ? "تاريخ الطلب" : "Request date"}: <span dir="ltr">{dateLabel(request.request_date)}</span></div> : null}
                      {request.end_date ? <div>{isArabic ? "تاريخ النهاية" : "End date"}: <span dir="ltr">{dateLabel(request.end_date)}</span></div> : null}
                      {request.message ? <div className="sm:col-span-2 xl:col-span-1" dir="auto">{isArabic ? "الرسالة" : "Message"}: {request.message}</div> : null}
                      {request.admin_note ? <div className="sm:col-span-2 xl:col-span-1 text-emerald-200" dir="auto">{isArabic ? "ملاحظة الإدارة" : "Admin note"}: {request.admin_note}</div> : null}
                    </div>

                    <div className="grid gap-2">
                      <textarea
                        value={portalRequestNotes[request.id] || ""}
                        onChange={(event) => setPortalRequestNotes((prev) => ({ ...prev, [request.id]: event.target.value }))}
                        placeholder={isArabic ? "ملاحظة الرد" : "Response note"}
                        disabled={!canReview}
                        className="min-h-20 rounded-2xl border border-[var(--border)] bg-black/10 px-3 py-2 text-sm font-bold outline-none disabled:opacity-60"
                        dir="auto"
                      />
                      <div className="grid gap-2 md:grid-cols-2">
                        <button type="button" onClick={() => reviewPortalRequest(request.id, "approved")} disabled={!canReview || Boolean(portalRequestReviewing)} className="theme-button-primary h-10 justify-center px-3 text-sm disabled:opacity-60">
                          <CheckCircle2 className="h-4 w-4" />
                          {isArabic ? "موافقة" : "Approve"}
                        </button>
                        <button type="button" onClick={() => reviewPortalRequest(request.id, "rejected")} disabled={!canReview || Boolean(portalRequestReviewing)} className="theme-button-soft h-10 justify-center px-3 text-sm disabled:opacity-60">
                          <X className="h-4 w-4" />
                          {isArabic ? "رفض" : "Reject"}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm font-semibold text-[var(--muted)]">
            {portalRequestsLoading
              ? (isArabic ? "جاري تحميل الطلبات..." : "Loading requests...")
              : (isArabic ? "لا توجد طلبات في هذا القسم." : "No requests in this section.")}
          </div>
        )}
      </section>
    </div>
  );
}
