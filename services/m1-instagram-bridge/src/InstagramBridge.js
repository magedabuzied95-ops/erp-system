import { randomUUID } from 'node:crypto';
import { buildConversationIdentity, verifyConversationTarget } from './domain/identity.js';
import { matchOutgoingConfirmation, normalizeInstagramTextEvent } from './domain/messages.js';
import { mapHealthState } from './domain/health.js';
import { SELECTOR_VERSION } from './selectors/instagram.selectors.js';

const unsupported = () => ({ ok: false, status: 'unsupported_in_current_phase' });

export class InstagramBridge {
  constructor({ config, driver, state, gateway, diagnostics, safety, logger = console }) {
    this.config = config; this.driver = driver; this.state = state; this.gateway = gateway;
    this.diagnostics = diagnostics; this.safety = safety; this.logger = logger;
    this.running = false; this.paused = true; this.liveTimer = null; this.recoveryTimer = null;
    this.browserOperationInFlight = false;
    this.browserOperationPriorityWaiting = false;
    this.knownConversationCursor = 0;
    this.initialKnownSweepCompleted = false;
    this.selectorFailures = 0; this.everStarted = false; this.accountMismatch = null;
    this.conversationPreviews = new Map();
    this.timestamps = { last_message_seen_at: null, last_message_imported_at: null, last_outbound_confirmed_at: null, last_sync_at: null };
  }
  async connect(options = {}) {
    if (!this.config.enabled && !options.manualLogin) throw Object.assign(new Error('Instagram bridge is disabled'), { code: 'BRIDGE_DISABLED' });
    await this.state.load(); await this.driver.connect({ headed: options.headed }); this.everStarted = true; this.paused = false;
    if (options.manualLogin) return this.driver.openLogin();
    await this.driver.openInbox(); return this.getHealth();
  }
  async disconnect() { this.stopWatchers(); await this.driver.disconnect(); this.running = false; this.paused = true; return this.getHealth(); }
  async start() {
    try {
      await this.connect();
    } catch (error) {
      if (error.code === 'ACCOUNT_IDENTITY_MISMATCH') {
        this.running = true;
        this.paused = true;
        this.stopWatchers();
        this.accountMismatch = {
          expected: error.expectedUsername || this.config.expectedUsername,
          current: error.currentUsername || 'unverified',
        };
        this.logger.error?.('instagram_bridge.account_identity_mismatch', { error_code: error.code });
        return this.getHealth();
      }
      if (!/LOGIN_REQUIRED|SESSION_EXPIRED/.test(error.code || '')) throw error;
      // Session loss is an operational state, not a process crash. Keep the
      // health API alive, stop all browser work, and wait for a manual login.
      // Do not capture the login page in diagnostics because it may contain
      // account identifiers or other authentication UI.
      this.running = true;
      this.paused = true;
      this.stopWatchers();
      this.logger.warn?.('instagram_bridge.login_required', { error_code: error.code });
      return this.getHealth();
    }
    this.running = true;
    this.accountMismatch = null;
    if (this.config.recoverySyncEnabled) this.recoveryTimer = this.schedule(() => this.recoverySync(), this.config.recoverySyncIntervalMs, 'recovery_sync');
    if (this.config.inboundEnabled) this.liveTimer = this.schedule(() => this.liveWatch(), this.config.liveWatchIntervalMs, 'live_watch');
    return this.getHealth();
  }
  schedule(operation, interval, operationName = operation.name || 'scheduled_operation') {
    let inFlight = false;
    const run = async () => {
      if (inFlight || this.browserOperationInFlight || this.browserOperationPriorityWaiting) return;
      inFlight = true; this.browserOperationInFlight = true;
      try { await operation(); }
      catch (error) { await this.handleFailure(error, operationName); }
      finally { inFlight = false; this.browserOperationInFlight = false; }
    };
    const timer = setInterval(run, interval);
    timer.unref?.();
    queueMicrotask(run);
    return timer;
  }
  startWatchers() {
    if (this.config.recoverySyncEnabled && !this.recoveryTimer) this.recoveryTimer = this.schedule(() => this.recoverySync(), this.config.recoverySyncIntervalMs, 'recovery_sync');
    if (this.config.inboundEnabled && !this.liveTimer) this.liveTimer = this.schedule(() => this.liveWatch(), this.config.liveWatchIntervalMs, 'live_watch');
  }
  stopWatchers() { if (this.liveTimer) clearInterval(this.liveTimer); if (this.recoveryTimer) clearInterval(this.recoveryTimer); this.liveTimer = null; this.recoveryTimer = null; }
  async withExclusiveBrowserOperation(operation, timeoutMs = 180_000, { preemptAfterMs = 15_000 } = {}) {
    this.browserOperationPriorityWaiting = true;
    let preempted = false;
    try {
      const deadline = Date.now() + timeoutMs;
      const preemptAt = Date.now() + Math.min(preemptAfterMs, timeoutMs);
      while (this.browserOperationInFlight && Date.now() < deadline) {
        if (!preempted && Date.now() >= preemptAt) {
          preempted = true;
          this.paused = true;
          this.stopWatchers();
          await this.driver.interruptActivePage();
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this.browserOperationInFlight) throw Object.assign(new Error('Browser operation is busy'), { code: 'BROWSER_OPERATION_BUSY' });
      if (preempted) {
        await this.driver.reopenInboxTab();
        this.paused = false;
        this.running = true;
      }
      this.browserOperationInFlight = true;
      try { return await operation(); }
      finally { this.browserOperationInFlight = false; }
    } finally {
      this.browserOperationPriorityWaiting = false;
      if (preempted && !this.paused) this.startWatchers();
    }
  }
  async pause() { this.paused = true; this.stopWatchers(); return this.getHealth(); }
  async resume() { if (!this.config.enabled) throw Object.assign(new Error('Bridge disabled'), { code: 'BRIDGE_DISABLED' }); this.paused = false; return this.start(); }
  async syncConversations({ limit = this.config.maxConversationsPerMinute } = {}) { return this.driver.listConversations({ limit }); }
  async syncMessages(conversation, source = 'recovery_sync') {
    const identity = await this.driver.openConversation(conversation);
    await this.state.saveConversation(identity);
    const messages = await this.driver.readMessages();
    const results = [];
    for (const message of messages) results.push(await this.importMessage(message, identity, source));
    this.timestamps.last_sync_at = new Date().toISOString();
    return results;
  }
  async importMessage(message, identity, source) {
    const event = normalizeInstagramTextEvent(message, { identity, tenantId: this.config.tenantId, connectionId: this.config.connectionId, channelAccountId: this.config.channelAccountId });
    this.timestamps.last_message_seen_at = new Date().toISOString();
    const dedupeKey = event.external_message_id || event.dedupe_hash;
    if (this.state.hasMessage(dedupeKey)) return { duplicate: true, event_id: event.event_id };
    if (message.direction === 'outgoing') { await this.state.rememberMessage(dedupeKey, { source, direction: 'outgoing' }); return { duplicate: false, skipped: 'outgoing_observation' }; }
    if (!this.config.inboundEnabled) return { duplicate: false, skipped: 'inbound_disabled' };
    const result = await this.gateway.importMessage(event);
    await this.state.rememberMessage(dedupeKey, { source, event_id: event.event_id });
    this.timestamps.last_message_imported_at = new Date().toISOString();
    return { duplicate: Boolean(result.duplicate), event_id: event.event_id };
  }
  async liveWatch() {
    if (this.paused || !this.config.inboundEnabled) return { skipped: true };
    const known = this.state.listConversations?.() || [];
    let knownOpened = 0;
    if (!this.initialKnownSweepCompleted && known.length) {
      for (const conversation of known.slice(0, this.config.maxConversationsPerMinute)) {
        if (this.browserOperationPriorityWaiting) break;
        await this.syncMessages(conversation, 'live_watch_known_sweep');
        knownOpened += 1;
      }
      this.initialKnownSweepCompleted = true;
    }
    const conversations = await this.syncConversations({ limit: Math.min(3, this.config.maxConversationsPerMinute) });
    const candidates = conversations.filter((item, index) => {
      const key = item.threadId || item.url; const preview = String(item.preview || '');
      const previous = this.conversationPreviews.get(key); this.conversationPreviews.set(key, preview);
      return previous === undefined ? index < 3 : previous !== preview;
    }).slice(0, 2);
    if (known.length && knownOpened === 0) {
      const nextKnown = known[this.knownConversationCursor % known.length];
      this.knownConversationCursor = (this.knownConversationCursor + 1) % known.length;
      const knownKey = nextKnown.external_conversation_id || nextKnown.threadId || nextKnown.url;
      if (!candidates.some((item) => (item.external_conversation_id || item.threadId || item.url) === knownKey)) candidates.push(nextKnown);
    }
    for (const conversation of candidates) {
      if (this.browserOperationPriorityWaiting) break;
      await this.syncMessages(conversation, 'live_watch');
    }
    return { scanned: conversations.length, opened: candidates.length + knownOpened };
  }
  async recoverySync() {
    if (this.paused || !this.config.recoverySyncEnabled) return { skipped: true };
    // Confirm uncertain manual sends before the broader inbox sweep. Visible
    // discovery can be slow or selector-sensitive and must not starve delivery
    // reconciliation after a restart.
    const reconciled = await this.reconcileUncertainSends();
    // Revisit known thread IDs directly before relying on Instagram's visible
    // Primary/General tabs. A thread can be hidden by client-side tab state even
    // though new messages continue to arrive on the same stable conversation.
    const known = this.state.listConversations?.() || [];
    const discovered = await this.syncConversations();
    const conversations = [...new Map([...known, ...discovered].map((item) => [
      item.external_conversation_id || item.threadId || item.url, item,
    ])).values()].slice(0, this.config.maxConversationsPerMinute);
    for (const conversation of conversations) {
      if (this.browserOperationPriorityWaiting) break;
      await this.syncMessages(conversation, 'recovery_sync');
    }
    return { scanned: conversations.length, reconciled: reconciled.length };
  }
  async forceRecoverySync() {
    return this.withExclusiveBrowserOperation(
      () => this.recoverySync(),
      180_000,
      { preemptAfterMs: 15_000 },
    );
  }
  async sendText(externalConversationId, text, options = {}) {
    if (!this.config.outboundEnabled) throw Object.assign(new Error('Instagram outbound is disabled'), { code: 'OUTBOUND_DISABLED' });
    if (options.ai_generated || options.sender_type === 'ai' || options.ai_auto_send) throw Object.assign(new Error('AI auto-send is forbidden in pilot'), { code: 'AI_AUTO_SEND_FORBIDDEN' });
    if (!options.manual_user_id && !options.manual) throw Object.assign(new Error('Manual employee action is required'), { code: 'MANUAL_ACTION_REQUIRED' });
    const health = await this.getHealth();
    if (this.paused) throw Object.assign(new Error('Instagram bridge is paused'), { code: 'BRIDGE_PAUSED' });
    if (health.status === 'account_mismatch') throw Object.assign(new Error('Instagram test account verification failed'), { code: 'ACCOUNT_IDENTITY_MISMATCH' });
    if (health.status === 'login_required') throw Object.assign(new Error('Instagram login is required'), { code: 'LOGIN_REQUIRED' });
    this.safety.assertSendAllowed();
    return this.withExclusiveBrowserOperation(async () => {
    const expected = this.state.getConversation(externalConversationId) || buildConversationIdentity({
      threadId: externalConversationId, externalUsername: options.external_username,
      headerIdentity: options.external_display_name, channelAccountId: this.config.channelAccountId,
      channelConnectionId: this.config.connectionId,
    });
    const actual = await this.driver.openConversation({ external_conversation_id: externalConversationId, url: options.conversation_url });
    const verification = verifyConversationTarget(expected, actual);
    if (!verification.ok) throw Object.assign(new Error(verification.reason), { code: verification.reason.toUpperCase(), needsManualReview: true });
    const jobKey = options.job_key || randomUUID();
    const sent = await this.driver.sendText(text);
    await this.state.setReconciliation(jobKey, { externalConversationId, text, sentAt: sent.clickedAt, expected, attempts: 0 });
    const recent = await this.driver.readMessages({ limit: 30 });
    const match = matchOutgoingConfirmation({ text, sentAt: sent.clickedAt }, recent);
    if (match) {
      await this.state.clearReconciliation(jobKey); this.safety.success();
      this.timestamps.last_outbound_confirmed_at = new Date().toISOString();
      return { status: 'confirmed', confirmed: true, external_message_id: match.externalMessageId || `ig-fp:${jobKey}` };
    }
    return { status: 'sent_unconfirmed', confirmed: false, external_message_id: null, reconciliation_required: true };
    });
  }
  async reconcileUncertainSends() {
    const results = [];
    for (const [jobKey, pending] of this.state.listReconciliations()) {
      const actual = await this.driver.openConversation({ external_conversation_id: pending.externalConversationId });
      const verification = verifyConversationTarget(pending.expected, actual);
      if (!verification.ok) {
        const result = { job_key: jobKey, status: 'needs_manual_review', reason: verification.reason };
        await this.gateway.reportOutboundStatus?.(jobKey, result).catch(() => {}); results.push(result); continue;
      }
      const match = matchOutgoingConfirmation({ text: pending.text, sentAt: pending.sentAt, windowMs: 300_000 }, await this.driver.readMessages({ limit: 50 }));
      if (match) {
        await this.state.clearReconciliation(jobKey);
        const result = { job_key: jobKey, status: 'confirmed', external_message_id: match.externalMessageId || null };
        await this.gateway.reportOutboundStatus?.(jobKey, result).catch(() => {}); results.push(result);
      }
      else if ((pending.attempts || 0) >= 2) {
        const result = { job_key: jobKey, status: 'needs_manual_review', reason: 'confirmation_unresolved' };
        await this.gateway.reportOutboundStatus?.(jobKey, result).catch(() => {}); results.push(result);
      }
      else await this.state.setReconciliation(jobKey, { ...pending, attempts: (pending.attempts || 0) + 1 });
    }
    return results;
  }
  async markAsRead(...args) { return this.driver.markAsRead(...args); }
  sendMedia() { return unsupported(); }
  downloadMedia() { return unsupported(); }
  sendReaction() { return unsupported(); }
  typingIndicator() { return unsupported(); }
  async restart() {
    try { await this.driver.reload(); await this.driver.openInbox(); return this.getHealth(); } catch {}
    try { await this.driver.reopenInboxTab(); return this.getHealth(); } catch {}
    await this.driver.disconnect(); await this.driver.connect(); await this.driver.openInbox(); return this.getHealth();
  }
  async handleFailure(error, operation) {
    if (/LOGIN_REQUIRED|SESSION_EXPIRED/.test(error.code || '')) await this.pause();
    if (error.code === 'SELECTOR_MISSING') { this.selectorFailures += 1; this.safety.failure(); if (this.selectorFailures >= this.config.selectorFailurePauseThreshold) await this.pause(); }
    await this.diagnostics.capture({ page: this.driver.page, error, operation }).catch(() => {});
    const message = String(error?.message || '');
    const errorCategory = error?.name === 'TimeoutError' || /timeout/i.test(message) ? 'timeout'
      : /target|browser|page.*closed/i.test(message) ? 'target_closed'
        : /navigation|net::/i.test(message) ? 'navigation'
          : /fetch|connect|socket|ECONN/i.test(message) ? 'network'
            : /strict mode|selector/i.test(message) ? 'selector'
              : 'other';
    this.logger.warn?.('instagram_bridge.operation_failed', {
      operation,
      error_code: error.code || 'UNKNOWN',
      error_name: error?.name || 'Error',
      error_category: errorCategory,
    });
  }
  async getHealth() {
    const probe = await this.driver.getHealthProbe().catch(() => ({ browserRunning: false, authenticated: false, inboxLoaded: false, session: 'unknown' }));
    const accountVerified = !this.accountMismatch && probe.currentAccountUsername === this.config.expectedUsername;
    const status = this.accountMismatch ? 'account_mismatch' : mapHealthState({ paused: this.paused, browserRunning: probe.browserRunning, everStarted: this.everStarted, loginRequired: probe.session === 'login_required', sessionExpired: probe.session === 'session_expired', inboxLoaded: probe.inboxLoaded, selectorFailures: this.selectorFailures, selectorFailureThreshold: this.config.selectorFailurePauseThreshold });
    return { status, session_state: probe.session || 'unknown', browser: probe.browserRunning ? 'running' : 'stopped', authenticated: probe.authenticated, inbox_loaded: probe.inboxLoaded, live_watch: this.liveTimer ? 'running' : 'stopped', recovery_sync: this.recoveryTimer ? 'running' : 'idle', current_connected_account: probe.currentAccountUsername || this.accountMismatch?.current || 'unverified', expected_test_account: this.config.expectedUsername, test_account_verified: accountVerified, account_label: 'TEST ACCOUNT', ...this.timestamps, selector_version: SELECTOR_VERSION, memory_usage_mb: await this.driver.memoryUsageMb().catch(() => 0), cpu_usage: process.cpuUsage(), ai_mode: 'draft_only', media_enabled: false };
  }
}
