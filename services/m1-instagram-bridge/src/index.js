import 'dotenv/config';
import { createServer } from 'node:http';
import { loadConfig, assertSafePilotConfig } from './config.js';
import { BridgeStateStore } from './state/BridgeStateStore.js';
import { DiagnosticsStore } from './diagnostics/DiagnosticsStore.js';
import { OperationSafety } from './safety/OperationSafety.js';
import { GatewayClient } from './gateway/GatewayClient.js';
import { InstagramPlaywrightDriver } from './browser/InstagramPlaywrightDriver.js';
import { InstagramBridge } from './InstagramBridge.js';
import { createApp } from './app.js';
import { validateStagingIsolation } from '../../shared/stagingIsolation.js';

validateStagingIsolation(process.env, { requireDatabaseUrl: false });
const config = loadConfig(); assertSafePilotConfig(config);
const logger = { info: (event, fields = {}) => console.log(JSON.stringify({ level: 'info', event, ...fields })), warn: (event, fields = {}) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })), error: (event, fields = {}) => console.error(JSON.stringify({ level: 'error', event, ...fields })) };
const state = new BridgeStateStore(config.statePath);
const diagnostics = new DiagnosticsStore({ directory: config.diagnosticsPath, retentionHours: config.diagnosticsRetentionHours, maxFiles: config.diagnosticsMaxFiles });
const safety = new OperationSafety({ maxPerMinute: config.maxConversationsPerMinute, delayMinMs: config.operationDelayMinMs, delayMaxMs: config.operationDelayMaxMs, failureThreshold: config.selectorFailurePauseThreshold });
const gateway = new GatewayClient({ baseUrl: config.gatewayUrl, secret: config.gatewayHmacSecret });
const driver = new InstagramPlaywrightDriver({ config, diagnostics, safety });
const bridge = new InstagramBridge({ config, driver, state, gateway, diagnostics, safety, logger });
const server = createServer(createApp({ bridge, config, logger }));

if (config.enabled) await bridge.start();
server.listen(config.port, '0.0.0.0', () => logger.info('instagram_bridge.started', { port: config.port, enabled: config.enabled, inbound_enabled: config.inboundEnabled, outbound_enabled: config.outboundEnabled, ai_mode: config.aiMode }));

let stopping = false;
async function stop(signal) { if (stopping) return; stopping = true; logger.info('instagram_bridge.stopping', { signal }); server.close(); await bridge.disconnect().catch(() => {}); }
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal).finally(() => process.exit(0)));
