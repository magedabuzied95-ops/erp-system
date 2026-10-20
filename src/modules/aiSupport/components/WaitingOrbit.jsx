import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CustomerAvatar from "./CustomerAvatar.jsx";
import "./WaitingOrbit.css";

/*
 * What the inbox shows before anyone picks a conversation.
 *
 * Opening the inbox used to drop the operator into whichever thread sorted
 * first — usually the newest, not the one that most needs an answer. This
 * view instead lays the customers who are waiting for a reply on three slowly
 * turning rings: the longest wait sits on the innermost ring, nearest the
 * count, and the outer rings hold the shorter waits. One click opens the
 * thread.
 *
 * "Waiting" is the inbox's own unread rule (customer messages newer than the
 * last outbound of any kind), so the orbit and the unread filter never
 * disagree. The wait is measured from the thread's last message, which for a
 * waiting thread is the customer's.
 */

// 3 + 5 + 6 = 14 seats. Radii are in container-width units of a square stage,
// so the rings scale with the pane. Each ring starts 40deg further round than
// the one inside it so the seats never line up into spokes.
const RINGS = [
  { seats: 3, radius: 24, size: 48 },
  { seats: 5, radius: 36, size: 72 },
  { seats: 6, radius: 47, size: 94 },
];
const SEAT_COUNT = RINGS.reduce((sum, ring) => sum + ring.seats, 0);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const waitTone = (ms) => (ms >= HOUR ? "is-hot" : ms >= 15 * MINUTE ? "is-warm" : "");

export function formatWait(ms, t) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 1) return t("aiSupport.inbox.orbit.now");
  if (minutes < 60) return t("aiSupport.inbox.orbit.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("aiSupport.inbox.orbit.hours", { count: hours });
  return t("aiSupport.inbox.orbit.days", { count: Math.floor(hours / 24) });
}

export default function WaitingOrbit({
  items = [],
  channels = [],
  operatorName = "",
  onOpen,
}) {
  const { t } = useTranslation();
  // The wait labels are relative to now; a minute tick keeps them honest
  // without re-rendering the rings every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);
  const [hoverKey, setHoverKey] = useState("");

  const waiting = useMemo(
    () => items
      .map((item) => ({ ...item, waitMs: Math.max(0, now - new Date(item.waitingSince || 0).getTime()) }))
      .filter((item) => Number.isFinite(item.waitMs))
      .sort((a, b) => b.waitMs - a.waitMs),
    [items, now]
  );

  const seats = useMemo(() => {
    const placed = [];
    let index = 0;
    RINGS.forEach((ring, ringIndex) => {
      const start = -90 + ringIndex * 40;
      const step = 360 / ring.seats;
      for (let seat = 0; seat < ring.seats && index < waiting.length; seat += 1, index += 1) {
        placed.push({ item: waiting[index], angle: start + seat * step, radius: ring.radius, order: index });
      }
    });
    return placed;
  }, [waiting]);

  const hour = new Date(now).getHours();
  const greetingKey = hour < 12 ? "aiSupport.inbox.orbit.greetMorning" : "aiSupport.inbox.orbit.greetEvening";
  const greeting = operatorName ? t(greetingKey, { name: operatorName }) : t(`${greetingKey}Plain`);
  const overflow = Math.max(0, waiting.length - SEAT_COUNT);
  const longest = waiting[0];

  return (
    <div className="orbit-pane" data-ai-inbox-waiting-orbit="true">
      <h2 className="orbit-greeting">{greeting}</h2>
      <div
        className={`orbit-stage ${hoverKey ? "is-paused" : ""}`}
        role="group"
        aria-label={t("aiSupport.inbox.orbit.waiting")}
      >
        {RINGS.map((ring, index) => (
          <span
            key={ring.size}
            className="orbit-ring"
            style={{ width: `${ring.size}%`, height: `${ring.size}%`, animationDelay: `${index * -1.3}s` }}
            aria-hidden="true"
          />
        ))}
        <div className="orbit-spin">
          {seats.map(({ item, angle, radius, order }) => {
            const hovered = hoverKey === item.key;
            const waitLabel = formatWait(item.waitMs, t);
            return (
              <span
                key={item.key}
                className={`orbit-arm ${hovered ? "is-hover" : ""}`}
                style={{ "--a": `${angle}deg`, "--r": `${radius}cqw` }}
              >
                <button
                  type="button"
                  className={`orbit-orb ${waitTone(item.waitMs)} ${hovered ? "is-hover" : ""}`}
                  style={{ "--rim": item.color, animationDelay: `${order * 40}ms` }}
                  aria-label={t("aiSupport.inbox.orbit.waitingFor", { name: item.name, time: waitLabel })}
                  onClick={() => onOpen?.(item.conversation)}
                  onMouseEnter={() => setHoverKey(item.key)}
                  onMouseLeave={() => setHoverKey((current) => (current === item.key ? "" : current))}
                  onFocus={() => setHoverKey(item.key)}
                  onBlur={() => setHoverKey((current) => (current === item.key ? "" : current))}
                >
                  <span className="orbit-upright">
                    <span className="orbit-avatar">
                      <CustomerAvatar
                        url={item.avatarUrl}
                        name={item.name}
                        className="h-full w-full"
                        imgClassName="object-cover"
                        fallbackClassName="orbit-initials"
                      />
                    </span>
                    <span className="orbit-wait" dir="auto">{waitLabel}</span>
                    {hovered ? (
                      <span className="orbit-card" dir="auto">
                        <span className="orbit-card-name">{item.name}</span>
                        {item.preview ? <span className="orbit-card-msg">{item.preview}</span> : null}
                        <span className="orbit-card-meta">
                          {item.channelLabel ? `${item.channelLabel} · ` : ""}
                          {t("aiSupport.inbox.orbit.waitingSince", { time: waitLabel })}
                          {item.unread > 1 ? ` · ${t("aiSupport.inbox.orbit.messages", { count: item.unread })}` : ""}
                        </span>
                      </span>
                    ) : null}
                  </span>
                </button>
              </span>
            );
          })}
          {overflow ? (
            <span className="orbit-more" style={{ top: "97%" }}>
              {t("aiSupport.inbox.orbit.more", { count: overflow })}
            </span>
          ) : null}
        </div>
        <div className={`orbit-core ${waiting.length ? "" : "is-calm"}`}>
          <span className="orbit-core-count">{waiting.length}</span>
          <span className="orbit-core-label">{t("aiSupport.inbox.orbit.waiting")}</span>
          {longest ? (
            <span className="orbit-core-sub">{t("aiSupport.inbox.orbit.longest", { time: formatWait(longest.waitMs, t) })}</span>
          ) : (
            <span className="orbit-core-sub">{t("aiSupport.inbox.orbit.calm")}</span>
          )}
        </div>
      </div>
      {channels.length ? (
        <div className="orbit-chips">
          {channels.map((channel) => (
            <span key={channel.key} className="orbit-chip">
              <span className="orbit-chip-dot" style={{ background: channel.color }} aria-hidden="true" />
              {channel.label} {channel.count}
            </span>
          ))}
        </div>
      ) : null}
      <p className="orbit-hint">{t("aiSupport.inbox.orbit.hint")}</p>
    </div>
  );
}
