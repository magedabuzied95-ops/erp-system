#!/bin/sh
# Make every product image immutable (chattr +i) once it is older than 2 minutes.
# The upload route writes the file then renames it within the same minute, so a
# short grace period keeps uploads working while the kernel refuses unlink/
# rename/overwrite for everything else - including root and the backend container.
# To intentionally delete a product image: chattr -i <file> first.
find /opt/erp/uploads/products -type f -mmin +2 -exec chattr +i {} + 2>/dev/null
