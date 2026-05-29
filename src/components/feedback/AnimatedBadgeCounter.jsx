import { memo, useEffect, useRef, useState } from "react";

export const AnimatedBadgeCounter = memo(function AnimatedBadgeCounter({
  value = 0,
  max = 99,
  className = "",
  priority = "normal",
}) {
  const previous = useRef(value);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    if (Number(value || 0) <= Number(previous.current || 0)) {
      previous.current = value;
      return undefined;
    }
    previous.current = value;
    setBump(true);
    const timer = window.setTimeout(() => setBump(false), 520);
    return () => window.clearTimeout(timer);
  }, [value]);

  if (Number(value || 0) <= 0) return null;
  const display = Number(value) > max ? `${max}+` : value;
  const priorityClass = priority === "critical"
    ? "bg-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.65)]"
    : priority === "high"
      ? "bg-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.55)]"
      : "bg-rose-500";

  return (
    <span className={[
      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black text-white ring-2 ring-[var(--surface)] motion-reduce:animate-none",
      priorityClass,
      bump ? "animate-[realtime-badge-pop_520ms_ease-out]" : "",
      className,
    ].filter(Boolean).join(" ")}>
      {display}
    </span>
  );
});

export default AnimatedBadgeCounter;
