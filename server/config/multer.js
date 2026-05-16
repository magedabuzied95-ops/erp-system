import multer from "multer";
import fs from "fs";
import path from "path";

const productsUploadDir = path.join(process.cwd(), "uploads", "products");
if (!fs.existsSync(productsUploadDir)) {
  fs.mkdirSync(productsUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, productsUploadDir);
  },

  filename: function (req, file, cb) {
    const safeOriginal = String(file.originalname || "image")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120);
    const uniqueName =
      Date.now() + "-" + safeOriginal;

    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {

  const allowedTypes =
    /jpeg|jpg|png|webp/;

  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );

  const mimetype = allowedTypes.test(
    file.mimetype
  );

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error("Images only"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Number(process.env.PRODUCT_IMAGE_MAX_BYTES || 8 * 1024 * 1024),
    files: 1,
  },
});

export default upload;
