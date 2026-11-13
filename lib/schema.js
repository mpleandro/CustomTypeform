'use strict';
// Form schema: defaults, sanitizing (admin input is never trusted) and the public view.
const crypto = require('node:crypto');

const FONTS = ['Inter', 'Manrope', 'DM Sans', 'Poppins', 'Montserrat', 'Space Grotesk', 'Sora', 'Outfit', 'Playfair Display', 'Lora'];
const TIPOS = ['texto', 'longo', 'email', 'telefone', 'numero', 'url', 'data', 'cidade_uf', 'unica', 'dropdown', 'multipla', 'matriz', 'sim_nao', 'escala', 'aviso'];
const CHOICE = new Set(['unica', 'multipla', 'dropdown']);
const HAS_OPTS = new Set([...CHOICE, 'matriz']);
const BRANCHING = new Set(['unica', 'dropdown', 'sim_nao', 'escala']);
const ESTILOS = ['numeros', 'estrelas', 'emojis'];
const OPS = ['igual', 'diferente', 'contem', 'nao_contem', 'gte', 'lte'];

const newId = (prefix = 'q') => prefix + crypto.randomBytes(4).toString('hex');

function defaultSchema() {
  return {
    boas_vindas: { ativo: true, eyebrow: '', titulo: 'Bem-vindo(a)!', texto: 'Leva menos de dois minutos para responder.', botao: 'Começar', nota: '' },
    perguntas: [
      { id: newId(), chave: 'nome', tipo: 'texto', estilo: 'numeros', rotulo: 'Qual é o seu nome?', ajuda: '', obrigatoria: true, placeholder: 'Digite seu nome', opcoes: [], outra: false, exclusivas: [], compacta: false, min: 1, max: 5, rotulo_min: '', rotulo_max: '', prefill: ['nome', 'name'], proxima: '', ramos: {} }
    ],
    envio: { titulo: 'Pronto. *Só falta enviar.*', texto: 'Se quiser revisar alguma resposta, use a seta ↑ no canto da tela.', botao: 'Enviar respostas' },
    consentimento: { ativo: false, texto: 'Autorizo o uso das minhas respostas para entrar em contato.' },
    final: { titulo: 'Obrigado!', texto: 'Recebemos as suas respostas.', etiqueta: '', cta_texto: '', cta_url: '', redirecionamento: { ativo: false, url_padrao: '', regras: [] } },
    encerrado: { titulo: 'Formulário encerrado', texto: 'Não estamos mais recebendo respostas.', cta_texto: '', cta_url: '' },
    em_breve: { titulo: 'Ainda não abriu', texto: 'Este formulário abre em breve. Volte mais tarde.' },
    agenda: { abre_em: '', fecha_em: '' },
    tema: { fundo: '#070708', texto: '#f2f2f2', destaque: '#ff5c00', destaque2: '#cc8400', fonte: 'Inter', raio: 6, grade: false, logo: '', fundo_imagem: '' },
    ajustes: {
      webhook: { url: '', segredo: '', ao_concluir: false, ao_responder: false, pergunta: '' },
      params_extra: '', uma_vez: false, mostrar_progresso: true, mostrar_numero: true, rotulo_topo: '',
      seo: { titulo: '', descricao: '', imagem: '' }
    },
    arquivadas: []
  };
}

const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = v => v === true;
const int = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const isoDate = v => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');

