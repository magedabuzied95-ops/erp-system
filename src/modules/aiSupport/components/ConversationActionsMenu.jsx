import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  LockOpen,
  Mail,
  MailOpen,
  Maximize2,
  MoreVertical,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { collectAncestorZIndexes, resolveMenuZIndex } from "../../../shared/ui/selectMenuLayer";

/*
 * Genie's conversation menu (⋮), for a list row and for the open thread's header.
 *
 *   row:    Mark as Done · Archive · Send Template · Mark as Unread · Delete Chat,
 *           plus the row shortcuts that used to be icons (favourite, privacy)
 *   header: Open Mini Chat · Mark as Done · Archive · Send Template ·
 *           Mark as Unread · Export Chat · Delete Chat
 *
 * Each item shows only when its handler is passed, so a viewer without reply
 * rights never sees an action they cannot take. The list portals to the page:
 * rows live inside scrolling, clipped panes.
 */

const unreadOf = (item = {}) => Number(item.unread_count || item.unread || 0) > 0 || item.manually_unread === true;
const closedOf = (item = {}) => String(item.status || item.conversation_status || "").toLowerCase() === "closed";
const archivedOf = (item = {}) => Boolean(item.archived_at);
const favoriteOf = (item = {}) => item.is_favorite === true || String(item.is_favorite).toLowerCase() === "true";

export default function ConversationActionsMenu({
  item = {},
  variant = "row",
  privateConversation = false,
  onOpenMiniChat,
  onToggleDone,
  onToggleArchive,
  onSendTemplate,
  onToggleRead,
  onToggleFavorite,
  onEditPrivacy,
  onExport,
  onDelete,
  buttonClassName = "",
  onOpenChange,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => { onOpenChange?.(open); }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = buttonRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = 232;
      const rtl = getComputedStyle(anchor).direction === "rtl";
      let left = rtl ? rect.left : rect.right - width;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const below = rect.bottom + 6;
      const estimated = 340;
      const top = below + estimated > window.innerHeight - 8 ? Math.max(8, rect.top - estimated - 6) : below;
      setLayout({ top, left, width, zIndex: resolveMenuZIndex(collectAncestorZIndexes(anchor, (node) => window.getComputedStyle(node).zIndex)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (handler) => (event) => {
    event.stopPropagation();
    setOpen(false);
    handler?.(item);
  };

  const unread = unreadOf(item);
  const closed = closedOf(item);
  const archived = archivedOf(item);
  const favorite = favoriteOf(item);
  const entries = [
    variant === "header" && onOpenMiniChat ? { key: "mini", icon: Maximize2, tone: "text-sky-500", label: t("aiSupport.inbox.actionsMenu.openMiniChat"), handler: onOpenMiniChat } : null,
    onToggleDone ? { key: "done", icon: closed ? RotateCcw : CheckCircle2, tone: "text-emerald-500", label: t(closed ? "aiSupport.inbox.actionsMenu.reopen" : "aiSupport.inbox.actionsMenu.markDone"), handler: onToggleDone } : null,
    onToggleArchive ? { key: "archive", icon: archived ? ArchiveRestore : Archive, tone: "text-slate-500", label: t(archived ? "aiSupport.inbox.actionsMenu.unarchive" : "aiSupport.inbox.actionsMenu.archive"), handler: onToggleArchive } : null,
    onSendTemplate ? { key: "template", icon: FileText, tone: "text-emerald-600", label: t("aiSupport.inbox.actionsMenu.sendTemplate"), handler: onSendTemplate } : null,
    onToggleRead ? { key: "read", icon: unread ? MailOpen : Mail, tone: "text-violet-500", label: t(unread ? "aiSupport.inbox.ui.markRead" : "aiSupport.inbox.ui.markUnread"), handler: onToggleRead } : null,
    variant === "row" && onToggleFavorite ? { key: "favorite", icon: Star, tone: "text-amber-500", label: t(favorite ? "aiSupport.inbox.actionsMenu.unfavorite" : "aiSupport.inbox.actionsMenu.favorite"), handler: onToggleFavorite } : null,
    onEditPrivacy ? { key: "privacy", icon: privateConversation ? Lock : LockOpen, tone: "text-amber-600", label: t("aiSupport.inbox.ui.privacyEdit"), handler: onEditPrivacy } : null,
    variant === "header" && onExport ? { key: "export", icon: Download, tone: "text-sky-600", label: t("aiSupport.inbox.actionsMenu.exportChat"), handler: onExport } : null,
    onDelete ? { key: "delete", icon: Trash2, tone: "text-danger", label: t("aiSupport.inbox.actionsMenu.deleteChat"), handler: onDelete, danger: true } : null,
  ].filter(Boolean);

  if (!entries.length) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
        onKeyDown={(event) => event.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("aiSupport.inbox.actionsMenu.title")}
        title={t("aiSupport.inbox.actionsMenu.title")}
        data-conversation-actions={variant}
        className={buttonClassName || "grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && layout
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              dir="auto"
              onClick={(event) => event.stopPropagation()}
              className="fixed overflow-hidden rounded-xl border border-border bg-surface py-1.5 text-text shadow-2xl"
              style={{ top: layout.top, left: layout.left, width: layout.width, zIndex: layout.zIndex }}
            >
              {entries.map(({ key, icon: Icon, tone, label, handler, danger }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  onClick={run(handler)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2 text-start text-sm transition hover:bg-surface-hover ${danger ? "text-danger" : ""}`}
                >
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${tone}`} />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>,
            document.fullscreenElement || document.body
          )
        : null}
    </>
  );
}
