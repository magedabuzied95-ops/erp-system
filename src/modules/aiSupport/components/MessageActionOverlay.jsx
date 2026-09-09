import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppleEmoji } from "./AppleEmojiPicker.jsx";
import "./MessageActionOverlay.css";

/* ── The message sheet ────────────────────────────────────────────────────────
 * Holding a message opens exactly what the customer's own chat app opens: the
 * page dims, the message itself lifts above the dim, the reactions sit in a
 * pill over it and the actions in a card under it. It is one component for both
 * surfaces — the desktop inbox and the PWA — because a transcript is the same
 * transcript on both, and two different ways to act on a message is the thing
 * that made this feel slow.
 *
 * It draws in a portal on the body: the panel and the lifted copy have to
 * escape the transcript scroller, which clips (and scrolls out from under)
 * anything positioned inside it.
 */

const PAD = 10;
const GAP = 8;
const EMOJI_ROW_HEIGHT = 52;
const MENU_ITEM_HEIGHT = 44;
const MENU_PADDING = 12;
const MENU_WIDTH = 216;
const OVERLAY_Z = 2147482000;

const lightSkin = {
  panel: "border-slate-200/80 bg-white text-slate-900",
  item: "hover:bg-slate-100 active:bg-slate-200",
  divider: "bg-slate-200/70",
  active: "text-amber-600",
  chip: "hover:bg-slate-100 active:bg-slate-200",
  chipActive: "bg-amber-100 ring-1 ring-amber-300",
  more: "text-slate-500 hover:bg-slate-100",
};

const darkSkin = {
  panel: "border-white/10 bg-[#242724] text-white",
  item: "hover:bg-white/10 active:bg-white/[0.14]",
  divider: "bg-white/10",
  active: "text-amber-300",
  chip: "hover:bg-white/10 active:bg-white/[0.14]",
  chipActive: "bg-amber-300/20 ring-1 ring-amber-300/60",
  more: "text-slate-300 hover:bg-white/10",
};

/** Roughly how wide the reaction pill wants to be: a 36px chip per emoji, the
 *  gap between them, and the pill's own padding and border. It only has to be
 *  close — it exists so the pill is never pushed into a space too narrow for
 *  its own chips, which squeezes them into unreadable slivers. */
const reactionPillWidth = (count) => count * 36 + Math.max(0, count - 1) * 2 + 14;

/** Where the pill, the lifted message and the card go, for one anchor.
 *
 *  The side is read off the geometry, never off the message's `align`: the
 *  transcript is laid out in logical directions, so on an Arabic (RTL) inbox an
 *  incoming message aligned "left" is drawn against the physical RIGHT edge.
 *  Everything here is in viewport pixels, so it asks the only question that
 *  survives both directions — which edge is this message actually nearer? */
const measure = (anchorEl, { itemCount, hasReactions, reactionCount }) => {
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuHeight = itemCount * MENU_ITEM_HEIGHT + MENU_PADDING;
  const emojiBlock = hasReactions ? EMOJI_ROW_HEIGHT + GAP : 0;
  const width = Math.max(48, Math.min(rect.width, vw - PAD * 2));
  // Everything but the message has a fixed height, so the message is what gives
  // way when the viewport is short: it is capped and scrolls nothing, exactly
  // as a long held message is cropped on a phone.
  const room = vh - PAD * 2 - emojiBlock - GAP - menuHeight;
  const height = Math.max(44, Math.min(rect.height, room));
  const minTop = PAD + emojiBlock;
  const maxTop = vh - PAD - menuHeight - GAP - height;
  const top = maxTop <= minTop ? minTop : Math.min(Math.max(rect.top, minTop), maxTop);
  const left = Math.min(Math.max(rect.left, PAD), Math.max(PAD, vw - PAD - width));
  const anchorRight = vw - (left + width) <= left;
  const menuWidth = Math.min(MENU_WIDTH, vw - PAD * 2);
  const menuLeft = anchorRight
    ? Math.min(Math.max(left + width - menuWidth, PAD), Math.max(PAD, vw - PAD - menuWidth))
    : Math.min(Math.max(left, PAD), Math.max(PAD, vw - PAD - menuWidth));
  // The pill hugs the same edge of the message the bubble is on, but it is
  // wider than a short message, so it is laid out in a full-width strip and
  // pushed against that edge — free to grow the other way. The push is capped
  // at what the pill needs for its own chips: a two-word message would
  // otherwise leave it a 100px slot and crush six emoji into it.
  const strip = vw - PAD * 2;
  const edgeOffset = Math.max(0, Math.min(
    anchorRight ? vw - PAD - (left + width) : left - PAD,
    strip - reactionPillWidth(reactionCount),
  ));
  return {
    lift: { left, top, width, height, cropped: height < rect.height - 1 },
    menu: { left: menuLeft, top: top + height + GAP, width: menuWidth },
    anchorRight,
    emoji: {
      top: top - GAP - EMOJI_ROW_HEIGHT,
      left: PAD,
      width: strip,
      justify: anchorRight ? "flex-end" : "flex-start",
      offsetStart: anchorRight ? 0 : edgeOffset,
      offsetEnd: anchorRight ? edgeOffset : 0,
    },
  };
};

