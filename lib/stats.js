'use strict';
// Dashboard aggregates, answer formatting and CSV export.
const TZ = process.env.TZ_NAME || 'America/Sao_Paulo';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const dayKey = d => dayFmt.format(d instanceof Date ? d : new Date(d));

const answerable = schema => schema.perguntas.filter(q => q.tipo !== 'aviso');

function display(q, v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(' | ');
  if (typeof v === 'object') return `${v.cidade}/${v.uf}`;
  return String(v);
}

// Answers keyed by the stable "chave" (what webhooks and exports expose).
function keyed(schema, answers) {
  const out = {};
  for (const q of answerable(schema)) {
    if (answers[q.id] === undefined) continue;
    out[q.chave] = answers[q.id];
    if (answers[`${q.id}_outra`]) out[`${q.chave}_outra`] = answers[`${q.id}_outra`];
  }
  return out;
}

function sinceFor(days) {
  return days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : '';
}

function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function computeStats(form, responses, viewRows, days) {
  const schema = form.schema;
  const qs = answerable(schema);
  const started = responses.length;
  const completed = responses.filter(r => r.completed_at);
  const durations = completed.map(r => (Date.parse(r.completed_at) - Date.parse(r.started_at)) / 1000).filter(s => s >= 0 && s < 86400);

  const span = days > 0 ? days : Math.min(365, Math.max(14, responses.length ? Math.ceil((Date.now() - Date.parse(responses[responses.length - 1].started_at)) / 86400000) + 1 : 14));
  const series = [];
  const idx = new Map();
  for (let i = span - 1; i >= 0; i--) {
    const day = dayKey(Date.now() - i * 86400000);
    idx.set(day, series.length);
    series.push({ day, views: 0, started: 0, completed: 0 });
  }
  for (const v of viewRows) if (idx.has(v.day)) series[idx.get(v.day)].views = v.count;
  for (const r of responses) {
    const a = idx.get(dayKey(r.started_at)); if (a !== undefined) series[a].started++;
    if (r.completed_at) { const b = idx.get(dayKey(r.completed_at)); if (b !== undefined) series[b].completed++; }
  }
  const views = series.reduce((n, d) => n + d.views, 0);

  const funnel = [], questions = [];
  qs.forEach((q, i) => {
    const has = r => r.answers[q.id] !== undefined;
    const answered = responses.filter(has).length;
    funnel.push({ id: q.id, n: i + 1, rotulo: q.rotulo, answered });

    const item = { id: q.id, chave: q.chave, rotulo: q.rotulo, tipo: q.tipo, answered };
    const values = responses.filter(has).map(r => r.answers[q.id]);
    if (q.tipo === 'unica' || q.tipo === 'multipla' || q.tipo === 'sim_nao') {
      const opts = q.tipo === 'sim_nao' ? ['Sim', 'Não'] : [...q.opcoes, ...(q.outra ? ['Outra'] : [])];
      const count = new Map(opts.map(o => [o, 0]));
      for (const v of values) for (const o of Array.isArray(v) ? v : [v]) count.set(o, (count.get(o) || 0) + 1);
      item.dist = [...count].map(([label, n]) => ({ label, n }));
    } else if (q.tipo === 'escala') {
      const count = new Map();
      for (let n = q.min; n <= q.max; n++) count.set(n, 0);
      for (const v of values) count.set(v, (count.get(v) || 0) + 1);
      item.dist = [...count].map(([label, n]) => ({ label: String(label), n }));
      item.avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    } else if (q.tipo === 'numero') {
      item.avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      item.min = values.length ? Math.min(...values) : null;
      item.max = values.length ? Math.max(...values) : null;
    } else {
      item.latest = values.slice(0, 5).map(v => display(q, v));
    }
    questions.push(item);
  });

  return {
    days, views, started, completed: completed.length,
    rate: started ? completed.length / started : 0,
    median_seconds: Math.round(median(durations)),
    series, funnel, questions
  };
}

function toCsv(form, responses) {
  const qs = answerable(form.schema);
  const cols = [];
  for (const q of qs) {
    const label = q.rotulo.replace(/\*/g, '').replace(/\{[^}]+\}/g, '').trim() || q.chave;
    if (q.tipo === 'cidade_uf') cols.push([q, 'cidade', `${label} (cidade)`], [q, 'uf', `${label} (UF)`]);
    else { cols.push([q, 'v', label]); if (q.outra) cols.push([q, 'outra', `${label} (outra)`]); }
  }
  const metaKeys = [...new Set(responses.flatMap(r => Object.keys(r.meta || {})))];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'iniciado_em', 'concluido_em', 'status', ...cols.map(c => c[2]), ...metaKeys].map(esc).join(';');
  const rows = responses.map(r => [
    r.id, r.started_at, r.completed_at || '', r.completed_at ? 'completa' : 'parcial',
    ...cols.map(([q, part]) => {
      const v = r.answers[q.id];
      if (part === 'outra') return r.answers[`${q.id}_outra`];
      if (part === 'cidade' || part === 'uf') return v?.[part];
      return display(q, v);
    }),
    ...metaKeys.map(k => r.meta?.[k])
  ].map(esc).join(';'));
  return '﻿' + [header, ...rows].join('\r\n');
}

module.exports = { computeStats, toCsv, keyed, sinceFor, dayKey, display, answerable };
