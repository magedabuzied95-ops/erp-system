import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, ShieldCheck, FileText, Trash2, Sparkles, Users, MessageCircle } from "lucide-react";

const SUPPORT_EMAIL = "support@m1store-eg.com";

const sectionsClass = "grid gap-4 md:grid-cols-2";
const cardClass =
  "rounded-[1.6rem] border border-slate-200/80 bg-white/88 p-5 shadow-[0_18px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,11,22,0.96),rgba(7,11,22,0.88))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]";
const badgeClass =
  "inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-300/20 dark:text-emerald-200";

const pageMeta = {
  privacy: {
    title: "Privacy Policy - M1 ERP System / M1 Store",
    label: "Privacy Policy",
    description: "ط³ظٹط§ط³ط© ط§ظ„ط®طµظˆطµظٹط© ط§ظ„ط®ط§طµط© ط¨ظ…ظ†طµط© M1 ERP System / M1 Store.",
    icon: ShieldCheck,
    accent: "emerald",
    lead:
      "طھظˆط¶ط­ ظ‡ط°ظ‡ ط§ظ„ط³ظٹط§ط³ط© ظƒظٹظپ ظٹط¬ظ…ط¹ M1 ERP System / M1 Store ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظ„ط§ط، ظˆظٹط³طھط®ط¯ظ…ظ‡ط§ ظ„ط¥ط¯ط§ط±ط© ط§ظ„ط·ظ„ط¨ط§طھطŒ ط®ط¯ظ…ط© ط§ظ„ط¹ظ…ظ„ط§ط،طŒ ط§ظ„ط±ط³ط§ط¦ظ„طŒ ظˆط§ظ„طھط­ظ„ظٹظ„ط§طھطŒ ظ…ط¹ ط§ظ„ط­ظپط§ط¸ ط¹ظ„ظ‰ ط§ظ„ط®طµظˆطµظٹط© ظˆطھظ‚ظ„ظٹظ„ ط§ظ„ظˆطµظˆظ„ ط؛ظٹط± ط§ظ„ط¶ط±ظˆط±ظٹ.",
  },
  terms: {
    title: "Terms of Service - M1 ERP System / M1 Store",
    label: "Terms of Service",
    description: "ط´ط±ظˆط· ط§ط³طھط®ط¯ط§ظ… ظ…ظ†طµط© M1 ERP System / M1 Store.",
    icon: FileText,
    accent: "amber",
    lead:
      "ط¨ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ظ†طµط© ط£ظ†طھ طھظˆط§ظپظ‚ ط¹ظ„ظ‰ ظ‡ط°ظ‡ ط§ظ„ط´ط±ظˆط·. ط§ظ„ظ…ظ†طµط© ظ…ط®طµطµط© ظ„ط¥ط¯ط§ط±ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھطŒ ط§ظ„ط¹ظ…ظ„ط§ط،طŒ ط§ظ„ط±ط³ط§ط¦ظ„طŒ ط§ظ„ط·ظ„ط¨ط§طھطŒ ظˆط§ظ„ظ…ط®ط²ظˆظ† ط¨ط´ظƒظ„ ظ…ظ†ط¸ظ… ظˆط¢ظ…ظ†.",
  },
  "data-deletion": {
    title: "Data Deletion - M1 ERP System / M1 Store",
    label: "Data Deletion",
    description: "طھط¹ظ„ظٹظ…ط§طھ ط­ط°ظپ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط®ط§طµط© ط¨ظ…ظ†طµط© M1 ERP System / M1 Store.",
    icon: Trash2,
    accent: "rose",
    lead:
      "ظٹظ…ظƒظ†ظƒ ط·ظ„ط¨ ط­ط°ظپ ط¨ظٹط§ظ†ط§طھظƒ ط§ظ„ظ…ط±طھط¨ط·ط© ط¨ط§ظ„ظ†ط¸ط§ظ… ظپظٹ ط£ظٹ ظˆظ‚طھ ط¹ط¨ط± ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ط¨ط¹ط¯ ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ظ‡ظˆظٹط© ظˆط§ظ„ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ظ…ط±طھط¨ط·ط© ط¨ط§ظ„ط­ط³ط§ط¨.",
  },
};

