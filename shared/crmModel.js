// Stable compatibility keys remain the inbox and follow-up vocabulary.
export const CRM_LEGACY_STAGES = Object.freeze(['new', 'contacted', 'interested', 'negotiation', 'won', 'lost']);

export function crmCsvCell(value) {
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

export function crmStageReference(value) {
  if(value!=null&&typeof value!=='string')throw Object.assign(new Error('Invalid stage reference'),{status:400});
  const key=String(value??'').trim().toLowerCase();
  if (!key || CRM_LEGACY_STAGES.includes(key)) return key;
  if (key.startsWith('crm:')) return `crm:${crmPositiveId(key.slice(4))}`;
  throw Object.assign(new Error('Invalid stage reference'),{status:400});
}

export function crmPositiveId(value) {
  if ((typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'string' && !/^[1-9][0-9]*$/.test(value))) {
    throw Object.assign(new Error('Invalid identifier'), { status: 400 });
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw Object.assign(new Error('Invalid identifier'), { status: 400 });
  return number;
}

export function crmStageInput(input = {}) {
  const name = String(input.name ?? '').trim();
  const sequence = Number(input.sequence ?? 10);
  const color = String(input.color ?? '#64748b');
  const isWon = input.is_won === true;
  const isLost = input.is_lost === true;
  if (!name || name.length > 120 || !Number.isSafeInteger(sequence) || sequence < 0 || sequence > 100000
      || !/^#[0-9a-f]{6}$/i.test(color) || (isWon && isLost)) {
    throw Object.assign(new Error('Invalid stage'), { status: 400 });
  }
  return { name, sequence, color, is_won: isWon, is_lost: isLost };
}

export function crmDealInput(input = {}) {
  const title = String(input.title ?? '').trim();
  const expectedRevenue = input.expected_revenue === '' || input.expected_revenue == null ? null : Number(input.expected_revenue);
  const probability = input.probability === '' || input.probability == null ? null : Number(input.probability);
  const priority = Number(input.priority ?? 0);
  const closing = input.expected_closing instanceof Date
    ? (Number.isFinite(input.expected_closing.getTime()) ? input.expected_closing.toISOString().slice(0,10) : 'invalid')
    : String(input.expected_closing ?? '').trim();
  const validDate = !closing || (/^\d{4}-\d{2}-\d{2}$/.test(closing) && Number.isFinite(Date.parse(`${closing}T00:00:00Z`)) && new Date(`${closing}T00:00:00Z`).toISOString().slice(0, 10) === closing);
  if (!title || title.length > 200 || (expectedRevenue !== null && (!Number.isFinite(expectedRevenue) || expectedRevenue < 0 || expectedRevenue > 999999999999.99))
      || (probability !== null && (!Number.isFinite(probability) || probability < 0 || probability > 100))
      || !Number.isInteger(priority) || priority < 0 || priority > 5 || !validDate) {
    throw Object.assign(new Error('Invalid opportunity'), { status: 400 });
  }
  return { title, expected_revenue: expectedRevenue === null ? null : Math.round(expectedRevenue * 100) / 100,
    probability, priority, expected_closing: closing || null, notes: String(input.notes ?? '').slice(0, 8000) };
}
