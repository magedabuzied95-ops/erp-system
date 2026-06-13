const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const rootDir = process.cwd();
const frontendBaseUrl = 'http://127.0.0.1:5175';
const backendBaseUrl = 'http://127.0.0.1:8000';
const chromePort = 9226;
const log = (...args) => console.log('[pos-qa]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
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
    } catch (error) {
      lastError = error;
    }
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
    } catch (error) {
      lastError = error;
    }
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page eval failed');
  }
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

const findButtonState = async (cdp, needles) => evalPage(cdp, (texts) => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const target = buttons.find((button) => {
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    return texts.some((needle) => needle && text.includes(needle));
  });
  if (!target) return null;
  return {
    text: String(target.textContent || '').replace(/\s+/g, ' ').trim(),
    disabled: Boolean(target.disabled),
  };
}, needles);

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

const typeIntoInput = async (cdp, selector, value) => evalPage(cdp, (sel, nextValue) => {
  const input = document.querySelector(sel);
  if (!input) throw new Error(`Missing input ${sel}`);
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, String(nextValue));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, selector, value);

const findInputByPlaceholder = async (cdp, needles) => evalPage(cdp, (texts) => {
  const inputs = Array.from(document.querySelectorAll('input'));
  const target = inputs.find((input) => {
    const placeholder = String(input.placeholder || '').trim();
    return texts.some((needle) => needle && placeholder.includes(needle));
  });
  return target ? { placeholder: target.placeholder || '', type: target.type || '' } : null;
}, needles);

const typeIntoInputByPlaceholder = async (cdp, needles, value) => evalPage(cdp, (texts, nextValue) => {
  const inputs = Array.from(document.querySelectorAll('input'));
  const target = inputs.find((input) => {
    const placeholder = String(input.placeholder || '').trim();
    return texts.some((needle) => needle && placeholder.includes(needle));
  });
  if (!target) throw new Error(`Input not found: ${texts.join(' | ')}`);
  target.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(target, String(nextValue));
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, needles, value);

const pressEnterOnInputByPlaceholder = async (cdp, needles) => evalPage(cdp, (texts) => {
  const inputs = Array.from(document.querySelectorAll('input'));
  const target = inputs.find((input) => {
    const placeholder = String(input.placeholder || '').trim();
    return texts.some((needle) => needle && placeholder.includes(needle));
  });
  if (!target) throw new Error(`Input not found: ${texts.join(' | ')}`);
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
  return true;
}, needles);

const getText = async (cdp) => evalPage(cdp, () => String(document.body?.innerText || ''));

const countElements = async (cdp, selector) => evalPage(cdp, (sel) => Array.from(document.querySelectorAll(sel)).length, selector);

const clickFirstMatchingCard = async (cdp, needle) => evalPage(cdp, (textNeedle) => {
  const cards = Array.from(document.querySelectorAll('[role="button"]'));
  const target = cards.find((card) => String(card.textContent || '').includes(textNeedle));
  if (!target) throw new Error(`Product card not found for ${textNeedle}`);
  target.click();
  return true;
}, needle);

const clickVisibleButtonWithText = async (cdp, needle) => evalPage(cdp, (textNeedle) => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const target = buttons.find((button) => {
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    return text.includes(textNeedle) && button.offsetParent !== null;
  });
  if (!target) throw new Error(`Visible button not found: ${textNeedle}`);
  target.click();
  return true;
}, needle);

const clickModalAddButton = async (cdp) => evalPage(cdp, () => {
  const buttons = Array.from(document.querySelectorAll('button')).filter((button) => button.offsetParent !== null);
  const target = buttons.find((button) => {
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    return text.includes('Add to cart') || text.includes('إضافة للسلة') || text.includes('إضافة إلى الفاتورة');
  });
  if (!target) throw new Error('Add-to-cart button not found in modal');
  if (target.disabled) throw new Error('Add-to-cart button is disabled');
  target.click();
  return true;
});

