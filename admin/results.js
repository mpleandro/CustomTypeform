import { el, fill, api, toast, copy, fmtDate, fmtDay, fmtPct, fmtNum, fmtDur, formUrl, display, showAnswer, money, plain, icon, statusPill, TIPOS } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids.filter(Boolean));
  return n;
};
const niceMax = v => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 5, 10].find(k => k * p >= v) * p; };

function lineChart(series) {
  const W = 820, H = 200, pl = 32, pr = 8, pt = 10, pb = 26;
  const max = niceMax(Math.max(1, ...series.flatMap(d => [d.started, d.completed])));
  const n = series.length;
  const x = i => pl + (i * (W - pl - pr)) / Math.max(1, n - 1);
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  const path = key => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Respostas por dia' });
  root.append(svg('defs', {}, svg('linearGradient', { id: 'ctf-area', x1: 0, x2: 0, y1: 0, y2: 1 },
    svg('stop', { offset: '0%', style: 'stop-color:var(--accent);stop-opacity:.18' }), svg('stop', { offset: '100%', style: 'stop-color:var(--accent);stop-opacity:0' }))));
  for (const v of [0, max / 2, max]) {
    root.append(svg('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), style: 'stroke:var(--line)', 'stroke-width': 1, 'stroke-dasharray': v ? '2 4' : '' }),
      svg('text', { x: pl - 10, y: y(v) + 4, 'text-anchor': 'end', style: 'fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums' }, String(Math.round(v))));
  }
  const ticks = Math.min(6, n);
  for (let t = 0; t < ticks; t++) {
    const i = Math.round((t * (n - 1)) / Math.max(1, ticks - 1));
    root.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': t === 0 ? 'start' : t === ticks - 1 ? 'end' : 'middle', style: 'fill:var(--muted);font-size:11px' }, fmtDay(series[i].day)));
  }
  root.append(
    svg('path', { d: `${path('completed')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: 'url(#ctf-area)' }),
    svg('path', { d: path('started'), fill: 'none', style: 'stroke:var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'stroke-linejoin': 'round', opacity: .7 }),
    svg('path', { d: path('completed'), fill: 'none', style: 'stroke:var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  series.forEach((d, i) => root.append(svg('circle', { cx: x(i), cy: y(d.completed), r: Math.max(4, (W - pl) / n / 2), fill: 'transparent' },
    svg('title', {}, `${fmtDay(d.day)} · ${d.views} visualizações · ${d.started} iniciadas · ${d.completed} concluídas`))));
  return root;
}

export async function renderResults(id, { mount, shell, setCleanup }) {
  const { form } = await api('GET', `/forms/${id}`);
  const qs = form.schema.perguntas.filter(q => q.tipo !== 'aviso');
  const S = { tab: 'resumo', days: 30, status: 'all', search: '', page: 1, qview: 'active' };
  const body = el('div');
  const stamp = el('span', { class: 'live' });
  let timer, searchTimer, alive = true;
  setCleanup(() => { alive = false; clearInterval(timer); clearTimeout(searchTimer); });

  const rangeSelect = el('select', { class: 'select range', 'aria-label': 'Período' },
    [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias'], [0, 'Todo o período']].map(([v, l]) => el('option', { value: v, text: l, selected: v === S.days })));
  rangeSelect.addEventListener('change', () => { S.days = Number(rangeSelect.value); S.page = 1; load(); renderHead(); });

  const head = el('div');
  const tabsEl = el('div', { class: 'tabs', role: 'tablist' });

  function renderHead() {
    fill(head,
      el('a', { class: 'crumb', href: '#/' }, icon('back', 15), 'Formulários'),
      el('div', { class: 'res-head' },
        el('div', { style: 'min-width:0' },
          el('div', { class: 'row wrap' }, el('h1', { text: form.titulo }), statusPill(form.estado)),
          el('div', { class: 'meta' }, el('span', { class: 'mono', text: `/f/${form.slug}` }),
            el('button', { class: 'icon-btn', style: 'width:26px;height:26px', title: 'Copiar link', 'aria-label': 'Copiar link', onclick: () => copy(formUrl(form.slug)) }, icon('copy', 14)),
            stamp)),
        el('div', { class: 'res-tools' },
          rangeSelect,
          el('a', { class: 'btn', href: `/api/admin/forms/${id}/responses.csv?days=${S.days}`, download: '' }, icon('download', 15), 'CSV'),
          el('a', { class: 'btn primary', href: `#/forms/${id}` }, icon('pencil', 14), 'Editar'))),
      el('div', { class: 'tabbar' }, tabsEl));
    fill(tabsEl, ...[['resumo', 'Resumo'], ['respostas', 'Respostas'], ['webhooks', 'Integrações']].map(([k, label]) => el('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; S.page = 1; renderHead(); load(); }
    }, label)));
  }

  const kpi = (label, value, sub, hero) => el('div', { class: `stat${hero ? ' hero' : ''}` }, el('small', { text: label }), el('b', { text: value }), sub && el('span', { text: sub }));

  /* ----- summary ----- */
  async function loadSummary() {
    const { stats: s } = await api('GET', `/forms/${id}/stats?days=${S.days}`);
    const started = s.started || 1;
    // Abandonment per question: people who reached it (following their own route) and stopped there.
    const funnel = s.funnel.map(f => {
      const lost = f.reached ? f.abandoned / f.reached : 0;
      return el('div', { class: 'fn', title: `${f.reached} chegaram · ${f.answered} responderam · ${f.abandoned} pararam aqui` },
        el('span', { class: 'n', text: String(f.n) }),
        el('span', { class: 'q' }, plain(f.rotulo) || 'Sem título', el('span', { class: 'muted', text: ` · ${fmtNum(f.reached)}` })),
        el('div', { class: 'bar' }, el('i', { style: `width:${(f.answered / started) * 100}%` })),
        el('span', { class: `drop${lost >= .2 && f.reached >= 5 ? ' hi' : ''}`, text: f.abandoned ? `−${fmtPct(lost)}` : '—' }));
    });
    if (s.abandoned_at_submit) funnel.push(el('div', { class: 'fn' }, el('span', { class: 'n' }, icon('send', 13)), el('span', { class: 'q', text: 'Envio' }), el('div', { class: 'bar' }), el('span', { class: 'drop hi', text: fmtNum(s.abandoned_at_submit) })));

    const card = (q, past) => {
      const body = el('div');
      if (q.dist) {
        const top = Math.max(1, ...q.dist.map(d => d.n));
        body.append(el('div', { class: 'dist' }, q.dist.map(d => el('div', { class: 'd' },
          el('span', { text: q.tipo === 'escala' && q.estilo !== 'numeros' ? (q.estilo === 'emojis' ? `${window.CtfRoute.emojis[q.max]?.[Number(d.label) - 1] || ''} ${d.label}` : `${d.label} ★`) : d.label }), el('b', {}, q.answered ? fmtPct(d.n / q.answered) : '—', el('small', { text: fmtNum(d.n) })),
          el('div', { class: 'bar' }, el('i', { style: `width:${(d.n / top) * 100}%` }))))));
      }
      // Matrix: one distribution per row (statement).
      if (q.linhas) body.append(el('div', { class: 'dist' }, q.linhas.map(l => el('div', { class: 'mx-row' }, el('small', { text: l.label }),
        l.dist.map(d => el('div', { class: 'd' }, el('span', { text: d.label }), el('b', {}, q.answered ? fmtPct(d.n / q.answered) : '—', el('small', { text: fmtNum(d.n) })),
          el('div', { class: 'bar' }, el('i', { style: `width:${(d.n / Math.max(1, ...l.dist.map(x => x.n))) * 100}%` }))))))));
      if (q.avg !== undefined && q.avg !== null) body.append(el('div', { class: 'avg' }, el('b', { text: q.formato === 'moeda' ? money(q.moeda, q.avg) : q.avg.toLocaleString('pt-BR', { maximumFractionDigits: q.tipo === 'numero' ? 2 : 1 }) }), el('span', { text: q.tipo === 'numero' ? `média · mín ${q.formato === 'moeda' ? money(q.moeda, q.min) : q.min} · máx ${q.formato === 'moeda' ? money(q.moeda, q.max) : q.max}` : 'média' })));
      if (q.latest) body.append(q.latest.length ? el('ul', { class: 'latest' }, q.latest.map(t => el('li', { text: t, title: t }))) : el('p', { class: 'hint', style: 'margin-top:12px', text: 'Sem respostas ainda.' }));
      return el('div', { class: 'card qcard' },
        el('h3', { text: `${q.n}. ${plain(q.rotulo) || 'Sem título'}` }),
        el('p', { class: 'hint', text: `${TIPOS[q.tipo]?.nome || ''} · ${fmtNum(q.answered)} resposta${q.answered === 1 ? '' : 's'}${past ? ` · removida em ${fmtDate(q.removida_em).slice(0, 10)}` : ''}` }), body);
    };

    const view = S.qview === 'past' && s.archived.length ? 'past' : 'active';
    const qtab = (k, label, n) => el('button', { class: 'tab', role: 'tab', 'aria-selected': String(view === k), onclick: () => { S.qview = k; load(); } }, label, el('span', { class: 'count', text: fmtNum(n) }));

    fill(body,
      el('div', { class: 'stats' },
        kpi('Taxa de conclusão', s.started ? fmtPct(s.rate) : '—', s.started ? `${fmtNum(s.completed)} de ${fmtNum(s.started)} concluíram` : 'Ainda sem respostas', true),
        kpi('Iniciaram', fmtNum(s.started), s.views ? `${fmtPct(Math.min(1, s.started / s.views))} de quem abriu` : undefined),
        kpi('Visualizações', fmtNum(s.views)),
        kpi('Tempo médio', fmtDur(s.median_seconds), s.median_seconds ? 'para concluir' : undefined)),
      el('div', { class: 'card chart' },
        el('div', { class: 'chart-head' }, el('h3', { text: 'Respostas por dia' }),
          el('div', { class: 'legend' },
            el('span', {}, el('i', { class: 'dash' }), 'Iniciadas'), el('span', {}, el('i', { style: 'background:var(--accent)' }), 'Concluídas'))),
        lineChart(s.series)),
      el('div', { class: 'block-title' }, el('h2', { text: 'Onde as pessoas param' }), el('span', { text: 'por pergunta' })),
      s.funnel.length ? el('div', { class: 'card funnel' }, funnel) : el('div', { class: 'card empty', text: 'Este formulário ainda não tem perguntas.' }),
      el('div', { class: 'block-title' }, el('h2', { text: 'Respostas por pergunta' }),
        s.archived.length > 0 && el('div', { class: 'tabs', style: 'margin-left:auto' }, qtab('active', 'Atuais', s.answers_active), qtab('past', 'Removidas', s.answers_past))),
      view === 'past' && el('p', { class: 'past-note', text: 'Respostas de perguntas que você excluiu. Também saem no CSV.' }),
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
    const statusSel = el('select', { class: 'select', style: 'width:auto;height:34px', 'aria-label': 'Filtrar' }, [['all', 'Todas'], ['completed', 'Completas'], ['partial', 'Incompletas']].map(([v, l]) => el('option', { value: v, text: l, selected: v === S.status })));
    statusSel.addEventListener('change', () => { S.status = statusSel.value; S.page = 1; load(); });
    const search = el('input', { class: 'input', type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar nas respostas', value: S.search });
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.search = search.value.trim(); S.page = 1; load(); }, 350); });

    const stoppedAt = r => { const i = form.schema.perguntas.findIndex(x => x.id === r.last_qid); return i >= 0 ? `Parou na pergunta ${i + 1}` : 'Sem respostas'; };
    const rows = data.respostas.map(r => el('tr', { onclick: () => openDrawer(r) },
      el('td', { class: 'when', text: fmtDate(r.started_at) }),
      el('td', {}, r.completed_at ? el('span', { class: 'pill ok', text: 'Completa' }) : el('span', { class: 'pill warn', title: stoppedAt(r), text: 'Incompleta' })),
      cols.map(c => el('td', { title: showAnswer(c, r.answers[c.id]), text: showAnswer(c, r.answers[c.id]) || '—' })),
      el('td', { class: 'go' }, icon('right', 15))));

    fill(body, 
      el('div', { class: 'toolbar' }, el('label', { class: 'search' }, icon('search', 15), search), statusSel, el('div', { class: 'grow' }), el('span', { class: 'muted num', text: `${fmtNum(data.total)} resposta${data.total === 1 ? '' : 's'}` })),
      el('div', { class: 'card table-wrap' }, data.respostas.length
        ? el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Data' }), el('th', { text: 'Status' }), cols.map(c => el('th', { text: plain(c.rotulo).slice(0, 40) || c.chave })), el('th'))), el('tbody', {}, rows))
        : el('div', { class: 'empty' }, icon(S.search || S.status !== 'all' ? 'search' : 'file', 28), el('p', { style: 'margin:0', text: S.search || S.status !== 'all' ? 'Nada encontrado com esses filtros.' : 'Nenhuma resposta neste período.' }))),
      pages > 1 && el('div', { class: 'pager' },
        el('button', { class: 'btn sm icon', 'aria-label': 'Página anterior', disabled: S.page <= 1, onclick: () => { S.page--; load(); } }, icon('back', 15)),
        el('span', { class: 'num', text: `${S.page} de ${pages}` }),
        el('button', { class: 'btn sm icon', 'aria-label': 'Próxima página', disabled: S.page >= pages, onclick: () => { S.page++; load(); } }, icon('right', 15))));
    if (S.search && document.activeElement === document.body) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }

  function openDrawer(r) {
    const route = new Set(window.CtfRoute.visited(form.schema.perguntas, r.answers).map(i => form.schema.perguntas[i].id));
    const past = (form.schema.arquivadas || []).filter(q => r.answers[q.id] !== undefined);
    const close = () => { bg.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const bg = el('div', { class: 'drawer-bg', onclick: close });
    const drawer = el('aside', { class: 'drawer' },
      el('div', { class: 'row', style: 'margin-bottom:8px' }, el('h2', { class: 'grow', text: 'Resposta' }), el('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Fechar' }, icon('x', 18))),
      el('div', { class: 'row wrap', style: 'margin-bottom:12px' },
        r.completed_at ? el('span', { class: 'pill ok', text: 'Completa' }) : el('span', { class: 'pill warn', text: 'Incompleta' }),
        el('span', { class: 'muted num', text: fmtDate(r.started_at) })),
      form.schema.perguntas.map((q, pos) => {
        if (q.tipo === 'aviso') return null;
        const v = showAnswer(q, r.answers[q.id]);
        const other = r.answers[`${q.id}_outra`];
        const skipped = !route.has(q.id) && !v;
        return el('div', { class: `qa${skipped ? ' skip' : ''}` }, el('small', { text: `${pos + 1}. ${plain(q.rotulo) || q.chave}` }),
          el('div', { class: v ? '' : 'muted', text: v ? (other ? `${v}: ${other}` : v) : skipped ? 'Pulada' : '—' }));
      }),
      past.length > 0 && el('div', { class: 'qa' }, el('small', { text: 'Perguntas removidas' }),
        past.map(q => el('div', { style: 'margin:8px 0 0' }, el('small', { text: plain(q.rotulo) || q.chave }), el('div', { text: display(r.answers[q.id]) })))),
      r.answers._consentimento !== undefined && el('div', { class: 'qa' }, el('small', { text: 'Consentimento (LGPD)' }), el('div', { text: r.answers._consentimento ? 'Sim, autorizou' : 'Não autorizou' })),
      r.answers._pontuacao && el('div', { class: 'qa' }, el('small', { text: 'Pontuação' }),
        el('div', { text: `${Object.entries(r.answers._pontuacao.pontos || {}).map(([k, n]) => `${k}: ${n}`).join(' · ')}${(r.answers._pontuacao.tags || []).length ? ` · tag: ${r.answers._pontuacao.tags.join(', ')}` : ''} → resultado: ${r.answers._pontuacao.resultado || '—'}` })),
      Object.keys(r.meta || {}).length > 0 && el('div', { class: 'qa' }, el('small', { text: 'Origem (UTM)' }), el('div', { class: 'mono', style: 'font-size:12px' }, Object.entries(r.meta).map(([k, v]) => el('div', { text: `${k}: ${v}` })))),
      el('div', { class: 'qa' }, el('small', { text: 'Código' }), el('div', { class: 'mono muted', style: 'font-size:12px', text: r.id })),
      el('button', {
        class: 'btn danger', style: 'margin-top:16px',
        async onclick() {
          if (!confirm('Excluir esta resposta?')) return;
          await api('DELETE', `/forms/${id}/responses/${r.id}`); close(); toast('Resposta excluída'); load();
        }
      }, icon('trash', 15), 'Excluir resposta'));
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
      return q ? `Pergunta ${form.schema.perguntas.indexOf(q) + 1}` : l.event;
    };
    fill(body, logs.length
      ? el('div', { class: 'card table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Data', 'Gatilho', 'Destino', 'Resultado', 'Tentativa', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, logs.map(l => el('tr', { style: 'cursor:default' },
          el('td', { class: 'when', text: fmtDate(l.at) }), el('td', { text: label(l) }), el('td', { class: 'muted', title: l.url, text: l.url.replace(/^https?:\/\//, '') }),
          el('td', {}, el('span', { class: `pill ${l.ok ? 'ok' : 'err'}`, title: l.ok ? `HTTP ${l.status}` : l.error || '', text: l.ok ? 'Entregue' : 'Falhou' })),
          el('td', { text: `${l.attempt}${l.duration_ms != null ? ` · ${l.duration_ms}ms` : ''}` }),
          el('td', {}, !l.event.endsWith('.test') && !l.ok && el('button', {
            class: 'btn sm',
            async onclick(e) {
              e.target.disabled = true;
              try { const { resultado: r } = await api('POST', `/forms/${id}/webhook-logs/${l.id}/retry`); toast(r.ok ? 'Reenviado com sucesso' : `Falhou de novo: ${r.error}`, r.ok ? 'ok' : 'err'); } catch (err) { toast(err.message, 'err'); }
              load();
            }
          }, icon('refresh', 14), 'Reenviar')))))))
      : el('div', { class: 'card empty' }, icon('zap', 28), el('h3', { text: 'Nenhum envio ainda' }), el('p', { text: 'Conecte outro sistema em Editar › Ajustes › Integrações.' }),
        el('a', { class: 'btn', href: `#/forms/${id}` }, 'Configurar')));
  }

  async function load() {
    try {
      if (S.tab === 'resumo') await loadSummary();
      else if (S.tab === 'respostas') await loadResponses();
      else await loadWebhooks();
      if (alive) { stamp.textContent = `Ao vivo · ${new Date().toTimeString().slice(0, 5)}`; stamp.title = 'Atualiza sozinho a cada 20 segundos'; }
    } catch (e) { if (alive) fill(body, el('div', { class: 'notice err', text: e.message })); }
  }

  renderHead();
  mount(shell(el('div', {}, head, body)));
  await load();
  // Keeps the dashboard live while the page is open (skipped while typing in the search box).
  timer = setInterval(() => { if (!document.hidden && document.activeElement?.tagName !== 'INPUT') load(); }, 20000);
}
