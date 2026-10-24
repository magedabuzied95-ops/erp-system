import { useEffect, useState } from 'react';
import { Pause, Play, Search, Trash2 } from 'lucide-react';
import { Button, Card, Checkbox, EmptyState, Input, StatusBadge, Textarea } from '../../shared/ui';
import { SelectField, useGoogleAds } from './GoogleAdsContext';
import { statusTone } from './googleAdsApi';

const split = value => value.split('\n').map(s => s.trim()).filter(Boolean);

// One collapsible block of the manager, drawn as a card.
const Panel = ({ title, children, open = false }) => <details className="google-ads-panel" open={open}><summary>{title}</summary><div className="google-ads-panel__body">{children}</div></details>;

// A row of an existing-items list: what it is, its state, its action.
const Item = ({ title, meta, status, statusLabel, children }) => <li className="google-ads-list__item">
  <div className="google-ads-list__text"><strong>{title}</strong>{meta ? <span>{meta}</span> : null}</div>
  {status ? <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge> : null}
  {children}
</li>;

export default function CampaignManager() {
  const { label, request, busy, structure, manage, refreshKey, confirm } = useGoogleAds();
  const [campaign, setCampaign] = useState('');
  const [group, setGroup] = useState('');
  const [targeting, setTargeting] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [conversions, setConversions] = useState([]);
  const [form, setForm] = useState({ name: '', cpc: '2', keywords: '', matchType: 'PHRASE', negative: false, finalUrl: '', headlines: '', descriptions: '', bidding: 'MAXIMIZE_CONVERSIONS', targetCpa: '', targetRoas: '', kind: 'location', value: '', excluded: false, campaignName: '', productBrand: '' });
  const selected = structure.campaigns.find(c => String(c.id) === campaign);
  const groups = structure.groups.filter(g => String(g.campaignId) === campaign);
  const currentGroup = groups.find(g => String(g.id) === group);
  const statusLabel = status => ({ ENABLED: label('شغالة', 'Enabled'), PAUSED: label('موقوفة', 'Paused'), REMOVED: label('محذوفة', 'Removed') }[status] || status);
  const ask = (body, onConfirm, danger = false) => confirm({ title: label('تأكيد', 'Confirm'), body, danger, onConfirm });
  const statusButton = (kind, entity, id, groupId) => manage && <Button size="sm" variant="ghost" icon={entity.status === 'ENABLED' ? Pause : Play} disabled={busy} onClick={() => {
    const status = entity.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    ask(label('تأكيد تغيير الحالة؟', 'Confirm status change?'), () => request('/entities/status', { kind, id, group: groupId, status }));
  }}>{entity.status === 'ENABLED' ? label('إيقاف', 'Pause') : label('تشغيل', 'Enable')}</Button>;
  const change = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const input = (key, title, type = 'text', hint) => <Input type={type} label={title} hint={hint} value={form[key]} onChange={e => change(key, e.target.value)} />;
  const area = (key, title, hint) => <Textarea label={title} hint={hint} value={form[key]} onChange={e => change(key, e.target.value)} />;
  useEffect(() => { setGroup(''); setTargeting([]); }, [campaign]);
  const languages = [{ value: '1019', label: label('العربية', 'Arabic') }, { value: '1000', label: label('الإنجليزية', 'English') }];
  const matchTypes = [{ value: 'PHRASE', label: label('عبارة', 'Phrase') }, { value: 'EXACT', label: label('تامة', 'Exact') }, { value: 'BROAD', label: label('واسعة', 'Broad') }];

  // Targeting is loaded explicitly, so browsing settings never issues mutations.
  return <div className="google-ads-manager">
    <Card>
      <SelectField
        label={label('الحملة', 'Campaign')}
        value={campaign}
        disabled={busy}
        onChange={setCampaign}
        placeholder={label('اختر حملة', 'Select campaign')}
        options={structure.campaigns.map(c => ({ value: String(c.id), label: `${c.name} · ${c.advertisingChannelType}` }))}
      />
      <p className="google-ads-muted">{label('القايمة فيها كل الحملات، حتى اللي مالهاش نتايج.', 'Lists every campaign, including ones without activity.')}</p>
    </Card>

    {!selected ? <Card><EmptyState title={label('اختر حملة', 'Select a campaign')} description={label('هتلاقي هنا الاستهداف والمزايدة والمجموعات والإعلانات بتاعتها.', 'Its targeting, bidding, groups and ads appear here.')} /></Card> : <>
      <Card
        title={selected.name}
        subtitle={[selected.advertisingChannelType, selected.biddingStrategyType, selected.shoppingSetting ? `Merchant Center ${selected.shoppingSetting.merchantId} · ${selected.shoppingSetting.feedLabel}` : ''].filter(Boolean).join(' · ')}
        action={<StatusBadge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</StatusBadge>}
      >
        {manage && <div className="tiktok-ads-actions"><Button icon={selected.status === 'ENABLED' ? Pause : Play} variant={selected.status === 'ENABLED' ? 'secondary' : 'primary'} disabled={busy} onClick={() => {
          const status = selected.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
          ask(status === 'ENABLED' ? label('تشغيل الحملة هيبدأ الصرف حسب الميزانية. تأكيد؟', 'Enabling starts spending against the budget. Confirm?') : label('إيقاف الحملة؟', 'Pause this campaign?'), () => request(`/campaigns/${campaign}`, { status }), status !== 'ENABLED');
        }}>{selected.status === 'ENABLED' ? label('إيقاف الحملة', 'Pause campaign') : label('تشغيل الحملة', 'Enable campaign')}</Button></div>}
      </Card>

      {selected.advertisingChannelType === 'PERFORMANCE_MAX' && <Panel open title={label('مجموعات المنتجات', 'Asset groups')}>
        <ul className="google-ads-list">{(structure.assets || []).filter(row => String(row.campaign.id) === campaign).map(row => <Item key={row.assetGroup.id} title={row.assetGroup.name} status={row.assetGroup.status} statusLabel={statusLabel}>{statusButton('asset', row.assetGroup, row.assetGroup.id)}</Item>)}</ul>
        {manage && <fieldset disabled={busy} className="google-ads-form">
          {input('name', label('اسم المجموعة الجديدة', 'New group name'))}{input('finalUrl', label('رابط صفحة المتجر', 'Store landing page'), 'url')}{input('productBrand', label('ماركة محددة', 'Brand'), 'text', label('سيبه فاضي لكل منتجات الحملة', 'Leave blank for all campaign products'))}
          <p className="google-ads-muted google-ads-form__wide">{label('المجموعة بتتعمل موقوفة وبتستخدم بيانات وصور منتجات المتجر. راجع تداخل المنتجات مع المجموعات الحالية قبل التشغيل.', 'Created paused using store product data and images. Review product overlap with existing groups before enabling.')}</p>
          <div className="tiktok-ads-actions google-ads-form__wide"><Button onClick={() => request(`/campaigns/${campaign}/asset-groups`, { name: form.name, finalUrl: form.finalUrl, productBrand: form.productBrand })}>{label('إنشاء مجموعة منتجات موقوفة', 'Create paused retail group')}</Button></div>
        </fieldset>}
      </Panel>}

      <Panel title={label('الاستهداف والكلمات المستبعدة', 'Targeting and negative keywords')}>
        <div className="tiktok-ads-actions"><Button disabled={busy} onClick={() => request(`/campaigns/${campaign}/targeting`, null, r => setTargeting(r.rows || []))}>{label('اعرض الاستهداف الحالي', 'Load current targeting')}</Button></div>
        {targeting.length ? <ul className="google-ads-list" key={`${campaign}-${refreshKey}`}>{targeting.map(row => { const c = row.campaignCriterion; return <Item key={c.criterionId} title={c.keyword?.text || c.location?.geoTargetConstant || c.language?.languageConstant} meta={`${c.type}${c.negative ? ` · ${label('مستبعد', 'excluded')}` : ''}`} statusLabel={statusLabel}>
          {manage && <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => ask(label('إزالة الاستهداف ده؟', 'Remove this targeting criterion?'), () => request(`/campaigns/${campaign}/targeting`, { remove: c.criterionId }, () => setTargeting(items => items.filter(r => r.campaignCriterion.criterionId !== c.criterionId))), true)}>{label('إزالة', 'Remove')}</Button>}
        </Item>; })}</ul> : null}
        {manage && <fieldset disabled={busy} className="google-ads-form">
          <SelectField label={label('نوع الإضافة', 'Criterion type')} value={form.kind} onChange={value => { change('kind', value); change('value', ''); }} options={[{ value: 'location', label: label('موقع جغرافي', 'Location') }, { value: 'language', label: label('لغة', 'Language') }, { value: 'keyword', label: label('كلمة مستبعدة', 'Negative keyword') }]} />
          {form.kind === 'location' && <>
            <div className="m1-control"><span className="m1-control__label">{label('ابحث عن دولة أو مدينة', 'Find country or city')}</span><div className="google-ads-inline"><Input aria-label={label('ابحث عن دولة أو مدينة', 'Find country or city')} value={locationQuery} onChange={e => setLocationQuery(e.target.value)} /><Button icon={Search} disabled={!locationQuery.trim()} onClick={() => request(`/locations?q=${encodeURIComponent(locationQuery)}`, null, r => setLocations(r.locations || []))}>{label('بحث', 'Search')}</Button></div></div>
            <SelectField label={label('الموقع', 'Location')} value={form.value} onChange={value => change('value', value)} placeholder={label('اختر موقعًا', 'Choose location')} options={locations.map(l => ({ value: String(l.id), label: l.canonicalName || l.name }))} />
            <Checkbox checked={form.excluded} onChange={e => change('excluded', e.target.checked)} label={label('استبعاد الموقع', 'Exclude location')} />
          </>}
          {form.kind === 'language' && <SelectField label={label('اللغة', 'Language')} value={form.value} onChange={value => change('value', value)} placeholder={label('اختر لغة', 'Choose language')} options={languages} />}
          {form.kind === 'keyword' && input('value', label('الكلمة أو العبارة', 'Keyword text'))}
          <div className="tiktok-ads-actions google-ads-form__wide"><Button disabled={!form.value} onClick={() => request(`/campaigns/${campaign}/targeting`, { kind: form.kind, value: form.value, text: form.value, matchType: 'PHRASE', negative: form.kind === 'keyword' || (form.kind === 'location' && form.excluded) })}>{label('إضافة الاستهداف', 'Add criterion')}</Button></div>
        </fieldset>}
      </Panel>

      {manage && <Panel title={label('اسم الحملة والمزايدة', 'Campaign name and bidding')}>
        <fieldset disabled={busy} className="google-ads-form">
          {input('campaignName', label('الاسم الجديد', 'New name'))}
          <div className="tiktok-ads-actions google-ads-form__end"><Button disabled={!form.campaignName.trim()} onClick={() => request(`/campaigns/${campaign}`, { name: form.campaignName })}>{label('حفظ الاسم', 'Save name')}</Button></div>
          <SelectField label={label('استراتيجية المزايدة', 'Bidding strategy')} value={form.bidding} onChange={value => change('bidding', value)} options={[
            ...(selected.advertisingChannelType === 'SEARCH' ? [{ value: 'MANUAL_CPC', label: label('سعر نقرة يدوي', 'Manual CPC') }] : []),
            { value: 'MAXIMIZE_CONVERSIONS', label: label('زيادة التحويلات', 'Maximize conversions') },
            { value: 'MAXIMIZE_CONVERSION_VALUE', label: label('زيادة قيمة التحويلات', 'Maximize conversion value') },
          ]} />
          {form.bidding === 'MAXIMIZE_CONVERSIONS' && input('targetCpa', label('تكلفة التحويل المستهدفة', 'Target CPA'), 'number', label('اختياري', 'Optional'))}
          {form.bidding === 'MAXIMIZE_CONVERSION_VALUE' && input('targetRoas', label('العائد المستهدف %', 'Target ROAS %'), 'number', label('اختياري', 'Optional'))}
          <div className="tiktok-ads-actions google-ads-form__wide"><Button onClick={() => ask(label('تغيير المزايدة بيأثر على طريقة صرف الميزانية. تأكيد؟', 'Changing bidding affects how the budget is spent. Confirm?'), () => request(`/campaigns/${campaign}/bidding`, form))}>{label('حفظ المزايدة', 'Save bidding')}</Button></div>
        </fieldset>
      </Panel>}

      {selected.advertisingChannelType === 'SEARCH' && <>
        {manage && <Panel title={label('إضافة مجموعة إعلانية', 'Add ad group')}>
          <fieldset className="google-ads-form" disabled={busy}>
            {input('name', label('اسم المجموعة', 'Group name'))}{input('cpc', label('حد سعر النقرة بعملة الحساب', 'CPC bid in account currency'), 'number')}
            <div className="tiktok-ads-actions google-ads-form__wide"><Button onClick={() => request('/groups', { campaign, name: form.name, cpc: form.cpc })}>{label('إنشاء مجموعة موقوفة', 'Create paused group')}</Button></div>
          </fieldset>
        </Panel>}

        <Card title={label('المجموعات الإعلانية', 'Ad groups')}>
          <div className="google-ads-inline google-ads-inline--end">
            <SelectField label={label('اختر المجموعة لإدارة محتواها', 'Choose group to manage its content')} value={group} disabled={busy} onChange={setGroup} placeholder={label('اختر مجموعة', 'Select group')} options={groups.map(g => ({ value: String(g.id), label: `${g.name} (${statusLabel(g.status)})` }))} />
            {group && manage && <Button icon={currentGroup?.status === 'ENABLED' ? Pause : Play} disabled={busy} onClick={() => { const status = currentGroup?.status === 'ENABLED' ? 'PAUSED' : 'ENABLED'; ask(label('تأكيد تغيير حالة المجموعة؟', 'Confirm ad group status change?'), () => request('/entities/status', { kind: 'group', id: group, status })); }}>{currentGroup?.status === 'ENABLED' ? label('إيقاف المجموعة', 'Pause group') : label('تشغيل المجموعة', 'Enable group')}</Button>}
          </div>
        </Card>

        {group && <>
          <Panel open title={label('الكلمات الحالية', 'Existing keywords')}>
            <ul className="google-ads-list">{(structure.keywords || []).filter(row => String(row.adGroup.id) === group).map(row => <Item key={row.adGroupCriterion.criterionId} title={row.adGroupCriterion.keyword.text} meta={`${row.adGroupCriterion.keyword.matchType}${row.adGroupCriterion.negative ? ` · ${label('مستبعدة', 'negative')}` : ''}`} status={row.adGroupCriterion.status} statusLabel={statusLabel}>{statusButton('keyword', row.adGroupCriterion, row.adGroupCriterion.criterionId, group)}</Item>)}</ul>
          </Panel>
          {manage && <Panel title={label('إضافة كلمات مفتاحية', 'Add keywords')}>
            <fieldset disabled={busy} className="google-ads-form">
              {area('keywords', label('الكلمات', 'Keywords'), label('كلمة أو عبارة في كل سطر', 'One keyword per line'))}
              <SelectField label={label('المطابقة', 'Match type')} value={form.matchType} onChange={value => change('matchType', value)} options={matchTypes} />
              <Checkbox checked={form.negative} onChange={e => change('negative', e.target.checked)} label={label('كلمات مستبعدة', 'Negative keywords')} />
              <div className="tiktok-ads-actions google-ads-form__wide"><Button onClick={() => request(`/groups/${group}/keywords`, { keywords: split(form.keywords).map(text => ({ text, matchType: form.matchType, negative: form.negative })) })}>{label('إضافة الكلمات', 'Add keywords')}</Button></div>
            </fieldset>
          </Panel>}
          <Panel open title={label('الإعلانات الحالية', 'Existing ads')}>
            <ul className="google-ads-list">{(structure.ads || []).filter(row => String(row.adGroup.id) === group).map(row => <Item key={row.adGroupAd.ad.id} title={row.adGroupAd.ad.responsiveSearchAd?.headlines?.map(h => h.text).join(' | ') || row.adGroupAd.ad.id} meta={[row.adGroupAd.ad.responsiveSearchAd?.descriptions?.map(d => d.text).join(' | '), row.adGroupAd.ad.finalUrls?.join(' · ')].filter(Boolean).join(' — ')} status={row.adGroupAd.status} statusLabel={statusLabel}>{statusButton('ad', row.adGroupAd, row.adGroupAd.ad.id, group)}</Item>)}</ul>
          </Panel>
          {manage && <Panel title={label('إضافة إعلان بحث متجاوب', 'Add responsive Search ad')}>
            <fieldset disabled={busy} className="google-ads-form">
              <div className="google-ads-form__wide">{input('finalUrl', label('الصفحة المقصودة', 'Destination URL'), 'url')}</div>
              {area('headlines', label('العناوين', 'Headlines'), label('من ٣ لـ ١٥، كل عنوان في سطر، لحد ٣٠ حرف', '3–15, one per line, max 30 characters'))}
              {area('descriptions', label('الأوصاف', 'Descriptions'), label('من ٢ لـ ٤، كل وصف في سطر، لحد ٩٠ حرف', '2–4, one per line, max 90 characters'))}
              <div className="tiktok-ads-actions google-ads-form__wide"><Button onClick={() => request(`/groups/${group}/ads`, { finalUrl: form.finalUrl, headlines: split(form.headlines), descriptions: split(form.descriptions) })}>{label('إنشاء إعلان موقوف', 'Create paused ad')}</Button></div>
            </fieldset>
          </Panel>}
        </>}
      </>}
    </>}

    <Panel title={label('إجراءات التحويل في الحساب', 'Account conversion actions')}>
      <div className="tiktok-ads-actions"><Button disabled={busy} onClick={() => request('/conversions', null, r => setConversions(r.rows || []))}>{label('اعرض إجراءات التحويل', 'Load conversion actions')}</Button></div>
      {conversions.length ? <ul className="google-ads-list">{conversions.map(row => <Item key={row.conversionAction.id} title={row.conversionAction.name} meta={`${row.conversionAction.category}${row.conversionAction.primaryForGoal ? ` · ${label('أساسي للمزايدة', 'primary for bidding')}` : ''}`} status={row.conversionAction.status} statusLabel={statusLabel} />)}</ul> : null}
      <p className="google-ads-muted">{label('وجود إجراء تحويل مش معناه إن أحداث الشراء بتوصل؛ لازم تتأكد من استقبال الأحداث في حساب جوجل.', 'A conversion action alone does not confirm purchase events are received. Verify incoming events in Google Ads.')}</p>
    </Panel>
  </div>;
}
