import process from "node:process";

/**
 * The Cloudinary account was closed, so every upload call now fails and the
 * originals can no longer be fetched. Uploads are therefore opt-in and default
 * to OFF: with this gate closed nothing reaches Cloudinary even while the
 * CLOUDINARY_* credentials are still sitting in the backend .env, and every
 * writer stores its file on the server disk instead.
 *
 * Set CLOUDINARY_UPLOADS_ENABLED=true to turn remote uploads back on if the
 * account is ever restored. Reading existing res.cloudinary.com URLs that are
 * already stored in the database is unaffected by this switch.
 */
export const cloudinaryUploadsEnabled = () => {
  const raw = String(process.env.CLOUDINARY_UPLOADS_ENABLED || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
};

export default cloudinaryUploadsEnabled;
