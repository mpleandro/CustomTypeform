// Typeform-style runtime: one screen at a time, built from the form schema.
// Live mode (/f/:slug) loads the published schema and saves progress per question.
// Preview mode (/preview) is driven by the admin editor through postMessage and never hits the API.
const PREVIEW = location.pathname === '/preview';
const SLUG = (location.pathname.match(/^\/f\/([a-z0-9-]+)/) || [])[1];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO','Exterior'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AUTO_ADVANCE_MS = 480;
const DEFAULT_META = /^(transaction|sck|src|xcod|utm_[a-z]+)$/;

const stage = document.getElementById('stage');
const bar = document.querySelector('.progress');
const label = document.querySelector('.block-label');
const nav = document.querySelector('.nav');
const prevBtn = nav.querySelector('[data-prev]');
const nextBtn = nav.querySelector('[data-next]');
const honeypot = document.querySelector('.hp');
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

let schema, formTitle = '';
let screens = [];
let index = 0;
let answers = {};
let rid = null;
let snapshot = null;
let sending = false;
let lastMove = 0;
let autoTimer;
let chain = Promise.resolve();

const STORAGE_KEY = `ctf:${SLUG}`;
const store = {
  load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } },
  save(data) { if (!PREVIEW) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {} },
  clear() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
};
const saveDraft = () => store.save({ answers, rid, at: screens[index]?.key });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/* ---------- text helpers ---------- */

function display(q, v) {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return v.cidade && v.uf ? `${v.cidade}/${v.uf}` : '';
  return String(v);
}

// {chave} recalls an earlier answer; {primeiro_nome} is the first word of the answer whose key is "nome".
function interp(text, source = answers) {
  const byKey = {};
  for (const q of schema.perguntas) byKey[q.chave] = display(q, source[q.id]);
  const first = (byKey.nome || '').trim().split(/\s+/)[0] || (PREVIEW ? 'Maria' : '');
  return String(text || '')
    .replace(/\{([a-z0-9_]+)\}/g, (_, k) => (k === 'primeiro_nome' ? first : byKey[k] ?? ''))
    .replace(/\s+([,.!?])/g, '$1').replace(/,\s*([.!?])/g, '$1');
}

// *text* highlights in the accent colour; everything else stays plain text (never HTML).
function rich(text, source) {
  return interp(text, source).split(/\*([^*]+)\*/).map((part, i) => (i % 2 ? el('em', { text: part }) : part));
}

function formatPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length < 3) return `(${d}`;
  const ddd = d.slice(0, 2), rest = d.slice(2);
  const cut = rest.length > 8 ? 5 : 4;
  return rest.length > cut ? `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}` : `(${ddd}) ${rest}`;
}

// Links (Hotmart, e-mail campaigns...) can pass respondent data in the URL; drafts win over URL values.
function prefill() {
  const pick = keys => keys.map(k => (params.get(k) || '').trim()).find(Boolean) || '';
  for (const q of schema.perguntas) {
    if (!q.prefill?.length || answers[q.id]) continue;
    let value = pick(q.prefill);
    if (q.tipo === 'telefone') {
      const ddd = pick(['phone_local_code', 'phone_ddd', 'ddd']).replace(/\D/g, '');
      if (ddd && value && value.replace(/\D/g, '').length <= 9) value = ddd + value;
      value = formatPhone(value);
    }
    if (value && (q.tipo === 'texto' || q.tipo === 'email' || q.tipo === 'telefone' || q.tipo === 'longo' || q.tipo === 'numero' || q.tipo === 'url')) answers[q.id] = value;
  }
}

/* ---------- theme ---------- */

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
  return .2126 * r + .7152 * g + .0722 * b;
};

