// Small DOM + API helpers shared by the admin views. Data is only ever inserted as text, never HTML.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') node[k] = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(method, path, body) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(`/api/admin${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event('ctf-unauth'));
  if (!res.ok || data.ok === false) throw new ApiError(data.erro || 'Erro inesperado.', res.status, data);
  return data;
}

export function toast(message, kind = 'ok') {
  const node = el('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, icon(kind === 'err' ? 'info' : 'check', 15), message);
  document.getElementById('toasts').append(node);
  setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 300); }, kind === 'err' ? 5000 : 2200);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copiado'); }
  catch { prompt('Copie o link:', text); }
}

/* Icons: a small Lucide subset (ISC license), inlined so the panel has no dependencies. */
const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  phone_d: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  lines: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  hash: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="m16 3-2 18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  radio: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  checkbox: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  toggle: '<rect width="20" height="12" x="2" y="6" rx="6"/><circle cx="8" cy="12" r="2"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  done: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  route: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  refresh: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  stop: '<circle cx="12" cy="12" r="10"/><rect width="6" height="6" x="9" y="9" rx="1"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  sigma: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>'
};
export function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' })) s.setAttribute(k, v);
  s.innerHTML = ICONS[name] || ''; // static, trusted markup from the table above
  return s;
}

// Help text that stays out of the way: an (i) next to the label, readable on hover, focus or tap.
export function tip(text) {
  return el('button', { type: 'button', class: 'tip', 'aria-label': text, 'data-tip': text, onclick: e => { e.preventDefault(); e.currentTarget.classList.toggle('open'); } }, icon('help', 14));
}

// Small popover menu ("⋯"). items: [label, iconName, onclick, {danger}] or null for a divider.
export function popMenu(anchor, items) {
  document.querySelector('.pop')?.remove();
  const r = anchor.getBoundingClientRect();
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
  const outside = e => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  const esc = e => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  const menu = el('div', { class: 'pop', role: 'menu' }, items.filter(i => i !== false && i !== undefined).map(i => i === null ? el('hr') : el('button', {
    type: 'button', role: 'menuitem', class: i[3]?.danger ? 'danger' : '', onclick: () => { close(); i[2](); }
  }, icon(i[1]), i[0])));
  document.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  menu.style.top = `${r.bottom + h + 6 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc); }, 0);
  menu.querySelector('button')?.focus();
}

export const TIPOS = {
  texto: { nome: 'Texto curto', icon: 'type', desc: 'Uma linha de texto' },
  longo: { nome: 'Texto longo', icon: 'lines', desc: 'Várias linhas' },
  email: { nome: 'E-mail', icon: 'mail', desc: 'Confere se o e-mail é válido' },
  telefone: { nome: 'Telefone / WhatsApp', icon: 'phone', desc: 'Com DDD' },
  numero: { nome: 'Número', icon: 'hash', desc: 'Só números' },
  url: { nome: 'Link', icon: 'link', desc: 'Site ou perfil' },
  data: { nome: 'Data', icon: 'calendar', desc: 'Calendário' },
  cidade_uf: { nome: 'Cidade e estado', icon: 'pin', desc: 'Cidade + UF' },
  unica: { nome: 'Escolha única', icon: 'radio', desc: 'Uma opção' },
  dropdown: { nome: 'Lista suspensa', icon: 'list', desc: 'Para muitas opções' },
  multipla: { nome: 'Múltipla escolha', icon: 'checkbox', desc: 'Várias opções' },
  sim_nao: { nome: 'Sim ou não', icon: 'toggle', desc: 'Duas opções' },
  escala: { nome: 'Avaliação', icon: 'star', desc: 'Nota, estrelas ou carinhas' },
  matriz: { nome: 'Matriz (grade)', icon: 'grid', desc: 'Várias afirmações, mesma escala' },
  aviso: { nome: 'Mensagem', icon: 'info', desc: 'Só texto, sem resposta' }
};
export const typeIcon = tipo => el('span', { class: 'badge' }, icon(TIPOS[tipo]?.icon || 'type', 14));

// Status of a form, shared by list, editor and results.
export const STATUS = { aberto: ['No ar', 'ok'], em_breve: ['Agendado', 'warn'], encerrado: ['Encerrado', 'err'], rascunho: ['Rascunho', ''] };
export const statusPill = estado => { const [t, k] = STATUS[estado] || STATUS.rascunho; return el('span', { class: `pill ${k}`, text: t }); };

const pad = n => String(n).padStart(2, '0');
export const fmtDate = iso => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDay = day => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
export const fmtPct = n => `${(n * 100).toFixed(n && n < .1 ? 1 : 0)}%`;
export const fmtNum = n => new Intl.NumberFormat('pt-BR').format(n);
export function fmtDur(s) {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}min ${pad(s % 60)}s` : `${Math.floor(m / 60)}h ${pad(m % 60)}min`;
}
export const formUrl = slug => `${location.origin}/f/${slug}`;
// Money answers are stored as plain numbers; this shows them with the question's currency symbol.
export const money = (sym, v) => `${sym || 'R$'} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const showAnswer = (q, v) => (q?.formato === 'moeda' && v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? money(q.moeda, v) : display(v));
export const display = v => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.cidade !== undefined || v.uf !== undefined ? `${v.cidade}/${v.uf}` : Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' | ')) : String(v));
export const plain = text => String(text || '').replace(/\*/g, '').trim();

// Like replaceChildren, but flattens arrays and skips false/null (native replaceChildren stringifies them).
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  return node;
}

/* QR code of a link (lib: admin/vendor/qrcode.js, MIT). Always dark on white with a quiet zone, so any camera reads it. */
function qrModules(text) {
  const q = window.qrcode(0, 'M');
  q.addData(unescape(encodeURIComponent(text)), 'Byte'); // UTF-8 bytes
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}
export function qrSvg(text, margin = 4) {
  const { n, dark } = qrModules(text), size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
export function qrPngBlob(text, px = 1024, margin = 4) {
  const { n, dark } = qrModules(text), cell = Math.floor(px / (n + margin * 2)), size = cell * (n + margin * 2);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
export function downloadBlob(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Light/dark mode: follows the system until the person picks one; the choice is kept in this browser. */
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
export const currentTheme = () => document.documentElement.dataset.theme || (prefersDark() ? 'dark' : 'light');
export function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem('ctf-theme', mode); } catch { /* private mode: still switches for this visit */ }
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', mode === 'dark' ? '#141312' : '#f7f6f3'));
}
export function themeSwitch() {
  const btn = el('button', { type: 'button', class: 'theme-switch', role: 'switch' });
  const draw = () => {
    const dark = currentTheme() === 'dark';
    btn.setAttribute('aria-checked', String(dark));
    btn.setAttribute('aria-label', 'Modo escuro');
    btn.title = dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro';
    fill(btn, el('span', { text: dark ? 'Modo escuro' : 'Modo claro' }), el('span', { class: 'track', 'aria-hidden': 'true' }, el('span', { class: 'knob' }), icon('sun', 12), icon('moon', 12)));
  };
  btn.addEventListener('click', () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); draw(); });
  draw();
  return btn;
}