const selectFirstSellerButton = async (cdp, sellerNeedles = []) => evalPage(cdp, (needles) => {
  const buttons = Array.from(document.querySelectorAll('button')).filter((button) => button.offsetParent !== null);
  const candidates = buttons.filter((button) => {
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    return text && !['Open POS shift', 'فتح شفت نقطة البيع', 'Create order', 'إنشاء طلب', 'آجل'].includes(text);
  });
  const target =
    candidates.find((button) => {
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      return needles.some((needle) => needle && text.includes(needle));
    }) ||
    candidates.find((button) => {
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      return /^Q[AZ]|^M|^A|^B|^\d+$/.test(text);
    }) ||
    candidates[0] ||
    null;
  if (!target) throw new Error('Seller button not found');
  target.click();
  return {
    text: String(target.textContent || '').replace(/\s+/g, ' ').trim(),
  };
}, sellerNeedles);

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
  const branchRes = await dbClient.query(`SELECT id, name, code FROM branches ORDER BY id ASC LIMIT 1`);
  if (!branchRes.rows.length) throw new Error('No branch found');
  const branchRow = branchRes.rows[0];

  const sellerRes = await fetchJson(`${backendBaseUrl}/api/pos/seller-users?branch_id=${branchRow.id}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id: admin.id, role: admin.role || 'admin', tenant_id: admin.tenant_id ?? null, is_super_admin: Boolean(admin.is_super_admin) }, process.env.JWT_SECRET || 'SECRET_KEY', { expiresIn: '7d' })}` },
  });
  const sellerRows = sellerRes.body?.users || sellerRes.body?.employees || [];
  const selectedSeller = sellerRows[0] || null;
  const selectedSellerId = String(selectedSeller?.employee_id || selectedSeller?.id || '');
  if (!selectedSellerId) {
    throw new Error('No POS seller user available for the branch');
  }

  const customerRes = await dbClient.query(`SELECT id, name, phone, balance, wallet_balance, total_orders, allow_personal_transactions FROM customers ORDER BY id ASC LIMIT 1`);
  if (!customerRes.rows.length) throw new Error('No customer found');
  const customer = customerRes.rows[0];

  const productARes = await dbClient.query(`
    SELECT p.id AS product_id, p.name AS product_name, p.variation_mode, p.sku, p.barcode,
           pv.id AS variant_id, pv.sku AS variant_sku, pv.barcode AS variant_barcode,
           pv.color, pv.size, pv.stock, pv.sale_price, pv.price
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.id = 5 AND pv.id = 101
    LIMIT 1
  `);
  const productBRes = await dbClient.query(`
    SELECT p.id AS product_id, p.name AS product_name, p.variation_mode, p.sku, p.barcode,
           pv.id AS variant_id, pv.sku AS variant_sku, pv.barcode AS variant_barcode,
           pv.color, pv.size, pv.stock, pv.sale_price, pv.price
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.id = 4 AND pv.id = 78
    LIMIT 1
  `);
  if (!productARes.rows.length || !productBRes.rows.length) throw new Error('Required POS test products missing');
  const productA = productARes.rows[0];
  const productB = productBRes.rows[0];

  const closedShiftRows = await dbClient.query(`
    UPDATE cash_drawer_shifts
    SET
      status = 'closed',
      closed_at = COALESCE(closed_at, NOW()),
      closed_by = COALESCE(closed_by, opened_by),
      closed_by_user_id = COALESCE(closed_by_user_id, opened_by_user_id),
      actual_cash = COALESCE(actual_cash, opening_cash, 0),
      closing_cash = COALESCE(closing_cash, opening_cash, 0),
      cash_difference = COALESCE(cash_difference, 0),
      difference = COALESCE(difference, 0)
    WHERE closed_at IS NULL
    RETURNING id
  `);
  log('closed stale shifts', closedShiftRows.rows.map((row) => row.id));

  const token = jwt.sign(
    {
      id: admin.id,
      role: admin.role || 'admin',
      tenant_id: admin.tenant_id ?? null,
      is_super_admin: Boolean(admin.is_super_admin),
    },
    process.env.JWT_SECRET || 'SECRET_KEY',
    { expiresIn: '7d' }
  );

  log('using account', admin.email, 'branch', branchRow.name, 'customer', customer.name, 'seller', selectedSellerId, 'products', productA.product_name, productB.product_name);

  const profileDir = path.join(rootDir, '.codex-chrome-qr-headless4');
  fs.mkdirSync(profileDir, { recursive: true });

  const wsUrl = await waitForWsUrl(chromePort, 120000);
  const cdp = await connectCdp(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (window.__qaFetchPatched) return;
      window.__qaFetchPatched = true;
      window.__qaRequests = [];
      window.__qaOrders = [];
      window.__qaConsoleErrors = [];
      window.__qaConsoleLogs = [];
      window.__qaRuntimeErrors = [];

      const originalConsoleLog = console.log.bind(console);
      const originalConsoleError = console.error.bind(console);
      console.log = (...args) => {
        try { window.__qaConsoleLogs.push(args.map((arg) => String(arg)).join(' ')); } catch {}
        return originalConsoleLog(...args);
      };
      console.error = (...args) => {
        try { window.__qaConsoleErrors.push(args.map((arg) => String(arg)).join(' ')); } catch {}
        return originalConsoleError(...args);
      };

      window.addEventListener('error', (event) => {
        window.__qaRuntimeErrors.push(String(event?.error?.stack || event?.message || 'window.error'));
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__qaRuntimeErrors.push(String(event?.reason?.stack || event?.reason?.message || event?.reason || 'unhandledrejection'));
      });

      const recordRequest = (payload) => {
        if (!payload || !payload.url) return;
        if (String(payload.url).includes('/pos/') || /\\/orders(?:[/?#]|$)/.test(String(payload.url))) {
          window.__qaRequests.push(payload);
        }
      };

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const [input, init = {}] = args;
        const url = typeof input === 'string' ? input : String(input?.url || '');
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const startedAt = performance.now();
        try {
          const response = await originalFetch(...args);
          recordRequest({ url, method, ok: response.ok, status: response.status, duration: Math.round(performance.now() - startedAt) });
          if (method === 'POST' && /\\/orders(?:[/?#]|$)/.test(url)) {
            try {
              const payload = await response.clone().json();
              window.__qaOrders.push({ url, status: response.status, ok: response.ok, payload });
            } catch (error) {
              window.__qaOrders.push({ url, status: response.status, ok: response.ok, error: String(error) });
            }
          }
          return response;
        } catch (error) {
          recordRequest({ url, method, ok: false, status: 0, error: String(error), duration: Math.round(performance.now() - startedAt) });
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
          const url = String(this.__qaUrl || '');
          if (url.includes('/pos/') || /\\/orders(?:[/?#]|$)/.test(url)) {
            const request = {
              url,
              method: String(this.__qaMethod || 'GET'),
              ok: this.status >= 200 && this.status < 300,
              status: Number(this.status || 0),
              duration: Math.round(performance.now() - startedAt),
            };
            recordRequest(request);
          }
        });
        return originalSend.call(this, body);
      };
    })();`,
  });
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify({
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
      }))});
      localStorage.setItem('app_language', 'en');
      localStorage.setItem('erp.saas.currentTenant', ${JSON.stringify(JSON.stringify({ id: String(admin.tenant_id || '1'), name: 'QA Tenant', slug: 'qa-tenant' }))});
      localStorage.setItem('erp.pos.cart', ${JSON.stringify(JSON.stringify([]))});
      localStorage.setItem('erp.pos.state', ${JSON.stringify(JSON.stringify({ paymentMode: 'cash', cashAmount: 0 }))});
      localStorage.setItem('pos.lastSalespersonId', ${JSON.stringify(selectedSellerId)});
      sessionStorage.removeItem('erp.pos.cart');
      sessionStorage.removeItem('erp.pos.session');
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  await cdp.send('Page.navigate', { url: frontendBaseUrl + '/' });
  await waitForPageCondition(cdp, () => document.readyState === 'complete', [], 60000);
  await waitForPageCondition(cdp, () => String(document.body?.innerText || '').length > 0, [], 60000);
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify({
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
      }))});
      localStorage.setItem('app_language', 'en');
      localStorage.setItem('erp.saas.currentTenant', ${JSON.stringify(JSON.stringify({ id: String(admin.tenant_id || '1'), name: 'QA Tenant', slug: 'qa-tenant' }))});
      localStorage.setItem('erp.pos.cart', ${JSON.stringify(JSON.stringify([]))});
      localStorage.setItem('erp.pos.state', ${JSON.stringify(JSON.stringify({ paymentMode: 'cash', cashAmount: 0 }))});
      localStorage.setItem('pos.lastSalespersonId', ${JSON.stringify(selectedSellerId)});
      sessionStorage.removeItem('erp.pos.cart');
      sessionStorage.removeItem('erp.pos.session');
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  await cdp.send('Page.navigate', { url: `${frontendBaseUrl}/pos` });
  await waitForPageCondition(cdp, () => document.readyState === 'complete', [], 60000);
  await waitForPageCondition(cdp, () => String(document.body?.innerText || '').length > 0, [], 60000);

  const initialText = await getText(cdp);
  log('initial text', initialText.slice(0, 1000));

  const shiftButtonState = await findButtonState(cdp, ['Open POS shift', 'فتح الشيفت', 'فتح شفت نقطة البيع']);
  log('shift gate button', JSON.stringify(shiftButtonState));
  if (!shiftButtonState) throw new Error('Open shift button missing');
  if (shiftButtonState.disabled) {
    await waitForPageCondition(cdp, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((button) => {
        const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
        return text.includes('Open POS shift') || text.includes('فتح الشيفت') || text.includes('فتح شفت نقطة البيع');
      });
      return Boolean(target && !target.disabled);
    }, [], 20000).catch(() => false);
  }
  const shiftGateLogs = await evalPage(cdp, () => (window.__qaConsoleLogs || []).filter((line) => line.includes('[pos-shift-gate]')));
  if (shiftGateLogs.length) {
    log('shift gate logs', JSON.stringify(shiftGateLogs, null, 2));
  }
  const shiftButtonStateAfterWait = await findButtonState(cdp, ['Open POS shift', 'فتح الشيفت', 'فتح شفت نقطة البيع']);
  if (!shiftButtonStateAfterWait) throw new Error('Open shift button missing after wait');
  if (shiftButtonStateAfterWait.disabled) {
    throw new Error('Open shift button remained disabled');
  }

  const openShiftRequestBefore = await evalPage(cdp, () => (window.__qaRequests || []).filter((item) => String(item.url || '').includes('/shifts/open')).length);
  await setInputValue(cdp, 'input[type="number"]', '0');
  await clickVisibleButtonWithText(cdp, 'فتح الشيفت').catch(async () => {
    await clickVisibleButtonWithText(cdp, 'Open POS shift');
  });
  const openShiftRequested = await waitForPageCondition(cdp, () => {
    const requests = window.__qaRequests || [];
    return requests.some((item) => String(item.url || '').includes('/shifts/open') && item.ok);
  }, [], 30000).then(() => true).catch(async () => {
    const requestDump = await evalPage(cdp, () => (window.__qaRequests || []).filter((item) => String(item.url || '').includes('/pos/')));
    const pageTextAfterClick = await getText(cdp);
    const gateLogsAfterClick = await evalPage(cdp, () => (window.__qaConsoleLogs || []).filter((line) => line.includes('[pos-shift-gate]')));
    log('shift gate logs after click', JSON.stringify(gateLogsAfterClick, null, 2));
    log('pos requests after click', JSON.stringify(requestDump, null, 2));
    log('page text after click', pageTextAfterClick.slice(0, 1000));
    return false;
  });
  if (!openShiftRequested) {
    throw new Error('Open shift request did not fire');
  }
  const openShiftRequestAfter = await evalPage(cdp, () => (window.__qaRequests || []).filter((item) => String(item.url || '').includes('/shifts/open')).length);
  if (!(openShiftRequestAfter > openShiftRequestBefore)) {
    throw new Error('Open shift request did not fire');
  }
  log('open shift request fired');

  await waitForPageCondition(cdp, () => {
    const body = String(document.body?.innerText || '');
    return body.includes('Search products') || body.includes('Search customer') || body.includes('Create order') || body.includes('Add to cart') || body.includes('إضافة للسلة');
  }, [], 60000);

  const sellerSelection = await selectFirstSellerButton(cdp, [String(selectedSeller?.name || ''), String(selectedSeller?.pos_alias || ''), String(selectedSellerId)]);
  log('selected seller', JSON.stringify(sellerSelection));

  await typeIntoInputByPlaceholder(cdp, ['Search products', 'ابحث عن المنتجات'], 'UNB-M-UNK');
  await clickFirstMatchingCard(cdp, 'UNB-M-UNK');
  await waitForPageCondition(cdp, () => String(document.body?.innerText || '').includes('Barcode Shop') || String(document.body?.innerText || '').includes('Choose the exact color and size') || String(document.body?.innerText || '').includes('اختَر اللون'), [], 15000);
  await clickModalAddButton(cdp);
  await waitForPageCondition(cdp, () => Number(Array.from(document.querySelectorAll('.pos-cart-item')).length) >= 1, [], 15000);

  await typeIntoInputByPlaceholder(cdp, ['Search products', 'ابحث عن المنتجات'], 'NK-J4-M-MIR-2-BLK-43-2');
  await pressEnterOnInputByPlaceholder(cdp, ['Search products', 'ابحث عن المنتجات']);
  await waitForPageCondition(cdp, () => Number(Array.from(document.querySelectorAll('.pos-cart-item')).length) >= 2, [], 15000);
  log('cart has two items');

  await evalPage(cdp, () => {
    const cartItems = Array.from(document.querySelectorAll('.pos-cart-item'));
    if (!cartItems.length) throw new Error('No cart items found');
    const first = cartItems[0];
    const inc = first.querySelector('button[aria-label*="Increase quantity"], button[aria-label*="زيادة الكمية"]');
    const dec = first.querySelector('button[aria-label*="Decrease quantity"], button[aria-label*="تقليل الكمية"]');
    if (!inc || !dec) throw new Error('Cart quantity buttons missing');
    inc.click();
    dec.click();
    return true;
  });

  await evalPage(cdp, () => {
    const cartItems = Array.from(document.querySelectorAll('.pos-cart-item'));
    if (cartItems.length < 2) throw new Error('Need two cart items to remove one');
    const second = cartItems[1];
    const remove = second.querySelector('button[aria-label*="Remove item"], button[aria-label*="إزالة العنصر"]');
    if (!remove) throw new Error('Remove button missing');
    remove.click();
    return true;
  });
  await waitForPageCondition(cdp, () => Number(Array.from(document.querySelectorAll('.pos-cart-item')).length) >= 1, [], 15000);
  log('quantity change and removal completed');

  await typeIntoInputByPlaceholder(cdp, ['Search customer by name or phone', 'ابحث عن العميل بالاسم أو الهاتف'], customer.phone || customer.name);
  await waitForPageCondition(cdp, () => {
    const body = String(document.body?.innerText || '');
    return body.includes(customer.name) || body.includes(customer.phone);
  }, [], 15000);
  await clickVisibleButtonWithText(cdp, customer.name);
  log('customer selected', customer.name);

  const checkoutBefore = await evalPage(cdp, () => (window.__qaOrders || []).length);
  await clickButtonByText(cdp, ['Create order', 'إنشاء طلب']);
  await waitForPageCondition(cdp, () => (window.__qaOrders || []).length > 0, [], 60000);
  const cashOrder = await evalPage(cdp, () => window.__qaOrders?.[0] || null);
  if (!cashOrder?.ok) {
    throw new Error(cashOrder?.payload?.message || cashOrder?.error || 'Cash checkout request failed');
  }
  log('cash checkout response', JSON.stringify(cashOrder, null, 2));

  await waitForPageCondition(cdp, () => String(document.body?.innerText || '').includes('Checkout complete') || String(document.body?.innerText || '').includes('تم إنشاء'), [], 15000).catch(() => true);
  await evalPage(cdp, () => {
    const buttons = Array.from(document.querySelectorAll('section button, .fixed button'));
    const closeButton = buttons.find((button) => !String(button.textContent || '').replace(/\s+/g, ' ').trim());
    if (closeButton) closeButton.click();
    return true;
  });
  await waitForPageCondition(cdp, () => !String(document.body?.innerText || '').includes('Checkout complete'), [], 15000).catch(() => true);

  await typeIntoInputByPlaceholder(cdp, ['Search products', 'ابحث عن المنتجات'], 'NK-J4-M-MIR-2-BLK-43-2');
  await pressEnterOnInputByPlaceholder(cdp, ['Search products', 'ابحث عن المنتجات']);
  await waitForPageCondition(cdp, () => Number(Array.from(document.querySelectorAll('.pos-cart-item')).length) >= 1, [], 15000);

  await typeIntoInputByPlaceholder(cdp, ['Search customer by name or phone', 'ابحث عن العميل بالاسم أو الهاتف'], customer.phone || customer.name);
  await waitForPageCondition(cdp, () => {
    const body = String(document.body?.innerText || '');
    return body.includes(customer.name) || body.includes(customer.phone);
  }, [], 15000);
  await clickVisibleButtonWithText(cdp, customer.name);

  await clickButtonByText(cdp, ['آجل']);
  await waitForPageCondition(cdp, () => (window.__qaOrders || []).length > checkoutBefore, [], 60000);
  const creditOrder = await evalPage(cdp, () => window.__qaOrders?.[1] || null);
  if (!creditOrder?.ok) {
    throw new Error(creditOrder?.payload?.message || creditOrder?.error || 'Credit checkout request failed');
  }
  log('credit checkout response', JSON.stringify(creditOrder, null, 2));

  const consoleErrors = await evalPage(cdp, () => window.__qaConsoleErrors || []);
  const runtimeErrors = await evalPage(cdp, () => window.__qaRuntimeErrors || []);
  log('console errors', JSON.stringify(consoleErrors, null, 2));
  log('runtime errors', JSON.stringify(runtimeErrors, null, 2));
  const posRequests = await evalPage(cdp, () => window.__qaRequests || []);
  log('pos requests', JSON.stringify(posRequests, null, 2));

  if (consoleErrors.length || runtimeErrors.length) {
    throw new Error(`Console/runtime errors detected: ${JSON.stringify({ consoleErrors, runtimeErrors }, null, 2)}`);
  }

  log('QA complete');
  await dbClient.end();
  try { cdp.socket.close(); } catch {}
})().catch((error) => {
  console.error('[pos-qa] failed', error?.stack || error?.message || error);
  process.exitCode = 1;
});
