import { useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Hash,
  Image as ImageIcon,
  Megaphone,
  Plus,
  Save,
  Send,
  Sparkles,
  Target,
  Users,
  Wand2,
  X,
  Zap,
} from "lucide-react";

const defaultPost = {
  title: "",
  caption: "",
  hashtags: "",
  image_url: "",
  media_urls: [],
  channel: "facebook",
  scheduled_at: "",
};

const previewTabs = [
  { id: "facebook", label: "Facebook Preview" },
  { id: "instagram", label: "Instagram Preview" },
  { id: "story", label: "Story Preview" },
];

const captionStyles = [
  { id: "casual", label: "Casual", tone: "friendly" },
  { id: "luxury", label: "Luxury", tone: "premium" },
  { id: "offer", label: "Offer", tone: "sales-focused" },
  { id: "urgency", label: "Urgency", tone: "scarcity" },
];

const toDatetimeLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const fromDatetimeLocal = (date) => {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const unique = (items = []) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const normalizeHash = (value) => {
  const clean = String(value || "").trim().replace(/^#+/, "");
  return clean ? `#${clean.replace(/\s+/g, "_")}` : "";
};

const parseHashtags = (value) =>
  unique(
    String(value || "")
      .split(/[\s,]+/)
      .map(normalizeHash)
  );

const extractPrice = (caption = "") => {
  const match = String(caption).match(/(\d+(?:[.,]\d+)?)/);
  return match ? match[1] : "";
};

const getNextFridayNight = () => {
  const date = new Date();
  const day = date.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(21, 0, 0, 0);
  return date;
};

const makeSchedulePreset = (id) => {
  const date = new Date();
  if (id === "tonight") {
    date.setHours(20, 0, 0, 0);
    if (date.getTime() < Date.now()) date.setDate(date.getDate() + 1);
    return fromDatetimeLocal(date);
  }
  if (id === "morning") {
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
    return fromDatetimeLocal(date);
  }
  return fromDatetimeLocal(getNextFridayNight());
};

const captionBank = {
  casual: [
    ({ productName, price }) =>
      `وصل جديد وحلو جدا\n${productName}\n\nستايل سهل يليق على كل يوم، ومتوفر بتفاصيل مميزة.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاطلبه دلوقتي وخليك سابق بخطوة ✨`,
    ({ productName, price }) =>
      `جديد عندنا\n${productName}\n\nاختيار عملي وشيك في نفس الوقت، مناسب للخروج والشغل وكل مشاويرك.\n${price ? `ابتداء من ${price} ج.م\n` : ""}\nابعتلنا واحجز مقاسك.`,
  ],
  luxury: [
    ({ productName, price }) =>
      `إطلالة بتفاصيل أرقى\n${productName}\n\nتصميم مختار بعناية لعشاق الذوق الهادئ والجودة العالية.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاختيارك لما تحب تميزك يبان.`,
    ({ productName, price }) =>
      `رفاهية في التفاصيل\n${productName}\n\nقطعة تضيف حضور أقوى لإطلالتك، بخامة ولمسة تناسب الاختيارات الراقية.\n${price ? `متاح ابتداء من ${price} ج.م\n` : ""}\nاحجزه الآن.`,
  ],
  offer: [
    ({ productName, price }) =>
      `عرض مميز على ${productName}\n\nلو كنت مستني الفرصة المناسبة، فهي دلوقتي.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاطلبه الآن واستفد بالعرض قبل ما ينتهي.`,
    ({ productName, price }) =>
      `${productName} بسعر مناسب جدا\n\nمنتج عملي، شكل مميز، وقيمة ممتازة مقابل السعر.\n${price ? `ابتداء من ${price} ج.م\n` : ""}\nكلمنا واحجز قبل انتهاء الكمية.`,
  ],
  urgency: [
    ({ productName, price }) =>
      `الكمية محدودة\n${productName}\n\nالمقاسات والألوان المميزة بتخلص بسرعة.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاطلبه الآن قبل نفاد الكمية ✨`,
    ({ productName, price }) =>
      `آخر فرصة للحجز\n${productName}\n\nالطلب عليه عالي والكمية المتاحة محدودة.\n${price ? `متاح ابتداء من ${price} ج.م\n` : ""}\nابعتلنا دلوقتي قبل ما يخلص.`,
  ],
};

const PlatformShell = ({ form, hashtags, type, mediaUrls = [] }) => {
  const image = form.image_url;
  const carousel = unique([image, ...mediaUrls]);
  const caption = form.caption || "Your caption will appear here.";
  const title = form.title || "Untitled post";

  if (type === "instagram") {
    return (
      <div className="mx-auto w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/10 bg-[#080b14] shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 p-[2px]">
              <div className="h-full w-full rounded-full bg-slate-950" />
            </div>
            <div>
              <div className="text-sm font-black text-white">erp.store</div>
              <div className="text-xs text-slate-400">Sponsored</div>
            </div>
          </div>
          <div className="text-lg text-slate-400">...</div>
        </div>
        <div className="relative aspect-square bg-slate-950">
          {image ? <img src={image} alt={title} className="h-full w-full object-cover" /> : <EmptyMedia />}
          {carousel.length > 1 ? (
            <div className="absolute bottom-3 right-3 rounded-full bg-black/65 px-3 py-1 text-xs font-black text-white backdrop-blur">
              1/{carousel.length}
            </div>
          ) : null}
        </div>
        {carousel.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto border-b border-white/10 p-3">
            {carousel.slice(0, 6).map((url, index) => (
              <div key={url} className={`h-12 w-12 shrink-0 overflow-hidden rounded-xl border ${index === 0 ? "border-cyan-300" : "border-white/10"}`}>
                <img src={url} alt={`Instagram media ${index + 1}`} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}
        <div className="space-y-3 p-4">
          <div className="flex gap-4 text-2xl text-white">
            <span>♡</span>
            <span>◌</span>
            <span>↗</span>
          </div>
          <div className="text-sm font-bold text-white">1,248 likes</div>
          <div className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
            <span className="font-black text-white">erp.store </span>
            {caption}
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold text-cyan-200">
            {hashtags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      </div>
    );
  }

  if (type === "story") {
    return (
      <div className="mx-auto flex w-full max-w-[360px] justify-center">
        <div className="relative aspect-[9/16] max-h-[650px] w-full overflow-hidden rounded-[34px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/40">
          {image ? <img src={image} alt={title} className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-950" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/15 to-black/75" />
          <div className="absolute left-4 right-4 top-4 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-white/80" />
            <div className="h-1 flex-1 rounded-full bg-white/35" />
            <div className="h-1 flex-1 rounded-full bg-white/35" />
          </div>
          <div className="absolute left-5 right-5 top-9 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full border border-white/30 bg-white/20" />
            <div>
              <div className="text-sm font-black text-white">erp.store</div>
              <div className="text-xs text-white/70">Now</div>
            </div>
          </div>
          <div className="absolute inset-x-5 bottom-20 rounded-[24px] border border-white/15 bg-black/35 p-4 backdrop-blur-md">
            <div className="text-2xl font-black leading-tight text-white">{title}</div>
            <div className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-white/90">{caption}</div>
          </div>
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white px-5 py-3 text-sm font-black text-black">
            اطلب الآن
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-[28px] border border-white/10 bg-[#101827] shadow-2xl shadow-black/30">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500 text-lg font-black text-white">f</div>
        <div>
          <div className="text-sm font-black text-white">ERP Store</div>
          <div className="text-xs text-slate-400">Sponsored · Public</div>
        </div>
      </div>
      <div className="px-5 pb-4">
        <div className="text-lg font-black text-white">{title}</div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{caption}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold text-cyan-200">
          {hashtags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
      <div className="relative min-h-[340px] bg-slate-950">
        {image ? <img src={image} alt={title} className="h-full max-h-[520px] min-h-[340px] w-full object-cover" /> : <EmptyMedia />}
        {carousel.length > 1 ? (
          <div className="absolute right-4 top-4 rounded-full bg-black/65 px-3 py-1 text-xs font-black text-white backdrop-blur">
            {carousel.length} photos
          </div>
        ) : null}
      </div>
      {carousel.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-white/10 p-3">
          {carousel.slice(0, 7).map((url, index) => (
            <div key={url} className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl border ${index === 0 ? "border-cyan-300" : "border-white/10"}`}>
              <img src={url} alt={`Facebook media ${index + 1}`} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-3 border-t border-white/10 text-center text-sm font-bold text-slate-300">
        <div className="py-3">Like</div>
        <div className="py-3">Comment</div>
        <div className="py-3">Share</div>
      </div>
    </div>
  );
};

const EmptyMedia = () => (
  <div className="flex h-full min-h-[280px] items-center justify-center border border-dashed border-white/10 text-slate-500">
    <div className="text-center">
      <ImageIcon className="mx-auto h-8 w-8" />
      <div className="mt-2 text-sm">No media selected</div>
    </div>
  </div>
);

export default function PostEditorModal({
  open,
  post,
  onClose,
  onSaveDraft,
  onPublish,
  onSchedule,
  saving = false,
  title = "Marketing post",
}) {
  const initial = useMemo(() => ({ ...defaultPost, ...(post || {}) }), [post]);
  const initialTags = useMemo(() => parseHashtags(initial.hashtags), [initial.hashtags]);
  const [form, setForm] = useState({ ...initial, hashtags: initialTags.join(" ") });
  const [hashtags, setHashtags] = useState(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocal(initial.scheduled_at));
  const [activePreview, setActivePreview] = useState(initial.channel === "instagram" ? "instagram" : "facebook");
  const [captionSeed, setCaptionSeed] = useState(0);

  const mediaUrls = useMemo(
    () => unique([form.image_url, ...(Array.isArray(form.media_urls) ? form.media_urls : [])]),
    [form.image_url, form.media_urls]
  );

  const productName = form.product_name || form.title || "المنتج";
  const price = form.price || extractPrice(form.caption);

  const stats = useMemo(() => {
    const tagScore = Math.max(0, 10 - Math.max(0, hashtags.length - 5) * 2);
    const captionScore = Math.min(40, Math.max(18, Math.round((form.caption || "").length / 7)));
    const imageScore = form.image_url ? 32 : 12;
    const engagement = Math.min(98, captionScore + imageScore + tagScore + 12);
    return {
      reach: `${(1800 + engagement * 37).toLocaleString()}-${(3400 + engagement * 52).toLocaleString()}`,
      time: scheduledAt ? "Scheduled window" : "Tonight 8:00 PM",
      audience: form.channel === "instagram" ? "Fashion shoppers, 18-34" : "Returning customers + lookalikes",
      engagement,
    };
  }, [form.caption, form.channel, form.image_url, hashtags.length, scheduledAt]);

  if (!open) return null;

  const syncHashtags = (nextTags) => {
    const normalized = unique(nextTags.map(normalizeHash));
    setHashtags(normalized);
    setForm((current) => ({ ...current, hashtags: normalized.join(" ") }));
  };

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const updateChannel = (value) => {
    updateField("channel", value);
    if (value === "instagram") {
      setActivePreview("instagram");
    } else if (value === "facebook" || value === "all") {
      setActivePreview("facebook");
    }
  };

  const selectMainImage = (url) => {
    setForm((current) => ({
      ...current,
      image_url: url,
      media_urls: unique([url, ...(Array.isArray(current.media_urls) ? current.media_urls : [])]),
    }));
  };

  const applyCaptionStyle = (styleId, increment = 0) => {
    const variants = captionBank[styleId] || captionBank.casual;
    const nextIndex = (captionSeed + increment) % variants.length;
    const nextCaption = variants[nextIndex]({ productName, price });
    setCaptionSeed((current) => current + 1);
    updateField("caption", nextCaption);
  };

  const addTag = () => {
    const next = normalizeHash(tagInput);
    if (!next) return;
    syncHashtags([...hashtags, next]);
    setTagInput("");
  };

  const handleTagKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTag();
  };

  const handleSubmit = async (action) => {
    const payload = {
      ...form,
      hashtags: hashtags.join(" "),
      media_urls: unique([form.image_url, ...mediaUrls]),
      scheduled_at: scheduledAt || form.scheduled_at || null,
    };
    if (action === "publish") return onPublish?.(payload);
    if (action === "schedule") return onSchedule?.(payload, scheduledAt || form.scheduled_at || null);
    return onSaveDraft?.(payload);
  };

  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/75 p-2 backdrop-blur-md transition-opacity duration-200 md:items-center md:p-4">
      <div className="flex max-h-[96vh] w-full max-w-[1480px] animate-[fadeIn_180ms_ease-out] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[#0b1020] shadow-2xl shadow-black/50 ring-1 ring-cyan-400/10">
        <div className="flex flex-col gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
              <Megaphone className="h-4 w-4" />
              {title}
            </div>
            <h3 className="mt-1 truncate text-xl font-black text-white md:text-2xl">{form.title || "Untitled post"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[390px_minmax(0,1fr)] xl:grid-cols-[410px_minmax(520px,1fr)_310px]">
          <div className="space-y-5 border-b border-white/10 p-4 md:p-5 lg:border-b-0 lg:border-r">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Channel</span>
                <select
                  value={form.channel}
                  onChange={(event) => updateChannel(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                >
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="all">All channels</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Title</span>
                <input
                  value={form.title || ""}
                  onChange={(event) => updateField("title", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                  placeholder="Marketing post title"
                />
              </label>
            </div>

            <div className="rounded-3xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4 shadow-lg shadow-cyan-950/10">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Wand2 className="h-4 w-4 text-cyan-300" />
                  AI Caption Variants
                </div>
                <button
                  type="button"
                  onClick={() => applyCaptionStyle(captionStyles[captionSeed % captionStyles.length].id, 1)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-500/10"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Another Caption
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {captionStyles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => applyCaptionStyle(style.id)}
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-left transition hover:border-cyan-400/30 hover:bg-cyan-500/10"
                  >
                    <div className="text-sm font-black text-white">{style.label}</div>
                    <div className="text-xs text-slate-400">{style.tone}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Caption</span>
              <textarea
                value={form.caption || ""}
                onChange={(event) => updateField("caption", event.target.value)}
                rows={9}
                dir="auto"
                className="w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                placeholder="Post caption"
              />
            </label>

            <div className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Hash className="h-4 w-4 text-cyan-300" />
                Hashtags
              </div>
              <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-2">
                {hashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => syncHashtags(hashtags.filter((item) => item !== tag))}
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-bold text-cyan-100 transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-100"
                  >
                    {tag}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  className="min-w-[120px] flex-1 bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-500"
                  placeholder="Add tag and press Enter"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white transition hover:bg-cyan-500/10"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <ImageIcon className="h-4 w-4 text-cyan-300" />
                Media
              </div>
              <div className="relative">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={form.image_url || ""}
                  onChange={(event) => updateField("image_url", event.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                />
              </div>
              {mediaUrls.length > 1 ? (
                <div className="grid grid-cols-4 gap-2">
                  {mediaUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => selectMainImage(url)}
                      className={`group relative aspect-square overflow-hidden rounded-2xl border transition ${
                        form.image_url === url ? "border-cyan-300 shadow-lg shadow-cyan-500/20" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <img src={url} alt={`Media ${index + 1}`} className="h-full w-full object-cover transition group-hover:scale-105" />
                      {form.image_url === url ? <span className="absolute inset-x-1 bottom-1 rounded-full bg-cyan-400 px-2 py-1 text-[10px] font-black text-black">Main</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 space-y-4 bg-[#070b16] p-4 md:p-5">
            <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-1">
              {previewTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActivePreview(tab.id)}
                  className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${
                    activePreview === tab.id ? "bg-cyan-400 text-black shadow-lg shadow-cyan-500/20" : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="rounded-[30px] border border-white/10 bg-gradient-to-br from-slate-950 via-[#111827] to-slate-950 p-3 shadow-2xl shadow-black/30 md:p-6">
              <PlatformShell form={form} hashtags={hashtags} type={activePreview} mediaUrls={mediaUrls} />
            </div>
            {mediaUrls.length > 1 ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const index = Math.max(0, mediaUrls.indexOf(form.image_url));
                    selectMainImage(mediaUrls[(index - 1 + mediaUrls.length) % mediaUrls.length]);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Selected preview image</span>
                <button
                  type="button"
                  onClick={() => {
                    const index = Math.max(0, mediaUrls.indexOf(form.image_url));
                    selectMainImage(mediaUrls[(index + 1) % mediaUrls.length]);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 border-t border-white/10 bg-white/[0.03] p-4 md:p-5 xl:border-l xl:border-t-0">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
              <StatCard icon={Users} label="Estimated Reach" value={stats.reach} tone="cyan" />
              <StatCard icon={Clock3} label="Best Posting Time" value={stats.time} tone="emerald" />
              <StatCard icon={Target} label="Suggested Audience" value={stats.audience} tone="amber" />
              <StatCard icon={BarChart3} label="Engagement Score" value={`${stats.engagement}/100`} tone="rose" />
            </div>

            <div className="space-y-3 rounded-3xl border border-white/10 bg-slate-950/80 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <CalendarClock className="h-4 w-4 text-cyan-300" />
                Schedule
              </div>
              <div className="grid gap-2">
                {[
                  ["tonight", "Tonight 8 PM"],
                  ["morning", "Tomorrow Morning"],
                  ["friday", "Friday Night"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setScheduledAt(makeSchedulePreset(id))}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-white transition hover:border-cyan-400/30 hover:bg-cyan-500/10"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
              />
              <div className="text-xs text-slate-400">
                Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time"}
              </div>
            </div>

            <div className="space-y-3 rounded-3xl border border-white/10 bg-slate-950/80 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Zap className="h-4 w-4 text-amber-300" />
                Smart Suggestions
              </div>
              {["Best for Facebook", "High engagement wording", "Use fewer hashtags", "Add discount CTA"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                  <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-lg shadow-cyan-400/40" />
                  {item}
                </div>
              ))}
            </div>

            <div className="grid gap-3">
              {onSaveDraft ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSubmit("save")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:bg-emerald-400 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  Save Draft
                </button>
              ) : null}
              {onPublish ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSubmit("publish")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/10 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  Publish Now
                </button>
              ) : null}
              {onSchedule ? (
                <button
                  type="button"
                  disabled={saving || (!scheduledAt && !form.scheduled_at)}
                  onClick={() => handleSubmit("schedule")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-black text-cyan-100 shadow-lg shadow-cyan-500/10 transition hover:-translate-y-0.5 hover:bg-cyan-500/20 disabled:opacity-60"
                >
                  <CalendarClock className="h-4 w-4" />
                  Schedule
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }) {
  const tones = {
    cyan: "text-cyan-200 bg-cyan-500/10 border-cyan-500/20",
    emerald: "text-emerald-200 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-200 bg-amber-500/10 border-amber-500/20",
    rose: "text-rose-200 bg-rose-500/10 border-rose-500/20",
  };
  return (
    <div className={`rounded-3xl border p-4 ${tones[tone] || tones.cyan}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-lg font-black text-white">{value}</div>
    </div>
  );
}