function applyTheme(t) {
  const root = document.documentElement;
  root.style.setProperty('--bg', t.fundo);
  root.style.setProperty('--fg', t.texto);
  root.style.setProperty('--accent', t.destaque);
  root.style.setProperty('--on-accent', luminance(t.destaque) > .4 ? '#111111' : '#ffffff');
  root.style.setProperty('--radius', `${t.raio}px`);
  root.style.setProperty('--font', `"${t.fonte}", system-ui, sans-serif`);
  root.style.colorScheme = luminance(t.fundo) < .4 ? 'dark' : 'light';
  document.getElementById('font-link').href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.fonte).replace(/%20/g, '+')}:wght@400;500;600;700;800&display=swap`;
  const bg = document.querySelector('.bg');
  bg.className = `bg${t.fundo_imagem ? ' has-image' : ' has-glow'}${t.grade ? ' has-grid' : ''}`;
  bg.style.backgroundImage = t.fundo_imagem ? `url("${encodeURI(t.fundo_imagem)}")` : '';
  const logo = document.querySelector('.logo');
  logo.hidden = !t.logo;
  if (t.logo) logo.src = t.logo;
}

/* ---------- screens ---------- */

function buildScreens() {
  screens = [];
  if (schema.boas_vindas.ativo) screens.push({ kind: 'welcome', key: 'welcome' });
  let n = 0;
  schema.perguntas.forEach(q => screens.push({ kind: 'question', key: q.id, q, num: q.tipo === 'aviso' ? 0 : ++n }));
  if (schema.consentimento.ativo) screens.push({ kind: 'consent', key: 'submit' });
  screens.push({ kind: 'done', key: 'done' });
}

const isLastInput = i => screens[i + 1]?.kind === 'done';

function okButton(text = 'OK', withHint = true) {
  return el('div', { class: 'actions' },
    el('button', { class: 'btn', type: 'button', onclick: next }, text, el('span', { text: '↵' })),
    withHint && el('span', { class: 'hint kbd' }, 'pressione ', el('b', { text: 'Enter ↵' }))
  );
}

function welcomeScreen() {
  const w = schema.boas_vindas;
  return el('section', {},
    w.eyebrow && el('p', { class: 'eyebrow', text: w.eyebrow }),
    el('h1', { class: 'title' }, rich(w.titulo)),
    w.texto && el('p', { class: 'lead', text: interp(w.texto) }),
    okButton(isLastInput(index) ? schema.envio.botao : w.botao)
  );
}

function questionScreen(s, root) {
  const q = s.q;
  const labelId = `l-${q.id}`;
  const helpId = q.ajuda ? `h-${q.id}` : null;
  const showNum = schema.ajustes.mostrar_numero && q.tipo !== 'aviso';
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  root._error = error;
  root._keys = {};

  let field = null;
  const clearError = () => { error.hidden = true; };
  const textInput = (type, extra = {}) => el(type === 'longo' ? 'textarea' : 'input', {
    class: 'q-input', id: `f-${q.id}`, 'aria-labelledby': labelId, 'aria-describedby': helpId,
    placeholder: q.placeholder, autocomplete: 'off', ...extra
  });

  switch (q.tipo) {
    case 'texto': case 'email': case 'telefone': case 'numero': case 'url': case 'data': {
      const input = textInput(q.tipo, {
        type: { email: 'email', telefone: 'tel', data: 'date' }[q.tipo] || 'text',
        inputmode: { telefone: 'tel', email: 'email', numero: 'decimal', url: 'url' }[q.tipo],
        autocapitalize: q.tipo === 'texto' ? 'sentences' : 'off', spellcheck: q.tipo === 'texto' ? undefined : 'false',
        autocomplete: { email: 'email', telefone: 'tel-national' }[q.tipo] || 'off'
      });
      input.value = answers[q.id] || '';
      input.addEventListener('input', () => {
        if (q.tipo === 'telefone') input.value = formatPhone(input.value);
        answers[q.id] = input.value;
        clearError(); saveDraft();
      });
      field = input;
      root._focus = input;
      break;
    }
    case 'longo': {
      const area = textInput('longo', { rows: 1 });
      area.value = answers[q.id] || '';
      const grow = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight}px`; };
      area.addEventListener('input', () => { answers[q.id] = area.value; grow(); clearError(); saveDraft(); });
      requestAnimationFrame(grow);
      field = el('div', {}, area, el('p', { class: 'hint kbd', style: 'margin-top:10px' }, el('b', { text: 'Shift + Enter' }), ' para quebrar linha'));
      root._focus = area;
      break;
    }
    case 'cidade_uf': {
      const value = answers[q.id] || { cidade: '', uf: '' };
      const cidade = el('input', { class: 'q-input', id: `f-${q.id}-cidade`, type: 'text', placeholder: 'Sua cidade', autocomplete: 'address-level2', autocapitalize: 'words' });
      const uf = el('select', { class: 'q-input', id: `f-${q.id}-uf`, autocomplete: 'address-level1' },
        el('option', { value: '', text: 'UF' }), UFS.map(u => el('option', { value: u, text: u })));
      cidade.value = value.cidade; uf.value = value.uf;
      const sync = () => { answers[q.id] = { cidade: cidade.value, uf: uf.value }; clearError(); saveDraft(); };
      cidade.addEventListener('input', sync); uf.addEventListener('change', sync);
      field = el('div', { class: 'pair' },
        el('div', {}, el('label', { for: cidade.id, text: 'Cidade' }), cidade),
        el('div', {}, el('label', { for: uf.id, text: 'Estado' }), uf));
      root._focus = cidade;
      break;
    }
    case 'unica': case 'multipla': case 'sim_nao': {
      const multi = q.tipo === 'multipla';
      const base = q.tipo === 'sim_nao' ? ['Sim', 'Não'] : q.opcoes;
      const opts = q.outra ? [...base, 'Outra'] : base;
      const group = el('div', { class: `options${q.compacta || q.tipo === 'sim_nao' ? ' compact' : ''}`, role: multi ? 'group' : 'radiogroup', 'aria-labelledby': labelId });
      const other = q.outra ? el('input', { class: 'q-input other', type: 'text', placeholder: 'Qual?', 'aria-label': 'Outra resposta' }) : null;
      if (other) {
        other.value = answers[`${q.id}_outra`] || '';
        other.addEventListener('input', () => { answers[`${q.id}_outra`] = other.value; clearError(); saveDraft(); });
      }
      const chosen = opt => (multi ? (answers[q.id] || []).includes(opt) : answers[q.id] === opt);
      const paint = () => {
        buttons.forEach((b, i) => b.setAttribute('aria-checked', String(chosen(opts[i]))));
        if (other) other.hidden = !chosen('Outra');
      };
      const select = (opt, btn) => {
        answers[q.id] = opt;
        paint(); clearError(); saveDraft();
        if (opt === 'Outra') { other.focus(); return; }
        blinkThenNext(btn);
      };
      const toggle = opt => {
        let list = [...(answers[q.id] || [])];
        if (list.includes(opt)) list = list.filter(x => x !== opt);
        else list = (q.exclusivas || []).includes(opt) ? [opt] : [...list.filter(x => !(q.exclusivas || []).includes(x)), opt];
        answers[q.id] = list;
        paint(); clearError(); saveDraft();
        if (list.includes('Outra')) other.focus();
      };
      const buttons = opts.map((opt, i) => {
        const btn = el('button', { class: 'opt', type: 'button', role: multi ? 'checkbox' : 'radio', style: `--i:${i}` },
          el('span', { class: 'key', 'aria-hidden': 'true', text: LETTERS[i] }), el('span', { text: opt }));
        const choose = () => (multi ? toggle(opt) : select(opt, btn));
        btn.addEventListener('click', choose);
        root._keys[LETTERS[i]] = choose;
        if (q.tipo === 'sim_nao') root._keys[opt === 'Sim' ? 'S' : 'N'] = choose;
        return btn;
      });
      group.append(...buttons);
      paint();
      field = el('div', {}, group, other);
      break;
    }
    case 'escala': {
      const values = Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i);
      const group = el('div', { class: 'scale', role: 'radiogroup', 'aria-labelledby': labelId, style: `--cols:${Math.min(values.length, 11)}` });
      const buttons = values.map((n, i) => {
        const btn = el('button', { class: 'opt', type: 'button', role: 'radio', style: `--i:${i}`, 'aria-label': `${n} de ${q.max}`, text: String(n) });
        const choose = () => {
          answers[q.id] = n;
          buttons.forEach((b, j) => b.setAttribute('aria-checked', String(values[j] === n)));
          clearError(); saveDraft();
          blinkThenNext(btn);
        };
        btn.addEventListener('click', choose);
        root._keys[String(n % 10)] = choose;
        btn.setAttribute('aria-checked', String(answers[q.id] === n));
        return btn;
      });
      group.append(...buttons);
      field = el('div', {}, group, (q.rotulo_min || q.rotulo_max) && el('div', { class: 'scale-labels' },
        el('span', { text: `${q.min}${q.rotulo_min ? ` · ${q.rotulo_min}` : ''}` }), el('span', { text: `${q.rotulo_max ? `${q.rotulo_max} · ` : ''}${q.max}` })));
      break;
    }
  }

  const last = isLastInput(index);
  const btnText = last ? schema.envio.botao : q.tipo === 'aviso' ? 'Continuar' : !q.obrigatoria && q.tipo === 'longo' ? 'Pular / OK' : 'OK';
  return el('section', {},
    el('div', { class: `q-head${showNum ? '' : ' no-num'}` },
      showNum && el('span', { class: 'q-num', 'aria-hidden': 'true' }, String(s.num), el('span', { text: '→' })),
      el('h2', { class: 'q-label', id: labelId }, rich(q.rotulo), !q.obrigatoria && q.tipo !== 'aviso' && el('small', { text: '(opcional)' })),
      q.ajuda && el('p', { class: 'q-help', id: helpId, text: interp(q.ajuda) })
    ),
    field && el('div', { class: `q-body${showNum ? '' : ' no-indent'}` }, field, error),
    !field && el('div', { class: 'q-body no-indent' }, error),
    el('div', { class: `q-actions${showNum ? '' : ' no-indent'}` }, okButton(btnText))
  );
}

