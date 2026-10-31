'use strict';
// Form schema: defaults, sanitizing (admin input is never trusted) and the public view.
const crypto = require('node:crypto');

const FONTS = ['Manrope', 'Inter', 'DM Sans', 'Poppins', 'Montserrat', 'Space Grotesk', 'Sora', 'Outfit', 'Playfair Display', 'Lora'];
const TIPOS = ['texto', 'longo', 'email', 'telefone', 'numero', 'url', 'data', 'cidade_uf', 'unica', 'multipla', 'sim_nao', 'escala', 'aviso'];
const CHOICE = new Set(['unica', 'multipla']);

const newId = (prefix = 'q') => prefix + crypto.randomBytes(4).toString('hex');

function defaultSchema() {
  return {
    boas_vindas: { ativo: true, eyebrow: '', titulo: 'Bem-vindo(a)!', texto: 'Leva menos de dois minutos para responder.', botao: 'Começar' },
    perguntas: [
      { id: newId(), chave: 'nome', tipo: 'texto', rotulo: 'Qual é o seu nome?', ajuda: '', obrigatoria: true, placeholder: 'Digite seu nome', opcoes: [], outra: false, exclusivas: [], compacta: false, min: 1, max: 5, rotulo_min: '', rotulo_max: '', prefill: ['nome', 'name'], webhook: { ativo: false, url: '', segredo: '' } }
    ],
    envio: { titulo: 'Pronto. *Só falta enviar.*', texto: 'Se quiser revisar alguma resposta, use a seta ↑ no canto da tela.', botao: 'Enviar respostas' },
    consentimento: { ativo: false, texto: 'Autorizo o uso das minhas respostas para entrar em contato.' },
    final: { titulo: 'Obrigado!', texto: 'Recebemos as suas respostas.', cta_texto: '', cta_url: '' },
    tema: { fundo: '#0b0b0f', texto: '#f5f5f7', destaque: '#6366f1', fonte: 'Manrope', raio: 6, grade: true, logo: '', fundo_imagem: '' },
    ajustes: { webhook_final: { ativo: false, url: '', segredo: '' }, params_extra: '', uma_vez: false, mostrar_progresso: true, mostrar_numero: true }
  };
}

const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = v => v === true;
const int = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