export default function MessageActionOverlay({
  open = false,
  anchorEl = null,
  mode = "dark",
  items = [],
  reactionOptions = [],
  canReact = false,
  reactionSending = false,
  activeReaction = "",
  onReact,
  onMore,
  moreRef,
  onClose,
  labels = {},
}) {
  const liftRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const reactionCount = reactionOptions.length + (reactionOptions.length > 1 ? 1 : 0);
  const hasReactions = canReact && reactionOptions.length > 0;

  useLayoutEffect(() => {
    if (!open || !anchorEl || typeof window === "undefined") {
      setLayout(null);
      return undefined;
    }
    const sync = () => setLayout(measure(anchorEl, { itemCount: items.length, hasReactions, reactionCount }));
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [anchorEl, hasReactions, items.length, open, reactionCount]);

  // The message on the sheet is a copy of the one in the transcript. Cloning the
  // node keeps every bubble exactly as it was drawn — the platform's colours are
  // inline on the bubble, so the copy is identical wherever it is mounted — and
  // it leaves the real message in the list untouched underneath.
  // `layout` is in the dependencies on purpose: the host below is only rendered
  // once the geometry is known, so an effect that ran before that measurement
  // would find no host and leave the sheet with an empty hole where the message
  // should be.
  useLayoutEffect(() => {
    const host = liftRef.current;
    if (!open || !anchorEl || !host) return;
    const copy = anchorEl.cloneNode(true);
    copy.removeAttribute("id");
    // A copy is not a message: nothing may find it by the attributes the real
    // transcript is queried with.
    copy.removeAttribute("data-ai-message-bubble");
    copy.removeAttribute("data-ai-message-body");
    copy.style.margin = "0";
    copy.style.width = "100%";
    copy.style.maxWidth = "100%";
    copy.querySelectorAll("video, audio").forEach((player) => {
      player.removeAttribute("autoplay");
      player.removeAttribute("controls");
    });
    copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    host.replaceChildren(copy);
  }, [anchorEl, open, layout]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || !layout || typeof document === "undefined") return null;
  const skin = mode === "light" ? lightSkin : darkSkin;

  return createPortal(
    <div
      role="presentation"
      data-ai-message-action-overlay="true"
      style={{ position: "fixed", inset: 0, zIndex: OVERLAY_Z }}
      // The dismissing tap is taken on the click, not on the pointer going
      // down. Closing on pointerdown tears the scrim away mid-gesture, and the
      // browser then hands the click that follows to whatever is under the
      // finger — the message underneath — which opened a second sheet instead
      // of closing the first. Held to the end of the gesture, the scrim takes
      // that click itself and stops it there.
      onClick={(event) => {
        if (event.target !== event.currentTarget && !event.target.closest("[data-m1-msg-dismiss='true']")) return;
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="m1-msg-scrim" data-m1-msg-dismiss="true" />

      <div
        ref={liftRef}
        className="m1-msg-lift"
        aria-hidden="true"
        style={{
          left: layout.lift.left,
          top: layout.lift.top,
          width: layout.lift.width,
          height: layout.lift.height,
          maskImage: layout.lift.cropped ? "linear-gradient(to bottom, #000 78%, transparent 100%)" : undefined,
          WebkitMaskImage: layout.lift.cropped ? "linear-gradient(to bottom, #000 78%, transparent 100%)" : undefined,
        }}
      />

      {hasReactions ? (
        <div
          className="m1-msg-panel flex items-center"
          style={{
            left: layout.emoji.left,
            top: layout.emoji.top,
            width: layout.emoji.width,
            justifyContent: layout.emoji.justify,
            paddingLeft: layout.emoji.offsetStart,
            paddingRight: layout.emoji.offsetEnd,
            ["--m1-msg-panel-shift"]: "8px",
            transformOrigin: layout.anchorRight ? "bottom right" : "bottom left",
          }}
        >
          <div className={`inline-flex max-w-full items-center gap-0.5 rounded-full border px-1.5 py-1 shadow-[0_10px_35px_rgba(0,0,0,0.35)] ${skin.panel}`}>
            {reactionOptions.map((emoji, index) => (
              <button
                key={emoji}
                type="button"
                disabled={reactionSending}
                onClick={() => onReact?.(emoji)}
                aria-label={`${labels.react || "تفاعل"} ${emoji}`}
                style={{ animationDelay: `${60 + index * 24}ms` }}
                className={`m1-msg-emoji-chip grid h-9 w-9 shrink-0 place-items-center rounded-full transition-transform duration-150 hover:-translate-y-0.5 disabled:opacity-50 ${skin.chip} ${activeReaction === emoji ? skin.chipActive : ""}`}
              >
                <AppleEmoji emoji={emoji} size={26} />
              </button>
            ))}
            {reactionOptions.length > 1 ? (
              <button
                ref={moreRef}
                type="button"
                onClick={() => onMore?.()}
                aria-label={labels.showAllEmoji || ""}
                style={{ animationDelay: `${60 + reactionOptions.length * 24}ms` }}
                className={`m1-msg-emoji-chip grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-black transition ${skin.more}`}
              >
                +
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        dir="ltr"
        role="menu"
        aria-label={labels.messageActions || ""}
        className={`m1-msg-panel overflow-hidden rounded-2xl border py-1.5 shadow-[0_22px_60px_rgba(0,0,0,0.45)] ${skin.panel}`}
        style={{
          left: layout.menu.left,
          top: layout.menu.top,
          width: layout.menu.width,
          ["--m1-msg-panel-shift"]: "-8px",
          transformOrigin: layout.anchorRight ? "top right" : "top left",
        }}
      >
        {items.map(({ label, icon: Icon, action, disabled, active, fill }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            onClick={action}
            disabled={disabled}
            className={`flex h-11 w-full items-center gap-3 px-3.5 text-left text-[13.5px] font-semibold transition disabled:opacity-40 ${skin.item} ${active ? skin.active : ""}`}
          >
            {Icon ? <Icon className={`h-[18px] w-[18px] shrink-0 ${fill ? "fill-current" : ""}`} /> : null}
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
