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

  const api = { nextIndex, visited, emojis, redirectFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CtfRoute = api;
})(typeof self !== 'undefined' ? self : this);
