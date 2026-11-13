'use strict';
// Custom Typeform: admin panel + public forms (/f/:slug). No npm dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { createStore } = require('./lib/db');
const { createAuth, createLimiter } = require('./lib/auth');
const { createWebhooks } = require('./lib/webhooks');
const schemaLib = require('./lib/schema');
const { checkAnswer, matrixComplete, isText } = require('./lib/validate');
const stats = require('./lib/stats');
const routing = require('./public/route.js');
const score = require('./lib/score');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_DIR = path.join(__dirname, 'admin');
const DEFAULT_META = /^(transaction|sck|src|xcod|utm_[a-z]+)$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'static', 'uploads', 'preview', 'f']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const store = createStore(DATA_DIR);
const auth = createAuth(DATA_DIR, process.env.ADMIN_PASSWORD || '');
const hooks = createWebhooks(store);

const loginLimited = createLimiter(8, 15 * 60_000);
const answerLimited = createLimiter(240, 10 * 60_000);
const completeLimited = createLimiter(20, 10 * 60_000);
const viewLimited = createLimiter(60, 10 * 60_000);

/* ---------- helpers ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}
const json = (res, status, data) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
const fail = (res, status, erro, extra = {}) => json(res, status, { ok: false, erro, ...extra });

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress;
}
const isHttps = req => TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 512 * 1024) {
  const raw = (await readRaw(req, limit)).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function serveFile(req, res, file, cache = 'no-cache') {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, ETag: etag };
    if (ext === '.svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    if (req.headers['if-none-match'] === etag) return send(res, 304, undefined, headers);
    fs.readFile(file, (e, buf) => (e ? send(res, 500, 'Erro') : send(res, 200, req.method === 'HEAD' ? undefined : buf, headers)));
  });
}
function serveDir(req, res, dir, rel, cache) {
  let clean;
  try { clean = decodeURIComponent(rel).replace(/^\/+/, ''); } catch { return send(res, 400, 'Bad request'); }
  const file = path.normalize(path.join(dir, clean));
  if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden');
  serveFile(req, res, file, cache);
}

const validSlug = s => typeof s === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length >= 2 && s.length <= 60 && !RESERVED_SLUGS.has(s);

function slugify(text) {
  const base = schemaLib.slugKey(text).replace(/_/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'formulario';
  return RESERVED_SLUGS.has(base) ? `${base}-form` : base;
}
function uniqueSlug(text, exceptId) {
  const base = slugify(text);
  if (!store.slugTaken(base, exceptId)) return base;
  for (let n = 2; ; n++) if (!store.slugTaken(`${base}-${n}`, exceptId)) return `${base}-${n}`;
}

function metaFor(form, input) {
  const extra = new Set((form.schema.ajustes.params_extra || '').split(',').map(s => s.trim()).filter(Boolean));
  const meta = {};
  for (const [k, v] of Object.entries(input || {})) if ((DEFAULT_META.test(k) || extra.has(k)) && isText(v)) meta[k] = v.slice(0, 200);
  return meta;
}

const formSummary = f => ({ id: f.id, slug: f.slug, titulo: f.title });

/* ---------- webhooks glue ---------- */

// One webhook per form (Ajustes): it fires when the form is completed and/or when one chosen question is answered.
function fireQuestionHook(form, q, response, value, outra) {
  const w = form.schema.ajustes.webhook;
  if (!w.ao_responder || !w.url || w.pergunta !== q.id) return;
  hooks.dispatch({
    form_id: form.id, response_id: response.id, question_id: q.id, event: 'question.answered',
    url: w.url, secret: w.segredo,
    payload: {
      evento: 'question.answered', enviado_em: new Date().toISOString(), formulario: formSummary(form), resposta_id: response.id,
      pergunta: { id: q.id, chave: q.chave, tipo: q.tipo, rotulo: q.rotulo },
      resposta: value, ...(outra ? { resposta_outra: outra } : {}),
      respostas: stats.keyed(form.schema, response.answers), meta: response.meta, concluida: !!response.completed_at
    }
  });
}
function fireCompleteHook(form, response, pts) {
  const w = form.schema.ajustes.webhook;
  if (!w.ao_concluir || !w.url) return;
  hooks.dispatch({
    form_id: form.id, response_id: response.id, question_id: null, event: 'form.completed', url: w.url, secret: w.segredo,
    payload: {
      evento: 'form.completed', enviado_em: new Date().toISOString(), formulario: formSummary(form), resposta_id: response.id,
      iniciada_em: response.started_at, concluida_em: response.completed_at,
      ...(pts ? { pontuacao: pts.pontos, tags: pts.tags, resultado: pts.resultado?.chave || '' } : {}),
      respostas: stats.keyed(form.schema, response.answers), meta: response.meta
    }
  });
}
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- public API ---------- */