const accentMap = {
  emerald: {
    shell:
      "border-emerald-200/55 bg-[radial-gradient(circle_at_16%_0%,rgba(16,185,129,0.22),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(236,253,245,0.6))] dark:border-emerald-300/15 dark:bg-[radial-gradient(circle_at_16%_0%,rgba(16,185,129,0.16),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(16,185,129,0.06))]",
    hero:
      "from-emerald-500/18 via-white/65 to-white/90 dark:from-emerald-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-emerald-300/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100",
  },
  amber: {
    shell:
      "border-amber-200/55 bg-[radial-gradient(circle_at_84%_0%,rgba(245,158,11,0.22),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,251,235,0.64))] dark:border-amber-300/15 dark:bg-[radial-gradient(circle_at_84%_0%,rgba(245,158,11,0.16),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(245,158,11,0.06))]",
    hero:
      "from-amber-500/18 via-white/65 to-white/90 dark:from-amber-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-amber-300/25 bg-amber-500/10 text-amber-800 dark:text-amber-100",
  },
  rose: {
    shell:
      "border-rose-200/55 bg-[radial-gradient(circle_at_84%_0%,rgba(244,63,94,0.18),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,241,242,0.66))] dark:border-rose-300/15 dark:bg-[radial-gradient(circle_at_84%_0%,rgba(244,63,94,0.14),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(244,63,94,0.06))]",
    hero:
      "from-rose-500/18 via-white/65 to-white/90 dark:from-rose-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-rose-300/25 bg-rose-500/10 text-rose-800 dark:text-rose-100",
  },
};