function consentScreen(root) {
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  const box = el('input', { type: 'checkbox', id: 'consent' });
  box.checked = !!answers.consentimento;
  box.addEventListener('change', () => { answers.consentimento = box.checked; error.hidden = true; saveDraft(); });
  const submitBtn = el('button', { class: 'btn', type: 'button', onclick: next }, schema.envio.botao, el('span', { text: '↗' }));
  root._error = error;
  root._submit = submitBtn;
  root._focus = box;
  return el('section', {},
    el('h2', { class: 'title' }, rich(schema.envio.titulo)),
    schema.envio.texto && el('p', { class: 'lead', text: interp(schema.envio.texto) }),
    el('label', { class: 'consent', for: 'consent' }, box, el('span', { text: schema.consentimento.texto })),
    error,
    el('div', { class: 'actions' }, submitBtn, el('span', { class: 'hint kbd' }, 'pressione ', el('b', { text: 'Enter ↵' })))
  );
}

function doneScreen() {
  const f = schema.final;
  const src = snapshot || answers;
  const mark = el('div');
  mark.innerHTML = '<svg class="done-mark" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="36"/><path d="M27 43l10 10 20-21"/></svg>';
  return el('section', {},
    mark.firstChild,
    el('h2', { class: 'title' }, rich(f.titulo || 'Obrigado!', src)),
    f.texto && el('p', { class: 'lead', text: interp(f.texto, src) }),
    f.cta_url && el('div', { class: 'actions' }, el('a', { class: 'btn', href: f.cta_url, target: '_blank', rel: 'noopener' }, f.cta_texto || 'Continuar', el('span', { text: '↗' })))
  );
}

