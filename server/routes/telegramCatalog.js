// Telegram catalog channels -- the owner's control surface.
//
// RBAC mirrors the other channel integrations: reading the state and changing a
// channel both sit under marketing/settings, and publishing (a forced sweep, a
// re-post, removing a post) sits under marketing/publish.

import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  deleteTelegramChannel,
  enqueueTelegramCatalogJob,
  listTelegramCatalogPosts,
  listTelegramChannels,
  loadTelegramCatalogSettings,
  seedDefaultTelegramChannels,
  setTelegramChannelActive,
  telegramCatalogQueueDepth,
  upsertTelegramChannel,
} from "../services/telegramCatalogService.js";
import {
  buildTelegramPostPayload,
  syncTelegramChannel,
} from "../services/telegramCatalogPublisherService.js";
import { runTelegramCatalogSweep } from "../services/telegramCatalogWorkerService.js";
import { telegramBotToken } from "../services/telegramBotService.js";
import { TELEGRAM_CATALOG_AUDIENCES } from "../../shared/telegramCatalogDefaults.js";

const router = express.Router();

const text = (value = "") => String(value ?? "").trim();
const tenantOf = (req) => getTenantId(req, req.user?.tenant_id) || 1;

const settingsGuard = [protect, permit("marketing", "settings")];
const publishGuard = [protect, permit("marketing", "publish")];

const fail = (res, error, fallbackMessage) => {
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? fallbackMessage : text(error?.message) || fallbackMessage;
  return res.status(status).json({ success: false, code: error?.code || "", message });
};

router.get("/status", ...settingsGuard, async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    await seedDefaultTelegramChannels({ tenantId });
    const [settings, channels, queue] = await Promise.all([
      loadTelegramCatalogSettings(),
      listTelegramChannels({ tenantId, includeInactive: true }),
      telegramCatalogQueueDepth({ tenantId }),
    ]);
    res.json({
      success: true,
      data: {
        settings,
        // The token lives in the environment, not in settings: say whether it is
        // there without ever sending it back.
        bot_token_configured: Boolean(telegramBotToken()),
        audiences: TELEGRAM_CATALOG_AUDIENCES,
        queue,
        channels: channels.map((channel) => ({
          id: channel.id,
          channel_key: channel.channel_key,
          title: channel.title,
          chat_id: channel.chat_id,
          audience: channel.audience,
          invite_url: channel.invite_url,
          is_active: channel.is_active,
          sort_order: channel.sort_order,
          last_synced_at: channel.last_synced_at,
          last_error: channel.last_error,
          live_posts: Number(channel.live_posts) || 0,
          sold_out_posts: Number(channel.sold_out_posts) || 0,
          queued_jobs: Number(channel.queued_jobs) || 0,
        })),
      },
    });
  } catch (error) {
    console.error("[telegram-catalog] status failed", error?.message || error);
    fail(res, error, "Failed to load Telegram catalog status");
  }
});

router.put("/channels/:channelKey", ...settingsGuard, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const channel = await upsertTelegramChannel({
      tenantId: tenantOf(req),
      channelKey: req.params.channelKey,
      title: body.title,
      chatId: body.chat_id ?? body.chatId,
      audience: body.audience,
      inviteUrl: body.invite_url ?? body.inviteUrl,
      isActive: body.is_active ?? body.isActive ?? true,
      sortOrder: body.sort_order ?? body.sortOrder ?? 0,
    });
    res.json({ success: true, data: channel });
  } catch (error) {
    console.error("[telegram-catalog] channel save failed", error?.message || error);
    fail(res, error, "Failed to save the Telegram channel");
  }
});

router.post("/channels/:channelId/active", ...settingsGuard, async (req, res) => {
  try {
    const channel = await setTelegramChannelActive({
      tenantId: tenantOf(req),
      channelId: req.params.channelId,
      isActive: req.body?.is_active !== false,
    });
    if (!channel) return res.status(404).json({ success: false, message: "Channel not found" });
    res.json({ success: true, data: channel });
  } catch (error) {
    fail(res, error, "Failed to change the channel state");
  }
});

