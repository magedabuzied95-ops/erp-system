import db from '../database/db.js';
import { crmPositiveId, crmDealInput, crmStageInput } from '../../shared/crmModel.js';
import { canonicalPhoneSql } from '../utils/phoneSearch.js';
import { emitToRooms } from '../utils/socket.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const joins = `FROM ai_lead_opportunities o
 LEFT JOIN ai_channel_conversations c ON c.id=o.channel_conversation_id AND c.tenant_id=o.tenant_id
 LEFT JOIN ai_customer_profiles p ON p.id=o.profile_id AND p.tenant_id=o.tenant_id
 LEFT JOIN LATERAL (SELECT assigned_user_id FROM ai_support_sessions
   WHERE tenant_id=o.tenant_id AND session_id=o.conversation_id LIMIT 1) sess ON TRUE
 JOIN crm_stages stage ON stage.id=o.stage_id AND stage.tenant_id=o.tenant_id
 LEFT JOIN LATERAL (
   SELECT candidate.* FROM customers candidate WHERE candidate.tenant_id=o.tenant_id AND
     (candidate.id=o.customer_id OR (o.customer_id IS NULL AND COALESCE(p.phone,'') ~ '^\\+?[0-9 ()-]{7,20}$'
       AND ${canonicalPhoneSql('candidate.phone')}=${canonicalPhoneSql('p.phone')}
       AND (SELECT count(*) FROM customers duplicate WHERE duplicate.tenant_id=o.tenant_id
         AND ${canonicalPhoneSql('duplicate.phone')}=${canonicalPhoneSql('p.phone')})=1))
   ORDER BY candidate.id LIMIT 1
 ) customer ON TRUE`;

// Apply scope BEFORE pagination, totals or detail projection. Never trust query.user_id.
function scopeSql(scope, params) {
  params.push(crmPositiveId(scope.tenantId));
  const clauses = [`o.tenant_id=$${params.length}`];
  if (!scope.isAdmin) {
    params.push(crmPositiveId(scope.userId));
    clauses.push(`COALESCE(sess.assigned_user_id,o.assigned_user_id)=$${params.length}`);
  }
  const hidden = scope.hiddenKeys || {};
  params.push(hidden.sessions || []);
  clauses.push(`NOT(COALESCE(o.conversation_id,'')=ANY($${params.length}::text[]))`);
  params.push(hidden.externals || []);
  clauses.push(`NOT(COALESCE(c.external_customer_id,'')=ANY($${params.length}::text[]))`);
  params.push(hidden.phones || []);
  clauses.push(`NOT(${canonicalPhoneSql("COALESCE(p.phone,customer.phone,'')")}=ANY($${params.length}::text[]))`);
  return clauses;
}

export async function listCrm(scope, query = {}) {
  const params = [];
  const where = scopeSql(scope, params);
  if (query.conversation_id) { params.push(String(query.conversation_id).slice(0,500)); where.push(`o.conversation_id=$${params.length}`); }
  if (query.pipeline_id) { params.push(crmPositiveId(query.pipeline_id)); where.push(`o.pipeline_id=$${params.length}`); }
  if (query.stage_id) { params.push(crmPositiveId(query.stage_id)); where.push(`o.stage_id=$${params.length}`); }
  if (String(query.q || '').trim()) {
    params.push(`%${String(query.q).trim().slice(0, 160).replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(o.title ILIKE $${params.length} OR COALESCE(p.phone,customer.phone,'') ILIKE $${params.length})`);
  }
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, Math.min(100000, Number.parseInt(query.offset, 10) || 0));
  const predicate = where.join(' AND ');
  const totals = await db.query(`SELECT count(*)::int AS count,COALESCE(sum(o.expected_revenue),0)::text AS value ${joins} WHERE ${predicate}`, params);
  const stageTotals = await db.query(`SELECT o.stage_id,count(*)::int AS count,COALESCE(sum(o.expected_revenue),0)::text AS value
    ${joins} WHERE ${predicate} GROUP BY o.stage_id`,params);
  params.push(limit, offset);
  const result = await db.query(`SELECT o.*,COALESCE(o.customer_id,customer.id) AS customer_id,to_char(o.expected_closing,'YYYY-MM-DD') AS expected_closing,stage.name AS stage_name,stage.color AS stage_color,
    COALESCE(sess.assigned_user_id,o.assigned_user_id) AS owner_id,
    COALESCE(customer.name,p.first_name,c.customer_name,'') AS customer_name,
    COALESCE(customer.phone,p.phone,'') AS phone,c.channel,
    COUNT(*) OVER(PARTITION BY o.stage_id)::int AS stage_count
    ${joins} WHERE ${predicate} ORDER BY o.updated_at DESC,o.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  return { opportunities: result.rows, total: totals.rows[0].count, total_value: totals.rows[0].value, stage_totals:stageTotals.rows, limit, offset };
}

