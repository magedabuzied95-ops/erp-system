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

try {
  await driver.connect();
  await driver.openInbox();
  const page = driver.page;
  const result = {
    session: await driver.detectSession(),
    inbox_url: /\/direct\/inbox\/?/.test(page.url()),
    inbox_routes: await directRoutes(page),
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
    conversation_item: await count(page, 'a[href*="/direct/t/"]'),
    buttons: await count(page, 'button'),
    loading_state: await count(page, '[aria-busy="true"], [role="progressbar"]'),
  };
  console.log(JSON.stringify(result));
} finally {
  await driver.disconnect();
}
