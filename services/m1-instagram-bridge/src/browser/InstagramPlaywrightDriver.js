import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { instagramSelectors, resolveSelector, SELECTOR_VERSION } from '../selectors/instagram.selectors.js';
import { buildConversationIdentity, extractThreadId } from '../domain/identity.js';

const DIRECT_INBOX_URL = 'https://www.instagram.com/direct/inbox/';
const DIRECT_REQUESTS_URL = 'https://www.instagram.com/direct/requests/';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';

export function shouldSkipInstagramMessageCandidate({ text, hasLinkedImage = false, linkedIdentity = '', identityLabels = [] } = {}) {
  const normalized = String(text || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!normalized || /view once|disappearing|vanish mode/i.test(normalized)) return true;
  if (/^(video|photo|audio|reel|post)$/i.test(normalized)) return true;
  if (/^(accept|delete|block|decline)$/i.test(normalized)) return true;
  const labels = identityLabels.map((value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean);
  const linkedLabel = String(linkedIdentity || '').replace(/^https?:\/\/[^/]+/i, '').replaceAll('/', '').trim().toLowerCase();
  return hasLinkedImage && (labels.includes(normalized.toLowerCase()) || linkedLabel === normalized.toLowerCase());
}

export class InstagramPlaywrightDriver {
  constructor({ config, diagnostics, safety }) {
    this.config = config; this.diagnostics = diagnostics; this.safety = safety;
    this.context = null; this.page = null; this.browserRunning = false;
  }
  async connect({ headed = false } = {}) {
    if (this.context) return this.getHealthProbe();
    this.context = await chromium.launchPersistentContext(this.config.profilePath, {
      headless: headed ? false : this.config.headless,
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      args: ['--disable-dev-shm-usage'],
    });
    this.context.setDefaultTimeout(5_000);
    this.context.setDefaultNavigationTimeout(15_000);
    await this.restoreStorageState();
    this.browserRunning = true;
    this.context.on('close', () => { this.browserRunning = false; this.context = null; this.page = null; });
    this.page = this.context.pages()[0] || await this.context.newPage();
    return this.getHealthProbe();
  }
  async disconnect() { await this.context?.close(); this.browserRunning = false; this.context = null; this.page = null; }
  async restoreStorageState() {
    if (!this.config.storageStatePath || !this.context) return false;
    try {
      const state = JSON.parse(await readFile(this.config.storageStatePath, 'utf8'));
      if (Array.isArray(state.cookies) && state.cookies.length) await this.context.addCookies(state.cookies);
      if (Array.isArray(state.origins) && state.origins.length) {
        await this.context.addInitScript(({ origins }) => {
          const current = origins.find((item) => item.origin === window.location.origin);
          for (const item of current?.localStorage || []) window.localStorage.setItem(item.name, item.value);
        }, { origins: state.origins });
      }
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  async persistStorageState() {
    if (!this.config.storageStatePath || !this.context) return false;
    await this.context.storageState({ path: this.config.storageStatePath, indexedDB: true });
    return true;
  }
  async openLogin() { await this.ensurePage(); await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }); return { status: 'manual_login_required', url: this.page.url() }; }
  async openInbox() {
    await this.ensurePage();
    await this.page.goto(DIRECT_INBOX_URL, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(2_500);
    const session = await this.detectSession();
    if (session !== 'authenticated') throw Object.assign(new Error(session), { code: session.toUpperCase() });
    return true;
  }
  async detectSession() {
    await this.ensurePage();
    const url = this.page.url();
    if (/challenge|two_factor/i.test(url)) return 'login_required';
    if (/accounts\/login/i.test(url)) return 'session_expired';
    if (await this.page.locator('input[name="username"]').count().catch(() => 0)) return 'session_expired';
    if (/\/direct\//i.test(url)) return 'authenticated';
    if (/instagram\.com/i.test(url) && await this.page.locator('a[href^="/direct/inbox"]').count().catch(() => 0)) return 'authenticated';
    return 'login_required';
  }
  async listConversations({ limit = 12 } = {}) {
    await this.openInbox();
    // New senders land in Message Requests. Always reserve scan capacity for
    // that queue so a busy primary inbox cannot starve inbound discovery.
    const requestsLimit = Math.min(limit, Math.max(1, Math.ceil(limit / 3)));
    const inboxLimit = Math.max(0, limit - requestsLimit);
    const conversations = await this.collectLinkedConversations(inboxLimit);
    let remainingInbox = Math.max(0, inboxLimit - conversations.length);
    if (remainingInbox) {
      const primaryLimit = Math.ceil(remainingInbox / 2);
      conversations.push(...await this.collectButtonConversations(DIRECT_INBOX_URL, primaryLimit, { tabName: 'Primary' }));
      remainingInbox = Math.max(0, inboxLimit - conversations.length);
    }
    if (remainingInbox) conversations.push(...await this.collectButtonConversations(DIRECT_INBOX_URL, remainingInbox, { tabName: 'General' }));
    const requests = await this.collectButtonConversations(DIRECT_REQUESTS_URL, requestsLimit);
    // Requests come first so the live watcher opens new senders immediately;
    // recovery sync still processes the complete bounded result.
    return [...new Map([...requests, ...conversations].map((item) => [item.threadId || item.url, item])).values()].slice(0, limit);
  }
  async collectLinkedConversations(limit) {
    const links = this.page.locator('a[href*="/direct/t/"]');
    await links.first().waitFor({ state: 'attached', timeout: 5_000 }).catch(() => {});
    const count = Math.min(await links.count(), limit);
    const conversations = [];
    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute('href');
      if (!href) continue;
      conversations.push({ url: new URL(href, 'https://www.instagram.com').href, threadId: extractThreadId(href), preview: (await link.innerText().catch(() => '')).slice(0, 200) });
    }
    return conversations;
  }
  async collectButtonConversations(startUrl, limit, { tabName = '' } = {}) {
    if (limit <= 0) return [];
    // Keep each tab scan bounded so manual outbound cannot be starved behind a
    // long Primary + General + Requests discovery sweep.
    const deadline = Date.now() + 8_000;
    await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await this.page.waitForTimeout(2_500);
    const activateTab = async () => {
      if (!tabName) return;
      const tab = this.page.getByRole('tab', { name: new RegExp(`^${tabName}$`, 'i') }).first();
      if (await tab.count().catch(() => 0)) {
        await tab.click({ timeout: 3_000 }).catch(() => {});
        await this.page.waitForTimeout(1_200);
      }
    };
    await activateTab();
    const conversations = [];
    const seenPreviews = new Set();
    for (let attempt = 0; attempt < limit * 2 && conversations.length < limit && Date.now() < deadline; attempt += 1) {
      const buttons = this.page.locator('div[role="button"]:has(img)');
      await buttons.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
      const count = await buttons.count();
      let target = null; let preview = '';
      for (let index = 0; index < count; index += 1) {
        const candidate = buttons.nth(index);
        const candidatePreview = (await candidate.innerText({ timeout: 1_000 }).catch(() => '')).trim().slice(0, 200);
        const imageSource = await candidate.locator('img').first().getAttribute('src', { timeout: 1_000 }).catch(() => '');
        const stableLabel = candidatePreview.split('\n')[0] || imageSource || String(index);
        const key = `${stableLabel}:${imageSource}`;
        if (!seenPreviews.has(key)) { seenPreviews.add(key); target = candidate; preview = candidatePreview; break; }
      }
      if (!target) break;
      await this.safety.beforeConversationOpen();
      const clicked = await target.click({ timeout: 3_000 }).then(() => true).catch(() => false);
      if (!clicked) {
        await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
        await activateTab();
        continue;
      }
      await this.page.waitForTimeout(1_500);
      const url = this.page.url();
      const threadId = extractThreadId(url);
      if (threadId) conversations.push({ url, threadId, preview });
      await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await this.page.waitForTimeout(1_200);
      await activateTab();
    }
    return conversations;
  }
  async openConversation(conversation) {
    await this.safety.beforeConversationOpen();
    const target = conversation.url || `https://www.instagram.com/direct/t/${conversation.external_conversation_id}/`;
    await this.page.goto(target, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(600);
    return this.readActiveIdentity();
  }
  async readActiveIdentity() {
    const header = await this.page.locator('main h1, main h2, div[role="main"] h1, div[role="main"] h2, h1, h2').first().innerText().catch(() => '');
    const username = await this.page.locator('main a[href^="/"]:has(img), div[role="main"] a[href^="/"]:has(img)').first().getAttribute('href').catch(() => '');
    return buildConversationIdentity({
      url: this.page.url(), threadId: extractThreadId(this.page.url()),
      externalUsername: String(username || '').replaceAll('/', ''), headerIdentity: header,
      externalDisplayName: header, channelAccountId: this.config.channelAccountId,
      channelConnectionId: this.config.connectionId,
    });
  }
  async readMessages({ limit = 50 } = {}) {
    await this.ensurePage();
    const identity = await this.readActiveIdentity().catch(() => ({}));
    const identityLabels = [identity.external_username, identity.external_display_name, identity.header_identity];
    // Instagram adds the sender avatar/link to the first bubble of a message
    // cluster. Excluding groups that contain images or links silently drops that
    // real message, so use leaf groups and explicitly filter the profile card.
    const nodes = this.page.locator('[data-message-id], div[role="row"], div[role="group"]:not(:has(div[role="group"]))');
    const count = await nodes.count();
    const start = Math.max(0, count - limit);
    const output = [];
    for (let index = start; index < count; index += 1) {
      const node = nodes.nth(index);
      const text = (await node.innerText().catch(() => '')).trim();
      const hasLinkedImage = await node.locator('a[href] img').count().then((value) => value > 0).catch(() => false);
      const linkedIdentity = await node.locator('a[href]').first().getAttribute('href').catch(() => '');
      if (shouldSkipInstagramMessageCandidate({ text, hasLinkedImage, linkedIdentity, identityLabels })) continue;
      const externalMessageId = await node.getAttribute('data-message-id').catch(() => '');
      const aria = await node.getAttribute('aria-label').catch(() => '');
      const direction = /you sent|sent by you/i.test(aria || '') ? 'outgoing' : 'incoming';
      output.push({ text, direction, externalMessageId, domFingerprint: `${index}:${text.length}` });
    }
    return output;
  }
  async sendText(text) {
    const composer = await resolveSelector(this.page, instagramSelectors.composer);
    const before = await this.readMessages({ limit: 20 });
    await composer.fill(text).catch(async () => { await composer.click(); await this.page.keyboard.type(text); });
    const button = await resolveSelector(this.page, instagramSelectors.sendButton).catch(() => null);
    if (button) await button.click(); else await this.page.keyboard.press('Enter');
    return { before, clickedAt: new Date().toISOString() };
  }
  async markAsRead() { await this.page?.bringToFront(); return { marked: true }; }
  async reload() { await this.page?.reload({ waitUntil: 'domcontentloaded' }); }
  async interruptActivePage() {
    const activePage = this.page;
    this.page = null;
    if (!activePage) return;
    await Promise.race([
      activePage.close({ runBeforeUnload: false }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  async reopenInboxTab() { if (this.page) await this.page.close().catch(() => {}); this.page = await this.context.newPage(); await this.openInbox(); }
  async getHealthProbe() {
    const session = this.page ? await this.detectSession().catch(() => 'unknown') : 'unknown';
    return { browserRunning: this.browserRunning, authenticated: session === 'authenticated', session, inboxLoaded: /\/direct\//.test(this.page?.url?.() || ''), selectorVersion: SELECTOR_VERSION };
  }
  async memoryUsageMb() { const usage = process.memoryUsage(); return Math.round(usage.rss / 1024 / 1024); }
  async ensurePage() { if (!this.context || !this.page) await this.connect(); }
}
