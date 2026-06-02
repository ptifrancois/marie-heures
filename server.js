const express  = require('express');
const session  = require('express-session');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.APP_PASSWORD || 'marie2025';

// ── Base de données SQLite ──────────────────────────────
// Railway Volume DOIT être monté sur /data dans les settings
function resolveDbPath() {
  const candidates = [
    process.env.DB_PATH,          // variable explicite si définie
    '/data/marie.db',             // Railway Volume monté sur /data
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      // Test écriture réel
      const test = path.join(dir, '.writetest');
      fs.writeFileSync(test, 'ok');
      fs.unlinkSync(test);
      console.log(`✅ DB path retenu : ${p}`);
      return p;
    } catch(e) {
      console.warn(`⚠️  ${p} non accessible : ${e.message}`);
    }
  }
  // Dernier recours — éphémère
  console.warn('❌ AUCUN volume accessible — DB en /tmp (données perdues au redémarrage)');
  console.warn('   → Créez un Volume Railway monté sur /data');
  return '/tmp/marie.db';
}

const dbPath = resolveDbPath();
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    client TEXT NOT NULL,
    arr TEXT DEFAULT '',
    dep TEXT DEFAULT '',
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

console.log('Base initialisée :', dbPath);

// ── Middleware ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'marie-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.auth) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ── Auth ────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  if (req.body.password === PASS) {
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

// ── Données ─────────────────────────────────────────────
app.get('/api/data', requireAuth, (req, res) => {
  const entries = db.prepare('SELECT * FROM entries ORDER BY date, arr').all();
  const conges  = db.prepare('SELECT wk FROM conges ORDER BY wk').all().map(r => r.wk);
  const stRows  = db.prepare('SELECT * FROM semtype ORDER BY day, pos').all();
  const semtype = [[],[],[],[],[],[],[]];
  stRows.forEach(r => { if (semtype[r.day]) semtype[r.day].push({ client: r.client, type: r.type }); });
  const clients = db.prepare('SELECT name FROM clients ORDER BY name').all().map(r => r.name);
  res.json({ entries, conges, semtype, clients });
});

app.post('/api/sync', requireAuth, (req, res) => {
  const { entries = [], conges = [], semtype = [], clients = [] } = req.body;
  db.transaction(() => {
    db.prepare('DELETE FROM entries').run();
    const insE = db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)');
    entries.forEach(e => insE.run(e.id, e.date, e.client, e.arr||'', e.dep||'', e.type, e.min||0, e.note||''));

    db.prepare('DELETE FROM conges').run();
    const insC = db.prepare('INSERT OR IGNORE INTO conges VALUES (?)');
    conges.forEach(w => insC.run(w));

    db.prepare('DELETE FROM semtype').run();
    const insS = db.prepare('INSERT INTO semtype VALUES (?,?,?,?)');
    semtype.forEach((day, di) => (day||[]).forEach((e, pos) => insS.run(di, pos, e.client, e.type)));

    db.prepare('DELETE FROM clients').run();
    const insCl = db.prepare('INSERT OR IGNORE INTO clients VALUES (?)');
    clients.forEach(c => insCl.run(c));
  })();

  res.json({ ok: true });
});

// ── Health ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) as n FROM entries').get().n;
  const persistent = dbPath.startsWith('/data');
  res.json({
    ok: true,
    db: dbPath,
    persistent,
    warning: persistent ? null : 'Données NON persistantes — montez un Volume sur /data',
    entries: n
  });
});

// ── HTML ────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => console.log(`Démarré sur le port ${PORT} — DB: ${dbPath}`));
