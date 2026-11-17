export const FORM_TEMPLATES = [
  {
    id: 'balf360',
    nome: 'BALF 360',
    descricao: 'Preto profundo, laranja solar e dourado.',
    tema: { fundo: '#070708', texto: '#f2f2f2', destaque: '#ff5c00', destaque2: '#cc8400', fonte: 'Inter', raio: 6, grade: false }
  },
  {
    id: 'vertuz',
    nome: 'Vértuz',
    descricao: 'Azul profundo, brilho azul e visual contemporâneo.',
    tema: { fundo: '#00050d', texto: '#ffffff', destaque: '#0063f2', destaque2: '#80b4ff', fonte: 'Manrope', raio: 16, grade: false }
  },
  {
    id: 'plenitude',
    nome: 'Jornada Plenitude',
    descricao: 'Verde profundo, dourado suave e tipografia elegante.',
    tema: { fundo: '#050c06', texto: '#fbfbe6', destaque: '#d4ca9e', destaque2: '#c1c190', fonte: 'Lora', raio: 18, grade: false }
  },
  {
    id: 'milmilionarios',
    nome: 'Mentoria Mil Milionários',
    descricao: 'Marrom, laranja e terracota, com tipografia geométrica.',
    tema: { fundo: '#2a120e', texto: '#fffcf5', destaque: '#ffaa58', destaque2: '#a35139', fonte: 'Montserrat', raio: 16, grade: false }
  },
  {
    id: 'ignis',
    nome: 'Ignis',
    descricao: 'Preto, marfim e degradê em tons de fogo.',
    tema: { fundo: '#080808', texto: '#f7f5ef', destaque: '#ff6b1a', destaque2: '#ffb347', fonte: 'Manrope', raio: 4, grade: true }
  }
];

export const THEME_PRESETS = [
  // The form templates keep their colors under `tema`; flatten them so every preset has the same shape.
  ...FORM_TEMPLATES.map(t => ({ nome: t.nome, ...t.tema })),
  { nome: 'Escuro', fundo: '#0b0b0f', texto: '#f5f5f7', destaque: '#6366f1', destaque2: '#22d3ee' },
  { nome: 'Claro', fundo: '#ffffff', texto: '#18181b', destaque: '#4f46e5', destaque2: '#9333ea' },
  { nome: 'Oceano', fundo: '#06141f', texto: '#eaf6ff', destaque: '#22d3ee', destaque2: '#3b82f6' },
  { nome: 'Floresta', fundo: '#0e1a14', texto: '#eef7f0', destaque: '#34d399', destaque2: '#a3e635' },
  { nome: 'Papel', fundo: '#faf6ee', texto: '#2a2118', destaque: '#c2410c', destaque2: '#b45309' }
];
