import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../shared/api/api';
import { instantToWallClock } from '../../../shared/lib/appTimezone';
import usePermission from '../../permissions/hooks/usePermission';
import { crmCsvCell } from '../../../../shared/crmModel';
import { subscribeRealtime } from '../../../shared/realtime/socketStore';

export default function CrmReports({ pipeline }) {
  const { t, i18n } = useTranslation();
  const tr = key => t(`aiSupport.crm.reports.${key}`);
  const canExport = usePermission('crm.export');
  const today = instantToWallClock(new Date(), 'Africa/Cairo').slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const params = useCallback(() => new URLSearchParams({ from, to, ...(pipeline ? { pipeline_id: pipeline } : {}) }), [from, to, pipeline]);
  const load = useCallback(async () => {
    const version = ++request.current;
    setBusy(true);
    try {
      const result = await api.get(`/crm/reports?${params()}`);
      if (version === request.current) { setReport(result.report); setError(''); }
    } catch (err) { if (version === request.current) { setError(err.message); setReport(null); } }
    finally { if (version === request.current) setBusy(false); }
  }, [params]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { window.addEventListener('focus', load); return () => window.removeEventListener('focus', load); }, [load]);
  useEffect(() => {
    let timer;
    const off = subscribeRealtime('ai_inbox:refresh', payload => {
      if (!/crm|stage|lead/.test(String(payload?.reason || ''))) return;
      clearTimeout(timer); timer = setTimeout(load, 400);
    });
    return () => { off(); clearTimeout(timer); };
  }, [load]);
  useEffect(() => () => { request.current++; }, []);
  const number = value => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value || 0);
  const stageLabel = row => {
    const defaults = { new: 'New', contacted: 'Contacted', interested: 'Interested', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
    return row.legacy_key && defaults[row.legacy_key] === row.name ? t(`aiSupport.crm.stages.${row.legacy_key}`) : row.name;
  };
  const ownerLabel = row => row.name || (row.owner_id ? `${tr('owner')} #${row.owner_id}` : tr('unassigned'));
  const previousLabel = row => row.previous_id ? stageLabel({ name: row.previous_name, legacy_key: row.previous_legacy_key }) : '—';
  const sourceLabel = row => t(`aiSupport.crm.reports.sources.${row.source}`, { defaultValue: row.source });
  const exportCsv = async section => {
    setExporting(true); setError('');
    try {
      const { report: data } = await api.get(`/crm/reports/export?${params()}`);
      let rows;
      if (section === 'stages') rows = [[tr('pipeline'), tr('stage'), tr('comparison'), tr('entered'), tr('current'), tr('converted'), tr('previousEntered'), tr('conversion'), tr('value')],
        ...data.stages.map(row => [row.pipeline_name, stageLabel(row), previousLabel(row), row.entered, row.current_count, row.converted, row.previous_count, row.conversion ?? '', row.current_value])];
      else if (section === 'forecast') rows = [[tr('month'), tr('count'), tr('value'), tr('forecast')], ...data.forecast.map(row => [row.month || tr('noClosing'), row.count, row.value, row.forecast])];
      else rows = [[section === 'owners' ? tr('owner') : tr('source'), tr('count'), tr('won'), tr('lost'), tr('value'), tr('forecast')],
        ...data[section].map(row => [section === 'owners' ? ownerLabel(row) : sourceLabel(row), row.count, row.won, row.lost, row.value, row.forecast])];
      const blob = new Blob(['\ufeff', rows.map(row => row.map(crmCsvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `crm-${section}-${data.from || 'all'}-${data.to || 'all'}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
    finally { setExporting(false); }
  };
  const button = 'rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-600';
  const input = 'rounded-xl border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900';
  const exportButton = section => canExport && <button className={button} disabled={busy || exporting} onClick={() => exportCsv(section)}>{tr('export')}</button>;
  const table = (headers, rows) => <div className="overflow-x-auto"><table className="w-full text-start"><thead><tr>{headers.map(header => <th key={header} className="p-2 text-start">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-200 dark:border-slate-700">{row.map((cell, cellIndex) => <td key={cellIndex} className="p-2">{cell}</td>)}</tr>)}</tbody></table></div>;
  const breakdown = (title, section, rows, label) => <section className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><header className="flex justify-between gap-3"><h2 className="font-bold">{title}</h2>{exportButton(section)}</header>{table([tr(section === 'owners' ? 'owner' : 'source'), tr('count'), tr('won'), tr('lost'), tr('value'), tr('forecast')], rows.map(row => [label(row), number(row.count), number(row.won), number(row.lost), number(row.value), number(row.forecast)]))}</section>;
  return <section className="space-y-5" aria-busy={busy}>
    <p className="text-sm text-slate-500">{tr('cohortHint')}</p>
    <div className="flex flex-wrap items-end gap-3"><label>{tr('from')}<input type="date" className={`${input} block`} value={from} onInput={event => setFrom(event.currentTarget.value)} onChange={event => setFrom(event.target.value)} /></label><label>{tr('to')}<input type="date" className={`${input} block`} value={to} onInput={event => setTo(event.currentTarget.value)} onChange={event => setTo(event.target.value)} /></label><button className={button} disabled={busy} onClick={load}>{tr('refresh')}</button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {busy && <p role="status">{tr('loading')}</p>}
    {report && <>
      <p className="text-sm">{t('aiSupport.crm.reports.loadedRange', { from: report.from || tr('allTime'), to: report.to || tr('allTime') })}</p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{['count', 'open', 'won', 'lost', 'value', 'forecast'].map(key => <div key={key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-sm text-slate-500">{tr(key)}</p><strong className="text-xl">{number(report.summary[key])}</strong></div>)}</div>
      <p className="text-sm">{tr('winRate')}: {report.summary.win_rate == null ? '—' : `${number(report.summary.win_rate)}%`}. {tr('forecastHint')}</p>
      <section className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><header className="flex justify-between gap-3"><h2 className="font-bold">{tr('stages')}</h2>{exportButton('stages')}</header><p className="text-sm text-slate-500">{tr('conversionHint')}</p>{table([tr('stage'), tr('comparison'), tr('entered'), tr('current'), tr('conversion'), tr('value')], report.stages.map(row => [stageLabel(row), previousLabel(row), number(row.entered), number(row.current_count), row.conversion == null ? '—' : <span className="inline-flex items-center gap-2"><progress max={100} value={row.conversion} aria-label={`${stageLabel(row)} ${tr('conversion')}`} />{number(row.conversion)}%</span>, number(row.current_value)]))}</section>
      {breakdown(tr('owners'), 'owners', report.owners, ownerLabel)}
      {breakdown(tr('sourceTitle'), 'sources', report.sources, sourceLabel)}
      <section className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><header className="flex justify-between gap-3"><h2 className="font-bold">{tr('closingForecast')}</h2>{exportButton('forecast')}</header>{table([tr('month'), tr('count'), tr('value'), tr('forecast')], report.forecast.map(row => [row.month || tr('noClosing'), number(row.count), number(row.value), number(row.forecast)]))}</section>
    </>}
  </section>;
}
