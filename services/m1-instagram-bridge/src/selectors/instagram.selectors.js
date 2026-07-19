export const SELECTOR_VERSION = 'instagram-web-2026.07-pilot.3';

const entry = (primary, fallbacks, validate = async (locator) => (await locator.count()) > 0) =>
  Object.freeze({ primary, fallbacks: Object.freeze(fallbacks), version: SELECTOR_VERSION, validate });

export const instagramSelectors = Object.freeze({
  login: entry({ type: 'role', role: 'textbox', name: /phone|username|email/i }, ['input[name="username"]']),
  directInbox: entry({ type: 'url', value: /\/direct\/inbox\/?/ }, ['a[href^="/direct/inbox"]']),
  conversationList: entry({ type: 'role', role: 'main' }, ['div[role="main"]']),
  conversationItem: entry({ type: 'role', role: 'link' }, ['a[href*="/direct/t/"]', 'div[role="button"]:has(img)']),
  unreadIndicator: entry({ type: 'semantic', value: 'unread-indicator' }, ['[aria-label*="unread" i]', '[aria-label*="new message" i]']),
  activeConversationHeader: entry({ type: 'role', role: 'heading' }, ['main h1', 'main h2', 'div[role="main"] h1', 'div[role="main"] h2']),
  messageList: entry({ type: 'role', role: 'main' }, ['div[role="main"]']),
  incomingMessage: entry({ type: 'semantic', value: 'incoming-message' }, ['[data-message-id]', 'div[role="group"]:not(:has(a)):not(:has(button)):not(:has(img))']),
  outgoingMessage: entry({ type: 'semantic', value: 'outgoing-message' }, ['[data-message-id]', '[aria-label*="you sent" i]', '[aria-label*="sent by you" i]']),
  composer: entry({ type: 'role', role: 'textbox', name: /message/i }, ['textarea[placeholder]', 'div[contenteditable="true"]']),
  acceptMessageRequest: entry({ type: 'role', role: 'button', name: /^accept$/i }, ['button:has-text("Accept")']),
  sendButton: entry({ type: 'role', role: 'button', name: /send/i }, ['button[type="submit"]']),
  loginChallenge: entry({ type: 'text', value: /security code|confirm it was you|two-factor|challenge/i }, ['form[action*="challenge"]']),
  sessionExpired: entry({ type: 'text', value: /log in|login/i }, ['input[name="username"]']),
  loadingState: entry({ type: 'semantic', value: 'loading-state' }, ['[aria-busy="true"]', '[role="progressbar"]', 'div[role="status"]']),
});

export async function resolveSelector(page, definition) {
  const candidates = [];
  const primary = definition.primary;
  if (primary.type === 'role') candidates.push(page.getByRole(primary.role, { name: primary.name }));
  if (primary.type === 'text') candidates.push(page.getByText(primary.value));
  for (const selector of definition.fallbacks) candidates.push(page.locator(selector));
  for (const candidate of candidates) {
    if (await definition.validate(candidate).catch(() => false)) return candidate;
  }
  throw Object.assign(new Error('Instagram selector is unavailable'), { code: 'SELECTOR_MISSING', selector_version: definition.version });
}
