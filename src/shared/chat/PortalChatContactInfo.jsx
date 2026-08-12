import { Bell, ChevronLeft, Image as ImageIcon, Phone, Search, Star, Video, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

const safeMessages = (messages) => Array.isArray(messages) ? messages : [];
const formatStorage = (bytes) => {
  const total = Number(bytes || 0);
  if (total < 1024 * 1024) return `${Math.max(0, Math.round(total / 1024))} KB`;
  return `${(total / 1024 / 1024).toFixed(1)} MB`;
};

export default function PortalChatContactInfo({ open, onClose, contact = {}, messages = [], onSearch }) {
  const [mediaOpen, setMediaOpen] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const media = useMemo(() => safeMessages(messages).filter((message) => message.attachment_url && !message.deleted_at), [messages]);
  const mediaBytes = media.reduce((sum, message) => sum + Number(message.attachment_size || 0), 0);
  if (!open || typeof document === "undefined") return null;
  const phone = String(contact.phone || "").trim();
  const name = contact.name || "M1 Store";
  const avatar = contact.avatar || "/branding/m-one-logo-white-fixed.png";
  const rowClass = "flex min-h-14 w-full items-center gap-3 border-b border-white/[0.06] px-4 text-start text-[14px] font-semibold text-slate-100 last:border-0 hover:bg-white/[0.04]";

  return createPortal(
    <div className="fixed inset-0 z-[170] bg-black/70 backdrop-blur-sm" dir="rtl">
      <section className="mx-auto flex h-full w-full max-w-md flex-col overflow-y-auto bg-[#0b0b0b] text-white shadow-2xl">
        <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-white/10 bg-[#0b0b0b]/95 px-3 backdrop-blur-xl">
          <button type="button" onClick={onClose} className="grid h-[var(--control-height-md)] w-9 place-items-center rounded-full bg-white/10" aria-label="إغلاق"><X className="h-5 w-5" /></button>
          <h2 className="m1-section-title text-[15px]">معلومات جهة الاتصال</h2>
          <span className="w-9" />
        </header>

        <div className="px-3 pb-8">
          <div className="flex flex-col items-center px-4 pb-4 pt-5 text-center">
            <div className="h-28 w-28 overflow-hidden rounded-full bg-[#202c33] ring-1 ring-white/10">
              <img src={avatar} alt={name} className="h-full w-full object-cover" />
            </div>
            <h3 className="m1-section-title mt-4 max-w-full break-words" dir="auto">{name}</h3>
            {phone ? <a href={`tel:${phone}`} className="mt-1 text-[15px] font-semibold text-slate-400" dir="ltr">{phone}</a> : <p className="mt-1 text-sm text-slate-500">حساب أعمال</p>}
            {contact.about ? <p className="mt-2 text-sm font-medium text-slate-300" dir="auto">{contact.about}</p> : null}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <a href={phone ? `tel:${phone}` : undefined} aria-disabled={!phone} className={`flex min-h-16 flex-col items-center justify-center rounded-2xl bg-[#1b1d1d] text-emerald-400 ${!phone ? "pointer-events-none opacity-40" : ""}`}><Phone className="h-5 w-5" /><span className="mt-1 text-xs font-bold">صوت</span></a>
            <button type="button" disabled className="flex min-h-16 flex-col items-center justify-center rounded-[var(--radius-control)] bg-[#1b1d1d] text-emerald-400 disabled:opacity-40"><Video className="h-5 w-5" /><span className="mt-1 text-xs font-bold">فيديو</span></button>
            <button type="button" onClick={() => { onClose?.(); onSearch?.(); }} className="flex min-h-16 flex-col items-center justify-center rounded-[var(--radius-control)] bg-[#1b1d1d] text-emerald-400"><Search className="h-5 w-5" /><span className="mt-1 text-xs font-bold">بحث</span></button>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl bg-[#171919]">
            <button type="button" onClick={() => setMediaOpen((value) => !value)} className={rowClass}><ImageIcon className="h-5 w-5 text-slate-300" /><span className="flex-1">الوسائط والروابط والمستندات</span><span className="text-slate-400">{media.length}</span><ChevronLeft className={`h-4 w-4 text-slate-500 transition ${mediaOpen ? "-rotate-90" : ""}`} /></button>
            {mediaOpen ? <div className="grid grid-cols-3 gap-1.5 border-b border-white/[0.06] p-2">{media.length ? media.map((item) => item.attachment_type === "image" ? <a key={item.id} href={item.attachment_url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg bg-black"><img src={item.attachment_url} alt={item.attachment_name || "صورة"} className="h-full w-full object-cover" /></a> : <a key={item.id} href={item.attachment_url} target="_blank" rel="noreferrer" className="flex aspect-square items-center justify-center rounded-lg bg-[#202c33] p-2 text-center text-[10px] text-slate-300">{item.attachment_name || "ملف"}</a>) : <div className="col-span-3 py-4 text-center text-xs text-slate-500">لا توجد وسائط بعد</div>}</div> : null}
            <div className={rowClass}><span className="text-lg">▱</span><span className="flex-1">إدارة التخزين</span><span className="text-slate-400">{formatStorage(mediaBytes)}</span><ChevronLeft className="h-4 w-4 text-slate-500" /></div>
            <div className={rowClass}><Star className="h-5 w-5 text-slate-300" /><span className="flex-1">الرسائل المميزة</span><span className="text-slate-400">لا يوجد</span><ChevronLeft className="h-4 w-4 text-slate-500" /></div>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl bg-[#171919]">
            <button type="button" onClick={() => setNotifications((value) => !value)} className={rowClass}><Bell className="h-5 w-5 text-slate-300" /><span className="flex-1">الإشعارات</span><span className={`h-6 w-11 rounded-full p-0.5 transition ${notifications ? "bg-emerald-500" : "bg-slate-600"}`}><span className={`block h-5 w-5 rounded-full bg-white transition ${notifications ? "translate-x-0" : "-translate-x-5"}`} /></span></button>
            <div className={rowClass}><span className="text-lg">🎨</span><span className="flex-1">سمة المحادثة</span><span className="text-slate-400">داكن</span><ChevronLeft className="h-4 w-4 text-slate-500" /></div>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
