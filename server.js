const express  = require('express');
const session  = require('express-session');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.APP_PASSWORD || 'marie2025';

// ── Base de données SQLite ──────────────────────────────
// Railway Volume : monter sur /data dans les settings Railway
// DB_PATH doit pointer vers /data/marie.db
// Si pas de volume, fallback sur /tmp (perdu au redémarrage mais au moins ça tourne)
function resolveDbPath() {
  // 1. Variable d'environnement explicite
  if (process.env.DB_PATH) {
    const dir = path.dirname(process.env.DB_PATH);
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Test d'écriture
      const testFile = path.join(dir, '.write_test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      console.log(`DB path: ${process.env.DB_PATH}`);
      return process.env.DB_PATH;
    } catch(e) {
      console.warn(`DB_PATH ${process.env.DB_PATH} non accessible: ${e.message}`);
    }
  }
  // 2. /data (Railway Volume monté automatiquement)
  const dataPath = '/data/marie.db';
  try {
    fs.mkdirSync('/data', { recursive: true });
    const testFile = '/data/.write_test';
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    console.log(`DB path: ${dataPath} (volume /data)`);
    return dataPath;
  } catch(e) {
    console.warn(`/data non accessible: ${e.message}`);
  }
  // 3. Fallback /tmp (éphémère mais fonctionnel)
  console.warn('ATTENTION: DB en /tmp, données perdues au redémarrage !');
  console.warn('Configurez un Volume Railway monté sur /data');
  return '/tmp/marie.db';
}

const dbPath = resolveDbPath();
const db = new Database(dbPath);

// WAL mode = meilleure fiabilité + performances
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

console.log('Base de données initialisée:', dbPath);

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

// Sync complet (remplace tout d'un coup)
app.post('/api/sync', requireAuth, (req, res) => {
  const { entries = [], conges = [], semtype = [], clients = [] } = req.body;

  db.transaction(() => {
    // Entries
    db.prepare('DELETE FROM entries').run();
    const insEntry = db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)');
    entries.forEach(e => insEntry.run(
      e.id, e.date, e.client, e.arr||'', e.dep||'', e.type, e.min||0, e.note||''
    ));

    // Congés
    db.prepare('DELETE FROM conges').run();
    const insCg = db.prepare('INSERT OR IGNORE INTO conges VALUES (?)');
    conges.forEach(w => insCg.run(w));

    // Semaine type
    db.prepare('DELETE FROM semtype').run();
    const insSt = db.prepare('INSERT INTO semtype VALUES (?,?,?,?)');
    semtype.forEach((day, di) => {
      (day||[]).forEach((e, pos) => insSt.run(di, pos, e.client, e.type));
    });

    // Clients
    db.prepare('DELETE FROM clients').run();
    const insCl = db.prepare('INSERT OR IGNORE INTO clients VALUES (?)');
    clients.forEach(c => insCl.run(c));
  })();

  res.json({ ok: true, counts: {
    entries: entries.length,
    conges: conges.length,
    clients: clients.length
  }});
});

// Health check (utile pour Railway)
app.get('/health', (req, res) => {
  res.json({ ok: true, db: dbPath, entries: db.prepare('SELECT COUNT(*) as n FROM entries').get().n });
});

// ── Fichier HTML ────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Démarrage ───────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Marie Heures démarré sur le port ${PORT}`);
  console.log(`Base de données: ${dbPath}`);
});
