import { memo } from "react";
import { UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export const StaffActivityCard = memo(function StaffActivityCard({ metrics, posLive = {}, events = [] }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar");
  const copy = {
    title: isArabic ? "نشاط الموظفين" : "Staff Activity",
    checkedIn: isArabic ? "الحاضرون" : "Checked in",
    openShifts: isArabic ? "الورديات المفتوحة" : "Open shifts",
    taskEvents: isArabic ? "أحداث المهام" : "Task events",
    urgentTasks: isArabic ? "المهام العاجلة" : "Urgent tasks",
  };
  const taskEvents = events.filter((event) => event.category === "staff_tasks");
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><UserCheck className="h-4 w-4 text-violet-300" />{copy.title}</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={copy.checkedIn} value={metrics.checkedInStaff} />
        <Stat label={copy.openShifts} value={(posLive.openShifts || []).length} />
        <Stat label={copy.taskEvents} value={taskEvents.length} />
        <Stat label={copy.urgentTasks} value={taskEvents.filter((item) => item.priority !== "normal").length} />
      </div>
    </section>
  );
});

function Stat({ label, value }) {
  return <div className="rounded-xl bg-white/[0.035] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div><div className="mt-1 text-lg font-black text-white">{Number(value || 0).toLocaleString()}</div></div>;
}

export default StaffActivityCard;
