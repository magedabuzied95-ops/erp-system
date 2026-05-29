import { memo, useEffect, useState } from "react";

import { subscribeRealtimeFeedbackEvents } from "../../services/realtimeFeedbackService";

const moduleByCategory = {
  orders: "orders",
  payments: "orders",
  inventory: "inventory",
  attendance: "attendance",
  staff_tasks: "staff",
  system: "notifications",
};

export const SidebarPulseIndicator = memo(function SidebarPulseIndicator({ item, className = "" }) {
  const [priority, setPriority] = useState("");
  const path = String(item?.to || "").toLowerCase();

  useEffect(() => {
    let timer = null;
    const unsubscribe = subscribeRealtimeFeedbackEvents((event) => {
      if (event?.reducedMotion || event?.priority === "silent") return;
      const category = String(event?.payload?.category || "").toLowerCase();
      const moduleKey = moduleByCategory[category] || "";
      if (!moduleKey || !path.includes(moduleKey)) return;
      setPriority(event.priority || "normal");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPriority(""), 1800);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [path]);

  if (!priority) return null;
  const color = priority === "critical" ? "bg-rose-400" : priority === "high" ? "bg-amber-300" : "bg-cyan-300";
  return (
    <span className={`ml-auto h-2 w-2 rounded-full ${color} shadow-[0_0_16px_currentColor] animate-[realtime-pulse_1.3s_ease-out_infinite] motion-reduce:animate-none ${className}`} />
  );
});

export default SidebarPulseIndicator;
