// The study library: subjects → sections → entries (books, designers, links…), shared by everyone signed in.
import { auth } from './auth.js';

const $ = (s, r = document) => r.querySelector(s);
const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg>';
const ARROW = '<svg class="lib-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

const ERRORS = {
  bad_name: 'Give it a name.',
  bad_url: 'That link does not look right. Use a full web address, like https://example.com.',
  not_yours: 'Only the person who added this can change it.',
  not_found: 'It is no longer there. Reload the page.',
  not_signed_in: 'Your session expired. Please sign in again.',
  network: 'Cannot reach the server. Try again.',
};
const say = (err) => ERRORS[err.code] || 'Something went wrong. Try again.';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export function createLibrary(page, { toast, onHome }) {
  const tabsEl = $('[data-lib-tabs]', page);
  const bodyEl = $('[data-lib-body]', page);
  const search = $('[data-lib-search]', page);
  const itemDialog = $('#lib-item-dialog');
  const itemForm = $('#lib-item-form');
  const nameDialog = $('#lib-name-dialog');
  const nameForm = $('#lib-name-form');

  let data = null; // { subjects: [{ id, name, canEdit, sections: [{ id, name, canEdit, items: [...] }] }] }
  let loading = false;
  let failed = false;
  let subjectId = '';
  try { subjectId = localStorage.getItem('tubus.library.subject') || ''; } catch {}

  const current = () => data?.subjects.find((s) => s.id === subjectId) || data?.subjects[0] || null;

  // --- Talking to the server ------------------------------------------------------------
  async function load() {
    if (loading) return;
    loading = true;
    failed = false;
    if (!data) render();
    try {
      data = await auth.call('/materials');
    } catch (err) {
      if (!data) failed = true;
      else toast(say(err), 'error');
    } finally {
      loading = false;
    }
    render();
  }

  /** Sends a change; the server answers with the whole library, which replaces ours. */
  async function change(method, path, body) {
    data = await auth.call(`/materials${path}`, { method, body });
  }

  // --- Drawing ----------------------------------------------------------------------------
  function iconButton(label, html, onClick, cls = '') {
    const b = el('button', `icon-btn lib-icon ${cls}`.trim());
    b.type = 'button';
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderTabs() {
    tabsEl.replaceChildren();
    if (!data) return;
    const shown = current();
    const searching = !!search.value.trim();
    for (const s of data.subjects) {
      const b = el('button', 'lib-tab', s.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', !searching && s.id === shown?.id);
      b.addEventListener('click', () => {
        subjectId = s.id;
        try { localStorage.setItem('tubus.library.subject', s.id); } catch {}
        search.value = '';
        render();
      });
      tabsEl.append(b);
    }
    const add = el('button', 'lib-tab lib-tab--add');
    add.type = 'button';
    add.innerHTML = `${PLUS}<span>Subject</span>`;
    add.setAttribute('aria-label', 'Add a subject');
    add.addEventListener('click', () => openName({ kind: 'subjects' }));
    tabsEl.append(add);
    if (shown?.canEdit && !searching) tabsEl.append(iconButton('Rename or delete this subject', PENCIL, () => openName({ kind: 'subjects', row: shown }), 'lib-tab-edit'));
  }

  function itemRow(item, section) {
    const li = el('li', 'lib-item');
    const text = el('div', 'lib-item-text');
    const head = el('div', 'lib-item-head');
    if (item.url) {
      const a = el('a', 'lib-item-title', item.title);
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.insertAdjacentHTML('beforeend', ARROW);
      head.append(a);
    } else {
      head.append(el('span', 'lib-item-title', item.title));
    }
    if (item.planned) head.append(el('span', 'lib-planned', 'Planned'));
    text.append(head);
    if (item.note) text.append(el('div', 'lib-item-note dim', item.note));
    li.title = `Added by ${item.by}`;
    li.append(text);
    if (item.canEdit) li.append(iconButton(`Edit ${item.title}`, PENCIL, () => openItem({ section, row: item })));
    return li;
  }

  function sectionBlock(section, { items = section.items, subjectName = '' } = {}) {
    const box = el('section', 'lib-section');
    const head = el('header', 'lib-section-head');
    const title = el('h2');
    title.append(el('span', 'lib-section-name', section.name), el('span', 'count', items.length));
    head.append(title);
    const actions = el('div', 'lib-section-actions');
    if (!subjectName) {
      if (section.canEdit) actions.append(iconButton(`Rename or delete ${section.name}`, PENCIL, () => openName({ kind: 'sections', row: section })));
      actions.append(iconButton(`Add to ${section.name}`, PLUS, () => openItem({ section })));
    }
    head.append(actions);
    box.append(head);
    if (subjectName) box.append(el('p', 'lib-section-from dim', subjectName));
    if (items.length) {
      const list = el('ul', 'lib-list');
      list.append(...items.map((item) => itemRow(item, section)));
      box.append(list);
    } else {
      const empty = el('button', 'lib-section-empty dim', 'Nothing here yet. Add the first one.');
      empty.type = 'button';
      empty.addEventListener('click', () => openItem({ section }));
      box.append(empty);
    }
    return box;
  }

  function message(text, actionLabel, onAction) {
    const wrap = el('div', 'lib-message');
    wrap.append(el('p', 'dim', text));
    if (actionLabel) {
      const b = el('button', 'chip chip-solid', actionLabel);
      b.type = 'button';
      b.addEventListener('click', onAction);
      wrap.append(b);
    }
    return wrap;
  }

  function renderBody() {
    bodyEl.replaceChildren();
    if (!data) {
      bodyEl.append(failed ? message('The library could not be loaded.', 'Try again', load) : message('Loading…'));
      return;
    }
    const q = norm(search.value.trim());
    if (q) {
      // Across every subject: an entry matches on its title or note, or all of a section matches on its name.
      const cols = el('div', 'lib-cols');
      for (const subject of data.subjects) {
        for (const section of subject.sections) {
          const whole = norm(`${section.name} ${subject.name}`).includes(q);
          const items = whole ? section.items : section.items.filter((i) => norm(`${i.title} ${i.note}`).includes(q));
          if (items.length) cols.append(sectionBlock(section, { items, subjectName: subject.name }));
        }
      }
      bodyEl.append(cols.children.length ? cols : message('Nothing found.'));
      return;
    }
    const subject = current();
    if (!subject) {
      bodyEl.append(message('Nothing here yet. Start with a subject, like the name of a course.', 'Add a subject', () => openName({ kind: 'subjects' })));
      return;
    }
    const cols = el('div', 'lib-cols');
    cols.append(...subject.sections.map((section) => sectionBlock(section)));
    const add = el('button', 'lib-add-section');
    add.type = 'button';
    add.innerHTML = `${PLUS}<span>Add a section</span>`;
    add.addEventListener('click', () => openName({ kind: 'sections', subject }));
    cols.append(add);
    bodyEl.append(cols);
  }

  function render() {
    renderTabs();
    renderBody();
  }

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation(); // clear the search first; a second Escape leaves the page
      search.value = '';
      render();
    }
  });
  $('[data-lib-home]', page).addEventListener('click', () => onHome());

  // --- Dialogs ----------------------------------------------------------------------------
  /** Delete takes two clicks: the first one arms the button. */
  function armable(button, label, run) {
    let armed = false;
    const reset = () => { armed = false; button.textContent = 'Delete'; button.classList.remove('chip-danger'); };
    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.textContent = label;
        button.classList.add('chip-danger');
        return;
      }
      await run();
    });
    return reset;
  }

  // An entry: add (given its section) or edit (given its row).
  let itemCtx = null; // { section, row? }
  const itemError = $('[data-lib-item-error]', itemDialog);
  const itemSubmit = $('[data-lib-item-submit]', itemDialog);
  const itemDelete = $('[data-lib-item-delete]', itemDialog);
  const resetItemDelete = armable(itemDelete, 'Click again to delete', async () => {
    itemDelete.disabled = true;
    try {
      await change('DELETE', `/items/${itemCtx.row.id}`);
      itemDialog.close();
      render();
    } catch (err) {
      itemError.textContent = say(err);
    } finally {
      itemDelete.disabled = false;
    }
  });

  function openItem(ctx) {
    itemCtx = ctx;
    const row = ctx.row;
    $('#lib-item-title').textContent = row ? 'Edit entry' : `Add to ${ctx.section.name}`;
    itemForm.reset();
    if (row) {
      itemForm.elements.title.value = row.title;
      itemForm.elements.note.value = row.note;
      itemForm.elements.url.value = row.url || '';
      itemForm.elements.planned.checked = row.planned;
    }
    itemDelete.hidden = !row;
    resetItemDelete();
    itemError.textContent = '';
    itemDialog.showModal();
    itemForm.elements.title.focus({ preventScroll: true });
  }

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = itemForm.elements;
    const body = { title: f.title.value, note: f.note.value, url: f.url.value, planned: f.planned.checked };
    itemError.textContent = '';
    itemSubmit.disabled = true;
    try {
      if (itemCtx.row) await change('PATCH', `/items/${itemCtx.row.id}`, body);
      else await change('POST', '/items', { ...body, sectionId: itemCtx.section.id });
      itemDialog.close();
      render();
    } catch (err) {
      itemError.textContent = say(err);
    } finally {
      itemSubmit.disabled = false;
    }
  });

  // A subject or a section: add (a section is given its subject) or rename (given its row).
  let nameCtx = null; // { kind: 'subjects' | 'sections', row?, subject? }
  const nameError = $('[data-lib-name-error]', nameDialog);
  const nameSubmit = $('[data-lib-name-submit]', nameDialog);
  const nameDelete = $('[data-lib-name-delete]', nameDialog);
  const resetNameDelete = armable(nameDelete, 'Delete with everything inside', async () => {
    nameDelete.disabled = true;
    try {
      await change('DELETE', `/${nameCtx.kind}/${nameCtx.row.id}`);
      nameDialog.close();
      render();
    } catch (err) {
      nameError.textContent = say(err);
    } finally {
      nameDelete.disabled = false;
    }
  });

  function openName(ctx) {
    nameCtx = ctx;
    const one = ctx.kind === 'subjects' ? 'subject' : 'section';
    $('#lib-name-title').textContent = ctx.row ? `Rename ${one}` : `New ${one}`;
    nameForm.reset();
    nameForm.elements.name.value = ctx.row?.name || '';
    nameDelete.hidden = !ctx.row;
    resetNameDelete();
    nameError.textContent = '';
    nameDialog.showModal();
    nameForm.elements.name.focus({ preventScroll: true });
    nameForm.elements.name.select();
  }

  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameForm.elements.name.value;
    nameError.textContent = '';
    nameSubmit.disabled = true;
    try {
      if (nameCtx.row) {
        await change('PATCH', `/${nameCtx.kind}/${nameCtx.row.id}`, { name });
      } else if (nameCtx.kind === 'subjects') {
        const before = new Set((data?.subjects || []).map((s) => s.id));
        await change('POST', '/subjects', { name });
        const made = data.subjects.find((s) => !before.has(s.id));
        if (made) {
          subjectId = made.id;
          try { localStorage.setItem('tubus.library.subject', made.id); } catch {}
          search.value = '';
        }
      } else {
        await change('POST', '/sections', { name, subjectId: nameCtx.subject.id });
      }
      nameDialog.close();
      render();
    } catch (err) {
      nameError.textContent = say(err);
    } finally {
      nameSubmit.disabled = false;
    }
  });

  return {
    /** Shows what we have at once and brings it up to date. */
    open() {
      render();
      load();
    },
    /** Forget everything (someone signed out). */
    clear() {
      data = null;
      search.value = '';
      render();
    },
  };
}