export async function getCrm(scope, id) {
  const params = [];
  const where = scopeSql(scope, params);
  params.push(crmPositiveId(id)); where.push(`o.id=$${params.length}`);
  const result = await db.query(`SELECT o.*,COALESCE(o.customer_id,customer.id) AS customer_id,to_char(o.expected_closing,'YYYY-MM-DD') AS expected_closing,COALESCE(customer.name,p.first_name,c.customer_name,'') AS customer_name,
    COALESCE(customer.phone,p.phone,'') AS phone,c.channel ${joins} WHERE ${where.join(' AND ')}`, params);
  if (!result.rows[0]) fail(404, 'Opportunity not found');
  const opportunity = result.rows[0];
  const history = await db.query(`SELECT h.*,a.name AS from_name,b.name AS to_name FROM crm_stage_history h
    LEFT JOIN crm_stages a ON a.id=h.from_stage_id AND a.tenant_id=h.tenant_id
    JOIN crm_stages b ON b.id=h.to_stage_id AND b.tenant_id=h.tenant_id
    WHERE h.tenant_id=$1 AND h.opportunity_id=$2 ORDER BY h.id DESC LIMIT 100`, [scope.tenantId, id]);
  return { opportunity, history: history.rows };
}

export async function crmConfig(tenantId) {
  const pipelines = await db.query('SELECT * FROM crm_pipelines WHERE tenant_id=$1 ORDER BY is_default DESC,id', [tenantId]);
  const stages = await db.query('SELECT * FROM crm_stages WHERE tenant_id=$1 ORDER BY sequence,id', [tenantId]);
  return { pipelines: pipelines.rows, stages: stages.rows };
}

export async function createCrmPipeline(scope,input={}) {
  const name=String(input.name||'').trim();
  if(!name||name.length>120)fail(400,'Invalid pipeline name');
  return transaction(scope,async client=>{
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[scope.tenantId]);
    const exists=(await client.query('SELECT id FROM crm_pipelines WHERE tenant_id=$1 AND is_default',[scope.tenantId])).rows.length>0;
    const pipeline=(await client.query('INSERT INTO crm_pipelines(tenant_id,name,is_default) VALUES($1,$2,$3) RETURNING *',[scope.tenantId,name,!exists])).rows[0];
    await client.query(`INSERT INTO crm_stages(tenant_id,pipeline_id,name,legacy_key,sequence,color,is_won,is_lost)
      SELECT $1,$2,s.name,s.key,s.sequence,s.color,s.won,s.lost FROM (VALUES
        ('New','new',10,'#0ea5e9',false,false),('Contacted','contacted',20,'#06b6d4',false,false),
        ('Interested','interested',30,'#f59e0b',false,false),('Negotiation','negotiation',40,'#8b5cf6',false,false),
        ('Won','won',50,'#10b981',true,false),('Lost','lost',60,'#f43f5e',false,true)
      ) s(name,key,sequence,color,won,lost)`,[scope.tenantId,pipeline.id]);
    return pipeline;
  });
}

