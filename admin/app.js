import { el, fill, api, toast, copy, fmtNum, fmtPct, formUrl } from './ui.js';
import { renderEditor } from './editor.js';
import { renderResults } from './results.js';
import { FORM_TEMPLATES } from './templates.js';

const app = document.getElementById('app');
let cleanup = null; // set by a view to stop timers when navigating away

function mount(...nodes) {
  fill(app, ...nodes);
}
const setCleanup = fn => { cleanup = fn; };

/* ---------- login ---------- */

function loginView(configured) {
  const input = el('input', { class: 'input', type: 'password', placeholder: 'Senha do administrador', autocomplete: 'current-password', autofocus: true });
  const error = el('p', { class: 'notice err', hidden: true });
  const btn = el('button', { class: 'btn primary', type: 'submit', style: 'width:100%;height:38px' }, 'Entrar');
  const form = el('form', {
    async onsubmit(e) {
      e.preventDefault();
      btn.disabled = true; error.hidden = true;
      try { await api('POST', '/login', { senha: input.value }); route(); }
      catch (err) { error.textContent = err.message; error.hidden = false; btn.disabled = false; input.select(); }
    }
  }, el('div', { class: 'field' }, input), error, btn);
  mount(el('div', { class: 'login' }, el('div', { class: 'card' },
    el('div', { class: 'brand', style: 'margin-bottom:18px' }, 'Custom ', el('i', { text: 'Typeform' })),
    el('h1', { text: 'Entrar no painel' }),
    el('p', { class: 'muted', style: 'margin:4px 0 18px' }, configured ? 'Informe a senha para gerenciar seus formulários.' : 'O servidor ainda não tem ADMIN_PASSWORD definida.'),
    configured && form)));
}

/* ---------- forms list ---------- */

function shell(content, extra) {
  return el('div', {},
    el('header', { class: 'topbar' },
      el('a', { class: 'brand', href: '#/' }, 'Custom ', el('i', { text: 'Typeform' })),
      el('div', { class: 'grow' }), extra,
      el('button', { class: 'btn ghost sm', onclick: async () => { await api('POST', '/logout'); route(); } }, 'Sair')),
    el('main', { class: 'page' }, content));
}