/* ---------- flow ---------- */

function blinkThenNext(btn) {
  clearTimeout(autoTimer);
  btn.classList.remove('blink'); void btn.offsetWidth; btn.classList.add('blink');
  const at = index;
  autoTimer = setTimeout(() => { if (index === at) next(); }, reducedMotion ? 150 : AUTO_ADVANCE_MS);
}

function validate(q) {
  const v = answers[q.id];
  const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  if (q.tipo === 'aviso') return '';
  if (q.tipo === 'cidade_uf') {
    const blank = !v?.cidade?.trim() && !v?.uf;
    if (blank) return q.obrigatoria ? 'Informe sua cidade e o estado.' : '';
    return v?.cidade?.trim() && v?.uf ? '' : 'Informe sua cidade e o estado.';
  }
  if (empty || (typeof v === 'string' && !v.trim())) return q.obrigatoria ? 'Por favor, responda esta pergunta.' : '';
  switch (q.tipo) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Esse e-mail não parece válido.';
    case 'telefone': { const n = v.replace(/\D/g, '').length; return n >= 10 && n <= 11 ? '' : 'Informe o número com DDD.'; }
    case 'numero': return Number.isFinite(Number(v.replace(',', '.'))) ? '' : 'Digite apenas números.';
    case 'url': return /^(https?:\/\/)?[^\s/]+\.[^\s/]{2,}/i.test(v.trim()) ? '' : 'Esse link não parece válido.';
    case 'data': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? '' : 'Informe uma data válida.';
    case 'unica': case 'multipla':
      return (v === 'Outra' || (Array.isArray(v) && v.includes('Outra'))) && !(answers[`${q.id}_outra`] || '').trim() ? 'Conte qual é a sua resposta.' : '';
  }
  return '';
}

