import { el, fill, api, toast, copy, TIPOS, formUrl, plain, fmtDate, icon, tip, popMenu, typeIcon, statusPill, qrSvg, qrPngBlob, downloadBlob } from './ui.js';
import { THEME_PRESETS } from './templates.js';

const CHOICE = ['unica', 'multipla', 'dropdown'];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO','Exterior'];
const TEXTLIKE = ['texto', 'longo', 'email', 'telefone', 'numero', 'url'];
const FONTS = ['Inter', 'Manrope', 'DM Sans', 'Poppins', 'Montserrat', 'Space Grotesk', 'Sora', 'Outfit', 'Playfair Display', 'Lora'];
const TOKENS_HINT = 'Dica: *palavra* destaca na cor do tema. {nome} mostra a resposta da pergunta “nome”.';

const branchValuesOf = q => (q.tipo === 'unica' ? [...q.opcoes.filter(Boolean), ...(q.outra ? ['Outra'] : [])]
  : q.tipo === 'dropdown' ? q.opcoes.filter(Boolean).concat(q.outra ? ['Outra'] : [])
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
  const stateEl = el('span', { class: 'save-state', role: 'status', text: 'Salvo' });
  let saving = null, pending = false, dirty = false;

  function touch() {
    dirty = true;
    stateEl.textContent = S.status === 'published' ? 'Não publicado' : 'Não salvo';
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
        dirty = false; S.slugErro = ''; form.slug = S.slug; stateEl.textContent = 'Salvo'; stateEl.classList.remove('dirty');
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
  const previewKey = () => (S.sel === 'envio' ? 'submit' : S.sel === 'final' || S.sel === 'pontuacao' ? 'done' : S.sel === 'encerrado' ? S.previewSub : S.sel);
  function sendPreview() {
    if (!ready) return;
    frame.contentWindow?.postMessage({ type: 'ctf-schema', schema: sch(), titulo: S.titulo, goto: S.tab === 'conteudo' ? previewKey() : undefined, resultado: S.resIdx || 0 }, location.origin);
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
    saveBtn.textContent = S.status === 'published' ? 'Publicar alterações' : 'Salvar';
    saveBtn.title = 'Cmd/Ctrl + S';
  }

  /* ----- field helpers ----- */
  // label · control · visible hint (only when it matters) · tip (help hidden behind an icon)
  const field = (label, control, hint, help) => el('div', { class: 'field' },
    label && el('label', {}, ...labelParts(label), help && tip(help)), control, hint && el('p', { class: 'hint', text: hint }));
  const labelParts = label => { const m = /^(.*?)\s*\((opcional)\)$/.exec(label); return m ? [m[1], el('span', { class: 'opt', text: 'opcional' })] : [label]; };
  const more = (label, ...children) => el('details', { class: 'more' }, el('summary', {}, label, icon('chevron', 15)), el('div', { class: 'more-body' }, ...children));
  const head = (title, eyebrow, ...actions) => el('div', { class: 'panel-head' },
    el('div', { class: 'grow', style: 'min-width:0' }, eyebrow && el('div', { class: 'eyebrow' }, ...[eyebrow].flat()), el('h2', { text: title })), ...actions);
  function text(obj, key, { multiline, placeholder, rows, onchange, type } = {}) {
    const node = el(multiline ? 'textarea' : 'input', { class: multiline ? 'textarea' : 'input', value: obj[key] ?? '', placeholder, rows, type: multiline ? undefined : type });
    node.addEventListener('input', () => { obj[key] = node.value; onchange?.(node.value); touch(); });
    return node;
  }
  function toggle(obj, key, label, opts = {}) {
    const { onchange, rerender } = opts;
    const input = el('input', { type: 'checkbox', checked: !!obj[key] });
    input.addEventListener('change', () => { obj[key] = input.checked; onchange?.(); touch(); if (rerender) renderPanel(); });
    return el('label', { class: 'switch' }, input, el('span', { text: label }), opts.help && tip(opts.help));
  }
  function select(obj, key, options, onchange) {
    const node = el('select', { class: 'select' }, options.map(([v, l]) => el('option', { value: v, text: l })));
    node.value = obj[key];
    node.addEventListener('change', () => { obj[key] = isNaN(obj[key]) ? node.value : Number(node.value); onchange?.(); touch(); });
    return node;
  }
  function color(obj, key) {
    const picker = el('input', { type: 'color', value: obj[key] });
    const hex = el('input', { class: 'input mono', value: obj[key], maxlength: 7, 'aria-label': 'Código da cor' });
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
  function imageField(obj, key, label, help, onchange) {
    const holder = el('div');
    const draw = () => {
      const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', hidden: true });
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { obj[key] = await upload(input.files[0]); touch(); onchange?.(); draw(); } catch (e) { toast(e.message, 'err'); }
      });
      fill(holder, el('div', { class: 'upload' },
        obj[key] && el('img', { src: obj[key], alt: '' }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, icon('upload', 14), obj[key] ? 'Trocar' : 'Enviar imagem'),
        obj[key] && el('button', { class: 'btn ghost sm danger', type: 'button', onclick: () => { obj[key] = ''; touch(); onchange?.(); draw(); } }, 'Remover'), input));
    };
    draw();
    return field(label, holder, undefined, help);
  }

  /* ----- webhook: one per form, fired on completion and/or when one chosen question is answered ----- */
  function webhookCard() {
    const w = sch().ajustes.webhook;
    const result = el('span', { class: 'hint' });
    const logs = el('div', { class: 'log-list' });
    api('GET', `/forms/${id}/webhook-logs`).then(({ logs: rows }) => {
      fill(logs, rows.length > 0 && el('p', { class: 'hint', text: 'Últimos envios' }), rows.slice(0, 5).map(l => el('div', { class: 'log' },
        el('span', { class: `pill ${l.ok ? 'ok' : 'err'}`, title: l.ok ? `HTTP ${l.status}` : l.error || '', text: l.ok ? 'Entregue' : 'Falhou' }),
        el('span', { class: 'url', text: l.event === 'form.completed' ? 'Formulário concluído' : l.event.endsWith('.test') ? 'Teste' : 'Pergunta respondida' }),
        el('span', { class: 'when', text: fmtDate(l.at) }))));
    }).catch(() => {});
    // Sends a sample response (fictitious answers to the questions on screen, same shape as a real send) and shows what went.
    const sent = el('div');
    const test = async perguntaId => {
      if (!w.url) { result.className = 'hint'; result.textContent = 'Cole o endereço primeiro.'; return; }
      result.className = 'hint'; result.textContent = 'Enviando…'; result.title = '';
      try {
        const { resultado: r, payload } = await api('POST', `/forms/${id}/webhook-test`, { url: w.url, segredo: w.segredo, pergunta_id: perguntaId, schema: sch(), titulo: S.titulo });
        result.className = `pill ${r.ok ? 'ok' : 'err'}`;
        result.textContent = r.ok ? 'Recebido' : `Falhou: ${r.error || `HTTP ${r.status}`}`;
        result.title = r.ok ? `HTTP ${r.status} · ${r.ms}ms` : '';
        const json = JSON.stringify(payload, null, 2);
        fill(sent, el('details', { class: 'more payload', open: true },
          el('summary', {}, 'Dados enviados', el('span', { class: 'muted', style: 'font-weight:400', text: perguntaId ? '· pergunta respondida' : '· formulário concluído' }), icon('chevron', 15)),
          el('div', { class: 'more-body' },
            el('div', { class: 'row', style: 'margin-bottom:8px' }, el('p', { class: 'hint grow', text: 'Respostas fictícias, no mesmo formato do envio real. O campo "teste": true marca que é um exemplo.' }),
              el('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(json); toast('Dados copiados'); } catch { prompt('Copie os dados:', json); } } }, icon('copy', 14), 'Copiar')),
            el('pre', { class: 'code', text: json }))));
      } catch (e) { result.className = 'pill err'; result.textContent = e.message; }
    };
    const box = el('div', { class: 'section' }, el('h3', {}, 'Webhook', tip('Manda as respostas sozinho para outro sistema (CRM, planilha, Zapier, Make, n8n…).')),
      el('p', { class: 'hint', text: 'Para onde e quando enviar as respostas.' }),
      field('Endereço de destino', text(w, 'url', { placeholder: 'https://…', type: 'url' }), undefined, 'A URL do webhook que vai receber as respostas.'),
      el('div', { class: 'label', style: 'margin-bottom:10px' }, 'Quando enviar'),
      toggle(w, 'ao_concluir', 'Quando a pessoa concluir'),
      toggle(w, 'ao_responder', 'Quando responder uma pergunta', { rerender: true, onchange: refresh }));
    if (w.ao_responder) {
      const sel = el('select', { class: 'select', 'aria-label': 'Pergunta' }, [['', 'Escolha a pergunta…'], ...sch().perguntas.map((q, i) => [q.id, `${i + 1}. ${plain(q.rotulo).slice(0, 56) || 'Sem título'}`]).filter((_, i) => sch().perguntas[i].tipo !== 'aviso')]
        .map(([v, l]) => el('option', { value: v, text: l })));
      sel.value = w.pergunta;
      sel.addEventListener('change', () => { w.pergunta = sel.value; touch(); refresh(); });
      box.append(el('div', { class: 'field', style: 'margin:-4px 0 16px 42px' }, sel));
    }
    box.append(
      more('Segurança', field('Chave secreta (opcional)', text(w, 'segredo', { placeholder: 'Uma frase longa' }), undefined, 'Usada para assinar cada envio (cabeçalho X-Webhook-Signature). Assim o outro sistema confere que veio daqui.')),
      el('div', { class: 'row wrap', style: 'margin-top:12px' },
        el('button', { class: 'btn sm', type: 'button', title: 'Envia uma resposta fictícia completa, como se alguém tivesse concluído o formulário', onclick: () => test(undefined) }, icon('send', 14), 'Enviar exemplo'),
        w.ao_responder && w.pergunta && el('button', { class: 'btn sm ghost', type: 'button', title: 'Envia como se a pessoa tivesse acabado de responder a pergunta escolhida', onclick: () => test(w.pergunta) }, 'Exemplo da pergunta'),
        result), sent, logs);
    return box;
  }

  /* ----- Integrações tab (shown while the webhook is on in Ajustes) ----- */
  const valueOptionsOf = q => (['unica', 'multipla', 'dropdown'].includes(q.tipo) ? [...q.opcoes.filter(Boolean), ...(q.outra ? ['Outra'] : [])]
    : q.tipo === 'matriz' ? q.opcoes.filter(Boolean) : q.tipo === 'sim_nao' ? ['Sim', 'Não']
    : q.tipo === 'escala' ? Array.from({ length: q.max - q.min + 1 }, (_, k) => String(q.min + k)) : []);

  // What each answer sends: the label the person saw (default) or a custom value.
  function valuesSection() {
    const qs = sch().perguntas.map((q, i) => ({ q, i })).filter(({ q }) => q.tipo !== 'aviso');
    const withOpts = qs.filter(({ q }) => valueOptionsOf(q).length);
    const open = qs.filter(({ q }) => !valueOptionsOf(q).length);
    const card = ({ q, i }) => {
      q.valores ??= {};
      const rows = valueOptionsOf(q).map(o => {
        const input = el('input', { class: 'input mono', value: q.valores[o] ?? '', placeholder: o, 'aria-label': `Valor enviado para “${o}”` });
        input.addEventListener('input', () => { const v = input.value.trim(); if (v && v !== o) q.valores[o] = input.value; else delete q.valores[o]; touch(); });
        return el('div', { class: 'val-row' }, el('span', { class: 'route-val', title: o, text: q.tipo === 'escala' ? faceFor(q, Number(o)) : o }), icon('right', 14), input);
      });
      return el('div', { class: 'rule' },
        el('div', { class: 'val-head' }, typeIcon(q.tipo), el('b', { class: 'grow', text: `${i + 1}. ${plain(q.rotulo) || 'Sem título'}` }), el('code', { class: 'key', title: 'Nome do campo no webhook', text: q.chave })),
        el('div', { class: 'val-cols' }, el('span', { text: 'Resposta' }), el('span'), el('span', { text: 'Valor enviado' })),
        rows);
    };
    return el('div', { class: 'section' },
      el('h3', {}, 'Valores das respostas', tip('O webhook envia o valor. Vazio: envia o próprio texto da opção. A planilha CSV traz as duas colunas (texto e valor); o painel continua mostrando o texto.')),
      el('p', { class: 'hint', text: 'Troque o que é enviado para cada opção. Ex.: “De R$ 1.000 a R$ 2.000” → abaixo_2000.' }),
      withOpts.length ? withOpts.map(card) : el('p', { class: 'note' }, icon('info', 14), 'Nenhuma pergunta de opções ainda.'),
      open.length > 0 && el('p', { class: 'hint', style: 'margin-top:8px' }, `Perguntas abertas enviam o que a pessoa digitou: ${open.map(({ q }) => q.chave).join(', ')}.`));
  }

  // Hidden fields sent with every webhook, never shown to the respondent (e.g. user_tag).
  function extrasSection() {
    const w = sch().ajustes.webhook;
    w.extras ??= [];
    const holder = el('div');
    let rows = [];
    // Validates names in place (no redraw), so moving from one field to the next never loses focus or typing.
    const check = () => {
      const qKeys = new Set(sch().perguntas.map(q => q.chave));
      for (const r of rows) {
        const k = r.x.chave, dup = w.extras.filter(x => x.chave === k).length > 1;
        const bad = !k ? '' : !/^[a-z0-9_]+$/.test(k) ? 'Use letras minúsculas, números e _.' : qKeys.has(k) ? 'Já é o nome de uma pergunta.' : dup ? 'Nome repetido.' : '';
        r.key.classList.toggle('bad', !!bad); r.hint.textContent = bad; r.hint.hidden = !bad;
      }
    };
    const draw = focus => {
      rows = w.extras.map((x, i) => {
        const key = el('input', { class: 'input mono', value: x.chave, placeholder: 'user_tag', 'aria-label': 'Nome do campo' });
        const val = el('input', { class: 'input', value: x.valor, placeholder: 'Ex.: lead-quente', 'aria-label': 'Valor' });
        const hint = el('p', { class: 'hint', style: 'color:var(--err);margin:-4px 0 8px', hidden: true });
        key.addEventListener('input', () => { x.chave = key.value; touch(); check(); });
        key.addEventListener('blur', () => { const k = slugKey(key.value); if (k !== key.value) { x.chave = k; key.value = k; touch(); } check(); });
        val.addEventListener('input', () => { x.valor = val.value; touch(); });
        if (focus === i) setTimeout(() => key.focus(), 0);
        const row = el('div', { class: 'extra-grid' }, key, val,
          el('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Remover campo', onclick: () => { w.extras.splice(i, 1); touch(); draw(); } }, icon('x', 15)));
        return { x, key, hint, row };
      });
      fill(holder,
        w.extras.length > 0 && el('div', { class: 'grid-head extra-grid' }, el('span', { text: 'Nome do campo' }), el('span', { text: 'Valor' }), el('span')),
        rows.map(r => [r.row, r.hint]),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { w.extras.push({ chave: '', valor: '' }); touch(); draw(w.extras.length - 1); } }, icon('plus', 14), 'Campo'));
      check();
    };
    draw();
    return el('div', { class: 'section' },
      el('h3', {}, 'Campos personalizados', tip('Vão junto das respostas em todo envio, com o nome e o valor que você definir. A pessoa nunca vê. O valor aceita {chave} para usar uma resposta, ex.: {renda_mensal}.')),
      el('p', { class: 'hint', text: 'Dados extras que não aparecem no formulário, como uma tag do lead.' }),
      holder);
  }

  function integrationsPanel() {
    return el('div', {}, head('Integrações'), webhookCard(), valuesSection(), extrasSection());
  }

  /* ----- left list ----- */
  const listEl = el('aside', { class: 'ed-list' });
  const panelEl = el('div', { class: 'ed-panel' });
  const bodyEl = el('div', { class: 'ed-body' });
  let dragFrom = null;

  function select_(key) { S.sel = key; renderList(); renderPanel(); sendPreview(); }

  function item(key, badge, label, extra = {}) {
    const node = el('div', { class: `li${S.sel === key ? ' sel' : ''}${extra.off ? ' off' : ''}`, role: 'button', tabindex: '0', 'aria-current': S.sel === key ? 'true' : undefined,
      onclick: () => select_(key), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select_(key); } }, ...(extra.draggable ? { draggable: 'true' } : {}) },
      extra.draggable && el('span', { class: 'grab', 'aria-hidden': 'true' }, icon('grip', 12)),
      typeof badge === 'string' ? el('span', { class: 'badge' }, icon(badge, 14)) : badge,
      el('span', { class: 'txt' }, extra.n && el('em', { text: extra.n }), label),
      extra.route && el('span', { class: 'mark', title: 'Tem lógica: pula para outra pergunta' }, icon('route', 14)),
      extra.hook && el('span', { class: 'mark hook', title: 'Envia para a integração ao responder' }, icon('zap', 14)));
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

  /* ----- question groups (Configurações › Grupos de perguntas) ----- */
  let groupsCache = null;
  const loadGroups = async () => (groupsCache ??= (await api('GET', '/groups')).grupos);

  // Inserts copies of a group's questions at the end (like a single new question), with fresh ids and unique field names.
  function insertGroup(g) {
    const qs = sch().perguntas;
    const copies = g.perguntas.map(q => ({ ...JSON.parse(JSON.stringify(q)), id: newId(), proxima: '', ramos: {}, _auto: false }));
    for (const c of copies) c.chave = uniqueKey(c.chave || slugKey(plain(c.rotulo)) || 'pergunta', c);
    // uniqueKey only sees questions already in the form, so dedupe within the group too.
    const seen = new Set(qs.map(q => q.chave));
    for (const c of copies) { let k = c.chave, n = 2; while (seen.has(k)) k = `${c.chave}_${n++}`; c.chave = k; seen.add(k); }
    qs.push(...copies);
    S.tab = 'conteudo'; syncTabs();
    select_(copies[0].id); touch();
    toast(`${copies.length} pergunta${copies.length === 1 ? '' : 's'} de “${g.nome}” adicionada${copies.length === 1 ? '' : 's'}`);
  }

  // Saves questions of this form as a reusable group.
  function saveAsGroup(preselect) {
    const qs = sch().perguntas;
    if (!qs.length) { toast('Crie perguntas primeiro.', 'err'); return; }
    const name = el('input', { class: 'input', placeholder: 'Ex.: Dados pessoais', maxlength: 80, required: true });
    const checks = qs.map(q => el('input', { type: 'checkbox', checked: preselect ? q.id === preselect : false, value: q.id }));
    const err = el('p', { class: 'notice err', hidden: true });
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Salvar grupo');
    const dialog = el('dialog', { class: 'create-dialog', style: 'width:min(520px,calc(100vw - 32px))', onclose: () => dialog.remove(), onclick: e => { if (e.target === dialog) dialog.close(); } },
      el('form', { class: 'create-form', onsubmit: async e => {
        e.preventDefault();
        const picked = qs.filter((q, i) => checks[i].checked);
        if (!picked.length) { err.textContent = 'Marque pelo menos uma pergunta.'; err.hidden = false; return; }
        btn.disabled = true;
        try {
          await api('POST', '/groups', { nome: name.value.trim(), perguntas: picked.map(({ _auto, ...q }) => q) });
          groupsCache = null; dialog.close(); toast(`Grupo “${name.value.trim()}” salvo. Use em Adicionar pergunta › Grupos.`);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      } },
        el('div', { class: 'create-dialog-head' }, el('div', {}, el('h2', { text: 'Salvar como grupo' }), el('p', { class: 'muted', text: 'Reutilize estas perguntas em outros formulários.' })),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dialog.close() }, icon('x', 18))),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Nome do grupo' }), name),
        el('div', { class: 'field' }, el('div', { class: 'row' }, el('span', { class: 'label grow', text: 'Perguntas' }),
          el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { const all = checks.every(c => c.checked); checks.forEach(c => { c.checked = !all; }); } }, 'Marcar todas')),
          el('div', { class: 'pick-list' }, qs.map((q, i) => el('label', {}, checks[i], typeIcon(q.tipo), el('span', { class: 'txt' }, el('em', { class: 'muted', style: 'font-style:normal;margin-right:4px', text: String(i + 1) }), plain(q.rotulo) || 'Sem título'))))),
        err,
        el('div', { class: 'create-dialog-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), btn)));
    document.body.append(dialog); dialog.showModal(); name.focus();
  }

  async function openAddMenu(anchor) {
    document.querySelector('.menu')?.remove();
    const rect = anchor.getBoundingClientRect();
    const grupos = await loadGroups().catch(() => []);
    const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Adicionar pergunta', style: `left:${Math.max(8, rect.left)}px;top:${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 420))}px` },
      grupos.length > 0 && [el('div', { class: 'menu-sep', text: 'Grupos' }),
        grupos.map(g => el('button', { type: 'button', role: 'menuitem', title: g.perguntas.map(q => plain(q.rotulo)).join(' · '), onclick: () => { done(); insertGroup(g); } },
          el('span', { class: 'badge grp' }, icon('layers', 14)), el('span', {}, g.nome, el('small', { text: `${g.perguntas.length} pergunta${g.perguntas.length === 1 ? '' : 's'}${g.descricao ? ` · ${g.descricao}` : ''}` })))),
        el('hr'), el('div', { class: 'menu-sep', text: 'Pergunta avulsa' })],
      Object.entries(TIPOS).map(([tipo, t]) => el('button', { type: 'button', role: 'menuitem', onclick: () => { done(); addQuestion(tipo); } },
        typeIcon(tipo), el('span', {}, t.nome, el('small', { text: t.desc })))),
      el('hr'),
      el('a', { class: 'menu-link', href: '#/config', role: 'menuitem', onclick: e => { if (dirty && !confirm('Há alterações não salvas. Sair sem salvar?')) e.preventDefault(); done(); } }, icon('settings', 14), 'Gerenciar grupos'));
    document.body.append(menu);
    const done = () => { menu.remove(); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    const close = e => { if (!menu.contains(e.target)) done(); };
    const esc = e => { if (e.key === 'Escape') { done(); anchor.focus(); } };
    setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); }, 0);
    menu.querySelector('button')?.focus();
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
      opcoes: CHOICE.includes(tipo) ? ['Opção 1', 'Opção 2'] : tipo === 'matriz' ? ['Discordo', 'Neutro', 'Concordo'] : [], linhas: tipo === 'matriz' ? ['Afirmação 1', 'Afirmação 2'] : [], outra: false, exclusivas: [], compacta: false,
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
      item('welcome', 'flag', sch().boas_vindas.ativo ? plain(sch().boas_vindas.titulo) || 'Boas-vindas' : 'Boas-vindas (desligada)', { off: !sch().boas_vindas.ativo }),
      el('div', { class: 'list-sep' }, 'Perguntas', el('span', { class: 'num', style: 'margin-left:6px', text: String(qs.length) }), el('span', { class: 'grow' }),
        qs.length > 0 && el('button', { class: 'icon-btn', style: 'width:24px;height:24px', type: 'button', title: 'Salvar perguntas como grupo', 'aria-label': 'Salvar perguntas como grupo', onclick: () => saveAsGroup(qs.some(q => q.id === S.sel) ? S.sel : null) }, icon('layers', 14))),
      qs.map((q, i) => item(q.id, typeIcon(q.tipo), plain(q.rotulo) || 'Sem título', { n: String(i + 1), draggable: true, index: i, hook: sch().ajustes.webhook.ao_responder && sch().ajustes.webhook.pergunta === q.id, route: hasRouting(q) })),
      el('button', { class: 'add-q', type: 'button', onclick: e => openAddMenu(e.currentTarget) }, icon('plus', 15), 'Adicionar pergunta'),
      el('div', { class: 'list-sep', text: 'Final' }),
      item('envio', 'send', 'Botão de envio'),
      item('final', 'done', 'Tela de obrigado'),
      item('pontuacao', 'sigma', 'Pontuação', { off: !sch().pontuacao?.ativo }),
      item('encerrado', 'clock', 'Agenda'));
  }

  /* ----- panels ----- */
  function problemsBox() {
    return S.problemas.length ? el('div', { class: 'notice err' }, el('b', { text: 'Não foi possível publicar:' }), el('ul', {}, S.problemas.map(p => el('li', { text: p })))) : null;
  }

  function renderPanel() {
    let content;
    if (S.tab === 'design') content = designPanel();
    else if (S.tab === 'ajustes') content = settingsPanel();
    else if (S.tab === 'integracoes') content = integrationsPanel();
    else if (S.sel === 'welcome') content = welcomePanel();
    else if (S.sel === 'envio') content = envioPanel();
    else if (S.sel === 'final') content = finalPanel();
    else if (S.sel === 'pontuacao') content = pontuacaoPanel();
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
      head('Boas-vindas', [icon('flag', 14), 'Início']),
      toggle(w, 'ativo', 'Mostrar uma tela de abertura', { rerender: true, onchange: refresh }),
      w.ativo && el('div', { style: 'margin-top:20px' },
        field('Título', text(w, 'titulo', { multiline: true, rows: 2, onchange: refresh }), undefined, TOKENS_HINT),
        field('Texto', text(w, 'texto', { multiline: true, rows: 3 })),
        field('Botão', text(w, 'botao')),
        more('Mais detalhes',
          field('Etiqueta acima do título (opcional)', text(w, 'eyebrow', { placeholder: 'Ex.: Pesquisa · 2 minutos' })),
          field('Nota abaixo do botão (opcional)', text(w, 'nota', { placeholder: 'Ex.: leva menos de 2 minutos' })))));
  }

  function envioPanel() {
    const e = sch().envio;
    return el('div', {},
      head('Botão de envio', [icon('send', 14), 'Final']),
      sch().consentimento.ativo && el('div', {},
        el('p', { class: 'note', style: 'margin:0 0 20px' }, icon('info', 14), 'Com o consentimento (LGPD) ligado, uma tela pede a confirmação antes de enviar.'),
        field('Título', text(e, 'titulo', { multiline: true, rows: 2 }), undefined, TOKENS_HINT),
        field('Texto', text(e, 'texto', { multiline: true, rows: 3 }))),
      field('Texto do botão', text(e, 'botao')),
      !sch().consentimento.ativo && el('p', { class: 'hint', style: 'margin-top:4px' }, 'Quer pedir consentimento (LGPD)? Ligue em ', el('a', { href: '#', style: 'color:var(--accent);font-weight:550', onclick: ev => { ev.preventDefault(); S.tab = 'ajustes'; syncTabs(); } }, 'Ajustes'), '.'));
  }

  /* ----- matrix rows ----- */
  const LET = 'ABCDEFGHIJKL';
  function linesEditor(q) {
    const holder = el('div');
    const draw = focus => fill(holder,
      q.linhas.map((txt, i) => {
        const input = el('input', { class: 'input', value: txt, placeholder: `Afirmação ${i + 1}`, 'aria-label': `Linha ${LET[i]}` });
        input.addEventListener('input', () => { q.linhas[i] = input.value; touch(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.linhas.splice(i + 1, 0, ''); draw(i + 1); touch(); } });
        if (focus === i) setTimeout(() => input.focus(), 0);
        return el('div', { class: 'opt-row' }, el('span', { class: 'letter', text: LET[i] || '' }), input,
          el('button', { class: 'icon-btn', type: 'button', title: 'Remover', 'aria-label': `Remover linha ${LET[i]}`, onclick: () => { q.linhas.splice(i, 1); draw(); touch(); } }, icon('x', 15)));
      }),
      q.linhas.length < 12 && el('button', { class: 'btn ghost sm', type: 'button', style: 'margin-left:24px', onclick: () => { q.linhas.push(''); draw(q.linhas.length - 1); touch(); } }, icon('plus', 14), 'Linha'));
    draw();
    return holder;
  }

  /* ----- scoring: variables, point rules and result screens ----- */
  const CMP_OPS = [['gte', '≥ maior ou igual a'], ['gt', '> maior que'], ['lte', '≤ menor ou igual a'], ['lt', '< menor que'], ['eq', '= igual a'], ['ne', '≠ diferente de']];
  const rid = prefix => `${prefix}${Math.random().toString(16).slice(2, 10)}`;

  function pontuacaoPanel() {
    const P = sch().pontuacao;
    const holder = el('div');
    const answerable = () => sch().perguntas.filter(q => q.tipo !== 'aviso');
    const qLabel = q => `${sch().perguntas.indexOf(q) + 1}. ${plain(q.rotulo).slice(0, 40) || 'Sem título'}`;
    const pick = (value, options, onchange, label) => {
      const node = el('select', { class: 'select', 'aria-label': label }, options.map(([v, l]) => el('option', { value: v, text: l })));
      node.value = value;
      node.addEventListener('change', () => { onchange(node.value); touch(); });
      return node;
    };
    const num = (value, oninput, label, placeholder) => {
      const n = el('input', { class: 'input num-in', type: 'number', value: value ?? '', placeholder, 'aria-label': label });
      n.addEventListener('input', () => { oninput(n.value); touch(); });
      return n;
    };
    const del = (label, fn) => el('button', { class: 'icon-btn danger', type: 'button', title: label, 'aria-label': label, onclick: () => { fn(); touch(); draw(); } }, icon('x', 15));
    const varOptions = () => P.variaveis.map(v => [v.chave, v.nome || v.chave]);
    const uniqueVar = base => { let k = base, n = 2; while (P.variaveis.some(v => v.chave === k)) k = `${base}_${n++}`; return k; };

    const dropVar = v => {
      P.regras = P.regras.filter(r => r.variavel !== v.chave);
      for (const res of P.resultados) res.condicoes = res.condicoes.filter(c => c.variavel !== v.chave && c.com !== `var:${v.chave}`);
      P.variaveis = P.variaveis.filter(x => x !== v);
    };
    const renameVar = (v, next) => {
      const old = v.chave;
      v.chave = next;
      for (const r of P.regras) if (r.variavel === old) r.variavel = next;
      for (const res of P.resultados) for (const c of res.condicoes) { if (c.variavel === old) c.variavel = next; if (c.com === `var:${old}`) c.com = `var:${next}`; }
    };

    const variablesSection = () => el('div', { class: 'section' },
      el('h3', {}, 'Variáveis', tip('Cada variável soma pontos conforme as respostas (ex.: oferta, tese, volume). “Tag a partir de” gera uma tag no webhook quando a soma chega nesse valor; vazio não marca.')),
      el('p', { class: 'hint', text: 'Os placares que as respostas vão somar.' }),
      P.variaveis.length > 0 && el('div', { class: 'grid-head var-grid' }, el('span', { text: 'Nome' }), el('span', { text: 'Chave' }), el('span', { text: 'Tag a partir de' }), el('span')),
      P.variaveis.map(v => {
        const nome = text(v, 'nome', { placeholder: 'Nome' });
        nome.setAttribute('aria-label', 'Nome da variável');
        const key = el('input', { class: 'input mono', value: v.chave, 'aria-label': 'Chave da variável' });
        key.addEventListener('change', () => {
          const next = slugKey(key.value);
          if (!next || P.variaveis.some(x => x !== v && x.chave === next)) { key.value = v.chave; return; }
          renameVar(v, next); key.value = next; touch(); draw();
        });
        return el('div', { class: 'var-grid' }, nome, key, num(v.corte, val => { v.corte = val === '' ? null : Number(val); }, 'Tag a partir de', 'sem tag'), del('Remover variável (e as regras que a usam)', () => dropVar(v)));
      }),
      el('button', { class: 'btn sm', type: 'button', onclick: () => { P.variaveis.push({ id: rid('v'), chave: uniqueVar('variavel'), nome: 'Nova variável', corte: null }); touch(); draw(); } }, icon('plus', 14), 'Variável'));

    const ruleRow = (r, ri) => {
      const q = sch().perguntas.find(x => x.id === r.pergunta) || answerable()[0];
      const isMx = q?.tipo === 'matriz';
      const ops = isMx ? OPS.choice : q ? opsFor(q) : OPS.text;
      if (!ops.some(([v]) => v === r.op)) r.op = ops[0][0];
      if (isMx && !r.linha) r.linha = 'A';
      if (!isMx) r.linha = '';
      const values = q ? valuesFor(q) : null;
      let valueEl;
      if (values) valueEl = pick(r.valor, [['', 'Escolha…'], ...values.map(v => [v, q.tipo === 'escala' ? faceFor(q, Number(v)) : v])], val => { r.valor = val; }, 'Resposta');
      else {
        valueEl = el('input', { class: 'input', value: r.valor, placeholder: 'Valor', 'aria-label': 'Resposta' });
        valueEl.addEventListener('input', () => { r.valor = valueEl.value; touch(); });
      }
      return el('div', { class: 'rule' },
        el('div', { class: 'pt-row' }, el('span', { class: 'cond-and', text: 'Se' }),
          pick(q?.id || '', answerable().map(o => [o.id, qLabel(o)]), val => { r.pergunta = val; r.valor = ''; r.linha = ''; r.op = 'igual'; draw(); }, 'Pergunta'),
          del('Remover regra', () => P.regras.splice(ri, 1))),
        el('div', { class: 'pt-row' }, el('span'),
          isMx && pick(r.linha, (q.linhas || []).map((t, i) => [LET[i], `${LET[i]}. ${String(t).slice(0, 28)}`]), val => { r.linha = val; }, 'Linha'),
          pick(r.op, ops, val => { r.op = val; }, 'Comparação'), valueEl),
        el('div', { class: 'pt-row' }, el('span', { class: 'cond-and', text: 'Soma' }),
          num(r.pontos, val => { r.pontos = Number(val) || 0; }, 'Pontos'),
          el('span', { class: 'muted', text: 'em' }),
          pick(r.variavel, varOptions(), val => { r.variavel = val; }, 'Variável')));
    };

    const rulesSection = () => el('div', { class: 'section' },
      el('h3', {}, 'Regras de pontos', tip('Quando a resposta combina, os pontos vão para a variável. Uma resposta pode pontuar em várias variáveis: crie uma regra para cada. Em matrizes, escolha também a linha.')),
      el('p', { class: 'hint', text: 'Qual resposta vale quantos pontos.' }),
      answerable().length === 0 && el('p', { class: 'notice', text: 'Crie perguntas antes de montar regras.' }),
      !P.variaveis.length && el('p', { class: 'note' }, icon('info', 14), 'Crie uma variável primeiro.'),
      P.regras.map(ruleRow),
      el('button', {
        class: 'btn sm', type: 'button', disabled: !answerable().length || !P.variaveis.length,
        onclick: () => { P.regras.push({ id: rid('p'), variavel: P.variaveis[0].chave, pergunta: answerable()[0].id, linha: '', op: 'igual', valor: '', pontos: 1 }); touch(); draw(); }
      }, icon('plus', 14), 'Regra'));

    const resCard = (res, ri) => {
      const move = d => { const j = ri + d; if (j < 0 || j >= P.resultados.length) return; [P.resultados[ri], P.resultados[j]] = [P.resultados[j], P.resultados[ri]]; touch(); draw(); };
      const refOptions = () => [...P.variaveis.map(v => [`var:${v.chave}`, v.nome || v.chave]), ['num', 'um número']];
      const cond = (c, ci) => {
        const isNum = c.com.startsWith('num:');
        return el('div', { class: 'pt-row' },
          el('span', { class: 'cond-and', text: ci === 0 ? 'Se' : 'e' }),
          pick(c.variavel, varOptions(), val => { c.variavel = val; }, 'Variável'),
          pick(c.op, CMP_OPS, val => { c.op = val; }, 'Comparação'),
          pick(isNum ? 'num' : c.com, refOptions(), val => { c.com = val === 'num' ? 'num:0' : val; draw(); }, 'Comparar com'),
          isNum && num(Number(c.com.slice(4)) || 0, val => { c.com = `num:${Number(val) || 0}`; }, 'Número'),
          del('Remover condição', () => res.condicoes.splice(ci, 1)));
      };
      const nameInput = text(res, 'nome', { placeholder: `Resultado ${ri + 1}` });
      nameInput.setAttribute('aria-label', 'Nome do resultado (só para você)');
      return el('div', { class: 'rule' },
        el('div', { class: 'rule-head' }, nameInput,
          el('button', { class: 'icon-btn', type: 'button', title: 'Ver na prévia', 'aria-label': 'Ver na prévia', onclick: () => { S.resIdx = ri; sendPreview(); } }, icon('eye', 15)),
          el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': 'Subir', disabled: ri === 0, onclick: () => move(-1) }, icon('up', 15)),
          el('button', { class: 'icon-btn', type: 'button', title: 'Descer', 'aria-label': 'Descer', disabled: ri === P.resultados.length - 1, onclick: () => move(1) }, icon('down', 15)),
          el('button', { class: 'icon-btn danger', type: 'button', title: 'Excluir resultado', 'aria-label': 'Excluir resultado', onclick: () => { P.resultados.splice(ri, 1); touch(); draw(); } }, icon('trash', 15))),
        el('div', { class: 'field' }, el('label', { text: 'Quando mostrar' }),
          res.condicoes.length ? res.condicoes.map(cond) : el('p', { class: 'note', style: 'margin:0' }, icon('info', 14), 'Sem condições: vale para quem não combinou com os de cima.'),
          el('button', {
            class: 'btn ghost sm', type: 'button', style: 'align-self:flex-start', disabled: !P.variaveis.length,
            onclick: () => { res.condicoes.push({ variavel: P.variaveis[0].chave, op: 'gte', com: P.variaveis[1] ? `var:${P.variaveis[1].chave}` : 'num:0' }); touch(); draw(); }
          }, icon('plus', 14), 'Condição')),
        field('Título', text(res, 'titulo', { multiline: true, rows: 2 }), undefined, TOKENS_HINT),
        field('Texto', text(res, 'texto', { multiline: true, rows: 6 }), undefined, 'Cada linha vira um parágrafo. Aceita {primeiro_nome} e outras chaves; {chave|min} deixa a primeira letra minúscula.'),
        el('div', { class: 'cols2' },
          field('Botão (opcional)', text(res, 'botao_texto', { placeholder: 'Ex.: Quero começar' })),
          field('Link do botão', text(res, 'botao_url', { placeholder: 'https://…', type: 'url' }), undefined, 'O botão só aparece quando há link.')),
        more('Mais detalhes',
          field('Produto em destaque (opcional)', text(res, 'produto', { placeholder: 'Ex.: Primeira Venda em 7 Dias' })),
          field('Chave', text(res, 'chave', { placeholder: 'oferta' }), undefined, 'Identifica este resultado no webhook de conclusão.')));
    };

    const resultsSection = () => el('div', { class: 'section' },
      el('h3', {}, 'Resultados', tip('Depois do envio, a pessoa vê a tela de obrigado e, logo abaixo, o primeiro resultado desta lista (de cima para baixo) cujas condições combinem. Deixe o último sem condições: ele vale como padrão e desempate.')),
      el('p', { class: 'hint', text: 'Um texto para cada perfil, mostrado no fim.' }),
      P.resultados.map(resCard),
      el('button', { class: 'btn sm', type: 'button', onclick: () => { P.resultados.push({ id: rid('r'), nome: '', chave: '', condicoes: [], titulo: '', texto: '', produto: '', botao_texto: '', botao_url: '' }); touch(); draw(); } }, icon('plus', 14), 'Resultado'));

    const draw = () => fill(holder,
      head('Pontuação', [icon('sigma', 14), 'Final']),
      toggle(P, 'ativo', 'Somar pontos e mostrar um resultado por perfil', { rerender: true, help: 'Os pontos, as tags e a chave do resultado também vão no webhook de conclusão.' }),
      P.ativo && el('div', { style: 'margin-top:20px' }, variablesSection(), rulesSection(), resultsSection()));
    draw();
    return holder;
  }

  function finalPanel() {
    const f = sch().final;
    return el('div', {},
      head('Tela de obrigado', [icon('done', 14), 'Final']),
      el('div', { class: 'section' },
        field('Título', text(f, 'titulo', { multiline: true, rows: 2 }), undefined, TOKENS_HINT),
        field('Texto', text(f, 'texto', { multiline: true, rows: 3 })),
        el('div', { class: 'cols2' },
          field('Botão (opcional)', text(f, 'cta_texto', { placeholder: 'Ex.: Entrar no grupo' })),
          field('Link do botão', text(f, 'cta_url', { placeholder: 'https://…', type: 'url' }))),
        more('Mais detalhes', field('Etiqueta acima do título (opcional)', text(f, 'etiqueta', { placeholder: 'Ex.: Inscrição recebida' })))),
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
    : q.tipo === 'dropdown' ? [...q.opcoes.filter(Boolean), ...(q.outra ? ['Outra'] : [])] : q.tipo === 'matriz' ? q.opcoes.filter(Boolean) : q.tipo === 'sim_nao' ? ['Sim', 'Não'] : q.tipo === 'cidade_uf' ? UFS
    : q.tipo === 'escala' ? Array.from({ length: q.max - q.min + 1 }, (_, k) => String(q.min + k)) : null);

  function redirectSection() {
    const r = sch().final.redirecionamento;
    const holder = el('div', { class: 'section' });
    const answerable = () => sch().perguntas.map((q, i) => ({ q, i })).filter(({ q }) => q.tipo !== 'aviso' && q.tipo !== 'matriz');

    const conditionRow = (rule, c, ci) => {
      const q = sch().perguntas.find(x => x.id === c.pergunta);
      const qSel = el('select', { class: 'select', 'aria-label': 'Pergunta' }, answerable().map(({ q: o, i }) => el('option', { value: o.id, text: `${i + 1}. ${plain(o.rotulo).slice(0, 40) || 'Sem título'}` })));
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
        el('button', { class: 'icon-btn', type: 'button', title: 'Remover condição', 'aria-label': 'Remover condição', onclick: () => { rule.condicoes.splice(ci, 1); touch(); draw(); } }, icon('x', 15)));
    };

    const ruleCard = (rule, ri) => {
      const move = d => { const j = ri + d; if (j < 0 || j >= r.regras.length) return; [r.regras[ri], r.regras[j]] = [r.regras[j], r.regras[ri]]; touch(); draw(); };
      const nameInput = text(rule, 'nome', { placeholder: `Regra ${ri + 1}` });
      nameInput.setAttribute('aria-label', 'Nome da regra');
      return el('div', { class: 'rule' },
        el('div', { class: 'rule-head' }, nameInput,
          el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': 'Subir regra', disabled: ri === 0, onclick: () => move(-1) }, icon('up', 15)),
          el('button', { class: 'icon-btn', type: 'button', title: 'Descer', 'aria-label': 'Descer regra', disabled: ri === r.regras.length - 1, onclick: () => move(1) }, icon('down', 15)),
          el('button', { class: 'icon-btn danger', type: 'button', title: 'Excluir regra', 'aria-label': 'Excluir regra', onclick: () => { r.regras.splice(ri, 1); touch(); draw(); } }, icon('trash', 15))),
        rule.condicoes.map((c, ci) => conditionRow(rule, c, ci)),
        el('button', { class: 'btn ghost sm', type: 'button', style: 'margin:0 0 12px 30px', onclick: () => { rule.condicoes.push({ pergunta: answerable()[0].q.id, op: 'igual', valor: '' }); touch(); draw(); } }, icon('plus', 14), 'Condição'),
        field('Enviar para', text(rule, 'url', { placeholder: 'https://…', type: 'url' }), undefined, 'Dá para levar respostas no link: …?email={email}. {resposta_id} leva o código da resposta.'));
    };

    const draw = () => {
      fill(holder, el('h3', {}, 'Levar para outra página', tip('Depois do envio, a pessoa vai para um link conforme as respostas. As regras são testadas em ordem; vale a primeira que combinar.')),
        el('p', { class: 'hint', text: 'Em vez da tela de obrigado, abre um link.' }),
        toggle(r, 'ativo', 'Redirecionar depois do envio', { rerender: false, onchange: () => { touch(); draw(); } }),
        r.ativo && el('div', { style: 'margin-top:16px' },
          answerable().length === 0 && el('p', { class: 'notice', text: 'Crie perguntas antes de montar regras.' }),
          r.regras.map(ruleCard),
          el('button', {
            class: 'btn sm', type: 'button', disabled: answerable().length === 0, style: 'margin-bottom:20px',
            onclick: () => { r.regras.push({ id: `r${Math.random().toString(16).slice(2, 10)}`, nome: '', condicoes: [{ pergunta: answerable()[0].q.id, op: 'igual', valor: '' }], url: '' }); touch(); draw(); }
          }, icon('plus', 14), 'Nova regra'),
          field(r.regras.length ? 'Se nenhuma regra combinar (opcional)' : 'Link (opcional)', text(r, 'url_padrao', { placeholder: 'Vazio: mostra a tela de obrigado', type: 'url' }))));
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
    const stateText = { rascunho: ['Rascunho: publique para a agenda valer', ''], aberto: ['Recebendo respostas', 'ok'], em_breve: ['Ainda não abriu', 'warn'], encerrado: ['Encerrado', 'err'] }[st];
    const dateField = (label, key, hint) => {
      const input = el('input', { class: 'input', type: 'datetime-local', value: toLocalInput(ag[key]) });
      input.addEventListener('change', () => { ag[key] = input.value ? new Date(input.value).toISOString() : ''; touch(); renderPanel(); });
      return field(label, el('div', { class: 'row' }, input, ag[key] && el('button', { class: 'icon-btn', type: 'button', title: 'Limpar', 'aria-label': 'Limpar data', onclick: () => { ag[key] = ''; touch(); renderPanel(); } }, icon('x', 15))), hint);
    };
    const sub = (k, label) => el('button', { class: 'tab', role: 'tab', 'aria-selected': String(S.previewSub === k), onclick: () => { S.previewSub = k; renderPanel(); sendPreview(); } }, label);
    return el('div', {},
      head('Agenda', [icon('clock', 14), 'Final'], statusPill(st === 'aberto' ? 'aberto' : st)),
      el('div', { class: 'section' }, el('h3', {}, 'Abrir e encerrar', tip('Horário do seu computador. Quem já estiver respondendo ganha 10 minutos para terminar depois do encerramento.')),
        el('p', { class: 'hint', text: stateText[0] + '.' }),
        el('div', { class: 'cols2' },
          dateField('Abre em (opcional)', 'abre_em'),
          dateField('Encerra em (opcional)', 'fecha_em')),
        S.status !== 'draft' && el('div', { class: 'row' },
          S.status === 'closed'
            ? el('button', { class: 'btn sm', type: 'button', onclick: reopen }, icon('play', 14), 'Reabrir agora')
            : el('button', { class: 'btn sm danger', type: 'button', onclick: closeNow }, icon('stop', 14), 'Encerrar agora'))),
      el('div', { class: 'section' },
        el('div', { class: 'tabs', role: 'tablist', style: 'margin-bottom:18px' }, sub('closed', 'Tela de encerrado'), sub('soon', 'Tela “em breve”')),
        S.previewSub === 'closed'
          ? el('div', {},
            field('Título', text(en, 'titulo', { multiline: true, rows: 2 })),
            field('Texto', text(en, 'texto', { multiline: true, rows: 3 })),
            el('div', { class: 'cols2' }, field('Botão (opcional)', text(en, 'cta_texto', { placeholder: 'Ex.: Lista de espera' })), field('Link do botão', text(en, 'cta_url', { placeholder: 'https://…', type: 'url' }))))
          : el('div', {},
            field('Título', text(eb, 'titulo', { multiline: true, rows: 2 })),
            field('Texto', text(eb, 'texto', { multiline: true, rows: 3 }), undefined, 'Se houver data de abertura, ela aparece sozinha abaixo do texto.'))));
  }

  function optionsEditor(q, onChange) {
    const holder = el('div');
    const draw = (focusIndex) => {
      fill(holder, 
        ...q.opcoes.map((opt, i) => {
          const input = el('input', { class: 'input', value: opt, placeholder: `Opção ${i + 1}`, 'aria-label': `Opção ${i + 1}` });
          input.addEventListener('input', () => {
            const old = q.opcoes[i];
            q.opcoes[i] = input.value;
            q.exclusivas = q.exclusivas.map(x => (x === old ? input.value : x));
            if (q.ramos[old] !== undefined) { q.ramos[input.value] = q.ramos[old]; delete q.ramos[old]; } // keep the rule when an option is renamed
            if (q.valores?.[old] !== undefined) { q.valores[input.value] = q.valores[old]; delete q.valores[old]; } // and its custom value
            for (const rule of sch().final.redirecionamento.regras) for (const c of rule.condicoes) if (c.pergunta === q.id && c.valor === old) c.valor = input.value;
            for (const pr of sch().pontuacao.regras) if (pr.pergunta === q.id && pr.valor === old) pr.valor = input.value;
            touch(); onChange?.();
          });
          input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.opcoes.splice(i + 1, 0, ''); draw(i + 1); touch(); } });
          const excl = q.tipo === 'multipla' && el('label', { title: 'Marcar esta desmarca as outras (ex.: “Nenhuma”)' },
            el('input', { type: 'checkbox', checked: q.exclusivas.includes(opt), onchange: e => {
              q.exclusivas = e.target.checked ? [...q.exclusivas, q.opcoes[i]] : q.exclusivas.filter(x => x !== q.opcoes[i]);
              touch();
            } }), 'sozinha');
          const row = el('div', { class: 'opt-row' }, q.tipo !== 'dropdown' && el('span', { class: `dot${q.tipo === 'multipla' ? ' sq' : ''}`, 'aria-hidden': 'true' }), input, excl,
            el('button', { class: 'icon-btn', type: 'button', title: 'Remover', 'aria-label': `Remover opção ${i + 1}`, onclick: () => { delete q.ramos[q.opcoes[i]]; if (q.valores) delete q.valores[q.opcoes[i]]; q.opcoes.splice(i, 1); draw(); touch(); onChange?.(); } }, icon('x', 15)));
          if (focusIndex === i) setTimeout(() => input.focus(), 0);
          return row;
        }),
        el('button', { class: 'btn ghost sm', type: 'button', style: 'margin-left:14px', onclick: () => { q.opcoes.push(''); draw(q.opcoes.length - 1); touch(); } }, icon('plus', 14), 'Opção'));
    };
    draw();
    return holder;
  }

  // Branching: where the respondent goes after this question. Destinations can only be later questions, so routes never loop.
  function routingSection(q, i) {
    const qs = sch().perguntas;
    const destOptions = defaultLabel => [['', defaultLabel], ...qs.slice(i + 1).map((o, k) => [o.id, `${i + k + 2}. ${plain(o.rotulo).slice(0, 48) || 'Sem título'}`]), ['fim', 'Ir para o envio (fim)']];
    const destSelect = (obj, key, defaultLabel) => {
      const opts = destOptions(defaultLabel);
      const bad = obj[key] && !opts.some(([v]) => v === obj[key]);
      if (bad) opts.push([obj[key], `Destino inválido: a pergunta ${qs.findIndex(x => x.id === obj[key]) + 1} vem antes`]);
      const node = el('select', { class: 'select' }, opts.map(([v, l]) => el('option', { value: v, text: l })));
      node.value = obj[key] || '';
      node.addEventListener('change', () => { if (node.value) obj[key] = node.value; else delete obj[key]; if (key === 'proxima' && !node.value) obj[key] = ''; touch(); refresh(); });
      return node;
    };
    const last = i === qs.length - 1;
    const values = branchValuesOf(q);
    const box = el('details', { class: 'more', open: hasRouting(q) || undefined },
      el('summary', {}, icon('route', 15), 'Lógica: para onde ir depois', icon('chevron', 15)),
      el('div', { class: 'more-body' },
        field('Próxima pergunta', destSelect(q, 'proxima', last ? 'Envio (é a última)' : `${i + 2}. A seguinte (padrão)`), undefined, 'Só dá para pular para frente. Perguntas puladas não são exigidas.'),
        values.length > 0 && el('div', { class: 'field' }, el('label', { text: 'Conforme a resposta' }),
          values.map(v => el('div', { class: 'route-row' }, el('span', { class: 'route-val', title: v, text: v }), icon('right', 14), destSelect(q.ramos, v, 'Como acima'))))));
    return box;
  }

  function questionPanel(q, i) {
    const qs = sch().perguntas;
    const move = d => { const j = i + d; if (j < 0 || j >= qs.length) return; [qs[i], qs[j]] = [qs[j], qs[i]]; renderList(); renderPanel(); touch(); };
    const routeBox = el('div');
    const drawRoute = () => fill(routeBox, routingSection(q, i));
    drawRoute();
    const locked = isLocked(q);
    const typeSelect = el('select', { class: 'select', disabled: locked, 'aria-label': 'Tipo de pergunta' }, Object.entries(TIPOS).map(([v, t]) => el('option', { value: v, text: t.nome })));
    typeSelect.value = q.tipo;
    typeSelect.addEventListener('change', () => {
      q.tipo = typeSelect.value;
      if (CHOICE.includes(q.tipo) && !q.opcoes.length) q.opcoes = ['Opção 1', 'Opção 2'];
      if (q.tipo === 'aviso') q.obrigatoria = false;
      if (q.tipo !== 'escala') q.estilo = 'numeros';
      if (q.tipo === 'matriz') { if (!q.opcoes.length) q.opcoes = ['Discordo', 'Neutro', 'Concordo']; if (!(q.linhas || []).length) q.linhas = ['Afirmação 1']; }
      renderList(); renderPanel(); touch();
    });

    const duplicateQ = () => {
      const copyQ = JSON.parse(JSON.stringify(q)); copyQ.id = newId(); copyQ.chave = uniqueKey(`${q.chave}_copia`); copyQ._auto = false;
      qs.splice(i + 1, 0, copyQ); select_(copyQ.id); touch();
    };
    const parts = [
      head(`${q.tipo === 'aviso' ? 'Mensagem' : 'Pergunta'} ${i + 1}`, [icon(TIPOS[q.tipo].icon, 14), TIPOS[q.tipo].nome],
        el('button', { class: 'icon-btn', title: 'Mover para cima', 'aria-label': 'Mover para cima', disabled: i === 0, onclick: () => move(-1) }, icon('up', 16)),
        el('button', { class: 'icon-btn', title: 'Mover para baixo', 'aria-label': 'Mover para baixo', disabled: i === qs.length - 1, onclick: () => move(1) }, icon('down', 16)),
        el('button', { class: 'icon-btn', title: 'Duplicar', 'aria-label': 'Duplicar', onclick: duplicateQ }, icon('copy', 16)),
        el('button', { class: 'icon-btn danger', title: 'Excluir', 'aria-label': 'Excluir pergunta', onclick: () => {
          if (!confirm('Excluir esta pergunta? As respostas já recebidas ficam guardadas em Resultados › Removidas.')) return;
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
          sch().pontuacao.regras = sch().pontuacao.regras.filter(pr => pr.pergunta !== q.id);
          const droppedRules = rulesBefore - rr.regras.length;
          qs.splice(i, 1); select_(qs[Math.min(i, qs.length - 1)]?.id || 'welcome'); touch();
          const notes = [refs && `${refs} regra(s) de navegação voltaram ao padrão`, hadHook && 'o webhook por pergunta foi desligado', droppedRules && `${droppedRules} regra(s) de redirecionamento foram removidas`].filter(Boolean);
          if (notes.length) toast(`Ajustado onde ela era usada: ${notes.join('; ')}`);
        } }, icon('trash', 16))),
      field(q.tipo === 'aviso' ? 'Título' : 'Pergunta', text(q, 'rotulo', {
        multiline: true, rows: 2, placeholder: q.tipo === 'aviso' ? 'Ex.: Agora, algumas perguntas sobre o seu negócio' : 'Ex.: Qual é o seu melhor e-mail?',
        onchange: v => { if (q._auto) q.chave = uniqueKey(slugKey(v) || q.chave, q); refresh(); }
      }), undefined, TOKENS_HINT),
      field('Descrição (opcional)', text(q, 'ajuda', { multiline: true, rows: 2, placeholder: 'Aparece abaixo da pergunta' })),
      el('div', { class: 'cols2' },
        field('Tipo', typeSelect, undefined, locked ? 'O tipo fica travado depois que o formulário recebe respostas. Para trocar, crie outra pergunta (as respostas desta continuam guardadas).' : undefined),
        TEXTLIKE.includes(q.tipo) || q.tipo === 'dropdown' ? field(q.tipo === 'dropdown' ? 'Texto da busca' : 'Texto de exemplo', text(q, 'placeholder')) : el('div'))
    ];
    if (q.tipo !== 'aviso') parts.push(toggle(q, 'obrigatoria', 'Obrigatória'));
    if (CHOICE.includes(q.tipo)) {
      parts.push(field('Opções', optionsEditor(q, drawRoute)),
        toggle(q, 'outra', 'Opção “Outra” com campo livre', { onchange: drawRoute }),
        q.tipo !== 'dropdown' && toggle(q, 'compacta', 'Opções lado a lado'));
    }
    if (q.tipo === 'matriz') {
      parts.push(field('Linhas', linesEditor(q), undefined, 'As afirmações. Cada uma recebe uma letra (A, B, C…) usada na pontuação. Apagar uma do meio muda as letras seguintes.'),
        field('Colunas', optionsEditor(q, drawRoute), undefined, 'As alternativas de resposta, iguais para todas as linhas.'));
    }
    if (q.tipo === 'escala') {
      const lockNote = ' Travado: o formulário já recebeu respostas.';
      const estiloSel = el('select', { class: 'select', disabled: locked }, [['numeros', 'Números (ex.: NPS de 0 a 10)'], ['estrelas', 'Estrelas'], ['emojis', 'Carinhas']].map(([v, l]) => el('option', { value: v, text: l })));
      estiloSel.value = q.estilo || 'numeros';
      estiloSel.addEventListener('change', () => { q.estilo = estiloSel.value; if (q.estilo !== 'numeros') { q.min = 1; q.max = 5; } renderPanel(); renderList(); touch(); });
      const lockable = node => { node.disabled = locked; return node; };
      parts.push(field('Estilo', estiloSel, undefined, locked ? lockNote.trim() : undefined));
      if (!q.estilo || q.estilo === 'numeros') {
        parts.push(el('div', { class: 'cols2' },
          field('De', lockable(select(q, 'min', [[0, '0'], [1, '1']], () => renderPanel()))),
          field('Até', lockable(select(q, 'max', [3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, String(n)]), () => renderPanel())))));
      } else if (q.estilo === 'estrelas') {
        parts.push(field('Estrelas', lockable(select(q, 'max', [3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, String(n)]), () => renderPanel()))));
      } else {
        parts.push(field('Carinhas', lockable(select(q, 'max', [3, 4, 5].map(n => [n, String(n)]), () => renderPanel())), (window.CtfRoute.emojis[q.max] || []).join('  ')));
      }
      parts.push(el('div', { class: 'cols2' },
        field('Legenda do início (opcional)', text(q, 'rotulo_min', { placeholder: 'Ex.: Nada provável' })),
        field('Legenda do fim (opcional)', text(q, 'rotulo_max', { placeholder: 'Ex.: Muito provável' }))));
    }
    parts.push(routeBox);
    if (q.tipo !== 'aviso') {
      const keyInput = el('input', { class: 'input mono', value: q.chave });
      keyInput.addEventListener('input', () => { q._auto = false; q.chave = keyInput.value; touch(); });
      keyInput.addEventListener('blur', () => { q.chave = uniqueKey(slugKey(keyInput.value) || 'pergunta', q); keyInput.value = q.chave; touch(); });
      const prefill = el('input', { class: 'input mono', value: (q.prefill || []).join(', '), placeholder: 'email, buyer_email' });
      prefill.addEventListener('input', () => { q.prefill = prefill.value.split(',').map(s => s.trim()).filter(Boolean); touch(); });
      parts.push(more('Avançado',
        field('Nome do campo', keyInput, undefined, 'Identifica a resposta na planilha (CSV), nas integrações e nos textos com {chave}. Ex.: primeiro_nome.'),
        TEXTLIKE.includes(q.tipo) && field('Preencher pelo link (opcional)', prefill, undefined, 'Se o link tiver esse parâmetro, a resposta já vem preenchida. Ex.: ?email=ana@x.com')));
    }
    return el('div', {}, ...parts);
  }

  function designPanel() {
    const t = sch().tema;
    const same = p => ['fundo', 'texto', 'destaque', 'destaque2'].every(k => (p[k] || '').toLowerCase() === (t[k] || '').toLowerCase());
    const radius = el('input', { type: 'range', min: 0, max: 24, value: t.raio, 'aria-label': 'Arredondamento' });
    const radiusOut = el('output', { text: `${t.raio}px` });
    radius.addEventListener('input', () => { t.raio = Number(radius.value); radiusOut.textContent = `${t.raio}px`; touch(); });
    return el('div', {},
      head('Aparência'),
      el('div', { class: 'section' }, el('h3', { text: 'Tema' }),
        el('div', { class: 'swatches' }, THEME_PRESETS.map(p => el('button', {
          class: `swatch${same(p) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(same(p)),
          onclick: () => { Object.assign(t, { fundo: p.fundo, texto: p.texto, destaque: p.destaque, destaque2: p.destaque2 }, p.fonte ? { fonte: p.fonte, raio: p.raio, grade: p.grade } : {}); renderPanel(); touch(); }
        }, el('i', {}, el('b', { style: `background:${p.fundo}` }), el('b', { style: `background:${p.destaque}` }), el('b', { style: `background:${p.destaque2}` })), p.nome)))),
      el('div', { class: 'section' }, el('h3', { text: 'Cores' }),
        el('div', { class: 'cols2' }, field('Fundo', color(t, 'fundo')), field('Texto', color(t, 'texto'))),
        el('div', { class: 'cols2' }, field('Destaque', color(t, 'destaque'), undefined, 'Botões, barra de progresso e opção selecionada.'), field('Destaque 2', color(t, 'destaque2'), undefined, 'Segunda cor do degradê nos títulos.'))),
      el('div', { class: 'section' }, el('h3', { text: 'Letras e formas' }),
        el('div', { class: 'cols2' },
          field('Fonte', select(t, 'fonte', FONTS.map(f => [f, f]))),
          field('Cantos', el('div', { class: 'range-row' }, radius, radiusOut))),
        toggle(t, 'grade', 'Linhas de grade no fundo')),
      el('div', { class: 'section' }, el('h3', { text: 'Imagens' }),
        imageField(t, 'logo', 'Logo', 'PNG, SVG, JPG ou WebP até 4 MB. Fundo transparente fica melhor.'),
        imageField(t, 'fundo_imagem', 'Imagem de fundo (opcional)', 'Ganha uma camada por cima para o texto continuar legível.')));
  }

  // How the link looks when shared (WhatsApp, Instagram, Telegram…): the server writes these into the page head.
  function seoCard() {
    const seo = sch().ajustes.seo;
    const card = el('div', { class: 'share-card' });
    const draw = () => fill(card,
      seo.imagem && el('img', { src: seo.imagem, alt: '' }),
      el('div', { class: 'sc-body' }, el('small', { text: location.host }), el('b', { text: seo.titulo || S.titulo || 'Título do formulário' }), el('span', { text: seo.descricao || plain(sch().boas_vindas.texto) || '' })));
    draw();
    return el('div', { class: 'section' }, el('h3', {}, 'Prévia ao compartilhar', tip('Como o link aparece no WhatsApp, Instagram, Telegram e afins.')),
      el('p', { class: 'hint', text: 'O cartão que aparece quando alguém envia o link.' }),
      card,
      more('Personalizar',
        field('Título (opcional)', text(seo, 'titulo', { placeholder: S.titulo, onchange: draw }), undefined, 'Vazio: usa o nome do formulário. Até 90 caracteres.'),
        field('Descrição (opcional)', text(seo, 'descricao', { multiline: true, rows: 2, placeholder: plain(sch().boas_vindas.texto), onchange: draw }), undefined, 'Vazia: usa o texto da boas-vindas. Até 200 caracteres.'),
        imageField(seo, 'imagem', 'Imagem', 'Ideal: 1200 × 630 px (JPG ou PNG).', draw)));
  }

  function settingsPanel() {
    const a = sch().ajustes;
    const slugInput = el('input', { class: `input${S.slugErro ? ' bad' : ''}`, value: S.slug, spellcheck: 'false', autocapitalize: 'off' });
    slugInput.addEventListener('input', () => {
      const clean = slugUrl(slugInput.value);
      if (clean !== slugInput.value) slugInput.value = clean;
      S.slug = clean; S.slugErro = ''; slugInput.classList.remove('bad'); touch(); drawQr();
    });
    // QR code of the form link, next to it. Follows the address being typed (it changes only when saved).
    const qrImg = el('div', { class: 'qr-img', role: 'img' });
    const drawQr = () => { try { qrImg.innerHTML = S.slug ? qrSvg(formUrl(S.slug)) : ''; qrImg.setAttribute('aria-label', `QR Code de ${formUrl(S.slug)}`); } catch { qrImg.textContent = ''; } };
    drawQr();
    const qrFile = ext => `qrcode-${S.slug || 'formulario'}.${ext}`;
    const qrBox = el('div', { class: 'qr' }, qrImg,
      el('button', { class: 'btn sm', type: 'button', disabled: !S.slug, onclick: async () => downloadBlob(await qrPngBlob(formUrl(S.slug)), qrFile('png')) }, icon('download', 14), 'Baixar'),
      el('button', { class: 'qr-svg', type: 'button', title: 'Vetorial, para impressão em qualquer tamanho', onclick: () => downloadBlob(new Blob([qrSvg(formUrl(S.slug))], { type: 'image/svg+xml' }), qrFile('svg')) }, 'ou SVG'));
    return el('div', {},
      head('Ajustes'),
      el('div', { class: 'section' }, el('h3', { text: 'Link do formulário' }),
        el('div', { class: 'link-grid' }, el('div', { style: 'min-width:0' },
        el('div', { class: 'slug-box' }, el('span', { text: `${location.host}/f/` }), slugInput),
        S.slugErro
          ? el('p', { class: 'hint', style: 'color:var(--err);margin-top:6px', text: S.slugErro })
          : S.slug !== form.slug && S.opened && el('p', { class: 'hint', style: 'color:var(--warn);margin-top:6px', text: 'Ao salvar, o link antigo para de funcionar.' }),
        el('div', { class: 'row wrap', style: 'margin-top:12px' },
          el('button', { class: 'btn sm', type: 'button', onclick: () => copy(formUrl(S.slug)) }, icon('copy', 14), 'Copiar'),
          S.status === 'published' && el('a', { class: 'btn sm', href: `/f/${S.slug}`, target: '_blank', rel: 'noopener' }, icon('external', 14), 'Abrir'),
          el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.slug = slugUrl(plain(S.titulo)) || S.slug; renderPanel(); touch(); } }, 'Usar o nome do formulário')),
        S.status === 'draft' && el('p', { class: 'hint', style: 'margin-top:12px', text: 'O link e o QR Code passam a funcionar quando você publicar.' })),
        qrBox)),
      el('div', { class: 'section' }, el('h3', { text: 'Comportamento' }),
        toggle(a, 'mostrar_progresso', 'Barra de progresso'),
        toggle(a, 'mostrar_numero', 'Número de cada pergunta'),
        toggle(a, 'uma_vez', 'Uma resposta por pessoa', { help: 'Depois de enviar, o mesmo navegador não consegue responder de novo.' }),
        toggle(sch().consentimento, 'ativo', 'Pedir consentimento (LGPD) antes de enviar', { rerender: true, help: 'Uma caixa antes do envio. É opcional para a pessoa: ela envia marcando ou não, e o webhook recebe consentimento: true ou false.' }),
        sch().consentimento.ativo && el('div', { class: 'sub-opts' },
          field('Texto do consentimento', text(sch().consentimento, 'texto', { multiline: true, rows: 3 })),
          el('div', { class: 'field' }, el('label', {}, 'A caixa começa', tip('Pela LGPD, caixa já marcada não vale como consentimento formal. Use “marcada” só para preferências de contato.')),
            el('div', { class: 'radios', role: 'radiogroup' }, [[false, 'Desmarcada'], [true, 'Marcada']].map(([v, l]) => {
              const r = el('input', { type: 'radio', name: 'consent-default', checked: !!sch().consentimento.pre_marcado === v });
              r.addEventListener('change', () => { sch().consentimento.pre_marcado = v; touch(); });
              return el('label', { class: 'radio' }, r, el('span', { text: l }));
            }))))),
      el('div', { class: 'section' }, el('h3', { text: 'Integrações' }),
        toggle(sch().ajustes.webhook, 'ativo', 'Enviar respostas por webhook', {
          help: 'Liga a aba Integrações, onde ficam o endereço, os exemplos de envio, os valores das respostas e os campos personalizados.',
          onchange: () => { const w = sch().ajustes.webhook; if (w.ativo && !w.ao_concluir && !w.ao_responder) w.ao_concluir = true; syncTabs(); }
        }),
        sch().ajustes.webhook.ativo && el('button', { class: 'btn sm', type: 'button', style: 'margin-left:42px', onclick: () => { S.tab = 'integracoes'; syncTabs(); } }, 'Configurar na aba Integrações', icon('right', 14))),
      seoCard(),
      el('div', { class: 'section' },
        more('Avançado',
          field('Texto no topo (opcional)', text(a, 'rotulo_topo', { placeholder: 'Ex.: Pesquisa 2026' }), undefined, 'Aparece ao lado do logo.'),
          field('Guardar parâmetros do link (opcional)', text(a, 'params_extra', { placeholder: 'ref, campanha' }), undefined, 'Nomes de parâmetros do link (além de UTMs) para salvar junto com as respostas. Separe por vírgula.'))));
  }

  /* ----- top bar ----- */
  const topEl = el('div', { class: 'ed-top' });
  const tabsEl = el('div', { class: 'tabs', role: 'tablist' });
  const TABS = () => [['conteudo', 'Perguntas'], ['design', 'Aparência'], ['ajustes', 'Ajustes'], ...(sch().ajustes.webhook.ativo ? [['integracoes', 'Integrações']] : [])];
  function syncTabs() {
    if (S.tab === 'integracoes' && !sch().ajustes.webhook.ativo) S.tab = 'ajustes';
    fill(tabsEl, ...TABS().map(([k, label]) => el('button', {
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
    const moreBtn = el('button', { class: 'btn sm icon ghost', 'aria-label': 'Mais ações', title: 'Mais ações', onclick: () => popMenu(moreBtn, [
      ['Copiar link', 'copy', () => copy(formUrl(S.slug))],
      S.status === 'published' && ['Abrir formulário', 'external', () => window.open(`/f/${S.slug}`, '_blank', 'noopener')],
      S.status === 'published' && null,
      S.status === 'published' && ['Encerrar agora', 'stop', closeNow],
      S.status === 'closed' && ['Reabrir', 'play', reopen],
      S.status !== 'draft' && ['Tirar do ar', 'eyeoff', unpublish, { danger: true }]
    ]) }, icon('more', 18));
    const actions = el('div', { class: 'ed-actions' },
      S.status !== 'draft' && statusPill(st),
      stateEl,
      el('a', { class: 'btn sm icon ghost', href: `#/forms/${id}/results`, title: 'Resultados', 'aria-label': 'Resultados', onclick: leave }, icon('chart', 17)),
      moreBtn,
      saveBtn,
      S.status === 'draft' && el('button', { class: 'btn accent sm', onclick: publish }, 'Publicar'));
    fill(topEl,
      el('div', { class: 'ed-left' },
        el('a', { class: 'icon-btn', href: '#/', title: 'Voltar aos formulários', 'aria-label': 'Voltar aos formulários', onclick: leave }, icon('back', 17)),
        titleInput),
      tabsEl, actions);
    syncSaveBtn();
  }

  /* ----- preview column ----- */
  const stageEl = el('div', { class: 'pv-stage' }, frame);
  const deviceTabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Tamanho da prévia' });
  const drawDevices = () => fill(deviceTabs, [['monitor', 'Computador', false], ['phone_d', 'Celular', true]].map(([ic, label, mobile]) => el('button', {
    class: 'tab', style: 'padding:0 8px', title: label, 'aria-label': label, 'aria-selected': String(S.mobile === mobile),
    onclick: () => { S.mobile = mobile; stageEl.classList.toggle('mobile', mobile); drawDevices(); }
  }, icon(ic, 15))));
  drawDevices();
  const previewEl = el('aside', { class: 'ed-preview' },
    el('div', { class: 'pv-bar' }, icon('eye', 15), el('b', { text: 'Prévia' }), el('div', { class: 'grow' }), deviceTabs),
    stageEl);

  bodyEl.append(listEl, panelEl, previewEl);
  renderTop();
  renderList();
  syncTabs();
  mount(el('div', { class: 'ed' }, topEl, bodyEl));
}
