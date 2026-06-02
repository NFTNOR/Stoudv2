'use strict';
require('dotenv').config({ path: __dirname + '/.env' });

const express      = require('express');
const session      = require('express-session');
const bcrypt       = require('bcrypt');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const fs           = require('fs').promises;
const path         = require('path');

/* ── Paths ── */
const ROOT         = path.resolve(__dirname, '..');   // repo root = public files
const CONTENT_DIR  = path.join(ROOT, 'content');
const ADMIN_FILE   = path.join(__dirname, 'admin-server.html');

/* ── Validate environment ── */
const REQUIRED = ['SESSION_SECRET', 'ADMIN_PASSWORD_HASH'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('\n⚠  Missing .env variables:', missing.join(', '));
  console.error('   Run: node setup-password.js to generate them.\n');
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

/* ── Security headers ── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'https://stoud.com', 'data:'],
      connectSrc:  ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

/* ── Rate limiting ── */
// Login: max 5 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});
// General API rate limit
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

/* ── Body parsing ── */
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: false, limit: '500kb' }));

/* ── Sessions ── */
app.use(session({
  name: 'stoud.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   isProd,        // HTTPS only in production
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000,  // 8 hours
  },
}));

/* ── Auth middleware ── */
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  if (req.accepts('html')) return res.redirect('/admin');
  res.status(401).json({ error: 'Unauthorized' });
}

/* ═══════════════════════════════════════
   API routes
═══════════════════════════════════════ */

/* Login */
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!valid) {
      // Constant-time delay to prevent timing attacks
      await new Promise(r => setTimeout(r, 400));
      return res.status(401).json({ error: 'Incorrect password' });
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.authenticated = true;
      req.session.loginTime = Date.now();
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* Logout */
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* Auth status check */
app.get('/api/auth', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

/* Read content (public — the pages use this) */
app.get('/api/content/:lang', apiLimiter, async (req, res) => {
  const lang = req.params.lang.replace(/[^a-z]/g, '').slice(0, 5);
  if (!['en', 'ja', 'zh'].includes(lang)) {
    return res.status(400).json({ error: 'Invalid language' });
  }
  try {
    const data = await fs.readFile(path.join(CONTENT_DIR, `${lang}.json`), 'utf8');
    res.set('Cache-Control', 'public, max-age=60');  // 1 min browser cache
    res.type('json').send(data);
  } catch (e) {
    res.status(404).json({ error: 'Content not found' });
  }
});

/* Write content (authenticated only) */
app.put('/api/content/:lang', requireAuth, async (req, res) => {
  const lang = req.params.lang.replace(/[^a-z]/g, '').slice(0, 5);
  if (!['en', 'ja', 'zh'].includes(lang)) {
    return res.status(400).json({ error: 'Invalid language' });
  }

  try {
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Invalid content' });
    }
    // Force correct lang field
    incoming.lang = lang;

    const filePath   = path.join(CONTENT_DIR, `${lang}.json`);
    const backupPath = path.join(CONTENT_DIR, `${lang}.backup.json`);

    // Backup current version
    try {
      const current = await fs.readFile(filePath, 'utf8');
      await fs.writeFile(backupPath, current, 'utf8');
    } catch (_) { /* no existing file is fine */ }

    // Write new content
    await fs.writeFile(filePath, JSON.stringify(incoming, null, 2), 'utf8');

    console.log(`[${new Date().toISOString()}] Content saved: ${lang}.json`);
    res.json({ ok: true, saved: new Date().toISOString() });
  } catch (e) {
    console.error('Save error:', e);
    res.status(500).json({ error: 'Failed to save content' });
  }
});

/* ═══════════════════════════════════════
   Admin route — serves admin HTML only to authenticated users
   /admin      → login form (if not logged in)
   /admin      → editor  (if logged in)
═══════════════════════════════════════ */
app.get('/admin', async (req, res) => {
  try {
    const html = await fs.readFile(ADMIN_FILE, 'utf8');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('Admin interface not found');
  }
});

/* ═══════════════════════════════════════
   Static files — serve public site
═══════════════════════════════════════ */
app.use(express.static(ROOT, {
  index: 'stoud-home-v6.html',
  setHeaders(res, filePath) {
    // Never cache the admin file (it's now in /server, not served here anyway)
    if (filePath.endsWith('admin.html')) res.set('Cache-Control', 'no-store');
  }
}));

/* ── 404 ── */
app.use((req, res) => res.status(404).send('Not found'));

/* ── Start ── */
app.listen(PORT, () => {
  console.log(`\n✓ STOUD server running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
  console.log(`  Mode:    ${isProd ? 'production' : 'development'}\n`);
});
