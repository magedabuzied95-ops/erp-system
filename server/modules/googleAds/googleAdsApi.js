import crypto from 'node:crypto';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const customerId = (value) => {
  const id = String(value || '').replace(/-/g, '');
  if (!/^\d{10}$/.test(id)) throw fail('Invalid Google Ads customer ID');
  return id;
};
export const micros = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 1e8) throw fail('Invalid budget');
  return String(Math.round(amount * 1e6));
};
const key = () => {
  const material = process.env.GOOGLE_ADS_ENCRYPTION_KEY || '';
  if (material.length < 32 || new Set(material).size < 8) throw fail('Google Ads encryption key is not configured', 503);
  return crypto.createHash('sha256').update(`google-ads:v1:${material}`).digest();
};
export const encrypt = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['ga1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
};
export const decrypt = (value) => {
  const [prefix, iv, tag, data] = String(value).split(':');
  if (prefix !== 'ga1') throw fail('Invalid credential envelope', 503);
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
};
export const setup = () => {
  const missing = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REDIRECT_URI', 'GOOGLE_ADS_FRONTEND_URL'].filter(name => !process.env[name]);
  try { key(); } catch { missing.push('GOOGLE_ADS_ENCRYPTION_KEY'); }
  return { ready: !missing.length, missing };
};
export const tokenRequest = async (params) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ client_id: process.env.GOOGLE_ADS_CLIENT_ID, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET, ...params }),
  });
  const data = await response.json();
  if (!response.ok) throw fail('Google authorization failed. Reconnect the account.', 502);
  return data;
};
export const googleRequest = async (accessToken, path, body, loginId = '') => {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  if (loginId) headers['login-customer-id'] = customerId(loginId);
  // Optional legacy token; API access is now attached to the OAuth Cloud project.
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const version = process.env.GOOGLE_ADS_API_VERSION || 'v26';
  if (!/^v\d+$/.test(version)) throw fail('Invalid API version', 503);
  const response = await fetch(`https://googleads.googleapis.com/${version}/${path}`, {
    method: body ? 'POST' : 'GET', headers, signal: AbortSignal.timeout(45000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const codes = (data.error?.details || []).flatMap(detail => detail.errors || []).flatMap(error => Object.values(error.errorCode || {}))
      .filter(value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(value)).slice(0, 5);
    const error = fail(`Google Ads rejected the request. Check account access and campaign requirements.${codes.length ? ` (${[...new Set(codes)].join(', ')})` : ''}`, response.status === 429 ? 429 : 502);
    error.requestId = response.headers.get('request-id');
    throw error;
  }
  return data;
};
export const search = async (token, id, query, loginId) => {
  const batches = await googleRequest(token, `customers/${customerId(id)}/googleAds:searchStream`, { query }, loginId);
  return batches.flatMap(batch => batch.results || []);
};
export const campaignUpdate = (id, campaign, body) => {
  if (!/^\d+$/.test(String(campaign))) throw fail('Invalid campaign ID');
  const update = { resourceName: `customers/${customerId(id)}/campaigns/${campaign}` };
  const fields = [];
  if (body.status !== undefined) {
    if (!['ENABLED', 'PAUSED'].includes(body.status)) throw fail('Invalid campaign status');
    update.status = body.status; fields.push('status');
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 128) throw fail('Invalid campaign name');
    update.name = name; fields.push('name');
  }
  if (!fields.length) throw fail('No campaign changes supplied');
  return { update, updateMask: fields.join(',') };
};
