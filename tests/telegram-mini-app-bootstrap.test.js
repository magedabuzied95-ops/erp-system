import test from "node:test";
import assert from "node:assert/strict";

// The storefront opened from the Telegram shop bot is a mini app. Telegram does
// not inject its bridge on its own and opens the view at half the screen height
// until the page asks for the rest, so the page has to do both -- and must cost
// an ordinary shopper nothing.

const loadModule = async ({ hash = "", search = "", bridge = "ok" } = {}) => {
  const appended = [];
  const telegramApi = { platform: "android", initData: "", ready: () => { telegramApi.readyCalled = true; }, expand: () => { telegramApi.expandCalled = true; } };
  const classes = new Set();
  global.window = { location: { hash, search } };
  global.document = {
    documentElement: { classList: { add: (name) => classes.add(name) } },
    head: { appendChild: (script) => { appended.push(script); script.__fire(bridge === "ok" ? "load" : "error"); } },
    createElement: () => {
      const listeners = {};
      return {
        set src(value) { this._src = value; },
        get src() { return this._src; },
        async: false,
        addEventListener: (event, fn) => { listeners[event] = fn; },
        __fire: (event) => {
          if (bridge === "ok") global.window.Telegram = { WebApp: telegramApi };
          listeners[event]?.();
        },
      };
    },
  };
  // A fresh module instance per case: the bridge loader memoizes by design.
  const mod = await import(`../src/storefront/lib/telegramWebApp.js?case=${encodeURIComponent(`${hash}|${search}|${bridge}`)}`);
  return { mod, appended, telegramApi, classes };
};

test.afterEach(() => {
  delete global.window;
  delete global.document;
});

test("an ordinary shopper never loads Telegram's script", async () => {
  const { mod, appended } = await loadModule({ hash: "", search: "?utm_source=facebook" });
  assert.equal(mod.looksLikeTelegramWebApp(), false);
  assert.equal(await mod.initTelegramWebApp(), false);
  assert.equal(appended.length, 0, "no third-party request on a normal visit");
});

test("inside Telegram the bridge is loaded and the view is expanded to full height", async () => {
  const { mod, appended, telegramApi, classes } = await loadModule({
    hash: "#tgWebAppData=abc&tgWebAppVersion=7.0&tgWebAppPlatform=android",
  });
  assert.equal(mod.looksLikeTelegramWebApp(), true);
  assert.equal(await mod.initTelegramWebApp(), true);
  assert.equal(appended.length, 1);
  assert.match(appended[0].src, /^https:\/\/telegram\.org\/js\/telegram-web-app\.js$/);
  assert.equal(telegramApi.readyCalled, true);
  assert.equal(telegramApi.expandCalled, true, "without expand the checkout opens in half a phone screen");
  assert.ok(classes.has("in-telegram"));
});

test("a blocked Telegram CDN leaves the shop working instead of hanging on it", async () => {
  const { mod } = await loadModule({ hash: "#tgWebAppPlatform=ios", bridge: "error" });
  assert.equal(await mod.initTelegramWebApp(), false);
});

test("the back button unbinds cleanly, and is a no-op when Telegram is not there", async () => {
  const { mod, telegramApi } = await loadModule({ hash: "#tgWebAppPlatform=android" });
  let shown = 0;
  let hidden = 0;
  telegramApi.BackButton = { show: () => { shown += 1; }, hide: () => { hidden += 1; }, onClick: () => {}, offClick: () => {} };
  await mod.initTelegramWebApp();
  const unbind = mod.bindTelegramBackButton(() => {});
  assert.equal(shown, 1);
  unbind();
  assert.equal(hidden, 1);
  // No handler, no Telegram: still returns a callable.
  assert.equal(typeof mod.bindTelegramBackButton(null), "function");
});
