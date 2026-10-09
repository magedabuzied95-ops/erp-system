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
      // Telegram sends ONLY what is listed here. A handler for an update type
      // that is missing from this list is dead code that looks alive.
      //
      // callback_query: a tap on an inline button. The catalog channels use URL
      //   buttons rather than callback_data precisely because a channel post
      //   cannot open a mini app, but the bot's own keyboards can still carry
      //   one, and a tap that reaches nothing looks broken to the shopper.
      // my_chat_member: the bot being added to, promoted in, demoted from or
      //   removed from a chat. This is how a catalog channel's chat id is
      //   discovered during setup, and the only warning we get when someone
      //   strips the bot's rights and the channel quietly stops updating.
      //
      // channel_post is deliberately NOT here: the bot administers the catalog
      // channels, so subscribing would echo every post and every size edit we
      // make back into telegram_webhook_updates -- tens of thousands of rows
      // that only ever get ignored. The handler for it stays, for the case
      // where someone enables this later.
      allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"],
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
