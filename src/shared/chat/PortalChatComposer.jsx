import { Loader2, Mic, Paperclip, Send, X } from "lucide-react";

import WhatsAppRecordingBar from "../../modules/employees/components/WhatsAppRecordingBar";
import { CHAT_ATTACHMENT_ACCEPT, portalChatMessagePreview } from "./portalChatUtils";

export default function PortalChatComposer({
  onSubmit,
  body,
  setBody,
  sending = false,
  attachment = null,
  setAttachment,
  setAttachmentDuration,
  replyTo = null,
  setReplyTo,
  editingMessage = null,
  setEditingMessage,
  labels = {},
  fileInputRef,
  inputRef,
  chooseAttachment,
  emitTyping,
  recordingState = { active: false, paused: false, seconds: 0, supported: false },
  recordingStream = null,
  onCancelRecording,
  onToggleRecordingPause,
  onSendRecording,
  onStartRecording,
  disabled = false,
  useTextarea = false,
  onScrollToReply,
}) {
  const removeAttachment = () => {
    setAttachment?.(null);
    setAttachmentDuration?.(0);
    if (fileInputRef?.current) fileInputRef.current.value = "";
  };

  return (
    <form onSubmit={onSubmit} className="relative z-30 flex-none border-t border-white/10 bg-[#1f2c33] px-2 pb-[calc(0.25rem+env(safe-area-inset-bottom))] pt-1">
      {recordingState.active ? (
        <WhatsAppRecordingBar
          stream={recordingStream}
          seconds={recordingState.seconds}
          paused={recordingState.paused}
          sending={sending}
          onDelete={onCancelRecording}
          onPauseResume={onToggleRecordingPause}
          onSend={onSendRecording}
        />
      ) : (
        <>
          {replyTo ? (
            <div className="mb-1.5 flex items-stretch gap-2 rounded-[1rem] bg-[#111b21] p-1.5 text-[12px] font-bold leading-5 text-white shadow-lg">
              <button type="button" onClick={() => onScrollToReply?.(replyTo.id)} className="min-w-0 flex-1 rounded-[var(--radius-control)] border-l-[4px] border-[#ff5d74] bg-[#202c33] px-3 py-2 text-start" dir="rtl">
                <div className="truncate text-[13px] font-black text-[#ff7186]">{replyTo.sender_type === labels.outgoingSenderType ? labels.you || "أنت" : labels.management || "M1 Store"}</div>
                <div className="truncate text-[12px] font-semibold text-slate-200/85">{portalChatMessagePreview(replyTo, labels)}</div>
              </button>
              <button type="button" onClick={() => setReplyTo?.(null)} className="flex h-[var(--control-height-md)] w-9 shrink-0 self-center items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white" aria-label={labels.cancelReply || "إلغاء الرد"}>
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : null}
          {editingMessage ? (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-bold leading-4 text-white">
              <div className="min-w-0 flex-1 border-r-2 border-amber-300 pr-2 text-start">
                <div className="text-amber-200">{labels.editing || "تعديل الرسالة"}</div>
                <div className="truncate opacity-80">{editingMessage.body}</div>
              </div>
              <button type="button" onClick={() => { setEditingMessage?.(null); setBody?.(""); }} className="flex h-[var(--control-height-sm)] w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-red-200"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
          {attachment ? (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white">
              <span className="min-w-0 truncate" dir="auto">{attachment.name}</span>
              <button type="button" onClick={removeAttachment} className="font-black text-red-200">
                {labels.removeAttachment || "حذف"}
              </button>
            </div>
          ) : null}
          {disabled && labels.disabledNotice ? (
            <div className="mb-2 rounded-[var(--radius-card)] border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-slate-200">
              {labels.disabledNotice}
            </div>
          ) : null}
          <div className={useTextarea ? "flex items-end gap-2" : "flex h-[44px] items-center gap-1.5"}>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={CHAT_ATTACHMENT_ACCEPT}
              onChange={chooseAttachment}
            />
            <button type="button" onClick={() => fileInputRef?.current?.click()} className={`${useTextarea ? "h-[var(--control-height-lg)] w-11" : "h-[var(--control-height-md)] w-10"} flex shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100 disabled:opacity-50`} aria-label={labels.attachFile || "إرفاق ملف"} disabled={disabled}>
              <Paperclip className="h-4 w-4" />
            </button>
            {recordingState.supported ? (
              <button type="button" onClick={onStartRecording} className={`${useTextarea ? "h-[var(--control-height-lg)] w-11" : "h-[var(--control-height-md)] w-10"} flex shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100 disabled:opacity-50`} aria-label={labels.recordVoice || "تسجيل صوتي"} disabled={disabled}>
                <Mic className="h-4 w-4" />
              </button>
            ) : null}
            {useTextarea ? (
              <textarea
                ref={inputRef}
                value={body}
                onChange={(event) => { setBody(event.target.value); emitTyping?.(); }}
                placeholder={labels.placeholder || "اكتب رسالة..."}
                className="min-h-[42px] flex-1 resize-none rounded-[1.4rem] border border-white/10 bg-white/10 px-4 py-[9px] !text-[16px] font-bold leading-[22px] text-white outline-none [transform:none] [zoom:1] placeholder:text-slate-400 focus:border-emerald-400 disabled:opacity-60"
                dir="auto"
                disabled={disabled}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={body}
                onChange={(event) => { setBody(event.target.value); emitTyping?.(); }}
                placeholder={labels.placeholder || "اكتب رسالة..."}
                inputMode="text"
                enterKeyHint="send"
                autoCorrect="on"
                autoComplete="off"
                autoCapitalize="sentences"
                spellCheck="true"
                className="h-[42px] min-h-[42px] min-w-0 flex-1 rounded-[22px] border border-white/10 bg-white/10 px-3 py-0 !text-[16px] font-bold leading-5 text-white outline-none [transform:none] [zoom:1] placeholder:text-slate-400 focus:border-emerald-400 disabled:opacity-60"
                dir="auto"
                disabled={disabled}
              />
            )}
            <button type="submit" disabled={disabled || sending || (!String(body || "").trim() && !attachment)} className={`${useTextarea ? "h-[var(--control-height-lg)] w-11" : "h-[var(--control-height-md)] w-10"} inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 disabled:opacity-50`}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
