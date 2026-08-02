import fs from "fs";
import multer from "multer";
import path from "path";

export const EMPLOYEE_PROFILE_MAX_BYTES = 5 * 1024 * 1024;
const uploadDir = path.join(process.cwd(), "uploads", "employee-profiles");
fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (req, file, callback) => {
    const employeeId = String(req.employeePortalEmployee?.id || "employee").replace(/[^0-9a-z_-]/gi, "");
    const extension = path.extname(file.originalname || "").toLowerCase();
    callback(null, `${employeeId}-${Date.now()}${extension}`);
  },
});

const employeeProfileUpload = multer({
  storage,
  limits: { fileSize: EMPLOYEE_PROFILE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (allowedTypes.has(file.mimetype) && allowedExtensions.has(extension)) return callback(null, true);
    const error = new Error("الصورة يجب أن تكون JPG أو PNG أو WebP");
    error.code = "employee_profile_image_unsupported";
    error.status = 400;
    return callback(error);
  },
});

export default employeeProfileUpload;