function safeUrl(v) {
  v = str(v, 600).trim();
  if (!v) return '';
  if (/^\/uploads\/[\w.-]+$/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

function webhook(w) {
  w = w || {};
  return { ativo: bool(w.ativo), url: safeUrl(w.url), segredo: str(w.segredo, 200).trim() };
}

function slugKey(v) {
  return str(v, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function listOf(v, max = 60, len = 200) {
  const src = Array.isArray(v) ? v : [];
  return [...new Set(src.map(x => str(x, len).trim()).filter(Boolean))].slice(0, max);
}

function sanitize(input) {
  const d = defaultSchema();
  const s = input && typeof input === 'object' ? input : {};
  const bv = s.boas_vindas || {}, ev = s.envio || {}, co = s.consentimento || {}, fi = s.final || {}, te = s.tema || {}, aj = s.ajustes || {};

  const ids = new Set(), keys = new Set();
  const perguntas = (Array.isArray(s.perguntas) ? s.perguntas : []).slice(0, 200).map((q, i) => {
    q = q || {};
    let id = typeof q.id === 'string' && /^[a-z0-9_]{3,24}$/i.test(q.id) && !ids.has(q.id) ? q.id : newId();
    ids.add(id);
    const tipo = TIPOS.includes(q.tipo) ? q.tipo : 'texto';
    let chave = slugKey(q.chave) || `pergunta_${i + 1}`;
    for (let n = 2; keys.has(chave); n++) chave = `${slugKey(q.chave) || `pergunta_${i + 1}`}_${n}`;
    keys.add(chave);
    const opcoes = CHOICE.has(tipo) ? listOf(q.opcoes) : [];
    const min = int(q.min, 0, 1, 1);
    return {
      id, chave, tipo,
      rotulo: str(q.rotulo, 400), ajuda: str(q.ajuda, 400),
      obrigatoria: tipo === 'aviso' ? false : bool(q.obrigatoria),
      placeholder: str(q.placeholder, 120),
      opcoes,
      outra: CHOICE.has(tipo) && bool(q.outra),
      exclusivas: tipo === 'multipla' ? listOf(q.exclusivas).filter(x => opcoes.includes(x)) : [],
      compacta: bool(q.compacta),
      min, max: int(q.max, min + 1, 10, 5),
      rotulo_min: str(q.rotulo_min, 60), rotulo_max: str(q.rotulo_max, 60),
      prefill: listOf(typeof q.prefill === 'string' ? q.prefill.split(',') : q.prefill, 20, 40).filter(x => /^[\w.-]+$/.test(x)),
      webhook: webhook(q.webhook)
    };
  });

  return {
    boas_vindas: { ativo: bool(bv.ativo), eyebrow: str(bv.eyebrow, 80), titulo: str(bv.titulo, 300), texto: str(bv.texto, 800), botao: str(bv.botao, 40) || d.boas_vindas.botao },
    perguntas,
    envio: { titulo: str(ev.titulo, 300), texto: str(ev.texto, 600), botao: str(ev.botao, 40) || d.envio.botao },
    consentimento: { ativo: bool(co.ativo), texto: str(co.texto, 800) },
    final: { titulo: str(fi.titulo, 300), texto: str(fi.texto, 1000), cta_texto: str(fi.cta_texto, 60), cta_url: safeUrl(fi.cta_url) },
    tema: {
      fundo: hex(te.fundo, d.tema.fundo), texto: hex(te.texto, d.tema.texto), destaque: hex(te.destaque, d.tema.destaque),
      fonte: FONTS.includes(te.fonte) ? te.fonte : d.tema.fonte, raio: int(te.raio, 0, 24, d.tema.raio),
      grade: bool(te.grade), logo: safeUrl(te.logo), fundo_imagem: safeUrl(te.fundo_imagem)
    },
    ajustes: {
      webhook_final: webhook(aj.webhook_final),
      params_extra: listOf(typeof aj.params_extra === 'string' ? aj.params_extra.split(',') : aj.params_extra, 20, 40).filter(x => /^[\w.-]+$/.test(x)).join(', '),
      uma_vez: bool(aj.uma_vez), mostrar_progresso: aj.mostrar_progresso !== false, mostrar_numero: aj.mostrar_numero !== false
    }
  };
}

// Blocking problems that prevent publishing (drafts may be incomplete).
function problems(schema) {
  const out = [];
  const n = schema.perguntas.length;
  if (!n) out.push('Adicione pelo menos uma pergunta.');
  schema.perguntas.forEach((q, i) => {
    const at = `Pergunta ${i + 1}`;
    if (!q.rotulo.trim()) out.push(`${at}: escreva o enunciado.`);
    if (CHOICE.has(q.tipo) && q.opcoes.length < (q.outra ? 1 : 2)) out.push(`${at}: adicione pelo menos duas opções.`);
    if (q.webhook.ativo && !q.webhook.url) out.push(`${at}: o webhook está ativo, mas a URL está vazia ou inválida.`);
  });
  const w = schema.ajustes.webhook_final;
  if (w.ativo && !w.url) out.push('Ajustes: o webhook de conclusão está ativo, mas a URL está vazia ou inválida.');
  if (schema.consentimento.ativo && !schema.consentimento.texto.trim()) out.push('Ajustes: escreva o texto do consentimento.');
  return out;
}

// What the respondent's browser may see: no webhook URLs or secrets.
function publicSchema(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  for (const q of copy.perguntas) delete q.webhook;
  delete copy.ajustes.webhook_final;
  return copy;
}

module.exports = { FONTS, TIPOS, CHOICE, newId, defaultSchema, sanitize, problems, publicSchema, slugKey };
