#!/bin/sh
# Copy-only mirror of product images (never deletes, never overwrites).
LOG=/var/log/erp-image-guard.log
rsync -a --ignore-existing /opt/erp/uploads/products/ /opt/erp/backups/uploads-products/ >> $LOG 2>&1
echo "$(date -Is) backup ok files=$(find /opt/erp/backups/uploads-products -type f | wc -l)" >> $LOG
