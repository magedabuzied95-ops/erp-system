import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { instagramSelectors, resolveSelector, SELECTOR_VERSION } from '../selectors/instagram.selectors.js';
import { buildConversationIdentity, extractThreadId } from '../domain/identity.js';

const DIRECT_INBOX_URL = 'https://www.instagram.com/direct/inbox/';
const DIRECT_REQUESTS_URL = 'https://www.instagram.com/direct/requests/';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';

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
    const conversations = await this.collectLinkedConversations(limit);
    if (conversations.length < limit) conversations.push(...await this.collectButtonConversations(DIRECT_INBOX_URL, limit - conversations.length));
    if (conversations.length < limit) conversations.push(...await this.collectButtonConversations(DIRECT_REQUESTS_URL, limit - conversations.length));
    return [...new Map(conversations.map((item) => [item.threadId || item.url, item])).values()].slice(0, limit);
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
  async collectButtonConversations(startUrl, limit) {
    if (limit <= 0) return [];
    await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(2_500);
    const conversations = [];
    const seenPreviews = new Set();
    for (let attempt = 0; attempt < limit * 3 && conversations.length < limit; attempt += 1) {
      const buttons = this.page.locator('div[role="button"]:has(img)');
      await buttons.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
      const count = await buttons.count();
      let target = null; let preview = '';
      for (let index = 0; index < count; index += 1) {
        const candidate = buttons.nth(index);
        const candidatePreview = (await candidate.innerText().catch(() => '')).trim().slice(0, 200);
        const key = `${index}:${candidatePreview}`;
        if (!seenPreviews.has(key)) { seenPreviews.add(key); target = candidate; preview = candidatePreview; break; }
      }
      if (!target) break;
      await this.safety.beforeConversationOpen();
      await target.click();
      await this.page.waitForTimeout(1_500);
      const url = this.page.url();
      const threadId = extractThreadId(url);
      if (threadId) conversations.push({ url, threadId, preview });
      await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1_200);
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
    const nodes = this.page.locator('[data-message-id], div[role="row"], div[role="group"]:not(:has(a)):not(:has(button)):not(:has(img))');
    const count = await nodes.count();
    const start = Math.max(0, count - limit);
    const output = [];
    for (let index = start; index < count; index += 1) {
      const node = nodes.nth(index);
      const text = (await node.innerText().catch(() => '')).trim();
      if (!text || /view once|disappearing|vanish mode/i.test(text)) continue;
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
  async reopenInboxTab() { if (this.page) await this.page.close().catch(() => {}); this.page = await this.context.newPage(); await this.openInbox(); }
  async getHealthProbe() {
    const session = this.page ? await this.detectSession().catch(() => 'unknown') : 'unknown';
    return { browserRunning: this.browserRunning, authenticated: session === 'authenticated', session, inboxLoaded: /\/direct\//.test(this.page?.url?.() || ''), selectorVersion: SELECTOR_VERSION };
  }
  async memoryUsageMb() { const usage = process.memoryUsage(); return Math.round(usage.rss / 1024 / 1024); }
  async ensurePage() { if (!this.context || !this.page) await this.connect(); }
}
