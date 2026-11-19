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

  // Countries offered in the phone field: [ISO code, name, dialling code, national number length min, max].
  // Brazil comes first and is the default; the rest is alphabetical.
  const COUNTRIES = [
    ['BR', 'Brasil', '55', 10, 11],
    ['ZA', 'África do Sul', '27', 9, 9], ['DE', 'Alemanha', '49', 6, 13], ['AO', 'Angola', '244', 9, 9],
    ['SA', 'Arábia Saudita', '966', 9, 9], ['AR', 'Argentina', '54', 10, 11], ['AU', 'Austrália', '61', 9, 9],
    ['AT', 'Áustria', '43', 6, 13], ['BE', 'Bélgica', '32', 8, 9], ['BO', 'Bolívia', '591', 8, 8],
    ['CV', 'Cabo Verde', '238', 7, 7], ['CA', 'Canadá', '1', 10, 10], ['CL', 'Chile', '56', 9, 9],
    ['CN', 'China', '86', 11, 11], ['CO', 'Colômbia', '57', 10, 10], ['KR', 'Coreia do Sul', '82', 9, 10],
    ['CR', 'Costa Rica', '506', 8, 8], ['DK', 'Dinamarca', '45', 8, 8], ['AE', 'Emirados Árabes', '971', 8, 9],
    ['EC', 'Equador', '593', 8, 9], ['ES', 'Espanha', '34', 9, 9], ['US', 'Estados Unidos', '1', 10, 10],
    ['FI', 'Finlândia', '358', 6, 11], ['FR', 'França', '33', 9, 9], ['GR', 'Grécia', '30', 10, 10],
    ['GT', 'Guatemala', '502', 8, 8], ['GW', 'Guiné-Bissau', '245', 7, 9], ['NL', 'Holanda', '31', 9, 9],
    ['HN', 'Honduras', '504', 8, 8], ['IN', 'Índia', '91', 10, 10], ['IE', 'Irlanda', '353', 7, 9],
    ['IL', 'Israel', '972', 8, 9], ['IT', 'Itália', '39', 6, 11], ['JP', 'Japão', '81', 9, 10],
    ['LU', 'Luxemburgo', '352', 6, 11], ['MO', 'Macau', '853', 8, 8], ['MX', 'México', '52', 10, 10],
    ['MZ', 'Moçambique', '258', 8, 9], ['NO', 'Noruega', '47', 8, 8], ['NZ', 'Nova Zelândia', '64', 8, 10],
    ['PA', 'Panamá', '507', 7, 8], ['PY', 'Paraguai', '595', 9, 9], ['PE', 'Peru', '51', 8, 9],
    ['PL', 'Polônia', '48', 9, 9], ['PT', 'Portugal', '351', 9, 9], ['GB', 'Reino Unido', '44', 9, 10],
    ['DO', 'República Dominicana', '1', 10, 10], ['RO', 'Romênia', '40', 9, 9], ['ST', 'São Tomé e Príncipe', '239', 7, 7],
    ['SE', 'Suécia', '46', 7, 10], ['CH', 'Suíça', '41', 9, 9], ['TL', 'Timor-Leste', '670', 7, 8],
    ['UY', 'Uruguai', '598', 8, 8], ['VE', 'Venezuela', '58', 10, 10]
  ].map(([iso, nome, ddi, min, max]) => ({ iso, nome, ddi, min, max }));
  const BY_ISO = Object.fromEntries(COUNTRIES.map(c => [c.iso, c]));
  // When a number arrives without a country choice (URL prefill, API), the dialling code picks the most common country.
  const DEFAULT_FOR_DDI = { '1': 'US' };

  // Reads a phone answer into { pais, digits }. Answers starting with "+" (or "00") are international,
  // optionally "+DDI national" with a space; anything else is a Brazilian number (a leading 55 is dropped).
  function parsePhone(raw, iso) {
    const s = String(raw || '').trim();
    const intl = /^(\+|00)/.test(s);
    let digits = s.replace(/\D/g, '');
    if (!intl) {
      const pais = BY_ISO[iso] || BY_ISO.BR;
      if (pais.iso === 'BR' && (digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
      return { pais, digits };
    }
    if (s.startsWith('00')) digits = digits.slice(2);
    const spaced = s.match(/^(?:\+|00)\s*(\d{1,3})[\s-]/);
    let ddi = spaced && COUNTRIES.some(c => c.ddi === spaced[1]) ? spaced[1] : '';
    if (!ddi) for (let n = 3; n >= 1 && !ddi; n--) if (COUNTRIES.some(c => c.ddi === digits.slice(0, n))) ddi = digits.slice(0, n);
    if (!ddi) return { pais: null, digits };
    const pais = (BY_ISO[iso]?.ddi === ddi && BY_ISO[iso]) || BY_ISO[DEFAULT_FOR_DDI[ddi]] || COUNTRIES.find(c => c.ddi === ddi);
    return { pais, digits: digits.slice(ddi.length) };
  }

  // Error message for any phone answer ('' when valid).
  function phoneCheck(raw) {
    const { pais, digits } = parsePhone(raw);
    if (!pais) return 'Escolha o país do número.';
    if (pais.iso === 'BR') return phoneError(digits);
    const national = pais.ddi === '39' ? digits : digits.replace(/^0+/, ''); // Italy keeps the leading 0; elsewhere it is a trunk prefix
    if (national.length < pais.min || national.length > pais.max) return 'Esse número não parece válido para o país escolhido.';
    if (/^(\d)\1+$/.test(national)) return 'Esse número não parece válido. Confira os dígitos.';
    return '';
  }

  // Stored form: Brazilian numbers stay as national digits with DDD (as always); others go in E.164 ("+12025550123").
  function phoneValue(raw) {
    const { pais, digits } = parsePhone(raw);
    if (!pais) return '';
    if (pais.iso === 'BR') return digits;
    return `+${pais.ddi}${pais.ddi === '39' ? digits : digits.replace(/^0+/, '')}`;
  }

  const api = { nextIndex, visited, emojis, redirectFor, condMatches, phoneError, COUNTRIES, parsePhone, phoneCheck, phoneValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CtfRoute = api;
})(typeof self !== 'undefined' ? self : this);