const sectionsByPage = {
  privacy: [
    {
      title: "ظ…ط§ ط§ظ„ط°ظٹ ظ†ط¬ظ…ط¹ظ‡",
      icon: Users,
      items: [
        "ط§ظ„ط§ط³ظ…طŒ ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپطŒ ط§ظ„ط¹ظ†ظˆط§ظ†طŒ ظˆط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ط¹ظ†ط¯ طھظˆظپط±ظ‡.",
        "ط§ظ„ظ…ط­ط§ط¯ط«ط§طھ ظˆط§ظ„ط±ط³ط§ط¦ظ„ ط§ظ„ظ…طھط¹ظ„ظ‚ط© ط¨ط§ظ„ط·ظ„ط¨ط§طھ ط£ظˆ ط§ظ„ط¯ط¹ظ… ط£ظˆ ط§ظ„ظ…طھط§ط¨ط¹ط©.",
        "ط¨ظٹط§ظ†ط§طھ ط§ظ„ط·ظ„ط¨ط§طھطŒ ط§ظ„ظ…ظ†طھط¬ط§طھطŒ ط§ظ„ظ…ط¯ظپظˆط¹ط§طھطŒ ظˆط­ط§ظ„ط© ط§ظ„ط´ط­ظ† ظˆط§ظ„طھط³ظ„ظٹظ….",
        "ط¨ظٹط§ظ†ط§طھ ط§ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط£ط³ط§ط³ظٹط© ظ…ط«ظ„ ظ†ط´ط§ط· ط§ظ„ط¬ظ„ط³ط©طŒ ط§ظ„طھظپط§ط¹ظ„طŒ ظˆط³ط¬ظ„ط§طھ ط§ظ„ط£ط¯ط§ط،.",
      ],
    },
    {
      title: "ظƒظٹظپ ظ†ط³طھط®ط¯ظ… ط§ظ„ط¨ظٹط§ظ†ط§طھ",
      icon: MessageCircle,
      items: [
        "ط¥ط¯ط§ط±ط© ط§ظ„ط·ظ„ط¨ط§طھ ظˆط§ظ„ط¹ظ…ظ„ظٹط§طھ ط§ظ„طھط´ط؛ظٹظ„ظٹط© ط§ظ„ظ…ط±طھط¨ط·ط© ط¨ط§ظ„ظ…ط¨ظٹط¹ط§طھ.",
        "ط®ط¯ظ…ط© ط§ظ„ط¹ظ…ظ„ط§ط، ظˆط§ظ„ط±ط¯ ط¹ظ„ظ‰ ط§ظ„ط§ط³طھظپط³ط§ط±ط§طھ ظˆط§ظ„ظ…طھط§ط¨ط¹ط© ط¨ط¹ط¯ ط§ظ„ط¨ظٹط¹.",
        "طھط­ط³ظٹظ† ط§ظ„طھط¬ط±ط¨ط©طŒ ط§ظ„طھط­ظ„ظٹظ„ط§طھ ط§ظ„ط¯ط§ط®ظ„ظٹط©طŒ ظˆط§ظ„طھظ‚ط§ط±ظٹط± ط§ظ„طھط´ط؛ظٹظ„ظٹط©.",
        "ط±ط¨ط· ط§ظ„ظ…ط­ط§ط¯ط«ط§طھ ط¹ط¨ط± Meta APIs ظ…ط«ظ„ Messenger ظˆInstagram ظˆWhatsApp ط¹ظ†ط¯ ط§ظ„طھظپط¹ظٹظ„.",
      ],
    },
    {
      title: "ط§ظ„ط®طµظˆطµظٹط© ظˆط§ظ„ط§ظ†طھط´ط§ط±",
      icon: ShieldCheck,
      items: [
        "ظ„ط§ ظٹطھظ… ط¨ظٹط¹ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظ„ط§ط، ط¥ظ„ظ‰ ط£ظٹ ط·ط±ظپ ط«ط§ظ„ط«.",
        "ظ‚ط¯ طھطھظ… ظ…ط´ط§ط±ظƒط© ط§ظ„ط¨ظٹط§ظ†ط§طھ ظپظ‚ط· ظ…ط¹ ظ…ط²ظˆط¯ظٹ ط§ظ„ط®ط¯ظ…ط© ط§ظ„ط¶ط±ظˆط±ظٹظٹظ† ظ„طھط´ط؛ظٹظ„ ط§ظ„ظ…ظ†طµط© ط£ظˆ طھظ†ظپظٹط° ط§ظ„ط·ظ„ط¨ط§طھ.",
        "ظٹطھظ… ط§ظ„طھط¹ط§ظ…ظ„ ظ…ط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط¯ط§ط®ظ„ ط­ط¯ظˆط¯ ط§ظ„ظˆطµظˆظ„ ط§ظ„ظ…طµط±ط­ ط¨ظ‡ ظپظ‚ط·.",
        "ظٹظ…ظƒظ†ظƒ ط·ظ„ط¨ طھط¹ط¯ظٹظ„ ط£ظˆ ط­ط°ظپ ط¨ظٹط§ظ†ط§طھظƒ ط¹ط¨ط± ط§ظ„ط¨ط±ظٹط¯ ط§ظ„طھط§ظ„ظٹ: support@m1store-eg.com",
      ],
    },
    {
      title: "ط§ظ„ط§ط­طھظپط§ط¸ ظˆط§ظ„ط­ظ‚ظˆظ‚",
      icon: Sparkles,
      items: [
        "ظ†ط­طھظپط¸ ط¨ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ„ظ„ظ…ط¯ط© ط§ظ„ظ„ط§ط²ظ…ط© ظ„ظ„طھط´ط؛ظٹظ„طŒ ط§ظ„ط§ظ„طھط²ط§ظ…ط§طھ ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط©طŒ ظˆط¯ط¹ظ… ط§ظ„ط¹ظ…ظ„ط§ط،.",
        "ظٹظ…ظƒظ†ظƒ ط·ظ„ط¨ ط§ظ„ظˆطµظˆظ„ ط£ظˆ ط§ظ„طھط¹ط¯ظٹظ„ ط£ظˆ ط§ظ„ط­ط°ظپ ظ…طھظ‰ ط±ط؛ط¨طھ ط¹ط¨ط± ط§ظ„ط¨ط±ظٹط¯.",
        "ظ‚ط¯ ظ†ط­ط¯ط« ظ‡ط°ظ‡ ط§ظ„ط³ظٹط§ط³ط© ط¹ظ†ط¯ طھط؛ظٹط± ط§ظ„ط®ط¯ظ…ط§طھ ط£ظˆ ط§ظ„ظ…طھط·ظ„ط¨ط§طھ ط§ظ„طھظ†ط¸ظٹظ…ظٹط©.",
        "ظٹظڈط±ط¬ظ‰ ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط¨ط±ظٹط¯: support@m1store-eg.com",
      ],
    },
  ],
  terms: [
    {
      title: "ظ‚ط¨ظˆظ„ ط§ظ„ط´ط±ظˆط·",
      icon: ShieldCheck,
      items: [
        "ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ظ†طµط© ظٹط¹ظ†ظٹ ظ…ظˆط§ظپظ‚طھظƒ ط¹ظ„ظ‰ ط´ط±ظˆط· ط§ظ„ط®ط¯ظ…ط© ط§ظ„ط­ط§ظ„ظٹط© ظˆط£ظٹ طھط­ط¯ظٹط«ط§طھ ظ„ط§ط­ظ‚ط©.",
        "ط¥ط°ط§ ظ„ظ… طھظˆط§ظپظ‚ ط¹ظ„ظ‰ ط§ظ„ط´ط±ظˆط·طŒ ظٹط¬ط¨ ط§ظ„طھظˆظ‚ظپ ط¹ظ† ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ظ†طµط©.",
        "ظ‚ط¯ ظٹطھظ… طھط¹ط¯ظٹظ„ ط§ظ„ط´ط±ظˆط· ظ…ظ† ظˆظ‚طھ ظ„ط¢ط®ط± ظ„طھظ†ط§ط³ط¨ ط§ظ„طھط؛ظٹظٹط±ط§طھ ط§ظ„طھط´ط؛ظٹظ„ظٹط© ط£ظˆ ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط©.",
      ],
    },
    {
      title: "ط§ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ط³ظ…ظˆط­",
      icon: Users,
      items: [
        "ط§ظ„ظ…ظ†طµط© ظ…ط®طµطµط© ظ„ط¥ط¯ط§ط±ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھطŒ ط§ظ„ط¹ظ…ظ„ط§ط،طŒ ط§ظ„ط±ط³ط§ط¦ظ„طŒ ط§ظ„ط·ظ„ط¨ط§طھطŒ ظˆط§ظ„ظ…ط®ط²ظˆظ†.",
        "ظٹظ…ظƒظ† ط§ط³طھط®ط¯ط§ظ…ظ‡ط§ ط¶ظ…ظ† ط¥ط¬ط±ط§ط،ط§طھ ط§ظ„ط¹ظ…ظ„ ط§ظ„ظ…ط¹طھظ…ط¯ط© ط¯ط§ط®ظ„ M1 Store.",
        "ظٹط¬ط¨ ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط¨ظٹط§ظ†ط§طھ ظˆط§ظ„ط£ط¯ظˆط§طھ ط¨ظ…ط§ ظٹطھظˆط§ظپظ‚ ظ…ط¹ ط§ظ„ط³ظٹط§ط³ط§طھ ط§ظ„ط¯ط§ط®ظ„ظٹط© ظˆظ…طھط·ظ„ط¨ط§طھ Meta.",
      ],
    },
    {
      title: "ط§ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ط­ط¸ظˆط±",
      icon: Trash2,
      items: [
        "ظ…ظ…ظ†ظˆط¹ ط¥ط³ط§ط،ط© ط§ظ„ط§ط³طھط®ط¯ط§ظ… ط£ظˆ ظ…ط­ط§ظˆظ„ط© ط§ط®طھط±ط§ظ‚ ط§ظ„ظ†ط¸ط§ظ… ط£ظˆ طھط¬ط§ظˆط² ط§ظ„طµظ„ط§ط­ظٹط§طھ.",
        "ظ…ظ…ظ†ظˆط¹ ط¥ط±ط³ط§ظ„ ط±ط³ط§ط¦ظ„ ظ…ط²ط¹ط¬ط© ط£ظˆ ط؛ظٹط± ظ…ط±ط®طµط© ط£ظˆ ظ…ط®ط§ظ„ظپط© ظ„ط³ظٹط§ط³ط§طھ Meta.",
        "ظ…ظ…ظ†ظˆط¹ ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ظ†طµط© ظپظٹظ…ط§ ظٹط¶ط± ط§ظ„ط¹ظ…ظ„ط§ط، ط£ظˆ ط§ظ„ط³ظ…ط¹ط© ط£ظˆ ط³ظ„ط§ظ…ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ.",
      ],
    },
    {
      title: "ط§ظ„طھظˆط§طµظ„",
      icon: Mail,
      items: [
        "ظ„ظ„ط§ط³طھظپط³ط§ط±ط§طھ ط£ظˆ ط§ظ„ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ظ…طھط¹ظ„ظ‚ط© ط¨ط§ظ„ط´ط±ظˆط·طŒ طھظˆط§طµظ„ ظ…ط¹ ط§ظ„ط¯ط¹ظ….",
        "ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ظ…ط¹طھظ…ط¯: support@m1store-eg.com",
        "ظ‚ط¯ ظٹظڈط³طھط®ط¯ظ… ظ†ظپط³ ط§ظ„ط¨ط±ظٹط¯ ظ„ظ„ظ…طھط§ط¨ط¹ط© ط¹ظ„ظ‰ ط·ظ„ط¨ط§طھ ط§ظ„طھط¹ط¯ظٹظ„ ط£ظˆ ط§ظ„ط´ظƒط§ظˆظ‰.",
      ],
    },
  ],
  "data-deletion": [
    {
      title: "User Data Deletion Instructions",
      icon: Trash2,
      items: [
        "ط£ط±ط³ظ„ ط·ظ„ط¨ ط­ط°ظپ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط¥ظ„ظ‰ support@m1store-eg.com.",
        "ط§ط°ظƒط± ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ ط£ظˆ ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ط£ظˆ ط§ظ„طµظپط­ط© ط§ظ„ظ…ط±طھط¨ط·ط© ط¨ط§ظ„ط­ط³ط§ط¨ ط§ظ„ظ…ط±ط§ط¯ ط­ط°ظپظ‡.",
        "ط£ط¶ظپ ط£ظٹ طھظپط§طµظٹظ„ طھط³ط§ط¹ط¯ظ†ط§ ط¹ظ„ظ‰ طھط­ط¯ظٹط¯ ط§ظ„ط³ط¬ظ„ ط§ظ„طµط­ظٹط­ ط¨ط³ط±ط¹ط©.",
      ],
    },
    {
      title: "ظ…ط§ط°ط§ ظٹط­ط¯ط« ط¨ط¹ط¯ ط§ظ„ط·ظ„ط¨",
      icon: ShieldCheck,
      items: [
        "ظٹطھظ… ظ…ط±ط§ط¬ط¹ط© ط§ظ„ط·ظ„ط¨ ظˆط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‡ظˆظٹط© طµط§ط­ط¨ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ‚ط¨ظ„ ط§ظ„طھظ†ظپظٹط°.",
        "ط¨ط¹ط¯ ط§ظ„طھط­ظ‚ظ‚طŒ ظٹطھظ… ط­ط°ظپ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط£ظˆ طھط¹ط·ظٹظ„ظ‡ط§ ظˆظپظ‚ ظ…ط§ طھط³ظ…ط­ ط¨ظ‡ ط§ظ„ظ…طھط·ظ„ط¨ط§طھ ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط© ظˆط§ظ„طھط´ط؛ظٹظ„ظٹط©.",
        "ظ‚ط¯ طھط¨ظ‚ظ‰ ط¨ط¹ط¶ ط§ظ„ط³ط¬ظ„ط§طھ ط§ظ„ظپظ†ظٹط© ط§ظ„ظ…ط­ط¯ظˆط¯ط© ط¹ظ†ط¯ ط§ظ„ط­ط§ط¬ط© ظ„ظ„ط§ظ…طھط«ط§ظ„ ط£ظˆ ظ…ظ†ط¹ ط§ظ„ط¥ط³ط§ط،ط©.",
      ],
    },
    {
      title: "ظ†ط·ط§ظ‚ ط§ظ„ط­ط°ظپ",
      icon: Users,
      items: [
        "ظٹط´ظ…ظ„ ط§ظ„ط·ظ„ط¨ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط§طھطµط§ظ„طŒ ط§ظ„ظ…ط­ط§ط¯ط«ط§طھطŒ ط§ظ„ط·ظ„ط¨ط§طھطŒ ظˆط³ط¬ظ„ط§طھ ط§ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ط±طھط¨ط·ط©.",
        "ظ‚ط¯ ظٹظڈط³طھط«ظ†ظ‰ ظ…ط§ ظٹط¬ط¨ ط§ظ„ط§ط­طھظپط§ط¸ ط¨ظ‡ ظ‚ط§ظ†ظˆظ†ظٹظ‹ط§ ط£ظˆ ظ…ط­ط§ط³ط¨ظٹظ‹ط§ ط£ظˆ طھط´ط؛ظٹظ„ظٹظ‹ط§.",
        "ظ„ظ„ظ…طھط§ط¨ط¹ط©: support@m1store-eg.com",
      ],
    },
  ],
};

