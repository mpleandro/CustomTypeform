'use strict';
// Imports an old vulcan-quiz folder (perguntas.json + logo) as a new draft form.
//   node scripts/import-quiz.js ../vulcan-quiz [slug]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore } = require('../lib/db');
const schemaLib = require('../lib/schema');

const dir = path.resolve(process.argv[2] || '');
const slug = process.argv[3] || 'laboratorio-vulcan';
const src = path.join(dir, 'public', 'perguntas.json');
if (!process.argv[2] || !fs.existsSync(src)) {
  console.error('Uso: node scripts/import-quiz.js <pasta-do-quiz> [slug]');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const store = createStore(dataDir);
const old = JSON.parse(fs.readFileSync(src, 'utf8'));
if (store.getFormBySlug(slug)) { console.error(`Já existe um formulário com o slug "${slug}".`); process.exit(1); }

const TIPO = { texto: 'texto', email: 'email', telefone: 'telefone', longo: 'longo', cidade_uf: 'cidade_uf', unica: 'unica', multipla: 'multipla', escala: 'escala' };
const perguntas = old.blocos.flatMap(b => b.perguntas).map(q => ({
  id: schemaLib.newId(), chave: q.id === 'nome' ? 'nome' : q.id, tipo: TIPO[q.tipo] || 'texto',
  rotulo: q.rotulo, ajuda: q.ajuda || '', obrigatoria: !!q.obrigatoria, placeholder: q.placeholder || '',
  opcoes: q.opcoes || [], outra: !!q.outra, exclusivas: q.exclusivas || [], compacta: !!q.compacta,
  min: q.min ?? 1, max: q.max ?? 5, rotulo_min: q.rotulo_min || '', rotulo_max: q.rotulo_max || '',
  prefill: q.prefill || [], proxima: '', ramos: {}
}));

let logo = '';
const logoSrc = path.join(dir, 'public', 'assets', 'ignis-horizontal.png');
if (fs.existsSync(logoSrc)) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const name = `${crypto.randomUUID()}.png`;
  fs.copyFileSync(logoSrc, path.join(dataDir, 'uploads', name));
  logo = `/uploads/${name}`;
}

const s = schemaLib.defaultSchema();
Object.assign(s, {
  boas_vindas: { ativo: true, eyebrow: 'Laboratório Vulcan · 14/11', titulo: old.boas_vindas.titulo, texto: old.boas_vindas.texto, botao: 'Começar' },
  perguntas,
  consentimento: { ativo: !!old.consentimento, texto: old.consentimento || '' },
  final: { titulo: old.final?.titulo || 'Obrigado!', texto: old.final?.texto || '', cta_texto: '', cta_url: '' },
  tema: { fundo: '#080808', texto: '#f7f5ef', destaque: '#ff6b1a', fonte: 'Manrope', raio: 4, grade: true, logo, fundo_imagem: '' }
});

const id = crypto.randomUUID();
store.createForm({ id, slug, title: 'Laboratório Vulcan — questionário pós-compra', status: 'draft', schema: schemaLib.sanitize(s) });
console.log(`Importado: ${perguntas.length} perguntas. Abra o painel, revise e publique em /f/${slug}`);
