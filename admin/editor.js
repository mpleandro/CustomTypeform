import { el, fill, api, toast, copy, TIPOS, formUrl, plain, fmtDate } from './ui.js';

const CHOICE = ['unica', 'multipla'];
const TEXTLIKE = ['texto', 'longo', 'email', 'telefone', 'numero', 'url'];
const PRESETS = [
  { nome: 'Escuro', fundo: '#0b0b0f', texto: '#f5f5f7', destaque: '#6366f1' },
  { nome: 'Claro', fundo: '#ffffff', texto: '#18181b', destaque: '#4f46e5' },
  { nome: 'Ignis', fundo: '#080808', texto: '#f7f5ef', destaque: '#ff6b1a' },
  { nome: 'Oceano', fundo: '#06141f', texto: '#eaf6ff', destaque: '#22d3ee' },
  { nome: 'Floresta', fundo: '#0e1a14', texto: '#eef7f0', destaque: '#34d399' },
  { nome: 'Papel', fundo: '#faf6ee', texto: '#2a2118', destaque: '#c2410c' }
];
const FONTS = ['Manrope', 'Inter', 'DM Sans', 'Poppins', 'Montserrat', 'Space Grotesk', 'Sora', 'Outfit', 'Playfair Display', 'Lora'];
const TOKENS_HINT = 'Use *palavra* para destacar na cor do tema e {chave} para citar uma resposta anterior (ex.: {primeiro_nome}).';

const newId = () => `q${Math.random().toString(16).slice(2, 10)}`;
const slugKey = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const slugUrl = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 60);

