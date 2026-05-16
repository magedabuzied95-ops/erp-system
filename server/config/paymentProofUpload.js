import multer from "multer";
import fs from "fs";
import path from "path";

const paymentProofUploadDir = path.join(process.cwd(), "uploads", "payment-proofs");

if (!fs.existsSync(paymentProofUploadDir)) {
  fs.mkdirSync(paymentProofUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function destination(req, file, cb) {
    cb(null, paymentProofUploadDir);
  },
  filename: function filename(req, file, cb) {
    const safeOriginal = String(file.originalname || "proof")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_");
    cb(null, `${Date.now()}-${safeOriginal}`);
  },
});

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

const fileFilter = (req, file, cb) => {
  if (allowedTypes.has(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error("INVALID_PAYMENT_PROOF_TYPE"));
};

const paymentProofUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Number(process.env.PAYMENT_PROOF_MAX_BYTES || 10 * 1024 * 1024),
    files: 1,
  },
});

export default paymentProofUpload;
