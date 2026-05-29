import fs from "node:fs";
import path from "node:path";

const localeDir = path.resolve(process.cwd(), "src/locales/ar");
const suspiciousPatterns = [
  { name: "repeated question marks", regex: /\?{2,}/ },
  { name: "replacement character", regex: /\uFFFD|\uFFFC/ },
  { name: "replacement mojibake", regex: /\u00EF\u061F\u00BD/ },
  { name: "Arabic mojibake marker", regex: /[\u00A0-\u00FF][\u0600-\u06FF]|[\u0600-\u06FF][\u00A0-\u00FF]/ },
  { name: "black diamond placeholder", regex: /\uFFFD/ },
];

function walkJson(value, trail, visitor) {
  if (typeof value === "string") {
    visitor(value, trail);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, `${trail}[${index}]`, visitor));
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      walkJson(item, trail ? `${trail}.${key}` : key, visitor);
    });
  }
}

const failures = [];

for (const fileName of fs.readdirSync(localeDir).filter((file) => file.endsWith(".json")).sort()) {
  const filePath = path.join(localeDir, fileName);
  const buffer = fs.readFileSync(filePath);

  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    failures.push(`${fileName}: file has a UTF-8 BOM`);
  }

  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    failures.push(`${fileName}: invalid JSON: ${error.message}`);
    continue;
  }

  walkJson(parsed, "", (value, trail) => {
    for (const pattern of suspiciousPatterns) {
      if (pattern.regex.test(value)) {
        failures.push(`${fileName}:${trail}: ${pattern.name}: ${value}`);
      }
    }
  });
}

if (failures.length) {
  console.error("Arabic locale audit failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Arabic locale audit passed.");
