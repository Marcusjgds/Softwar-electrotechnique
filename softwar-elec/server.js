const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── CONFIG ──
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ── MIDDLEWARE ──
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'softwar_elec_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

// Upload config
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── IN-MEMORY DATA (remplacer par une DB en prod) ──
const users = new Map();
const channels = { général: [], cours: [], annonces: [] };
const privateChats = new Map();
const pinnedHomework = new Map(); // channelName -> hw object

// Compte admin par défaut
const adminId = 'admin-default';
users.set(adminId, {
  id: adminId,
  username: 'Admin',
  password: bcrypt.hashSync('Admin1234!', 10),
  avatar: null,
  roles: ['admin', 'professeur', 'premium'],
  online: false,
  createdAt: new Date()
});

// Message système de bienvenue
channels['général'].push({
  id: uuidv4(),
  userId: adminId,
  username: 'Admin',
  userRoles: ['admin','professeur'],
  text: '👋 Bienvenue sur Softwar Elec ! Commencez à discuter ici.',
  type: 'text',
  ts: new Date().toISOString(),
  gold: true
});

// ── WEBSOCKET MAP ──
const clients = new Map(); // ws -> { userId, username }

// ══════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════

// Inscription
app.post('/api/register', upload.single('avatar'), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Champs requis' });
    if (password.length < 6) return res.json({ ok: false, error: 'Mot de passe trop court (min 6)' });

    // Check username taken
    for (const [, u] of users) {
      if (u.username.toLowerCase() === username.toLowerCase())
        return res.json({ ok: false, error: 'Nom d\'utilisateur déjà pris' });
    }

    const id = uuidv4();
    const hashedPw = await bcrypt.hash(password, 10);
    let avatarUrl = null;
    if (req.file) avatarUrl = '/uploads/' + req.file.filename;

    const newUser = {
      id, username, password: hashedPw, avatar: avatarUrl,
      roles: ['eleve'], online: true, createdAt: new Date()
    };
    users.set(id, newUser);
    req.session.userId = id;

    broadcast({ type: 'user_joined', userId: id, username, avatar: avatarUrl, roles: ['eleve'] });
    res.json({ ok: true, user: safeUser(newUser) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Connexion
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  let found = null;
  for (const [, u] of users) {
    if (u.username.toLowerCase() === username.toLowerCase()) { found = u; break; }
  }
  if (!found) return res.json({ ok: false, error: 'Utilisateur introuvable' });
  const ok = await bcrypt.compare(password, found.password);
  if (!ok) return res.json({ ok: false, error: 'Mot de passe incorrect' });
  found.online = true;
  req.session.userId = found.id;
  broadcast({ type: 'user_online', userId: found.id, online: true });
  res.json({ ok: true, user: safeUser(found) });
});

// Déconnexion
app.post('/api/logout', (req, res) => {
  const uid = req.session.userId;
  if (uid) {
    const u = users.get(uid);
    if (u) { u.online = false; broadcast({ type: 'user_online', userId: uid, online: false }); }
  }
  req.session.destroy();
  res.json({ ok: true });
});

// Me
app.get('/api/me', (req, res) => {
  const u = users.get(req.session.userId);
  if (!u) return res.json({ ok: false });
  res.json({ ok: true, user: safeUser(u) });
});

// ══════════════════════════════════════
//  USERS
// ══════════════════════════════════════
app.get('/api/users', requireAuth, (req, res) => {
  const list = [];
  for (const [, u] of users) list.push(safeUser(u));
  res.json(list);
});

// ══════════════════════════════════════
//  CHANNELS & MESSAGES
// ══════════════════════════════════════
app.get('/api/messages/:channel', requireAuth, (req, res) => {
  const ch = req.params.channel;
  const uid = req.session.userId;
  if (ch.startsWith('dm_')) {
    // Vérifier que l'utilisateur fait partie du DM
    const parts = ch.replace('dm_','').split('_');
    if (!parts.includes(uid)) return res.json([]);
    return res.json(privateChats.get(ch) || []);
  }
  if (!channels[ch]) return res.json([]);
  res.json(channels[ch]);
});

app.get('/api/homework/:channel', requireAuth, (req, res) => {
  const hw = pinnedHomework.get(req.params.channel);
  res.json(hw || null);
});

// Upload fichier (image/vidéo)
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ ok: false });
  res.json({ ok: true, url: '/uploads/' + req.file.filename, mimetype: req.file.mimetype });
});

// Upload avatar
app.post('/api/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  const u = users.get(req.session.userId);
  if (!u || !req.file) return res.json({ ok: false });
  u.avatar = '/uploads/' + req.file.filename;
  broadcast({ type: 'user_update', userId: u.id, avatar: u.avatar });
  res.json({ ok: true, avatar: u.avatar });
});

// ══════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const list = [];
  for (const [, u] of users) list.push({ ...safeUser(u), passwordHash: u.password.substring(0,20)+'...' });
  res.json(list);
});

app.post('/api/admin/roles', requireAuth, requireAdmin, (req, res) => {
  const { userId, roles } = req.body;
  const u = users.get(userId);
  if (!u) return res.json({ ok: false });
  u.roles = roles;
  broadcast({ type: 'user_update', userId, roles });
  res.json({ ok: true });
});

