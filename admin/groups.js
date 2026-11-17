// Settings page: reusable question groups ("Dados pessoais", "Dados financeiros"…) that can be inserted into any form.
import { el, fill, api, toast, icon, tip, popMenu, typeIcon, TIPOS, plain } from './ui.js';

const CHOICE = ['unica', 'multipla', 'dropdown'];
const HAS_OPTS = [...CHOICE, 'matriz'];
const LET = 'ABCDEFGHIJKL';
const slugKey = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const newId = () => `q${Math.random().toString(16).slice(2, 10)}`;

// A fresh question with the same defaults as the form editor.
export function blankQuestion(tipo) {
  return {
    id: newId(), chave: '', tipo, rotulo: '', ajuda: '', obrigatoria: tipo !== 'aviso', placeholder: '',
    opcoes: CHOICE.includes(tipo) ? ['Opção 1', 'Opção 2'] : tipo === 'matriz' ? ['Discordo', 'Neutro', 'Concordo'] : [],
    linhas: tipo === 'matriz' ? ['Afirmação 1', 'Afirmação 2'] : [], outra: false, exclusivas: [], compacta: false,
    estilo: 'numeros', min: 1, max: 5, rotulo_min: '', rotulo_max: '', prefill: [], proxima: '', ramos: {}
  };
}

export const groupSummary = g => g.perguntas.map(q => plain(q.rotulo) || TIPOS[q.tipo]?.nome).join(' · ');

/* ---------- settings page: list of groups ---------- */

