import { performance } from 'node:perf_hooks';
import { buildConversationIdentity } from '../src/domain/identity.js';
import { normalizeInstagramTextEvent } from '../src/domain/messages.js';

const iterations = Math.max(1_000, Number(process.env.BENCHMARK_ITERATIONS || 20_000));
const samples = [];
for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  const identity = buildConversationIdentity({ threadId: `thread-${index % 200}`, externalUsername: `user_${index % 200}`, headerIdentity: `User ${index % 200}`, channelAccountId: 'instagram-test-account', channelConnectionId: 1 });
  normalizeInstagramTextEvent({ text: `Message ${index}`, direction: 'incoming', sentAt: new Date(1_700_000_000_000 + index * 1_000).toISOString() }, { identity, tenantId: 1, connectionId: 1, channelAccountId: 'instagram-test-account' });
  samples.push(performance.now() - started);
}
samples.sort((a, b) => a - b);
const percentile = (value) => samples[Math.min(samples.length - 1, Math.floor(samples.length * value))];
process.stdout.write(JSON.stringify({ iterations, p50_ms: percentile(0.50), p95_ms: percentile(0.95), p99_ms: percentile(0.99), max_ms: samples.at(-1) }, null, 2) + '\n');
