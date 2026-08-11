import { CalendarDays, CheckCircle2, Clock3, Copy, History, LayoutGrid, PenLine, Rocket, Sparkles, Tv2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import MarketingStudioHeader from "../components/MarketingStudioHeader";

const pad2 = (value) => String(value).padStart(2, "0");

const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
};

const buildMonthGrid = (date) => {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - startOffset);

  return Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => {
      const cell = new Date(gridStart);
      cell.setDate(gridStart.getDate() + row * 7 + column);
      return cell;
    })
  );
};

const buildWeekDates = (date) => {
  const current = new Date(date);
  const start = new Date(current);
  start.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const cell = new Date(start);
    cell.setDate(start.getDate() + index);
    return cell;
  });
};

const formatShortDay = (date) =>
  new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(date);

const formatMonthLabel = (date) => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);

const formatWeekLabel = (date) =>
  `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} - ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6))}`;

const badgeToneClass = {
  draft: "border-white/10 bg-white/5 text-slate-200",
  scheduled: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
  published: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
  review: "border-amber-500/20 bg-amber-500/10 text-amber-100",
};

const ContentCard = ({ icon: Icon, tone, title, description, meta }) => (
  <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/20 transition hover:border-white/20 hover:bg-white/[0.06]">
    <div className="flex items-start justify-between gap-3">
      <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${tone} shrink-0`}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
        {meta}
      </span>
    </div>
    <h3 className="mt-4 text-base font-black text-white">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
  </article>
);

const StatChip = ({ label, value }) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</div>
    <div className="mt-1 text-lg font-black text-white">{value}</div>
  </div>
);

export default function SocialCalendar() {
  const { t } = useTranslation();
  const referenceDate = useMemo(() => new Date(), []);
  const monthGrid = useMemo(() => buildMonthGrid(referenceDate), [referenceDate]);
  const weekDates = useMemo(() => buildWeekDates(referenceDate), [referenceDate]);

  const monthEvents = useMemo(() => {
    const month = referenceDate.getMonth();
    const year = referenceDate.getFullYear();
    const eventList = [
      { date: new Date(year, month, 3), label: t("marketing.socialCalendar.samples.launch"), tone: "scheduled" },
      { date: new Date(year, month, 7), label: t("marketing.socialCalendar.samples.story"), tone: "draft" },
      { date: new Date(year, month, 12), label: t("marketing.socialCalendar.samples.promo"), tone: "review" },
      { date: new Date(year, month, 18), label: t("marketing.socialCalendar.samples.reel"), tone: "published" },
      { date: new Date(year, month, 24), label: t("marketing.socialCalendar.samples.ugc"), tone: "scheduled" },
      { date: new Date(year, month, 27), label: t("marketing.socialCalendar.samples.reminder"), tone: "draft" },
    ];

    return Object.fromEntries(eventList.map((item) => [toLocalDateKey(item.date), item]));
  }, [referenceDate, t]);

  const scheduledPosts = [
    {
      time: "09:30",
      title: t("marketing.socialCalendar.samples.launch"),
      channel: "Instagram",
      status: "scheduled",
      note: t("marketing.socialCalendar.notes.launch"),
    },
    {
      time: "13:00",
      title: t("marketing.socialCalendar.samples.story"),
      channel: "Facebook",
      status: "review",
      note: t("marketing.socialCalendar.notes.story"),
    },
    {
      time: "18:45",
      title: t("marketing.socialCalendar.samples.ugc"),
      channel: "Instagram",
      status: "draft",
      note: t("marketing.socialCalendar.notes.ugc"),
    },
  ];

  const history = [
    {
      time: "Yesterday",
      title: t("marketing.socialCalendar.samples.reel"),
      channel: "Instagram",
      result: t("marketing.socialCalendar.history.published"),
    },
    {
      time: "2 days ago",
      title: t("marketing.socialCalendar.samples.promo"),
      channel: "Facebook",
      result: t("marketing.socialCalendar.history.reviewed"),
    },
    {
      time: "3 days ago",
      title: t("marketing.socialCalendar.samples.reminder"),
      channel: "Facebook",
      result: t("marketing.socialCalendar.history.archived"),
    },
  ];

  const draftSteps = [
    {
      title: t("marketing.socialCalendar.draft.steps.idea.title"),
      description: t("marketing.socialCalendar.draft.steps.idea.description"),
    },
    {
      title: t("marketing.socialCalendar.draft.steps.copy.title"),
      description: t("marketing.socialCalendar.draft.steps.copy.description"),
    },
    {
      title: t("marketing.socialCalendar.draft.steps.visual.title"),
      description: t("marketing.socialCalendar.draft.steps.visual.description"),
    },
    {
      title: t("marketing.socialCalendar.draft.steps.publish.title"),
      description: t("marketing.socialCalendar.draft.steps.publish.description"),
    },
  ];

  const cards = [
    {
      icon: Sparkles,
      tone: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
      title: t("marketing.socialCalendar.cards.brand.title"),
      description: t("marketing.socialCalendar.cards.brand.description"),
      meta: t("marketing.socialCalendar.cards.brand.meta"),
    },
    {
      icon: PenLine,
      tone: "border-violet-500/20 bg-violet-500/10 text-violet-100",
      title: t("marketing.socialCalendar.cards.offer.title"),
      description: t("marketing.socialCalendar.cards.offer.description"),
      meta: t("marketing.socialCalendar.cards.offer.meta"),
    },
    {
      icon: Copy,
      tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
      title: t("marketing.socialCalendar.cards.community.title"),
      description: t("marketing.socialCalendar.cards.community.description"),
      meta: t("marketing.socialCalendar.cards.community.meta"),
    },
    {
      icon: Rocket,
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-100",
      title: t("marketing.socialCalendar.cards.launch.title"),
      description: t("marketing.socialCalendar.cards.launch.description"),
      meta: t("marketing.socialCalendar.cards.launch.meta"),
    },
  ];

  const monthLabel = formatMonthLabel(referenceDate);
  const weekLabel = formatWeekLabel(weekDates[0]);
  const todayKey = toLocalDateKey(referenceDate);

  return (
    <div className="min-h-full bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-6 lg:px-7">
        <MarketingStudioHeader />
        <section className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <CalendarDays className="h-3.5 w-3.5" />
                {t("marketing.socialCalendar.eyebrow")}
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-black tracking-tight md:text-5xl">{t("marketing.socialCalendar.title")}</h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-300 md:text-base">{t("marketing.socialCalendar.subtitle")}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatChip label={t("marketing.socialCalendar.summary.month")} value={monthLabel} />
              <StatChip label={t("marketing.socialCalendar.summary.week")} value={weekLabel} />
              <StatChip label={t("marketing.socialCalendar.summary.slots")} value={t("marketing.socialCalendar.summary.slotsValue")} />
              <StatChip label={t("marketing.socialCalendar.summary.history")} value={t("marketing.socialCalendar.summary.historyValue")} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
          <article className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">{t("marketing.socialCalendar.month.title")}</h2>
                <p className="text-sm text-slate-400">{t("marketing.socialCalendar.month.subtitle")}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-300">
                <Clock3 className="h-3.5 w-3.5 text-cyan-200" />
                {t("marketing.socialCalendar.month.badge")}
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {weekDates.map((date) => (
                <div key={date.toISOString()} className="pb-2">
                  {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {monthGrid.flat().map((date) => {
                const isCurrentMonth = date.getMonth() === referenceDate.getMonth();
                const isToday = toLocalDateKey(date) === todayKey;
                const event = monthEvents[toLocalDateKey(date)];
                return (
                  <div
                    key={date.toISOString()}
                    className={[
                      "min-h-[7.5rem] rounded-3xl border p-3 transition",
                      isCurrentMonth ? "border-white/10 bg-black/20" : "border-white/5 bg-black/10 opacity-45",
                      isToday ? "ring-2 ring-cyan-400/70" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={`text-sm font-black ${isToday ? "text-cyan-100" : isCurrentMonth ? "text-white" : "text-slate-500"}`}>
                        {date.getDate()}
                      </div>
                      {event ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${badgeToneClass[event.tone]}`}>{event.tone}</span> : null}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {event ? (
                        <>
                          <div className="line-clamp-2 text-sm font-semibold text-white">{event.label}</div>
                          <div className="text-xs text-slate-400">{t("marketing.socialCalendar.month.scheduledLabel")}</div>
                        </>
                      ) : (
                        <div className="text-xs text-slate-500">{t("marketing.socialCalendar.month.empty")}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">{t("marketing.socialCalendar.week.title")}</h2>
                <p className="text-sm text-slate-400">{t("marketing.socialCalendar.week.subtitle")}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-300">
                <LayoutGrid className="h-3.5 w-3.5 text-amber-200" />
                {t("marketing.socialCalendar.week.badge")}
              </div>
            </div>

            <div className="space-y-3">
              {weekDates.map((date, index) => {
                const isToday = toLocalDateKey(date) === todayKey;
                const events = index === 1
                  ? [
                      { label: t("marketing.socialCalendar.samples.launch"), tone: "scheduled" },
                      { label: t("marketing.socialCalendar.samples.story"), tone: "draft" },
                    ]
                  : index === 3
                    ? [{ label: t("marketing.socialCalendar.samples.reel"), tone: "published" }]
                    : index === 5
                      ? [{ label: t("marketing.socialCalendar.samples.promo"), tone: "review" }]
                      : [];

                return (
                  <div
                    key={date.toISOString()}
                    className={`rounded-3xl border p-4 ${isToday ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-black/20"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className={`text-sm font-black ${isToday ? "text-cyan-100" : "text-white"}`}>{formatShortDay(date)}</div>
                        <div className="text-xs text-slate-400">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}</div>
                      </div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{index + 1}</div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {events.length ? (
                        events.map((event) => (
                          <div key={`${date.toISOString()}-${event.label}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                            <span className="text-sm font-semibold text-slate-100">{event.label}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${badgeToneClass[event.tone]}`}>
                              {event.tone}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-500">
                          {t("marketing.socialCalendar.week.empty")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-black text-white">{t("marketing.socialCalendar.draft.title")}</h2>
              <p className="text-sm text-slate-400">{t("marketing.socialCalendar.draft.subtitle")}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("marketing.socialCalendar.draft.badge")}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                {draftSteps.map((step, index) => (
                  <div key={step.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 text-sm font-black text-cyan-100">
                        {pad2(index + 1)}
                      </div>
                      <div className="text-sm font-black text-white">{step.title}</div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface-soft)] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                <Tv2 className="h-4 w-4 text-cyan-200" />
                {t("marketing.socialCalendar.draft.canvasLabel")}
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-sm font-black text-white">{t("marketing.socialCalendar.draft.canvas.title")}</div>
                  <div className="mt-1 text-sm text-slate-400">{t("marketing.socialCalendar.draft.canvas.subtitle")}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-3xl border border-white/10 bg-cyan-500/10 p-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100">{t("marketing.socialCalendar.draft.canvas.leftLabel")}</div>
                    <div className="mt-2 text-sm text-cyan-50">{t("marketing.socialCalendar.draft.canvas.leftValue")}</div>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-amber-500/10 p-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-100">{t("marketing.socialCalendar.draft.canvas.rightLabel")}</div>
                    <div className="mt-2 text-sm text-amber-50">{t("marketing.socialCalendar.draft.canvas.rightValue")}</div>
                  </div>
                </div>
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <History className="h-4 w-4 text-slate-300" />
                    {t("marketing.socialCalendar.draft.canvas.checklist")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      t("marketing.socialCalendar.draft.canvas.checkItems.copy"),
                      t("marketing.socialCalendar.draft.canvas.checkItems.image"),
                      t("marketing.socialCalendar.draft.canvas.checkItems.channel"),
                      t("marketing.socialCalendar.draft.canvas.checkItems.timing"),
                    ].map((item) => (
                      <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-5">
            <h2 className="text-lg font-black text-white">{t("marketing.socialCalendar.cards.title")}</h2>
            <p className="text-sm text-slate-400">{t("marketing.socialCalendar.cards.subtitle")}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <ContentCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">{t("marketing.socialCalendar.scheduled.title")}</h2>
              <p className="text-sm text-slate-400">{t("marketing.socialCalendar.scheduled.subtitle")}</p>
            </div>
            <div className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              {scheduledPosts.length} {t("marketing.socialCalendar.scheduled.countSuffix")}
            </div>
          </div>
          <div className="grid gap-3">
            {scheduledPosts.map((post) => (
              <article key={`${post.time}-${post.title}`} className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-black/20 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04]">
                    <Clock3 className="h-5 w-5 text-cyan-200" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-white">{post.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${badgeToneClass[post.status]}`}>
                        {post.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{post.note}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">{post.channel}</span>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">{post.time}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">{t("marketing.socialCalendar.history.title")}</h2>
              <p className="text-sm text-slate-400">{t("marketing.socialCalendar.history.subtitle")}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-300">
              <History className="h-3.5 w-3.5 text-amber-200" />
              {t("marketing.socialCalendar.history.badge")}
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10">
            <table className="m1-table m1-table--compact min-w-full">
              <thead className="bg-white/[0.03]">
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-4 py-3 font-semibold">{t("marketing.socialCalendar.history.headers.time")}</th>
                  <th className="border-b border-white/10 px-4 py-3 font-semibold">{t("marketing.socialCalendar.history.headers.post")}</th>
                  <th className="border-b border-white/10 px-4 py-3 font-semibold">{t("marketing.socialCalendar.history.headers.channel")}</th>
                  <th className="border-b border-white/10 px-4 py-3 font-semibold">{t("marketing.socialCalendar.history.headers.result")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={`${item.time}-${item.title}`} className="align-top">
                    <td className="border-b border-white/5 px-4 py-4 text-sm text-slate-300">{item.time}</td>
                    <td className="border-b border-white/5 px-4 py-4">
                      <div className="font-semibold text-white">{item.title}</div>
                    </td>
                    <td className="border-b border-white/5 px-4 py-4 text-sm text-slate-300">{item.channel}</td>
                    <td className="border-b border-white/5 px-4 py-4">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">
                        {item.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
