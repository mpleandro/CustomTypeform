'use strict';
// Server-side answer validation: mirrors the client so a tampered request can't store invalid data.
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO','Exterior'];
const MAX_TEXT = 2000;

const isText = v => typeof v === 'string';
const clean = v => (isText(v) ? v.trim().slice(0, MAX_TEXT) : '');

function isEmpty(v) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return !v.length;
  if (typeof v === 'object') return v.cidade !== undefined || v.uf !== undefined ? !clean(v.cidade) && !clean(v.uf) : !Object.keys(v).length;
  return false;
}

// Returns { empty: true } | { error } | { value, outra? }.
function checkAnswer(q, v, outra) {
  if (isEmpty(v)) return q.obrigatoria ? { error: 'obrigatória' } : { empty: true };
  switch (q.tipo) {
    case 'texto': case 'longo': {
      const t = clean(v);
      return t ? { value: t } : { error: 'texto inválido' };
    }
    case 'email': {
      const t = clean(v).toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? { value: t } : { error: 'e-mail inválido' };
    }
    case 'telefone': {
      let digits = isText(v) ? v.replace(/\D/g, '') : '';
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
      return digits.length >= 10 && digits.length <= 11 ? { value: digits } : { error: 'telefone inválido' };
    }
    case 'numero': {
      const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
      return Number.isFinite(n) ? { value: n } : { error: 'número inválido' };
    }
    case 'url': {
      let t = clean(v);
      if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
      try {
        const u = new URL(t);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? { value: u.href } : { error: 'link inválido' };
      } catch { return { error: 'link inválido' }; }
    }
    case 'data': {
      const t = clean(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? { value: t } : { error: 'data inválida' };
    }
    case 'cidade_uf': {
      const cidade = clean(v?.cidade), uf = clean(v?.uf);
      if (!cidade || !uf) return { error: 'obrigatória' };
      return UFS.includes(uf) ? { value: { cidade, uf } } : { error: 'UF inválida' };
    }
    case 'sim_nao':
      return v === 'Sim' || v === 'Não' ? { value: v } : { error: 'opção inválida' };
    case 'dropdown':
      if (q.opcoes.includes(v)) return { value: v };
      if (q.outra && v === 'Outra' && clean(outra)) return { value: 'Outra', outra: clean(outra) };
      return { error: 'opção inválida' };
    case 'unica': {
      if (q.opcoes.includes(v)) return { value: v };
      if (q.outra && v === 'Outra' && clean(outra)) return { value: 'Outra', outra: clean(outra) };
      return { error: 'opção inválida' };
    }
    case 'multipla': {
      const list = Array.isArray(v) ? [...new Set(v)] : [];
      const allowed = q.outra ? [...q.opcoes, 'Outra'] : q.opcoes;
      if (!list.length || list.some(x => !allowed.includes(x))) return { error: 'opção inválida' };
      if (list.length > 1 && list.some(x => q.exclusivas.includes(x))) return { error: 'combinação inválida' };
      if (list.includes('Outra') && !clean(outra)) return { error: 'opção inválida' };
      return list.includes('Outra') ? { value: list, outra: clean(outra) } : { value: list };
    }
    case 'matriz': {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'valor inválido' };
    const letters = (q.linhas || []).map((_, i) => String.fromCharCode(65 + i));
    const out = {};
    for (const [k, c] of Object.entries(v)) {
    if (!letters.includes(k) || !q.opcoes.includes(c)) return { error: 'opção inválida' };
    out[k] = c;
    }
    if (q.obrigatoria && letters.some(l => out[l] === undefined)) return { error: 'obrigatória' };
    return { value: out };
    }
    case 'escala':
      return Number.isInteger(v) && v >= q.min && v <= q.max ? { value: v } : { error: 'valor inválido' };
  }
  return { error: 'tipo desconhecido' };
}

// A matrix answer is complete when every row has a column chosen.
function matrixComplete(q, v) {
return !!v && typeof v === 'object' && (q.linhas || []).every((_, i) => v[String.fromCharCode(65 + i)] !== undefined);
}

module.exports = { checkAnswer, matrixComplete, UFS, clean, isText };
