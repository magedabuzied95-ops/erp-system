import express from "express";
import { buildMetaCatalogFeed } from "../services/metaCatalogFeedService.js";

const router = express.Router();

router.get("/meta.xml", async (_req, res) => {
  try {
    const feed = await buildMetaCatalogFeed();
    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=900");
    return res.status(200).send(feed.xml);
  } catch (error) {
    console.error("[meta-catalog-feed] failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(500).type("text/plain").send("Meta catalog feed generation failed");
  }
});

export default router;
