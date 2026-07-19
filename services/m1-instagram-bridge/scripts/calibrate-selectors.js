import 'dotenv/config';
import { loadConfig, assertSafePilotConfig } from '../src/config.js';
import { InstagramPlaywrightDriver } from '../src/browser/InstagramPlaywrightDriver.js';
import { validateStagingIsolation } from '../../shared/stagingIsolation.js';

validateStagingIsolation(process.env, { requireDatabaseUrl: false });
const config = loadConfig();
assertSafePilotConfig(config);

const driver = new InstagramPlaywrightDriver({
  config,
  diagnostics: null,
  safety: { beforeConversationOpen: async () => {} },
});

const count = async (page, selector) => page.locator(selector).count().catch(() => 0);
const directRoutes = async (page) => page.locator('a[href*="/direct/"]').evaluateAll((links) =>
  [...new Set(links.map((link) => {
    const pathname = new URL(link.href).pathname;
    return pathname.replace(/\/direct\/t\/[^/]+\/?/, '/direct/t/:id/');
  }))].sort()).catch(() => []);
const interactiveShape = async (page) => page.locator('main [role], div[role="main"] [role]').evaluateAll((nodes) => {
  const counts = new Map();
  for (const node of nodes) {
    const role = node.getAttribute('role') || 'none';
    const key = [node.tagName.toLowerCase(), role, node.hasAttribute('tabindex') ? 'tabindex' : 'no-tabindex',
      node.querySelector('img') ? 'has-img' : 'no-img', node.textContent?.trim() ? 'has-text' : 'no-text'].join('|');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}).catch(() => ({}));

try {
  await driver.connect();
  await driver.openInbox();
  const page = driver.page;
  const result = {
    session: await driver.detectSession(),
    inbox_url: /\/direct\/inbox\/?/.test(page.url()),
    inbox_routes: await directRoutes(page),
    inbox_interactive_shape: await interactiveShape(page),
    inbox_tabs: await page.locator('[role="tab"]').evaluateAll((tabs) => tabs.map((tab) => ({
      text: (tab.innerText || tab.textContent || '').trim(),
      selected: tab.getAttribute('aria-selected'),
    }))).catch(() => []),
    inbox_button_previews: await page.locator('div[role="button"]:has(img)').evaluateAll((buttons) => buttons.map((button) => ({
      text: (button.innerText || button.textContent || '').trim().slice(0, 200),
      images: button.querySelectorAll('img').length,
    }))).catch(() => []),
    selectors: {
      direct_inbox: await count(page, 'a[href^="/direct/inbox"]'),
      conversation_list: await count(page, 'main, div[role="main"]'),
      conversation_item: await count(page, 'a[href*="/direct/t/"]'),
      unread_indicator: await count(page, '[aria-label*="unread" i], [aria-label*="new message" i]'),
      active_conversation_header: await count(page, 'header h1, header h2'),
      message_list: await count(page, '[data-message-id], div[role="row"]'),
      incoming_message: await count(page, '[data-message-id], div[role="row"]'),
      outgoing_message: await count(page, '[aria-label*="you sent" i], [aria-label*="sent by you" i]'),
      composer: await count(page, '[role="textbox"][contenteditable="true"], textarea[placeholder]'),
      send_button: await count(page, 'button[type="submit"]'),
      login_challenge: await count(page, 'form[action*="challenge"]'),
      session_expired: await count(page, 'input[name="username"]'),
      loading_state: await count(page, '[aria-busy="true"], [role="progressbar"]'),
    },
  };
  await page.goto('https://www.instagram.com/direct/requests/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3_000);
  result.requests = {
    requests_url: /\/direct\/requests\/?/.test(page.url()),
    routes: await directRoutes(page),
    interactive_shape: await interactiveShape(page),
    conversation_item: await count(page, 'a[href*="/direct/t/"]'),
    buttons: await count(page, 'button'),
    loading_state: await count(page, '[aria-busy="true"], [role="progressbar"]'),
  };
  const firstRequest = page.locator('div[role="button"]:has(img)').first();
  if (await firstRequest.count()) {
    await firstRequest.click();
    await page.waitForTimeout(2_500);
    result.opened_request = {
      thread_url: /\/direct\/t\/[^/]+\/?/.test(page.url()),
      routes: await directRoutes(page),
      interactive_shape: await interactiveShape(page),
      headings: await count(page, 'header h1, header h2, h1, h2'),
      message_rows: await count(page, '[data-message-id], div[role="row"]'),
      composer: await count(page, '[role="textbox"][contenteditable="true"], textarea[placeholder]'),
      send_controls: await count(page, '[role="button"], button[type="submit"]'),
      scoped_headings: await count(page, 'main h1, main h2, div[role="main"] h1, div[role="main"] h2'),
      test_token_groups: await page.locator('div[role="group"]').evaluateAll((groups) => groups.map((group) => ({
        has_img: Boolean(group.querySelector('img')),
        buttons: group.querySelectorAll('[role="button"], button').length,
        links: group.querySelectorAll('a[href]').length,
        aria_label: group.getAttribute('aria-label') || '',
        text_preview: (group.innerText || group.textContent || '').trim().slice(0, 300),
        nested_groups: group.querySelectorAll('div[role="group"]').length,
        tokens: group.textContent?.match(/IG-(?:A|B)-(?:001|PARALLEL)-\d{8}-\d{6}/g) || [],
      }))).catch(() => []),
      request_actions: await page.locator('[role="button"], button').evaluateAll((controls) => controls
        .map((control) => control.textContent?.trim() || '')
        .filter((label) => /^(accept|delete|block|decline)$/i.test(label))).catch(() => []),
    };
  }
  try {
    const conversations = await driver.listConversations({ limit: 6 });
    const tokenThreads = [];
    for (const conversation of conversations) {
      await driver.openConversation(conversation);
      const messages = await driver.readMessages({ limit: 20 });
      tokenThreads.push(messages.flatMap((message) => message.text.match(/IG-(?:A|B)-(?:001|PARALLEL)-\d{8}-\d{6}/g) || []));
    }
    result.driver_discovery = { conversations: conversations.length, token_threads: tokenThreads };
  } catch (error) {
    const message = String(error?.message || '');
    result.driver_discovery = {
      error_code: error?.code || 'UNKNOWN',
      error_name: error?.name || 'Error',
      error_category: /rate limit/i.test(message) ? 'rate_limited'
        : /timeout/i.test(message) ? 'timeout'
          : /strict mode/i.test(message) ? 'strict_mode'
            : /closed/i.test(message) ? 'target_closed'
              : /detached/i.test(message) ? 'detached'
                : 'other',
    };
  }
  console.log(JSON.stringify(result));
} finally {
  await driver.disconnect();
}
