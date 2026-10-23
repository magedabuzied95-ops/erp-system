import test from 'node:test';
import assert from 'node:assert/strict';
import { crmDealInput, crmStageInput, crmPositiveId,crmStageReference } from '../shared/crmModel.js';

test('Sequence stage references support legacy keys and precise CRM identifiers',()=>{
  assert.equal(crmStageReference('interested'),'interested');
  assert.equal(crmStageReference('crm:12'),'crm:12');
  assert.equal(crmStageReference(''),'');
  for(const value of ['crm:0','crm:1e2','crm:-1','crm:99999999999999999999','other',['crm:1']])assert.throws(()=>crmStageReference(value));
});

test('CRM does not accept ambiguous identifiers', () => {
  for (const value of [0, -1, 1.5, 'a', true, ['1'], {}, '1e2', '0x10', Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => crmPositiveId(value));
  assert.equal(crmPositiveId('12'), 12);
});
test('terminal stages cannot be both won and lost', () => {
  assert.throws(() => crmStageInput({ name: 'Closed', is_won: true, is_lost: true }));
  assert.throws(() => crmStageInput({ name: 'Stage', color: 'red' }));
  assert.equal(crmStageInput({ name: 'مؤهل' }).name, 'مؤهل');
});
test('CRM rejects impossible dates and non-finite financial values', () => {
  for (const patch of [{ expected_closing: '2026-02-30' }, { expected_closing: '2026-13-01' }, { expected_revenue: Infinity }, { probability: 101 }, { priority: 1.5 }]) {
    assert.throws(() => crmDealInput({ title: 'Test', ...patch }));
  }
  assert.equal(crmDealInput({ title: 'Test', expected_closing: '2028-02-29' }).expected_closing, '2028-02-29');
  assert.equal(crmDealInput({ title: 'Test', expected_revenue: 12.345 }).expected_revenue, 12.35);
});
