import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api/api';
import ThemedSelect from '../../../shared/ui/ThemedSelect';
import usePermission from '../../permissions/hooks/usePermission';
import { subscribeRealtime } from '../../../shared/realtime/socketStore';
import SequencesPanel from '../../aiSupport/components/controlCenter/SequencesPanel';
import { wallClockToInstant } from '../../../shared/lib/appTimezone';

const blank = { title: '', expected_revenue: '', probability: '', priority: 0, expected_closing: '', notes: '', customer_id: '' };
export default function Crm() {
  const { t, i18n } = useTranslation();
  const tr = key => t(`aiSupport.crm.${key}`);
  const canCreate = usePermission('crm.create');
  const canEdit = usePermission('crm.edit');
  const canManage = usePermission('crm.manage');
  const canCustomers = usePermission('customers.view');
  const canOrders = usePermission('orders.view');
  const canSettings = usePermission('settings.edit');
  const canInboxView = usePermission('ai_inbox_messenger.view');
  const canInboxReply = usePermission('ai_inbox_messenger.reply');
  const canTasksView = usePermission('staff_tasks.view');
  const canTasksCreate = usePermission('staff_tasks.create');
  const [activities,setActivities]=useState([]);
  const [activityDraft,setActivityDraft]=useState({kind:'task',title:'',due:''});
  const [rulesOpen,setRulesOpen]=useState(false);
  const [notice,setNotice]=useState('');
  const [config,setConfig] = useState({pipelines:[],stages:[]});
  const [pipeline,setPipeline] = useState('');
  const [stageFilter,setStageFilter] = useState('');
  const [search,setSearch] = useState('');
  const [page,setPage] = useState(0);
  const [data,setData] = useState({opportunities:[],total:0});
  const [view,setView] = useState('board');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [editor,setEditor] = useState(null);
  const [history,setHistory] = useState([]);
  const [orders,setOrders] = useState([]);
  const [customerSearch,setCustomerSearch] = useState('');
  const [customerOptions,setCustomerOptions] = useState([]);
  const [stageEditor,setStageEditor] = useState(null);
  const [pipelineEditor,setPipelineEditor] = useState(null);
  const editorOpen=Boolean(editor);
  const requestVersion = useRef(0);
  const stages = config.stages.filter(s=>String(s.pipeline_id)===String(pipeline)&&!s.is_archived);
  const defaultNames={new:'New',contacted:'Contacted',interested:'Interested',negotiation:'Negotiation',won:'Won',lost:'Lost'};
  const stageLabel=s=>s.name===defaultNames[s.legacy_key]?tr(`stages.${s.legacy_key}`):s.name;
  const load = useCallback(async () => {
    const version=++requestVersion.current;
    setBusy(true);
    try {
      const params=new URLSearchParams({limit:'50',offset:String(page*50),q:search});
      if(pipeline) params.set('pipeline_id',pipeline);
      if(stageFilter) params.set('stage_id',stageFilter);
      const result=await api.get(`/crm/opportunities?${params}`);
      if(version===requestVersion.current) {setData(result);setError('');}
    } catch(e) {if(version===requestVersion.current)setError(e.message);}
    finally {if(version===requestVersion.current)setBusy(false);}
  },[page,pipeline,stageFilter,search]);
  const loadConfig=useCallback(async()=>{
    const result=await api.get('/crm/config');setConfig(result);
    setPipeline(current=>current||String(result.pipelines[0]?.id||''));
  },[]);
  useEffect(()=>{loadConfig().catch(e=>setError(e.message));},[loadConfig]);
  useEffect(()=>{const timer=setTimeout(load,200);return()=>clearTimeout(timer);},[load]);
  useEffect(()=>{const refresh=()=>load();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[load]);
  useEffect(()=>{let timer;const off=subscribeRealtime('ai_inbox:refresh',()=>{clearTimeout(timer);timer=setTimeout(load,250);});return()=>{off();clearTimeout(timer);};},[load]);
  useEffect(()=>{
    if(!editorOpen||!canCustomers)return undefined;
    let active=true;
    const timer=setTimeout(()=>api.get(`/customers?limit=30&search=${encodeURIComponent(customerSearch)}`).then(result=>{if(active)setCustomerOptions(result.customers||result.data||[]);}).catch(e=>{if(active)setError(e.message);}),250);
    return()=>{active=false;clearTimeout(timer);};
  },[editorOpen,customerSearch,canCustomers]);
  const open=async id=>{
    try {const result=await api.get(`/crm/opportunities/${id}`);setEditor(result.opportunity);setNotice('');setHistory(result.history);setOrders([]);setActivities([]);setActivityDraft({kind:'task',title:'',due:'',request_id:crypto.randomUUID()});setError('');if(canTasksView){const linked=await api.get(`/crm/opportunities/${id}/activities`);setActivities(linked.activities);}if(canOrders){const linked=await api.get(`/crm/opportunities/${id}/orders`);setOrders(linked.orders);}}
    catch(e){setError(e.message);}
  };
  const save=async event=>{
    event.preventDefault();setBusy(true);
    try {
      if(editor.id)await api.patch(`/crm/opportunities/${editor.id}`,editor);
      else await api.post('/crm/opportunities',editor);
      setEditor(null);await load();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const move=async(deal,stageId)=>{
    if(!canEdit||busy||String(deal.stage_id)===String(stageId))return;
    setBusy(true);
    try{await api.patch(`/crm/opportunities/${deal.id}`,{version:deal.version,stage_id:stageId});await load();}
    catch(e){setError(e.message);await load();setError(e.message);}finally{setBusy(false);}
  };
  const currency=value=>new Intl.NumberFormat(i18n.language,{maximumFractionDigits:2}).format(Number(value)||0);
  const date=value=>value?new Intl.DateTimeFormat(i18n.language,{timeZone:'Africa/Cairo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';
  const control='w-full rounded-xl border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  const button='rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-600';
  const stageOptions=stages.map(s=>({value:String(s.id),label:stageLabel(s)}));
  return <main className="space-y-5 p-4 text-slate-900 dark:text-slate-100" dir={i18n.dir()}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{tr('title')}</h1><p className="text-sm text-slate-500">{tr('subtitle')}</p></div>
      <div className="flex gap-2"><button className={button} onClick={load} disabled={busy}>{tr('refresh')}</button>{canCreate&&<button className={button} disabled={!stages.length||busy} onClick={()=>{setEditor({...blank,stage_id:stages[0].id});setHistory([]);setNotice('');setOrders([]);setCustomerSearch('');setError('');}}>{tr('new')}</button>}
      {canManage&&<><button className={button} disabled={!pipeline} onClick={()=>setStageEditor({name:'',sequence:10,color:'#64748b',pipeline_id:pipeline})}>{tr('newStage')}</button><button className={button} onClick={()=>setPipelineEditor({name:''})}>{tr('newPipeline')}</button>{canSettings&&canInboxView&&<button className={button} onClick={()=>setRulesOpen(true)}>{tr('automation')}</button>}</>}</div></header>
    {error&&<div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</div>}
    <section className="grid gap-3 md:grid-cols-4" aria-label={tr('filters')}>
      <input className={control} aria-label={tr('search')} placeholder={tr('search')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} />
      <ThemedSelect ariaLabel={tr('pipeline')} value={pipeline} options={config.pipelines.map(p=>({value:String(p.id),label:p.is_default&&p.name==='Sales'?tr('salesPipeline'):p.name}))} onChange={value=>{setPipeline(value);setStageFilter('');setPage(0);}} />
      <ThemedSelect ariaLabel={tr('stage')} value={stageFilter} options={[{value:'',label:tr('allStages')},...stageOptions]} onChange={value=>{setStageFilter(value);setPage(0);}} />
      <ThemedSelect ariaLabel={tr('view')} value={view} options={[{value:'board',label:tr('board')},{value:'list',label:tr('list')}]} onChange={value=>setView(value)} />
    </section>
    <p aria-live="polite">{tr('count')}: {data.total} · {tr('pageValue')}: {currency(data.total_value)}</p>
    {view==='board'?<div className="flex gap-3 overflow-x-auto pb-4" aria-busy={busy}>{stages.filter(s=>!stageFilter||String(s.id)===stageFilter).map(stage=><section key={stage.id} className="min-w-64 flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900" onDragOver={e=>{if(canEdit)e.preventDefault();}} onDrop={e=>{e.preventDefault();const deal=data.opportunities.find(o=>String(o.id)===e.dataTransfer.getData('text/plain'));if(deal)move(deal,stage.id);}}>
      <header className="mb-3 flex items-center justify-between border-t-4 pt-2" style={{borderColor:stage.color}}><div><h2 className="font-bold">{stageLabel(stage)}</h2><p className="text-xs text-slate-500">{tr('count')}: {data.stage_totals?.find(item=>String(item.stage_id)===String(stage.id))?.count||0} · {currency(data.stage_totals?.find(item=>String(item.stage_id)===String(stage.id))?.value)}</p></div>{canManage&&<button className={button} onClick={()=>setStageEditor(stage)}>{tr('edit')}</button>}</header>
      <div className="space-y-3">{data.opportunities.filter(o=>String(o.stage_id)===String(stage.id)).map(deal=><article key={deal.id} draggable={canEdit&&!busy} onDragStart={e=>e.dataTransfer.setData('text/plain',String(deal.id))} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"><button className="w-full text-start font-semibold" onClick={()=>open(deal.id)}>{deal.title}</button><p className="text-sm text-slate-500">{deal.customer_name||deal.phone||'—'}</p><p className="my-2 font-bold">{currency(deal.expected_revenue)}</p>{canEdit&&<ThemedSelect ariaLabel={`${tr('stage')} ${deal.title}`} value={String(deal.stage_id)} options={stageOptions} disabled={busy} onChange={value=>move(deal,value)} />}</article>)}</div>
    </section>)}</div>:<div className="overflow-x-auto"><table className="w-full text-start"><thead><tr>{['name','customer','value','stage','closing'].map(k=><th key={k} className="p-3 text-start">{tr(k)}</th>)}</tr></thead><tbody>{data.opportunities.map(deal=><tr key={deal.id} className="border-t border-slate-200 dark:border-slate-700"><td className="p-3"><button onClick={()=>open(deal.id)}>{deal.title}</button></td><td>{deal.customer_name||deal.phone||'—'}</td><td>{currency(deal.expected_revenue)}</td><td>{stageLabel(config.stages.find(s=>String(s.id)===String(deal.stage_id))||{name:deal.stage_name})}</td><td>{deal.expected_closing||'—'}</td></tr>)}</tbody></table></div>}
    {!busy&&!data.opportunities.length&&<p className="p-8 text-center text-slate-500">{tr('empty')}</p>}
    <footer className="flex items-center gap-3"><button className={button} disabled={busy||page===0} onClick={()=>setPage(v=>v-1)}>{tr('previous')}</button><span>{page+1}</span><button className={button} disabled={busy||(page+1)*50>=data.total} onClick={()=>setPage(v=>v+1)}>{tr('next')}</button><span className="text-sm text-slate-500">{tr('paginationHint')}</span></footer>
    {editor&&<div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={tr('opportunity')}><form onSubmit={save} className="mx-auto max-w-2xl space-y-4 rounded-2xl bg-white p-5 dark:bg-slate-800"><h2 className="text-xl font-bold">{tr('opportunity')}</h2>
      {error&&<p role="alert" className="text-red-600">{error}</p>}
      {notice&&<p role="status">{notice}</p>}
      {editor.id&&editor.channel_conversation_id&&canEdit&&canInboxReply&&<button className={button} type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');setNotice('');try{const result=await api.post(`/crm/opportunities/${editor.id}/followups`,{version:editor.version});setNotice(result.enrolled?t('aiSupport.crm.followupsStarted',{count:result.enrolled}):tr('followupsNone'));}catch(err){setError(err.message);}finally{setBusy(false);}}}>{tr('startFollowups')}</button>}
      {['title','expected_revenue','probability','priority','expected_closing'].map(key=><label className="block text-sm" key={key}>{key==='title'?tr('name'):tr(key)}<input className={control} disabled={editor.id?!canEdit:!canCreate} required={key==='title'} type={key==='expected_closing'?'date':['expected_revenue','probability','priority'].includes(key)?'number':'text'} min={0} max={key==='probability'?100:key==='priority'?5:undefined} step={key==='expected_revenue'||key==='probability'?'0.01':'1'} value={editor[key]??''} onChange={e=>setEditor(v=>({...v,[key]:e.target.value}))} /></label>)}
      {canCustomers&&<section><label className="block">{tr('customerSearch')}<input className={control} value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} /></label><ThemedSelect ariaLabel={tr('customer')} value={String(editor.customer_id||'')} options={[{value:'',label:tr('noCustomer')},...(editor.customer_id&&!customerOptions.some(c=>String(c.id)===String(editor.customer_id))?[{value:String(editor.customer_id),label:editor.customer_name||tr('customer')}]:[]),...customerOptions.map(c=>({value:String(c.id),label:`${c.name} ${c.phone||''}`}))]} disabled={editor.id?!canEdit:!canCreate} onChange={value=>setEditor(v=>({...v,customer_id:value}))} /></section>}
      <label className="block text-sm">{tr('stage')}<ThemedSelect value={String(editor.stage_id)} ariaLabel={tr('stage')} options={config.stages.filter(s=>String(s.pipeline_id)===String(editor.pipeline_id||pipeline)&&!s.is_archived).map(s=>({value:String(s.id),label:stageLabel(s)}))} disabled={!canEdit&&Boolean(editor.id)} onChange={value=>setEditor(v=>({...v,stage_id:value}))} /></label>
      <label className="block text-sm">{tr('notes')}<textarea className={control} rows={4} value={editor.notes||''} disabled={!canEdit&&Boolean(editor.id)} onChange={e=>setEditor(v=>({...v,notes:e.target.value}))} /></label>
      <nav className="flex gap-3">{editor.conversation_id&&<Link className="underline" to={`/admin/ai-inbox?conversation=${encodeURIComponent(editor.conversation_id)}`}>{tr('conversation')}</Link>}{editor.customer_id&&<Link className="underline" to={`/customers/${editor.customer_id}/statement`}>{tr('customer')}</Link>}</nav>
      <section><h3 className="font-bold">{tr('history')}</h3>{history.map(h=><p key={h.id} className="text-sm">{h.from_stage_id?stageLabel(config.stages.find(s=>String(s.id)===String(h.from_stage_id))||{name:h.from_name}):'—'} → {stageLabel(config.stages.find(s=>String(s.id)===String(h.to_stage_id))||{name:h.to_name})} · {date(h.occurred_at)}</p>)}</section>
      {canOrders&&<section><h3 className="font-bold">{tr('orders')}</h3>{orders.map(order=><p key={order.id}><Link className="underline" to={`/orders/${order.id}`}>{order.invoice_number||order.id}</Link> · {currency(order.total)} · {order.status}</p>)}</section>}
      {editor.id&&canTasksView&&<section><h3 className="font-bold">{tr('activities')}</h3>{activities.map(activity=><p key={activity.id} className="text-sm">{activity.title} · {date(activity.due_at)} · {t(`aiSupport.crm.activityStatuses.${activity.status}`,{defaultValue:activity.status})}</p>)}<Link className="text-sm underline" to="/staff/tasks">{tr('manageActivities')}</Link></section>}
      {editor.id&&canEdit&&canTasksCreate&&<section className="space-y-2 rounded-xl border p-3"><h3 className="font-bold">{tr('newActivity')}</h3><ThemedSelect ariaLabel={tr('activityKind')} value={activityDraft.kind} options={['task','call','meeting'].map(kind=>({value:kind,label:tr(`activityKinds.${kind}`)}))} onChange={value=>setActivityDraft(v=>({...v,kind:value}))} /><label className="block">{tr('activityTitle')}<input className={control} value={activityDraft.title} onChange={e=>setActivityDraft(v=>({...v,title:e.target.value}))} /></label><label className="block">{tr('activityDue')}<input type="datetime-local" className={control} value={activityDraft.due} onInput={e=>setActivityDraft(v=>({...v,due:e.target.value}))} onChange={e=>setActivityDraft(v=>({...v,due:e.target.value}))} /></label><button type="button" className={button} disabled={busy||!activityDraft.title.trim()||!activityDraft.due} onClick={async()=>{setBusy(true);setError('');try{await api.post(`/crm/opportunities/${editor.id}/activities`,{...activityDraft,due_at:wallClockToInstant(activityDraft.due,'Africa/Cairo')});setActivityDraft({kind:'task',title:'',due:'',request_id:crypto.randomUUID()});if(canTasksView){const result=await api.get(`/crm/opportunities/${editor.id}/activities`);setActivities(result.activities);}setNotice(tr('activityCreated'));}catch(err){setError(err.message);}finally{setBusy(false);}}}>{tr('addActivity')}</button></section>}
      <footer className="flex gap-2">{(editor.id?canEdit:canCreate)&&<button className={button} disabled={busy} type="submit">{tr('save')}</button>}<button type="button" className={button} disabled={busy} onClick={()=>setEditor(null)}>{tr('close')}</button></footer>
    </form></div>}
    {rulesOpen&&<div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={tr('automation')}><section className="mx-auto max-w-5xl rounded-2xl bg-slate-900 p-5 text-white"><button className={button} onClick={()=>setRulesOpen(false)}>{tr('close')}</button><SequencesPanel /></section></div>}
    {stageEditor&&<div className="fixed inset-0 z-50 overflow-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={tr('newStage')}><form className="mx-auto max-w-md space-y-4 rounded-2xl bg-white p-5 dark:bg-slate-800" onSubmit={async e=>{e.preventDefault();setBusy(true);try{if(stageEditor.id)await api.patch(`/crm/stages/${stageEditor.id}`,stageEditor);else await api.post('/crm/stages',stageEditor);setStageEditor(null);await loadConfig();await load();}catch(err){setError(err.message);}finally{setBusy(false);}}}>
      <h2 className="text-lg font-bold">{tr('newStage')}</h2>{error&&<p role="alert" className="text-red-600">{error}</p>}{['name','sequence','color'].map(key=><label className="block" key={key}>{tr(key)}<input className={control} required type={key==='color'?'color':key==='sequence'?'number':'text'} value={stageEditor[key]} onChange={e=>setStageEditor(v=>({...v,[key]:e.target.value}))} /></label>)}
      {['won','lost'].map(outcome=><label key={outcome} className="flex items-center gap-2"><input type="checkbox" disabled={Boolean(stageEditor.legacy_key)} checked={Boolean(stageEditor[`is_${outcome}`])} onChange={e=>setStageEditor(v=>({...v,is_won:false,is_lost:false,[`is_${outcome}`]:e.target.checked}))} />{tr(`stages.${outcome}`)}</label>)}
      <button className={button} disabled={busy}>{tr('save')}</button><button className={button} type="button" disabled={busy} onClick={()=>setStageEditor(null)}>{tr('close')}</button>
    </form></div>}
    {pipelineEditor&&<div className="fixed inset-0 z-50 overflow-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={tr('newPipeline')}><form className="mx-auto max-w-md space-y-4 rounded-2xl bg-white p-5 dark:bg-slate-800" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const result=await api.post('/crm/pipelines',pipelineEditor);await loadConfig();setPipeline(String(result.pipeline.id));setStageFilter('');setPage(0);setPipelineEditor(null);}catch(err){setError(err.message);}finally{setBusy(false);}}}><h2>{tr('newPipeline')}</h2>{error&&<p role="alert">{error}</p>}<label>{tr('name')}<input className={control} required maxLength={120} value={pipelineEditor.name} onChange={e=>setPipelineEditor({name:e.target.value})} /></label><button className={button} disabled={busy}>{tr('save')}</button><button type="button" className={button} onClick={()=>setPipelineEditor(null)}>{tr('close')}</button></form></div>}
  </main>;
}
