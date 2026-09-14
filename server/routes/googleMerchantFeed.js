import express from "express";
import { buildGoogleMerchantFeed } from "../services/googleMerchantFeedService.js";

const router = express.Router();

export const createGoogleMerchantFeedHandler = ({
  loadFeed = buildGoogleMerchantFeed,
} = {}) => async (req, res) => {
  try {
    const feed = await loadFeed();
    if (req.headers["if-none-match"] === feed.etag) {
      return res.status(304).end();
    }
    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    // The CDN copy used to live 24h on top of the process copy; it now keeps the Meta feed's
    // 15 minutes, so a price or stock change reaches Merchant Center within the hour.
    res.set("Cache-Control", "public, max-age=900, s-maxage=900, stale-while-revalidate=300");
    res.set("ETag", feed.etag);
    res.set("Last-Modified", new Date(feed.generatedAt).toUTCString());
    return res.status(200).send(feed.xml);
  } catch (error) {
    console.error("[google-merchant-feed] failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(500).type("text/plain").send("Google Merchant feed generation failed");
  }
};

export const googleMerchantFeedHandler = createGoogleMerchantFeedHandler();
router.get("/google.xml", googleMerchantFeedHandler);
export default router;
