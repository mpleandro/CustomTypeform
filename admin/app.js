import { el, fill, api, toast, copy, fmtNum, fmtPct, formUrl, icon, popMenu, statusPill, themeSwitch } from './ui.js';
import { renderEditor } from './editor.js';
import { renderResults } from './results.js';
import { renderSettings, renderGroup } from './groups.js';
import { FORM_TEMPLATES } from './templates.js';

const app = document.getElementById('app');
let cleanup = null; // set by a view to stop timers when navigating away

function mount(...nodes) {
  fill(app, ...nodes);
}
const setCleanup = fn => { cleanup = fn; };
const brand = () => el('span', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Custom Typeform');

/* ---------- login ---------- */

function loginView(configured) {
  const input = el('input', { class: 'input', type: 'password', placeholder: 'Senha', 'aria-label': 'Senha', autocomplete: 'current-password', autofocus: true });
  const error = el('p', { class: 'notice err', hidden: true });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  const form = el('form', {
    async onsubmit(e) {
      e.preventDefault();
      btn.disabled = true; error.hidden = true;
      try { await api('POST', '/login', { senha: input.value }); route(); }
      catch (err) { error.textContent = err.message; error.hidden = false; btn.disabled = false; input.select(); }
    }
  }, el('div', { class: 'field' }, input), error, btn);
  mount(el('div', { class: 'login' }, el('div', { class: 'card' },
    brand(),
    el('h1', { text: 'Entrar no painel' }),
    el('p', { class: 'muted', style: 'margin:4px 0 20px' }, configured ? 'Gerencie seus formulários.' : 'Defina a variável ADMIN_PASSWORD no servidor para entrar.'),
    configured && form)));
}

/* ---------- shell ---------- */

function shell(content) {
  return el('div', {},
    el('header', { class: 'topbar' },
      el('a', { href: '#/' }, brand()),
      el('div', { class: 'grow' }),
      el('a', { class: 'btn ghost sm', href: '#/config' }, icon('settings', 15), 'Configurações'),
      themeSwitch(),
      el('button', { class: 'btn ghost sm', onclick: async () => { await api('POST', '/logout'); route(); } }, icon('logout', 15), 'Sair')),
    el('main', { class: 'page' }, content));
}

/* ---------- forms list ---------- */

async function listView() {
  const { forms } = await api('GET', '/forms');
  const total = forms.reduce((a, f) => ({ views: a.views + f.views, started: a.started + f.started, completed: a.completed + f.completed }), { views: 0, started: 0, completed: 0 });

  const duplicate = async f => {
    const titulo = prompt('Nome da cópia:', `${f.title} (cópia)`);
    if (titulo === null) return;
    const { form } = await api('POST', '/forms', { titulo, copiar_de: f.id });
    location.hash = `#/forms/${form.id}`;
  };
  const remove = async f => {
    const n = f.started ? ` e ${fmtNum(f.started)} resposta${f.started === 1 ? '' : 's'}` : '';
    if (!confirm(`Excluir “${f.title}”${n}? Não dá para desfazer.`)) return;
    await api('DELETE', `/forms/${f.id}`); toast('Formulário excluído'); route();
  };

  const create = () => {
    let selected = FORM_TEMPLATES[0];
    const nameInput = el('input', { class: 'input', type: 'text', maxlength: 120, required: true, placeholder: 'Ex.: Pesquisa de satisfação' });
    nameInput.addEventListener('input', () => nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Dê um nome ao formulário.'));
    const error = el('p', { class: 'notice err', hidden: true });
    const createButton = el('button', { class: 'btn primary', type: 'submit' }, 'Criar formulário');
    const cards = new Map();
    const grid = el('div', { class: 'template-grid', role: 'group', 'aria-label': 'Visual' },
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
        el('div', { class: 'template-preview', style: `--template-bg:${template.tema.fundo};--template-fg:${template.tema.texto};--template-accent:${template.tema.destaque};--template-accent2:${template.tema.destaque2};font-family:'${template.tema.fonte}',var(--font)` },
          el('b', { text: 'Sua pergunta aqui' }),
          el('span', { class: 'template-preview-bar' })),
        el('div', { class: 'template-description' },
          el('strong', { text: template.nome }),
          el('span', { text: template.descricao })));
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
          nameInput.setCustomValidity('Dê um nome ao formulário.');
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
      el('div', {}, el('h2', { id: 'create-form-title', text: 'Novo formulário' }), el('p', { class: 'muted', text: 'Você pode mudar tudo depois.' })),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dialog.close() }, icon('x', 18))),
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Nome' }), nameInput),
    el('div', { class: 'field' }, el('span', { class: 'label', text: 'Visual' }), grid),
    error,
    el('div', { class: 'create-dialog-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'),
      createButton));
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    nameInput.focus();
  };

  // Each form gets a tiny "cover" painted with its own theme, so forms are recognisable at a glance.
  const cover = t => el('span', { class: 'cover', 'aria-hidden': 'true', style: `background:${t?.fundo || '#111'};color:${t?.texto || '#fff'};--c-acc:${t?.destaque || 'var(--accent)'}` }, el('i'), el('i'), el('i'));

  const row = f => {
    const open = () => { location.hash = `#/forms/${f.id}`; };
    const more = el('button', { class: 'icon-btn', 'aria-label': `Mais ações para ${f.title}`, onclick: e => { e.stopPropagation(); popMenu(more, [
      ['Copiar link', 'copy', () => copy(formUrl(f.slug))],
      f.status !== 'draft' && ['Abrir formulário', 'external', () => window.open(`/f/${f.slug}`, '_blank', 'noopener')],
      ['Duplicar', 'copy', () => duplicate(f)],
      null,
      ['Excluir', 'trash', () => remove(f), { danger: true }]
    ]); } }, icon('more', 18));
    return el('div', { class: 'frow', role: 'link', tabindex: '0', onclick: open, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
      el('div', { class: 'who' }, cover(f.tema),
        el('div', { class: 'name' }, el('b', { text: f.title }), el('span', { text: `/f/${f.slug}` }))),
      el('div', { class: 'st' }, statusPill(f.estado)),
      el('div', { class: 'n' }, fmtNum(f.completed), el('small', { text: `de ${fmtNum(f.started)}` })),
      el('div', { class: 'rate' }, f.started ? fmtPct(f.rate) : el('span', { class: 'muted', text: '—' }), el('span', { class: 'track' }, el('i', { style: `width:${(f.rate || 0) * 100}%` }))),
      el('div', { class: 'acts' },
        el('a', { class: 'icon-btn', href: `#/forms/${f.id}/results`, title: 'Resultados', 'aria-label': 'Resultados', onclick: e => e.stopPropagation() }, icon('chart', 17)),
        el('a', { class: 'icon-btn', href: `#/forms/${f.id}`, title: 'Editar', 'aria-label': 'Editar', onclick: e => e.stopPropagation() }, icon('pencil', 16)),
        more),
      el('div', { class: 'meta-m' }, statusPill(f.estado), el('span', { text: `${fmtNum(f.completed)} respostas` }), f.started > 0 && el('span', { text: `${fmtPct(f.rate)} concluem` })));
  };

  const live = forms.filter(f => f.estado === 'aberto').length;
  mount(shell(el('div', {},
    el('div', { class: 'page-head' },
      el('h1', { class: 'grow', text: 'Formulários' }),
      el('button', { class: 'btn accent', onclick: create }, icon('plus'), 'Novo formulário')),
    forms.length > 0 && el('div', { class: 'stats' },
      el('div', { class: 'stat hero' }, el('small', { text: 'Respostas completas' }), el('b', { text: fmtNum(total.completed) }), el('span', { text: `de ${fmtNum(total.started)} iniciadas` })),
      el('div', { class: 'stat' }, el('small', { text: 'Taxa de conclusão' }), el('b', { text: total.started ? fmtPct(total.completed / total.started) : '—' })),
      el('div', { class: 'stat' }, el('small', { text: 'Visualizações' }), el('b', { text: fmtNum(total.views) })),
      el('div', { class: 'stat' }, el('small', { text: 'No ar agora' }), el('b', { text: fmtNum(live) }), el('span', { text: `de ${fmtNum(forms.length)} formulário${forms.length === 1 ? '' : 's'}` }))),
    forms.length
      ? el('div', { class: 'flist' },
        el('div', { class: 'flist-head' }, el('span', { text: 'Formulário' }), el('span', { text: 'Status' }), el('span', { text: 'Respostas' }), el('span', { text: 'Conclusão' }), el('span')),
        forms.map(row))
      : el('div', { class: 'card empty' }, icon('file', 32), el('h3', { text: 'Nenhum formulário ainda' }), el('p', { text: 'Crie o primeiro e publique em minutos.' }),
        el('button', { class: 'btn accent', onclick: create }, icon('plus'), 'Novo formulário')))));
}

/* ---------- router ---------- */

async function route() {
  cleanup?.(); cleanup = null; // stop the previous view's timers/listeners before drawing the next
  document.querySelectorAll('.pop, .menu').forEach(n => n.remove());
  let me;
  try { me = await api('GET', '/me'); } catch { return loginView(true); }
  if (!me.autenticado) return loginView(me.configurado);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'config' && parts[1] === 'grupos' && parts[2]) return await renderGroup(parts[2], { mount, shell, setCleanup });
    if (parts[0] === 'config') return await renderSettings({ mount, shell });
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
