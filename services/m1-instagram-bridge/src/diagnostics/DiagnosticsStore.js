import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redact } from '../security/redaction.js';

export class DiagnosticsStore {
  constructor({ directory, retentionHours = 72, maxFiles = 100 }) {
    this.directory = directory; this.retentionMs = retentionHours * 3_600_000; this.maxFiles = maxFiles;
  }
  async capture({ page, error, operation, correlationId = randomUUID(), includeDom = false }) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(this.directory, `${stamp}-${correlationId}`);
    const details = redact({
      timestamp: new Date().toISOString(), correlation_id: correlationId, operation,
      error_code: error?.code || 'UNKNOWN', current_url: page ? await page.url().catch(() => '') : '',
      selector_version: error?.selector_version || null,
    });
    if (page) await page.screenshot({ path: `${base}.png`, fullPage: false, timeout: 5_000, mask: [page.locator('main'), page.locator('[role="main"]')] }).catch(() => {});
    if (page && includeDom) {
      const sanitized = String(await page.locator('body').innerText().catch(() => '')).slice(0, 4_000).replace(/[\w.+-]+@[\w.-]+/g, '[EMAIL]').replace(/\+?\d[\d\s-]{7,}/g, '[PHONE]');
      details.dom_snapshot = '[SANITIZED_LENGTH:' + sanitized.length + ']';
    }
    await fs.writeFile(`${base}.json`, JSON.stringify(details), { mode: 0o600 });
    await this.prune();
    return { correlation_id: correlationId, error_code: details.error_code };
  }
  async prune(now = Date.now()) {
    const files = await fs.readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const records = await Promise.all(files.filter((item) => item.isFile()).map(async (item) => {
      const target = path.join(this.directory, item.name);
      return { target, stat: await fs.stat(target) };
    }));
    records.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    await Promise.all(records.filter((item, index) => index >= this.maxFiles || now - item.stat.mtimeMs > this.retentionMs).map((item) => fs.unlink(item.target).catch(() => {})));
  }
}