function safeUrl(v) {
  v = str(v, 600).trim();
  if (!v) return '';
  if (/^\/uploads\/[\w.-]+$/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

// Redirect URLs may carry {chave} placeholders, filled with the respondent's answers at redirect time.
function safeUrlTemplate(v) {
  v = str(v, 800).trim();
  if (!v) return '';
  try {
    const u = new URL(v.replace(/\{[a-z0-9_]+\}/gi, 'x'));
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : '';
  } catch { return ''; }
}

function slugKey(v) {
  return str(v, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function listOf(v, max = 60, len = 200) {
  const src = Array.isArray(v) ? v : [];
  return [...new Set(src.map(x => str(x, len).trim()).filter(Boolean))].slice(0, max);
}

// Answer values a question can branch on.
function branchValues(q) {
  if (q.tipo === 'unica') return q.outra ? [...q.opcoes, 'Outra'] : q.opcoes;
  if (q.tipo === 'dropdown') return q.outra ? [...q.opcoes, 'Outra'] : q.opcoes;
  if (q.tipo === 'sim_nao') return ['Sim', 'Não'];
  if (q.tipo === 'escala') return Array.from({ length: q.max - q.min + 1 }, (_, i) => String(q.min + i));
  return [];
}

// `prev` is the schema being replaced: questions that disappear are archived so their past answers stay readable.
const CMP_OPS = ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'];

// Pontuação: variáveis (eixos), regras de pontos e telas de resultado. Referências inválidas são descartadas.
function sanitizePontuacao(p, answerable) {
p = p && typeof p === 'object' ? p : {};
const keys = new Set();
const variaveis = (Array.isArray(p.variaveis) ? p.variaveis : []).slice(0, 12).map((v, i) => {
v = v || {};
const base = slugKey(v.chave) || `var_${i + 1}`;
let chave = base;
for (let n = 2; keys.has(chave); n++) chave = `${base}_${n}`;
keys.add(chave);
const hasCut = v.corte !== '' && v.corte !== null && v.corte !== undefined && Number.isFinite(Number(v.corte));
return { id: str(v.id, 24) || newId('v'), chave, nome: str(v.nome, 40).trim() || chave, corte: hasCut ? int(v.corte, -1000, 1000, 0) : null };
});
const regras = (Array.isArray(p.regras) ? p.regras : []).slice(0, 300).map(r => {
r = r || {};
if (!keys.has(r.variavel) || !answerable.has(r.pergunta)) return null;
return { id: str(r.id, 24) || newId('p'), variavel: r.variavel, pergunta: r.pergunta, linha: /^[A-L]$/.test(r.linha) ? r.linha : '', op: OPS.includes(r.op) ? r.op : 'igual', valor: str(r.valor, 200), pontos: int(r.pontos, -1000, 1000, 0) };
}).filter(Boolean);
const refOk = ref => typeof ref === 'string' && (/^num:-?\d{1,6}$/.test(ref) || (ref.startsWith('var:') && keys.has(ref.slice(4))));
const resultados = (Array.isArray(p.resultados) ? p.resultados : []).slice(0, 12).map((r, i) => {
r = r || {};
return {
id: str(r.id, 24) || newId('r'), nome: str(r.nome, 80), chave: slugKey(r.chave) || slugKey(r.nome) || `resultado_${i + 1}`,
condicoes: (Array.isArray(r.condicoes) ? r.condicoes : []).slice(0, 10).filter(c => keys.has(c?.variavel)).map(c => ({ variavel: c.variavel, op: CMP_OPS.includes(c.op) ? c.op : 'gte', com: refOk(c.com) ? c.com : 'num:0' })),
titulo: str(r.titulo, 300), texto: str(r.texto, 3000), produto: str(r.produto, 160), botao_texto: str(r.botao_texto, 80), botao_url: safeUrlTemplate(r.botao_url)
};
});
return { ativo: bool(p.ativo), variaveis, regras, resultados };
}

function sanitize(input, prev) {
  const d = defaultSchema();
  const s = input && typeof input === 'object' ? input : {};
  const bv = s.boas_vindas || {}, ev = s.envio || {}, co = s.consentimento || {}, fi = s.final || {}, te = s.tema || {}, aj = s.ajustes || {};
  const en = s.encerrado || {}, eb = s.em_breve || {}, ag = s.agenda || {}, seo = aj.seo || {};

  const ids = new Set(), keys = new Set();
  const perguntas = (Array.isArray(s.perguntas) ? s.perguntas : []).slice(0, 200).map((q, i) => {
    q = q || {};
    let id = typeof q.id === 'string' && /^[a-z0-9_]{3,24}$/i.test(q.id) && !ids.has(q.id) ? q.id : newId();
    ids.add(id);
    const tipo = TIPOS.includes(q.tipo) ? q.tipo : 'texto';
    let chave = slugKey(q.chave) || `pergunta_${i + 1}`;
    for (let n = 2; keys.has(chave); n++) chave = `${slugKey(q.chave) || `pergunta_${i + 1}`}_${n}`;
    keys.add(chave);
    const opcoes = HAS_OPTS.has(tipo) ? listOf(q.opcoes) : [];
    const estilo = tipo === 'escala' && ESTILOS.includes(q.estilo) ? q.estilo : 'numeros';
    let min, max;
    if (estilo === 'emojis') { min = 1; max = int(q.max, 3, 5, 5); }
    else if (estilo === 'estrelas') { min = 1; max = int(q.max, 3, 10, 5); }
    else { min = int(q.min, 0, 1, 1); max = int(q.max, min + 1, 10, 5); }
    return {
      id, chave, tipo, estilo,
      rotulo: str(q.rotulo, 400), ajuda: str(q.ajuda, 400),
      obrigatoria: tipo === 'aviso' ? false : bool(q.obrigatoria),
      placeholder: str(q.placeholder, 120),
      opcoes,
      outra: (tipo === 'unica' || tipo === 'multipla' || tipo === 'dropdown') && bool(q.outra),
      linhas: tipo === 'matriz' ? listOf(q.linhas, 12, 300) : [],
      exclusivas: tipo === 'multipla' ? listOf(q.exclusivas).filter(x => opcoes.includes(x)) : [],
      compacta: bool(q.compacta),
      min, max,
      rotulo_min: str(q.rotulo_min, 60), rotulo_max: str(q.rotulo_max, 60),
      prefill: listOf(typeof q.prefill === 'string' ? q.prefill.split(',') : q.prefill, 20, 40).filter(x => /^[\w.-]+$/.test(x)),
      proxima: str(q.proxima, 24), ramos: q.ramos && typeof q.ramos === 'object' ? q.ramos : {}
    };
  });
  const answerable = new Set(perguntas.filter(q => q.tipo !== 'aviso').map(q => q.id));

  // Destinations must be an existing question (or "fim"); anything else falls back to the default next question.
  const validDest = (dest, own) => dest === 'fim' || (ids.has(dest) && dest !== own);
  for (const q of perguntas) {
    if (!validDest(q.proxima, q.id)) q.proxima = '';
    const ramos = {};
    for (const v of branchValues(q)) {
      const dest = typeof q.ramos[v] === 'string' ? q.ramos[v] : '';
      if (dest && validDest(dest, q.id)) ramos[v] = dest;
    }
    q.ramos = ramos;
  }

  const arquivadas = Array.isArray(prev?.arquivadas) ? prev.arquivadas.slice(0, 200) : [];
  (prev?.perguntas || []).forEach((q, i) => {
    if (q.tipo === 'aviso' || ids.has(q.id) || arquivadas.some(a => a.id === q.id)) return;
    arquivadas.push({ id: q.id, chave: q.chave, tipo: q.tipo, estilo: q.estilo || 'numeros', rotulo: q.rotulo, opcoes: q.opcoes, linhas: q.linhas, outra: q.outra, min: q.min, max: q.max, posicao: i + 1, removida_em: new Date().toISOString() });
  });

  // One webhook for the whole form: on completion and/or when one chosen question is answered.
  // Forms saved before this layout had a webhook per question; the first one found becomes the chosen question.
  let wh = aj.webhook;
  if (!wh || typeof wh !== 'object') {
    const fin = aj.webhook_final || {};
    const legacy = (Array.isArray(s.perguntas) ? s.perguntas : []).find(q => q?.webhook?.ativo && q.webhook.url);
    wh = {
      url: (fin.ativo && fin.url) || legacy?.webhook?.url || '', segredo: (fin.ativo && fin.url ? fin.segredo : legacy?.webhook?.segredo) || '',
      ao_concluir: !!(fin.ativo && fin.url), ao_responder: !!legacy, pergunta: legacy?.id || ''
    };
  }

  // Redirect rules: a rule that points at a deleted question is dropped (it would otherwise match everyone).
  const redir = fi.redirecionamento && typeof fi.redirecionamento === 'object' ? fi.redirecionamento : {};
  const regras = (Array.isArray(redir.regras) ? redir.regras : []).slice(0, 30).map(r => {
    r = r || {};
    const condicoes = (Array.isArray(r.condicoes) ? r.condicoes : []).slice(0, 10)
      .map(c => ({ pergunta: str(c?.pergunta, 24), op: OPS.includes(c?.op) ? c.op : 'igual', valor: str(c?.valor, 200), linha: /^[A-L]$/.test(c?.linha) ? c.linha : '' }));
    if (condicoes.some(c => !answerable.has(c.pergunta))) return null;
    return { id: str(r.id, 24) || newId('r'), nome: str(r.nome, 80), condicoes, url: safeUrlTemplate(r.url) };
  }).filter(Boolean);

  return {
    boas_vindas: { ativo: bool(bv.ativo), eyebrow: str(bv.eyebrow, 80), titulo: str(bv.titulo, 300), texto: str(bv.texto, 800), botao: str(bv.botao, 40) || d.boas_vindas.botao, nota: str(bv.nota, 120) },
    perguntas,
    envio: { titulo: str(ev.titulo, 300), texto: str(ev.texto, 600), botao: str(ev.botao, 40) || d.envio.botao },
    consentimento: { ativo: bool(co.ativo), texto: str(co.texto, 800) },
    final: {
      titulo: str(fi.titulo, 300), texto: str(fi.texto, 1000), etiqueta: str(fi.etiqueta, 80), cta_texto: str(fi.cta_texto, 60), cta_url: safeUrl(fi.cta_url),
      redirecionamento: { ativo: bool(redir.ativo), url_padrao: safeUrlTemplate(redir.url_padrao), regras }
    },
    pontuacao: sanitizePontuacao(s.pontuacao, answerable),
    encerrado: { titulo: str(en.titulo, 200), texto: str(en.texto, 800), cta_texto: str(en.cta_texto, 60), cta_url: safeUrl(en.cta_url) },
    em_breve: { titulo: str(eb.titulo, 200), texto: str(eb.texto, 800) },
    agenda: { abre_em: isoDate(ag.abre_em), fecha_em: isoDate(ag.fecha_em) },
    tema: {
      fundo: hex(te.fundo, d.tema.fundo), texto: hex(te.texto, d.tema.texto), destaque: hex(te.destaque, d.tema.destaque), destaque2: hex(te.destaque2, d.tema.destaque2),
      fonte: FONTS.includes(te.fonte) ? te.fonte : d.tema.fonte, raio: int(te.raio, 0, 24, d.tema.raio),
      grade: bool(te.grade), logo: safeUrl(te.logo), fundo_imagem: safeUrl(te.fundo_imagem)
    },
    ajustes: {
      webhook: { url: safeUrl(wh.url), segredo: str(wh.segredo, 200).trim(), ao_concluir: bool(wh.ao_concluir), ao_responder: bool(wh.ao_responder), pergunta: answerable.has(wh.pergunta) ? wh.pergunta : '' },
      params_extra: listOf(typeof aj.params_extra === 'string' ? aj.params_extra.split(',') : aj.params_extra, 20, 40).filter(x => /^[\w.-]+$/.test(x)).join(', '),
      uma_vez: bool(aj.uma_vez), mostrar_progresso: aj.mostrar_progresso !== false, mostrar_numero: aj.mostrar_numero !== false,
      rotulo_topo: str(aj.rotulo_topo, 80),
      seo: { titulo: str(seo.titulo, 90), descricao: str(seo.descricao, 200), imagem: safeUrl(seo.imagem) }
    },
    arquivadas
  };
}

// Blocking problems that prevent saving as published (drafts may be incomplete).
function problems(schema) {
  const out = [];
  const qs = schema.perguntas;
  if (!qs.length) out.push('Adicione pelo menos uma pergunta.');
  const pos = id => qs.findIndex(q => q.id === id);
  qs.forEach((q, i) => {
    const at = `Pergunta ${i + 1}`;
    if (!q.rotulo.trim()) out.push(`${at}: escreva ${q.tipo === 'aviso' ? 'o título da mensagem' : 'o enunciado'}.`);
    if (q.tipo === 'matriz' && (q.opcoes.length < 2 || !q.linhas.length)) out.push(`${at}: adicione pelo menos duas colunas e uma linha.`);
    if (CHOICE.has(q.tipo) && q.opcoes.length < (q.outra ? 1 : 2)) out.push(`${at}: adicione pelo menos duas opções.`);
    for (const dest of [q.proxima, ...Object.values(q.ramos)]) {
      if (dest && dest !== 'fim' && pos(dest) <= i) out.push(`${at}: o destino da navegação (pergunta ${pos(dest) + 1}) vem antes desta. Escolha uma pergunta seguinte.`);
    }
  });
  const po = schema.pontuacao;
  if (po && po.ativo && !po.resultados.length) out.push('Pontuação: crie pelo menos um resultado ou desative a pontuação.');
  const w = schema.ajustes.webhook;
  if ((w.ao_concluir || w.ao_responder) && !w.url) out.push('Webhook: informe a URL de destino (http ou https).');
  if (w.ao_responder && !w.pergunta) out.push('Webhook: escolha em qual pergunta ele deve disparar.');
  if (schema.consentimento.ativo && !schema.consentimento.texto.trim()) out.push('Ajustes: escreva o texto do consentimento.');
  const { abre_em: abre, fecha_em: fecha } = schema.agenda;
  if (abre && fecha && Date.parse(fecha) <= Date.parse(abre)) out.push('Agenda: a data de encerramento deve ser depois da abertura.');
  const r = schema.final.redirecionamento;
  if (r.ativo) {
    r.regras.forEach((rule, i) => {
      if (!rule.condicoes.length) out.push(`Redirecionamento, regra ${i + 1}: adicione pelo menos uma condição.`);
      if (!rule.url) out.push(`Redirecionamento, regra ${i + 1}: informe a URL de destino (http ou https).`);
    });
  }
  return [...new Set(out)];
}

// Once a form has been opened, a question's type (and rating style) can't change: past answers would stop making sense.
function lockedChanges(prev, next) {
  const out = [];
  next.perguntas.forEach((q, i) => {
    const old = prev.perguntas.find(p => p.id === q.id);
    if (!old) return;
    if (old.tipo !== q.tipo || (old.estilo || 'numeros') !== q.estilo) {
      out.push(`Pergunta ${i + 1}: não é possível alterar o tipo depois que o formulário foi aberto. Crie uma nova pergunta.`);
    } else if (q.tipo === 'escala' && (old.min !== q.min || old.max !== q.max)) {
      out.push(`Pergunta ${i + 1}: não é possível alterar a escala depois que o formulário foi aberto. Crie uma nova pergunta.`);
    }
  });
  return out;
}

// What the respondent's browser may see: no webhook, redirect rules or archived questions.
function publicSchema(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  delete copy.ajustes.webhook;
  delete copy.final.redirecionamento;
  delete copy.arquivadas;
  delete copy.pontuacao;
  return copy;
}

// Brings a stored schema up to the current shape (fields added in later versions get their defaults).
const normalize = schema => sanitize(schema, { arquivadas: schema.arquivadas || [], perguntas: [] });

module.exports = { normalize, FONTS, TIPOS, CHOICE, BRANCHING, ESTILOS, newId, defaultSchema, sanitize, problems, lockedChanges, publicSchema, slugKey, branchValues };
