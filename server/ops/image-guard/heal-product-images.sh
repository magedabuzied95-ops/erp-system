#!/bin/sh
# Find DB-referenced product images missing on disk and restore them from the
# backup mirror or from a -wN responsive derivative. Logs to /var/log/erp-image-guard.log
PSQL="docker exec erp-postgres psql -U erp_user -d erp_production -tA"
U=/opt/erp/uploads; B=/opt/erp/backups/uploads-products; LOG=/var/log/erp-image-guard.log
{ $PSQL -c "SELECT to_jsonb(p)::text FROM products p"; $PSQL -c "SELECT to_jsonb(v)::text FROM product_variants v"; $PSQL -c "SELECT to_jsonb(i)::text FROM product_variant_images i" 2>/dev/null; } \
  | grep -oE "/uploads/products/[A-Za-z0-9_/.-]+" | sort -u > /tmp/heal_urls.txt
miss=0; fixed=0
while read url; do
  rel=${url#/uploads/}; dst=$U/$rel
  [ -f "$dst" ] && continue
  miss=$((miss+1)); src=""
  [ -f "$B/${rel#products/}" ] && src="$B/${rel#products/}"
  if [ -z "$src" ]; then
    base=$(basename "$rel"); stem=${base%.*}; dir=$(dirname "$rel")
    case "$dir" in products/cloudinary) vdir=$U/products/variants/cloudinary;; products) vdir=$U/products/variants;; *) vdir="";; esac
    for w in w960 w480 w240 w96; do [ -n "$vdir" ] && [ -f "$vdir/$stem-$w.webp" ] && { src="$vdir/$stem-$w.webp"; break; }; done
  fi
  if [ -n "$src" ]; then mkdir -p "$(dirname "$dst")"; cp "$src" "$dst" && fixed=$((fixed+1)) && echo "$(date -Is) restored $url from $src" >> $LOG
  else echo "$(date -Is) UNRECOVERABLE $url" >> $LOG; fi
done < /tmp/heal_urls.txt
echo "$(date -Is) heal done referenced=$(wc -l < /tmp/heal_urls.txt) missing=$miss restored=$fixed" >> $LOG
