# Product image guard (VPS)

Three layers so `/opt/erp/uploads/products` can never be emptied by a code bug again
(the 2026-08 loss was `cleanupQueueItemAssets` in aiMarketingCenterService.js).

1. `protect-product-images.sh` (cron */5) — `chattr +i` on every file older than 2 min.
   The kernel then refuses unlink/rename/overwrite for everyone, root and the container included.
   To delete a product image on purpose: `chattr -i <file>` first
   (deleteAllProducts.js / purgeProductKeepInvoices.js need `chattr -R -i /opt/erp/uploads/products`).
2. `backup-product-images.sh` (daily 04:00) — copy-only rsync mirror to `/opt/erp/backups/uploads-products`.
3. `heal-product-images.sh` (daily 04:30) — DB-referenced URLs missing on disk are restored from the mirror
   or from a `variants/<stem>-wN.webp` derivative; log: `/var/log/erp-image-guard.log`.

Install: copy the .sh files to `/opt/erp/bin/`, `chmod +x`, copy the .cron file to `/etc/cron.d/erp-image-guard`.
