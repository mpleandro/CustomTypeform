import { el, fill, api, toast, copy, TIPOS, formUrl, plain, fmtDate } from './ui.js';

const CHOICE = ['unica', 'multipla', 'dropdown'];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO','Exterior'];
const TEXTLIKE = ['texto', 'longo', 'email', 'telefone', 'numero', 'url'];
const PRESETS = [
  { nome: 'BALF 360', fundo: '#070708', texto: '#f2f2f2', destaque: '#ff5c00', destaque2: '#cc8400' },
  { nome: 'Escuro', fundo: '#0b0b0f', texto: '#f5f5f7', destaque: '#6366f1', destaque2: '#22d3ee' },
  { nome: 'Claro', fundo: '#ffffff', texto: '#18181b', destaque: '#4f46e5', destaque2: '#9333ea' },
  { nome: 'Ignis', fundo: '#080808', texto: '#f7f5ef', destaque: '#ff6b1a', destaque2: '#ffb347' },
  { nome: 'Oceano', fundo: '#06141f', texto: '#eaf6ff', destaque: '#22d3ee', destaque2: '#3b82f6' },
  { nome: 'Floresta', fundo: '#0e1a14', texto: '#eef7f0', destaque: '#34d399', destaque2: '#a3e635' },
  { nome: 'Papel', fundo: '#faf6ee', texto: '#2a2118', destaque: '#c2410c', destaque2: '#b45309' }
];
const FONTS = ['Inter', 'Manrope', 'DM Sans', 'Poppins', 'Montserrat', 'Space Grotesk', 'Sora', 'Outfit', 'Playfair Display', 'Lora'];
const TOKENS_HINT = 'Use *palavra* para destacar na cor do tema e {chave} para citar uma resposta anterior (ex.: {primeiro_nome}).';

const branchValuesOf = q => (q.tipo === 'unica' ? [...q.opcoes.filter(Boolean), ...(q.outra ? ['Outra'] : [])]
  : q.tipo === 'dropdown' ? q.opcoes.filter(Boolean)
  : q.tipo === 'sim_nao' ? ['Sim', 'Não']
  : q.tipo === 'escala' ? Array.from({ length: q.max - q.min + 1 }, (_, k) => String(q.min + k)) : []);
const faceFor = (q, n) => (q.estilo === 'emojis' ? `${window.CtfRoute.emojis[q.max]?.[n - 1] || ''} ${n}` : q.estilo === 'estrelas' ? `${n} ★` : String(n));
const newId = () => `q${Math.random().toString(16).slice(2, 10)}`;
const slugKey = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const slugUrl = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 60);

