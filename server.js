const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.APP_PASSWORD || 'marie2025';

// ── Base de données SQLite ──────────────────────────────
const dbPath = process.env.DB_PATH || './data/marie.db';
const dbDir  = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    client TEXT NOT NULL,
    arr TEXT,
    dep TEXT,
    type TEXT NOT NULL,
    min INTEGER DEFAULT 0,
    note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS conges (
    wk TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS semtype (
    day INTEGER NOT NULL,
    pos INTEGER NOT NULL,
    client TEXT NOT NULL,
    type TEXT NOT NULL,
    PRIMARY KEY (day, pos)
  );
  CREATE TABLE IF NOT EXISTS clients (
    name TEXT PRIMARY KEY
  );
`);

// ── Middleware ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'marie-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 jours
}));

// ── Auth middleware ─────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.auth) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ── Login ───────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASS) {
    req.session.auth = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ auth: !!(req.session && req.session.auth) });
});

// ── API Entries ─────────────────────────────────────────
app.get('/api/entries', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM entries ORDER BY date, arr').all();
  res.json(rows);
});

app.post('/api/entries', requireAuth, (req, res) => {
  const { id, date, client, arr, dep, type, min, note } = req.body;
  db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?,?)')
    .run(id, date, client, arr||'', dep||'', type, min||0, note||'');
  res.json({ ok: true });
});

app.delete('/api/entries/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM entries WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Sync complet (remplace tout)
app.post('/api/sync', requireAuth, (req, res) => {
  const { entries, conges, semtype, clients } = req.body;
  const syncEntries  = db.transaction((rows) => {
    db.prepare('DELETE FROM entries').run();
    const ins = db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)');
    (rows||[]).forEach(e => ins.run(e.id, e.date, e.client, e.arr||'', e.dep||'', e.type, e.min||0, e.note||''));
  });
  const syncConges   = db.transaction((rows) => {
    db.prepare('DELETE FROM conges').run();
    const ins = db.prepare('INSERT OR IGNORE INTO conges VALUES (?)');
    (rows||[]).forEach(w => ins.run(w));
  });
  const syncSemtype  = db.transaction((days) => {
    db.prepare('DELETE FROM semtype').run();
    const ins = db.prepare('INSERT INTO semtype VALUES (?,?,?,?)');
    (days||[]).forEach((day, di) => {
      (day||[]).forEach((e, pos) => ins.run(di, pos, e.client, e.type));
    });
  });
  const syncClients  = db.transaction((rows) => {
    db.prepare('DELETE FROM clients').run();
    const ins = db.prepare('INSERT OR IGNORE INTO clients VALUES (?)');
    (rows||[]).forEach(c => ins.run(c));
  });
  syncEntries(entries);
  syncConges(conges);
  syncSemtype(semtype);
  syncClients(clients);
  res.json({ ok: true });
});

// Récupérer toutes les données
app.get('/api/data', requireAuth, (req, res) => {
  const entries = db.prepare('SELECT * FROM entries ORDER BY date, arr').all();
  const conges  = db.prepare('SELECT wk FROM conges').all().map(r => r.wk);
  // Reconstruire semtype[0..6]
  const stRows  = db.prepare('SELECT * FROM semtype ORDER BY day, pos').all();
  const semtype = [[],[],[],[],[],[],[]];
  stRows.forEach(r => { if(semtype[r.day]) semtype[r.day].push({ client:r.client, type:r.type }); });
  const clients = db.prepare('SELECT name FROM clients ORDER BY name').all().map(r => r.name);
  res.json({ entries, conges, semtype, clients });
});

// ── Fichier HTML ────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Démarrage ───────────────────────────────────────────
app.listen(PORT, () => console.log(`Marie Heures démarré sur le port ${PORT}`));
