import fs from "fs";
import multer from "multer";
import path from "path";

export const STAFF_TASK_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const uploadDir = path.join(process.cwd(), "uploads", "staff-task-photos");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const taskId = String(req.params?.id || "task").replace(/[^0-9a-zA-Z-]+/g, "");
    cb(null, `${taskId}-${Date.now()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  // Camera captures on some phones arrive without an extension; trust the
  // mime type in that case.
  if (allowedMimeTypes.has(file.mimetype) && (!ext || allowedExtensions.has(ext))) {
    cb(null, true);
    return;
  }
  const error = new Error("Unsupported task photo type");
  error.code = "task_photo_unsupported";
  error.status = 400;
  cb(error);
};

const staffTaskPhotoUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: STAFF_TASK_PHOTO_MAX_BYTES, files: 1 },
});

export default staffTaskPhotoUpload;
