/*
  Meta cannot decode WebP, so a .webp master in the catalogue reads to the
  crawler as a missing or corrupt image — an ineligible item with no error that
  names the format. The feed serves a JPEG rendition of anything Meta cannot
  read, but it only ever serves renditions that already exist so no crawl waits
  on sharp. This script makes them all in one go: run it once after a deploy
  that changes the image path, and after a bulk product import.

    docker exec erp-backend node server/scripts/warmMetaCatalogJpegRenditions.js
*/
import db from "../database/db.js";
import { buildMetaCatalogFeed } from "../services/metaCatalogFeedService.js";
import {
  metaCatalogImageUrl,
  needsCatalogJpegRendition,
  warmMetaCatalogImageRenditions,
} from "../services/metaImageCompatService.js";

const startedAt = Date.now();
// warm: false — this script is the warm-up; letting the build kick its own
// background pass as well would convert every image twice.
const feed = await buildMetaCatalogFeed({ warmImages: false, force: true });

const sources = new Set();
for (const item of feed.items || []) {
  if (item.image_link) sources.add(item.image_link);
  for (const url of item.additional_image_link || []) sources.add(url);
}

const unreadable = [...sources].filter(needsCatalogJpegRendition);
const summary = await warmMetaCatalogImageRenditions(unreadable);

console.log(JSON.stringify({
  feed_items: feed.items?.length || 0,
  distinct_images: sources.size,
  images_meta_cannot_read: unreadable.length,
  ...summary,
  // Re-resolved, not read off feed.xml: that xml was built before the
  // conversions ran, so counting it reports the work as still undone.
  still_unreadable: (await Promise.all(unreadable.map((url) => metaCatalogImageUrl(url))))
    .filter((url, index) => url === unreadable[index]).length,
  duration_ms: Date.now() - startedAt,
}, null, 2));

if (summary.failed) process.exitCode = 1;
await db.end?.();
