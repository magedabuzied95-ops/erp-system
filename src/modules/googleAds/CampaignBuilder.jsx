import { useState } from 'react';
import { CheckCircle2, Plus, Search, X } from 'lucide-react';
import { Button, Card, Checkbox, Input, Textarea } from '../../shared/ui';
import { SelectField, useGoogleAds } from './GoogleAdsContext';

const lines = value => value.split('\n').map(v => v.trim()).filter(Boolean);
const initial = { type: 'SEARCH', name: '', amount: '', groupName: '', cpc: '2', finalUrl: '', headlines: '', descriptions: '', keywords: '', negativeKeywords: '', matchType: 'PHRASE', merchantId: '', feedLabel: 'EG', productBrand: '', bidding: 'MANUAL_CPC', targetCpa: '', targetRoas: '', startDate: '', endDate: '', languages: ['1019', '1000'], locations: [], expandUrls: false };

// New campaign, checked by Google first (validateOnly) and only then created — always paused.
export default function CampaignBuilder() {
  const { label, busy, request, account } = useGoogleAds();
  const [draft, setDraft] = useState(initial);
  const [locations, setLocations] = useState([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [validated, setValidated] = useState(false);
  const [notice, setNotice] = useState('');
  const change = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setValidated(false); setNotice(''); };
  const field = (key, title, type = 'text', hint) => <Input type={type} label={title} hint={hint} value={draft[key]} onChange={e => change(key, e.target.value)} />;
  const area = (key, title, hint) => <Textarea label={title} hint={hint} value={draft[key]} onChange={e => change(key, e.target.value)} />;
  const toggleLanguage = (code, on) => change('languages', on ? [...new Set([...draft.languages, code])] : draft.languages.filter(v => v !== code));
  const payload = () => ({ ...draft, headlines: lines(draft.headlines), descriptions: lines(draft.descriptions), keywords: lines(draft.keywords).map(text => ({ text, matchType: draft.matchType })), negativeKeywords: lines(draft.negativeKeywords).map(text => ({ text, matchType: 'PHRASE' })), locations: draft.locations.map(v => v.id) });
  const biddingOptions = [
    ...(draft.type === 'SEARCH' ? [{ value: 'MANUAL_CPC', label: label('سعر نقرة يدوي', 'Manual CPC') }] : []),
    { value: 'MAXIMIZE_CONVERSIONS', label: label('زيادة التحويلات', 'Maximize conversions') },
    { value: 'MAXIMIZE_CONVERSION_VALUE', label: label('زيادة قيمة التحويلات', 'Maximize conversion value') },
  ];

  return <fieldset disabled={busy} className="google-ads-builder">
    <Card title={label('أساسيات الحملة', 'Campaign basics')}>
      <div className="google-ads-form">
        <SelectField label={label('نوع الحملة', 'Campaign type')} value={draft.type} onChange={value => { change('type', value); change('bidding', value === 'SEARCH' ? 'MANUAL_CPC' : 'MAXIMIZE_CONVERSION_VALUE'); }} options={[
          { value: 'SEARCH', label: label('البحث والكلمات المفتاحية', 'Search and keywords') },
          { value: 'PERFORMANCE_MAX', label: label('منتجات المتجر — Performance Max', 'Retail Performance Max') },
        ]} />
        {field('name', label('اسم الحملة', 'Campaign name'))}
        {field('amount', label(`الميزانية اليومية (${account?.currencyCode || ''})`, `Daily budget (${account?.currencyCode || ''})`), 'number')}
        <SelectField label={label('المزايدة', 'Bidding')} value={draft.bidding} onChange={value => change('bidding', value)} options={biddingOptions} />
        {draft.bidding === 'MAXIMIZE_CONVERSIONS' && field('targetCpa', label('تكلفة التحويل المستهدفة', 'Target CPA'), 'number', label('اختياري', 'Optional'))}
        {draft.bidding === 'MAXIMIZE_CONVERSION_VALUE' && field('targetRoas', label('العائد المستهدف %', 'Target ROAS %'), 'number', label('اختياري', 'Optional'))}
        {field('startDate', label('تاريخ البداية', 'Start date'), 'date', label('اختياري', 'Optional'))}
        {field('endDate', label('تاريخ النهاية', 'End date'), 'date', label('اختياري', 'Optional'))}
      </div>
    </Card>

    {draft.type === 'SEARCH' ? <Card title={label('المجموعة والإعلان', 'Ad group and ad')}>
      <div className="google-ads-form">
        {field('groupName', label('اسم المجموعة', 'Group name'))}
        {field('cpc', label('حد سعر النقرة للمجموعة', 'Group CPC bid'), 'number')}
        {field('finalUrl', label('رابط الصفحة المقصودة', 'Destination URL'), 'url')}
        <SelectField label={label('مطابقة الكلمات', 'Keyword match')} value={draft.matchType} onChange={value => change('matchType', value)} options={[
          { value: 'PHRASE', label: label('عبارة', 'Phrase') }, { value: 'EXACT', label: label('تامة', 'Exact') }, { value: 'BROAD', label: label('واسعة', 'Broad') },
        ]} />
        <div className="google-ads-form__wide">{area('keywords', label('الكلمات المفتاحية', 'Keywords'), label('كلمة أو عبارة في كل سطر', 'One per line'))}</div>
        {area('headlines', label('العناوين', 'Headlines'), label('من ٣ لـ ١٥ عنوان، كل عنوان في سطر، لحد ٣٠ حرف', '3–15, one per line, max 30 characters'))}
        {area('descriptions', label('الأوصاف', 'Descriptions'), label('من ٢ لـ ٤ أوصاف، كل وصف في سطر، لحد ٩٠ حرف', '2–4, one per line, max 90 characters'))}
      </div>
    </Card> : <Card title={label('منتجات المتجر', 'Store products')}>
      <div className="google-ads-form">
        {field('groupName', label('اسم المجموعة', 'Group name'))}
        {field('finalUrl', label('رابط صفحة المتجر', 'Store landing page'), 'url')}
        {field('merchantId', label('رقم حساب Merchant Center المربوط', 'Linked Merchant Center ID'))}
        {field('feedLabel', label('تصنيف مصدر المنتجات', 'Feed label'))}
        {field('productBrand', label('ماركة واحدة بس', 'Only one brand'), 'text', label('سيبه فاضي لكل المنتجات', 'Leave blank for all products'))}
        <div className="google-ads-form__wide"><Checkbox checked={draft.expandUrls} onChange={e => change('expandUrls', e.target.checked)} label={label('اسمح لجوجل يختار صفحات تانية من المتجر', 'Allow final URL expansion')} /></div>
        <p className="google-ads-muted google-ads-form__wide">{label('بتستخدم صور وبيانات المنتجات من Merchant Center، ومحتاجة تتبع التحويلات يكون مجهز والمتجر مربوط بنفس الحساب الإعلاني.', 'Uses product images and data from Merchant Center. Requires conversion tracking and the store linked to this ads account.')}</p>
      </div>
    </Card>}

    <Card title={label('الاستهداف', 'Targeting')}>
      <div className="google-ads-form">
        <div className="m1-control">
          <span className="m1-control__label">{label('اللغات', 'Languages')}</span>
          <div className="google-ads-inline">
            <Checkbox checked={draft.languages.includes('1019')} onChange={e => toggleLanguage('1019', e.target.checked)} label={label('العربية', 'Arabic')} />
            <Checkbox checked={draft.languages.includes('1000')} onChange={e => toggleLanguage('1000', e.target.checked)} label={label('الإنجليزية', 'English')} />
          </div>
        </div>
        <div className="m1-control">
          <span className="m1-control__label">{label('المواقع', 'Locations')}</span>
          <div className="google-ads-inline">
            <Input aria-label={label('ابحث عن دولة أو مدينة', 'Find a country or city')} placeholder={label('ابحث عن دولة أو مدينة', 'Find a country or city')} value={locationQuery} onChange={e => setLocationQuery(e.target.value)} />
            <Button icon={Search} disabled={!locationQuery.trim()} onClick={() => request(`/locations?q=${encodeURIComponent(locationQuery)}`, null, result => setLocations(result.locations || []))}>{label('بحث', 'Search')}</Button>
          </div>
          {locations.length ? <div className="google-ads-chips">{locations.map(location => <button type="button" key={location.id} className="tiktok-ads-drill__chip" disabled={draft.locations.some(v => v.id === location.id)} onClick={() => change('locations', [...draft.locations, location])}><Plus size={14} aria-hidden="true" />{location.canonicalName || location.name}</button>)}</div> : null}
          {draft.locations.length ? <div className="google-ads-chips">{draft.locations.map(location => <button type="button" key={location.id} className="tiktok-ads-drill__chip is-selected" onClick={() => change('locations', draft.locations.filter(v => v.id !== location.id))}>{location.canonicalName || location.name}<X size={14} aria-hidden="true" /></button>)}</div> : <span className="m1-control__help">{label('لازم تختار موقع واحد على الأقل', 'Choose at least one location')}</span>}
        </div>
        <div className="google-ads-form__wide">{area('negativeKeywords', label('كلمات مستبعدة', 'Negative keywords'), label('عبارة في كل سطر', 'One phrase per line'))}</div>
      </div>
    </Card>

    <Card>
      <p className="google-ads-muted">{label('الاستهداف للناس الموجودين في المواقع المختارة. الحملة بتتعمل موقوفة ومفيش صرف لحد ما تشغّلها.', 'Targets people in the selected locations. The campaign is created paused and spends nothing until you enable it.')}</p>
      {notice ? <div className="tiktok-ads-notice" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {notice}</div> : null}
      <div className="tiktok-ads-actions">
        <Button disabled={!draft.name || !draft.locations.length} onClick={() => request('/campaigns', { ...payload(), validateOnly: true }, () => { setValidated(true); setNotice(label('جوجل وافق على الإعدادات. تقدر تعمل الحملة موقوفة.', 'Google validated the campaign. You can create it paused.')); })}>{label('افحص الإعدادات عند جوجل', 'Validate with Google')}</Button>
        <Button variant="primary" disabled={!validated} onClick={() => request('/campaigns', payload(), () => { setValidated(false); setNotice(label('الحملة اتعملت موقوفة', 'Paused campaign created')); })}>{label('إنشاء حملة موقوفة', 'Create paused campaign')}</Button>
      </div>
    </Card>
  </fieldset>;
}
