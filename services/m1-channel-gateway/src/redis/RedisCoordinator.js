import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

export class RedisCoordinator {
  constructor({ url, logger }) {
    this.url = url;
    this.logger = logger;
    this.client = null;
    this.state = url ? 'disconnected' : 'disabled';
  }

  async connect() {
    if (!this.url) return false;
    this.client = createClient({ url: this.url });
    this.client.on('error', (error) => {
      this.state = 'degraded';
      this.logger?.warn('redis.error', { error_code: error.code, message: error.message });
    });
    await this.client.connect();
    this.state = 'connected';
    return true;
  }

  async disconnect() {
    if (this.client?.isOpen) await this.client.quit();
    this.state = this.url ? 'disconnected' : 'disabled';
  }

  async health() {
    if (!this.client?.isReady) return { status: this.state };
    const started = Date.now();
    await this.client.ping();
    return { status: 'connected', latency_ms: Date.now() - started };
  }

  async acquireLock(key, ttlMs = 15_000) {
    if (!this.client?.isReady) return null;
    const token = randomUUID();
    const result = await this.client.set(`gateway:lock:${key}`, token, { NX: true, PX: ttlMs });
    return result === 'OK' ? token : null;
  }

  async releaseLock(key, token) {
    if (!this.client?.isReady || !token) return false;
    const result = await this.client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      { keys: [`gateway:lock:${key}`], arguments: [token] },
    );
    return Number(result) === 1;
  }

  async rememberDedupe(key, ttlSeconds = 300) {
    if (!this.client?.isReady) return null;
    return (await this.client.set(`gateway:dedupe:${key}`, '1', { NX: true, EX: ttlSeconds })) === 'OK';
  }

  async consumeRateLimit(key, { limit, windowSeconds }) {
    if (!this.client?.isReady) return { allowed: true, source: 'unavailable' };
    const redisKey = `gateway:rate:${key}`;
    const count = await this.client.incr(redisKey);
    if (count === 1) await this.client.expire(redisKey, windowSeconds);
    return { allowed: count <= limit, count, limit, source: 'redis' };
  }

  async setEphemeralState(type, key, value, ttlSeconds = 60) {
    if (!this.client?.isReady) return false;
    await this.client.set(`gateway:${type}:${key}`, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  }
}
