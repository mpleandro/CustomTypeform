import { el, fill, api, toast, copy, TIPOS, fmtDate, fmtDay, fmtPct, fmtNum, fmtDur, formUrl, display, plain } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids.filter(Boolean));
  return n;
};
const niceMax = v => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 5, 10].find(k => k * p >= v) * p; };

function lineChart(series) {
  const W = 820, H = 230, pl = 40, pr = 10, pt = 10, pb = 26;
  const max = niceMax(Math.max(1, ...series.flatMap(d => [d.started, d.completed])));
  const n = series.length;
  const x = i => pl + (i * (W - pl - pr)) / Math.max(1, n - 1);
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  const path = key => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Respostas por dia' });
  for (const v of [0, max / 2, max]) {
    root.append(svg('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), style: 'stroke:var(--line)', 'stroke-width': 1 }),
      svg('text', { x: pl - 8, y: y(v) + 4, 'text-anchor': 'end', style: 'fill:var(--muted);font-size:11px' }, String(Math.round(v))));
  }
  const ticks = Math.min(6, n);
  for (let t = 0; t < ticks; t++) {
    const i = Math.round((t * (n - 1)) / Math.max(1, ticks - 1));
    root.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': t === 0 ? 'start' : t === ticks - 1 ? 'end' : 'middle', style: 'fill:var(--muted);font-size:11px' }, fmtDay(series[i].day)));
  }
  root.append(
    svg('path', { d: `${path('completed')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, style: 'fill:var(--accent);opacity:.12' }),
    svg('path', { d: path('started'), fill: 'none', style: 'stroke:var(--muted)', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'stroke-linejoin': 'round' }),
    svg('path', { d: path('completed'), fill: 'none', style: 'stroke:var(--accent)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  series.forEach((d, i) => root.append(svg('circle', { cx: x(i), cy: y(d.completed), r: Math.max(4, (W - pl) / n / 2), fill: 'transparent' },
    svg('title', {}, `${fmtDay(d.day)} · ${d.views} visualizações · ${d.started} iniciadas · ${d.completed} concluídas`))));
  return root;
}

export async function renderResults(id, { mount, shell, setCleanup }) {
  const { form } = await api('GET', `/forms/${id}`);
  const qs = form.schema.perguntas.filter(q => q.tipo !== 'aviso');
  const S = { tab: 'resumo', days: 30, status: 'all', search: '', page: 1, qview: 'active' };
  const body = el('div');
  const stamp = el('span', { class: 'hint' });
  let timer, searchTimer, alive = true;
  setCleanup(() => { alive = false; clearInterval(timer); clearTimeout(searchTimer); });

  const rangeSelect = el('select', { class: 'select range', 'aria-label': 'Período' },
    [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias'], [0, 'Todo o período']].map(([v, l]) => el('option', { value: v, text: l, selected: v === S.days })));
  rangeSelect.addEventListener('change', () => { S.days = Number(rangeSelect.value); S.page = 1; load(); renderHead(); });

  const head = el('div', { class: 'page-head' });
  const tabsEl = el('div', { class: 'tabs', style: 'margin-bottom:18px;width:fit-content' });

  function renderHead() {
    fill(head, 
      el('div', {},
        el('div', { class: 'row' }, el('h1', { text: form.titulo }), (() => { const p = { aberto: ['No ar', 'ok'], em_breve: ['Agendado', 'warn'], encerrado: ['Encerrado', 'err'], rascunho: ['Rascunho', ''] }[form.estado] || ['Rascunho', '']; return el('span', { class: `pill ${p[1]}`, text: p[0] }); })()),
        el('div', { class: 'row', style: 'margin-top:4px' }, el('span', { class: 'mono hint', text: `/f/${form.slug}` }),
          el('button', { class: 'btn ghost sm', onclick: () => copy(formUrl(form.slug)) }, 'Copiar link'), stamp)),
      el('div', { class: 'grow' }),
      rangeSelect,
      el('a', { class: 'btn', href: `/api/admin/forms/${id}/responses.csv?days=${S.days}`, download: '' }, 'Exportar CSV'),
      el('a', { class: 'btn', href: `#/forms/${id}` }, 'Editar'));
    fill(tabsEl, ...[['resumo', 'Resumo'], ['respostas', 'Respostas'], ['webhooks', 'Webhooks']].map(([k, label]) => el('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; S.page = 1; renderHead(); load(); }
    }, label)));
  }

  const kpi = (label, value, sub) => el('div', { class: 'card kpi' }, el('small', { text: label }), el('b', { text: value }), sub && el('span', { text: sub }));

  /* ----- summary ----- */
  async function loadSummary() {
    const { stats: s } = await api('GET', `/forms/${id}/stats?days=${S.days}`);
    const started = s.started || 1;
    // Abandonment per question: people who reached it (following their own route) and stopped there.
    const funnel = s.funnel.map(f => {
      const lost = f.reached ? f.abandoned / f.reached : 0;
      return el('div', { class: 'fn', title: `${f.reached} chegaram · ${f.answered} responderam · ${f.abandoned} pararam aqui` },
        el('span', { class: 'n', text: String(f.n) }),
        el('span', { class: 'q' }, plain(f.rotulo) || 'Sem título', el('span', { class: 'muted', text: ` · ${fmtNum(f.reached)} chegaram` })),
        el('div', { class: 'bar' }, el('i', { style: `width:${(f.answered / started) * 100}%` })),
        el('span', { class: `drop${lost >= .2 && f.reached >= 5 ? ' hi' : ''}`, text: f.abandoned ? `−${fmtPct(lost)}` : '—' }));
    });
    if (s.abandoned_at_submit) funnel.push(el('div', { class: 'fn' }, el('span', { class: 'n', text: '↗' }), el('span', { class: 'q', text: 'Envio (última etapa)' }), el('div', { class: 'bar' }), el('span', { class: 'drop hi', text: fmtNum(s.abandoned_at_submit) })));

    const card = (q, past) => {
      const body = el('div');
      if (q.dist) {
        const top = Math.max(1, ...q.dist.map(d => d.n));
        body.append(el('div', { class: 'dist' }, q.dist.map(d => el('div', { class: 'd' },
          el('span', { text: q.tipo === 'escala' && q.estilo !== 'numeros' ? (q.estilo === 'emojis' ? `${window.CtfRoute.emojis[q.max]?.[Number(d.label) - 1] || ''} ${d.label}` : `${d.label} ★`) : d.label }), el('b', { text: `${fmtNum(d.n)}${q.answered ? ` · ${fmtPct(d.n / q.answered)}` : ''}` }),
          el('div', { class: 'bar' }, el('i', { style: `width:${(d.n / top) * 100}%` }))))));
      }
      if (q.avg !== undefined && q.avg !== null) body.append(el('p', { style: 'margin:12px 0 0;font-weight:600', text: q.tipo === 'numero' ? `Média ${q.avg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} · mín ${q.min} · máx ${q.max}` : `Média ${q.avg.toFixed(2).replace('.', ',')}` }));
      if (q.latest) body.append(q.latest.length ? el('ul', { class: 'latest' }, q.latest.map(t => el('li', { text: t, title: t }))) : el('p', { class: 'hint', style: 'margin-top:12px', text: 'Sem respostas ainda.' }));
      return el('div', { class: 'card qcard' },
        el('h3', { text: `${q.n}. ${plain(q.rotulo) || 'Sem título'}` }),
        el('p', { class: 'hint', text: `${TIPOS[q.tipo].nome} · ${fmtNum(q.answered)} resposta${q.answered === 1 ? '' : 's'}${past ? ` · removida em ${fmtDate(q.removida_em).slice(0, 10)}` : ''}` }), body);
    };

    const view = S.qview === 'past' && s.archived.length ? 'past' : 'active';
    const qtab = (k, label, n) => el('button', { class: 'tab', role: 'tab', 'aria-selected': String(view === k), onclick: () => { S.qview = k; load(); } }, `${label} (${fmtNum(n)})`);

    fill(body,
      el('div', { class: 'kpis' },
        kpi('Visualizações', fmtNum(s.views)),
        kpi('Iniciaram', fmtNum(s.started), s.views ? `${fmtPct(Math.min(1, s.started / s.views))} das visualizações` : undefined),
        kpi('Concluíram', fmtNum(s.completed), s.started - s.completed ? `${fmtNum(s.started - s.completed)} abandonaram` : undefined),
        kpi('Taxa de conclusão', s.started ? fmtPct(s.rate) : '—'),
        kpi('Tempo mediano', fmtDur(s.median_seconds), 'para concluir'),
        kpi('Respostas ativas', fmtNum(s.answers_active), 'em perguntas que estão no formulário'),
        kpi('Respostas passadas', fmtNum(s.answers_past), 'em perguntas removidas')),
      el('div', { class: 'card chart', style: 'margin-bottom:22px' },
        el('div', { class: 'legend' },
          el('span', {}, el('i', { style: 'background:var(--muted)' }), 'Iniciadas'), el('span', {}, el('i', { style: 'background:var(--accent)' }), 'Concluídas')),
        lineChart(s.series)),
      el('h2', { style: 'font-size:16px;margin:0 0 10px', text: 'Funil por pergunta' }),
      el('p', { class: 'hint', style: 'margin:0 0 10px', text: 'A barra mostra quantas pessoas responderam. A coluna da direita é o abandono: de quem chegou à pergunta (pela própria rota, com os saltos), quantos pararam ali. Em vermelho: 20% ou mais.' }),
      s.funnel.length ? el('div', { class: 'card funnel', style: 'margin-bottom:22px' }, funnel) : el('div', { class: 'card empty', text: 'Este formulário ainda não tem perguntas.' }),
      el('h2', { style: 'font-size:16px;margin:0 0 10px', text: 'Respostas por pergunta' }),
      el('div', { class: 'tabs', style: 'margin-bottom:14px;width:fit-content' }, qtab('active', 'Ativas', s.answers_active), qtab('past', 'Passadas', s.answers_past)),
      view === 'past' && el('p', { class: 'past-note', text: 'Perguntas que foram removidas do formulário. As respostas dadas a elas continuam guardadas e aparecem aqui e na exportação CSV.' }),
      view === 'active'
        ? el('div', { class: 'qgrid' }, s.questions.map(q => card(q, false)))
        : el('div', { class: 'qgrid' }, s.archived.map(q => card(q, true))));
  }

  /* ----- responses ----- */
  async function loadResponses() {
    const q = new URLSearchParams({ status: S.status, q: S.search, page: S.page, limit: 25, days: S.days });
    const data = await api('GET', `/forms/${id}/responses?${q}`);
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    const cols = qs.slice(0, 3);
    const statusSel = el('select', { class: 'select', style: 'width:auto' }, [['all', 'Todas'], ['completed', 'Completas'], ['partial', 'Parciais (abandonadas)']].map(([v, l]) => el('option', { value: v, text: l, selected: v === S.status })));
    statusSel.addEventListener('change', () => { S.status = statusSel.value; S.page = 1; load(); });
    const search = el('input', { class: 'input', style: 'max-width:260px', placeholder: 'Buscar nas respostas…', value: S.search });
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.search = search.value.trim(); S.page = 1; load(); }, 350); });

    const stoppedAt = r => { const i = form.schema.perguntas.findIndex(x => x.id === r.last_qid); return i >= 0 ? `Última resposta: pergunta ${i + 1}` : 'Sem respostas'; };
    const rows = data.respostas.map(r => el('tr', { onclick: () => openDrawer(r) },
      el('td', { class: 'mono', text: fmtDate(r.started_at) }),
      el('td', {}, r.completed_at ? el('span', { class: 'pill ok', text: 'Completa' }) : el('span', { class: 'pill warn', title: stoppedAt(r), text: 'Parcial' })),
      cols.map(c => el('td', { title: display(r.answers[c.id]), text: display(r.answers[c.id]) || '—' })),
      el('td', { class: 'muted', text: '›' })));

    fill(body, 
      el('div', { class: 'row wrap', style: 'margin-bottom:12px' }, statusSel, search, el('div', { class: 'grow' }), el('span', { class: 'muted', text: `${fmtNum(data.total)} resposta${data.total === 1 ? '' : 's'}` })),
      el('div', { class: 'card table-wrap' }, data.respostas.length
        ? el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Iniciada em' }), el('th', { text: 'Status' }), cols.map(c => el('th', { text: plain(c.rotulo).slice(0, 40) || c.chave })), el('th'))), el('tbody', {}, rows))
        : el('div', { class: 'empty', text: S.search || S.status !== 'all' ? 'Nada encontrado com esses filtros.' : 'Nenhuma resposta neste período.' })),
      pages > 1 && el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' },
        el('button', { class: 'btn sm', disabled: S.page <= 1, onclick: () => { S.page--; load(); } }, '← Anterior'),
        el('span', { class: 'muted', text: `Página ${S.page} de ${pages}` }),
        el('button', { class: 'btn sm', disabled: S.page >= pages, onclick: () => { S.page++; load(); } }, 'Próxima →')));
    if (S.search && document.activeElement === document.body) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }

  function openDrawer(r) {
    const route = new Set(window.CtfRoute.visited(form.schema.perguntas, r.answers).map(i => form.schema.perguntas[i].id));
    const past = (form.schema.arquivadas || []).filter(q => r.answers[q.id] !== undefined);
    const close = () => { bg.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const bg = el('div', { class: 'drawer-bg', onclick: close });
    const drawer = el('aside', { class: 'drawer' },
      el('div', { class: 'row', style: 'margin-bottom:6px' }, el('h2', { class: 'grow', text: 'Resposta' }), el('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Fechar' }, '✕')),
      el('div', { class: 'row wrap', style: 'margin-bottom:10px' },
        r.completed_at ? el('span', { class: 'pill ok', text: 'Completa' }) : el('span', { class: 'pill warn', text: 'Parcial' }),
        el('span', { class: 'muted mono', text: fmtDate(r.started_at) })),
      form.schema.perguntas.map((q, pos) => {
        if (q.tipo === 'aviso') return null;
        const v = display(r.answers[q.id]);
        const other = r.answers[`${q.id}_outra`];
        const skipped = !route.has(q.id) && !v;
        return el('div', { class: 'qa' }, el('small', { text: `${pos + 1}. ${plain(q.rotulo) || q.chave}` }),
          el('div', { class: v ? '' : 'muted', text: v ? (other ? `${v}: ${other}` : v) : skipped ? '— pulada pela navegação' : '—' }));
      }),
      past.length > 0 && el('div', { class: 'qa' }, el('small', { text: 'Respostas passadas (perguntas removidas)' }),
        past.map(q => el('div', { style: 'margin:8px 0 0' }, el('small', { text: plain(q.rotulo) || q.chave }), el('div', { text: display(r.answers[q.id]) })))),
      Object.keys(r.meta || {}).length > 0 && el('div', { class: 'qa' }, el('small', { text: 'Rastreio' }), el('div', { class: 'mono', style: 'font-size:12px' }, Object.entries(r.meta).map(([k, v]) => el('div', { text: `${k}: ${v}` })))),
      el('div', { class: 'qa' }, el('small', { text: 'ID' }), el('div', { class: 'mono muted', style: 'font-size:12px', text: r.id })),
      el('button', {
        class: 'btn danger', style: 'margin-top:12px',
        async onclick() {
          if (!confirm('Excluir esta resposta?')) return;
          await api('DELETE', `/forms/${id}/responses/${r.id}`); close(); toast('Resposta excluída'); load();
        }
      }, 'Excluir resposta'));
    document.addEventListener('keydown', onKey);
    document.body.append(bg, drawer);
  }

  /* ----- webhooks ----- */
  async function loadWebhooks() {
    const { logs } = await api('GET', `/forms/${id}/webhook-logs`);
    const label = l => {
      if (l.event.endsWith('.test')) return 'Teste';
      if (l.event === 'form.completed') return 'Formulário concluído';
      const q = form.schema.perguntas.find(x => x.id === l.question_id);
      return q ? `Pergunta: ${plain(q.rotulo).slice(0, 40) || q.chave}` : l.event;
    };
    fill(body, logs.length
      ? el('div', { class: 'card table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Quando', 'Evento', 'Destino', 'Resultado', 'Tentativa', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, logs.map(l => el('tr', { style: 'cursor:default' },
          el('td', { class: 'mono', text: fmtDate(l.at) }), el('td', { text: label(l) }), el('td', { class: 'mono', title: l.url, text: l.url }),
          el('td', {}, el('span', { class: `pill ${l.ok ? 'ok' : 'err'}`, text: l.ok ? `OK · ${l.status}` : l.error || 'Falhou' })),
          el('td', { text: `${l.attempt}${l.duration_ms != null ? ` · ${l.duration_ms}ms` : ''}` }),
          el('td', {}, !l.event.endsWith('.test') && !l.ok && el('button', {
            class: 'btn sm',
            async onclick(e) {
              e.target.disabled = true;
              try { const { resultado: r } = await api('POST', `/forms/${id}/webhook-logs/${l.id}/retry`); toast(r.ok ? 'Reenviado com sucesso' : `Falhou de novo: ${r.error}`, r.ok ? 'ok' : 'err'); } catch (err) { toast(err.message, 'err'); }
              load();
            }
          }, 'Reenviar')))))))
      : el('div', { class: 'card empty' }, el('h3', { text: 'Nenhum webhook disparado ainda' }), el('p', { text: 'Configure webhooks por pergunta no editor ou o webhook de conclusão em Ajustes.' })));
  }

  async function load() {
    try {
      if (S.tab === 'resumo') await loadSummary();
      else if (S.tab === 'respostas') await loadResponses();
      else await loadWebhooks();
      if (alive) stamp.textContent = `· Atualizado às ${new Date().toTimeString().slice(0, 5)} (ao vivo)`;
    } catch (e) { if (alive) fill(body, el('div', { class: 'notice err', text: e.message })); }
  }

  renderHead();
  mount(shell(el('div', {}, head, tabsEl, body)));
  await load();
  // Keeps the dashboard live while the page is open (skipped while typing in the search box).
  timer = setInterval(() => { if (!document.hidden && document.activeElement?.tagName !== 'INPUT') load(); }, 20000);
}
