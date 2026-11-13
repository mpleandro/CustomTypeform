'use strict';
// Pontuação por variáveis: cada regra soma pontos quando a resposta combina; o primeiro "resultado" cujas condições combinam vence.
const routing = require('../public/route.js');

const CMP = {
gte: (a, b) => a >= b, gt: (a, b) => a > b, lte: (a, b) => a <= b,
lt: (a, b) => a < b, eq: (a, b) => a === b, ne: (a, b) => a !== b
};

// "var:chave" compara com a pontuação de outra variável; "num:10" compara com um número fixo.
function operand(ref, pontos) {
ref = String(ref || '');
if (ref.startsWith('var:')) return pontos[ref.slice(4)] ?? 0;
return Number(ref.slice(4)) || 0;
}

function compute(schema, answers) {
const po = schema.pontuacao;
if (!po || !po.ativo || !po.variaveis.length) return null;
const pontos = Object.fromEntries(po.variaveis.map(v => [v.chave, 0]));
for (const r of po.regras) {
if (!(r.variavel in pontos)) continue;
if (routing.condMatches({ pergunta: r.pergunta, linha: r.linha, op: r.op, valor: r.valor }, answers)) pontos[r.variavel] += r.pontos;
}
const tags = po.variaveis.filter(v => v.corte !== null && pontos[v.chave] >= v.corte).map(v => v.chave);
const resultado = po.resultados.find(res => res.condicoes.every(c => (CMP[c.op] || CMP.gte)(pontos[c.variavel] ?? 0, operand(c.com, pontos)))) || null;
return { pontos, tags, resultado };
}

module.exports = { compute };
