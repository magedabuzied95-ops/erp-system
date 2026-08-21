// Draws one block of an invoice in the React tree.
//
// Built-in sections are handed in already rendered by whoever owns their markup — the
// card keeps drawing its own header, table and totals — so turning the layout into data
// changed none of them. Everything else here is a block the operator added, or one of
// the three sections that used to live in the public invoice page's own JSX.

import { useEffect, useState } from "react";
import { ExternalLink, MessageCircle, ShieldCheck, Star } from "lucide-react";

import {
  localizedBlockText,
  resolveBarcodeValue,
  resolveFieldRowValue,
  resolveQrValue,
  qrSvgMarkup,
} from "../../../../shared/invoiceBlocks.js";

const ALIGN_CLASS = { start: "text-start", center: "text-center", end: "text-end" };
const FLEX_ALIGN_CLASS = { start: "justify-start", center: "justify-center", end: "justify-end" };
const SIZE_CLASS = { sm: "text-xs leading-5", md: "text-sm leading-6", lg: "text-base leading-7" };

function QrBlock({ block, invoice, language }) {
  const [markup, setMarkup] = useState("");
  const value = resolveQrValue(block, invoice);

  useEffect(() => {
    let active = true;
    if (!value) {
      setMarkup("");
      return undefined;
    }
    // qrcode is only pulled in when a template actually carries a QR block, so the
    // customer's invoice page does not pay for it by default.
    import("qrcode")
      .then((module) => {
        if (!active) return;
        setMarkup(qrSvgMarkup(value, { size: block.size_px }, (module.default || module).create));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, block.size_px]);

  if (!markup) return null;
  const caption = localizedBlockText(block.caption, language);
  return (
    <div className={`flex flex-col items-center gap-2 ${FLEX_ALIGN_CLASS[block.align] || "justify-start"}`}>
      <div dangerouslySetInnerHTML={{ __html: markup }} />
      {caption ? <div className="text-xs font-bold text-stone-500">{caption}</div> : null}
    </div>
  );
}

function BarcodeBlock({ block, invoice }) {
  const [markup, setMarkup] = useState("");
  const value = resolveBarcodeValue(block, invoice);

  useEffect(() => {
    let active = true;
    if (!value) {
      setMarkup("");
      return undefined;
    }
    // Same reasoning as the QR block: the barcode generator is a large module and most
    // invoices never carry one.
    import("../../../modules/products/lib/barcodeLabels")
      .then((module) => {
        if (!active) return;
        setMarkup(module.getBarcodeSvg(value, { width: 360, height: 92, displayText: value }) || "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value]);

  if (!markup) return null;
  return <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: markup }} />;
}

const policyLines = (template, language) => {
  if (!template?.footer?.return_policy_enabled) return [];
  const text = language === "en" && template.footer.return_policy_en
    ? template.footer.return_policy_en
    : template.footer.return_policy_ar;
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
};

// Egypt local number -> international wa.me form, derived from the chat number when the
// store has one and from the support line otherwise, so there is one phone to maintain.
const whatsappHref = (template) => {
  const number = String(template?.social?.whatsapp_number || template?.identity?.phone || "").replace(/[^\d+]/g, "");
  return number ? `https://wa.me/2${number.replace(/^0+/, "")}` : "";
};

const socialLinks = (template, language, invoice) => {
  if (!template?.social?.enabled) return [];
  const isArabic = language !== "en";
  // A review link the ORDER carries wins over the template's, because a store that
  // stamps a per-order link means it.
  const override = invoice?.socialOverrides || {};
  return [
    { key: "google", label: isArabic ? "قيّمنا على Google" : "Rate us on Google", url: override.google_review_url || template.social.google_review_url, icon: Star },
    { key: "facebook", label: isArabic ? "قيّمنا على Facebook" : "Rate us on Facebook", url: override.facebook_review_url || template.social.facebook_review_url, icon: ExternalLink },
    { key: "instagram", label: isArabic ? "تابعنا على Instagram" : "Follow us on Instagram", url: override.instagram_url || template.social.instagram_url, icon: ExternalLink },
    { key: "whatsapp", label: isArabic ? "تواصل معنا واتساب" : "Chat on WhatsApp", url: whatsappHref(template), icon: MessageCircle },
  ].filter((link) => link.url);
};

export default function InvoiceBlockView({
  block,
  builtIn = null,
  invoice = {},
  template = {},
  language = "ar",
  luxury = false,
  formatDate = (value) => String(value ?? ""),
  money = (value) => String(value ?? ""),
}) {
  const align = ALIGN_CLASS[block?.align] || ALIGN_CLASS.start;

  switch (block?.type) {
    // Sections whose markup belongs to the renderer that mounted this component.
    case "brand":
    case "order_meta":
    case "customer_meta":
    case "items_table":
    case "totals":
      return builtIn || null;

    case "policy": {
      const lines = policyLines(template, language);
      if (!lines.length) return null;
      return (
        <div className={`mx-5 mb-5 rounded-[1.25rem] border p-4 text-xs font-bold leading-6 ${luxury ? "border-amber-200/80 bg-[#fffaf0] text-slate-600" : "border-amber-200 bg-amber-50/70 text-stone-600"}`}>
          <div className="flex items-start gap-3 text-start">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="space-y-1">
              {lines.map((line) => <div key={line}>{line}</div>)}
            </div>
          </div>
        </div>
      );
    }

    case "social": {
      const links = socialLinks(template, language, invoice);
      if (!links.length) return null;
      return (
        <div className="mx-5 mb-5 grid gap-2 sm:grid-cols-2">
          {links.map(({ key, label, url, icon: Icon }) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-black text-stone-700"
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate">{label}</span>
            </a>
          ))}
        </div>
      );
    }

    case "store_contact": {
      const phone = template?.identity?.phone || "";
      const websiteText = template?.identity?.website_text || "";
      const websiteUrl = template?.identity?.website_url || "";
      const address = template?.identity?.address || "";
      if (!phone && !websiteText && !address) return null;
      return (
        <div className="mx-5 mb-5 rounded-[var(--radius-card)] border border-stone-200 bg-stone-50 px-4 py-3 text-center text-xs font-bold text-stone-600">
          <div className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-4" dir="ltr">
            {websiteText && websiteUrl ? <a href={websiteUrl} target="_blank" rel="noopener noreferrer">{websiteText}</a> : null}
            {phone ? <a href={`tel:${phone}`}>{phone}</a> : null}
          </div>
          {address ? <div className="mt-1" dir="auto">{address}</div> : null}
        </div>
      );
    }

    case "text": {
      const content = localizedBlockText(block.content, language);
      if (!content) return null;
      return (
        <div className={`mx-5 mb-4 whitespace-pre-wrap ${align} ${SIZE_CLASS[block.size] || SIZE_CLASS.md} ${block.bold ? "font-black" : "font-bold"} ${block.boxed ? "rounded-[var(--radius-card)] border border-stone-200 bg-stone-50 p-3" : ""} text-stone-700`}>
          {content}
        </div>
      );
    }

    case "image": {
      if (!block.url) return null;
      return (
        <div className={`mx-5 mb-4 flex ${FLEX_ALIGN_CLASS[block.align] || "justify-start"}`}>
          <img src={block.url} alt="" style={{ width: `${block.width_pct}%` }} className="h-auto max-w-full rounded-[var(--radius-card)]" />
        </div>
      );
    }

    case "qr":
      return (
        <div className="mx-5 mb-4">
          <QrBlock block={block} invoice={invoice} language={language} />
        </div>
      );

    case "barcode":
      return (
        <div className="mx-5 mb-4">
          <BarcodeBlock block={block} invoice={invoice} />
        </div>
      );

    case "field_row": {
      const label = localizedBlockText(block.label, language);
      const value = resolveFieldRowValue(block, invoice, { money, formatDate });
      if (!label && !value) return null;
      return (
        <div className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-bold text-stone-700">
          <span className="text-stone-500">{label}</span>
          <span className="font-black text-stone-950">{value}</span>
        </div>
      );
    }

    case "divider":
      return <div className="mx-5 mb-4 h-px bg-stone-200" />;

    case "spacer":
      return <div style={{ height: `${block.height_px}px` }} />;

    default:
      return null;
  }
}
