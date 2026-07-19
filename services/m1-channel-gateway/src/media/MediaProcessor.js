import { createHash } from 'node:crypto';
import { normalizeAttachment } from '../contracts/channelEnvelope.js';

const allowedProtocols = new Set(['https:']);

export class MediaProcessor {
  constructor({ maxBytes = 25 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
  }

  validateDescriptor(input) {
    const media = normalizeAttachment(input);
    if (media.size_bytes != null && media.size_bytes > this.maxBytes) {
      throw Object.assign(new Error('Media exceeds configured size limit'), { code: 'MEDIA_TOO_LARGE' });
    }
    if (media.url) {
      const url = new URL(media.url);
      if (!allowedProtocols.has(url.protocol)) {
        throw Object.assign(new Error('Only HTTPS media sources are accepted'), { code: 'MEDIA_PROTOCOL_REJECTED' });
      }
    }
    return media;
  }

  checksum(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async processDescriptors(items = []) {
    return items.map((item) => this.validateDescriptor(item));
  }
}
