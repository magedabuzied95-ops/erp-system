// WhatsApp API guide — inbox top bar → WhatsApp → API Guide.
//
// A Getting Started guide for OUR public WhatsApp API, written against what the server actually
// does: server/routes/whatsappPublicApi.js (mounted at /api/public/whatsapp) and
// server/services/whatsappApiAccessService.js (keys, sends, webhooks, rate limit). When either
// changes, this page must change with it. Prose is translated; code stays English.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";

import { API_ORIGIN } from "../../../../shared/constants/app.js";

const MOUNT_PATH = "/api/public/whatsapp";

function CodeBlock({ code, label = "" }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/80">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500" dir="ltr">{label}</span>
        <button type="button" onClick={copy} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-black text-slate-300 transition hover:bg-white/10">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? t("waOfficialAnalytics.guide.copied") : t("waOfficialAnalytics.guide.copy")}
        </button>
      </div>
      <pre dir="ltr" className="overflow-x-auto p-3 text-start text-[12px] leading-5 text-slate-200"><code>{code}</code></pre>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <h3 className="text-base font-black text-white">{title}</h3>
      {children}
    </section>
  );
}

const P = ({ children }) => <p className="text-[13px] leading-7 text-slate-300">{children}</p>;
const Mono = ({ children }) => <code dir="ltr" className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[12px] text-cyan-100">{children}</code>;