async function transaction(scope, fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('m1.crm_actor',$1,true),set_config('m1.crm_source','manual',true)", [String(scope.userId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    emitToRooms([`tenant:${scope.tenantId}`], 'ai_inbox:refresh', { tenant_id: scope.tenantId, reason: 'crm_updated' });
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function validateCustomer(client, tenantId, id) {
  if (!id) return null;
  const safeId = crmPositiveId(id);
  const result = await client.query('SELECT id FROM customers WHERE tenant_id=$1 AND id=$2', [tenantId, safeId]);
  if (!result.rows[0]) fail(400, 'Invalid customer');
  return safeId;
}

export async function createCrm(scope, input) {
  const fields = crmDealInput(input);
  return transaction(scope, async client => {
    const stageId = crmPositiveId(input.stage_id);
    const stage = (await client.query('SELECT * FROM crm_stages WHERE tenant_id=$1 AND id=$2 AND NOT is_archived', [scope.tenantId, stageId])).rows[0];
    if (!stage) fail(400, 'Invalid stage');
    const customerId = await validateCustomer(client, scope.tenantId, input.customer_id);
    const row = (await client.query(`INSERT INTO ai_lead_opportunities
      (tenant_id,profile_id,title,notes,pipeline_id,stage_id,customer_id,expected_revenue,probability,priority,expected_closing,assigned_user_id,status)
      VALUES($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [scope.tenantId,fields.title,fields.notes,stage.pipeline_id,stageId,customerId,fields.expected_revenue,fields.probability,fields.priority,fields.expected_closing,scope.userId,stage.is_won?'won':stage.is_lost?'lost':'open'])).rows[0];
    return row;
  });
}

export async function updateCrm(scope, id, input) {
  return transaction(scope, async client => {
    const params=[];
    const where=scopeSql(scope,params);
    params.push(crmPositiveId(id));where.push(`o.id=$${params.length}`);
    const preview = (await client.query(`SELECT o.* ${joins} WHERE ${where.join(' AND ')}`, params)).rows[0];
    if (!preview) fail(404, 'Opportunity not found');
    if (preview.channel_conversation_id) {
      const separator=preview.conversation_id.indexOf(':');
      await client.query(`SELECT id FROM ai_channel_conversations WHERE tenant_id=$1
        AND (id=$2 OR (channel=$3 AND external_conversation_id IN ($4,$5))) ORDER BY id FOR UPDATE`,
      [scope.tenantId,preview.channel_conversation_id,preview.conversation_id.slice(0,separator),preview.conversation_id,preview.conversation_id.slice(separator+1)]);
    }
    const current = (await client.query(`SELECT o.*,to_char(o.expected_closing,'YYYY-MM-DD') AS expected_closing ${joins} WHERE ${where.join(' AND ')} FOR UPDATE OF o`, params)).rows[0];
    if (!current) fail(404, 'Opportunity not found');
    if (Number(input.version) !== current.version) fail(409, 'Opportunity changed; refresh and retry');
    const fields = crmDealInput({ ...current, ...input });
    const stageId = crmPositiveId(input.stage_id ?? current.stage_id);
    const stage = (await client.query('SELECT * FROM crm_stages WHERE tenant_id=$1 AND id=$2 AND NOT is_archived', [scope.tenantId, stageId])).rows[0];
    if (!stage) fail(400, 'Invalid stage');
    const customerId = await validateCustomer(client, scope.tenantId, input.customer_id === undefined ? current.customer_id : input.customer_id);
    if (current.channel_conversation_id) {
      // Custom stages project to a stable inbox key. No follow-up enrollment here.
      const details = { lead_name: fields.title, expected_revenue: fields.expected_revenue, priority: fields.priority,
        expected_closing: fields.expected_closing, notes: fields.notes };
      await client.query("SELECT set_config('m1.crm_skip_sync','1',true)");
      const separator=current.conversation_id.indexOf(':');
      await client.query(`UPDATE ai_channel_conversations SET lead_status=COALESCE($3,lead_status),
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('crm_lead_details',
          COALESCE(metadata->'crm_lead_details','{}'::jsonb) || $4::jsonb,
          'crm_stage_id',$5::bigint,'crm_stage_name',$6::text),updated_at=NOW()
        WHERE tenant_id=$1 AND (id=$2 OR (channel=$7 AND external_conversation_id IN ($8,$9)))`,
      [scope.tenantId,current.channel_conversation_id,stage.legacy_key || (stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'negotiation'),JSON.stringify(details),stage.id,stage.name,current.conversation_id.slice(0,separator),current.conversation_id,current.conversation_id.slice(separator+1)]);
    }
    return (await client.query(`UPDATE ai_lead_opportunities SET title=$3,notes=$4,pipeline_id=$5,stage_id=$6,
      customer_id=$7,expected_revenue=$8,probability=$9,priority=$10,expected_closing=$11,
      status=$12,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [scope.tenantId,id,fields.title,fields.notes,stage.pipeline_id,stageId,customerId,fields.expected_revenue,fields.probability,fields.priority,fields.expected_closing,stage.is_won?'won':stage.is_lost?'lost':'open'])).rows[0];
  });
}

export async function crmOrders(scope,id) {
  const {opportunity}=await getCrm(scope,id);
  return (await db.query(`SELECT id,invoice_number,status,created_at,COALESCE(to_jsonb(orders)->>'total_amount',to_jsonb(orders)->>'total','0') AS total
    FROM orders WHERE tenant_id=$1 AND (
      ($2::bigint IS NOT NULL AND customer_id=$2) OR ($3<>'' AND ai_agent_conversation_id=$3))
    ORDER BY created_at DESC,id DESC LIMIT 50`,[scope.tenantId,opportunity.customer_id,opportunity.conversation_id||''])).rows;
}

export async function saveCrmStage(scope, id, input) {
  return transaction(scope, async client => {
    if (id) {
      const existing = (await client.query('SELECT * FROM crm_stages WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [scope.tenantId,crmPositiveId(id)])).rows[0];
      if (!existing) fail(404,'Stage not found');
      const value = crmStageInput({...existing,...input});
      if (existing.legacy_key && (value.is_won !== existing.is_won || value.is_lost !== existing.is_lost)) fail(400,'Built-in stage outcomes cannot change');
      if (value.is_won !== existing.is_won || value.is_lost !== existing.is_lost) {
        const used = await client.query('SELECT 1 FROM ai_lead_opportunities WHERE tenant_id=$1 AND stage_id=$2 LIMIT 1',[scope.tenantId,existing.id]);
        if (used.rowCount) fail(400,'Cannot change the outcome of a stage containing opportunities');
      }
      const result = await client.query(`UPDATE crm_stages SET name=$3,sequence=$4,color=$5,is_won=$6,is_lost=$7
        WHERE tenant_id=$1 AND id=$2 RETURNING *`, [scope.tenantId,crmPositiveId(id),value.name,value.sequence,value.color,value.is_won,value.is_lost]);
      if (!result.rows[0]) fail(404,'Stage not found');
      return result.rows[0];
    }
    const value = crmStageInput(input);
    const pipeline = (await client.query('SELECT id FROM crm_pipelines WHERE tenant_id=$1 AND id=$2', [scope.tenantId,crmPositiveId(input.pipeline_id)])).rows[0];
    if (!pipeline) fail(400,'Invalid pipeline');
    return (await client.query(`INSERT INTO crm_stages(tenant_id,pipeline_id,name,sequence,color,is_won,is_lost)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [scope.tenantId,pipeline.id,value.name,value.sequence,value.color,value.is_won,value.is_lost])).rows[0];
  });
}