// Public forms are everything except drafts; whether they accept answers depends on status and schedule.
function publishedForm(slug) {
  const f = store.getFormBySlug(slug);
  return f && f.status !== 'draft' ? f : null;
}

const GRACE_MS = 10 * 60_000;
function openState(f, now = Date.now()) {
  if (f.status === 'closed') return 'encerrado';
  const { abre_em: abre, fecha_em: fecha } = f.schema.agenda;
  if (abre && now < Date.parse(abre)) return 'em_breve';
  if (fecha && now >= Date.parse(fecha)) return 'encerrado';
  return 'aberto';
}
// People already filling the form when a scheduled closing hits get a few minutes to finish.
function acceptsAnswers(f, response) {
  if (openState(f) === 'aberto') return true;
  const fecha = f.schema.agenda.fecha_em;
  return f.status === 'published' && !!fecha && !!response && Date.parse(response.started_at) < Date.parse(fecha) && Date.now() < Date.parse(fecha) + GRACE_MS;
}
const CLOSED_MSG = 'Este formulário não está mais recebendo respostas.';

function fillUrl(url, schema, answers, rid) {
  const byKey = { resposta_id: rid };
  for (const q of schema.perguntas) if (q.tipo !== 'aviso') byKey[q.chave] = stats.display(q, answers[q.id]);
  return url.replace(/\{([a-z0-9_]+)\}/gi, (_, k) => encodeURIComponent(byKey[k] ?? ''));
}

