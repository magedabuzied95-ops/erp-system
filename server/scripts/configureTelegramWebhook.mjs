import "dotenv/config";

const clean = (value = "") => String(value ?? "").trim();
const token = clean(process.env.TELEGRAM_BOT_TOKEN);
const secret = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
const publicBackendUrl = clean(process.env.PUBLIC_BACKEND_URL).replace(/\/+$/g, "");

if (!token || !secret || !publicBackendUrl) {
  console.error("Telegram webhook configuration is incomplete. Required: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_BACKEND_URL.");
  process.exitCode = 1;
} else if (!publicBackendUrl.startsWith("https://")) {
  console.error("PUBLIC_BACKEND_URL must use HTTPS for Telegram webhooks.");
  process.exitCode = 1;
} else {
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${publicBackendUrl}/api/webhooks/telegram`,
      secret_token: secret,
      allowed_updates: ["message", "edited_message"],
      drop_pending_updates: false,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    console.error("Telegram rejected webhook registration.", { status: response.status, error_code: result?.error_code || "" });
    process.exitCode = 1;
  } else {
    console.info("Telegram webhook registered successfully.");
  }
}
