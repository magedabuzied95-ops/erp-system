import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Evolution text messages explicitly request a preview when the text contains a link", () => {
  const source = fs.readFileSync(new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8");
  assert.match(source, /const hasLink = \/https\?:\\\/\\\/\[\^\\s\]\+\/i\.test\(body\)/);
  assert.match(source, /hasLink \? \{ linkPreview: true \} : \{\}/);
});