function Endpoint({ method, path }) {
  const tone = method === "GET" ? "bg-sky-400/15 text-sky-200" : "bg-emerald-400/15 text-emerald-200";
  return (
    <div className="flex flex-wrap items-center gap-2" dir="ltr">
      <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${tone}`}>{method}</span>
      <code className="text-[13px] font-bold text-white">{path}</code>
    </div>
  );
}

function SimpleTable({ head, rows }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[560px] text-xs">
        <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.1em] text-slate-500">
          <tr>{head.map((cell) => <th key={cell} className="px-3 py-2 text-start">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("|")} className="border-t border-white/5 align-top text-slate-200">
              {row.map((cell, index) => (
                <td key={index} className="px-3 py-2" dir={index < row.length - 1 ? "ltr" : undefined}>
                  {index < row.length - 1 ? <code className="text-[11.5px]">{cell}</code> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WhatsAppApiGuidePanel() {
  const { t } = useTranslation();
  const base = `${String(API_ORIGIN || "").replace(/\/+$/, "")}${MOUNT_PATH}`;
  const g = (key, options) => t(`waOfficialAnalytics.guide.${key}`, options);

  const sections = [
    ["auth", g("auth.title")],
    ["accounts", g("accounts.title")],
    ["templates", g("templates.title")],
    ["send-template", g("sendTemplate.title")],
    ["send-session", g("session.title")],
    ["status", g("status.title")],
    ["webhooks", g("webhooks.title")],
    ["errors", g("errors.title")],
    ["limits", g("limits.title")],
  ];

  const curlAuth = `curl "${base}/accounts" \\
  -H "Authorization: Bearer m1wa_YOUR_KEY"

# or
curl "${base}/accounts" \\
  -H "X-API-Key: m1wa_YOUR_KEY"`;

  const accountsResponse = `{
  "success": true,
  "accounts": [
    {
      "id": "123456789012345",
      "name": "M1 Store",
      "phone_number": "+20 10 0000 0000",
      "verified_name": "M1 Store",
      "status": "connected"
    }
  ]
}`;

  const templatesCurl = `curl "${base}/templates?status=approved" \\
  -H "Authorization: Bearer m1wa_YOUR_KEY"`;

  const templatesResponse = `{
  "success": true,
  "templates": [
    {
      "id": "1234567890",
      "local_id": 12,
      "name": "order_update",
      "language": "ar",
      "status": "approved",
      "category": "utility",
      "header": { "format": "image", "text": "" },
      "body": "Hello {{1}}, your order {{2}} is on its way",
      "variables": [
        { "key": "1", "example": "Ahmed" },
        { "key": "2", "example": "#1042" }
      ],
      "buttons_variables": [
        { "index": 0, "type": "URL", "example": "1042" }
      ],
      "footer": "",
      "buttons": [
        {
          "index": 0, "type": "URL", "text": "Track order",
          "url": "https://example.com/track/{{1}}", "phone_number": "",
          "is_dynamic_url": true, "variable": "0"
        }
      ]
    }
  ]
}`;

  const sendTemplateCurl = `curl -X POST "${base}/messages/template" \\
  -H "Authorization: Bearer m1wa_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "201000000000",
    "template_name": "order_update",
    "language": "ar",
    "variables": ["Ahmed", "#1042"]
  }'`;

  const sendTemplateObject = `{
  "to": "201000000000",
  "template": "order_update",
  "language": "ar",
  "variables": { "1": "Ahmed", "2": "#1042" }
}

// named variables (templates created with {{first_name}}-style placeholders)
{
  "to": "201000000000",
  "template": "welcome_named",
  "variables": { "first_name": "Ahmed" }
}`;

  const sendTemplateMedia = `{
  "to": "201000000000",
  "template_name": "new_collection",
  "language": "ar",
  "header": { "type": "image", "url": "https://cdn.example.com/banner.jpg" },
  "variables": ["Ahmed"],
  "buttons_variables": { "0": "summer-2026" }
}

// document header
"header": { "type": "document", "url": "https://cdn.example.com/invoice.pdf", "filename": "invoice.pdf" }

// text header with a variable
"header": { "text": "Ahmed" }`;

  const sendTemplateResponse = `HTTP/1.1 201 Created
{
  "success": true,
  "message_id": "wamid.HBgMMjAxMDAwMDAwMDAwFQIAERgS...",
  "phone_number_id": "123456789012345",
  "status": "accepted"
}`;

  const ambiguous = `HTTP/1.1 400 Bad Request
{
  "success": false,
  "message": "This template exists in several languages — pass \`language\`",
  "code": "WHATSAPP_TEMPLATE_AMBIGUOUS",
  "meaning": "",
  "languages": ["ar", "en"]
}`;

  const sessionText = `curl -X POST "${base}/messages" \\
  -H "Authorization: Bearer m1wa_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "to": "201000000000", "text": "Your order has shipped" }'`;

  const sessionMedia = `{ "to": "201000000000", "type": "image", "url": "https://cdn.example.com/p.jpg", "caption": "New arrival" }
{ "to": "201000000000", "type": "video", "url": "https://cdn.example.com/p.mp4" }
{ "to": "201000000000", "type": "audio", "url": "https://cdn.example.com/note.ogg" }
{ "to": "201000000000", "type": "document", "url": "https://cdn.example.com/invoice.pdf", "filename": "invoice.pdf" }`;

  const outsideWindow = `HTTP/1.1 400 Bad Request
{
  "success": false,
  "message": "(#131047) Re-engagement message",
  "code": "WHATSAPP_CLOUD_OUTSIDE_SERVICE_WINDOW_USE_TEMPLATE",
  "meaning": "outside_service_window_use_template"
}`;

  const statusCurl = `curl "${base}/messages/wamid.HBgMMjAxMDAwMDAwMDAwFQIAERgS..." \\
  -H "Authorization: Bearer m1wa_YOUR_KEY"`;

  const statusResponse = `{
  "success": true,
  "message": {
    "id": "wamid.HBgMMjAxMDAwMDAwMDAwFQIAERgS...",
    "message_id": "wamid.HBgMMjAxMDAwMDAwMDAwFQIAERgS...",
    "direction": "outbound",
    "type": "template",
    "to": "201000000000",
    "status": "delivered",
    "failure_reason": null,
    "timestamp": 1792500000
  }
}`;

  const webhookDelivery = `POST https://your-system.example.com/whatsapp/events
Content-Type: application/json
User-Agent: M1-WhatsApp-Webhooks/1.0
X-M1-Event: message.status
X-M1-Signature: sha256=5d41402abc4b2a76b9719d911017c592...

{
  "event": "message.status",
  "created_at": "2026-10-20T12:00:00.000Z",
  "data": {
    "message_id": "wamid.HBgM...",
    "status": "delivered",
    "recipient_id": "201000000000",
    "timestamp": "1792500000",
    "phone_number_id": "123456789012345"
  }
}`;

  const webhookPayloads = `// message.received
{ "from": "201000000000", "message_id": "wamid...", "type": "text", "text": "Hi", "timestamp": "1792500000", "phone_number_id": "..." }

// message.status  (status: sent | delivered | read | failed)
{ "message_id": "wamid...", "status": "failed", "recipient_id": "201000000000", "timestamp": "1792500000",
  "error": { "code": 131026, "title": "Message undeliverable" }, "phone_number_id": "..." }

// message.sent  (a send made through this API)
{ "to": "201000000000", "message_id": "wamid...", "type": "template", "timestamp": 1792500000, "phone_number_id": "..." }

// template.status
{ "template_id": "1234567890", "name": "order_update", "language": "ar", "category": "UTILITY",
  "status": "REJECTED", "previous_status": "PENDING", "meta_event": "REJECTED",
  "reason": "INVALID_FORMAT", "waba_id": "...", "timestamp": 1792500000 }

// ping  (the "Test" button in WhatsApp → API Webhooks)
{ "message": "M1 webhook test", "webhook_id": 3, "timestamp": 1792500000 }`;

  const verifyNode = `// Node.js (Express) — verify on the RAW body, before JSON parsing
const crypto = require("crypto");
const express = require("express");
const app = express();

app.post("/whatsapp/events", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.M1_WEBHOOK_SECRET) // whsec_...
    .update(req.body)                                    // Buffer of the raw body
    .digest("hex");
  const received = req.get("X-M1-Signature") || "";
  const ok = expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!ok) return res.sendStatus(401);

  res.sendStatus(200); // answer fast (within 5 seconds), then process
  const event = JSON.parse(req.body.toString("utf8"));
  console.log(req.get("X-M1-Event"), event.data);
});`;

  const verifyPython = `# Python (Flask)
import hashlib, hmac, os
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["M1_WEBHOOK_SECRET"].encode()  # whsec_...

@app.post("/whatsapp/events")
def events():
    raw = request.get_data()  # raw bytes, not request.json
    expected = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("X-M1-Signature", "")):
        abort(401)
    event = request.get_json()
    print(request.headers.get("X-M1-Event"), event["data"])
    return "", 200`;

  const rotateCurl = `curl -X POST "${base}/webhooks/3/rotate-secret" \\
  -H "Authorization: Bearer m1wa_YOUR_KEY"

# → { "success": true, "webhook": { "id": 3, ... }, "secret": "whsec_..." }  (shown once)`;

  const errorEnvelope = `{
  "success": false,
  "message": "Human-readable explanation",
  "code": "WHATSAPP_TEMPLATE_AMBIGUOUS",
  "meaning": ""
}`;

  const errorRows = [
    ["401", "WHATSAPP_API_KEY_MISSING", g("errors.keyMissing")],
    ["401", "WHATSAPP_API_KEY_INVALID", g("errors.keyInvalid")],
    ["403", "WHATSAPP_ACCOUNT_NOT_ALLOWED", g("errors.accountNotAllowed")],
    ["400", "WHATSAPP_PHONE_REQUIRED", g("errors.phone")],
    ["400", "WHATSAPP_MESSAGE_REQUIRED / WHATSAPP_MESSAGE_TOO_LONG", g("errors.text")],
    ["400", "WHATSAPP_MESSAGE_TYPE_INVALID", g("errors.type")],
    ["400", "WHATSAPP_MEDIA_URL_INVALID / WHATSAPP_CAPTION_TOO_LONG", g("errors.media")],
    ["400", "WHATSAPP_TEMPLATE_NAME_INVALID", g("errors.templateName")],
    ["400", "WHATSAPP_TEMPLATE_AMBIGUOUS", g("errors.ambiguous")],
    ["404", "WHATSAPP_TEMPLATE_NOT_FOUND", g("errors.templateNotFound")],
    ["404", "WHATSAPP_MESSAGE_NOT_FOUND", g("errors.messageNotFound")],
    ["404", "WHATSAPP_WEBHOOK_NOT_FOUND", g("errors.webhookNotFound")],
    ["409", "WHATSAPP_CLOUD_NOT_CONNECTED", g("errors.notConnected")],
    ["429", "WHATSAPP_API_RATE_LIMITED", g("errors.rateLimited")],
    ["400", "WHATSAPP_CLOUD_OUTSIDE_SERVICE_WINDOW_USE_TEMPLATE", g("errors.window")],
    ["400", "WHATSAPP_CLOUD_TEMPLATE_NOT_FOUND_OR_NOT_APPROVED", g("errors.notApproved")],
    ["400", "WHATSAPP_CLOUD_TEMPLATE_PARAM_COUNT_MISMATCH", g("errors.paramCount")],
    ["400", "WHATSAPP_CLOUD_RECIPIENT_CANNOT_RECEIVE", g("errors.recipient")],
    ["400/401", "WHATSAPP_CLOUD_ACCESS_TOKEN_EXPIRED_OR_INVALID", g("errors.token")],
    ["400/429", "WHATSAPP_CLOUD_APP_RATE_LIMIT_REACHED / …_PAIR_RATE_LIMIT_REACHED", g("errors.metaLimit")],
    ["4xx/5xx", "WHATSAPP_CLOUD_ERROR", g("errors.metaOther")],
    ["504", "WHATSAPP_CLOUD_TIMEOUT / WHATSAPP_CLOUD_UNREACHABLE", g("errors.timeout")],
  ];

  return (
    <div className="space-y-4">
      {/* The section header already names the page; the intro explains it. */}
      <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.06] p-4">
        <P>{g("intro")}</P>
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{g("baseUrl")}</div>
          <CodeBlock code={base} label="Base URL" />
          <P>{g("format")}</P>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1.5">
        {sections.map(([id, title]) => (
          <a key={id} href={`#wa-guide-${id}`} className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black leading-8 text-slate-300 hover:bg-white/[0.08]">
            {title}
          </a>
        ))}
      </nav>

      <Section id="wa-guide-auth" title={g("auth.title")}>
        <P>{g("auth.body")}</P>
        <ul className="list-disc space-y-1 ps-5 text-[13px] leading-7 text-slate-300">
          <li>{g("auth.point1")} <Mono>Authorization: Bearer m1wa_…</Mono> / <Mono>X-API-Key: m1wa_…</Mono></li>
          <li>{g("auth.point2")}</li>
          <li>{g("auth.point3")}</li>
        </ul>
        <CodeBlock code={curlAuth} label="curl" />
      </Section>

      <Section id="wa-guide-accounts" title={g("accounts.title")}>
        <Endpoint method="GET" path="/accounts" />
        <P>{g("accounts.body")}</P>
        <CodeBlock code={accountsResponse} label="200 OK" />
      </Section>

      <Section id="wa-guide-templates" title={g("templates.title")}>
        <Endpoint method="GET" path="/templates?status=approved|all&whatsapp_account_id=" />
        <P>{g("templates.body")}</P>
        <CodeBlock code={templatesCurl} label="curl" />
        <CodeBlock code={templatesResponse} label="200 OK" />
      </Section>

      <Section id="wa-guide-send-template" title={g("sendTemplate.title")}>
        <Endpoint method="POST" path="/messages/template" />
        <P>{g("sendTemplate.body")}</P>
        <SimpleTable
          head={[g("table.field"), g("table.description")]}
          rows={[
            ["to", g("sendTemplate.fieldTo")],
            ["template_name | template | template_id", g("sendTemplate.fieldTemplate")],
            ["language", g("sendTemplate.fieldLanguage")],
            ["variables", g("sendTemplate.fieldVariables")],
            ["buttons_variables", g("sendTemplate.fieldButtons")],
            ["header", g("sendTemplate.fieldHeader")],
            ["whatsapp_account_id", g("sendTemplate.fieldAccount")],
          ]}
        />
        <CodeBlock code={sendTemplateCurl} label="curl" />
        <h4 className="pt-1 text-sm font-black text-white">{g("sendTemplate.variablesTitle")}</h4>
        <P>{g("sendTemplate.variablesBody")}</P>
        <CodeBlock code={sendTemplateObject} label="JSON" />
        <h4 className="pt-1 text-sm font-black text-white">{g("sendTemplate.languageTitle")}</h4>
        <P>{g("sendTemplate.languageBody")}</P>
        <CodeBlock code={ambiguous} label="400" />
        <h4 className="pt-1 text-sm font-black text-white">{g("sendTemplate.mediaTitle")}</h4>
        <P>{g("sendTemplate.mediaBody")}</P>
        <CodeBlock code={sendTemplateMedia} label="JSON" />
        <P>{g("sendTemplate.responseBody")}</P>
        <CodeBlock code={sendTemplateResponse} label="201 Created" />
      </Section>

      <Section id="wa-guide-send-session" title={g("session.title")}>
        <Endpoint method="POST" path="/messages" />
        <P>{g("session.body")}</P>
        <CodeBlock code={sessionText} label="curl" />
        <CodeBlock code={sessionMedia} label="JSON" />
        <P>{g("session.window")}</P>
        <CodeBlock code={outsideWindow} label="400" />
      </Section>

      <Section id="wa-guide-status" title={g("status.title")}>
        <Endpoint method="GET" path="/messages/{wamid}" />
        <P>{g("status.body")}</P>
        <CodeBlock code={statusCurl} label="curl" />
        <CodeBlock code={statusResponse} label="200 OK" />
      </Section>

      <Section id="wa-guide-webhooks" title={g("webhooks.title")}>
        <P>{g("webhooks.body")}</P>
        <SimpleTable
          head={[g("table.event"), g("table.description")]}
          rows={[
            ["message.received", g("webhooks.eventReceived")],
            ["message.status", g("webhooks.eventStatus")],
            ["message.sent", g("webhooks.eventSent")],
            ["template.status", g("webhooks.eventTemplate")],
          ]}
        />
        <CodeBlock code={webhookDelivery} label="HTTP" />
        <CodeBlock code={webhookPayloads} label="data" />
        <h4 className="pt-1 text-sm font-black text-white">{g("webhooks.verifyTitle")}</h4>
        <P>{g("webhooks.verifyBody")}</P>
        <CodeBlock code={verifyNode} label="Node.js" />
        <CodeBlock code={verifyPython} label="Python" />
        <h4 className="pt-1 text-sm font-black text-white">{g("webhooks.deliveryTitle")}</h4>
        <ul className="list-disc space-y-1 ps-5 text-[13px] leading-7 text-slate-300">
          <li>{g("webhooks.delivery1")}</li>
          <li>{g("webhooks.delivery2")}</li>
          <li>{g("webhooks.delivery3")}</li>
          <li>{g("webhooks.delivery4")}</li>
        </ul>
        <h4 className="pt-1 text-sm font-black text-white">{g("webhooks.rotateTitle")}</h4>
        <Endpoint method="POST" path="/webhooks/{id}/rotate-secret" />
        <P>{g("webhooks.rotateBody")}</P>
        <CodeBlock code={rotateCurl} label="curl" />
      </Section>

      <Section id="wa-guide-errors" title={g("errors.title")}>
        <P>{g("errors.body")}</P>
        <CodeBlock code={errorEnvelope} label="JSON" />
        <SimpleTable head={["HTTP", "code", g("table.description")]} rows={errorRows} />
      </Section>

      <Section id="wa-guide-limits" title={g("limits.title")}>
        <ul className="list-disc space-y-1 ps-5 text-[13px] leading-7 text-slate-300">
          <li>{g("limits.point1")}</li>
          <li>{g("limits.point2")} <Mono>X-RateLimit-Limit</Mono> · <Mono>X-RateLimit-Remaining</Mono></li>
          <li>{g("limits.point3")} <Mono>Retry-After</Mono></li>
          <li>{g("limits.point4")}</li>
        </ul>
      </Section>
    </div>
  );
}
