// Question routing, emoji sets and redirect rules, shared by the server (CommonJS), the respondent page and the admin (window.CtfRoute).
// Rules only jump forward, so a route can never loop.
(function (root) {
  // Index of the question shown after qs[i]; qs.length means "go to submit".
  function nextIndex(qs, i, answers) {
    const q = qs[i];
    let dest = q.proxima || '';
    const v = answers[q.id];
    if (q.ramos && (typeof v === 'string' || typeof v === 'number') && v !== '' && q.ramos[String(v)]) dest = q.ramos[String(v)];
    if (dest === 'fim') return qs.length;
    if (dest) {
      const j = qs.findIndex(x => x.id === dest);
      if (j > i) return j;
    }
    return i + 1;
  }

  // Indexes of the questions this respondent passes through, given the answers so far.
  function visited(qs, answers) {
    const out = [];
    for (let i = 0; i < qs.length; i = nextIndex(qs, i, answers)) out.push(i);
    return out;
  }

  // Emoji faces for the satisfaction scale, by number of options (3 to 5), worst to best.
  const emojis = { 3: ['🙁', '😐', '😊'], 4: ['😞', '🙁', '🙂', '😍'], 5: ['😡', '🙁', '😐', '🙂', '😍'] };

  // --- conditional redirect: first rule whose conditions all match wins ---
  const norm = x => String(x).trim().toLowerCase();
  function condMatches(c, answers) {
    let v = answers[c.pergunta];
    if (c.linha) v = v && typeof v === 'object' ? v[c.linha] : undefined; // matrix: compare one row
    if (v && typeof v === 'object' && !Array.isArray(v)) v = v.uf; // city/state answers compare by state
    const has = v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
    const hasValue = () => (Array.isArray(v) ? v.includes(c.valor) : has && norm(v) === norm(c.valor));
    switch (c.op) {
      case 'igual': return hasValue();
      case 'diferente': return !hasValue();
      case 'contem': return Array.isArray(v) ? v.includes(c.valor) : has && norm(v).includes(norm(c.valor));
      case 'nao_contem': return Array.isArray(v) ? !v.includes(c.valor) : !(has && norm(v).includes(norm(c.valor)));
      case 'gte': return has && Number(v) >= Number(c.valor);
      case 'lte': return has && Number(v) <= Number(c.valor);
    }
    return false;
  }
  function redirectFor(cfg, answers) {
    if (!cfg || !cfg.ativo) return '';
    for (const rule of cfg.regras || []) {
      if (rule.condicoes.length && rule.condicoes.every(c => condMatches(c, answers))) return rule.url;
    }
    return cfg.url_padrao || '';
  }

  // Brazilian phone format check on digits only (no "55"): valid area code, mobile starts with 9, no fake sequences.
const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
function phoneError(digits) {
if (digits.length < 10 || digits.length > 11) return 'Informe o número com DDD.';
if (!DDDS.has(digits.slice(0, 2))) return 'Esse DDD não existe. Confira o número.';
const num = digits.slice(2);
if (digits.length === 11 && num[0] !== '9') return 'Celular com 9 dígitos começa com 9 depois do DDD.';
if (digits.length === 10 && !/[2-5]/.test(num[0])) return 'Esse número não parece válido. Confira os dígitos.';
if (/^(\d)\1+$/.test(num) || /^(\d\d)\1+$/.test(num.slice(digits.length === 11 ? 1 : 0))) return 'Esse número não parece válido. Confira os dígitos.';
return '';
}

const api = { nextIndex, visited, emojis, redirectFor, condMatches, phoneError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CtfRoute = api;
})(typeof self !== 'undefined' ? self : this);