function showError(root, message) {
  root._error.textContent = `⚠ ${message}`;
  root._error.hidden = false;
  root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake');
}

const current = () => stage.querySelector('.screen.is-current');

// Saves progress after each question (and fires that question's webhook on the server).
function track(q) {
  if (PREVIEW || q.tipo === 'aviso') return;
  const v = answers[q.id];
  const hasOther = v === 'Outra' || (Array.isArray(v) && v.includes('Outra'));
  const body = { rid, qid: q.id, value: v ?? '', outra: hasOther ? answers[`${q.id}_outra`] : undefined, meta: metaFromUrl() };
  chain = chain.then(async () => {
    const res = await fetch(`/api/public/${SLUG}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, rid }) });
    const data = await res.json().catch(() => ({}));
    if (data.rid && data.rid !== rid) { rid = data.rid; saveDraft(); }
  }).catch(() => {});
}

function next() {
  if (sending || Date.now() - lastMove < 280) return;
  const s = screens[index];
  const root = current();
  if (s.kind === 'done') return;
  if (s.kind === 'question' && !PREVIEW) {
    const message = validate(s.q);
    if (message) return showError(root, message);
  }
  if (s.kind === 'consent' && !PREVIEW && !answers.consentimento) return showError(root, 'Para enviar, marque a autorização acima.');
  if (s.kind === 'question') track(s.q);
  if (isLastInput(index)) return submit(root);
  go(index + 1, 1);
}

function prev() {
  if (sending || index === 0 || screens[index].kind === 'done') return;
  const s = screens[index];
  if (s.kind === 'question' && !validate(s.q)) track(s.q);
  go(index - 1, -1);
}

function go(target, dir) {
  clearTimeout(autoTimer);
  lastMove = Date.now();
  const old = current();
  const animate = dir !== 0;
  const root = el('div', { class: `screen is-current${animate ? (dir > 0 ? ' enter-up' : ' enter-down') : ''}`, tabindex: '-1' });
  const s = screens[target];
  index = target;
  const content = s.kind === 'welcome' ? welcomeScreen()
    : s.kind === 'question' ? questionScreen(s, root)
    : s.kind === 'consent' ? consentScreen(root)
    : doneScreen();
  root.append(content);

  if (old) {
    old.classList.remove('is-current', 'enter-up', 'enter-down');
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    if (animate) { old.classList.add(dir > 0 ? 'leave-up' : 'leave-down'); setTimeout(() => old.remove(), reducedMotion ? 0 : 400); }
    else old.remove();
  }
  stage.append(root);
  window.scrollTo({ top: 0 });
  updateChrome();
  if (s.kind !== 'done') saveDraft();
  if (animate || !PREVIEW) setTimeout(() => (finePointer && root._focus ? root._focus : root).focus({ preventScroll: true }), reducedMotion ? 0 : 120);
}

function updateChrome() {
  const s = screens[index];
  const total = screens.filter(x => x.kind === 'question').length || 1;
  const before = screens.slice(0, index).filter(x => x.kind === 'question').length;
  const pct = Math.round((s.kind === 'done' ? 1 : s.kind === 'welcome' ? 0 : s.kind === 'consent' ? 1 : before / total) * 100);
  bar.classList.toggle('is-off', !schema.ajustes.mostrar_progresso);
  bar.firstElementChild.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  label.replaceChildren();
  if (schema.ajustes.mostrar_progresso && s.kind === 'question') label.append(el('b', { text: String(before + 1) }), ` / ${total}`);
  nav.classList.toggle('is-hidden', s.kind === 'welcome' || s.kind === 'done');
  prevBtn.disabled = index === 0;
  nextBtn.disabled = s.kind === 'consent';
}

function metaFromUrl() {
  const extra = new Set((schema.ajustes.params_extra || '').split(',').map(x => x.trim()).filter(Boolean));
  const meta = {};
  for (const [k, v] of params) if (DEFAULT_META.test(k) || extra.has(k)) meta[k] = v;
  return meta;
}

async function submit(root) {
  sending = true;
  const btn = root._submit || root.querySelector('.btn');
  const original = btn.firstChild.textContent;
  btn.disabled = true;
  btn.firstChild.textContent = 'Enviando… ';
  const restore = () => { sending = false; btn.disabled = false; btn.firstChild.textContent = original; };
  if (PREVIEW) { restore(); return go(index + 1, 1); }
  const { consentimento, ...respostas } = answers;
  try {
    await chain;
    const res = await fetch(`/api/public/${SLUG}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rid, respostas, consentimento: consentimento === true, meta: metaFromUrl(), website: honeypot.value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      restore();
      const firstBad = data.campos ? screens.findIndex(s => s.kind === 'question' && data.campos[s.q.id]) : -1;
      if (firstBad >= 0) { go(firstBad, -1); setTimeout(() => showError(current(), 'Revise esta resposta.'), 450); return; }
      return showError(root, data.erro || 'Não foi possível enviar. Tente novamente.');
    }
    snapshot = { ...answers };
    if (schema.ajustes.uma_vez) store.save({ enviado: true, snapshot });
    else store.clear();
    sending = false;
    go(index + 1, 1);
  } catch {
    restore();
    showError(root, 'Sem conexão. Verifique a internet e tente novamente.');
  }
}

document.addEventListener('keydown', event => {
  const t = event.target;
  if (event.key === 'Enter') {
    if (t.tagName === 'TEXTAREA' && event.shiftKey) return;
    if (t.tagName === 'BUTTON' || t.tagName === 'A') return;
    event.preventDefault();
    next();
    return;
  }
  const typing = t.matches('input:not([type=checkbox]), textarea, select');
  if (typing || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
  const action = current()?._keys?.[event.key.toUpperCase()];
  if (action) { event.preventDefault(); action(); }
});
prevBtn.addEventListener('click', prev);
nextBtn.addEventListener('click', next);

/* ---------- boot ---------- */

function start(data, startAt) {
  schema = data.schema;
  formTitle = data.titulo || '';
  document.title = formTitle || 'Formulário';
  applyTheme(schema.tema);
  buildScreens();
  const saved = PREVIEW ? null : store.load();
  if (saved?.enviado && schema.ajustes.uma_vez) { snapshot = saved.snapshot; return go(screens.length - 1, 1); }
  if (saved?.answers) { answers = saved.answers; rid = saved.rid || null; }
  prefill();
  let target = screens.findIndex(s => s.key === (startAt || saved?.at));
  if (target < 0 || screens[target].kind === 'done') target = 0;
  go(target, 1);
}

function showFailure(title, text) {
  stage.replaceChildren(el('div', { class: 'screen is-current' }, el('h1', { class: 'title', text: title }), el('p', { class: 'lead', text })));
}

if (PREVIEW) {
  // The editor sends the whole schema on every change; re-render in place without animations.
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'ctf-schema') return;
    const { schema: next, titulo, goto } = event.data;
    if (!schema) return start({ schema: next, titulo }, goto);
    const keep = goto || screens[index]?.key;
    schema = next;
    document.title = titulo || 'Formulário';
    applyTheme(schema.tema);
    buildScreens();
    const target = screens.findIndex(s => s.key === keep);
    go(target < 0 ? 0 : target, 0);
  });
  parent.postMessage({ type: 'ctf-ready' }, location.origin);
} else if (!SLUG) {
  showFailure('Formulário não encontrado.', 'Confira o endereço e tente novamente.');
} else {
  fetch(`/api/public/${SLUG}`, { cache: 'no-cache' })
    .then(async r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(data => {
      start(data);
      try {
        if (!sessionStorage.getItem(`${STORAGE_KEY}:view`)) {
          sessionStorage.setItem(`${STORAGE_KEY}:view`, '1');
          fetch(`/api/public/${SLUG}/view`, { method: 'POST' });
        }
      } catch {}
    })
    .catch(status => (status === 404
      ? showFailure('Formulário indisponível.', 'Este formulário não existe ou ainda não foi publicado.')
      : showFailure('Não foi possível carregar o formulário.', 'Atualize a página em alguns instantes.')));
}
