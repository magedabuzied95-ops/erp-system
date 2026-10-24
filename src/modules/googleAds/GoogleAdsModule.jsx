import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/api';
import { hasPermission } from '../../shared/auth/authStorage';
import { Button, Card, PageHeader } from '../../shared/ui';
import '../tiktokAds/tiktokAds.css';
import './googleAds.css';
import CampaignBuilder from './CampaignBuilder';
import CampaignManager from './CampaignManager';
import toast from 'react-hot-toast';

const quiet = { suppressErrorStatuses: [400, 403, 409, 429, 502, 503] };
export default function GoogleAdsModule() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const label = (a, e) => ar ? a : e;
  const manage = hasPermission('google_ads.manage');
  const [state, setState] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState('');
  const [level, setLevel] = useState('campaigns');
  const [days, setDays] = useState('30');
  const [reportCampaign, setReportCampaign] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [structure, setStructure] = useState({ campaigns: [], groups: [] });
  const [refreshKey, setRefreshKey] = useState(0);
  const [budgets, setBudgets] = useState({});
  const reportSequence = useRef(0);
  const outcome = new URLSearchParams(window.location.search).get('google_ads');
  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.get('/google-ads/setup', quiet);
      setState(data);
      if (data.connected) {
        const result = await api.get('/google-ads/accounts', quiet);
        setAccounts(result.accounts || []);
      } else { setAccounts([]); setRows([]); setAccount(''); }
    } catch (e) { setError(e.responseBody?.message || e.message); }
  }, []);
  const report = useCallback(async () => {
    const sequence = ++reportSequence.current;
    if (!account) return;
    try {
      const result = await api.get(`/google-ads/accounts/${account}/data?level=${level}&days=${days}${reportCampaign ? `&campaign=${reportCampaign}` : ''}`, quiet);
      if (sequence === reportSequence.current) setRows(result.rows || []);
    } catch (e) {
      if (sequence === reportSequence.current) { setRows([]); setError(e.responseBody?.message || e.message); }
    }
  }, [account, days, level, reportCampaign]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setRows([]); report(); }, [report]);
  const action = async (fn, refresh = true) => {
    setBusy(true); setError('');
    try { await fn(); if (refresh) { setRefreshKey(k => k + 1); await report(); toast.success(ar ? 'تم حفظ التغييرات' : 'Changes saved'); } } catch (e) { setError(e.responseBody?.message || e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    setStructure({ campaigns: [], groups: [] });
    if (account) api.get('/google-ads/accounts/' + account + '/structure', quiet).then(data => {
      if (active) setStructure(data);
    }).catch(e => { if (active) setError(e.responseBody?.message || e.message); });
    return () => { active = false; };
  }, [account, refreshKey]);
  const request = (path, body, done) => action(async () => {
    const result = body === null ? await api.get('/google-ads/accounts/' + account + path, quiet) : await api.post('/google-ads/accounts/' + account + path, body, quiet);
    done?.(result);
  }, body !== null && body.validateOnly !== true);
  const selected = accounts.find(a => String(a.id) === account);
  const money = value => new Intl.NumberFormat(ar ? 'ar-EG' : 'en-US', { style: 'currency', currency: selected?.currencyCode || 'EGP' }).format(Number(value || 0));
  return <div className="tiktok-ads-page">
    <PageHeader title={label('إعلانات جوجل', 'Google Ads')} description={label('إدارة حساباتك وحملاتك ونتائجها من السيستم', 'Manage your accounts, campaigns and performance')} />
    {outcome === 'connected' && <p role="status">{label('تم ربط جوجل بنجاح', 'Google connected successfully')}</p>}
    {outcome === 'error' && <p role="alert">{label('تعذر إكمال الربط. حاول مرة أخرى.', 'Authorization failed. Please reconnect.')}</p>}
    {error && <div role="alert" className="tiktok-ads-notice tiktok-ads-notice--danger">{error}</div>}
    <Card title={label('ربط الحساب', 'Account connection')}>
      <p>{state?.connected ? label('الحساب مربوط', 'Account connected') : label('اربط حساب جوجل للسماح للسيستم بإدارة الإعلانات', 'Authorize Google Ads to manage advertising from this system')}</p>
      {state && !state.setup.ready && <div role="status">{label('إعداد الربط لم يكتمل على السيرفر. يجب تجهيز تطبيق جوجل قبل توصيل الحساب.', 'Server connection setup is incomplete. Configure the Google application before connecting an account.')}</div>}
      {manage && <Button disabled={busy || !state?.setup.ready} onClick={() => action(async () => {
        const result = await api.post('/google-ads/oauth/start', {}, quiet); window.location.assign(result.url);
      })}>{label('ربط / تجديد ربط جوجل', 'Connect / reconnect Google')}</Button>}
      {manage && state?.connected && <Button disabled={busy} onClick={() => {
        if (window.confirm(label('فصل حساب جوجل عن السيستم؟', 'Disconnect Google Ads from this system?'))) action(async () => { await api.post('/google-ads/disconnect', {}, quiet); await load(); });
      }}>{label('فصل الربط', 'Disconnect')}</Button>}
      <Button disabled={busy} onClick={load}>{label('تحديث الحسابات', 'Refresh accounts')}</Button>
    </Card>
    {state?.connected && <Card title={label('الحملات والنتائج', 'Campaigns and performance')}>
      <div className="tiktok-ads-toolbar">
        <label>{label('الحساب', 'Account')} <select disabled={busy} value={account} onChange={e => { setBudgets({}); setReportCampaign(''); setAccount(e.target.value); }}>
          <option value="">{label('اختر حساب', 'Select account')}</option>
          {accounts.filter(a => !a.manager).map(a => <option key={a.id} value={a.id}>{a.descriptiveName || a.id} ({a.currencyCode})</option>)}
        </select></label>
        <label>{label('الحملة', 'Campaign')}<select value={reportCampaign} onChange={e => setReportCampaign(e.target.value)}><option value="">{label('كل الحملات', 'All campaigns')}</option>{structure.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{label('المستوى', 'Level')} <select value={level} onChange={e => setLevel(e.target.value)}>
          <option value="campaigns">{label('الحملات', 'Campaigns')}</option><option value="groups">{label('المجموعات', 'Ad groups')}</option><option value="ads">{label('الإعلانات', 'Ads')}</option><option value="keywords">{label('الكلمات المفتاحية', 'Keywords')}</option><option value="assets">{label('مجموعات Performance Max', 'Performance Max asset groups')}</option><option value="products">{label('نتائج المنتجات', 'Product performance')}</option><option value="terms">{label('عبارات البحث', 'Search terms')}</option>
        </select></label>
        <label>{label('الفترة', 'Period')} <select value={days} onChange={e => setDays(e.target.value)}><option value="7">{label('آخر ٧ أيام', 'Last 7 days')}</option><option value="30">{label('آخر ٣٠ يوم', 'Last 30 days')}</option></select></label>
        <Button disabled={busy || !account} onClick={report}>{label('تحديث النتائج', 'Refresh results')}</Button>
      </div>
      <div style={{ overflowX: 'auto' }}><table className="m1-table"><thead><tr>
        {[label('الاسم', 'Name'), label('الحالة', 'Status'), label('الظهور', 'Impressions'), label('النقرات', 'Clicks'), label('التكلفة', 'Cost'), label('التحويلات', 'Conversions'), label('قيمة التحويلات', 'Conversion value'), label('التحكم', 'Actions')].map(h => <th key={h}>{h}</th>)}
      </tr></thead><tbody>{rows.map(row => {
        const entity = level === 'campaigns' ? row.campaign : level === 'groups' ? row.adGroup : level === 'assets' ? row.assetGroup : level === 'keywords' ? row.adGroupCriterion : level === 'terms' ? row.searchTermView : level === 'products' ? row.segments : row.adGroupAd;
        const id = level === 'ads' ? entity?.ad?.id : entity?.id || entity?.criterionId || entity?.productItemId || entity?.searchTerm;
        return <tr key={`${row.campaign?.id}-${row.adGroup?.id}-${id}`}><td>{entity?.name || entity?.ad?.name || entity?.keyword?.text || entity?.productTitle || id}</td><td>{entity?.status}</td><td>{row.metrics?.impressions || 0}</td><td>{row.metrics?.clicks || 0}</td><td>{money(Number(row.metrics?.costMicros || 0) / 1e6)}</td><td>{row.metrics?.conversions || 0}</td><td>{money(row.metrics?.conversionsValue)}</td><td>
          {manage && ['groups', 'ads', 'assets', 'keywords'].includes(level) && <Button disabled={busy} onClick={() => {
            const status = entity.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
            if (window.confirm(label('تأكيد تغيير الحالة؟', 'Confirm status change?'))) request('/entities/status', { kind: { groups: 'group', ads: 'ad', assets: 'asset', keywords: 'keyword' }[level], id, group: row.adGroup?.id, status });
          }}>{entity?.status === 'ENABLED' ? label('إيقاف', 'Pause') : label('تشغيل', 'Enable')}</Button>}
          {manage && level === 'campaigns' && <>
            <Button disabled={busy} onClick={() => {
              const status = entity.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
              if (window.confirm(label(`تأكيد ${status === 'ENABLED' ? 'تشغيل' : 'إيقاف'} الحملة ${entity.name}؟`, `Confirm ${status} for ${entity.name}?`))) action(() => api.post(`/google-ads/accounts/${account}/campaigns/${id}`, { status }, quiet));
            }}>{entity.status === 'ENABLED' ? label('إيقاف', 'Pause') : label('تشغيل', 'Enable')}</Button>
            <label>{label('الميزانية اليومية', 'Daily budget')} <input type="number" min="0.01" step="0.01" aria-label={label('الميزانية اليومية', 'Daily budget')} value={budgets[id] ?? Number(row.campaignBudget?.amountMicros || 0) / 1e6} onChange={e => setBudgets({ ...budgets, [id]: e.target.value })} /></label>
            <Button disabled={busy || row.campaignBudget?.explicitlyShared || !budgets[id]} onClick={() => {
              if (window.confirm(label(`تأكيد الميزانية اليومية ${money(budgets[id])}؟`, `Confirm daily budget ${money(budgets[id])}?`))) action(() => api.post(`/google-ads/accounts/${account}/campaigns/${id}/budget`, { amount: budgets[id] }, quiet));
            }}>{label('حفظ الميزانية', 'Save budget')}</Button>
          </>}
        </td></tr>;
      })}</tbody></table></div>
      {account && !rows.length && <p>{label('لا توجد نتائج للفترة المحددة', 'No results for this reporting period')}</p>}
    </Card>}
    {account && <CampaignManager key={`manager-${account}`} label={label} request={request} busy={busy} structure={structure} manage={manage} refreshKey={refreshKey} />}
    {manage && account && <CampaignBuilder key={`builder-${account}`} label={label} request={request} busy={busy} account={account} />}
  </div>;
}