app.delete('/api/admin/user/:id', requireAuth, requireAdmin, (req, res) => {
  users.delete(req.params.id);
  broadcast({ type: 'user_deleted', userId: req.params.id });
  res.json({ ok: true });
});

app.post('/api/admin/announce', requireAuth, requireAdmin, (req, res) => {
  const { text } = req.body;
  const u = users.get(req.session.userId);
  const msg = {
    id: uuidv4(), userId: u.id, username: u.username,
    userRoles: u.roles, text: `📢 ANNONCE OFFICIELLE : ${text}`,
    type: 'text', ts: new Date().toISOString(), gold: true, announce: true
  };
  ['général','cours','annonces'].forEach(ch => {
    channels[ch].push(msg);
  });
  broadcast({ type: 'announce', message: msg, text });
  res.json({ ok: true });
});

// ══════════════════════════════════════
//  IA CLAUDE
// ══════════════════════════════════════
app.post('/api/ai', requireAuth, async (req, res) => {
  if (!anthropic) {
    return res.json({ ok: false, error: 'Clé API Anthropic non configurée. Ajoutez ANTHROPIC_API_KEY dans les variables d\'environnement Render.' });
  }
  const { message, history } = req.body;
  try {
    const messages = (history || []).slice(-10).map(m => ({
      role: m.role, content: m.content
    }));
    messages.push({ role: 'user', content: message });

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: 'Tu es une IA assistante intégrée à Softwar Elec, une plateforme éducative. Tu aides les élèves et professeurs avec leurs questions scolaires, expliques des concepts, et fournis de l\'aide pédagogique. Réponds toujours en français, de façon claire et bienveillante.',
      messages
    });
    res.json({ ok: true, reply: response.content[0].text });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════════
wss.on('connection', (ws, req) => {
  // Récupérer session via cookie (simplification)
  ws.id = uuidv4();
  clients.set(ws, { userId: null, username: null });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {
      case 'auth': {
        const u = users.get(data.userId);
        if (u) {
          clients.set(ws, { userId: u.id, username: u.username });
          ws.userId = u.id;
          u.online = true;
          broadcast({ type: 'user_online', userId: u.id, online: true });
        }
        break;
      }
      case 'message': {
        const info = clients.get(ws);
        if (!info?.userId) return;
        const u = users.get(info.userId);
        if (!u) return;

        const msg = {
          id: uuidv4(),
          userId: u.id,
          username: u.username,
          userAvatar: u.avatar,
          userRoles: u.roles,
          text: data.text || '',
          type: data.msgType || 'text',
          src: data.src || null,
          dur: data.dur || null,
          ts: new Date().toISOString(),
          gold: u.roles.includes('professeur') || u.roles.includes('admin'),
          channel: data.channel
        };

        // Stocker
        if (data.channel.startsWith('dm_')) {
          if (!privateChats.has(data.channel)) privateChats.set(data.channel, []);
          privateChats.get(data.channel).push(msg);
        } else if (channels[data.channel]) {
          channels[data.channel].push(msg);
          // Garder max 500 msgs
          if (channels[data.channel].length > 500) channels[data.channel].shift();
        }

        // Diffuser
        broadcast({ type: 'message', message: msg, channel: data.channel });
        break;
      }
      case 'homework': {
        const info = clients.get(ws);
        if (!info?.userId) return;
        const u = users.get(info.userId);
        if (!u || (!u.roles.includes('professeur') && !u.roles.includes('admin'))) return;

        const hw = {
          ...data.homework,
          authorId: u.id,
          authorName: u.username,
          publishedAt: new Date().toISOString()
        };
        pinnedHomework.set(data.channel, hw);
        broadcast({ type: 'homework', homework: hw, channel: data.channel });
        break;
      }
      case 'typing': {
        const info = clients.get(ws);
        if (!info?.userId) return;
        broadcastExcept(ws, { type: 'typing', userId: info.userId, username: info.username, channel: data.channel });
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info?.userId) {
      const u = users.get(info.userId);
      if (u) {
        u.online = false;
        broadcast({ type: 'user_online', userId: info.userId, online: false });
      }
    }
    clients.delete(ws);
  });
});

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}
function broadcastExcept(exclude, data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c !== exclude && c.readyState === WebSocket.OPEN) c.send(str); });
}

// ══════════════════════════════════════
//  MIDDLEWARES
// ══════════════════════════════════════
function requireAuth(req, res, next) {
  if (!req.session.userId || !users.has(req.session.userId))
    return res.status(401).json({ ok: false, error: 'Non connecté' });
  next();
}
function requireAdmin(req, res, next) {
  const u = users.get(req.session.userId);
  if (!u || !u.roles.includes('admin')) return res.status(403).json({ ok: false, error: 'Admin requis' });
  next();
}
function safeUser(u) {
  return { id: u.id, username: u.username, avatar: u.avatar, roles: u.roles, online: u.online, createdAt: u.createdAt };
}

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`🚀 Softwar Elec démarré sur http://localhost:${PORT}`));