export async function renderEditor(id, { mount, setCleanup }) {
  const { form } = await api('GET', `/forms/${id}`);
  const S = {
    titulo: form.titulo, slug: form.slug, status: form.status, schema: form.schema,
    tab: 'conteudo', sel: form.schema.boas_vindas.ativo || !form.schema.perguntas.length ? 'welcome' : form.schema.perguntas[0].id,
    problemas: [], slugErro: '', mobile: false, opened: !!form.aberto_em, previewSub: 'closed'
  };
  // Questions already saved once the form was opened can't change type (past answers would stop making sense).
  let savedIds = new Set(form.schema.perguntas.map(q => q.id));
  const isLocked = q => S.opened && savedIds.has(q.id);
  const sch = () => S.schema;

  /* ----- saving ----- */
  const stateEl = el('span', { class: 'save-state', text: 'Salvo' });
  let saving = null, pending = false, dirty = false;

  function touch() {
    dirty = true;
    stateEl.textContent = S.status === 'draft' ? 'Alterações não salvas' : 'Alterações não publicadas';
    stateEl.classList.add('dirty');
    sendPreview();
    syncSaveBtn();
  }

  async function save() {
    if (saving) { pending = true; return saving; }
    saving = (async () => {
      stateEl.textContent = 'Salvando…';
      try {
        await api('PUT', `/forms/${id}`, { titulo: S.titulo, slug: S.slug, status: S.status, schema: sch() });
        dirty = false; S.slugErro = ''; stateEl.textContent = 'Salvo'; stateEl.classList.remove('dirty');
        if (S.status !== 'draft') S.opened = true;
        savedIds = new Set(sch().perguntas.map(q => q.id));
        syncSaveBtn();
        if (S.problemas.length) { S.problemas = []; renderPanel(); }
        return true;
      } catch (e) {
        stateEl.textContent = 'Erro ao salvar';
        if (e.data?.campo === 'slug') { S.slugErro = e.message; S.tab = 'ajustes'; syncTabs(); }
        else if (e.data?.problemas) { S.problemas = e.data.problemas; }
        else toast(e.message, 'err');
        renderPanel();
        return false;
      }
    })();
    const ok = await saving;
    saving = null;
    if (pending) { pending = false; return save(); }
    return ok;
  }

  /* ----- preview ----- */
  const frame = el('iframe', { class: 'pv-frame', src: '/preview', title: 'Pré-visualização' });
  let ready = false;
  const previewKey = () => (S.sel === 'envio' ? 'submit' : S.sel === 'final' ? 'done' : S.sel === 'encerrado' ? S.previewSub : S.sel);
  function sendPreview() {
    if (!ready) return;
    frame.contentWindow?.postMessage({ type: 'ctf-schema', schema: sch(), titulo: S.titulo, goto: S.tab === 'conteudo' ? previewKey() : undefined }, location.origin);
  }
  const onMessage = e => { if (e.origin === location.origin && e.data?.type === 'ctf-ready') { ready = true; sendPreview(); } };
  const onBeforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) saveNow(); } };
  window.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('keydown', onKey);
  setCleanup(() => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('keydown', onKey);
  });

  // Nothing goes live until the user saves: edits only change the editor and the preview.
  async function saveNow() {
    if (await save()) toast(S.status === 'published' ? 'Alterações publicadas' : S.status === 'closed' ? 'Alterações salvas' : 'Rascunho salvo');
  }
  const saveBtn = el('button', { class: 'btn sm', onclick: saveNow });
  function syncSaveBtn() {
    saveBtn.disabled = !dirty;
    saveBtn.className = `btn sm${dirty ? ' primary' : ''}`;
    saveBtn.textContent = S.status === 'published' ? 'Salvar e publicar' : S.status === 'closed' ? 'Salvar alterações' : 'Salvar rascunho';
  }

  /* ----- field helpers ----- */
  const field = (label, control, hint) => el('div', { class: 'field' }, label && el('label', { text: label }), control, hint && el('p', { class: 'hint', text: hint }));
  function text(obj, key, { multiline, placeholder, rows, onchange, type } = {}) {
    const node = el(multiline ? 'textarea' : 'input', { class: multiline ? 'textarea' : 'input', value: obj[key] ?? '', placeholder, rows, type: multiline ? undefined : type });
    node.addEventListener('input', () => { obj[key] = node.value; onchange?.(node.value); touch(); });
    return node;
  }
  function toggle(obj, key, label, { onchange, rerender } = {}) {
    const input = el('input', { type: 'checkbox', checked: !!obj[key] });
    input.addEventListener('change', () => { obj[key] = input.checked; onchange?.(); touch(); if (rerender) renderPanel(); });
    return el('label', { class: 'switch' }, input, el('span', { text: label }));
  }
  function select(obj, key, options, onchange) {
    const node = el('select', { class: 'select' }, options.map(([v, l]) => el('option', { value: v, text: l })));
    node.value = obj[key];
    node.addEventListener('change', () => { obj[key] = isNaN(obj[key]) ? node.value : Number(node.value); onchange?.(); touch(); });
    return node;
  }
  function color(obj, key) {
    const picker = el('input', { type: 'color', value: obj[key] });
    const hex = el('input', { class: 'input mono', value: obj[key], maxlength: 7, style: 'width:110px' });
    picker.addEventListener('input', () => { obj[key] = picker.value; hex.value = picker.value; touch(); });
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { obj[key] = hex.value.toLowerCase(); picker.value = obj[key]; touch(); } });
    return el('div', { class: 'color-row' }, picker, hex);
  }
  async function upload(file) {
    const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Falha no upload.');
    return data.url;
  }
  function imageField(obj, key, label, hint, onchange) {
    const holder = el('div');
    const draw = () => {
      const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', hidden: true });
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { obj[key] = await upload(input.files[0]); touch(); onchange?.(); draw(); } catch (e) { toast(e.message, 'err'); }
      });
      fill(holder, el('div', { class: 'upload' },
        obj[key] && el('img', { src: obj[key], alt: '' }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, obj[key] ? 'Trocar imagem' : 'Enviar imagem'),
        obj[key] && el('button', { class: 'btn ghost sm danger', type: 'button', onclick: () => { obj[key] = ''; touch(); onchange?.(); draw(); } }, 'Remover'), input));
    };
    draw();
    return field(label, holder, hint);
  }

  /* ----- webhook: one per form, fired on completion and/or when one chosen question is answered ----- */
  function webhookCard() {
    const w = sch().ajustes.webhook;
    const result = el('span', { class: 'hint' });
    const logs = el('div', { class: 'log-list' });
    api('GET', `/forms/${id}/webhook-logs`).then(({ logs: rows }) => {
      fill(logs, rows.slice(0, 5).map(l => el('div', { class: 'log' },
        el('span', { class: `pill ${l.ok ? 'ok' : 'err'}`, text: l.ok ? l.status : l.error || 'erro' }),
        el('span', { class: 'when', text: fmtDate(l.at) }), el('span', { class: 'url', text: l.event === 'form.completed' ? 'conclusão' : l.event.endsWith('.test') ? 'teste' : 'pergunta' }))));
    }).catch(() => {});
    const test = async perguntaId => {
      if (!w.url) { result.className = 'hint'; result.textContent = 'Informe a URL primeiro.'; return; }
      result.className = 'hint'; result.textContent = 'Enviando…';
      try {
        const { resultado: r } = await api('POST', `/forms/${id}/webhook-test`, { url: w.url, segredo: w.segredo, pergunta_id: perguntaId });
        result.className = `pill ${r.ok ? 'ok' : 'err'}`;
        result.textContent = r.ok ? `OK · HTTP ${r.status} · ${r.ms}ms` : `Falhou · ${r.error}`;
      } catch (e) { result.className = 'pill err'; result.textContent = e.message; }
    };
    const box = el('div', { class: 'section' }, el('h3', { text: 'Webhook' }),
      el('p', { class: 'hint', style: 'margin-bottom:12px', text: 'Envia as respostas para um endereço seu (n8n, Make, Zapier, CRM…). Marque quando disparar: no fim do formulário, em uma pergunta específica, ou nos dois. Sem nenhuma marcada, o webhook fica desligado.' }),
      field('URL de destino', text(w, 'url', { placeholder: 'https://seu-servidor.com/webhook', type: 'url' }), 'Recebe um POST em JSON. Falhas são reenviadas até 3 vezes.'),
      field('Segredo de assinatura (opcional)', text(w, 'segredo', { placeholder: 'Ex.: uma frase longa' }), 'Se preenchido, enviamos o cabeçalho X-Webhook-Signature (HMAC-SHA256 do corpo).'),
      toggle(w, 'ao_concluir', 'Ao concluir o formulário (envia todas as respostas)'),
      toggle(w, 'ao_responder', 'Ao responder uma pergunta específica', { rerender: true, onchange: refresh }));
    if (w.ao_responder) {
      const sel = el('select', { class: 'select' }, [['', 'Escolha a pergunta…'], ...sch().perguntas.map((q, i) => [q.id, `Pergunta ${i + 1} — ${plain(q.rotulo).slice(0, 56) || 'sem título'}`]).filter((_, i) => sch().perguntas[i].tipo !== 'aviso')]
        .map(([v, l]) => el('option', { value: v, text: l })));
      sel.value = w.pergunta;
      sel.addEventListener('change', () => { w.pergunta = sel.value; touch(); refresh(); });
      box.append(field('Pergunta que dispara o webhook', sel, 'Dispara quando a pessoa responde esta pergunta e avança, sem esperar o fim. Envia a resposta, as respostas anteriores e os dados de rastreio (UTMs).'));
    }
    box.append(el('div', { class: 'row wrap' },
      el('button', { class: 'btn sm', type: 'button', onclick: () => test(undefined) }, 'Testar envio de conclusão'),
      w.ao_responder && w.pergunta && el('button', { class: 'btn sm', type: 'button', onclick: () => test(w.pergunta) }, 'Testar envio da pergunta'),
      result), logs);
    return box;
  }

  /* ----- left list ----- */
  const listEl = el('aside', { class: 'ed-list' });
  const panelEl = el('div', { class: 'ed-panel' });
  const bodyEl = el('div', { class: 'ed-body' });
  let dragFrom = null;

  function select_(key) { S.sel = key; renderList(); renderPanel(); sendPreview(); }

  function item(key, badge, label, extra = {}) {
    const node = el('div', { class: `li${S.sel === key ? ' sel' : ''}`, onclick: () => select_(key), ...(extra.draggable ? { draggable: 'true' } : {}) },
      extra.draggable && el('span', { class: 'grab', text: '⋮⋮' }),
      el('span', { class: 'badge', text: badge }),
      el('span', { class: 'txt', text: label }),
      extra.route && el('span', { class: 'route-mark', title: 'Tem lógica de navegação' }, '↪'),
      extra.hook && el('span', { class: 'hook', title: 'O webhook dispara nesta pergunta' }));
    if (extra.draggable) {
      node.addEventListener('dragstart', e => { dragFrom = extra.index; e.dataTransfer.effectAllowed = 'move'; });
      node.addEventListener('dragover', e => { e.preventDefault(); node.classList.add('over'); });
      node.addEventListener('dragleave', () => node.classList.remove('over'));
      node.addEventListener('drop', e => {
        e.preventDefault(); node.classList.remove('over');
        if (dragFrom === null || dragFrom === extra.index) return;
        const [moved] = sch().perguntas.splice(dragFrom, 1);
        sch().perguntas.splice(extra.index, 0, moved);
        dragFrom = null; renderList(); touch();
      });
    }
    return node;
  }

  function openAddMenu(anchor) {
    document.querySelector('.menu')?.remove();
    const rect = anchor.getBoundingClientRect();
    const menu = el('div', { class: 'menu', style: `left:${Math.max(8, rect.left)}px;top:${rect.bottom + 6}px` },
      Object.entries(TIPOS).map(([tipo, t]) => el('button', { type: 'button', onclick: () => { menu.remove(); addQuestion(tipo); } },
        el('span', { class: 'badge', text: t.sigla }), el('span', {}, t.nome, el('small', { text: t.desc })))));
    document.body.append(menu);
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  const uniqueKey = (base, except) => {
    const used = new Set(sch().perguntas.filter(q => q !== except).map(q => q.chave));
    let k = base || 'pergunta', n = 2;
    while (used.has(k)) k = `${base}_${n++}`;
    return k;
  };

  function addQuestion(tipo, after = sch().perguntas.length - 1) {
    const q = {
      id: newId(), chave: uniqueKey(`pergunta_${sch().perguntas.length + 1}`), tipo, rotulo: '', ajuda: '', obrigatoria: false, placeholder: '',
      opcoes: CHOICE.includes(tipo) ? ['Opção 1', 'Opção 2'] : [], outra: false, exclusivas: [], compacta: false,
      estilo: 'numeros', min: 1, max: 5, rotulo_min: '', rotulo_max: '', prefill: [], proxima: '', ramos: {}, _auto: true
    };
    sch().perguntas.splice(after + 1, 0, q);
    S.tab = 'conteudo'; syncTabs();
    select_(q.id); touch();
    setTimeout(() => panelEl.querySelector('textarea')?.focus(), 30);
  }

  function renderList() {
    const qs = sch().perguntas;
    fill(listEl, 
      el('div', { class: 'list-sep', text: 'Início' }),
      item('welcome', '👋', sch().boas_vindas.ativo ? plain(sch().boas_vindas.titulo) || 'Boas-vindas' : 'Boas-vindas (desativada)'),
      el('div', { class: 'list-sep', text: `Perguntas (${qs.length})` }),
      qs.map((q, i) => item(q.id, TIPOS[q.tipo].sigla, `${i + 1}. ${plain(q.rotulo) || 'Sem título'}`, { draggable: true, index: i, hook: sch().ajustes.webhook.ao_responder && sch().ajustes.webhook.pergunta === q.id, route: hasRouting(q) })),
      el('button', { class: 'btn sm', style: 'width:100%;margin:8px 0', type: 'button', onclick: e => openAddMenu(e.currentTarget) }, '+ Adicionar pergunta'),
      el('div', { class: 'list-sep', text: 'Fim' }),
      item('envio', '↗', 'Envio e consentimento'),
      item('final', '✓', 'Tela final e redirecionamento'),
      item('encerrado', '⏱', 'Agenda e encerramento'));
  }

  /* ----- panels ----- */
  function problemsBox() {
    return S.problemas.length ? el('div', { class: 'notice err' }, el('b', { text: 'Não foi possível publicar:' }), el('ul', {}, S.problemas.map(p => el('li', { text: p })))) : null;
  }

  function renderPanel() {
    let content;
    if (S.tab === 'design') content = designPanel();
    else if (S.tab === 'ajustes') content = settingsPanel();
    else if (S.sel === 'welcome') content = welcomePanel();
    else if (S.sel === 'envio') content = envioPanel();
    else if (S.sel === 'final') content = finalPanel();
    else if (S.sel === 'encerrado') content = encerradoPanel();
    else {
      const i = sch().perguntas.findIndex(q => q.id === S.sel);
      content = i >= 0 ? questionPanel(sch().perguntas[i], i) : welcomePanel();
    }
    const scroll = panelEl.scrollTop;
    fill(panelEl, el('div', { class: 'inner' }, problemsBox(), content));
    panelEl.scrollTop = scroll;
  }

  const refresh = () => renderList();
  const hasRouting = q => !!q.proxima || Object.keys(q.ramos || {}).length > 0;

  function welcomePanel() {
    const w = sch().boas_vindas;
    return el('div', {},
      el('h2', { text: 'Tela de boas-vindas', style: 'margin-bottom:16px' }),
      toggle(w, 'ativo', 'Mostrar tela de boas-vindas', { rerender: true, onchange: refresh }),
      w.ativo && el('div', {},
        field('Etiqueta (opcional)', text(w, 'eyebrow', { placeholder: 'Ex.: Pesquisa · 2 minutos' })),
        field('Título', text(w, 'titulo', { multiline: true, rows: 2, onchange: refresh }), TOKENS_HINT),
        field('Texto', text(w, 'texto', { multiline: true, rows: 3 })),
        field('Texto do botão', text(w, 'botao')),
        field('Nota abaixo do botão (opcional)', text(w, 'nota', { placeholder: 'Ex.: leva menos de 2 minutos' }), 'Aparece entre colchetes, em fonte mono.')));
  }

  function envioPanel() {
    const e = sch().envio;
    return el('div', {},
      el('h2', { text: 'Envio e consentimento', style: 'margin-bottom:6px' }),
      el('p', { class: 'muted', style: 'margin:0 0 16px', text: sch().consentimento.ativo ? 'Esta tela aparece depois da última pergunta, com a caixa de consentimento.' : 'O consentimento está desativado: a última pergunta envia direto. Ative-o em Ajustes para mostrar esta tela. O texto do botão abaixo vale nos dois casos.' }),
      sch().consentimento.ativo && el('div', {},
        field('Título', text(e, 'titulo', { multiline: true, rows: 2 }), TOKENS_HINT),
        field('Texto', text(e, 'texto', { multiline: true, rows: 3 }))),
      field('Texto do botão de envio', text(e, 'botao')));
  }

  function finalPanel() {
    const f = sch().final;
    return el('div', {},
      el('h2', { text: 'Tela final e redirecionamento', style: 'margin-bottom:16px' }),
      el('div', { class: 'section' }, el('h3', { text: 'Página de obrigado' }),
        el('p', { class: 'hint', style: 'margin-bottom:12px', text: 'É o que a pessoa vê depois de enviar. Se o redirecionamento estiver desligado (ou nenhuma regra combinar), ela fica aqui.' }),
        field('Etiqueta (opcional)', text(f, 'etiqueta', { placeholder: 'Ex.: STATUS: INSCRIÇÃO RECEBIDA' })),
        field('Título', text(f, 'titulo', { multiline: true, rows: 2 }), TOKENS_HINT),
        field('Texto', text(f, 'texto', { multiline: true, rows: 3 })),
        el('div', { class: 'cols2' },
          field('Botão (opcional): texto', text(f, 'cta_texto', { placeholder: 'Ex.: Entrar no grupo' })),
          field('Botão: link', text(f, 'cta_url', { placeholder: 'https://…', type: 'url' })))),
      redirectSection());
  }

  // Conditional redirect: after sending, the first rule whose conditions ALL match sends the person to its URL.
  const OPS = {
    choice: [['igual', 'é'], ['diferente', 'não é']],
    multi: [['contem', 'inclui'], ['nao_contem', 'não inclui']],
    number: [['igual', 'é igual a'], ['gte', 'é maior ou igual a'], ['lte', 'é menor ou igual a']],
    state: [['igual', 'é o estado'], ['diferente', 'não é o estado']],
    text: [['igual', 'é igual a'], ['contem', 'contém'], ['diferente', 'é diferente de']]
  };
  const opsFor = q => (['unica', 'dropdown', 'sim_nao'].includes(q.tipo) ? OPS.choice : q.tipo === 'multipla' ? OPS.multi : ['escala', 'numero'].includes(q.tipo) ? OPS.number : q.tipo === 'cidade_uf' ? OPS.state : OPS.text);
  const valuesFor = q => (q.tipo === 'unica' ? [...q.opcoes.filter(Boolean), ...(q.outra ? ['Outra'] : [])] : q.tipo === 'multipla' ? [...q.opcoes.filter(Boolean), ...(q.outra ? ['Outra'] : [])]
    : q.tipo === 'dropdown' ? q.opcoes.filter(Boolean) : q.tipo === 'sim_nao' ? ['Sim', 'Não'] : q.tipo === 'cidade_uf' ? UFS
    : q.tipo === 'escala' ? Array.from({ length: q.max - q.min + 1 }, (_, k) => String(q.min + k)) : null);

  function redirectSection() {
    const r = sch().final.redirecionamento;
    const holder = el('div', { class: 'section' });
    const answerable = () => sch().perguntas.map((q, i) => ({ q, i })).filter(({ q }) => q.tipo !== 'aviso');

    const conditionRow = (rule, c, ci) => {
      const q = sch().perguntas.find(x => x.id === c.pergunta);
      const qSel = el('select', { class: 'select' }, answerable().map(({ q: o, i }) => el('option', { value: o.id, text: `Pergunta ${i + 1} — ${plain(o.rotulo).slice(0, 40) || 'sem título'}` })));
      qSel.value = c.pergunta;
      qSel.addEventListener('change', () => {
        const nq = sch().perguntas.find(x => x.id === qSel.value);
        c.pergunta = qSel.value; c.op = opsFor(nq)[0][0]; c.valor = ''; touch(); draw();
      });
      const opSel = el('select', { class: 'select' }, opsFor(q).map(([v, l]) => el('option', { value: v, text: l })));
      opSel.value = opsFor(q).some(([v]) => v === c.op) ? c.op : opsFor(q)[0][0];
      c.op = opSel.value;
      opSel.addEventListener('change', () => { c.op = opSel.value; touch(); });
      const values = valuesFor(q);
      let valueEl;
      if (values) {
        valueEl = el('select', { class: 'select' }, [el('option', { value: '', text: 'Escolha…' }), ...values.map(v => el('option', { value: v, text: q.tipo === 'escala' ? faceFor(q, Number(v)) : v }))]);
        valueEl.value = c.valor;
        valueEl.addEventListener('change', () => { c.valor = valueEl.value; touch(); });
      } else {
        valueEl = el('input', { class: 'input', value: c.valor, placeholder: 'Valor', type: q.tipo === 'numero' ? 'number' : 'text' });
        valueEl.addEventListener('input', () => { c.valor = valueEl.value; touch(); });
      }
      return el('div', { class: 'cond-row' },
        el('span', { class: 'cond-and', text: ci === 0 ? 'Se' : 'e' }), qSel, opSel, valueEl,
        el('button', { class: 'icon-btn', type: 'button', title: 'Remover condição', onclick: () => { rule.condicoes.splice(ci, 1); touch(); draw(); } }, '✕'));
    };

    const ruleCard = (rule, ri) => {
      const move = d => { const j = ri + d; if (j < 0 || j >= r.regras.length) return; [r.regras[ri], r.regras[j]] = [r.regras[j], r.regras[ri]]; touch(); draw(); };
      const nameInput = text(rule, 'nome', { placeholder: `Regra ${ri + 1} (nome opcional)` });
      return el('div', { class: 'rule' },
        el('div', { class: 'row', style: 'margin-bottom:10px' }, el('b', { text: `Regra ${ri + 1}` }), el('div', { class: 'grow' }),
          el('button', { class: 'icon-btn', type: 'button', title: 'Subir', disabled: ri === 0, onclick: () => move(-1) }, '↑'),
          el('button', { class: 'icon-btn', type: 'button', title: 'Descer', disabled: ri === r.regras.length - 1, onclick: () => move(1) }, '↓'),
          el('button', { class: 'icon-btn', type: 'button', title: 'Excluir regra', onclick: () => { r.regras.splice(ri, 1); touch(); draw(); } }, '🗑')),
        field(null, nameInput),
        rule.condicoes.map((c, ci) => conditionRow(rule, c, ci)),
        el('button', { class: 'btn sm', type: 'button', style: 'margin:4px 0 12px', onclick: () => { rule.condicoes.push({ pergunta: answerable()[0].q.id, op: 'igual', valor: '' }); touch(); draw(); } }, '+ Adicionar condição (e)'),
        field('Então redirecionar para', text(rule, 'url', { placeholder: 'https://…', type: 'url' }), 'Pode levar respostas na URL com {chave} (ex.: …?email={email}) e o código da resposta com {resposta_id}.'));
    };

    const draw = () => {
      fill(holder, el('h3', { text: 'Redirecionamento condicional' }),
        el('p', { class: 'hint', style: 'margin-bottom:12px', text: 'Desligado: a pessoa fica só na página de obrigado. Ligado: ao enviar, ela vai para a URL da primeira regra (de cima para baixo) cujas condições combinem todas. Se nenhuma combinar, vai para a URL padrão, se houver; senão, vê a página de obrigado.' }),
        toggle(r, 'ativo', 'Redirecionar conforme as respostas', { rerender: false, onchange: () => { touch(); draw(); } }),
        r.ativo && el('div', {},
          answerable().length === 0 && el('p', { class: 'notice', text: 'Crie perguntas antes de montar regras.' }),
          r.regras.map(ruleCard),
          el('button', {
            class: 'btn sm', type: 'button', disabled: answerable().length === 0, style: 'margin-bottom:14px',
            onclick: () => { r.regras.push({ id: `r${Math.random().toString(16).slice(2, 10)}`, nome: '', condicoes: [{ pergunta: answerable()[0].q.id, op: 'igual', valor: '' }], url: '' }); touch(); draw(); }
          }, '+ Adicionar regra'),
          field('URL padrão (quando nenhuma regra combinar)', text(r, 'url_padrao', { placeholder: 'Opcional — vazio mostra a página de obrigado', type: 'url' })),
          el('p', { class: 'hint', text: 'Na pré-visualização, o envio mostra para onde a pessoa seria levada sem sair da página.' })));
    };
    draw();
    return holder;
  }

  // Schedule + closed screens. Closed by hand or by schedule; people already filling get 10 minutes after a scheduled closing.
  const toLocalInput = iso => {
    if (!iso) return '';
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function encerradoPanel() {
    const ag = sch().agenda, en = sch().encerrado, eb = sch().em_breve;
    const st = estado();
    const stateText = { rascunho: ['Rascunho — publique para a agenda valer.', ''], aberto: ['Aberto, recebendo respostas.', 'ok'], em_breve: ['Agendado: ainda não abriu.', 'warn'], encerrado: ['Encerrado: não recebe respostas.', 'err'] }[st];
    const dateField = (label, key, hint) => {
      const input = el('input', { class: 'input', type: 'datetime-local', value: toLocalInput(ag[key]) });
      input.addEventListener('change', () => { ag[key] = input.value ? new Date(input.value).toISOString() : ''; touch(); renderPanel(); });
      return field(label, el('div', { class: 'row' }, input, ag[key] && el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { ag[key] = ''; touch(); renderPanel(); } }, 'Limpar')), hint);
    };
    const sub = (k, label) => el('button', { class: 'tab', role: 'tab', 'aria-selected': String(S.previewSub === k), onclick: () => { S.previewSub = k; renderPanel(); sendPreview(); } }, label);
    return el('div', {},
      el('h2', { text: 'Agenda e encerramento', style: 'margin-bottom:6px' }),
      el('p', { class: 'row', style: 'margin:0 0 16px' }, el('span', { class: `pill ${stateText[1]}`, text: stateText[0] })),
      el('div', { class: 'section' }, el('h3', { text: 'Agenda' }),
        el('p', { class: 'hint', style: 'margin-bottom:12px', text: `Horários no fuso do seu navegador (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Fora do período, a pessoa vê as telas abaixo. Quem já estava preenchendo quando o encerramento chega tem 10 minutos para terminar. Vale para formulários publicados.` }),
        el('div', { class: 'cols2' },
          dateField('Abre em', 'abre_em', 'Opcional. Antes disso aparece a tela “em breve”.'),
          dateField('Encerra em', 'fecha_em', 'Opcional. Depois disso aparece a tela de encerrado.')),
        S.status !== 'draft' && el('div', { class: 'row' },
          S.status === 'closed'
            ? el('button', { class: 'btn sm', type: 'button', onclick: reopen }, 'Reabrir agora')
            : el('button', { class: 'btn sm danger', type: 'button', onclick: closeNow }, 'Encerrar agora'))),
      el('div', { class: 'tabs', style: 'margin-bottom:14px;width:fit-content' }, sub('closed', 'Tela de encerrado'), sub('soon', 'Tela “em breve”')),
      S.previewSub === 'closed'
        ? el('div', { class: 'section' }, el('h3', { text: 'Tela de encerrado' }),
          field('Título', text(en, 'titulo', { multiline: true, rows: 2 })),
          field('Texto', text(en, 'texto', { multiline: true, rows: 3 })),
          el('div', { class: 'cols2' }, field('Botão (opcional): texto', text(en, 'cta_texto', { placeholder: 'Ex.: Entrar na lista de espera' })), field('Botão: link', text(en, 'cta_url', { placeholder: 'https://…', type: 'url' }))))
        : el('div', { class: 'section' }, el('h3', { text: 'Tela “em breve”' }),
          field('Título', text(eb, 'titulo', { multiline: true, rows: 2 })),
          field('Texto', text(eb, 'texto', { multiline: true, rows: 3 }), 'A data de abertura aparece sozinha abaixo do texto, se houver agenda.')));
  }

  function optionsEditor(q, onChange) {
    const holder = el('div');
    const draw = (focusIndex) => {
      fill(holder, 
        ...q.opcoes.map((opt, i) => {
          const input = el('input', { class: 'input', value: opt, placeholder: `Opção ${i + 1}` });
          input.addEventListener('input', () => {
            const old = q.opcoes[i];
            q.opcoes[i] = input.value;
            q.exclusivas = q.exclusivas.map(x => (x === old ? input.value : x));
            if (q.ramos[old] !== undefined) { q.ramos[input.value] = q.ramos[old]; delete q.ramos[old]; } // keep the rule when an option is renamed
            for (const rule of sch().final.redirecionamento.regras) for (const c of rule.condicoes) if (c.pergunta === q.id && c.valor === old) c.valor = input.value;
            touch(); onChange?.();
          });
          input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.opcoes.splice(i + 1, 0, ''); draw(i + 1); touch(); } });
          const excl = q.tipo === 'multipla' && el('label', { title: 'Ao marcar esta opção, as demais são desmarcadas (ex.: “Nenhum”)' },
            el('input', { type: 'checkbox', checked: q.exclusivas.includes(opt), onchange: e => {
              q.exclusivas = e.target.checked ? [...q.exclusivas, q.opcoes[i]] : q.exclusivas.filter(x => x !== q.opcoes[i]);
              touch();
            } }), 'exclusiva');
          const row = el('div', { class: 'opt-row' }, input, excl,
            el('button', { class: 'icon-btn', type: 'button', title: 'Remover', onclick: () => { delete q.ramos[q.opcoes[i]]; q.opcoes.splice(i, 1); draw(); touch(); onChange?.(); } }, '✕'));
          if (focusIndex === i) setTimeout(() => input.focus(), 0);
          return row;
        }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { q.opcoes.push(''); draw(q.opcoes.length - 1); touch(); } }, '+ Adicionar opção'));
    };
    draw();
    return holder;
  }

  // Branching: where the respondent goes after this question. Destinations can only be later questions, so routes never loop.
  function routingSection(q, i) {
    const qs = sch().perguntas;
    const destOptions = defaultLabel => [['', defaultLabel], ...qs.slice(i + 1).map((o, k) => [o.id, `Pergunta ${i + k + 2} — ${plain(o.rotulo).slice(0, 48) || 'sem título'}`]), ['fim', 'Finalizar (ir direto para o envio)']];
    const destSelect = (obj, key, defaultLabel) => {
      const opts = destOptions(defaultLabel);
      const bad = obj[key] && !opts.some(([v]) => v === obj[key]);
      if (bad) opts.push([obj[key], `⚠ destino inválido (pergunta ${qs.findIndex(x => x.id === obj[key]) + 1} vem antes)`]);
      const node = el('select', { class: 'select' }, opts.map(([v, l]) => el('option', { value: v, text: l })));
      node.value = obj[key] || '';
      node.addEventListener('change', () => { if (node.value) obj[key] = node.value; else delete obj[key]; if (key === 'proxima' && !node.value) obj[key] = ''; touch(); refresh(); });
      return node;
    };
    const last = i === qs.length - 1;
    const box = el('div', { class: 'section' }, el('h3', { text: 'Navegação' }),
      el('p', { class: 'hint', style: 'margin-bottom:12px', text: 'Por padrão a pessoa segue para a pergunta seguinte. Escolha outro destino para pular perguntas. Para ela a contagem continua sequencial; no sistema a resposta fica salva na posição real.' }),
      field('Depois desta pergunta, ir para', destSelect(q, 'proxima', last ? 'Envio (é a última pergunta)' : `Pergunta ${i + 2} (padrão)`)));
    const values = branchValuesOf(q);
    if (values.length) {
      box.append(el('div', { class: 'field' }, el('label', { text: 'Ou, conforme a resposta' }),
        values.map(v => el('div', { class: 'route-row' }, el('span', { class: 'route-val', title: v, text: v }), el('span', { class: 'muted', text: '→' }), destSelect(q.ramos, v, 'Seguir a regra acima')))));
    }
    return box;
  }

  function questionPanel(q, i) {
    const qs = sch().perguntas;
    const move = d => { const j = i + d; if (j < 0 || j >= qs.length) return; [qs[i], qs[j]] = [qs[j], qs[i]]; renderList(); renderPanel(); touch(); };
    const routeBox = el('div');
    const drawRoute = () => fill(routeBox, routingSection(q, i));
    drawRoute();
    const locked = isLocked(q);
    const typeSelect = el('select', { class: 'select', disabled: locked }, Object.entries(TIPOS).map(([v, t]) => el('option', { value: v, text: t.nome })));
    typeSelect.value = q.tipo;
    typeSelect.addEventListener('change', () => {
      q.tipo = typeSelect.value;
      if (CHOICE.includes(q.tipo) && !q.opcoes.length) q.opcoes = ['Opção 1', 'Opção 2'];
      if (q.tipo === 'aviso') q.obrigatoria = false;
      if (q.tipo !== 'escala') q.estilo = 'numeros';
      renderList(); renderPanel(); touch();
    });

    const parts = [
      el('div', { class: 'row', style: 'margin-bottom:16px' },
        el('h2', { class: 'grow', text: `${q.tipo === 'aviso' ? 'Mensagem' : 'Pergunta'} ${i + 1}` }),
        el('button', { class: 'icon-btn', title: 'Mover para cima', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Mover para baixo', disabled: i === qs.length - 1, onclick: () => move(1) }, '↓'),
        el('button', { class: 'btn sm', onclick: () => {
          const copyQ = JSON.parse(JSON.stringify(q)); copyQ.id = newId(); copyQ.chave = uniqueKey(`${q.chave}_copia`); copyQ._auto = false;
          qs.splice(i + 1, 0, copyQ); select_(copyQ.id); touch();
        } }, 'Duplicar'),
        el('button', { class: 'btn sm danger', onclick: () => {
          if (!confirm('Excluir esta pergunta? As respostas já recebidas continuam salvas e passam a aparecer em “Respostas passadas” no dashboard (vale ao salvar).')) return;
          let refs = 0;
          for (const o of qs) {
            if (o.proxima === q.id) { o.proxima = ''; refs++; }
            for (const k of Object.keys(o.ramos || {})) if (o.ramos[k] === q.id) { delete o.ramos[k]; refs++; }
          }
          const w = sch().ajustes.webhook, rr = sch().final.redirecionamento;
          const hadHook = w.pergunta === q.id;
          if (hadHook) { w.pergunta = ''; w.ao_responder = false; }
          const rulesBefore = rr.regras.length;
          rr.regras = rr.regras.filter(rule => !rule.condicoes.some(c => c.pergunta === q.id));
          const droppedRules = rulesBefore - rr.regras.length;
          qs.splice(i, 1); select_(qs[Math.min(i, qs.length - 1)]?.id || 'welcome'); touch();
          const notes = [refs && `${refs} regra(s) de navegação voltaram ao padrão`, hadHook && 'o webhook por pergunta foi desligado', droppedRules && `${droppedRules} regra(s) de redirecionamento foram removidas`].filter(Boolean);
          if (notes.length) toast(`Esta pergunta era usada em outros lugares: ${notes.join('; ')}`);
        } }, 'Excluir')),
      field('Tipo de pergunta', typeSelect, locked ? 'Não é possível alterar o tipo depois que o formulário foi aberto. Para outro tipo, crie uma nova pergunta (você pode excluir esta: as respostas já dadas ficam guardadas).' : undefined),
      field(q.tipo === 'aviso' ? 'Título' : 'Enunciado', text(q, 'rotulo', {
        multiline: true, rows: 2, placeholder: q.tipo === 'aviso' ? 'Ex.: Agora, algumas perguntas sobre o seu negócio' : 'Ex.: Qual é o seu melhor e-mail?',
        onchange: v => { if (q._auto) q.chave = uniqueKey(slugKey(v) || q.chave, q); refresh(); }
      }), TOKENS_HINT),
      field('Descrição (opcional)', text(q, 'ajuda', { multiline: true, rows: 2, placeholder: 'Texto de apoio abaixo do enunciado' }))
    ];
    if (q.tipo !== 'aviso') parts.push(toggle(q, 'obrigatoria', 'Resposta obrigatória'));
    if (TEXTLIKE.includes(q.tipo) || q.tipo === 'dropdown') parts.push(field(q.tipo === 'dropdown' ? 'Texto do campo de busca' : 'Texto de exemplo (placeholder)', text(q, 'placeholder')));
    if (CHOICE.includes(q.tipo)) {
      parts.push(field('Opções', optionsEditor(q, drawRoute)),
        q.tipo !== 'dropdown' && toggle(q, 'outra', 'Incluir opção “Outra” com campo de texto', { onchange: drawRoute }),
        q.tipo !== 'dropdown' && toggle(q, 'compacta', 'Mostrar opções lado a lado'));
    }
    if (q.tipo === 'escala') {
      const lockNote = ' Não pode mudar depois que o formulário foi aberto.';
      const estiloSel = el('select', { class: 'select', disabled: locked }, [['numeros', 'Números (ex.: NPS de 0 a 10)'], ['estrelas', 'Estrelas'], ['emojis', 'Emojis (3 a 5 carinhas, para satisfação)']].map(([v, l]) => el('option', { value: v, text: l })));
      estiloSel.value = q.estilo || 'numeros';
      estiloSel.addEventListener('change', () => { q.estilo = estiloSel.value; if (q.estilo !== 'numeros') { q.min = 1; q.max = 5; } renderPanel(); renderList(); touch(); });
      const lockable = node => { node.disabled = locked; return node; };
      parts.push(field('Estilo da avaliação', estiloSel, locked ? lockNote.trim() : undefined));
      if (!q.estilo || q.estilo === 'numeros') {
        parts.push(el('div', { class: 'cols2' },
          field('Início', lockable(select(q, 'min', [[0, '0'], [1, '1']], () => renderPanel()))),
          field('Fim', lockable(select(q, 'max', [3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, String(n)]), () => renderPanel())))));
      } else if (q.estilo === 'estrelas') {
        parts.push(field('Quantidade de estrelas', lockable(select(q, 'max', [3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, String(n)]), () => renderPanel())), locked ? lockNote.trim() : undefined));
      } else {
        parts.push(field('Quantidade de carinhas', lockable(select(q, 'max', [3, 4, 5].map(n => [n, String(n)]), () => renderPanel())), (window.CtfRoute.emojis[q.max] || []).join('  ')));
      }
      parts.push(el('div', { class: 'cols2' },
        field('Rótulo do início', text(q, 'rotulo_min', { placeholder: 'Ex.: Nada provável' })),
        field('Rótulo do fim', text(q, 'rotulo_max', { placeholder: 'Ex.: Muito provável' }))));
    }
    parts.push(routeBox);
    if (q.tipo !== 'aviso') {
      const keyInput = el('input', { class: 'input mono', value: q.chave });
      keyInput.addEventListener('input', () => { q._auto = false; q.chave = keyInput.value; touch(); });
      keyInput.addEventListener('blur', () => { q.chave = uniqueKey(slugKey(keyInput.value) || 'pergunta', q); keyInput.value = q.chave; touch(); });
      const prefill = el('input', { class: 'input mono', value: (q.prefill || []).join(', '), placeholder: 'email, buyer_email' });
      prefill.addEventListener('input', () => { q.prefill = prefill.value.split(',').map(s => s.trim()).filter(Boolean); touch(); });
      parts.push(el('div', { class: 'section' }, el('h3', { text: 'Dados' }),
        field('Chave (identificador)', keyInput, 'Nome da resposta nos webhooks e nas exportações. Use letras minúsculas e “_”.'),
        TEXTLIKE.includes(q.tipo) && field('Preencher a partir da URL', prefill, 'Parâmetros de URL que preenchem esta pergunta. Ex.: ?email=ana@x.com')));
    }
    return el('div', {}, ...parts);
  }

  function designPanel() {
    const t = sch().tema;
    return el('div', {},
      el('h2', { text: 'Aparência', style: 'margin-bottom:16px' }),
      el('div', { class: 'field' }, el('label', { text: 'Temas prontos' }),
        el('div', { class: 'swatches' }, PRESETS.map(p => el('button', {
          class: 'swatch', type: 'button',
          onclick: () => { Object.assign(t, { fundo: p.fundo, texto: p.texto, destaque: p.destaque, destaque2: p.destaque2 }); renderPanel(); touch(); }
        }, el('i', {}, el('b', { style: `background:${p.fundo}` }), el('b', { style: `background:${p.destaque}` }), el('b', { style: `background:${p.destaque2}` })), p.nome)))),
      el('div', { class: 'section' }, el('h3', { text: 'Cores' }),
        el('div', { class: 'cols2' }, field('Fundo', color(t, 'fundo')), field('Texto', color(t, 'texto'))),
        el('div', { class: 'cols2' }, field('Destaque (botões, progresso, seleção)', color(t, 'destaque')), field('Destaque secundário (gradiente dos títulos)', color(t, 'destaque2')))),
      el('div', { class: 'section' }, el('h3', { text: 'Tipografia e formas' }),
        field('Fonte', select(t, 'fonte', FONTS.map(f => [f, f]))),
        field(`Arredondamento dos cantos (${t.raio}px)`, (() => {
          const r = el('input', { type: 'range', min: 0, max: 24, value: t.raio, style: 'width:100%' });
          r.addEventListener('input', () => { t.raio = Number(r.value); r.closest('.field').querySelector('label').textContent = `Arredondamento dos cantos (${t.raio}px)`; touch(); });
          return r;
        })()),
        toggle(t, 'grade', 'Mostrar linhas de grade no fundo')),
      el('div', { class: 'section' }, el('h3', { text: 'Imagens' }),
        imageField(t, 'logo', 'Logo (canto superior)', 'PNG, SVG, JPG ou WebP até 4 MB. Fundo transparente funciona melhor.'),
        imageField(t, 'fundo_imagem', 'Imagem de fundo (opcional)', 'Recebe uma camada escura/clara por cima para manter o texto legível.')));
  }

  function jump(sel) { S.tab = 'conteudo'; S.sel = sel; syncTabs(); renderList(); sendPreview(); }

  // How the link looks when shared (WhatsApp, Instagram, Telegram…): the server writes these into the page head.
  function seoCard() {
    const seo = sch().ajustes.seo;
    const card = el('div', { class: 'share-card' });
    const draw = () => fill(card,
      seo.imagem && el('img', { src: seo.imagem, alt: '' }),
      el('div', { class: 'sc-body' }, el('small', { text: location.host }), el('b', { text: seo.titulo || S.titulo || 'Título do formulário' }), el('span', { text: seo.descricao || plain(sch().boas_vindas.texto) || '' })));
    draw();
    return el('div', { class: 'section' }, el('h3', { text: 'Compartilhamento (prévia do link)' }),
      field('Título', text(seo, 'titulo', { placeholder: S.titulo, onchange: draw }), 'Se vazio, usa o nome do formulário. Até 90 caracteres.'),
      field('Descrição', text(seo, 'descricao', { multiline: true, rows: 2, placeholder: plain(sch().boas_vindas.texto), onchange: draw }), 'Se vazia, usa o texto da boas-vindas. Até 200 caracteres.'),
      imageField(seo, 'imagem', 'Imagem de prévia', 'Ideal: 1200 × 630 px (JPG ou PNG).', draw),
      el('div', { class: 'field' }, el('label', { text: 'Como aparece ao compartilhar' }), card));
  }

  function settingsPanel() {
    const a = sch().ajustes;
    const slugInput = el('input', { class: `input${S.slugErro ? ' bad' : ''}`, value: S.slug, spellcheck: 'false', autocapitalize: 'off' });
    slugInput.addEventListener('input', () => {
      const clean = slugUrl(slugInput.value);
      if (clean !== slugInput.value) slugInput.value = clean;
      S.slug = clean; S.slugErro = ''; slugInput.classList.remove('bad'); touch();
    });
    return el('div', {},
      el('h2', { text: 'Ajustes', style: 'margin-bottom:16px' }),
      el('div', { class: 'section' }, el('h3', { text: 'Endereço do formulário' }),
        el('div', { class: 'slug-box' }, el('span', { text: `${location.host}/f/` }), slugInput),
        S.slugErro && el('p', { class: 'hint', style: 'color:var(--err);margin-top:6px', text: S.slugErro }),
        el('p', { class: 'hint', style: 'margin:8px 0 12px', text: 'Use letras minúsculas, números e hífens. Se você mudar o slug, o link antigo deixa de funcionar.' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm', type: 'button', onclick: () => { S.slug = slugUrl(plain(S.titulo)) || S.slug; renderPanel(); touch(); } }, 'Gerar a partir do título'),
          el('button', { class: 'btn sm', type: 'button', onclick: () => copy(formUrl(S.slug)) }, 'Copiar link'),
          el('a', { class: 'btn sm', href: `/f/${S.slug}`, target: '_blank', rel: 'noopener' }, S.status === 'published' ? 'Abrir ↗' : 'Abrir (após publicar) ↗'))),
      el('div', { class: 'section' }, el('h3', { text: 'Telas e regras' }),
        el('p', { class: 'hint', style: 'margin-bottom:12px', text: 'A página de obrigado, o redirecionamento condicional e a agenda ficam na aba Conteúdo, no fim da lista.' }),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn sm', type: 'button', onclick: () => jump('final') }, 'Tela final e redirecionamento →'),
          el('button', { class: 'btn sm', type: 'button', onclick: () => jump('encerrado') }, 'Agenda e encerramento →'))),
      el('div', { class: 'section' }, el('h3', { text: 'Consentimento' }),
        toggle(sch().consentimento, 'ativo', 'Exigir autorização antes de enviar (LGPD)', { rerender: true }),
        sch().consentimento.ativo && field('Texto da autorização', text(sch().consentimento, 'texto', { multiline: true, rows: 3 }))),
      webhookCard(),
      seoCard(),
      el('div', { class: 'section' }, el('h3', { text: 'Comportamento' }),
        toggle(a, 'mostrar_progresso', 'Mostrar barra e contador de progresso'),
        toggle(a, 'mostrar_numero', 'Mostrar o número de cada pergunta'),
        toggle(a, 'uma_vez', 'Impedir nova resposta no mesmo navegador depois de enviar'),
        field('Texto do topo (opcional)', text(a, 'rotulo_topo', { placeholder: 'Ex.: PROTOCOLO: BALF-360-2026' }), 'Aparece ao lado do logo, em fonte mono.'),
        field('Parâmetros de URL a guardar (opcional)', text(a, 'params_extra', { placeholder: 'ref, campanha' }),
          'Já guardamos utm_*, transaction, sck, src e xcod. Liste aqui outros parâmetros que queira registrar junto de cada resposta.')));
  }

  /* ----- top bar ----- */
  const topEl = el('div', { class: 'ed-top' });
  const tabsEl = el('div', { class: 'tabs', role: 'tablist' });
  const TABS = [['conteudo', 'Conteúdo'], ['design', 'Aparência'], ['ajustes', 'Ajustes']];
  function syncTabs() {
    fill(tabsEl, ...TABS.map(([k, label]) => el('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(S.tab === k),
      onclick: () => { S.tab = k; syncTabs(); renderPanel(); sendPreview(); }
    }, label)));
    bodyEl.classList.toggle('no-list', S.tab !== 'conteudo');
    listEl.hidden = S.tab !== 'conteudo';
    renderPanel();
  }

  // Local view of the form's state, same rules the server applies.
  function estado() {
    if (S.status === 'draft') return 'rascunho';
    if (S.status === 'closed') return 'encerrado';
    const { abre_em: abre, fecha_em: fecha } = sch().agenda, now = Date.now();
    if (abre && now < Date.parse(abre)) return 'em_breve';
    if (fecha && now >= Date.parse(fecha)) return 'encerrado';
    return 'aberto';
  }

  async function setStatus(next, message) {
    const before = S.status;
    S.problemas = []; S.status = next;
    if (await save()) toast(message); else S.status = before;
    renderTop(); renderPanel();
  }
  const publish = () => setStatus('published', 'Publicado! Link pronto para compartilhar');
  const reopen = () => setStatus('published', 'Formulário reaberto');
  const closeNow = () => { if (confirm('Encerrar agora? Quem abrir o link verá a tela de encerrado. Quem já estiver preenchendo não consegue mais enviar.')) setStatus('closed', 'Formulário encerrado'); };
  const unpublish = () => { if (confirm('Tirar o formulário do ar? O link deixa de funcionar até você publicar de novo.')) setStatus('draft', 'Formulário despublicado'); };

  function renderTop() {
    const titleInput = el('input', { class: 'input ed-title', value: S.titulo, 'aria-label': 'Nome do formulário' });
    titleInput.addEventListener('input', () => { S.titulo = titleInput.value; touch(); });
    const leave = e => { if (dirty && !confirm('Há alterações não salvas. Sair sem salvar?')) e.preventDefault(); };
    const st = estado();
    const pill = { aberto: ['No ar', 'ok'], em_breve: ['Agendado', 'warn'], encerrado: ['Encerrado', 'err'] }[st];
    fill(topEl,
      el('a', { class: 'btn ghost sm', href: '#/', onclick: leave }, '← Formulários'),
      titleInput, tabsEl, el('div', { class: 'grow' }),
      pill && el('span', { class: `pill ${pill[1]}`, text: pill[0] }),
      stateEl,
      el('a', { class: 'btn sm', href: `#/forms/${id}/results`, onclick: leave }, 'Resultados'),
      S.status !== 'draft' && el('button', { class: 'btn sm', onclick: () => copy(formUrl(S.slug)) }, 'Copiar link'),
      saveBtn,
      S.status === 'published' && el('button', { class: 'btn sm', onclick: closeNow }, 'Encerrar'),
      S.status === 'closed' && el('button', { class: 'btn primary sm', onclick: reopen }, 'Reabrir'),
      S.status !== 'draft' ? el('button', { class: 'btn sm', onclick: unpublish }, 'Despublicar') : el('button', { class: 'btn primary sm', onclick: publish }, 'Publicar'));
    syncSaveBtn();
  }

  /* ----- preview column ----- */
  const stageEl = el('div', { class: 'pv-stage' }, frame);
  const previewEl = el('aside', { class: 'ed-preview' },
    el('div', { class: 'pv-bar' }, el('b', { text: 'Pré-visualização' }), el('div', { class: 'grow' }),
      ...[['Desktop', false], ['Celular', true]].map(([label, mobile]) => el('button', {
        class: 'btn sm ghost', onclick: () => { S.mobile = mobile; stageEl.classList.toggle('mobile', mobile); }
      }, label))),
    stageEl);

  bodyEl.append(listEl, panelEl, previewEl);
  renderTop();
  renderList();
  syncTabs();
  mount(el('div', { class: 'ed' }, topEl, bodyEl));
}
