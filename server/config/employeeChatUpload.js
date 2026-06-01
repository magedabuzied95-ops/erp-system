import fs from "fs";
import multer from "multer";
import path from "path";

export const EMPLOYEE_CHAT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const employeeChatUploadDir = path.join(process.cwd(), "uploads", "employee-chat");

if (!fs.existsSync(employeeChatUploadDir)) {
  fs.mkdirSync(employeeChatUploadDir, { recursive: true });
}

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, employeeChatUploadDir);
  },
  filename: (_req, file, cb) => {
    const safeOriginal = String(file.originalname || "attachment")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 140);
    cb(null, `${Date.now()}-${safeOriginal}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(ext)) {
    cb(null, true);
    return;
  }
  const error = new Error("Unsupported chat attachment type");
  error.code = "chat_attachment_unsupported";
  error.status = 400;
  cb(error);
};

const employeeChatUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Number(process.env.EMPLOYEE_CHAT_MAX_ATTACHMENT_BYTES || EMPLOYEE_CHAT_MAX_ATTACHMENT_BYTES),
    files: 1,
  },
});

export default employeeChatUpload;