const publicRoutes = {
  async get(req, res, { slug }) {
    const f = publishedForm(slug);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    json(res, 200, { ok: true, titulo: f.title, slug: f.slug, estado: openState(f), schema: schemaLib.publicSchema(f.schema) });
  },

  async view(req, res, { slug }) {
    const f = publishedForm(slug);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    if (openState(f) === 'aberto' && !viewLimited(clientIp(req))) store.addView(f.id, stats.dayKey(new Date()));
    json(res, 200, { ok: true });
  },

  // Called every time the respondent moves past a question: progress is saved and the question webhook fires.
  async answer(req, res, { slug }) {
    if (answerLimited(clientIp(req))) return fail(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
    const f = publishedForm(slug);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    const body = await readJson(req, 64 * 1024).catch(() => null);
    if (!body) return fail(res, 400, 'Requisição inválida.');
    const q = f.schema.perguntas.find(x => x.id === body.qid && x.tipo !== 'aviso');
    if (!q) return fail(res, 400, 'Pergunta inválida.');
    const check = checkAnswer(q, body.value, body.outra);
    if (check.error) return fail(res, 422, 'Resposta inválida.', { campos: { [q.id]: check.error } });

    let r = typeof body.rid === 'string' ? store.getResponse(body.rid, f.id) : null;
    if (r?.completed_at) return json(res, 200, { ok: true, rid: r.id, concluida: true });
    if (!acceptsAnswers(f, r)) return fail(res, 403, CLOSED_MSG, { estado: openState(f) });
    if (!r) {
      r = { id: crypto.randomUUID(), form_id: f.id, answers: {}, meta: metaFor(f, body.meta), last_qid: null };
      store.insertResponse(r);
    }
    const prev = { value: r.answers[q.id], outra: r.answers[`${q.id}_outra`] };
    delete r.answers[q.id]; delete r.answers[`${q.id}_outra`];
    if (!check.empty) {
      r.answers[q.id] = check.value;
      if (check.outra) r.answers[`${q.id}_outra`] = check.outra;
    }
    r.last_qid = q.id;
    store.saveResponse(r);
    if (!check.empty && !(sameJson(prev.value, check.value) && prev.outra === check.outra)) fireQuestionHook(f, q, r, check.value, check.outra);
    json(res, 200, { ok: true, rid: r.id });
  },

  async complete(req, res, { slug }) {
    if (completeLimited(clientIp(req))) return fail(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
    const f = publishedForm(slug);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    const body = await readJson(req, 128 * 1024).catch(() => null);
    if (!body) return fail(res, 400, 'Requisição inválida.');
    if (body.website) return json(res, 200, { ok: true }); // honeypot: bots fill it; pretend success and drop it

    const errors = {}, clean = {}, bad = {}, answers = {};
    const sent = body.respostas && typeof body.respostas === 'object' ? body.respostas : {};
    const qs = f.schema.perguntas;
    for (const q of qs) {
      if (q.tipo === 'aviso') continue;
      const c = checkAnswer({ ...q, obrigatoria: false }, sent[q.id], sent[`${q.id}_outra`]);
      if (c.error) bad[q.id] = c.error;
      else if (!c.empty) { clean[q.id] = c.value; if (c.outra) clean[`${q.id}_outra`] = c.outra; }
    }
    // Only questions on this respondent's route count; answers to skipped ones are stale and dropped.
    for (const q of routing.visited(qs, clean).map(i => qs[i])) {
      if (q.tipo === 'aviso') continue;
      if (bad[q.id]) errors[q.id] = bad[q.id];
      else if (clean[q.id] === undefined) { if (q.obrigatoria) errors[q.id] = 'obrigatória'; }
      else if (q.tipo === 'matriz' && q.obrigatoria && !matrixComplete(q, clean[q.id])) errors[q.id] = 'obrigatória';
      else { answers[q.id] = clean[q.id]; if (clean[`${q.id}_outra`]) answers[`${q.id}_outra`] = clean[`${q.id}_outra`]; }
    }
    if (f.schema.consentimento.ativo && body.consentimento !== true) errors.consentimento = 'obrigatório';
    if (Object.keys(errors).length) return fail(res, 422, 'Algumas respostas são inválidas.', { campos: errors });

    let r = typeof body.rid === 'string' ? store.getResponse(body.rid, f.id) : null;
    if (r?.completed_at) return json(res, 200, { ok: true });
    if (!acceptsAnswers(f, r)) return fail(res, 403, CLOSED_MSG, { estado: openState(f) });
    if (!r) {
      r = { id: crypto.randomUUID(), form_id: f.id, answers: {}, meta: metaFor(f, body.meta), last_qid: null };
      store.insertResponse(r);
    }
    const before = r.answers;
    // Answers to questions deleted from the form ("passadas") are kept as they were.
    const current = new Set(qs.map(q => q.id));
    const kept = Object.fromEntries(Object.entries(before).filter(([k]) => !current.has(k.replace(/_outra$/, ''))));
    r.answers = { ...kept, ...answers };
    // Score: points per variable, lead tags and the result screen are decided here (rules never reach the browser).
    const pts = score.compute(f.schema, answers);
    if (pts) r.answers._pontuacao = { pontos: pts.pontos, tags: pts.tags, resultado: pts.resultado?.chave || '' };
    r.completed_at = new Date().toISOString();
    r.started_at = store.getResponse(r.id, f.id).started_at;
    store.saveResponse(r);
    // Any answer the incremental save missed (offline, deleted draft) still triggers its webhook.
    for (const q of qs) {
      if (answers[q.id] !== undefined && !sameJson(before[q.id], answers[q.id])) fireQuestionHook(f, q, r, answers[q.id], answers[`${q.id}_outra`]);
    }
    fireCompleteHook(f, r, pts);
    // Conditional redirect: chosen here so the rules and URLs never reach the browser unless they match.
    const target = routing.redirectFor(f.schema.final.redirecionamento, answers);
    const chosen = pts?.resultado;
    json(res, 200, {
    ok: true, redirect: target ? fillUrl(target, f.schema, answers, r.id) : '',
    resultado: chosen ? { titulo: chosen.titulo, texto: chosen.texto, produto: chosen.produto, botao_texto: chosen.botao_texto, botao_url: chosen.botao_url ? fillUrl(chosen.botao_url, f.schema, answers, r.id) : '' } : null
    });
  }
};

/* ---------- admin API ---------- */

function formPayload(f) {
  return { id: f.id, slug: f.slug, titulo: f.title, status: f.status, estado: f.status === 'draft' ? 'rascunho' : openState(f), aberto_em: f.opened_at, schema: f.schema, criado_em: f.created_at, atualizado_em: f.updated_at };
}
const daysOf = q => { const n = Number(q.get('days')); return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.floor(n) : 30; };

const adminRoutes = [
  ['GET', '/api/admin/forms', async (req, res) => {
    json(res, 200, { ok: true, forms: store.listForms().map(({ agenda, ...f }) => ({ ...f, agenda, rate: f.started ? f.completed / f.started : 0, estado: f.status === 'draft' ? 'rascunho' : openState({ status: f.status, schema: { agenda } }) })) });
  }],

  ['POST', '/api/admin/forms', async (req, res) => {
    const body = await readJson(req);
    const title = (isText(body.titulo) ? body.titulo.trim() : '').slice(0, 120) || 'Formulário sem título';
    let schema;
    if (body.copiar_de) {
      const src = store.getForm(body.copiar_de);
      if (!src) return fail(res, 404, 'Formulário de origem não encontrado.');
      schema = JSON.parse(JSON.stringify(src.schema));
      const map = {};
      for (const q of schema.perguntas) { map[q.id] = schemaLib.newId(); }
      const w = schema.ajustes.webhook;
      for (const rg of schema.pontuacao?.regras || []) rg.pergunta = map[rg.pergunta] || rg.pergunta;
      w.pergunta = map[w.pergunta] || '';
      for (const rule of schema.final.redirecionamento.regras) for (const c of rule.condicoes) c.pergunta = map[c.pergunta] || c.pergunta;
      schema.agenda = { abre_em: '', fecha_em: '' };
      for (const q of schema.perguntas) {
        q.id = map[q.id];
        q.proxima = map[q.proxima] || (q.proxima === 'fim' ? 'fim' : '');
        q.ramos = Object.fromEntries(Object.entries(q.ramos || {}).map(([k, v]) => [k, map[v] || v]));
      }
    } else schema = schemaLib.defaultSchema();
    const id = crypto.randomUUID();
    store.createForm({ id, slug: uniqueSlug(title), title, status: 'draft', schema: schemaLib.sanitize(schema) });
    json(res, 201, { ok: true, form: formPayload(store.getForm(id)) });
  }],

  ['GET', '/api/admin/forms/:id', async (req, res, { id }) => {
    const f = store.getForm(id);
    f ? json(res, 200, { ok: true, form: formPayload(f) }) : fail(res, 404, 'Formulário não encontrado.');
  }],

  ['PUT', '/api/admin/forms/:id', async (req, res, { id }) => {
    const f = store.getForm(id);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    const body = await readJson(req);
    const title = (isText(body.titulo) ? body.titulo.trim() : '').slice(0, 120) || f.title;
    const slug = isText(body.slug) ? body.slug.trim().toLowerCase() : f.slug;
    if (!validSlug(slug)) return fail(res, 422, 'Slug inválido: use 2 a 60 caracteres entre letras minúsculas, números e hífens (ex.: pesquisa-clientes).', { campo: 'slug' });
    if (store.slugTaken(slug, id)) return fail(res, 409, 'Já existe outro formulário com esse slug.', { campo: 'slug' });
    const schema = schemaLib.sanitize(body.schema, f.schema);
    const status = body.status === 'published' || body.status === 'closed' ? body.status : 'draft';
    if (f.opened_at) {
      const locked = schemaLib.lockedChanges(f.schema, schema);
      if (locked.length) return fail(res, 422, 'O tipo das perguntas não pode mudar depois que o formulário foi aberto.', { problemas: locked });
    }
    if (status === 'published') {
      const issues = schemaLib.problems(schema);
      if (issues.length) return fail(res, 422, 'Corrija os pontos abaixo para publicar.', { problemas: issues });
    }
    store.updateForm(id, { slug, title, status, schema });
    json(res, 200, { ok: true, form: formPayload(store.getForm(id)) });
  }],

  ['DELETE', '/api/admin/forms/:id', async (req, res, { id }) => {
    if (!store.getForm(id)) return fail(res, 404, 'Formulário não encontrado.');
    store.deleteForm(id);
    json(res, 200, { ok: true });
  }],

  ['GET', '/api/admin/forms/:id/stats', async (req, res, { id }, url) => {
    const f = store.getForm(id);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    const days = daysOf(url.searchParams);
    const since = stats.sinceFor(days);
    const sinceDay = days ? stats.dayKey(Date.now() - (days - 1) * 86400000) : '0000-00-00';
    json(res, 200, { ok: true, stats: stats.computeStats(f, store.allResponses(id, since), store.viewsByDay(id, sinceDay), days) });
  }],

  ['GET', '/api/admin/forms/:id/responses', async (req, res, { id }, url) => {
    const f = store.getForm(id);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    const q = url.searchParams;
    const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 25));
    const page = Math.max(1, Number(q.get('page')) || 1);
    const out = store.listResponses(id, {
      status: q.get('status') || 'all', search: (q.get('q') || '').slice(0, 100),
      since: stats.sinceFor(daysOf(q)), limit, offset: (page - 1) * limit
    });
    json(res, 200, { ok: true, total: out.total, page, limit, respostas: out.rows });
  }],

  ['GET', '/api/admin/forms/:id/responses.csv', async (req, res, { id }, url) => {
    const f = store.getForm(id);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    send(res, 200, stats.toCsv(f, store.allResponses(id, stats.sinceFor(daysOf(url.searchParams)))), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${f.slug}-respostas-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }],

  ['DELETE', '/api/admin/forms/:id/responses/:rid', async (req, res, { id, rid }) => {
    store.deleteResponse(rid, id);
    json(res, 200, { ok: true });
  }],

  ['GET', '/api/admin/forms/:id/webhook-logs', async (req, res, { id }, url) => {
    if (!store.getForm(id)) return fail(res, 404, 'Formulário não encontrado.');
    json(res, 200, { ok: true, logs: store.listLogs(id, { questionId: url.searchParams.get('pergunta') || '', limit: 60 }) });
  }],

  ['POST', '/api/admin/forms/:id/webhook-logs/:logId/retry', async (req, res, { id, logId }) => {
    const f = store.getForm(id);
    const log = f && store.getLog(Number(logId), id);
    if (!log) return fail(res, 404, 'Registro não encontrado.');
    const secret = f.schema.ajustes.webhook.segredo;
    const r = await hooks.once({ form_id: id, response_id: log.response_id, question_id: log.question_id, event: log.event, url: log.url, secret, payload: log.payload });
    json(res, 200, { ok: true, resultado: r });
  }],

  // Sends a sample payload so the destination can be configured before real responses arrive.
  ['POST', '/api/admin/forms/:id/webhook-test', async (req, res, { id }) => {
    const f = store.getForm(id);
    if (!f) return fail(res, 404, 'Formulário não encontrado.');
    const body = await readJson(req);
    let url;
    try { url = new URL(body.url); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { return fail(res, 422, 'URL inválida.'); }
    const q = f.schema.perguntas.find(x => x.id === body.pergunta_id);
    const sample = q
      ? { evento: 'question.answered', teste: true, enviado_em: new Date().toISOString(), formulario: formSummary(f), resposta_id: 'teste', pergunta: { id: q.id, chave: q.chave, tipo: q.tipo, rotulo: q.rotulo }, resposta: 'Exemplo de resposta', respostas: { [q.chave]: 'Exemplo de resposta' }, meta: {}, concluida: false }
      : { evento: 'form.completed', teste: true, enviado_em: new Date().toISOString(), formulario: formSummary(f), resposta_id: 'teste', respostas: {}, meta: {} };
    const r = await hooks.once({ form_id: id, response_id: null, question_id: q?.id || null, event: `${sample.evento}.test`, url: url.href, secret: isText(body.segredo) ? body.segredo.trim() : '', payload: sample });
    json(res, 200, { ok: true, resultado: r });
  }],

  ['POST', '/api/admin/upload', async (req, res) => {
    const type = (req.headers['content-type'] || '').split(';')[0];
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[type];
    if (!ext) return fail(res, 415, 'Use PNG, JPG, WebP, GIF ou SVG.');
    const buf = await readRaw(req, 4 * 1024 * 1024).catch(() => null);
    if (!buf?.length) return fail(res, 413, 'Arquivo vazio ou maior que 4 MB.');
    const head = buf.subarray(0, 12);
    const magic = { png: head[0] === 0x89 && head[1] === 0x50, jpg: head[0] === 0xff && head[1] === 0xd8, gif: head.subarray(0, 3).toString() === 'GIF', webp: head.subarray(8, 12).toString() === 'WEBP', svg: buf.toString('utf8', 0, 2048).includes('<svg') };
    if (!magic[ext]) return fail(res, 415, 'O arquivo não corresponde ao formato informado.');
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    json(res, 201, { ok: true, url: `/uploads/${name}` });
  }]
].map(([method, pattern, handler]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { method, re, keys, handler };
});

async function handleAdminApi(req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    if (loginLimited(clientIp(req))) return fail(res, 429, 'Muitas tentativas. Aguarde 15 minutos.');
    if (!auth.enabled) return fail(res, 503, 'Defina a variável ADMIN_PASSWORD no servidor para habilitar o painel.');
    const body = await readJson(req, 4096).catch(() => ({}));
    if (!isText(body.senha) || !auth.passwordOk(body.senha)) return fail(res, 401, 'Senha incorreta.');
    return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json', 'Set-Cookie': auth.cookie(auth.issue(), isHttps(req)) });
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json', 'Set-Cookie': auth.cookie('', isHttps(req)) });
  }
  const logged = auth.verify(auth.token(req));
  if (pathname === '/api/admin/me') return json(res, 200, { ok: true, autenticado: logged, configurado: auth.enabled });
  if (!logged) return fail(res, 401, 'Sessão expirada. Entre novamente.');

  // CSRF: besides SameSite=Strict, reject cross-origin state changes.
  if (req.method !== 'GET' && req.headers.origin) {
    let ok = false;
    try { ok = new URL(req.headers.origin).host === req.headers.host; } catch {}
    if (!ok) return fail(res, 403, 'Origem não permitida.');
  }
  for (const r of adminRoutes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler(req, res, params, url);
  }
  fail(res, 404, 'Rota não encontrada.');
}

/* ---------- form page with share metadata ---------- */

const escHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// WhatsApp, Instagram etc. read the title/description/image from the HTML, so they are filled in on the server.
function serveFormPage(req, res, slug) {
  fs.readFile(path.join(PUBLIC_DIR, 'form.html'), 'utf8', (err, html) => {
    if (err) return send(res, 500, 'Erro');
    const f = slug ? publishedForm(slug) : null;
    let meta = '';
    if (f) {
      const base = process.env.PUBLIC_URL || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
      const { seo } = f.schema.ajustes;
      const title = (seo.titulo || f.title).replace(/\*/g, '');
      const desc = (seo.descricao || f.schema.boas_vindas.texto || '').replace(/\*/g, '').slice(0, 200);
      const image = seo.imagem ? (seo.imagem.startsWith('/') ? base + seo.imagem : seo.imagem) : '';
      const tags = [
        ['name', 'description', desc], ['property', 'og:type', 'website'], ['property', 'og:title', title], ['property', 'og:description', desc],
        ['property', 'og:url', `${base}/f/${f.slug}`], ['name', 'twitter:card', image ? 'summary_large_image' : 'summary'],
        ['name', 'twitter:title', title], ['name', 'twitter:description', desc], image && ['property', 'og:image', image], image && ['name', 'twitter:image', image]
      ].filter(t => t && t[2]);
      meta = tags.map(([k, n, c]) => `<meta ${k}="${n}" content="${escHtml(c)}">`).join('\n  ');
      html = html.replace('<title>Formulário</title>', `<title>${escHtml(title)}</title>`);
    }
    send(res, 200, req.method === 'HEAD' ? undefined : html.replace('<!--META-->', meta), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  });
}

/* ---------- router ---------- */

const PUBLIC_API = /^\/api\/public\/([a-z0-9-]+)(?:\/(view|answer|complete))?$/;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  try {
    if (pathname.startsWith('/api/admin/')) return await handleAdminApi(req, res, url);

    const api = PUBLIC_API.exec(pathname);
    if (api) {
      const [, slug, action] = api;
      if (!action && req.method === 'GET') return await publicRoutes.get(req, res, { slug });
      if (action && req.method === 'POST') return await publicRoutes[action](req, res, { slug });
      return fail(res, 405, 'Método não permitido.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Método não permitido.');

    if (pathname === '/favicon.ico') return send(res, 204);
    if (pathname === '/') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    const page = /^\/f\/([a-z0-9-]+)\/?$/.exec(pathname);
    if (page) return serveFormPage(req, res, page[1]);
    if (pathname === '/preview') return serveFormPage(req, res, '');
    if (pathname.startsWith('/static/')) return serveDir(req, res, PUBLIC_DIR, pathname.slice(8));
    if (pathname.startsWith('/uploads/')) return serveDir(req, res, UPLOAD_DIR, pathname.slice(9), 'public, max-age=31536000, immutable');
    if (pathname === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (pathname.startsWith('/admin/')) return serveDir(req, res, ADMIN_DIR, pathname.slice(7) || 'index.html');
    send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, 500, 'Erro interno.');
  }
}).listen(PORT, HOST, () => {
  console.log(`Custom Typeform em http://${HOST}:${PORT}  (painel: /admin/)`);
  if (!auth.enabled) console.warn('ADMIN_PASSWORD não definido: o painel não aceitará login.');
});
