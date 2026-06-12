const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const pg = require('pg');
const { Client } = pg;

const rootDir = process.cwd();
const frontendBaseUrl = 'http://127.0.0.1:5175';
const backendBaseUrl = 'http://127.0.0.1:8000';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = path.join(rootDir, '.codex-chrome-qr-headless4');
const screenshotPath = path.join(rootDir, '.codex-pos-qa.png');
const log = (...args) => console.log('[pos-qa]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
};
const waitForHttp = async (url, timeoutMs = 60000) => {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
      lastError = new Error(`${url} -> ${res.status}`);
    } catch (error) { lastError = error; }
    await sleep(500);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
};
const waitForWsUrl = async (port, timeoutMs = 60000) => {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const { body } = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = Array.isArray(body) ? body.find((target) => target?.type === 'page' && target?.webSocketDebuggerUrl) : null;
      if (pageTarget?.webSocketDebuggerUrl) return pageTarget.webSocketDebuggerUrl;
    } catch (error) { lastError = error; }
    await sleep(300);
  }
  throw lastError || new Error(`Timed out waiting for Chrome on ${port}`);
};
const connectCdp = async (wsUrl) => {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || `CDP ${message.id} failed`));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
};
const evalPage = async (cdp, fn, ...args) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page eval failed');
  return result.result?.value;
};
const waitForPageCondition = async (cdp, predicateFn, args = [], timeoutMs = 60000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evalPage(cdp, predicateFn, ...args)) return true;
    } catch {}
    await sleep(250);
  }
  throw new Error('Timed out waiting for page condition');
};
const navigate = async (cdp, url) => {
  log('navigate', url);
  await cdp.send('Page.navigate', { url });
  await waitForPageCondition(cdp, () => document.readyState === 'complete', [], 60000);
};
const clickButtonByText = async (cdp, texts) => evalPage(cdp, (needles) => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const target = buttons.find((button) => {
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    return needles.some((needle) => needle && text.includes(needle));
  });
  if (!target) throw new Error(`Button not found: ${needles.join(' | ')}`);
  target.click();
  return true;
}, texts);
const setInputValue = async (cdp, selector, value) => evalPage(cdp, (sel, nextValue) => {
  const input = document.querySelector(sel);
  if (!input) throw new Error(`Missing input ${sel}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, String(nextValue));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, selector, value);
const getText = async (cdp) => evalPage(cdp, () => String(document.body?.innerText || ''));
const captureScreenshot = async (cdp, outPath) => {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(outPath, Buffer.from(result.data, 'base64'));
};

(async () => {
  log('waiting for services');
  await waitForHttp(`${backendBaseUrl}/api/health`, 120000);
  await waitForHttp(`${frontendBaseUrl}/`, 120000);
  log('services ready');

  const dbClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '065342',
    database: process.env.PGDATABASE || 'erp_db',
  });
  await dbClient.connect();
  const adminRes = await dbClient.query(`SELECT id, email, name, role, is_super_admin, tenant_id FROM users WHERE is_super_admin = true ORDER BY id ASC LIMIT 1`);
  if (!adminRes.rows.length) throw new Error('No super admin user found');
  const admin = adminRes.rows[0];
  const branchRes = await dbClient.query(`SELECT id, name, code FROM branches WHERE id = 5 LIMIT 1`);
  if (!branchRes.rows.length) throw new Error('Branch 5 missing');
  const branchRow = branchRes.rows[0];
  const productRes = await dbClient.query(`
    SELECT p.id AS product_id, p.name AS product_name, p.variation_mode, p.sku, p.barcode, p.image_url, p.image,
           pv.id AS variant_id, pv.sku AS variant_sku, pv.barcode AS variant_barcode, pv.color, pv.size,
           pv.stock, pv.price, pv.sale_price, pv.image_url AS variant_image_url, pv.image AS variant_image
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE pv.deleted_at IS NULL AND pv.is_active IS DISTINCT FROM FALSE AND COALESCE(pv.stock, 0) > 0
    ORDER BY p.id ASC, pv.id ASC
    LIMIT 1
  `);
  if (!productRes.rows.length) throw new Error('No sellable product found');
  const row = productRes.rows[0];
  const token = jwt.sign({ id: admin.id, role: admin.role || 'admin', tenant_id: admin.tenant_id ?? null, is_super_admin: Boolean(admin.is_super_admin) }, process.env.JWT_SECRET || 'SECRET_KEY', { expiresIn: '7d' });
  const cartItem = {
    key: `${row.product_id}:${row.variant_id}`,
    product_id: row.product_id,
    variant_id: row.variant_id,
    name: String(row.product_name || 'Product'),
    product_name: String(row.product_name || 'Product'),
    sku: String(row.variant_sku || row.sku || ''),
    barcode: String(row.variant_barcode || row.barcode || row.variant_sku || ''),
    color: String(row.color || ''),
    size: String(row.size || ''),
    selected_color: String(row.color || ''),
    selected_size: String(row.size || ''),
    variant_color: String(row.color || ''),
    variant_size: String(row.size || ''),
    stock: Number(row.stock || 1),
    stock_quantity: Number(row.stock || 1),
    image_url: String(row.variant_image_url || row.image_url || row.image || ''),
    image: String(row.variant_image || row.image || ''),
    product_image: String(row.image_url || row.image || ''),
    variant_image: String(row.variant_image || ''),
    product_image_url: String(row.image_url || ''),
    variant_image_url: String(row.variant_image_url || ''),
    price: Number(row.sale_price || row.price || 0),
    original_price: Number(row.price || row.sale_price || 0),
    sale_badge: '',
    sale_source: 'regular',
    sale_mode_applied: false,
    brand: '',
    category: '',
    manufacturer: '',
    variation_mode: String(row.variation_mode || 'full_variations'),
    fixed_size_label: '',
    lineDiscount: 0,
    quantity: 1,
    product: { id: row.product_id, name: row.product_name },
    variant: { id: row.variant_id, color: row.color, size: row.size },
    product_variant: { id: row.variant_id, color: row.color, size: row.size },
  };
  log('using account', admin.email, 'branch', branchRow.name, 'product', row.product_name, 'variant', row.variant_id);

  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9226',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stdout.on('data', (chunk) => process.stdout.write(`[chrome] ${chunk}`));
  chrome.stderr.on('data', (chunk) => process.stderr.write(`[chrome:err] ${chunk}`));

  let cdp;
  try {
    const wsUrl = await waitForWsUrl(9226, 120000);
    log('chrome ready');
    cdp = await connectCdp(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await navigate(cdp, frontendBaseUrl + '/');
    log('seeding auth/session');
    await evalPage(cdp, (payload) => {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify(payload.user));
      localStorage.setItem('app_language', 'en');
      localStorage.setItem('erp.saas.currentTenant', JSON.stringify({ id: payload.tenantId, name: 'QA Tenant', slug: 'qa-tenant' }));
      localStorage.setItem('erp.pos.cart', JSON.stringify(payload.cart));
      localStorage.setItem('erp.pos.state', JSON.stringify({ paymentMode: 'cash', cashAmount: 0 }));
      sessionStorage.removeItem('erp.pos.cart');
      sessionStorage.removeItem('erp.pos.session');
      if (!window.__qaFetchPatched) {
        window.__qaFetchPatched = true;
        window.__qaRequests = [];
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const [input, init = {}] = args;
          const url = typeof input === 'string' ? input : String(input?.url || '');
          const method = String(init.method || input?.method || 'GET').toUpperCase();
          const startedAt = performance.now();
          try {
            const response = await originalFetch(...args);
            if (url.includes('/pos/')) {
              window.__qaRequests.push({
                url,
                method,
                ok: response.ok,
                status: response.status,
                duration: Math.round(performance.now() - startedAt),
              });
            }
            return response;
          } catch (error) {
            if (url.includes('/pos/')) {
              window.__qaRequests.push({
                url,
                method,
                ok: false,
                status: 0,
                error: String(error),
                duration: Math.round(performance.now() - startedAt),
              });
            }
            throw error;
          }
        };
        const originalOpen = window.XMLHttpRequest.prototype.open;
        const originalSend = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__qaMethod = String(method || 'GET').toUpperCase();
          this.__qaUrl = String(url || '');
          return originalOpen.call(this, method, url, ...rest);
        };
        window.XMLHttpRequest.prototype.send = function(body) {
          const startedAt = performance.now();
          this.addEventListener('loadend', () => {
            if (String(this.__qaUrl || '').includes('/pos/')) {
              window.__qaRequests.push({
                url: String(this.__qaUrl || ''),
                method: String(this.__qaMethod || 'GET'),
                ok: this.status >= 200 && this.status < 300,
                status: Number(this.status || 0),
                duration: Math.round(performance.now() - startedAt),
              });
            }
          });
          return originalSend.call(this, body);
        };
      }
      return true;
    }, {
      token,
      tenantId: String(admin.tenant_id || '1'),
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role || 'admin',
        role_name: admin.role || 'admin',
        is_super_admin: Boolean(admin.is_super_admin),
        tenant_id: String(admin.tenant_id || '1'),
        branch_id: String(branchRow.id),
        branch_name: String(branchRow.name),
        branch: { id: String(branchRow.id), name: String(branchRow.name) },
      },
      cart: [cartItem],
    });

    await navigate(cdp, `${frontendBaseUrl}/pos`);
    await waitForPageCondition(cdp, () => String(window.location.pathname || '').startsWith('/pos'), [], 60000);
    await waitForPageCondition(cdp, () => String(document.body?.innerText || '').length > 0, [], 60000);
    const posText = await getText(cdp);
    log('initial text', posText.slice(0, 1000));
    log('pos requests', JSON.stringify(await evalPage(cdp, () => window.__qaRequests || []), null, 2));

    if (posText.includes('Open shift') || posText.includes('فتح الشيفت')) {
      const buttonState = await evalPage(cdp, () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find((button) => {
          const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
          return text.includes('Open shift') || text.includes('فتح الشيفت');
        });
        return target ? { disabled: target.disabled, text: String(target.textContent || '').replace(/\s+/g, ' ').trim() } : null;
      });
      if (!buttonState) throw new Error('Open shift button missing');
      log('shift gate button', JSON.stringify(buttonState));
      if (buttonState.disabled) {
        const enabled = await waitForPageCondition(cdp, () => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const target = buttons.find((button) => {
            const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
            return text.includes('Open shift') || text.includes('فتح الشيفت');
          });
          return Boolean(target && !target.disabled);
        }, [], 20000).then(() => true).catch(() => false);
        if (!enabled) {
          const nextState = await evalPage(cdp, () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find((button) => {
              const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
              return text.includes('Open shift') || text.includes('فتح الشيفت');
            });
            return target ? { disabled: target.disabled, text: String(target.textContent || '').replace(/\s+/g, ' ').trim() } : null;
          });
          log('shift gate still disabled after wait', JSON.stringify(nextState));
          log('pos requests after wait', JSON.stringify(await evalPage(cdp, () => window.__qaRequests || []), null, 2));
          throw new Error('Open shift button remained disabled');
        }
      }
      await setInputValue(cdp, 'input[type="number"]', '0');
      await clickButtonByText(cdp, ['فتح الشيفت', 'Open shift']);
      await waitForPageCondition(cdp, () => {
        const body = String(document.body?.innerText || '');
        return body.includes('Checkout') || body.includes('Create order') || body.includes('Add to cart') || body.includes('إضافة إلى الفاتورة') || body.includes('السلة');
      }, [], 60000);
      log('shift opened');
    }

    await waitForPageCondition(cdp, () => {
      const body = String(document.body?.innerText || '');
      return body.includes('Checkout') || body.includes('Create order') || body.includes('إتمام') || body.includes('الفاتورة');
    }, [], 60000);
    log('pos shell ready');

    const cartCount = await evalPage(cdp, () => Array.from(document.querySelectorAll('.pos-cart-item')).length);
    log('cart item count', String(cartCount));
    if (!(cartCount > 0)) throw new Error('Cart was not populated');

    await evalPage(cdp, () => {
      if (window.__qaFetchPatched) return true;
      window.__qaFetchPatched = true;
      window.__qaOrders = [];
      window.__qaConsoleErrors = [];
      const originalError = console.error.bind(console);
      console.error = (...args) => {
        try { window.__qaConsoleErrors.push(args.map((arg) => String(arg)).join(' ')); } catch {}
        return originalError(...args);
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const [input, init = {}] = args;
        const url = typeof input === 'string' ? input : String(input?.url || '');
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const response = await originalFetch(...args);
        if (method === 'POST' && /\/orders(?:[/?#]|$)/.test(url)) {
          try {
            const payload = await response.clone().json();
            window.__qaOrders.push({ url, status: response.status, ok: response.ok, payload });
          } catch (error) {
            window.__qaOrders.push({ url, status: response.status, ok: response.ok, error: String(error) });
          }
        }
        return response;
      };
      return true;
    });

    await clickButtonByText(cdp, ['Create order', 'Checkout', 'إتمام', 'حفظ الفاتورة']);
    log('checkout clicked');
    await waitForPageCondition(cdp, () => (window.__qaOrders || []).length > 0, [], 60000);

    const orderResult = await evalPage(cdp, () => window.__qaOrders?.[0] || null);
    log('checkout response', JSON.stringify(orderResult, null, 2));
    if (!orderResult?.ok) throw new Error(orderResult?.payload?.message || orderResult?.error || 'Checkout request failed');
    const orderId = orderResult?.payload?.order?.id || orderResult?.payload?.orderId || orderResult?.payload?.id || null;
    if (!orderId) throw new Error('Checkout did not return an order id');

    await waitForPageCondition(cdp, () => String(document.body?.innerText || '').includes('Invoice') || String(document.body?.innerText || '').includes('Success') || String(document.body?.innerText || '').includes('تم إنشاء'), [], 30000).catch(() => true);
    await captureScreenshot(cdp, screenshotPath);

    const orderLookup = await fetchJson(`${backendBaseUrl}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!orderLookup.response.ok) throw new Error(orderLookup.body?.message || `Could not load order ${orderId}`);

    const consoleErrors = await evalPage(cdp, () => window.__qaConsoleErrors || []);
    log('console errors', JSON.stringify(consoleErrors, null, 2));
    log('order lookup id', String(orderLookup.body?.order?.id || orderLookup.body?.id || orderId));
    log('screenshot', screenshotPath);
  } finally {
    try { if (cdp) await cdp.send('Browser.close'); } catch {}
    try { chrome.kill('SIGTERM'); } catch {}
    await sleep(1000);
    try { await dbClient.end(); } catch {}
  }
})().catch((error) => {
  console.error('[pos-qa] failed', error?.stack || error?.message || error);
  process.exitCode = 1;
});
