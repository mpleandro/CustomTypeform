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
  const node = el('div', { class: `toast ${kind}`, text: message });
  document.getElementById('toasts').append(node);
  setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 300); }, kind === 'err' ? 5000 : 2200);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copiado'); }
  catch { prompt('Copie o link:', text); }
}

export const TIPOS = {
  texto: { nome: 'Texto curto', sigla: 'Aa', desc: 'Uma linha de texto' },
  longo: { nome: 'Texto longo', sigla: '¶', desc: 'Resposta com várias linhas' },
  email: { nome: 'E-mail', sigla: '@', desc: 'Valida o formato do e-mail' },
  telefone: { nome: 'Telefone / WhatsApp', sigla: '☎', desc: 'Com máscara brasileira' },
  numero: { nome: 'Número', sigla: '12', desc: 'Apenas números' },
  url: { nome: 'Link (URL)', sigla: '↗', desc: 'Site ou perfil' },
  data: { nome: 'Data', sigla: '31', desc: 'Seletor de data' },
  cidade_uf: { nome: 'Cidade e UF', sigla: 'UF', desc: 'Cidade + estado' },
  unica: { nome: 'Escolha única', sigla: '◉', desc: 'Uma opção entre várias' },
  dropdown: { nome: 'Lista suspensa', sigla: '▾', desc: 'Lista pesquisável, ideal para muitas opções' },
  multipla: { nome: 'Múltipla escolha', sigla: '☑', desc: 'Várias opções' },
  sim_nao: { nome: 'Sim / Não', sigla: '±', desc: 'Duas opções' },
  escala: { nome: 'Avaliação', sigla: '★', desc: 'Números, estrelas ou emojis (NPS e satisfação)' },
  aviso: { nome: 'Mensagem', sigla: 'i', desc: 'Texto sem resposta' }
};

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
export const display = v => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? `${v.cidade}/${v.uf}` : String(v));
export const plain = text => String(text || '').replace(/\*/g, '').trim();

// Like replaceChildren, but flattens arrays and skips false/null (native replaceChildren stringifies them).
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  return node;
}
