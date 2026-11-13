'use strict';
// SQLite storage (node:sqlite, built into Node >= 22.13: no dependencies, one file to back up).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { normalize } = require('./schema');

function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS forms(
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', schema TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS responses(
      id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      answers TEXT NOT NULL DEFAULT '{}', meta TEXT NOT NULL DEFAULT '{}', last_qid TEXT);
    CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id, started_at);
    CREATE TABLE IF NOT EXISTS views(
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE, day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(form_id, day));
    CREATE TABLE IF NOT EXISTS webhook_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT, form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      response_id TEXT, question_id TEXT, event TEXT NOT NULL, url TEXT NOT NULL,
      status INTEGER, ok INTEGER NOT NULL, error TEXT, duration_ms INTEGER, attempt INTEGER,
      at TEXT NOT NULL, payload TEXT);
    CREATE INDEX IF NOT EXISTS webhook_logs_form ON webhook_logs(form_id, id DESC);
  `);

  // forms.opened_at: when the form was first published. After that, question types are locked.
  if (!db.prepare('PRAGMA table_info(forms)').all().some(c => c.name === 'opened_at')) db.exec('ALTER TABLE forms ADD COLUMN opened_at TEXT');

  const p = sql => db.prepare(sql);
  const formRow = r => r && { ...r, schema: normalize(JSON.parse(r.schema)) };
  const respRow = r => r && { ...r, answers: JSON.parse(r.answers), meta: JSON.parse(r.meta) };
  const like = s => `%${s.replace(/[\\%_]/g, m => `\\${m}`)}%`;

  const st = {
    listForms: p(`SELECT f.id, f.slug, f.title, f.status, f.created_at, f.updated_at, f.opened_at, f.schema,
        (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS started,
        (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.completed_at IS NOT NULL) AS completed,
        (SELECT COALESCE(SUM(count),0) FROM views v WHERE v.form_id = f.id) AS views
      FROM forms f ORDER BY f.updated_at DESC`),
    getForm: p('SELECT * FROM forms WHERE id = ?'),
    getFormBySlug: p('SELECT * FROM forms WHERE slug = ?'),
    slugOwner: p('SELECT id FROM forms WHERE slug = ?'),
    insertForm: p('INSERT INTO forms(id,slug,title,status,schema,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'),
    updateForm: p("UPDATE forms SET slug=?, title=?, status=?, schema=?, updated_at=?, opened_at = CASE WHEN ? != 'draft' THEN COALESCE(opened_at, ?) ELSE opened_at END WHERE id=?"),
    deleteForm: p('DELETE FROM forms WHERE id = ?'),
    getResponse: p('SELECT * FROM responses WHERE id = ? AND form_id = ?'),
    getResponseById: p('SELECT * FROM responses WHERE id = ?'),
    insertResponse: p('INSERT INTO responses(id,form_id,started_at,updated_at,answers,meta,last_qid) VALUES(?,?,?,?,?,?,?)'),
    updateResponse: p('UPDATE responses SET updated_at=?, completed_at=?, answers=?, meta=?, last_qid=? WHERE id=?'),
    deleteResponse: p('DELETE FROM responses WHERE id = ? AND form_id = ?'),
    addView: p(`INSERT INTO views(form_id,day,count) VALUES(?,?,1) ON CONFLICT(form_id,day) DO UPDATE SET count = count + 1`),
    viewsByDay: p('SELECT day, count FROM views WHERE form_id = ? AND day >= ?'),
    insertLog: p(`INSERT INTO webhook_logs(form_id,response_id,question_id,event,url,status,ok,error,duration_ms,attempt,at,payload)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`),
    getLog: p('SELECT * FROM webhook_logs WHERE id = ? AND form_id = ?'),
    pruneLogs: p(`DELETE FROM webhook_logs WHERE id IN (SELECT id FROM webhook_logs WHERE form_id = ? ORDER BY id DESC LIMIT -1 OFFSET 500)`)
  };

  return {
    db,
    listForms: () => st.listForms.all().map(({ schema, ...f }) => ({ ...f, agenda: JSON.parse(schema).agenda || { abre_em: '', fecha_em: '' } })),
    getForm: id => formRow(st.getForm.get(id)),
    getFormBySlug: slug => formRow(st.getFormBySlug.get(slug)),
    slugTaken: (slug, exceptId) => { const r = st.slugOwner.get(slug); return !!r && r.id !== exceptId; },
    createForm: f => {
      const now = new Date().toISOString();
      st.insertForm.run(f.id, f.slug, f.title, f.status || 'draft', JSON.stringify(f.schema), now, now);
      return f.id;
    },
    updateForm: (id, f) => { const now = new Date().toISOString(); st.updateForm.run(f.slug, f.title, f.status, JSON.stringify(f.schema), now, f.status, now, id); },
    deleteForm: id => st.deleteForm.run(id),

    getResponse: (id, formId) => respRow(st.getResponse.get(id, formId)),
    getResponseById: id => respRow(st.getResponseById.get(id)),
    insertResponse: r => {
      const now = new Date().toISOString();
      st.insertResponse.run(r.id, r.form_id, now, now, JSON.stringify(r.answers), JSON.stringify(r.meta), r.last_qid || null);
    },
    saveResponse: r => st.updateResponse.run(new Date().toISOString(), r.completed_at || null, JSON.stringify(r.answers), JSON.stringify(r.meta), r.last_qid || null, r.id),
    deleteResponse: (id, formId) => st.deleteResponse.run(id, formId),

    // status: 'all' | 'completed' | 'partial'; search matches the raw answers JSON.
    listResponses(formId, { status = 'all', search = '', since = '', limit = 50, offset = 0 } = {}) {
      const where = ['form_id = ?'], args = [formId];
      if (status === 'completed') where.push('completed_at IS NOT NULL');
      if (status === 'partial') where.push('completed_at IS NULL');
      if (since) { where.push('started_at >= ?'); args.push(since); }
      if (search) { where.push(`(answers LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')`); args.push(like(search), like(search)); }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM responses WHERE ${w}`).get(...args).n;
      const rows = db.prepare(`SELECT * FROM responses WHERE ${w} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
      return { total, rows: rows.map(respRow) };
    },
    allResponses(formId, since = '') {
      const rows = since
        ? db.prepare('SELECT * FROM responses WHERE form_id = ? AND started_at >= ? ORDER BY started_at DESC').all(formId, since)
        : db.prepare('SELECT * FROM responses WHERE form_id = ? ORDER BY started_at DESC').all(formId);
      return rows.map(respRow);
    },

    addView: (formId, day) => st.addView.run(formId, day),
    viewsByDay: (formId, sinceDay) => st.viewsByDay.all(formId, sinceDay),

    logWebhook(l) {
      const r = st.insertLog.run(l.form_id, l.response_id || null, l.question_id || null, l.event, l.url, l.status || null, l.ok ? 1 : 0,
        l.error || null, l.duration_ms ?? null, l.attempt ?? 1, new Date().toISOString(), l.payload ? JSON.stringify(l.payload) : null);
      st.pruneLogs.run(l.form_id);
      return Number(r.lastInsertRowid);
    },
    listLogs(formId, { questionId = '', limit = 50 } = {}) {
      const rows = questionId
        ? db.prepare('SELECT * FROM webhook_logs WHERE form_id = ? AND question_id = ? ORDER BY id DESC LIMIT ?').all(formId, questionId, limit)
        : db.prepare('SELECT * FROM webhook_logs WHERE form_id = ? ORDER BY id DESC LIMIT ?').all(formId, limit);
      return rows.map(({ payload, ...r }) => r);
    },
    getLog: (id, formId) => { const r = st.getLog.get(id, formId); return r && { ...r, payload: r.payload ? JSON.parse(r.payload) : null }; }
  };
}

module.exports = { createStore };
