import { useEffect, useState } from 'react';
import { Button, Card } from '../../shared/ui';

const split = value => value.split('\n').map(s => s.trim()).filter(Boolean);
export default function CampaignManager({ label, request, busy, structure, manage, refreshKey }) {
  const [campaign, setCampaign] = useState('');
  const [group, setGroup] = useState('');
  const [targeting, setTargeting] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [conversions, setConversions] = useState([]);
  const [form, setForm] = useState({ name: '', cpc: '2', keywords: '', matchType: 'PHRASE', negative: false, finalUrl: '', headlines: '', descriptions: '', bidding: 'MAXIMIZE_CONVERSIONS', targetCpa: '', targetRoas: '', kind: 'location', value: '', excluded: false, campaignName: '', productBrand: '' });
  const selected = structure.campaigns.find(c => String(c.id) === campaign);
  const groups = structure.groups.filter(g => String(g.campaignId) === campaign);
  const statusButton = (kind, entity, id, groupId) => manage && <Button disabled={busy} onClick={() => {
    const status = entity.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    if (window.confirm(label('تأكيد تغيير الحالة؟', 'Confirm status change?'))) request('/entities/status', { kind, id, group: groupId, status });
  }}>{entity.status === 'ENABLED' ? label('إيقاف', 'Pause') : label('تشغيل', 'Enable')}</Button>;
  const change = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const input = (key, title, type = 'text') => <label className="google-ads-field">{title}<input type={type} value={form[key]} onChange={e => change(key, e.target.value)} /></label>;
  const area = (key, title) => <label className="google-ads-field">{title}<textarea rows={4} value={form[key]} onChange={e => change(key, e.target.value)} /></label>;
  useEffect(() => { setGroup(''); setTargeting([]); }, [campaign]);
  // Targeting is loaded explicitly, so browsing settings never issues mutations.
  return <Card title={label('إدارة تفاصيل الحملات', 'Campaign settings and content')}><div className="google-ads-manager">
    <label>{label('اختر حملة — تشمل الحملات بدون نتائج', 'Campaign — includes campaigns without activity')}<select disabled={busy} value={campaign} onChange={e => setCampaign(e.target.value)}><option value="">{label('اختر حملة', 'Select campaign')}</option>{structure.campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.advertisingChannelType})</option>)}</select></label>
    <details><summary>{label('حالة تتبع التحويلات في الحساب', 'Account conversion actions')}</summary><Button disabled={busy} onClick={() => request('/conversions', null, r => setConversions(r.rows || []))}>{label('عرض إجراءات التحويل', 'Load conversion actions')}</Button><ul>{conversions.map(row => <li key={row.conversionAction.id}>{row.conversionAction.name} · {row.conversionAction.status} · {row.conversionAction.category} {row.conversionAction.primaryForGoal ? label('(أساسي للمزايدة)', '(primary for bidding)') : ''}</li>)}</ul><p>{label('وجود إجراء تحويل لا يؤكد وصول أحداث الشراء؛ يجب فحص استقبال الأحداث في حساب جوجل.', 'A conversion action alone does not confirm purchase events are received. Verify incoming events in Google Ads.')}</p></details>
    {selected && <>
      <p>{selected.name} · {selected.status} · {selected.biddingStrategyType}</p>
      {selected.shoppingSetting && <p>Merchant Center: {selected.shoppingSetting.merchantId} · {selected.shoppingSetting.feedLabel}</p>}
      {selected.advertisingChannelType === 'PERFORMANCE_MAX' && <ul>{(structure.assets || []).filter(row => String(row.campaign.id) === campaign).map(row => <li key={row.assetGroup.id}>{row.assetGroup.name} · {row.assetGroup.status} {statusButton('asset', row.assetGroup, row.assetGroup.id)}</li>)}</ul>}
      {manage && <div className="google-ads-actions"><Button disabled={busy} onClick={() => {
        const status = selected.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
        if (window.confirm(label(`تأكيد ${status === 'ENABLED' ? 'تشغيل الحملة وبدء الإنفاق حسب الميزانية' : 'إيقاف الحملة'}؟`, `Confirm ${status} for this campaign?`))) request(`/campaigns/${campaign}`, { status });
      }}>{selected.status === 'ENABLED' ? label('إيقاف الحملة', 'Pause campaign') : label('تشغيل الحملة', 'Enable campaign')}</Button></div>}
      <details><summary>{label('الاستهداف والكلمات المستبعدة', 'Targeting and negative keywords')}</summary>
        <Button disabled={busy} onClick={() => request(`/campaigns/${campaign}/targeting`, null, r => setTargeting(r.rows || []))}>{label('عرض الاستهداف الحالي', 'Load current targeting')}</Button>
        <ul key={`${campaign}-${refreshKey}`}>{targeting.map(row => { const c = row.campaignCriterion; return <li key={c.criterionId}>{c.type} · {c.keyword?.text || c.location?.geoTargetConstant || c.language?.languageConstant} {c.negative ? label('(مستبعد)', '(excluded)') : ''}
          {manage && <Button disabled={busy} onClick={() => { if (window.confirm(label('إزالة هذا الاستهداف؟', 'Remove this targeting criterion?'))) request(`/campaigns/${campaign}/targeting`, { remove: c.criterionId }, () => setTargeting(items => items.filter(r => r.campaignCriterion.criterionId !== c.criterionId))); }}>{label('إزالة', 'Remove')}</Button>}
        </li>; })}</ul>
        {manage && <fieldset disabled={busy} className="google-ads-form">
          <label>{label('نوع الإضافة', 'Criterion type')}<select value={form.kind} onChange={e => change('kind', e.target.value)}><option value="location">{label('موقع جغرافي', 'Location')}</option><option value="language">{label('لغة', 'Language')}</option><option value="keyword">{label('كلمة مستبعدة', 'Negative keyword')}</option></select></label>
          {form.kind === 'location' && <div><label>{label('ابحث عن دولة أو مدينة', 'Find country or city')}<input value={locationQuery} onChange={e => setLocationQuery(e.target.value)} /></label><Button disabled={!locationQuery.trim()} onClick={() => request(`/locations?q=${encodeURIComponent(locationQuery)}`, null, r => setLocations(r.locations || []))}>{label('بحث', 'Search')}</Button><select value={form.value} onChange={e => change('value', e.target.value)}><option value="">{label('اختر موقعًا', 'Choose location')}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.canonicalName || l.name}</option>)}</select></div>}
          {form.kind === 'language' && <label>{label('اللغة', 'Language')}<select value={form.value} onChange={e => change('value', e.target.value)}><option value="">{label('اختر لغة', 'Choose language')}</option><option value="1019">{label('العربية', 'Arabic')}</option><option value="1000">{label('الإنجليزية', 'English')}</option></select></label>}
          {form.kind === 'keyword' && input('value', label('الكلمة أو العبارة', 'Keyword text'))}
          <label><input type="checkbox" checked={form.excluded} onChange={e => change('excluded', e.target.checked)} />{label('استبعاد الموقع', 'Exclude location')}</label>
          <Button onClick={() => request(`/campaigns/${campaign}/targeting`, { kind: form.kind, value: form.value, text: form.value, matchType: 'PHRASE', negative: form.kind === 'keyword' || (form.kind === 'location' && form.excluded) })}>{label('إضافة الاستهداف', 'Add criterion')}</Button>
        </fieldset>}
      </details>
      {manage && <details><summary>{label('اسم الحملة والمزايدة', 'Campaign name and bidding')}</summary><fieldset disabled={busy} className="google-ads-form">
        {input('campaignName', label('الاسم الجديد', 'New name'))}<Button disabled={!form.campaignName.trim()} onClick={() => request(`/campaigns/${campaign}`, { name: form.campaignName })}>{label('حفظ الاسم', 'Save name')}</Button>
        <label>{label('استراتيجية المزايدة', 'Bidding strategy')}<select value={form.bidding} onChange={e => change('bidding', e.target.value)}>
          {selected.advertisingChannelType === 'SEARCH' && <option value="MANUAL_CPC">{label('سعر نقرة يدوي', 'Manual CPC')}</option>}<option value="MAXIMIZE_CONVERSIONS">{label('زيادة التحويلات', 'Maximize conversions')}</option><option value="MAXIMIZE_CONVERSION_VALUE">{label('زيادة قيمة التحويلات', 'Maximize conversion value')}</option>
        </select></label>
        {form.bidding === 'MAXIMIZE_CONVERSIONS' && input('targetCpa', label('تكلفة التحويل المستهدفة — اختياري', 'Target CPA — optional'), 'number')}
        {form.bidding === 'MAXIMIZE_CONVERSION_VALUE' && input('targetRoas', label('العائد المستهدف % — اختياري', 'Target ROAS % — optional'), 'number')}
        <Button onClick={() => { if (window.confirm(label('تأكيد تغيير المزايدة؟ يؤثر على طريقة إنفاق الميزانية.', 'Confirm bidding change? This affects budget allocation.'))) request(`/campaigns/${campaign}/bidding`, form); }}>{label('حفظ المزايدة', 'Save bidding')}</Button>
      </fieldset></details>}
      {manage && selected.advertisingChannelType === 'PERFORMANCE_MAX' && <details><summary>{label('إضافة مجموعة منتجات Performance Max', 'Add Performance Max retail asset group')}</summary><fieldset disabled={busy} className="google-ads-form">
        {input('name', label('اسم المجموعة', 'Group name'))}{input('finalUrl', label('رابط صفحة المتجر', 'Store landing page'), 'url')}{input('productBrand', label('ماركة محددة — فارغ لكل منتجات الحملة', 'Brand — leave blank for all campaign products'))}
        <p>{label('تُنشأ المجموعة موقوفة وتستخدم بيانات وصور منتجات المتجر. راجع تداخل المنتجات مع المجموعات الحالية قبل تشغيلها.', 'Created paused using store product data and images. Review product overlap with existing groups before enabling.')}</p>
        <Button onClick={() => request(`/campaigns/${campaign}/asset-groups`, { name: form.name, finalUrl: form.finalUrl, productBrand: form.productBrand })}>{label('إنشاء مجموعة منتجات موقوفة', 'Create paused retail group')}</Button>
      </fieldset></details>}
      {manage && selected.advertisingChannelType === 'SEARCH' && <>
        <details><summary>{label('إضافة مجموعة إعلانية', 'Add ad group')}</summary><fieldset className="google-ads-form" disabled={busy}>
          {input('name', label('اسم المجموعة', 'Group name'))}{input('cpc', label('حد سعر النقرة بعملة الحساب', 'CPC bid in account currency'), 'number')}
          <Button onClick={() => request('/groups', { campaign, name: form.name, cpc: form.cpc })}>{label('إنشاء مجموعة موقوفة', 'Create paused group')}</Button>
        </fieldset></details>
        <label>{label('اختر المجموعة لإدارة محتواها', 'Choose group to manage its content')}<select disabled={busy} value={group} onChange={e => setGroup(e.target.value)}><option value="">{label('اختر مجموعة', 'Select group')}</option>{groups.map(g => <option value={g.id} key={g.id}>{g.name} ({g.status})</option>)}</select></label>
        {group && <>
          <Button disabled={busy} onClick={() => { const current = groups.find(g => String(g.id) === group); const status = current?.status === 'ENABLED' ? 'PAUSED' : 'ENABLED'; if (window.confirm(label('تأكيد تغيير حالة المجموعة؟', 'Confirm ad group status change?'))) request('/entities/status', { kind: 'group', id: group, status }); }}>{groups.find(g => String(g.id) === group)?.status === 'ENABLED' ? label('إيقاف المجموعة', 'Pause group') : label('تشغيل المجموعة', 'Enable group')}</Button>
          <details><summary>{label('إضافة كلمات مفتاحية', 'Add keywords')}</summary><fieldset disabled={busy} className="google-ads-form">
            {area('keywords', label('كلمة أو عبارة في كل سطر', 'One keyword per line'))}
            <label>{label('المطابقة', 'Match type')}<select value={form.matchType} onChange={e => change('matchType', e.target.value)}><option value="PHRASE">{label('عبارة', 'Phrase')}</option><option value="EXACT">{label('تامة', 'Exact')}</option><option value="BROAD">{label('واسعة', 'Broad')}</option></select></label>
            <label><input type="checkbox" checked={form.negative} onChange={e => change('negative', e.target.checked)} />{label('كلمات مستبعدة', 'Negative keywords')}</label>
            <Button onClick={() => request(`/groups/${group}/keywords`, { keywords: split(form.keywords).map(text => ({ text, matchType: form.matchType, negative: form.negative })) })}>{label('إضافة الكلمات', 'Add keywords')}</Button>
          </fieldset></details>
          <details><summary>{label('الكلمات الحالية — تشمل الكلمات بدون نتائج', 'Existing keywords — includes zero activity')}</summary><ul>{(structure.keywords || []).filter(row => String(row.adGroup.id) === group).map(row => <li key={row.adGroupCriterion.criterionId}>{row.adGroupCriterion.keyword.text} · {row.adGroupCriterion.keyword.matchType} · {row.adGroupCriterion.status} {row.adGroupCriterion.negative ? label('(مستبعدة)', '(negative)') : ''} {statusButton('keyword', row.adGroupCriterion, row.adGroupCriterion.criterionId, group)}</li>)}</ul></details>
          <details><summary>{label('الإعلانات الحالية — تشمل الإعلانات بدون نتائج', 'Existing ads — includes zero activity')}</summary><ul>{(structure.ads || []).filter(row => String(row.adGroup.id) === group).map(row => <li key={row.adGroupAd.ad.id}>{row.adGroupAd.ad.responsiveSearchAd?.headlines?.map(h => h.text).join(' | ') || row.adGroupAd.ad.id}<p>{row.adGroupAd.ad.responsiveSearchAd?.descriptions?.map(d => d.text).join(' | ')}</p><p>{row.adGroupAd.ad.finalUrls?.join(' · ')} · {row.adGroupAd.status}</p>{statusButton('ad', row.adGroupAd, row.adGroupAd.ad.id, group)}</li>)}</ul></details>
          <details><summary>{label('إضافة إعلان بحث متجاوب', 'Add responsive Search ad')}</summary><fieldset disabled={busy} className="google-ads-form">
            {input('finalUrl', label('الصفحة المقصودة', 'Destination URL'), 'url')}{area('headlines', label('٣–١٥ عنوان — عنوان في كل سطر، حتى ٣٠ حرف', '3–15 headlines — one per line, max 30 characters'))}{area('descriptions', label('٢–٤ وصف — وصف في كل سطر، حتى ٩٠ حرف', '2–4 descriptions — one per line, max 90 characters'))}
            <Button onClick={() => request(`/groups/${group}/ads`, { finalUrl: form.finalUrl, headlines: split(form.headlines), descriptions: split(form.descriptions) })}>{label('إنشاء إعلان موقوف', 'Create paused ad')}</Button>
          </fieldset></details>
        </>}
      </>}
    </>}
  </div></Card>;
}
