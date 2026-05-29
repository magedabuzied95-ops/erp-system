import { memo, useEffect, useState } from "react";

import { subscribeRealtimeFeedbackEvents } from "../../services/realtimeFeedbackService";

const glowClass = {
  critical: "ring-2 ring-rose-400/70 shadow-[0_0_34px_rgba(244,63,94,0.34)] animate-[realtime-critical-shake_520ms_ease-out]",
  high: "ring-2 ring-amber-300/55 shadow-[0_0_28px_rgba(251,191,36,0.26)]",
  normal: "ring-1 ring-cyan-300/35 shadow-[0_0_18px_rgba(34,211,238,0.14)]",
  silent: "",
};

export const RealtimeGlowWrapper = memo(function RealtimeGlowWrapper({
  children,
  channel = "",
  className = "",
}) {
  const [pulse, setPulse] = useState(null);

  useEffect(() => {
    let timer = null;
    const unsubscribe = subscribeRealtimeFeedbackEvents((event) => {
      if (channel && event?.payload?.category && String(event.payload.category) !== channel) return;
      if (event?.reducedMotion || event?.priority === "silent") return;
      setPulse(event.priority || "normal");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPulse(null), event.priority === "critical" ? 1000 : 720);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [channel]);

  return (
    <div className={`${className} transition-[box-shadow,ring-color,transform] duration-300 motion-reduce:transition-none ${pulse ? glowClass[pulse] || glowClass.normal : ""}`}>
      {children}
    </div>
  );
});

export default RealtimeGlowWrapper;