async function listView() {
  const { forms } = await api('GET', '/forms');
  const total = forms.reduce((a, f) => ({ views: a.views + f.views, started: a.started + f.started, completed: a.completed + f.completed }), { views: 0, started: 0, completed: 0 });

  const create = async (copyFrom, defaultName = '') => {
    if (copyFrom) {
      const titulo = prompt('Nome do formulário:', defaultName);
      if (titulo === null) return;
      const { form } = await api('POST', '/forms', { titulo, copiar_de: copyFrom });
      location.hash = `#/forms/${form.id}`;
      return;
    }

    let selected = FORM_TEMPLATES[0];
    const nameInput = el('input', { class: 'input', type: 'text', maxlength: 120, required: true, placeholder: 'Ex.: Pesquisa de satisfação' });
    nameInput.addEventListener('input', () => nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Informe o nome do formulário.'));
    const error = el('p', { class: 'notice err', hidden: true });
    const createButton = el('button', { class: 'btn primary', type: 'submit' }, 'Criar formulário');
    const cards = new Map();
    const grid = el('div', { class: 'template-grid', role: 'group', 'aria-label': 'Templates disponíveis' },
      FORM_TEMPLATES.map(template => {
        const card = el('button', {
          class: `template-option${template.id === selected.id ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': String(template.id === selected.id),
          onclick() {
            selected = template;
            for (const [id, node] of cards) {
              const active = id === selected.id;
              node.classList.toggle('selected', active);
              node.setAttribute('aria-pressed', String(active));
            }
          }
        },
        el('div', { class: 'template-preview', style: `--template-bg:${template.tema.fundo};--template-fg:${template.tema.texto};--template-accent:${template.tema.destaque};--template-accent2:${template.tema.destaque2}` },
          el('span', { class: 'template-preview-label', text: 'SEU FORMULÁRIO' }),
          el('b', { text: 'Uma experiência' }),
          el('span', { class: 'template-preview-bar' })),
        el('div', { class: 'template-description' },
          el('strong', { text: template.nome }),
          el('span', { text: template.descricao })),
        el('span', { class: 'template-colors', 'aria-hidden': 'true' },
          ...[template.tema.fundo, template.tema.destaque, template.tema.destaque2].map(color => el('i', { style: `background:${color}` }))));
        cards.set(template.id, card);
        return card;
      }));
    const dialog = el('dialog', {
      class: 'create-dialog',
      'aria-labelledby': 'create-form-title',
      onclose: () => dialog.remove(),
      onclick(event) { if (event.target === dialog) dialog.close(); }
    });
    const form = el('form', {
      class: 'create-form',
      onsubmit: async event => {
        event.preventDefault();
        if (!nameInput.value.trim()) {
          nameInput.setCustomValidity('Informe o nome do formulário.');
          nameInput.reportValidity();
          return;
        }
        error.hidden = true;
        createButton.disabled = true;
        createButton.textContent = 'Criando…';
        try {
          const { form: created } = await api('POST', '/forms', { titulo: nameInput.value.trim(), tema: selected.tema });
          dialog.close();
          location.hash = `#/forms/${created.id}`;
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          createButton.disabled = false;
          createButton.textContent = 'Criar formulário';
        }
      }
    },
    el('div', { class: 'create-dialog-head' },
      el('div', {}, el('h2', { id: 'create-form-title', text: 'Novo formulário' }), el('p', { class: 'muted', text: 'Dê um nome e escolha um ponto de partida visual.' })),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dialog.close() }, '×')),
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Nome do formulário' }), nameInput),
    el('div', { class: 'field' }, el('span', { class: 'label', text: 'Template' }), grid),
    error,
    el('div', { class: 'create-dialog-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'),
      createButton));
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    nameInput.focus();
  };

  const card = f => el('article', { class: 'card form-card' },
    el('div', { class: 'row' },
      el('h3', { class: 'grow' }, el('a', { href: `#/forms/${f.id}`, style: 'color:inherit', text: f.title })),
      (() => { const p = { aberto: ['No ar', 'ok'], em_breve: ['Agendado', 'warn'], encerrado: ['Encerrado', 'err'], rascunho: ['Rascunho', ''] }[f.estado] || ['Rascunho', '']; return el('span', { class: `pill ${p[1]}`, text: p[0] }); })()),
    el('div', { class: 'url-line' }, el('span', { text: `/f/${f.slug}` }),
      el('button', { class: 'icon-btn', title: 'Copiar link', onclick: () => copy(formUrl(f.slug)) }, '⧉'),
      f.status !== 'draft' && el('a', { class: 'icon-btn', title: 'Abrir', href: `/f/${f.slug}`, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, '↗')),
    el('div', { class: 'mini' },
      el('div', {}, el('small', { text: 'Respostas' }), el('b', { text: fmtNum(f.completed) })),
      el('div', {}, el('small', { text: 'Iniciadas' }), el('b', { text: fmtNum(f.started) })),
      el('div', {}, el('small', { text: 'Conclusão' }), el('b', { text: f.started ? fmtPct(f.rate) : '—' }))),
    el('div', { class: 'row' },
      el('a', { class: 'btn sm', href: `#/forms/${f.id}/results` }, 'Resultados'),
      el('a', { class: 'btn sm', href: `#/forms/${f.id}` }, 'Editar'),
      el('div', { class: 'grow' }),
      el('button', { class: 'btn ghost sm', onclick: () => create(f.id, `${f.title} (cópia)`) }, 'Duplicar'),
      el('button', {
        class: 'btn ghost sm danger',
        async onclick() {
          if (!confirm(`Excluir “${f.title}” e todas as ${f.started} respostas? Isso não pode ser desfeito.`)) return;
          await api('DELETE', `/forms/${f.id}`); toast('Formulário excluído'); route();
        }
      }, 'Excluir')));

  mount(shell(el('div', {},
    el('div', { class: 'page-head' }, el('h1', { class: 'grow', text: 'Formulários' }), el('button', { class: 'btn primary', onclick: () => create() }, '+ Novo formulário')),
    forms.length > 0 && el('div', { class: 'kpis' },
      kpi('Formulários no ar', fmtNum(forms.filter(f => f.estado === 'aberto').length), `${forms.length} no total`),
      kpi('Visualizações', fmtNum(total.views)),
      kpi('Respostas completas', fmtNum(total.completed), `${fmtNum(total.started)} iniciadas`),
      kpi('Taxa de conclusão', total.started ? fmtPct(total.completed / total.started) : '—')),
    forms.length
      ? el('div', { class: 'forms' }, forms.map(card))
      : el('div', { class: 'card empty' }, el('h3', { text: 'Nenhum formulário ainda' }), el('p', { text: 'Crie o primeiro e publique em um link próprio.' })))));
}

const kpi = (label, value, sub) => el('div', { class: 'card kpi' }, el('small', { text: label }), el('b', { text: value }), sub && el('span', { text: sub }));

/* ---------- router ---------- */

async function route() {
  cleanup?.(); cleanup = null; // stop the previous view's timers/listeners before drawing the next
  let me;
  try { me = await api('GET', '/me'); } catch { return loginView(true); }
  if (!me.autenticado) return loginView(me.configurado);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'forms' && parts[1] && parts[2] === 'results') return await renderResults(parts[1], { mount, shell, setCleanup });
    if (parts[0] === 'forms' && parts[1]) return await renderEditor(parts[1], { mount, setCleanup });
    await listView();
  } catch (err) {
    if (err.status === 404) { toast(err.message, 'err'); location.hash = '#/'; return; }
    mount(shell(el('div', { class: 'notice err', text: err.message })));
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('ctf-unauth', () => loginView(true));
route();