export async function renderEditor(id, { mount, setCleanup }) {
  const { form } = await api('GET', `/forms/${id}`);
  const S = {
    titulo: form.titulo, slug: form.slug, status: form.status, schema: form.schema,
    tab: 'conteudo', sel: form.schema.boas_vindas.ativo || !form.schema.perguntas.length ? 'welcome' : form.schema.perguntas[0].id,
    problemas: [], slugErro: '', mobile: false
  };
  const sch = () => S.schema;

  /* ----- saving ----- */
  const stateEl = el('span', { class: 'save-state', text: 'Salvo' });
  let saveTimer, saving = null, pending = false, dirty = false;

  function touch() {
    dirty = true;
    stateEl.textContent = 'Alterações pendentes…';
    sendPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (saving) { pending = true; return saving; }
    saving = (async () => {
      stateEl.textContent = 'Salvando…';
      try {
        await api('PUT', `/forms/${id}`, { titulo: S.titulo, slug: S.slug, status: S.status, schema: sch() });
        dirty = false; S.slugErro = ''; stateEl.textContent = 'Salvo';
        if (S.problemas.length) { S.problemas = []; renderPanel(); }
        return true;
      } catch (e) {
        stateEl.textContent = 'Erro ao salvar';
        if (e.data?.campo === 'slug') { S.slugErro = e.message; S.tab = 'ajustes'; syncTabs(); }
        else if (e.data?.problemas) { S.problemas = e.data.problemas; S.status = 'draft'; renderTop(); }
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
  const previewKey = () => (S.sel === 'envio' ? 'submit' : S.sel === 'final' ? 'done' : S.sel);
  function sendPreview() {
    if (!ready) return;
    frame.contentWindow?.postMessage({ type: 'ctf-schema', schema: sch(), titulo: S.titulo, goto: S.tab === 'conteudo' ? previewKey() : undefined }, location.origin);
  }
  const onMessage = e => { if (e.origin === location.origin && e.data?.type === 'ctf-ready') { ready = true; sendPreview(); } };
  const onBeforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', onBeforeUnload);
  setCleanup(() => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (dirty) save();
  });

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
  function imageField(obj, key, label, hint) {
    const holder = el('div');
    const draw = () => {
      const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', hidden: true });
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { obj[key] = await upload(input.files[0]); touch(); draw(); } catch (e) { toast(e.message, 'err'); }
      });
      fill(holder, el('div', { class: 'upload' },
        obj[key] && el('img', { src: obj[key], alt: '' }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, obj[key] ? 'Trocar imagem' : 'Enviar imagem'),
        obj[key] && el('button', { class: 'btn ghost sm danger', type: 'button', onclick: () => { obj[key] = ''; touch(); draw(); } }, 'Remover'), input));
    };
    draw();
    return field(label, holder, hint);
  }

  /* ----- webhook editor (per question and form-level) ----- */
  function webhookSection(w, { questionId, title, description }) {
    const box = el('div', { class: 'section' }, el('h3', { text: title }), el('p', { class: 'hint', style: 'margin-bottom:12px', text: description }));
    box.append(toggle(w, 'ativo', 'Ativar webhook', { rerender: true }));
    if (!w.ativo) return box;
    const result = el('span', { class: 'hint' });
    const testBtn = el('button', {
      class: 'btn sm', type: 'button',
      async onclick() {
        if (!w.url) { result.textContent = 'Informe a URL primeiro.'; return; }
        testBtn.disabled = true; result.textContent = 'Enviando…';
        try {
          const { resultado: r } = await api('POST', `/forms/${id}/webhook-test`, { url: w.url, segredo: w.segredo, pergunta_id: questionId });
          result.className = `pill ${r.ok ? 'ok' : 'err'}`;
          result.textContent = r.ok ? `OK · HTTP ${r.status} · ${r.ms}ms` : `Falhou · ${r.error}`;
        } catch (e) { result.className = 'pill err'; result.textContent = e.message; }
        testBtn.disabled = false;
      }
    }, 'Enviar teste');
    box.append(
      field('URL de destino', text(w, 'url', { placeholder: 'https://seu-servidor.com/webhook', type: 'url' }), 'Recebe um POST em JSON. Falhas são reenviadas até 3 vezes.'),
      field('Segredo de assinatura (opcional)', text(w, 'segredo', { placeholder: 'Ex.: uma frase longa' }), 'Se preenchido, enviamos o cabeçalho X-Webhook-Signature (HMAC-SHA256 do corpo).'),
      el('div', { class: 'row' }, testBtn, result));
    if (questionId) {
      const logs = el('div', { class: 'log-list' });
      box.append(logs);
      api('GET', `/forms/${id}/webhook-logs?pergunta=${questionId}`).then(({ logs: rows }) => {
        fill(logs, ...rows.slice(0, 5).map(l => el('div', { class: 'log' },
          el('span', { class: `pill ${l.ok ? 'ok' : 'err'}`, text: l.ok ? l.status : l.error || 'erro' }),
          el('span', { class: 'when', text: fmtDate(l.at) }), el('span', { class: 'url', text: l.url }))));
      }).catch(() => {});
    }
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
      extra.hook && el('span', { class: 'hook', title: 'Webhook ativo' }));
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
      min: 1, max: 5, rotulo_min: '', rotulo_max: '', prefill: [], webhook: { ativo: false, url: '', segredo: '' }, _auto: true
    };
    sch().perguntas.splice(after + 1, 0, q);
    S.tab = 'conteudo'; syncTabs();
    select_(q.id); touch();
    setTimeout(() => panelEl.querySelector('textarea')?.focus(), 30);
  }

  function renderList() {
    const qs = sch().perguntas;
    let n = 0;
    fill(listEl, 
      el('div', { class: 'list-sep', text: 'Início' }),
      item('welcome', '👋', sch().boas_vindas.ativo ? plain(sch().boas_vindas.titulo) || 'Boas-vindas' : 'Boas-vindas (desativada)'),
      el('div', { class: 'list-sep', text: `Perguntas (${qs.filter(q => q.tipo !== 'aviso').length})` }),
      qs.map((q, i) => item(q.id, TIPOS[q.tipo].sigla, `${q.tipo === 'aviso' ? '' : `${++n}. `}${plain(q.rotulo) || 'Sem título'}`, { draggable: true, index: i, hook: q.webhook.ativo })),
      el('button', { class: 'btn sm', style: 'width:100%;margin:8px 0', type: 'button', onclick: e => openAddMenu(e.currentTarget) }, '+ Adicionar pergunta'),
      el('div', { class: 'list-sep', text: 'Fim' }),
      item('envio', '↗', 'Envio e consentimento'),
      item('final', '✓', 'Tela final'));
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
    else {
      const i = sch().perguntas.findIndex(q => q.id === S.sel);
      content = i >= 0 ? questionPanel(sch().perguntas[i], i) : welcomePanel();
    }
    const scroll = panelEl.scrollTop;
    fill(panelEl, el('div', { class: 'inner' }, problemsBox(), content));
    panelEl.scrollTop = scroll;
  }

  const refresh = () => renderList();

  function welcomePanel() {
    const w = sch().boas_vindas;
    return el('div', {},
      el('h2', { text: 'Tela de boas-vindas', style: 'margin-bottom:16px' }),
      toggle(w, 'ativo', 'Mostrar tela de boas-vindas', { rerender: true, onchange: refresh }),
      w.ativo && el('div', {},
        field('Etiqueta (opcional)', text(w, 'eyebrow', { placeholder: 'Ex.: Pesquisa · 2 minutos' })),
        field('Título', text(w, 'titulo', { multiline: true, rows: 2, onchange: refresh }), TOKENS_HINT),
        field('Texto', text(w, 'texto', { multiline: true, rows: 3 })),
        field('Texto do botão', text(w, 'botao'))));
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
      el('h2', { text: 'Tela final', style: 'margin-bottom:16px' }),
      field('Título', text(f, 'titulo', { multiline: true, rows: 2 }), TOKENS_HINT),
      field('Texto', text(f, 'texto', { multiline: true, rows: 3 })),
      el('div', { class: 'cols2' },
        field('Botão (opcional): texto', text(f, 'cta_texto', { placeholder: 'Ex.: Entrar no grupo' })),
        field('Botão: link', text(f, 'cta_url', { placeholder: 'https://…', type: 'url' }))));
  }

  function optionsEditor(q) {
    const holder = el('div');
    const draw = (focusIndex) => {
      fill(holder, 
        ...q.opcoes.map((opt, i) => {
          const input = el('input', { class: 'input', value: opt, placeholder: `Opção ${i + 1}` });
          input.addEventListener('input', () => {
            const old = q.opcoes[i];
            q.opcoes[i] = input.value;
            q.exclusivas = q.exclusivas.map(x => (x === old ? input.value : x));
            touch();
          });
          input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.opcoes.splice(i + 1, 0, ''); draw(i + 1); touch(); } });
          const excl = q.tipo === 'multipla' && el('label', { title: 'Ao marcar esta opção, as demais são desmarcadas (ex.: “Nenhum”)' },
            el('input', { type: 'checkbox', checked: q.exclusivas.includes(opt), onchange: e => {
              q.exclusivas = e.target.checked ? [...q.exclusivas, q.opcoes[i]] : q.exclusivas.filter(x => x !== q.opcoes[i]);
              touch();
            } }), 'exclusiva');
          const row = el('div', { class: 'opt-row' }, input, excl,
            el('button', { class: 'icon-btn', type: 'button', title: 'Remover', onclick: () => { q.opcoes.splice(i, 1); draw(); touch(); } }, '✕'));
          if (focusIndex === i) setTimeout(() => input.focus(), 0);
          return row;
        }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { q.opcoes.push(''); draw(q.opcoes.length - 1); touch(); } }, '+ Adicionar opção'));
    };
    draw();
    return holder;
  }

  function questionPanel(q, i) {
    const qs = sch().perguntas;
    const move = d => { const j = i + d; if (j < 0 || j >= qs.length) return; [qs[i], qs[j]] = [qs[j], qs[i]]; renderList(); renderPanel(); touch(); };
    const typeSelect = el('select', { class: 'select' }, Object.entries(TIPOS).map(([v, t]) => el('option', { value: v, text: t.nome })));
    typeSelect.value = q.tipo;
    typeSelect.addEventListener('change', () => {
      q.tipo = typeSelect.value;
      if (CHOICE.includes(q.tipo) && !q.opcoes.length) q.opcoes = ['Opção 1', 'Opção 2'];
      if (q.tipo === 'aviso') q.obrigatoria = false;
      renderList(); renderPanel(); touch();
    });

    const parts = [
      el('div', { class: 'row', style: 'margin-bottom:16px' },
        el('h2', { class: 'grow', text: q.tipo === 'aviso' ? 'Mensagem' : `Pergunta ${qs.slice(0, i + 1).filter(x => x.tipo !== 'aviso').length}` }),
        el('button', { class: 'icon-btn', title: 'Mover para cima', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Mover para baixo', disabled: i === qs.length - 1, onclick: () => move(1) }, '↓'),
        el('button', { class: 'btn sm', onclick: () => {
          const copyQ = JSON.parse(JSON.stringify(q)); copyQ.id = newId(); copyQ.chave = uniqueKey(`${q.chave}_copia`); copyQ._auto = false;
          qs.splice(i + 1, 0, copyQ); select_(copyQ.id); touch();
        } }, 'Duplicar'),
        el('button', { class: 'btn sm danger', onclick: () => {
          if (!confirm('Excluir esta pergunta? As respostas já recebidas continuam salvas.')) return;
          qs.splice(i, 1); select_(qs[Math.min(i, qs.length - 1)]?.id || 'welcome'); touch();
        } }, 'Excluir')),
      field('Tipo de pergunta', typeSelect),
      field(q.tipo === 'aviso' ? 'Título' : 'Enunciado', text(q, 'rotulo', {
        multiline: true, rows: 2, placeholder: q.tipo === 'aviso' ? 'Ex.: Agora, algumas perguntas sobre o seu negócio' : 'Ex.: Qual é o seu melhor e-mail?',
        onchange: v => { if (q._auto) q.chave = uniqueKey(slugKey(v) || q.chave, q); refresh(); }
      }), TOKENS_HINT),
      field('Descrição (opcional)', text(q, 'ajuda', { multiline: true, rows: 2, placeholder: 'Texto de apoio abaixo do enunciado' }))
    ];
    if (q.tipo !== 'aviso') parts.push(toggle(q, 'obrigatoria', 'Resposta obrigatória'));
    if (TEXTLIKE.includes(q.tipo)) parts.push(field('Texto de exemplo (placeholder)', text(q, 'placeholder')));
    if (CHOICE.includes(q.tipo)) {
      parts.push(field('Opções', optionsEditor(q)),
        toggle(q, 'outra', 'Incluir opção “Outra” com campo de texto'),
        toggle(q, 'compacta', 'Mostrar opções lado a lado'));
    }
    if (q.tipo === 'escala') {
      parts.push(el('div', { class: 'cols2' },
        field('Início', select(q, 'min', [[0, '0'], [1, '1']])),
        field('Fim', select(q, 'max', [3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, String(n)])))),
        el('div', { class: 'cols2' },
          field('Rótulo do início', text(q, 'rotulo_min', { placeholder: 'Ex.: Nada provável' })),
          field('Rótulo do fim', text(q, 'rotulo_max', { placeholder: 'Ex.: Muito provável' }))));
    }
    if (q.tipo !== 'aviso') {
      const keyInput = el('input', { class: 'input mono', value: q.chave });
      keyInput.addEventListener('input', () => { q._auto = false; q.chave = keyInput.value; touch(); });
      keyInput.addEventListener('blur', () => { q.chave = uniqueKey(slugKey(keyInput.value) || 'pergunta', q); keyInput.value = q.chave; touch(); });
      const prefill = el('input', { class: 'input mono', value: (q.prefill || []).join(', '), placeholder: 'email, buyer_email' });
      prefill.addEventListener('input', () => { q.prefill = prefill.value.split(',').map(s => s.trim()).filter(Boolean); touch(); });
      parts.push(el('div', { class: 'section' }, el('h3', { text: 'Dados' }),
        field('Chave (identificador)', keyInput, 'Nome da resposta nos webhooks e nas exportações. Use letras minúsculas e “_”.'),
        TEXTLIKE.includes(q.tipo) && field('Preencher a partir da URL', prefill, 'Parâmetros de URL que preenchem esta pergunta. Ex.: ?email=ana@x.com')));
      parts.push(webhookSection(q.webhook, {
        questionId: q.id, title: 'Webhook desta pergunta',
        description: 'Dispara quando a pessoa responde esta pergunta e avança, sem esperar o fim do formulário. Envia a resposta, as respostas anteriores e os dados de rastreio (UTMs).'
      }));
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
          onclick: () => { Object.assign(t, { fundo: p.fundo, texto: p.texto, destaque: p.destaque }); renderPanel(); touch(); }
        }, el('i', {}, el('b', { style: `background:${p.fundo}` }), el('b', { style: `background:${p.destaque}` })), p.nome)))),
      el('div', { class: 'section' }, el('h3', { text: 'Cores' }),
        el('div', { class: 'cols2' }, field('Fundo', color(t, 'fundo')), field('Texto', color(t, 'texto'))),
        field('Cor de destaque (botões, progresso, seleção)', color(t, 'destaque'))),
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
      el('div', { class: 'section' }, el('h3', { text: 'Consentimento' }),
        toggle(sch().consentimento, 'ativo', 'Exigir autorização antes de enviar (LGPD)', { rerender: true }),
        sch().consentimento.ativo && field('Texto da autorização', text(sch().consentimento, 'texto', { multiline: true, rows: 3 }))),
      webhookSection(a.webhook_final, {
        title: 'Webhook de conclusão', description: 'Dispara uma vez, quando a pessoa envia o formulário, com todas as respostas. Os webhooks por pergunta ficam em cada pergunta.'
      }),
      el('div', { class: 'section' }, el('h3', { text: 'Comportamento' }),
        toggle(a, 'mostrar_progresso', 'Mostrar barra e contador de progresso'),
        toggle(a, 'mostrar_numero', 'Mostrar o número de cada pergunta'),
        toggle(a, 'uma_vez', 'Impedir nova resposta no mesmo navegador depois de enviar'),
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

  function renderTop() {
    const titleInput = el('input', { class: 'input ed-title', value: S.titulo, 'aria-label': 'Nome do formulário' });
    titleInput.addEventListener('input', () => { S.titulo = titleInput.value; touch(); });
    fill(topEl, 
      el('a', { class: 'btn ghost sm', href: '#/' }, '← Formulários'),
      titleInput, tabsEl, el('div', { class: 'grow' }), stateEl,
      el('a', { class: 'btn sm', href: `#/forms/${id}/results` }, 'Resultados'),
      S.status === 'published' && el('button', { class: 'btn sm', onclick: () => copy(formUrl(S.slug)) }, 'Copiar link'),
      S.status === 'published'
        ? el('button', { class: 'btn sm', onclick: async () => { S.status = 'draft'; renderTop(); if (await save()) toast('Formulário despublicado'); } }, 'Despublicar')
        : null,
      el('button', {
        class: 'btn primary sm',
        async onclick() {
          S.status = 'published'; S.problemas = [];
          if (await save()) { toast('Publicado! Link pronto para compartilhar'); renderTop(); renderPanel(); }
          else { S.status = 'draft'; renderTop(); renderPanel(); }
        }
      }, S.status === 'published' ? 'Publicar alterações' : 'Publicar'));
    if (S.status === 'published') topEl.querySelector('.save-state').before(el('span', { class: 'pill ok', text: 'Publicado' }));
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
