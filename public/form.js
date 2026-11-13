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
const topLabel = document.querySelector('.top-label');
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

let schema, formTitle = '';
let screens = [];
let index = 0;
let resultado = null; // result block (by score) chosen by the server after sending
let previewResult = 0; // which result the editor preview shows
let redirectTarget = ''; // where to send the respondent after the thank-you screen (conditional redirect)
let path = []; // screen indexes the respondent has gone through, in order (branching skips questions)
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
  if (typeof v === 'object') return v.cidade && v.uf ? `${v.cidade}/${v.uf}` : v.cidade === undefined ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' | ') : '';
  return String(v);
}

// {chave} recalls an earlier answer; {primeiro_nome} is the first word of the answer whose key is "nome".
function interp(text, source = answers) {
  const byKey = {};
  for (const q of schema.perguntas) byKey[q.chave] = source[q.id] === 'Outra' && source[`${q.id}_outra`] ? source[`${q.id}_outra`] : display(q, source[q.id]);
  const first = (byKey.nome || '').trim().split(/\s+/)[0] || (PREVIEW ? 'Maria' : '');
  return String(text || '')
    .replace(/\{([a-z0-9_]+)(\|min)?\}/g, (_, k, lower) => {
    const t = k === 'primeiro_nome' ? first : byKey[k] ?? '';
    return lower ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    })
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
  root.style.setProperty('--accent2', t.destaque2 || t.destaque);
  root.style.setProperty('--on-accent', luminance(t.destaque) > .4 ? '#111111' : '#ffffff');
  root.style.setProperty('--radius', `${t.raio}px`);
  root.style.setProperty('--font', `"${t.fonte}", system-ui, sans-serif`);
  root.style.colorScheme = luminance(t.fundo) < .4 ? 'dark' : 'light';
  document.getElementById('font-link').href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.fonte).replace(/%20/g, '+')}:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap`;
  const bg = document.querySelector('.bg');
  bg.className = `bg${t.fundo_imagem ? ' has-image' : ' has-glow'}${t.grade ? ' has-grid' : ''}`;
  bg.style.backgroundImage = t.fundo_imagem ? `url("${encodeURI(t.fundo_imagem)}")` : '';
  topLabel.textContent = schema.ajustes.rotulo_topo || '';
  const logo = document.querySelector('.logo');
  logo.hidden = !t.logo;
  if (t.logo) logo.src = t.logo;
}

/* ---------- screens ---------- */

function buildScreens() {
  screens = [];
  if (schema.boas_vindas.ativo) screens.push({ kind: 'welcome', key: 'welcome' });
  let n = 0;
  schema.perguntas.forEach((q, qi) => screens.push({ kind: 'question', key: q.id, q, qi, num: q.tipo === 'aviso' ? 0 : ++n }));
  if (schema.consentimento.ativo) screens.push({ kind: 'consent', key: 'submit' });
  screens.push({ kind: 'done', key: 'done' });
  if (PREVIEW) screens.push({ kind: 'closed', key: 'closed' }, { kind: 'soon', key: 'soon' });
}

const doneIdx = () => screens.findIndex(s => s.kind === 'done');
const pad2 = n => String(n).padStart(2, '0');
const isNumbered = s => s.kind === 'question' && s.q.tipo !== 'aviso';

// The screen shown after screens[i], following the branching rules for the answers given so far.
function nextScreen(i) {
  const s = screens[i];
  if (s.kind === 'question') {
    const ni = CtfRoute.nextIndex(schema.perguntas, s.qi, answers);
    const target = ni >= schema.perguntas.length ? screens.findIndex(x => x.kind === 'consent' || x.kind === 'done') : screens.findIndex(x => x.kind === 'question' && x.qi === ni);
    return target > i ? target : i + 1;
  }
  return s.kind === 'done' || s.kind === 'closed' || s.kind === 'soon' ? i : i + 1;
}
const isLastInput = i => screens[nextScreen(i)]?.kind === 'done';

// Rebuilds the path from the start up to `target` (used when resuming a draft or jumping back to fix an answer).
function pathTo(target) {
  const p = [];
  for (let i = 0, guard = 0; guard <= screens.length; guard++) {
    p.push(i);
    if (i === target) return p;
    const nx = nextScreen(i);
    if (nx === i) break;
    i = nx;
  }
  return [target];
}

// Numbered questions still ahead of screens[i] on the current route.
function remainingAfter(i) {
  let n = 0;
  for (let cur = nextScreen(i), guard = 0; screens[cur].kind !== 'done' && guard <= screens.length; guard++) {
    if (isNumbered(screens[cur])) n++;
    const nx = nextScreen(cur);
    if (nx === cur) break;
    cur = nx;
  }
  return n;
}

// What the respondent sees as "question N": how many numbered questions they have passed, not the position in the form.
const shownNumber = () => (PREVIEW ? screens[index].num : path.filter(j => isNumbered(screens[j])).length);

function okButton(text = 'OK', withHint = true) {
  return el('div', { class: 'actions' },
    el('button', { class: 'btn', type: 'button', onclick: next }, text, el('span', { text: '→' })),
    withHint && el('span', { class: 'hint kbd' }, 'pressione ', el('b', { text: 'Enter ↵' }))
  );
}

function welcomeScreen() {
  const w = schema.boas_vindas;
  return el('section', {},
    w.eyebrow && el('p', { class: 'eyebrow', text: w.eyebrow }),
    el('h1', { class: 'title' }, rich(w.titulo)),
    w.texto && el('p', { class: 'lead', text: interp(w.texto) }),
    okButton(isLastInput(index) ? schema.envio.botao : w.botao),
    w.nota && el('p', { class: 'note', text: `[ ${w.nota} ]` })
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
    case 'dropdown': {
      // Searchable list: type to filter, arrows to move, Enter to choose.
      const input = el('input', { class: 'q-input', id: `f-${q.id}`, type: 'text', placeholder: q.placeholder || 'Digite ou escolha uma opção…', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'true', 'aria-labelledby': labelId });
      const list = el('div', { class: 'dd-list', role: 'listbox', 'aria-labelledby': labelId });
      const allOpts = q.outra ? [...q.opcoes, 'Outra'] : q.opcoes;
      const other = q.outra ? el('input', { class: 'q-input other', type: 'text', placeholder: 'Qual?', 'aria-label': 'Outra resposta' }) : null;
      if (other) {
      other.hidden = answers[q.id] !== 'Outra';
      other.value = answers[`${q.id}_outra`] || '';
      other.addEventListener('input', () => { answers[`${q.id}_outra`] = other.value; clearError(); saveDraft(); });
      }
      let active = -1, shown = allOpts;
      input.value = answers[q.id] || '';
      const draw = () => {
        const term = input.value.trim().toLowerCase();
        shown = answers[q.id] && input.value === answers[q.id] ? allOpts : allOpts.filter(o => o.toLowerCase().includes(term));
        list.replaceChildren(...(shown.length ? shown.map((o, i) => {
          const b = el('button', { class: `dd-opt${i === active ? ' is-active' : ''}`, type: 'button', role: 'option', 'aria-selected': String(answers[q.id] === o), tabindex: '-1' }, el('span', { text: o }));
          b.addEventListener('click', () => pick(o, b));
          return b;
        }) : [el('p', { class: 'dd-empty', text: 'Nenhuma opção encontrada' })]));
        list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
      };
      const pick = (o, btn) => {
      answers[q.id] = o; input.value = o; clearError(); saveDraft(); draw();
      if (other) other.hidden = o !== 'Outra';
      if (o === 'Outra') { other.focus(); return; }
      blinkThenNext(btn || input);
      };
      input.addEventListener('input', () => { answers[q.id] = ''; if (other) other.hidden = true; active = input.value.trim() ? 0 : -1; clearError(); saveDraft(); draw(); });
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
          draw();
        } else if (e.key === 'Enter') {
          const exact = allOpts.find(o => o.toLowerCase() === input.value.trim().toLowerCase());
          const target = active >= 0 && shown[active] && answers[q.id] !== shown[active] ? shown[active] : (!answers[q.id] && exact);
          if (target) { e.preventDefault(); e.stopPropagation(); pick(target); }
        }
      });
      draw();
      field = el('div', {}, input, list, other);
      root._focus = input;
      break;
    }
    case 'matriz': {
    // Grid: one screen, several statements answered on the same scale (A, B, C...).
    const cols = q.opcoes, rows = q.linhas || [];
    const grid = el('div', { class: 'matrix', style: `--cols:${cols.length}`, role: 'group', 'aria-labelledby': labelId },
    el('div', { class: 'mx-head', 'aria-hidden': 'true' }, el('span'), cols.map(c => el('span', { text: c }))));
    rows.forEach((txt, ri) => {
    const key = LETTERS[ri];
    const cells = cols.map(c => el('button', { class: 'mx-opt', type: 'button', role: 'radio', 'aria-label': c }, el('i', { 'aria-hidden': 'true' }), el('span', { text: c })));
    const paint = () => cells.forEach((b, ci) => b.setAttribute('aria-checked', String((answers[q.id] || {})[key] === cols[ci])));
    cells.forEach((b, ci) => b.addEventListener('click', () => {
    answers[q.id] = { ...(answers[q.id] || {}), [key]: cols[ci] };
    paint(); clearError(); saveDraft();
    }));
    paint();
    grid.append(el('div', { class: 'mx-row', role: 'radiogroup', 'aria-label': interp(txt) },
    el('p', { class: 'mx-label' }, el('b', { text: key }), interp(txt)), el('div', { class: 'mx-cells' }, cells)));
    });
    field = grid;
    root._focus = grid.querySelector('.mx-opt');
    break;
    }
    case 'escala': {
      const values = Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i);
      const estilo = q.estilo || 'numeros';
      const faces = CtfRoute.emojis[q.max] || [];
      const group = el('div', { class: estilo === 'estrelas' ? 'stars' : estilo === 'emojis' ? 'emojis' : 'scale', role: 'radiogroup', 'aria-labelledby': labelId, style: `--cols:${Math.min(values.length, 11)}` });
      const paint = hover => buttons.forEach((b, j) => {
        const n = values[j], cur = hover ?? answers[q.id];
        b.setAttribute('aria-checked', String(answers[q.id] === n));
        if (estilo === 'estrelas') b.classList.toggle('on', Number.isInteger(cur) && n <= cur);
      });
      const buttons = values.map((n, i) => {
        const btn = estilo === 'estrelas'
          ? el('button', { class: 'star', type: 'button', role: 'radio', 'aria-label': `${n} de ${q.max}`, title: String(n), text: '★' })
          : estilo === 'emojis'
            ? el('button', { class: 'emo', type: 'button', role: 'radio', 'aria-label': `${n} de ${q.max}`, title: String(n), text: faces[i] || String(n), style: `--i:${i}` })
            : el('button', { class: 'opt', type: 'button', role: 'radio', style: `--i:${i}`, 'aria-label': `${n} de ${q.max}`, text: String(n) });
        const choose = () => { answers[q.id] = n; paint(); clearError(); saveDraft(); blinkThenNext(btn); };
        btn.addEventListener('click', choose);
        if (estilo === 'estrelas') { btn.addEventListener('mouseenter', () => paint(n)); }
        if (!(n === 10 && q.min === 0)) root._keys[String(n % 10)] = choose; // "0" stays the lowest value on 0–10 scales
        return btn;
      });
      group.addEventListener('mouseleave', () => paint());
      group.append(...buttons);
      paint();
      const lo = q.rotulo_min, hi = q.rotulo_max;
      const numbered = estilo === 'numeros';
      field = el('div', {}, group, (lo || hi) && el('div', { class: 'scale-labels' },
        el('span', { text: numbered ? `${q.min}${lo ? ` · ${lo}` : ''}` : lo }), el('span', { text: numbered ? `${hi ? `${hi} · ` : ''}${q.max}` : hi })));
      break;
    }
  }

  const last = isLastInput(index);
  const btnText = last ? schema.envio.botao : q.tipo === 'aviso' ? 'Continuar' : !q.obrigatoria && q.tipo === 'longo' ? 'Pular / OK' : 'OK';
  return el('section', {},
    el('div', { class: `q-head${showNum ? '' : ' no-num'}` },
      showNum && el('span', { class: 'q-num', 'aria-hidden': 'true', text: pad2(shownNumber()) }),
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

function closedScreen(kind) {
  if (kind === 'soon') {
    const e = schema.em_breve;
    const when = schema.agenda.abre_em ? new Date(schema.agenda.abre_em).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' }) : '';
    return el('section', {},
      el('p', { class: 'eyebrow', text: 'Em breve' }),
      el('h1', { class: 'title' }, rich(e.titulo || 'Ainda não abriu')),
      e.texto && el('p', { class: 'lead', text: e.texto }),
      when && el('p', { class: 'note', text: `[ abre em ${when} ]` }));
  }
  const c = schema.encerrado;
  return el('section', {},
    el('p', { class: 'eyebrow', text: 'Encerrado' }),
    el('h1', { class: 'title' }, rich(c.titulo || 'Formulário encerrado')),
    c.texto && el('p', { class: 'lead', text: c.texto }),
    c.cta_url && el('div', { class: 'actions' }, el('a', { class: 'btn', href: c.cta_url, target: '_blank', rel: 'noopener' }, c.cta_texto || 'Saiba mais', el('span', { text: '↗' }))));
}

// Each line of a text becomes its own paragraph (the final screens use several lines).
function paras(text, src) {
return String(text || '').split(/\n+/).map(t => interp(t, src).trim()).filter(Boolean).map(t => el('p', { class: 'lead', text: t }));
}

// Result chosen by score: the server sends only the one that matched; the editor preview shows the one picked there.
function resultadoBox(src) {
const r = PREVIEW ? (schema.pontuacao?.resultados || [])[previewResult] : resultado;
if (!r) return null;
const showButton = r.botao_texto && (PREVIEW || r.botao_url);
return el('div', { class: 'result' },
r.titulo && el('h3', { class: 'result-title' }, rich(r.titulo, src)),
...paras(r.texto, src),
r.produto && el('p', { class: 'result-product', text: interp(r.produto, src) }),
showButton && el('div', { class: 'actions' }, el('a', { class: 'btn', href: PREVIEW ? '#' : r.botao_url, target: '_blank', rel: 'noopener' }, r.botao_texto, el('span', { text: '↗' }))));
}

function doneScreen() {
  const f = schema.final;
  const src = snapshot || answers;
  const mark = el('div');
  mark.innerHTML = '<svg class="done-mark" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="36"/><path d="M27 43l10 10 20-21"/></svg>';
  return el('section', {},
    mark.firstChild,
    f.etiqueta && el('p', { class: 'eyebrow', text: f.etiqueta }),
    el('h2', { class: 'title' }, rich(f.titulo || 'Obrigado!', src)),
    ...paras(f.texto, src),
    resultadoBox(src),
    f.cta_url && el('div', { class: 'actions' }, el('a', { class: 'btn', href: f.cta_url, target: '_blank', rel: 'noopener' }, f.cta_texto || 'Continuar', el('span', { text: '↗' }))),
    redirectTarget && (PREVIEW
      ? el('p', { class: 'note', text: `[ pré-visualização: a pessoa seria redirecionada para ${redirectTarget} ]` })
      : el('p', { class: 'note' }, '[ redirecionando… ', el('a', { href: redirectTarget, text: 'ir agora' }), ' ]'))
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
    case 'dropdown': return v === 'Outra' && !(answers[`${q.id}_outra`] || '').trim() ? 'Conte qual é a sua resposta.' : '';
    case 'matriz': return Object.keys(v).length < (q.linhas || []).length ? 'Responda todas as afirmações.' : '';
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Esse e-mail não parece válido.';
    case 'telefone': return CtfRoute.phoneError(v.replace(/\D/g, ''));
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
  const target = nextScreen(index);
  path.push(target);
  go(target, 1);
}

function prev() {
  if (sending || path.length < 2 || screens[index].kind === 'done') return;
  const s = screens[index];
  if (s.kind === 'question' && !validate(s.q)) track(s.q);
  path.pop();
  go(path[path.length - 1], -1);
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
    : s.kind === 'closed' || s.kind === 'soon' ? closedScreen(s.kind)
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
  if (!['done', 'closed', 'soon'].includes(s.kind)) saveDraft();
  if (animate || !PREVIEW) setTimeout(() => (finePointer && root._focus ? root._focus : root).focus({ preventScroll: true }), reducedMotion ? 0 : 120);
}

function updateChrome() {
  const s = screens[index];
  const numbered = isNumbered(s);
  const before = PREVIEW ? s.num - 1 : path.filter(j => isNumbered(screens[j])).length - (numbered ? 1 : 0);
  const total = PREVIEW ? screens.filter(isNumbered).length || 1 : Math.max(1, before + (numbered ? 1 : 0) + remainingAfter(index));
  const pct = Math.round((s.kind === 'closed' || s.kind === 'soon' ? 0 : s.kind === 'done' || s.kind === 'consent' ? 1 : s.kind === 'welcome' ? 0 : before / total) * 100);
  bar.classList.toggle('is-off', !schema.ajustes.mostrar_progresso);
  bar.firstElementChild.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  label.replaceChildren();
  if (schema.ajustes.mostrar_progresso && numbered) label.append(el('b', { text: pad2(before + 1) }), ` / ${pad2(total)}`);
  nav.classList.toggle('is-hidden', ['welcome', 'done', 'closed', 'soon'].includes(s.kind));
  prevBtn.disabled = PREVIEW ? index === 0 : path.length < 2;
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
  if (PREVIEW) {
    restore();
    const url = CtfRoute.redirectFor(schema.final.redirecionamento, answers);
    redirectTarget = url.replace(/\{([a-z0-9_]+)\}/gi, (_, k) => encodeURIComponent(display(schema.perguntas.find(q => q.chave === k) || {}, answers[schema.perguntas.find(q => q.chave === k)?.id]) || `{${k}}`));
    return go(doneIdx(), 1);
  }
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
      if (res.status === 403 && data.estado) { restore(); return showState(data.estado); }
      const firstBad = data.campos ? screens.findIndex(s => s.kind === 'question' && data.campos[s.q.id]) : -1;
      if (firstBad >= 0) { path = pathTo(firstBad); go(firstBad, -1); setTimeout(() => showError(current(), 'Revise esta resposta.'), 450); return; }
      return showError(root, data.erro || 'Não foi possível enviar. Tente novamente.');
    }
    snapshot = { ...answers };
    redirectTarget = data.redirect || '';
    resultado = data.resultado || null;
    path.push(doneIdx());
    if (schema.ajustes.uma_vez) store.save({ enviado: true, snapshot, resultado });
    else store.clear();
    sending = false;
    go(doneIdx(), 1);
    if (redirectTarget) setTimeout(() => { location.href = redirectTarget; }, 1800);
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
  if (data.estado && data.estado !== 'aberto') return showState(data.estado);
  buildScreens();
  const saved = PREVIEW ? null : store.load();
  if (saved?.enviado && schema.ajustes.uma_vez) { snapshot = saved.snapshot; resultado = saved.resultado || null; path = [doneIdx()]; return go(doneIdx(), 1); }
  if (saved?.answers) { answers = saved.answers; rid = saved.rid || null; }
  prefill();
  let target = screens.findIndex(s => s.key === (startAt || saved?.at));
  if (target < 0 || screens[target].kind === 'done') target = 0;
  path = pathTo(target);
  go(target, 1);
}

// The form exists but is not accepting answers (closed by hand, not open yet, or past its closing time).
function showState(estado) {
  screens = [{ kind: estado === 'em_breve' ? 'soon' : 'closed', key: 'state' }];
  path = [0];
  go(0, 1);
}

function showFailure(title, text) {
  stage.replaceChildren(el('div', { class: 'screen is-current' }, el('h1', { class: 'title', text: title }), el('p', { class: 'lead', text })));
}

if (PREVIEW) {
  // The editor sends the whole schema on every change; re-render in place without animations.
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'ctf-schema') return;
    const { schema: next, titulo, goto, resultado: pr } = event.data;
    previewResult = Number.isInteger(pr) ? pr : 0;
    if (!schema) return start({ schema: next, titulo }, goto);
    const keep = goto || screens[index]?.key;
    schema = next;
    document.title = titulo || 'Formulário';
    applyTheme(schema.tema);
    buildScreens();
    const target = screens.findIndex(s => s.key === keep);
    path = [target < 0 ? 0 : target];
    if (screens[path[0]]?.kind !== 'done') redirectTarget = '';
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