export async function renderSettings({ mount, shell }) {
  const { grupos } = await api('GET', '/groups');
  const duplicate = async g => {
    const { grupo } = await api('POST', '/groups', { nome: `${g.nome} (cópia)`, descricao: g.descricao, perguntas: g.perguntas });
    toast('Grupo duplicado'); location.hash = `#/config/grupos/${grupo.id}`;
  };
  const remove = async g => {
    if (!confirm(`Excluir o grupo “${g.nome}”? Os formulários que já usam essas perguntas não mudam.`)) return;
    await api('DELETE', `/groups/${g.id}`); toast('Grupo excluído'); renderSettings({ mount, shell });
  };
  const row = g => {
    const open = () => { location.hash = `#/config/grupos/${g.id}`; };
    const more = el('button', { class: 'icon-btn', 'aria-label': `Mais ações para ${g.nome}`, onclick: e => { e.stopPropagation(); popMenu(more, [
      ['Editar', 'pencil', open], ['Duplicar', 'copy', () => duplicate(g)], null, ['Excluir', 'trash', () => remove(g), { danger: true }]
    ]); } }, icon('more', 18));
    return el('div', { class: 'grow-row', role: 'link', tabindex: '0', onclick: open, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
      el('span', { class: 'badge lg' }, icon('layers', 17)),
      el('div', { class: 'grow', style: 'min-width:0' },
        el('div', { class: 'row' }, el('b', { text: g.nome }), el('span', { class: 'pill plain', text: `${g.perguntas.length} pergunta${g.perguntas.length === 1 ? '' : 's'}` })),
        el('div', { class: 'gq' }, g.perguntas.map(q => el('span', { class: 'chip' }, icon(TIPOS[q.tipo]?.icon || 'type', 12), plain(q.rotulo) || TIPOS[q.tipo]?.nome)))),
      more);
  };
  mount(shell(el('div', {},
    el('a', { class: 'crumb', href: '#/' }, icon('back', 15), 'Formulários'),
    el('div', { class: 'page-head' }, el('h1', { class: 'grow', text: 'Configurações' })),
    el('div', { class: 'block-title', style: 'margin-top:0' },
      el('h2', {}, 'Grupos de perguntas'), tip('Conjuntos prontos de perguntas (ex.: dados pessoais) para inserir em qualquer formulário. No editor, use “Adicionar pergunta” › Grupos. Ao inserir, as perguntas viram cópias: editar o grupo depois não muda formulários antigos.'),
      el('span', { class: 'grow' }),
      el('a', { class: 'btn accent', href: '#/config/grupos/novo' }, icon('plus'), 'Novo grupo')),
    grupos.length
      ? el('div', { class: 'flist' }, grupos.map(row))
      : el('div', { class: 'card empty' }, icon('layers', 30), el('h3', { text: 'Nenhum grupo ainda' }), el('p', { text: 'Junte perguntas que você usa sempre, como nome, e-mail e telefone.' }),
        el('a', { class: 'btn accent', href: '#/config/grupos/novo' }, icon('plus'), 'Novo grupo')))));
}

/* ---------- one group: name + its questions ---------- */

export async function renderGroup(id, { mount, shell, setCleanup }) {
  const creating = id === 'novo';
  const g = creating ? { nome: '', descricao: '', perguntas: [blankQuestion('texto')] } : (await api('GET', '/groups')).grupos.find(x => x.id === id);
  if (!g) { toast('Grupo não encontrado', 'err'); location.hash = '#/config'; return; }
  g.perguntas.forEach(q => { q._keyEdited = !!q.chave; }); // existing field names stay unless edited by hand
  let dirty = false;
  const touch = () => { dirty = true; saveBtn.disabled = false; };
  const onBefore = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBefore);
  setCleanup(() => window.removeEventListener('beforeunload', onBefore));

  const input = (obj, key, attrs = {}, multiline) => {
    const n = el(multiline ? 'textarea' : 'input', { class: multiline ? 'textarea' : 'input', value: obj[key] ?? '', rows: multiline ? 2 : undefined, ...attrs });
    n.addEventListener('input', () => { obj[key] = n.value; touch(); });
    return n;
  };
  const field = (label, control, help) => el('div', { class: 'field' }, el('label', {}, label, help && tip(help)), control);
  const listEditor = (q, key, label, prefix) => {
    const holder = el('div');
    const draw = focus => fill(holder,
      q[key].map((txt, i) => {
        const n = el('input', { class: 'input', value: txt, placeholder: `${label} ${i + 1}`, 'aria-label': `${label} ${i + 1}` });
        n.addEventListener('input', () => { q[key][i] = n.value; touch(); });
        n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q[key].splice(i + 1, 0, ''); draw(i + 1); touch(); } });
        if (focus === i) setTimeout(() => n.focus(), 0);
        return el('div', { class: 'opt-row' }, prefix === 'letter' ? el('span', { class: 'letter', text: LET[i] }) : el('span', { class: `dot${q.tipo === 'multipla' ? ' sq' : ''}`, 'aria-hidden': 'true' }), n,
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remover ${label.toLowerCase()} ${i + 1}`, onclick: () => { q[key].splice(i, 1); draw(); touch(); } }, icon('x', 15)));
      }),
      el('button', { class: 'btn ghost sm', type: 'button', style: 'margin-left:18px', onclick: () => { q[key].push(''); draw(q[key].length - 1); touch(); } }, icon('plus', 14), label));
    draw();
    return holder;
  };

  const list = el('div');
  const questionCard = (q, i) => {
    const qs = g.perguntas;
    const move = d => { const j = i + d; [qs[i], qs[j]] = [qs[j], qs[i]]; touch(); draw(); };
    const typeSel = el('select', { class: 'select', 'aria-label': 'Tipo' }, Object.entries(TIPOS).map(([v, t]) => el('option', { value: v, text: t.nome })));
    typeSel.value = q.tipo;
    typeSel.addEventListener('change', () => {
      const fresh = blankQuestion(typeSel.value);
      Object.assign(q, { tipo: fresh.tipo, opcoes: q.opcoes.length && HAS_OPTS.includes(fresh.tipo) ? q.opcoes : fresh.opcoes, linhas: fresh.linhas, obrigatoria: fresh.tipo === 'aviso' ? false : q.obrigatoria });
      touch(); draw();
    });
    const label = input(q, 'rotulo', { placeholder: 'Ex.: Qual é o seu nome?', 'aria-label': 'Pergunta' }, true);
    label.addEventListener('input', () => { if (!q._keyEdited) q.chave = slugKey(plain(q.rotulo)); keyIn.value = q.chave; });
    const keyIn = input(q, 'chave', { class: 'input mono', placeholder: 'nome_do_campo', 'aria-label': 'Nome do campo' });
    keyIn.addEventListener('input', () => { q._keyEdited = true; });
    const req = el('input', { type: 'checkbox', checked: q.obrigatoria });
    req.addEventListener('change', () => { q.obrigatoria = req.checked; touch(); });
    let extra = null;
    if (HAS_OPTS.includes(q.tipo)) extra = q.tipo === 'matriz'
      ? el('div', { class: 'cols2' }, field('Linhas', listEditor(q, 'linhas', 'Linha', 'letter')), field('Colunas', listEditor(q, 'opcoes', 'Opção')))
      : field('Opções', listEditor(q, 'opcoes', 'Opção'));
    if (q.tipo === 'escala') {
      const est = el('select', { class: 'select', 'aria-label': 'Estilo' }, [['numeros', 'Números'], ['estrelas', 'Estrelas'], ['emojis', 'Carinhas']].map(([v, l]) => el('option', { value: v, text: l })));
      est.value = q.estilo;
      est.addEventListener('change', () => { q.estilo = est.value; if (q.estilo !== 'numeros') { q.min = 1; q.max = 5; } touch(); draw(); });
      const range = q.estilo === 'numeros' ? [[0, 1], [3, 4, 5, 6, 7, 8, 9, 10]] : [null, q.estilo === 'emojis' ? [3, 4, 5] : [3, 4, 5, 6, 7, 8, 9, 10]];
      const num = (key, opts) => { const s = el('select', { class: 'select', 'aria-label': key === 'min' ? 'De' : 'Até' }, opts.map(n => el('option', { value: n, text: String(n) }))); s.value = q[key]; s.addEventListener('change', () => { q[key] = Number(s.value); touch(); }); return s; };
      extra = el('div', { class: 'cols2' }, field('Estilo', est), el('div', { class: 'row', style: 'align-items:flex-end' },
        range[0] && field('De', num('min', range[0])), field(q.estilo === 'numeros' ? 'Até' : 'Quantidade', num('max', range[1]))));
    }
    return el('div', { class: 'rule gcard' },
      el('div', { class: 'rule-head' }, typeIcon(q.tipo), el('b', { class: 'grow', text: `${i + 1}. ${TIPOS[q.tipo].nome}` }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Subir', disabled: i === 0, onclick: () => move(-1) }, icon('up', 15)),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Descer', disabled: i === qs.length - 1, onclick: () => move(1) }, icon('down', 15)),
        el('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Remover pergunta', disabled: qs.length === 1, onclick: () => { qs.splice(i, 1); touch(); draw(); } }, icon('trash', 15))),
      field('Pergunta', label, 'Dica: *palavra* destaca na cor do tema.'),
      el('div', { class: 'cols2' }, field('Tipo', typeSel), field('Nome do campo', keyIn, 'Identifica a resposta no CSV e nas integrações. Se já existir no formulário, ganha um número no fim (ex.: email_2).')),
      extra,
      q.tipo !== 'aviso' && el('label', { class: 'switch' }, req, el('span', { text: 'Obrigatória' })));
  };

  const addBtn = el('button', { class: 'add-q', type: 'button', onclick: () => popMenu(addBtn, Object.entries(TIPOS).map(([tipo, t]) => [t.nome, t.icon, () => { g.perguntas.push(blankQuestion(tipo)); touch(); draw(); }])) }, icon('plus', 15), 'Adicionar pergunta');
  const draw = () => fill(list, g.perguntas.map(questionCard), addBtn);

  const err = el('p', { class: 'notice err', hidden: true });
  const saveBtn = el('button', { class: 'btn primary', disabled: !creating, onclick: async () => {
    err.hidden = true; saveBtn.disabled = true;
    try {
      const body = { nome: g.nome, descricao: g.descricao, perguntas: g.perguntas.map(({ _keyEdited, ...q }) => ({ ...q, chave: q.chave || slugKey(plain(q.rotulo)) || `pergunta_${g.perguntas.indexOf(q) + 1}` })) };
      await (creating ? api('POST', '/groups', body) : api('PUT', `/groups/${id}`, body));
      dirty = false; toast('Grupo salvo');
      location.hash = '#/config';
    } catch (e) { err.textContent = e.message; err.hidden = false; saveBtn.disabled = false; }
  } }, 'Salvar grupo');

  draw();
  mount(shell(el('div', { class: 'narrow' },
    el('a', { class: 'crumb', href: '#/config', onclick: e => { if (dirty && !confirm('Há alterações não salvas. Sair sem salvar?')) e.preventDefault(); } }, icon('back', 15), 'Configurações'),
    el('div', { class: 'page-head' }, el('h1', { class: 'grow', text: creating ? 'Novo grupo' : 'Editar grupo' }),
      el('a', { class: 'btn', href: '#/config' }, 'Cancelar'), saveBtn),
    err,
    el('div', { class: 'card', style: 'padding:20px;margin-bottom:24px' },
      field('Nome do grupo', input(g, 'nome', { placeholder: 'Ex.: Dados pessoais', maxlength: 80 })),
      field('Descrição (opcional)', input(g, 'descricao', { placeholder: 'Para lembrar quando usar', maxlength: 200 }))),
    el('div', { class: 'block-title', style: 'margin-top:0' }, el('h2', { text: 'Perguntas' }), el('span', { text: 'na ordem em que serão inseridas' })),
    list)));
}
