import { memo, useEffect, useMemo, useState } from "react";
import { Activity, Pause, Play, RefreshCcw, Trash2 } from "lucide-react";

import {
  ACTIVITY_FILTERS,
  ACTIVITY_PRIORITY_FILTERS,
} from "../../config/activityFeedConfig";
import useLiveActivityFeed from "../../hooks/useLiveActivityFeed";
import LiveActivityItem from "./LiveActivityItem";

export const LiveActivityFeed = memo(function LiveActivityFeed({ initialEvents = [], className = "" }) {
  const { items, loading, error, paused, setPaused, clear } = useLiveActivityFeed({ initialEvents });
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (priority !== "all" && item.priority !== priority) return false;
      return true;
    });
  }, [category, items, priority]);

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
            <Activity className="h-4 w-4" />
            Live Activity
            {paused ? <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-200">Paused</span> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Compact realtime stream for orders, POS, AI, inventory, attendance, and system events.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/[0.08] bg-white/[0.055] px-3 text-xs font-black text-zinc-100 transition hover:bg-white/[0.09]"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-rose-300/15 bg-rose-400/10 px-3 text-xs font-black text-rose-100 transition hover:bg-rose-400/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {ACTIVITY_FILTERS.map((filter) => (
          <FilterButton key={filter.id} active={category === filter.id} onClick={() => setCategory(filter.id)}>
            {filter.label}
          </FilterButton>
        ))}
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {ACTIVITY_PRIORITY_FILTERS.map((filter) => (
          <FilterButton key={filter.id} active={priority === filter.id} onClick={() => setPriority(filter.id)} compact>
            {filter.label}
          </FilterButton>
        ))}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100">
          {error}
        </div>
      ) : null}

      <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
        {loading && !items.length ? (
          <LoadingState />
        ) : filteredItems.length ? (
          filteredItems.map((item) => <LiveActivityItem key={`${item.dedupeKey}-${item.timestamp}`} item={item} now={now} />)
        ) : (
          <EmptyState paused={paused} />
        )}
      </div>
    </div>
  );
});

function FilterButton({ active, onClick, children, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 font-black transition focus:outline-none focus:ring-2 focus:ring-emerald-300/35 ${compact ? "py-1 text-[11px]" : "py-1.5 text-xs"} ${ active ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100 shadow-lg shadow-emerald-950/20" : "border-white/[0.08] bg-white/[0.035] text-zinc-400 hover:bg-white/[0.065] hover:text-zinc-100" }`}
    >
      {children}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2" aria-label="Loading activity">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-[var(--radius-card)] border border-white/[0.06] bg-white/[0.04] motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function EmptyState({ paused }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-white/[0.08] bg-white/[0.025] px-5 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] border border-white/[0.08] bg-white/[0.04] text-zinc-400">
        {paused ? <Pause className="h-5 w-5" /> : <RefreshCcw className="h-5 w-5" />}
      </div>
      <div className="mt-3 text-sm font-black text-white">{paused ? "Feed paused" : "No activity yet"}</div>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-zinc-500">
        {paused ? "Resume the feed to receive new realtime events." : "New ERP, POS, AI, inventory, and attendance activity will appear here."}
      </p>
    </div>
  );
}

export default LiveActivityFeed;