function LegalShell({ pageKey }) {
  const meta = pageMeta[pageKey];
  const accent = accentMap[meta.accent];
  const Icon = meta.icon;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    document.title = meta.title;
    return () => {
      document.title = previousTitle;
    };
  }, [meta.title]);

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f7f4ee_0%,#ffffff_38%,#f2f7f5_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_top,rgba(7,11,22,1),rgba(2,6,23,1)_60%,rgba(3,7,18,1)_100%)] dark:text-white">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_12%_18%,rgba(212,175,55,0.12),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.12),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.05),transparent_28%)] dark:bg-[radial-gradient(circle_at_12%_18%,rgba(212,175,55,0.10),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.08),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.05),transparent_28%)]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className={`overflow-hidden rounded-[2rem] border px-5 py-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-2xl ${accent.shell}`}>
          <div className={`rounded-[1.6rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,255,255,0.68))] p-5 dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))]`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-2xl">
                <span className={badgeClass}>{meta.label}</span>
                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{meta.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">{meta.lead}</p>
              </div>
              <div className={`grid h-16 w-16 place-items-center rounded-[1.5rem] border border-white/70 bg-white text-slate-950 shadow-[0_18px_40px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-white/5 dark:text-white ${accent.pill}`}>
                <Icon className="h-8 w-8" />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Link
                to="/"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:border-white/20"
              >
                <ArrowLeft className="h-4 w-4" />
                ط§ظ„ط¹ظˆط¯ط© ط¥ظ„ظ‰ ط§ظ„ظ…طھط¬ط±
              </Link>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-800 transition hover:-translate-y-0.5 hover:bg-emerald-500/15 dark:text-emerald-100"
              >
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          {sectionsByPage[pageKey].map((section) => {
            const SectionIcon = section.icon;
            return (
              <article key={section.title} className={cardClass}>
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-black tracking-tight">{section.title}</h2>
                </div>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className={`${cardClass} ${accent.hero}`}>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/60 bg-white text-slate-950 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-white">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">ط§ظ„طھظˆط§طµظ„ ط§ظ„ط±ط³ظ…ظٹ</h2>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">ظ„ط¬ظ…ظٹط¹ ط·ظ„ط¨ط§طھ ط§ظ„ط¯ط¹ظ… ط£ظˆ ط§ظ„ط®طµظˆطµظٹط© ط£ظˆ ط­ط°ظپ ط§ظ„ط¨ظٹط§ظ†ط§طھ.</p>
              </div>
            </div>
            <div className="mt-4 rounded-[1.3rem] border border-slate-200 bg-white/90 p-4 text-sm leading-7 text-slate-700 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-200">
              <p className="font-bold">M1 ERP System / M1 Store</p>
              <p className="mt-2">ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ظ…ط¹طھظ…ط¯: <a className="font-black text-emerald-700 underline decoration-emerald-300 decoration-2 underline-offset-4 dark:text-emerald-200" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
              <p className="mt-2">ظٹظ…ظƒظ†ظƒ ط§ط³طھط®ط¯ط§ظ… ظ†ظپط³ ط§ظ„ط¨ط±ظٹط¯ ظ„ط·ظ„ط¨ط§طھ ط§ظ„طھط¹ط¯ظٹظ„طŒ ط§ظ„ط­ط°ظپطŒ ط£ظˆ ط£ظٹ ط§ط³طھظپط³ط§ط± ظ…طھط¹ظ„ظ‚ ط¨ط³ظٹط§ط³ط§طھ ط§ظ„ظ…ظ†طµط©.</p>
            </div>
          </article>

          <article className={cardClass}>
            <h2 className="text-lg font-black tracking-tight">ط±ظˆط§ط¨ط· ط³ط±ظٹط¹ط©</h2>
            <div className="mt-4 grid gap-3">
              <Link to="/privacy" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:text-emerald-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-emerald-200">Privacy Policy</Link>
              <Link to="/terms" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-amber-300/50 hover:text-amber-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-amber-200">Terms of Service</Link>
              <Link to="/data-deletion" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-rose-300/50 hover:text-rose-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-rose-200">Data Deletion</Link>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

export function PrivacyPage() {
  return <LegalShell pageKey="privacy" />;
}

export function TermsPage() {
  return <LegalShell pageKey="terms" />;
}

export function DataDeletionPage() {
  return <LegalShell pageKey="data-deletion" />;
}