// Forgetting a channel does NOT remove its posts from Telegram -- nothing here
// can, without deleting a shopper's view of the shop from a settings screen. The
// response says so plainly so the UI can warn before asking.
router.delete("/channels/:channelId", ...settingsGuard, async (req, res) => {
  try {
    const removed = await deleteTelegramChannel({ tenantId: tenantOf(req), channelId: req.params.channelId });
    res.json({
      success: removed,
      data: { removed, posts_left_in_telegram: removed },
    });
  } catch (error) {
    fail(res, error, "Failed to remove the Telegram channel");
  }
});

router.get("/channels/:channelId/posts", ...settingsGuard, async (req, res) => {
  try {
    const posts = await listTelegramCatalogPosts({ tenantId: tenantOf(req), channelId: req.params.channelId });
    res.json({
      success: true,
      data: posts.map((post) => ({
        card_id: post.card_id,
        product_id: post.product_id,
        color_key: post.color_key,
        message_id: post.message_id,
        state: post.state,
        image_url: post.image_url,
        name: post.facts?.name || "",
        price: post.facts?.price || 0,
        sizes: Array.isArray(post.facts?.sizes) ? post.facts.sizes : [],
        last_error: post.last_error,
        posted_at: post.posted_at,
        last_synced_at: post.last_synced_at,
      })),
    });
  } catch (error) {
    fail(res, error, "Failed to load the channel posts");
  }
});

// What a post WOULD look like, without sending anything. This is the preview the
// caption template needs: a template is edited blind otherwise.
router.post("/preview", ...settingsGuard, async (req, res) => {
  try {
    const settings = await loadTelegramCatalogSettings();
    const facts = req.body?.facts && typeof req.body.facts === "object" ? req.body.facts : {
      card_id: "0:preview",
      name: "موديل تجريبي",
      color: "أسود",
      price: 1250,
      compare_price: 1500,
      sizes: ["40", "41", "42", "43"],
      audience: "men",
      product_type: "سنيكرز",
      slug: "",
    };
    const payload = buildTelegramPostPayload({
      facts,
      settings: { ...settings, ...(req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {}) },
      imageUrl: text(req.body?.image_url),
      soldOut: req.body?.sold_out === true,
    });
    res.json({ success: true, data: payload });
  } catch (error) {
    fail(res, error, "Failed to build the preview");
  }
});

router.post("/sync", ...publishGuard, async (req, res) => {
  try {
    const settings = await loadTelegramCatalogSettings();
    if (!settings.enabled) {
      return res.status(409).json({ success: false, code: "TELEGRAM_CATALOG_DISABLED", message: "Telegram catalog channels are switched off" });
    }
    const channelId = Number(req.body?.channel_id) || 0;
    if (channelId) {
      const channels = await listTelegramChannels({ tenantId: tenantOf(req), includeInactive: true });
      const channel = channels.find((row) => Number(row.id) === channelId);
      if (!channel) return res.status(404).json({ success: false, message: "Channel not found" });
      const summary = await syncTelegramChannel({ channel, settings, tenantId: tenantOf(req) });
      return res.json({ success: true, data: summary });
    }
    const result = await runTelegramCatalogSweep({ force: true });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[telegram-catalog] sync failed", error?.message || error);
    fail(res, error, "Failed to sync the Telegram channels");
  }
});

// Removing ONE post, by the owner's explicit request. The sweep never does this.
router.post("/channels/:channelId/posts/:cardId/remove", ...publishGuard, async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const posts = await listTelegramCatalogPosts({ tenantId, channelId: req.params.channelId });
    const post = posts.find((row) => text(row.card_id) === text(req.params.cardId));
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    await enqueueTelegramCatalogJob({
      tenantId,
      channelId: req.params.channelId,
      cardId: post.card_id,
      action: "delete",
      payload: { message_id: post.message_id },
    });
    res.json({ success: true, data: { queued: true } });
  } catch (error) {
    fail(res, error, "Failed to queue the post removal");
  }
});

export default router;
