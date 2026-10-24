import { useState } from 'react';
import { Button, Card } from '../../shared/ui';

const lines = value => value.split('\n').map(v => v.trim()).filter(Boolean);
const initial = { type: 'SEARCH', name: '', amount: '', groupName: '', cpc: '2', finalUrl: '', headlines: '', descriptions: '', keywords: '', negativeKeywords: '', matchType: 'PHRASE', merchantId: '', feedLabel: 'EG', productBrand: '', bidding: 'MANUAL_CPC', targetCpa: '', targetRoas: '', startDate: '', endDate: '', languages: ['1019', '1000'], locations: [], expandUrls: false };
export default function CampaignBuilder({ label, busy, request, account }) {
  const [draft, setDraft] = useState(initial);
  const [locations, setLocations] = useState([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [validated, setValidated] = useState(false);
  const [notice, setNotice] = useState('');
  const change = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setValidated(false); setNotice(''); };
  const field = (key, title, type = 'text') => <label className="google-ads-field">{title}<input type={type} value={draft[key]} onChange={e => change(key, e.target.value)} /></label>;
  const area = (key, title) => <label className="google-ads-field">{title}<textarea rows={4} value={draft[key]} onChange={e => change(key, e.target.value)} /></label>;
  const payload = () => ({ ...draft, headlines: lines(draft.headlines), descriptions: lines(draft.descriptions), keywords: lines(draft.keywords).map(text => ({ text, matchType: draft.matchType })), negativeKeywords: lines(draft.negativeKeywords).map(text => ({ text, matchType: 'PHRASE' })), locations: draft.locations.map(v => v.id) });
  return <Card title={label('إنشاء حملة جديدة', 'Create campaign')}>
    <fieldset disabled={busy} className="google-ads-form">
      <label className="google-ads-field">{label('نوع الحملة', 'Campaign type')}<select value={draft.type} onChange={e => { change('type', e.target.value); change('bidding', e.target.value === 'SEARCH' ? 'MANUAL_CPC' : 'MAXIMIZE_CONVERSION_VALUE'); }}>
        <option value="SEARCH">{label('البحث والكلمات المفتاحية', 'Search and keywords')}</option><option value="PERFORMANCE_MAX">{label('منتجات المتجر — Performance Max', 'Retail Performance Max')}</option>
      </select></label>
      {field('name', label('اسم الحملة', 'Campaign name'))}{field('amount', label('الميزانية اليومية بعملة الحساب', 'Daily budget in account currency'), 'number')}
      {field('groupName', label('اسم المجموعة', 'Group name'))}{field('finalUrl', label('رابط الصفحة المقصودة', 'Destination URL'), 'url')}
      <label className="google-ads-field">{label('المزايدة', 'Bidding')}<select value={draft.bidding} onChange={e => change('bidding', e.target.value)}>
        {draft.type === 'SEARCH' && <option value="MANUAL_CPC">{label('سعر نقرة يدوي', 'Manual CPC')}</option>}
        <option value="MAXIMIZE_CONVERSIONS">{label('زيادة التحويلات', 'Maximize conversions')}</option><option value="MAXIMIZE_CONVERSION_VALUE">{label('زيادة قيمة التحويلات', 'Maximize conversion value')}</option>
      </select></label>
      {draft.bidding === 'MAXIMIZE_CONVERSIONS' && field('targetCpa', label('تكلفة التحويل المستهدفة — اختياري', 'Target CPA — optional'), 'number')}
      {draft.bidding === 'MAXIMIZE_CONVERSION_VALUE' && field('targetRoas', label('عائد الإنفاق المستهدف % — اختياري', 'Target ROAS % — optional'), 'number')}
      {field('startDate', label('تاريخ البداية — اختياري', 'Start date — optional'), 'date')}{field('endDate', label('تاريخ النهاية — اختياري', 'End date — optional'), 'date')}
      {draft.type === 'SEARCH' ? <>
        {field('cpc', label('حد سعر النقرة للمجموعة', 'Group CPC bid'), 'number')}
        <label className="google-ads-field">{label('مطابقة الكلمات', 'Keyword match')}<select value={draft.matchType} onChange={e => change('matchType', e.target.value)}><option value="PHRASE">{label('عبارة', 'Phrase')}</option><option value="EXACT">{label('تامة', 'Exact')}</option><option value="BROAD">{label('واسعة', 'Broad')}</option></select></label>
        {area('keywords', label('الكلمات المفتاحية — كلمة أو عبارة في كل سطر', 'Keywords — one per line'))}
        {area('headlines', label('٣–١٥ عنوان — كل عنوان في سطر، حتى ٣٠ حرف', '3–15 headlines — one per line, max 30 characters'))}
        {area('descriptions', label('٢–٤ وصف — كل وصف في سطر، حتى ٩٠ حرف', '2–4 descriptions — one per line, max 90 characters'))}
      </> : <>
        {field('merchantId', label('رقم حساب Merchant Center المربوط', 'Linked Merchant Center ID'))}{field('feedLabel', label('تصنيف مصدر المنتجات', 'Feed label'))}
        {field('productBrand', label('تضمين ماركة فقط — اتركه فارغًا لكل المنتجات', 'Only include brand — leave blank for all products'))}
        <label><input type="checkbox" checked={draft.expandUrls} onChange={e => change('expandUrls', e.target.checked)} />{label('السماح لجوجل باختيار صفحات إضافية من المتجر', 'Allow final URL expansion')}</label>
        <p>{label('تُستخدم صور وبيانات المنتجات من Merchant Center. تتطلب الحملة إعداد تتبع التحويلات وربط المتجر بنفس الحساب الإعلاني.', 'Uses product images and data from Merchant Center. Requires conversion tracking and the store linked to this ads account.')}</p>
      </>}
      {area('negativeKeywords', label('كلمات مستبعدة — عبارة في كل سطر', 'Negative keywords — one phrase per line'))}
      <label>{label('اللغات', 'Languages')}<select multiple value={draft.languages} onChange={e => change('languages', [...e.target.selectedOptions].map(o => o.value))}><option value="1019">{label('العربية', 'Arabic')}</option><option value="1000">{label('الإنجليزية', 'English')}</option></select></label>
      <div><label>{label('ابحث عن دولة أو مدينة للاستهداف', 'Find a country or city')}<input value={locationQuery} onChange={e => setLocationQuery(e.target.value)} /></label>
        <Button disabled={!locationQuery.trim()} onClick={() => request(`/locations?q=${encodeURIComponent(locationQuery)}`, null, result => setLocations(result.locations || []))}>{label('بحث المواقع', 'Find locations')}</Button>
        <ul>{locations.map(location => <li key={location.id}>{location.canonicalName || location.name} <Button onClick={() => { if (!draft.locations.some(v => v.id === location.id)) change('locations', [...draft.locations, location]); }}>{label('إضافة', 'Add')}</Button></li>)}</ul>
        <ul>{draft.locations.map(location => <li key={location.id}>{location.canonicalName || location.name} <Button onClick={() => change('locations', draft.locations.filter(v => v.id !== location.id))}>{label('إزالة', 'Remove')}</Button></li>)}</ul>
      </div>
      <p>{label('الاستهداف للأشخاص الموجودين في المواقع المختارة. الحملة تُنشأ موقوفة دون بدء إنفاق.', 'Targets people present in selected locations. Created paused without starting spend.')}</p>
      {notice && <p role="status">{notice}</p>}
      <div className="google-ads-actions">
        <Button disabled={!draft.name || !draft.locations.length} onClick={() => request('/campaigns', { ...payload(), validateOnly: true }, () => { setValidated(true); setNotice(label('اجتازت إعدادات الحملة فحص جوجل. يمكنك إنشاء الحملة الموقوفة.', 'Google validated the campaign. You can create it paused.')); })}>{label('فحص الإعدادات عند جوجل', 'Validate with Google')}</Button>
        <Button disabled={!validated} onClick={() => request('/campaigns', payload(), () => { setValidated(false); setNotice(label('تم إنشاء الحملة الموقوفة بنجاح', 'Paused campaign created successfully')); })}>{label('إنشاء حملة موقوفة', 'Create paused campaign')}</Button>
      </div>
      <small>{label('الحساب المحدد: ', 'Selected account: ')}{account}</small>
    </fieldset>
  </Card>;
}
