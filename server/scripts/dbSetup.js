import fs from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import db from "../database/db.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const schemaPath = path.join(currentDir, "../database/schema.sql");

const run = async () => {
  console.log("[migration] loading:", schemaPath);
  if (!fs.existsSync(schemaPath)) {
    console.warn("[migration] missing:", schemaPath);
    return;
  }
  const sql = await readFile(schemaPath, "utf8");
  const client = await db.connect();

  try {
    await client.query(sql);
    console.log("Database schema applied.");
  } catch (error) {
    console.error("Database schema setup failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

run();
