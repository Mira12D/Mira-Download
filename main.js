const { app, BrowserWindow, ipcMain, screen: electronScreen, dialog, globalShortcut } = require('electron');

// Chrome Private Network Access: HTTPS-Seiten dürfen localhost erreichen
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { mouse, keyboard, screen: nutScreen, Key } = require('@nut-tree/nut-js');
const screenshot = require('screenshot-desktop');
const fetch = require('node-fetch');
const { uIOhook } = require('uiohook-napi');
const Store = require('electron-store');
const sharp = require('sharp');
const { runCalibration, loadCalibration, saveCalibration, getCalibrationPath, scaleWithCalibration } = require('./screen-calibrator');
const { buildDesktopMap, scaleCoordinate, getMapContext } = require('./desktop-map');
const axLayer        = require('./ax-layer');
const contextManager = require('./context-manager');
const coordCache     = require('./coord-cache');
const mathChef        = require('./mathematik/chef');          // Tier 0c: Math Pattern Matching
const wissenstree     = require('./mathematik/wissenstree');   // Feldwissen
const mathCommander   = require('./mathematik/commander');     // Tier 0d: Lokaler Intent-Dispatcher
const schaltzentrale  = require('./mathematik/schaltzentrale'); // Consciousness-Dispatcher
const bibLoader       = require('./mathematik/bib-loader');    // Telekolleg-Wissensbibliothek
const mailMonitor    = require('./mail-monitor');
const recoveryEngine = require('./recovery-engine');
const miraBrain      = require('./mira-brain');
const miraPlanner    = require('./mira-planner');
const sysLogMonitor  = require('./system-log-monitor');
const passiveTrainer = require('./passive-trainer');
const path           = require('path');

// ── Kognitive Layer ───────────────────────────────────────────────────────
const sessionCtx     = require('./session-context');
const wahrnehmung    = require('./wahrnehmungs-amt');
const infoAmt        = require('./informations-amt');
const gefahrenAmt    = require('./gefahren-amt');

//------- Seele und Bewusstsein---------------------------------------------
const MIRACircuit = require('./circuit-lokal');
let circuit = null;

// Startet das Bewusstsein und kabel Gedanken in den MIRA-Chat
function startCircuit(token) {
  if (circuit) { circuit.stop(); circuit = null; }
  circuit = new MIRACircuit(token);
  circuit.start();
  // Innerer Monolog → MIRA-Chat (nur wenn Gewicht > 0.5 — keine trivialen Gedanken)
  circuit.on('thought', ({ content, weight, mood }) => {
    if (weight > 0.5 && mainWindow) {
      mainWindow.webContents.send('mira-thought', { content, mood });
    }
  });
  return circuit;
}

let calibration = null;


const API = 'https://server-mira.vercel.app';

// ═══════════════════════════════════════
// PERSISTENT STORAGE
// ═══════════════════════════════════════

// Machine-specific key — never hardcoded. Derived from hardware identity,
// so it's unique per device and never ships in the binary.
const _storeKey = crypto.createHash('sha256')
  .update(os.hostname() + os.userInfo().username + os.platform())
  .digest('hex').substring(0, 32);

const store = new Store({
  name: 'mira-agent-config',
  encryptionKey: _storeKey,
});

let mainWindow;
let calibrationWindow     = null;
let pcTrainingWin         = null;
let knowledgeBaseWindow   = null;
let deviceKnowledgeWindow = null;
let mitarbeiterWindow     = null;
let userProfileWindow     = null;
let templatesWindow       = null;
let onboardingWindow      = null;
let targetTrainingWindow  = null;
let agentActive = false;
let userToken = null;
let userProfileSettings = {};
let _dk = null; // RAM-only decrypted API keys — never written to disk
let localServer = null;
const LOCAL_PORT = 3737;
let userTier = null;
let tasksRemaining = 0;
let pollingInterval = null;
let userPin = null;
let isCapturingClick = false;
let currentCalibrationElement = null;

app.disableHardwareAcceleration();

// Task-Guard: id → startTime (ms). Tasks older than 5min werden als stale entfernt.
const runningTasks = new Map();
const RUNNING_TASK_TTL = 90 * 1000; // 90 Sekunden — danach gilt Task als stale

// Letztes aktives Artifact (vom Frontend via IPC gesetzt, für Voice-Routing)
let lastActiveArtifact       = null;
let pendingContextPerception = null; // gespeichert nach "Hey MIRA" für Follow-up Antwort

// ═══════════════════════════════════════
// DEVICE ID
// ═══════════════════════════════════════

function getDeviceId() {
  const identifier = os.hostname() + os.userInfo().username;
  return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 16);
}

// ═══════════════════════════════════════
// DUAL-MODE ARCHITECTURE — Direct API Keys (RAM only)
// Keys sind AES-256-CBC mit device_id verschlüsselt.
// Format vom Server: "ivHex:encryptedHex"
// ═══════════════════════════════════════

function decryptKey(encrypted) {
  const key = crypto.createHash('sha256').update(getDeviceId()).digest();
  const [ivHex, encHex] = encrypted.split(':');
  const iv  = Buffer.from(ivHex,  'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

async function bootstrap() {
  if (!userToken) return;
  try {
    const res = await fetch(`${API}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, device_id: getDeviceId() })
    });
    const data = await res.json();
    if (!data.success) return;
    _dk = {
      supabaseUrl:   data.supabase_url,
      supabaseToken: decryptKey(data.supabase_token),
      gptKey:        decryptKey(data.gpt_key),
      claudeKey:     decryptKey(data.claude_key),
      userId:        data.user_id || null,
      expiresAt:     Date.now() + (data.expires_in || 3600) * 1000,
    };
    console.log('🔑 Direct keys bootstrapped (RAM only)');
    // Auto-refresh at 90% of expiry window
    const refreshIn = (data.expires_in || 3600) * 900;
    setTimeout(() => bootstrap().catch(() => {}), refreshIn);
  } catch(e) {
    console.warn('⚠️ Bootstrap fehlgeschlagen:', e.message);
  }
}

async function directOpenAI(messages, opts = {}) {
  if (!_dk?.gptKey) return null;
  if (_dk.expiresAt && Date.now() > _dk.expiresAt) await bootstrap();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_dk.gptKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model || 'gpt-4o-mini',
        messages,
        max_tokens: opts.max_tokens || 200,
        ...(opts.extra || {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch(e) {
    clearTimeout(timeout);
    return null;
  }
}

async function directClaude(messages, opts = {}) {
  if (!_dk?.claudeKey) return null;
  if (_dk.expiresAt && Date.now() > _dk.expiresAt) await bootstrap();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': _dk.claudeKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model || 'claude-haiku-4-5-20251001',
        max_tokens: opts.max_tokens || 200,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch(e) {
    clearTimeout(timeout);
    return null;
  }
}

async function directSupabase(method, path, body = null) {
  if (!_dk?.supabaseUrl || !_dk?.supabaseToken) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = {
      'apikey': _dk.supabaseToken,
      'Authorization': `Bearer ${_dk.supabaseToken}`,
      'Content-Type': 'application/json',
    };
    if (method === 'POST' || method === 'PATCH') headers['Prefer'] = 'return=representation';
    const res = await fetch(`${_dk.supabaseUrl}/rest/v1${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return await res.json();
  } catch(e) {
    clearTimeout(timeout);
    return null;
  }
}

// ═══════════════════════════════════════
// ARTIFACT SPEICHERN — nach file_task
// ═══════════════════════════════════════

async function saveAsArtifact({ name, type, fileBase64, rowCount = 0 }) {
  const userId = _dk?.userId;
  if (!userId || !fileBase64) return null;
  try {
    const mimeMap = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
    const rows = await directSupabase('POST', `/artifacts`, {
      user_id: userId,
      name: name || `MIRA_Output.${type}`,
      type: type || 'xlsx',
      data_base64: fileBase64,
      metadata: { rows: rowCount, pages: 0, preview_data: null },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const artifact = Array.isArray(rows) ? rows[0] : null;
    if (artifact?.id) {
      console.log(`🗂️ Artifact gespeichert: "${name}" id=${artifact.id}`);
      if (mainWindow) mainWindow.webContents.send('artifact-saved', { id: artifact.id, name, type, rows: rowCount });
      return artifact;
    }
    return null;
  } catch(e) {
    console.warn('⚠️ saveAsArtifact fehlgeschlagen:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════
// LOCAL MIRROR SERVER — localhost:3737
// Spiegelt Vercel-Endpoints lokal.
// Browser-Frontend erkennt ihn automatisch und
// nutzt ihn statt Vercel → kein RTT, direkter Claude/Supabase.
// ═══════════════════════════════════════

function decodeJWT(tok) {
  try {
    return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
  } catch(_) { return null; }
}

function startLocalServer() {
  if (localServer) return;

  localServer = http.createServer(async (req, res) => {
    // ── CORS + Private Network Access (Chrome blockiert HTTPS→localhost ohne diesen Header) ──
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url     = new URL(req.url, `http://127.0.0.1:${LOCAL_PORT}`);
    const pathname = url.pathname;

    // Body einlesen (POST/PATCH)
    let body = {};
    let rawBodyBuffer = null;
    const contentType = req.headers['content-type'] || '';
    if (!['GET', 'DELETE'].includes(req.method)) {
      if (contentType.includes('multipart/form-data')) {
        // Binary (Audio, Bilder) — als Buffer puffern für Proxy
        rawBodyBuffer = await new Promise(r => {
          const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks)));
        });
      } else {
        const raw = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
        try { body = JSON.parse(raw); } catch(_) {}
      }
    }

    const json = (data, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // ── /api/ping — kein Auth nötig ──────────────────────────────────────
    if (pathname === '/api/ping') {
      return json({ ok: true, agent: true, tier: userTier, version: '1.0' });
    }

    // ── Auth: nur Browser-User-JWT (type:'user') erlaubt ─────────────────
    // Der lokale Spiegel-Server wird ausschließlich vom Browser-Frontend
    // aufgerufen. Der Electron-Prozess selbst spricht direkt mit Vercel.
    // Device-Token (userToken) hat kein 'id'-Feld → hier nicht verwendet.
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    if (!tok) return json({ error: 'Unauthorized' }, 401);

    const payload = decodeJWT(tok);
    if (payload?.type !== 'user' || !payload?.id) return json({ error: 'Unauthorized' }, 401);

    const userId = payload?.id;

    // ── GET /api/users/device-status ─────────────────────────────────────
    if (pathname === '/api/users/device-status' && req.method === 'GET') {
      return json({ connected: true, device: { tier: userTier } });
    }

    // ── GET /api/users/profile ───────────────────────────────────────────
    if (pathname === '/api/users/profile' && req.method === 'GET') {
      const rows = await directSupabase('GET', `/users?id=eq.${userId}&limit=1`);
      if (rows?.[0]) return json({ success: true, user: rows[0] });
      try {
        const r = await fetch(`${API}/api/users/profile`, { headers: { 'Authorization': `Bearer ${tok}` } });
        return json(await r.json());
      } catch(e) { return json({ error: 'Profile unavailable' }, 503); }
    }

    // ── GET /api/users/conversations ─────────────────────────────────────
    if (pathname === '/api/users/conversations' && req.method === 'GET') {
      const rows = await directSupabase('GET', `/conversations?user_id=eq.${userId}&select=session_id,preview,updated_at&order=updated_at.desc&limit=50`);
      if (rows) return json({ success: true, conversations: rows });
      try {
        const r = await fetch(`${API}/api/users/conversations`, { headers: { 'Authorization': `Bearer ${tok}` } });
        return json(await r.json());
      } catch(e) { return json({ success: true, conversations: [] }); }
    }

    // ── /api/users/conversation/:sid ─────────────────────────────────────
    const convMatch = pathname.match(/^\/api\/users\/conversation\/([^/]+)$/);
    if (convMatch) {
      const sid = convMatch[1];

      if (req.method === 'GET') {
        const rows = await directSupabase('GET', `/conversations?session_id=eq.${sid}&user_id=eq.${userId}&select=messages&limit=1`);
        if (rows) return json({ success: true, messages: rows?.[0]?.messages || [] });
        try {
          const r = await fetch(`${API}/api/users/conversation/${sid}`, { headers: { 'Authorization': `Bearer ${tok}` } });
          return json(await r.json());
        } catch(e) { return json({ success: true, messages: [] }); }
      }

      if (req.method === 'DELETE') {
        await directSupabase('DELETE', `/conversations?session_id=eq.${sid}&user_id=eq.${userId}`);
        return json({ success: true });
      }
    }

    // ── POST /api/users/chat — direkt über Claude, Supabase-Save ─────────
    if (pathname === '/api/users/chat' && req.method === 'POST') {
      const { message, session_id } = body;
      if (!message) return json({ error: 'No message' }, 400);

      // History aus Supabase holen
      const convRows = await directSupabase('GET', `/conversations?session_id=eq.${session_id}&user_id=eq.${userId}&select=messages&limit=1`);
      const history  = convRows?.[0]?.messages || [];

      const messages = [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message }
      ];

      // Claude direkt rufen
      let reply = await directClaude(messages, { model: 'claude-sonnet-4-6', max_tokens: 2000 });

      if (!reply) {
        // Fallback: Vercel
        try {
          const r = await fetch(`${API}/api/users/chat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return json(await r.json());
        } catch(e) { return json({ error: 'Chat unavailable' }, 503); }
      }

      // Conversation in Supabase speichern (upsert)
      const updatedMsgs = [
        ...history,
        { role: 'user',      content: message, created_at: new Date().toISOString() },
        { role: 'assistant', content: reply,   created_at: new Date().toISOString() }
      ];
      const preview = message.slice(0, 80);
      if (convRows?.[0]) {
        await directSupabase('PATCH', `/conversations?session_id=eq.${session_id}&user_id=eq.${userId}`,
          { messages: updatedMsgs, preview, updated_at: new Date().toISOString() });
      } else {
        await directSupabase('POST', `/conversations`,
          { session_id, user_id: userId, messages: updatedMsgs, preview, updated_at: new Date().toISOString() });
      }

      return json({ success: true, response: reply, session_id, direct: true });
    }

    // ── POST /api/agent/queue — sofort ausführen, kein Poll-Delay ────────
    if (pathname === '/api/agent/queue' && req.method === 'POST') {
      const { command, source } = body;
      if (!command) return json({ error: 'No command' }, 400);

      const task = {
        id:      'local_' + Date.now(),
        command,
        source:  source || 'web_local',
        user_id: userId,
      };

      // Sofort im Hintergrund ausführen
      setImmediate(() => executeTaskFromQueue(task).catch(e =>
        console.error('❌ Local task error:', e.message)
      ));

      return json({ success: true, task_id: task.id, direct: true });
    }

    // ── GET /api/artifacts ───────────────────────────────────────────────
    // Schema: id, name, type, metadata(jsonb), data_base64, created_at, updated_at
    if (pathname === '/api/artifacts' && req.method === 'GET') {
      const rows = await directSupabase('GET', `/artifacts?user_id=eq.${userId}&select=id,name,type,metadata,created_at,updated_at&order=updated_at.desc&limit=50`);
      if (Array.isArray(rows)) {
        const artifacts = rows.map(a => ({ ...a, rows: a.metadata?.rows || 0, pages: a.metadata?.pages || 0, preview_data: a.metadata?.preview_data || null }));
        return json({ success: true, artifacts });
      }
      try {
        const r = await fetch(`${API}/api/artifacts`, { headers: { 'Authorization': `Bearer ${tok}` } });
        return json(await r.json());
      } catch(e) { return json({ success: true, artifacts: [] }); }
    }

    // ── /api/artifacts/:id ───────────────────────────────────────────────
    const artifactMatch = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (artifactMatch) {
      const aId = artifactMatch[1];

      if (req.method === 'GET') {
        const rows = await directSupabase('GET', `/artifacts?id=eq.${aId}&user_id=eq.${userId}&limit=1`);
        if (rows?.[0]) {
          const a = rows[0];
          return json({ success: true, artifact: { ...a, rows: a.metadata?.rows || 0, pages: a.metadata?.pages || 0, preview_data: a.metadata?.preview_data || null } });
        }
        try {
          const r = await fetch(`${API}/api/artifacts/${aId}`, { headers: { 'Authorization': `Bearer ${tok}` } });
          return json(await r.json());
        } catch(e) { return json({ success: false, error: 'Not found' }, 404); }
      }

      if (req.method === 'PATCH') {
        // metadata mergen
        const existingRows = await directSupabase('GET', `/artifacts?id=eq.${aId}&user_id=eq.${userId}&select=metadata&limit=1`);
        const oldMeta = existingRows?.[0]?.metadata || {};
        const newMeta = { ...oldMeta };
        if (body.rows         !== undefined) newMeta.rows         = body.rows;
        if (body.pages        !== undefined) newMeta.pages        = body.pages;
        if (body.preview_data !== undefined) newMeta.preview_data = body.preview_data;
        const patch = { metadata: newMeta, updated_at: new Date().toISOString() };
        if (body.data_base64 !== undefined) patch.data_base64 = body.data_base64;
        if (body.name        !== undefined) patch.name        = body.name;
        const row = await directSupabase('PATCH', `/artifacts?id=eq.${aId}&user_id=eq.${userId}`, patch);
        if (row?.[0]) return json({ success: true, artifact: { ...row[0], rows: newMeta.rows || 0, pages: newMeta.pages || 0, preview_data: newMeta.preview_data || null } });
        try {
          const r = await fetch(`${API}/api/artifacts/${aId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return json(await r.json());
        } catch(e) { return json({ success: false, error: e.message }, 500); }
      }

      if (req.method === 'DELETE') {
        // Artifacts dürfen nie gelöscht werden
        return json({ success: false, error: 'Artifacts können nicht gelöscht werden.' }, 405);
      }
    }

    // POST /api/artifacts (ohne :id oder mit :id) ─────────────────────────
    if (pathname === '/api/artifacts' && req.method === 'POST') {
      const { name, type, data_base64, preview_data, rows, pages } = body;
      const metadata = { rows: rows || 0, pages: pages || 0, preview_data: preview_data || null };
      const row = await directSupabase('POST', `/artifacts`, {
        user_id: userId, name, type, data_base64, metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (row?.[0]) return json({ success: true, artifact: { ...row[0], rows: rows || 0, pages: pages || 0, preview_data: preview_data || null } });
      try {
        const r = await fetch(`${API}/api/artifacts`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return json(await r.json());
      } catch(e) { return json({ success: false, error: e.message }, 500); }
    }

    // ── Alles andere → Proxy zu Vercel ────────────────────────────────────
    try {
      const isNoBody = ['GET', 'DELETE'].includes(req.method);
      const proxyRes = await fetch(`${API}${pathname}${url.search}`, {
        method: req.method,
        headers: {
          'Authorization': `Bearer ${tok}`,
          // multipart: Content-Type mit boundary 1:1 weitergeben; sonst JSON
          ...(rawBodyBuffer
            ? { 'Content-Type': contentType }
            : { 'Content-Type': 'application/json' }),
        },
        body: isNoBody ? undefined : (rawBodyBuffer || JSON.stringify(body)),
      });
      const proxyText = await proxyRes.text();
      res.writeHead(proxyRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(proxyText);
    } catch(e) {
      json({ error: 'Proxy failed', detail: e.message }, 502);
    }
  });

  localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`🌐 Local mirror server aktiv: http://localhost:${LOCAL_PORT}`);
  });

  localServer.on('error', e => {
    console.warn(`⚠️ Local server Fehler: ${e.message}`);
    localServer = null;
  });
}

// ═══════════════════════════════════════
// TOKEN STORAGE
// ═══════════════════════════════════════

function loadSavedToken() {
  const savedToken = store.get('userToken');
  if (savedToken) {
    console.log('✅ Token loaded from storage');
    userToken = savedToken;
    userTier = store.get('userTier');
    tasksRemaining = store.get('tasksRemaining') || 0;
    userPin = store.get('userPin');
    agentActive = true;
    startPolling();
    bootstrap().catch(() => {});
    startLocalServer();
    bibLoader.warmup(); // Telekolleg-Bib vorwärmen
    // Bewusstsein starten mit gespeichertem Token
    startCircuit(savedToken);
    // Feature 1: System-Log Monitor mit gespeichertem Token starten
    sysLogMonitor.start({ api: API, token: savedToken });
    loadUserProfileSettings().catch(() => {});
    startKeepAlive();
    // Community-Patterns + Feldwissen beim Start laden
    syncCommunityPatterns(savedToken).catch(() => {});
    // Token-Guthaben nach Login laden und ans UI schicken
    fetch(`${API}/api/agent/token-balance?token=${savedToken}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && mainWindow) {
          mainWindow.webContents.send('token-balance-updated', { balance: data.balance, low_balance: data.balance < 50 });
        }
      }).catch(() => {});
    return true;
  }
  return false;
}

function saveToken() {
  store.set('userToken', userToken);
  store.set('userTier', userTier);
  store.set('tasksRemaining', tasksRemaining);
  store.set('userPin', userPin);
  console.log('💾 Token saved');
}

function clearToken() {
  store.delete('userToken');
  store.delete('userTier');
  store.delete('tasksRemaining');
  store.delete('userPin');
  console.log('🗑️ Token cleared');
}

async function loadUserProfileSettings() {
  if (!userToken) return;
  try {
    const res = await fetch(`${API}/api/users/profile-settings`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const data = await res.json();
    if (data.success) {
      userProfileSettings = data.settings || {};
      console.log('📋 Profil geladen:', userProfileSettings.company_name || '(kein Name)');
    }
  } catch(e) {
    console.warn('⚠️ Profil laden fehlgeschlagen:', e.message);
  }
}

// ═══════════════════════════════════════
// COMMUNITY PATTERN SYNC
// ═══════════════════════════════════════

async function syncCommunityPatterns(token) {
  if (!token) return;
  const fs   = require('fs');
  const path = require('path');
  const PATTERNS_DIR = path.join(__dirname, 'reme-memory', 'patterns');
  const INDEX_PATH   = path.join(PATTERNS_DIR, 'index.json');

  try {
    // ── 1. Community-Patterns herunterladen ───────────────────────────────
    const res = await fetch(`${API}/api/patterns/download?token=${token}&min_trust=0.3`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !Array.isArray(data.patterns)) return;

    fs.mkdirSync(PATTERNS_DIR, { recursive: true });

    let index = {};
    if (fs.existsSync(INDEX_PATH)) {
      try { index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch {}
    }

    let neu = 0;
    for (const p of data.patterns) {
      if (!p.pattern_hash || !p.png_base64) continue;
      const existiert = Object.values(index).some(v => v.hash === p.pattern_hash);
      if (existiert) continue;

      const key      = (p.label || 'unbekannt').toLowerCase().replace(/[^a-z0-9äöü]/g, '-').replace(/-+/g, '-');
      const safeKey  = `${key}-${p.pattern_hash.substring(0, 6)}`;
      const filename = `${safeKey}.png`;
      const filepath = path.join(PATTERNS_DIR, filename);

      fs.writeFileSync(filepath, Buffer.from(p.png_base64, 'base64'));

      index[safeKey] = {
        label:        p.label || 'unbekannt',
        kategorie:    p.kategorie || 'icon',
        datei:        filename,
        hash:         p.pattern_hash,
        gelernt:      new Date().toISOString(),
        trefferCount: 0,
        community:    true,
        trust:        p.trust_score || 0
      };
      neu++;
    }

    if (neu > 0) {
      fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
      mathChef.clearCache();
      console.log(`🌍 ${neu} Community-Pattern(s) synchronisiert`);
    }

    // ── 2. Globales Feldwissen herunterladen ──────────────────────────────
    const fwRes = await fetch(`${API}/api/patterns/feldwissen?token=${token}`);
    if (fwRes.ok) {
      const fwData = await fwRes.json();
      if (fwData.success && Array.isArray(fwData.felder)) {
        for (const f of fwData.felder) {
          if (f.feld_label && f.typ) {
            wissenstree.lernFeld(f.feld_label, {
              typ:         f.typ,
              beschreibung: f.beschreibung || '',
              bereich:     f.bereich_min != null ? [f.bereich_min, f.bereich_max] : null
            });
          }
        }
        if (fwData.felder.length > 0) {
          console.log(`📚 ${fwData.felder.length} Feldwissen-Einträge synchronisiert`);
        }
      }
    }
  } catch(e) {
    console.warn('⚠️ Community-Sync fehlgeschlagen:', e.message);
  }
}

// Lädt neu gelernte lokale Patterns (noch ohne community:true) in die Community hoch
async function uploadNewPatternsToCommunity(token) {
  if (!token) return;
  const fs     = require('fs');
  const path   = require('path');
  const crypto = require('crypto');
  const PATTERNS_DIR = path.join(__dirname, 'reme-memory', 'patterns');
  const INDEX_PATH   = path.join(PATTERNS_DIR, 'index.json');
  if (!fs.existsSync(INDEX_PATH)) return;

  let index = {};
  try { index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch { return; }

  const lokal = Object.entries(index).filter(([, v]) => !v.community && !v.uploaded);
  for (const [key, v] of lokal) {
    const filepath = path.join(PATTERNS_DIR, v.datei);
    if (!fs.existsSync(filepath)) continue;
    try {
      const imgBuf      = fs.readFileSync(filepath);
      const png_base64  = imgBuf.toString('base64');
      const pattern_hash = v.hash || crypto.createHash('sha256').update(imgBuf).digest('hex');

      const res = await fetch(`${API}/api/patterns/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          label:        v.label,
          kategorie:    v.kategorie || 'icon',
          png_base64,
          pattern_hash
        })
      });
      const data = await res.json();
      if (data.success) {
        index[key].uploaded = true;
        index[key].hash     = pattern_hash;
        console.log(`☁️  Pattern hochgeladen: "${v.label}"`);
      }
    } catch(e) {
      console.warn('⚠️ Pattern-Upload fehlgeschlagen:', e.message);
    }
  }
  try { fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8'); } catch {}
}

// ═══════════════════════════════════════
// SCREENSHOT HELPER
// ═══════════════════════════════════════

async function takeCompressedScreenshot() {
  const buffer = await screenshot({ format: 'jpg' });
  const compressed = await sharp(buffer)
    .resize(1280, 720, { fit: 'inside' })
    .jpeg({ quality: 60 })
    .toBuffer();
  return compressed.toString('base64');
}



// ═══════════════════════════════════════
// MIMI VISION SYSTEM
// ═══════════════════════════════════════

async function miniFind(screenshotBase64, elementDescription) {
  // ── Direct path: GPT-4o-mini ohne Vercel-Hop ──
  if (_dk?.gptKey) {
    try {
      const raw = await directOpenAI([
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: 'high' } },
            { type: 'text', text: `Finde dieses Element im Screenshot: ${elementDescription}

Wenn es ein Button/Icon/Tab ist: Gib dessen Mittelpunkt zurück.
Wenn es ein Label-Text ist (z.B. "Name:", "Nachname:"): Gib die Position dieses Label-Textes zurück.
Wenn es ein leeres Eingabefeld ist: Gib dessen Mittelpunkt zurück.

Antworte NUR mit JSON:
{"found": true, "x": 120, "y": 450, "confidence": 0.95, "description": "was du siehst"}
oder:
{"found": false, "confidence": 0}
Koordinaten in 1280x720 Pixel-Raum.` }
          ]
        }
      ], { model: 'gpt-4o-mini', max_tokens: 200 });
      if (raw) {
        const jsonMatch = raw.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          console.log(`👁️ miniFind[direct] "${elementDescription}": found=${result.found} conf=${result.confidence}`);
          return result;
        }
      }
    } catch(e) { /* Vercel Fallback */ }
  }
  // ── Fallback: Vercel ──
  try {
    const response = await fetch(`${API}/api/brain/mini-find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, screenshot: screenshotBase64, element: elementDescription })
    });
    const data = await response.json();
    console.log(`👁️ miniFind[vercel] "${elementDescription}": found=${data.found} conf=${data.confidence}`);
    return data;
  } catch(e) {
    console.error('❌ miniFind error:', e.message);
    return { found: false, confidence: 0 };
  }
}

// ═══════════════════════════════════════
// TOKEN BILLING — trackUsage
// Fire-and-forget: Fehler werden ignoriert, blockiert nie Tasks
// ═══════════════════════════════════════
async function trackUsage(amount, action = 'unknown') {
  if (!userToken || !amount) return;
  try {
    const res = await fetch(`${API}/api/agent/track-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, action, amount })
    });
    const data = await res.json();
    if (data.success && mainWindow) {
      mainWindow.webContents.send('token-balance-updated', {
        balance: data.balance,
        low_balance: data.low_balance
      });
      if (data.low_balance) {
        console.warn(`⚠️ Token-Guthaben niedrig: ${data.balance}`);
      }
    }
  } catch(e) {
    // Billing-Fehler nie weiterwerfen — Task läuft weiter
  }
}

async function miniVerify(screenshotBase64, expectedState) {
  // ── Direct path: GPT-4o-mini ohne Vercel-Hop ──
  if (_dk?.gptKey) {
    try {
      const raw = await directOpenAI([
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: 'low' } },
            { type: 'text', text: `Prüfe ob dieser Zustand sichtbar ist: "${expectedState}"\nAntworte NUR mit JSON: {"ok": true, "confidence": 0.9, "reason": "kurze Beschreibung"}` }
          ]
        }
      ], { model: 'gpt-4o-mini', max_tokens: 100 });
      if (raw) {
        const jsonMatch = raw.match(/\{[\s\S]*?\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      }
    } catch(e) { /* Vercel Fallback */ }
  }
  // ── Fallback: Vercel ──
  try {
    const response = await fetch(`${API}/api/brain/mini-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, screenshot: screenshotBase64, expected: expectedState })
    });
    return await response.json();
  } catch(e) {
    return { ok: true, confidence: 0.5 };
  }
}

async function saveScreenMemory(data) {
  try {
    await fetch(`${API}/api/brain/memory-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, ...data })
    });
  } catch(e) {}
}


// ═══════════════════════════════════════
// AX LAYER — Accessibility API (Mac)
// Fragt das OS direkt nach UI-Element-Koordinaten.
// Kein Screenshot, kein API-Call, keine Skalierung nötig.
// ═══════════════════════════════════════

function axFind(elementLabel) {
  try {
    const frontmost = axLayer.getFrontmostApp();
    const result = axLayer.findElement(elementLabel, {
      bundleId: frontmost?.bundleId || undefined
    });
    if (result.found && typeof result.confidence === 'number' && result.confidence >= 0.30) {
      console.log(`♿ AX Layer findet "${elementLabel}": x:${result.centerX} y:${result.centerY} (confidence: ${Math.round(result.confidence * 100)}%)`);
      return result;
    }
    return { found: false };
  } catch (e) {
    console.warn(`⚠️ axFind Fehler: ${e.message}`);
    return { found: false };
  }
}

/**
 * waitForElement — Tier 0b with retry.
 * Retries AX element search up to maxAttempts times with pauseMs between tries.
 * Handles cases where UI is still loading after navigation or click.
 *
 * @param {string} label          Natural-language element label
 * @param {string} bundleId       App bundleId / process name
 * @param {number} maxAttempts    Max retry count (default 3)
 * @param {number} pauseMs        Wait between retries in ms (default 500)
 * @returns {Promise<{found: boolean, centerX?, centerY?, confidence?}>}
 */
async function waitForElement(label, bundleId, maxAttempts = 3, pauseMs = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = axLayer.findElement(label, { bundleId: bundleId || undefined });
    if (result.found && typeof result.confidence === 'number' && result.confidence >= 0.30) {
      if (attempt > 1) {
        console.log(`⏳ "${label}" nach ${attempt} Versuchen geladen`);
      }
      return result;
    }
    if (attempt < maxAttempts) {
      console.log(`⏳ "${label}" noch nicht da (${attempt}/${maxAttempts}) — warte ${pauseMs}ms`);
      await sleep(pauseMs);
      contextManager.invalidate();
    }
  }
  return { found: false };
}

/**
 * handleNewMail — Callback für mailMonitor.
 * Klassifiziert neue Mails via Backend und triggert die passende Route.
 */
async function handleNewMail({ bundleId, delta, elements }) {
  if (!userToken || !agentActive) return;
  console.log(`📬 handleNewMail: +${delta} neue Mail(s) in ${bundleId}`);

  // 1. Mail-Metadaten aus AX extrahieren
  const meta = mailMonitor.extractFirstUnread(elements);
  console.log(`📬 Mail: "${meta?.subject || '?'}" von "${meta?.sender || '?'}"`);

  // 2a. Wissensbase: Absender-Kontext anreichern
  const senderContact = miraBrain.lookupContact(meta?.sender || '');
  if (senderContact) {
    console.log(`🧠 Absender bekannt: ${senderContact.name} (${senderContact.role})`);
  }

  // 2b. Wissensbase: lokalen Trigger suchen (kein Backend-Roundtrip nötig)
  const localTrigger = miraBrain.findTrigger('new_mail', {
    subject: meta?.subject || '',
    sender:  meta?.sender  || '',
    role:    senderContact?.role || '',
  });

  let route_id   = localTrigger?.route_id   || null;
  let route_name = localTrigger?.route_name || null;

  if (localTrigger) {
    console.log(`🧠 Lokaler Trigger: "${route_name}" (Priorität ${localTrigger.priority})`);
    // Check autonomy limit
    const limit = miraBrain.checkLimit('send_mail');
    if (!limit.autonomous) {
      console.log(`🧠 Grenze: Eskaliere an ${limit.escalate_to || '?'} — ${limit.reason}`);
      if (mainWindow) mainWindow.webContents.send('mail-escalated', {
        subject:    meta?.subject || '',
        sender:     meta?.sender  || '',
        escalate_to: limit.escalate_to,
        reason:     limit.reason,
      });
      return;
    }

    // High-priority triggers (Prio 1-3) become GOALS so the planner can
    // chain multiple routes and remember the outcome across sessions.
    if ((localTrigger.priority ?? 99) <= 3 && miraPlanner.isRunning?.()) {
      const goalText = `Mail von ${meta?.sender || '?'} bearbeiten: "${meta?.subject || ''}"`;
      await miraPlanner.submitGoal(goalText, {
        source:  'mail',
        subject: meta?.subject || '',
        sender:  meta?.sender  || '',
        route_id,
      });
      await miraPlanner.remember('event', meta?.sender || 'unbekannt',
        `Mail erhalten: "${meta?.subject || ''}" — Trigger: ${route_name}`,
        ['mail', 'trigger'], null);
      if (mainWindow) mainWindow.webContents.send('mail-route-triggered', {
        route_name, subject: meta?.subject || '', sender: meta?.sender || '',
      });
      return;
    }
  }

  // 2c. Fallback: Backend klassifiziert Mail → gibt passende route_id zurück
  if (!route_id) {
    try {
      const kbContext = miraBrain.buildPromptContext();
      const res = await fetch(`${API}/api/brain/classify-mail`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token:      userToken,
          subject:    meta?.subject || '',
          sender:     meta?.sender  || '',
          preview:    meta?.preview || '',
          bundleId,
          kb_context: kbContext,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.route_id) {
        console.log(`📬 Keine passende Route für diese Mail (${data.reason || 'kein Match'})`);
        return;
      }
      route_id   = data.route_id;
      route_name = data.route_name;
      console.log(`📬 Backend-Route: "${route_name}" (${Math.round((data.confidence || 0) * 100)}%)`);
    } catch (e) {
      console.warn(`📬 Mail-Klassifikation Fehler: ${e.message}`);
      return;
    }
  }

  // 3. Route über Task-Queue triggern (nutzt bestehende Polling-Infrastruktur)
  try {
    await fetch(`${API}/api/agent/queue`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        token:   userToken,
        command: `RUN_ROUTE:${route_id}`,
        source:  'mail_monitor',
        context: `Mail von ${meta?.sender || '?'}: "${meta?.subject || ''}"`,
      }),
    });
  } catch (e) {
    console.warn(`📬 Route queue Fehler: ${e.message}`);
    return;
  }

  // 4. UI benachrichtigen
  if (mainWindow) {
    mainWindow.webContents.send('mail-route-triggered', {
      route_name,
      subject: meta?.subject || '',
      sender:  meta?.sender  || '',
    });
  }
}


// ═══════════════════════════════════════
// CREATE WINDOWS
// ═══════════════════════════════════════
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'MIRA Agent',
    resizable: true,
    backgroundColor: '#000000',
    fullscreen: false,
    maximizable: false,
    icon: process.platform === 'win32'
      ? path.join(__dirname, 'icon.ico')
      : process.platform === 'darwin'
      ? path.join(__dirname, 'icon.icns')
      : path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    const hasToken = loadSavedToken();
    if (hasToken) {
      mainWindow.webContents.send('token-loaded', {
        tier: userTier,
        tasks: tasksRemaining,
        pin: userPin,
        device_id: getDeviceId()
      });
    }
  });
}

function createCalibrationWindow() {
  const { width, height } = electronScreen.getPrimaryDisplay().bounds;

 calibrationWindow = new BrowserWindow({
  x: 0, y: 0,
  width: width, height: height,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  backgroundColor: '#00000000',
  fullscreenable: false,
  // type: 'panel' ← LÖSCHEN
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false
  }
});

  calibrationWindow.loadFile('route-overlay.html');
  calibrationWindow.setIgnoreMouseEvents(true, { forward: true }); // Standard: durchlassen
  calibrationWindow.setAlwaysOnTop(true, 'screen-saver');
  calibrationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  calibrationWindow.hide();


  calibrationWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      if (calibrationWindow) calibrationWindow.hide();
      mainWindow.show();
      isCapturingClick = false;
    }
  });
}

function createKnowledgeBaseWindow() {
  if (knowledgeBaseWindow && !knowledgeBaseWindow.isDestroyed()) {
    knowledgeBaseWindow.focus();
    return;
  }
  knowledgeBaseWindow = new BrowserWindow({
    width:  640,
    height: 680,
    title:  'MIRA Wissensbase',
    frame:  true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration:   true,
      contextIsolation:  false,
    },
  });
  knowledgeBaseWindow.loadFile('knowledge-base-overlay.html');
  knowledgeBaseWindow.on('closed', () => { knowledgeBaseWindow = null; });
}

function createMitarbeiterWindow() {
  if (mitarbeiterWindow && !mitarbeiterWindow.isDestroyed()) {
    mitarbeiterWindow.focus(); return;
  }
  mitarbeiterWindow = new BrowserWindow({
    width: 800, height: 680,
    title: 'MIRA Corp — Belegschaft',
    frame: true, resizable: true,
    minimizable: false, maximizable: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#080a10',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mitarbeiterWindow.loadFile('mitarbeiter-overlay.html');
  mitarbeiterWindow.on('closed', () => { mitarbeiterWindow = null; });
}

function createDeviceKnowledgeWindow() {
  if (deviceKnowledgeWindow && !deviceKnowledgeWindow.isDestroyed()) {
    deviceKnowledgeWindow.focus();
    return;
  }
  deviceKnowledgeWindow = new BrowserWindow({
    width:  500,
    height: 600,
    title:  'Mira beibringen',
    frame:  true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });
  deviceKnowledgeWindow.loadFile('device-knowledge-overlay.html');
  deviceKnowledgeWindow.on('closed', () => { deviceKnowledgeWindow = null; });
}

function createUserProfileWindow() {
  if (userProfileWindow && !userProfileWindow.isDestroyed()) {
    userProfileWindow.focus();
    return;
  }
  userProfileWindow = new BrowserWindow({
    width:  580,
    height: 680,
    title:  'Unternehmensprofil',
    frame:  true,
    resizable:   false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });
  userProfileWindow.loadFile('user-profile-overlay.html');
  userProfileWindow.on('closed', () => { userProfileWindow = null; });
}

function createTemplatesWindow() {
  if (templatesWindow && !templatesWindow.isDestroyed()) {
    templatesWindow.focus();
    return;
  }
  templatesWindow = new BrowserWindow({
    width:  700,
    height: 600,
    title:  'MIRA Templates',
    frame:  true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });
  templatesWindow.loadFile('templates-overlay.html');
  templatesWindow.on('closed', () => { templatesWindow = null; });
}

function createOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.focus();
    return;
  }
  onboardingWindow = new BrowserWindow({
    width:           520,
    height:          560,
    title:           'MIRA — Willkommen',
    frame:           true,
    resizable:       false,
    minimizable:     false,
    maximizable:     false,
    titleBarStyle:   'hiddenInset',
    backgroundColor: '#0a0c14',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });
  onboardingWindow.loadFile('onboarding-overlay.html');
  // Block closing until user finishes
  onboardingWindow.on('close', (e) => {
    if (onboardingWindow && !onboardingWindow._allowClose) {
      e.preventDefault();
    }
  });
  onboardingWindow.on('closed', () => { onboardingWindow = null; });
}

function createTargetTrainingWindow() {
  if (targetTrainingWindow && !targetTrainingWindow.isDestroyed()) {
    targetTrainingWindow.focus();
    return;
  }
  const display = electronScreen.getPrimaryDisplay();
  targetTrainingWindow = new BrowserWindow({
    x:               display.bounds.x,
    y:               display.bounds.y,
    width:           display.bounds.width,
    height:          display.bounds.height,
    frame:           false,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    backgroundColor: '#080a10',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });
  targetTrainingWindow.loadFile('target-training-overlay.html');
  targetTrainingWindow.on('closed', () => { targetTrainingWindow = null; });
}

// ═══════════════════════════════════════
// CALIBRATION SYSTEM
// ═══════════════════════════════════════

// Maus FREIGEBEN – Overlay reagiert auf Klicks (beim Markieren)
ipcMain.on('overlay-release-mouse', () => {
  if (calibrationWindow) calibrationWindow.setIgnoreMouseEvents(false);
});

// Maus ZURÜCK – Overlay lässt Klicks durch (normal)
ipcMain.on('overlay-needs-mouse', () => {
  if (calibrationWindow) calibrationWindow.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.on('do-scroll', async (event, { direction, amount }) => {
  try {
    if (direction === 'down') await mouse.scrollDown(amount);
    else await mouse.scrollUp(amount);
  } catch(e) {}
});

ipcMain.handle('start-click-capture', async (event, elementName) => {
  currentCalibrationElement = elementName;
  isCapturingClick = true;
  console.log(`🎯 Capturing click for: ${elementName}`);

  mainWindow.hide();

  if (!calibrationWindow) createCalibrationWindow();
  calibrationWindow.show();
  calibrationWindow.webContents.send('show-prompt', elementName);

  return true;
});

// ← FIX: Kein API-Call hier mehr! index.html macht das MIT Screenshot
uIOhook.on('mousedown', async (event) => {
  // Feature 2: Passive Trainer — läuft parallel zu allen anderen Handlers
  // ZUERST ausführen damit Screenshot den Pre-Click Zustand zeigt
  if (passiveTrainer.isActive()) {
    passiveTrainer.onMouseDown(event.x, event.y, {
      takeScreenshot: takeCompressedScreenshot,
      axLayer,
      contextManager,
      coordCache,
    }).catch(() => {});
    // Progress an UI schicken
    const prog = passiveTrainer.getProgress();
    if (prog && mainWindow) mainWindow.webContents.send('passive-training-progress', prog);
  }

  if (!isCapturingClick) return;

  console.log(`📍 Click captured at: [${event.x}, ${event.y}]`);
  isCapturingClick = false;

  if (calibrationWindow) calibrationWindow.hide();
  mainWindow.show();
  mainWindow.focus();

  const screenWidth = await nutScreen.width();
  const screenHeight = await nutScreen.height();

  // Nur senden - index.html macht den API-Call MIT Screenshot
  mainWindow.webContents.send('click-captured', {
    element: currentCalibrationElement,
    x: event.x,
    y: event.y,
    screenWidth: screenWidth,
    screenHeight: screenHeight
  });

  currentCalibrationElement = null;
});

// ← NEU: index.html braucht diesen Handler für Screenshot nach Kalibrierung
ipcMain.handle('take-screenshot', async () => {
  return await takeCompressedScreenshot();
});

// ═══════════════════════════════════════
// POLLING SYSTEM
// ═══════════════════════════════════════

function startPolling() {
  if (pollingInterval) return;
  console.log('🔄 Polling gestartet...');

  // ── Laufzeit-Dependencies einmalig injizieren ──────────────────────────
  recoveryEngine.init({
    keyboard,
    Key,
    sleep,
    takeScreenshot: () => takeCompressedScreenshot(),
    notify: (type, payload) => { if (mainWindow) mainWindow.webContents.send(type, payload); },
  });

  // ── Wissensbase starten ────────────────────────────────────────────────
  miraBrain.configure(API, userToken, getDeviceId());
  miraBrain.start().then(() => {
    if (miraBrain.needsOnboarding()) {
      console.log('🧠 Erste Verwendung — Onboarding starten');
      createOnboardingWindow();
    }
  });

  // ── Planner starten ────────────────────────────────────────────────────
  miraPlanner.init({
    api:      API,
    token:    userToken,
    deviceId: getDeviceId(),
    notify:   (type, payload) => { if (mainWindow) mainWindow.webContents.send(type, payload); },
    executeRoute: async (routeId, ctx) => {
      // Creates a synthetic task so the full route-execution pipeline (AX, recovery,
      // verification) runs exactly the same as for normal queue tasks.
      const synthTask = {
        id:      `planner_${ctx?.goalId || 'x'}_${ctx?.stepIndex ?? 0}_${Date.now()}`,
        command: `RUN_ROUTE:${routeId}`,
        source:  'planner',
        priority: 10,
      };
      await executeTaskFromQueue(synthTask);
    },
  });
  miraPlanner.start();

  // ── Mail Monitor & Koordinaten-Cache starten ───────────────────────────
  mailMonitor.start(handleNewMail);
  coordCache.prune();

  // Erst cancel-pending ABWARTEN, dann erst polling starten
  fetch(`${API}/api/agent/cancel-pending`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: userToken })
  })
  .catch(() => {})
  .finally(() => {
    // ← Erst NACH cancel-pending starten
    startDialogBridge();

    let _pollFailCount = 0;

    pollingInterval = setInterval(async () => {
      if (!userToken || !agentActive) return;
      try {
        const response = await fetch(`${API}/api/agent/poll?token=${userToken}`);
        const data = await response.json();

        // ── Reconnect after offline ──────────────────────────────────────
        if (_pollFailCount >= 3) {
          _pollFailCount = 0;
          if (mainWindow) mainWindow.webContents.send('agent-online');
        }

        if (!data.success && (data.error === 'Token ungültig' || data.error === 'Unauthorized')) {
          await reconnectWithPin();
          return;
        }

        if (!data.success && (data.error === 'Device nicht aktiviert' || data.error === 'Subscription abgelaufen' || data.force_logout)) {
          console.log('🚪 Gerät deaktiviert — automatischer Logout');
          stopPolling();
          userToken = null; userTier = null; agentActive = false; _dk = null;
          clearToken();
          if (mainWindow) mainWindow.webContents.send('force-logout', { reason: data.error });
          return;
        }

        if (data.success && data.tasks && data.tasks.length > 0) {
          console.log(`📋 ${data.tasks.length} neue Tasks!`);
          for (let task of data.tasks) {
            await executeTaskFromQueue(task);
          }
        }
      } catch(error) {
        console.error('❌ Polling error:', error.message);
        _pollFailCount++;
        if (_pollFailCount === 3) {
          if (mainWindow) mainWindow.webContents.send('agent-offline');
        }
      }
    }, 5000);
  });
}

function stopPolling() {
  if (dialogPollInterval) {
    clearInterval(dialogPollInterval);
    dialogPollInterval = null;
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('⏸️ Polling stopped');
  }
  stopKeepAlive();
  mailMonitor.stop();
  miraPlanner.stop();
  miraBrain.stop();
}

// ── fetch mit Timeout (für unkritische Vercel-Calls) ─────────────────────
// Edge-Function-Calls brauchen keinen Timeout (kein Cold Start).
// Für ftLog / complete: 8s Timeout damit der File-Task nicht ewig hängt.
async function fetchWithTimeout(url, options, ms = 8000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// ── Vercel Keep-Alive ─────────────────────────────────────────────────────
// Pingt den Server alle 45s damit die Function warm bleibt (kein Cold Start)
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  const ping = () => fetch(`${API}/api/ping`).catch(() => {});
  ping(); // sofort beim Start
  keepAliveInterval = setInterval(ping, 45000);
  console.log('🔥 Keep-Alive gestartet (alle 45s)');
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function executeTaskFromQueue(task) {
  // GUARD — Task nur einmal ausführen (mit 5-Minuten-Stale-TTL)
  if (runningTasks.has(task.id)) {
    const startedAt = runningTasks.get(task.id);
    const elapsed = Date.now() - startedAt;
    if (elapsed < RUNNING_TASK_TTL) {
      console.log(`⏭️ Skip — läuft bereits: ${task.id.substring(0,8)} (${Math.round(elapsed/1000)}s)`);
      return;
    }
    // Stale task — war zu lange "running", entfernen und neu starten
    console.log(`🗑️ Stale Task ${task.id.substring(0,8)} nach ${Math.round(elapsed/1000)}s entfernt → Retry`);
    runningTasks.delete(task.id);
    await markTaskComplete(task.id, 'failed').catch(() => {});
  }
  runningTasks.set(task.id, Date.now());
  if (mainWindow) mainWindow.webContents.send('task-started');

  console.log(`⚙️ Executing: ${task.command.substring(0, 80)}`);
  try {

    let parsed = null;
    try { parsed = JSON.parse(task.command); } catch(e) {}

    console.log(`🔍 Command: ${task.command.substring(0, 100)}`);
    console.log(`🔍 Parsed type: ${parsed?.type}`);

    // ════════════════════════════════════════════════════════════════
    // KOGNITIVE LAYER — vor allem anderen
    // 1. WahrnehmungsAmt: Was ist gerade auf dem Bildschirm?
    // 2. InformationsAmt: Haben wir genug Kontext? Sonst fragen.
    // Übersprungen für interne Tasks (file_task, scan, training)
    // ════════════════════════════════════════════════════════════════
    let perception = null;
    const isInternalTask = parsed?.type === 'file_task' || parsed?.type === 'scan_folder'
      || parsed?.type === 'start_training' || parsed?.type === 'extract_data'
      || parsed?.type === 'code_task';

    if (!isInternalTask) {
      // Checkpoint vor jeder Aktion
      gefahrenAmt.snapshot({ contextManager, description: task.command.substring(0, 60) });

      // Wahrnehmen (Screenshot + AX → semantisches Verständnis)
      try {
        const sc  = await takeCompressedScreenshot();
        const ax  = contextManager.toPromptString(contextManager.captureState());
        perception = await wahrnehmung.wahrnehmen({ screenshot: sc, axContext: ax, token: userToken, API });
      } catch(e) { console.warn('WahrnehmungsAmt skip:', e.message); }

      // InformationsAmt: Kontext prüfen + ggf. User fragen
      const info = await infoAmt.assess({ command: task.command, perception });
      if (!info.proceed) {
        console.log(`🛑 InformationsAmt: ${info.reason}`);
        await markTaskComplete(task.id, 'failed');
        return;
      }
      // Angereicherten Befehl verwenden (mit [NUTZER_INFO: ...] falls vorhanden)
      if (info.enriched_command !== task.command) {
        task = { ...task, command: info.enriched_command };
        try { parsed = JSON.parse(task.command); } catch(_) {}
      }
    }

    // SessionContext: Goal aus Befehl übernehmen
    sessionCtx.update({ current_step: task.command.substring(0, 80), perception });

    // ════════════════════════════
    // START_TRAINING — ganz oben!
    // ════════════════════════════
    if (parsed?.type === 'start_training') {
      console.log(`🎓 Training Task erkannt: "${parsed.command}"`);

      const tData = await fetch(`${API}/api/brain/training-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken, command: parsed.command })
      });
      const tRes = await tData.json();
      console.log(`🎓 Training Init:`, tRes);

      if (tRes.success && tRes.steps?.length > 0) {
        const realW = await nutScreen.width();
        const realH = await nutScreen.height();
        activeTraining = {
          route_id:   tRes.route_id,
          route_name: tRes.route_name,
          steps:      tRes.steps,
          current:    0,
          total:      tRes.steps.length,
          screenW:    realW,
          screenH:    realH
        };
      }

      let trainingWin = new BrowserWindow({
        width: 480, height: 420,
        alwaysOnTop: true,
        frame: false,
        movable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
      });
      trainingWin.loadFile('training-overlay.html');

      trainingWin.webContents.on('did-finish-load', () => {
        trainingWin.webContents.send('training-init', tRes);
      });

      await markTaskComplete(task.id, 'success');
      return;

    // ════════════════════════════
    // SCAN_FOLDER
    // ════════════════════════════
    } else if (parsed && parsed.type === 'scan_folder') {
      const fs = require('fs');
      const pathModule = require('path');
      const ExcelJS = require('exceljs');

      async function readPdf(filePath) {
        try {
          const pdfjsLib = require('pdfjs-dist');
          pdfjsLib.GlobalWorkerOptions.workerSrc = '';
          const data = new Uint8Array(fs.readFileSync(filePath));
          const doc = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
          let text = '';
          for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n';
          }
          return text.substring(0, 3000);
        } catch(e) {
          console.error('❌ PDF lesen:', e.message);
          return null;
        }
      }

      const folderPath = parsed.folder_path;
      const instruction = parsed.instruction || null;
      const filterExt = parsed.filter || 'alle';
      const mode = parsed.mode || 'folder';

      console.log(`📂 Mode: ${mode} | Pfad: ${folderPath} | Filter: ${filterExt}`);

      if (!fs.existsSync(folderPath)) throw new Error('Pfad nicht gefunden: ' + folderPath);

      let entries = [];
      const stat = fs.statSync(folderPath);

      if (stat.isDirectory()) {
        entries = fs.readdirSync(folderPath);
      } else {
        entries = [pathModule.basename(folderPath)];
      }

      const baseDir = stat.isDirectory() ? folderPath : pathModule.dirname(folderPath);
      const files = [];

      for (const entry of entries) {
        try {
          const fullPath = pathModule.join(baseDir, entry);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) continue;
          const ext = pathModule.extname(entry).toLowerCase().replace('.', '');
          if (filterExt !== 'alle' && ext !== filterExt) continue;
          files.push({
            name: entry,
            extension: ext || '(kein)',
            size_bytes: stat.size,
            size_kb: (stat.size / 1024).toFixed(1),
            created: stat.birthtime.toISOString().split('T')[0],
            modified: stat.mtime.toISOString().split('T')[0],
            full_path: fullPath,
            extracted: null,
            parsed_data: null
          });
        } catch(e) {}
      }

      console.log(`📄 ${files.length} Dateien gefunden`);

      const mammoth = require('mammoth');
      const IMAGE_EXTS = ['jpg','jpeg','png','webp','gif','bmp'];
      const TEXT_EXTS  = ['txt','csv','json','md','log','xml','html'];

      for (const file of files) {
        const ext = file.extension.replace('.','');
        try {
          if (ext === 'pdf') {
            file.extracted = await readPdf(file.full_path);
            file.content_type = 'text';
            if (file.extracted) console.log(`   📑 PDF: ${file.name} (${file.extracted.length} Zeichen)`);
          } else if (ext === 'docx' || ext === 'doc') {
            const buffer = fs.readFileSync(file.full_path);
            const result = await mammoth.extractRawText({ buffer });
            file.extracted = result.value.substring(0, 3000);
            file.content_type = 'text';
            console.log(`   📝 Word: ${file.name} (${file.extracted.length} Zeichen)`);
          } else if (TEXT_EXTS.includes(ext)) {
            file.extracted = fs.readFileSync(file.full_path, 'utf8').substring(0, 3000);
            file.content_type = 'text';
            console.log(`   📄 Text: ${file.name}`);
          } else if (IMAGE_EXTS.includes(ext)) {
            const buffer = fs.readFileSync(file.full_path);
            file.image_base64 = buffer.toString('base64');
            file.image_media_type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            file.content_type = 'image';
            console.log(`   🖼️ Bild: ${file.name}`);
          } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
            try {
              const wb2 = new ExcelJS.Workbook();
              if (ext === 'csv') { await wb2.csv.readFile(file.full_path); } else { await wb2.xlsx.readFile(file.full_path); }
              const ws = wb2.worksheets[0];
              let rows = [];
              ws.eachRow((row, i) => { if (i <= 50) rows.push(row.values.slice(1).join(' | ')); });
              file.extracted = rows.join('\n').substring(0, 3000);
              file.content_type = 'text';
              console.log(`   📊 Excel: ${file.name}`);
            } catch(e) { console.error(`   ❌ Excel lesen: ${e.message}`); }
          }
        } catch(e) { console.error(`   ❌ Lesen ${file.name}: ${e.message}`); }
      }

      if (instruction) {
        let finalFormat = parsed.output_format || 'xlsx';
        if (finalFormat === 'auto') {
          try {
            const fmtRes = await fetch(`${API}/api/agent/analyze-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, instruction, mode: 'format_only' }) });
            const fmtData = await fmtRes.json();
            const fmtText = (fmtData.format || 'xlsx').trim().toLowerCase();
            if (['xlsx','pdf','docx','txt'].includes(fmtText)) finalFormat = fmtText;
            console.log(`   🎯 MIRA wählt Format: ${finalFormat}`);
          } catch(e) { finalFormat = 'xlsx'; }
        }
        parsed.output_format = finalFormat;

        for (const file of files) {
          if (!file.extracted && !file.image_base64) continue;
          try {
            const r = await fetch(`${API}/api/agent/analyze-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, file_name: file.name, file_ext: file.extension, content_type: file.content_type, extracted: file.extracted || null, image_base64: file.image_base64 || null, image_media_type: file.image_media_type || null, instruction }) });
            const d = await r.json();
            if (d.success && d.parsed_data) { file.parsed_data = d.parsed_data; console.log(`   ✅ ${file.name}: ${JSON.stringify(file.parsed_data)}`); }
          } catch(e) { console.error(`   ❌ analyze-file error ${file.name}: ${e.message}`); }
        }
      }

      const outputFormat = parsed.output_format || 'xlsx';
      const desktop = require('path').join(require('os').homedir(), 'Desktop');
      const firstParsed = files.find(f => f.parsed_data);
      let existingNames = new Set();
      let newCount = 0;
      let outputPath;
      let fileBase64;
      let fileMimeType;

      function buildTextContent() {
        const lines = [];
        const now = new Date().toLocaleDateString('de-DE');
        lines.push(`MIRA Scan — ${now}`);
        lines.push(`Ordner: ${folderPath}`);
        lines.push(`Anweisung: ${instruction || '(keine)'}`);
        lines.push('');
        files.forEach((f, i) => {
          lines.push(`${i + 1}. ${f.name}`);
          if (f.parsed_data) { Object.entries(f.parsed_data).forEach(([k, v]) => { if (v !== null) lines.push(`   ${k}: ${v}`); }); }
          else { lines.push(`   Typ: ${f.extension} | Groesse: ${f.size_kb} KB | Datum: ${f.modified}`); }
          lines.push('');
        });
        return lines.join('\n');
      }

      const baseName = pathModule.basename(folderPath, pathModule.extname(folderPath));

      if (outputFormat === 'xlsx') {
        outputPath = mode === 'continue' && ['.xlsx','.xls','.csv'].includes(pathModule.extname(folderPath).toLowerCase()) ? folderPath : pathModule.join(desktop, `MIRA_${baseName}.xlsx`);
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'MIRA Agent';
        let sheet;
        if (fs.existsSync(outputPath)) {
          await workbook.xlsx.readFile(outputPath);
          sheet = workbook.getWorksheet('MIRA Scan') || workbook.addWorksheet('MIRA Scan');
          sheet.eachRow((row, rowNum) => { if (rowNum > 1) { const val = row.getCell(1).value; if (val) existingNames.add(String(val).trim()); } });
          console.log(`📋 ${existingNames.size} bereits vorhanden`);
        } else { sheet = workbook.addWorksheet('MIRA Scan'); }
        let headers;
        if (firstParsed && firstParsed.parsed_data) { const keys = Object.keys(firstParsed.parsed_data); headers = [...keys.map(k => k.charAt(0).toUpperCase() + k.slice(1)), 'Dateiname', 'Typ', 'Groesse', 'Datum']; }
        else { headers = ['Dateiname', 'Typ', 'Groesse (KB)', 'Erstellt', 'Geaendert']; }
        if (!sheet.getRow(1).getCell(1).value) {
          const hr = sheet.getRow(1);
          headers.forEach((h, i) => { const cell = hr.getCell(i + 1); cell.value = h; cell.font = { bold: true, name: 'Arial', size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }; cell.alignment = { horizontal: 'left', vertical: 'middle' }; cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }; });
          hr.height = 20; hr.commit();
        }
        sheet.columns = headers.map(() => ({ width: 22 }));
        for (const file of files) {
          if (existingNames.has(file.name)) continue;
          const rowData = [];
          if (firstParsed && firstParsed.parsed_data && file.parsed_data) { Object.keys(firstParsed.parsed_data).forEach(k => rowData.push(file.parsed_data[k] ?? '')); rowData.push(file.name, file.extension, file.size_kb, file.modified); }
          else { rowData.push(file.name, file.extension, file.size_kb, file.created, file.modified); }
          const row = sheet.addRow(rowData);
          row.eachCell(cell => { cell.font = { name: 'Arial', size: 10 }; cell.alignment = { vertical: 'middle' }; cell.border = { bottom: { style: 'hair', color: { argb: 'FFEEEEEE' } } }; });
          row.height = 18; newCount++; existingNames.add(file.name);
        }
        await workbook.xlsx.writeFile(outputPath);
        const buf = fs.readFileSync(outputPath);
        fileBase64 = buf.toString('base64');
        fileMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        console.log(`✅ xlsx: ${newCount} neu → ${outputPath}`);
      } else if (outputFormat === 'txt') {
        outputPath = pathModule.join(desktop, `MIRA_${baseName}.txt`);
        const textContent = buildTextContent();
        if (fs.existsSync(outputPath)) { fs.appendFileSync(outputPath, '\n---\n' + textContent, 'utf8'); } else { fs.writeFileSync(outputPath, textContent, 'utf8'); }
        fileBase64 = Buffer.from(textContent).toString('base64');
        fileMimeType = 'text/plain';
        newCount = files.length;
        console.log(`✅ txt → ${outputPath}`);
      } else if (outputFormat === 'pdf' || outputFormat === 'docx') {
        const textContent = buildTextContent();
        const genRes = await fetch(`${API}/api/agent/generate-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, format: outputFormat, content: textContent, files: files.map(f => ({ name: f.name, extension: f.extension, size_kb: f.size_kb, modified: f.modified, parsed_data: f.parsed_data || null })), instruction: instruction || '', folder_path: folderPath }) });
        const genData = await genRes.json();
        console.log(`📄 generate-file response: success=${genData.success} error=${genData.error || 'none'} base64_len=${genData.file_base64?.length || 0}`);
        if (genData.success && genData.file_base64) {
          fileBase64 = genData.file_base64;
          fileMimeType = outputFormat === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          outputPath = pathModule.join(desktop, `MIRA_${baseName}.${outputFormat}`);
          fs.writeFileSync(outputPath, Buffer.from(fileBase64, 'base64'));
          newCount = files.length;
          console.log(`✅ ${outputFormat} vom Server → ${outputPath}`);
        } else { console.error(`❌ generate-file fehlgeschlagen: ${genData.error}`); }
      }

      await fetch(`${API}/api/agent/update-scan-cache`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, folder_path: folderPath, files: files.map(f => ({ name: f.name, extension: f.extension, size_kb: f.size_kb, modified: f.modified, is_new: !existingNames.has(f.name), parsed_data: f.parsed_data })) }) });
      await fetch(`${API}/api/agent/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, task_id: task.id, status: 'success', result: { files_count: files.length, new_files: newCount, skipped: files.length - newCount, output_path: outputPath, output_format: outputFormat, folder_path: folderPath, xlsx_base64: fileBase64, file_base64: fileBase64, format: outputFormat, file_mime_type: fileMimeType } }) });
      if (mainWindow) { mainWindow.webContents.send('scan-complete', { files_count: files.length, new_files: newCount, path: outputPath, files: files }); }

    // ════════════════════════════
    // FILE_TASK — Datei-Pipeline
    // ════════════════════════════
    } else if (parsed?.type === 'file_task') {
      const ftLog = async (message, type = 'step', extra = {}) => {
        if (message) console.log(`📋 [file_task] ${type}: ${message}`);
        // Fire-and-forget — nie blockieren (Server kann offline sein)
        fetchWithTimeout(`${API}/api/agent/file-task-log`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, task_id: task.id, message, type, ...extra })
        }, 5000).catch(() => {});
      };

      const { search_patterns, source_dirs, target_filename, target_format = 'xlsx', action, instruction, append_if_exists, custom_headers, artifact_id, artifact_name, rows_to_add } = parsed;

      // ── Profil laden (fire-and-forget — Server kann offline sein) ────────
      if (!userProfileSettings.company_name) loadUserProfileSettings().catch(() => {});
      const ftProfile = userProfileSettings;

      // ══════════════════════════════════════════════════════════════
      // ARTIFACT EDIT — Zeilen in bestehendes Artifact eintragen
      // ══════════════════════════════════════════════════════════════
      const resolvedArtifactId   = artifact_id   || lastActiveArtifact?.id   || null;
      const resolvedArtifactName = artifact_name || lastActiveArtifact?.name || 'Artifact';

      if (action === 'artifact_edit') {
        // Kein Artifact verfügbar → sofort abbrechen (kein Endlos-Fallthrough)
        if (!resolvedArtifactId) {
          await ftLog('⚠️ Kein Artifact aktiv. Bitte öffne zuerst ein Artifact im Dokumente-Bereich.', 'error');
          await ftLog(null, 'done', { done: true, summary: { error: true, error_msg: 'Kein Artifact aktiv' } });
          await fetchWithTimeout(`${API}/api/agent/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken, task_id: task.id, status: 'error', result: { error: 'Kein Artifact aktiv' } })
          }, 10000).catch(() => {});
          return;
        }
        await ftLog(`📂 Lade Artifact "${resolvedArtifactName}"...`, 'step');
        try {
          const ExcelJS = require('exceljs');

          // 1. Artifact laden — direkt via Supabase (device-token hat kein id-Feld,
          //    deshalb kein API-Roundtrip → kein user_id-Problem)
          let artRow = null;
          console.log(`🗂️ artifact_edit: id=${resolvedArtifactId} name="${resolvedArtifactName}" rows=${JSON.stringify(rows_to_add)}`);
          const artRows = await directSupabase('GET', `/artifacts?id=eq.${resolvedArtifactId}&limit=1&select=*`);
          artRow = artRows?.[0] || null;
          console.log(`🗂️ Artifact geladen: ${artRow ? `type=${artRow.type} data=${artRow.data_base64?.length || 0} bytes` : 'NICHT GEFUNDEN'}`);

          // Fallback: Vercel-Endpoint (falls directSupabase keys nicht geladen)
          if (!artRow) {
            try {
              const artRes = await fetchWithTimeout(`${API}/api/artifacts/${resolvedArtifactId}`, {
                headers: { 'Authorization': `Bearer ${userToken}` }
              }, 6000);
              const artData = await artRes.json();
              artRow = artData?.artifact || null;
            } catch(_) {}
          }

          const artType  = (artRow?.type || 'xlsx').toLowerCase();
          const rowsArr  = Array.isArray(rows_to_add) ? rows_to_add : (rows_to_add ? [rows_to_add] : [{}]);
          let newB64, mime, logMsg, rowCount = rowsArr.length;

          // ── DOCX — Word-Artifact ──────────────────────────────────────────
          if (artType === 'docx') {
            const { Document, Packer, Paragraph, TextRun } = require('docx');
            const today = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });

            // Alten Inhalt via mammoth extrahieren (docx-lib kann nicht lesen, nur schreiben)
            let existingLines = [];
            if (artRow?.data_base64) {
              try {
                const mammoth = require('mammoth');
                const result  = await mammoth.extractRawText({ buffer: Buffer.from(artRow.data_base64, 'base64') });
                existingLines = result.value.split('\n').filter(l => l.trim());
              } catch(_) {}
            }

            const paragraphs = [];
            // Bestehende Zeilen wiederherstellen
            for (const line of existingLines) {
              paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Arial' })] }));
            }
            // Trennlinie + neue Einträge
            if (existingLines.length) {
              paragraphs.push(new Paragraph({ children: [new TextRun({ text: '─────────────────────────────', color: 'AAAAAA' })] }));
              paragraphs.push(new Paragraph({ children: [new TextRun({ text: 'Ergänzt am ' + today, size: 20, color: '888888', italics: true })] }));
            }
            for (const rowObj of rowsArr) {
              const line = typeof rowObj === 'string' ? rowObj
                : Object.entries(rowObj).map(([k,v]) => `${k}: ${v}`).join(' | ');
              paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Arial' })] }));
            }
            const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
            newB64  = Buffer.from(await Packer.toBuffer(doc)).toString('base64');
            mime    = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            logMsg  = `✅ ${rowsArr.length} Absatz/Absätze in Word-Artifact eingetragen.`;

          // ── TXT / TEXT / CODE — Rohtext ───────────────────────────────────
          } else if (['txt','text','code','md'].includes(artType)) {
            const existing = artRow?.data_base64 ? Buffer.from(artRow.data_base64, 'base64').toString('utf8') : '';
            const today    = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
            const newLines = rowsArr.map(r => typeof r === 'string' ? r
              : Object.entries(r).map(([k,v]) => `${k}: ${v}`).join('\n')).join('\n');
            const updated  = existing ? `${existing}\n\n--- Ergänzt ${today} ---\n${newLines}` : newLines;
            newB64  = Buffer.from(updated, 'utf8').toString('base64');
            mime    = 'text/plain';
            logMsg  = `✅ Text in Artifact eingetragen.`;

          // ── XLSX (default) — Excel-Artifact ──────────────────────────────
          } else {
            const wb = new ExcelJS.Workbook();
            if (artRow?.data_base64) {
              try { await wb.xlsx.load(Buffer.from(artRow.data_base64, 'base64')); } catch(_) {}
            }
            let ws = wb.worksheets[0];
            let headers = [];
            if (!ws) {
              ws = wb.addWorksheet('Daten');
              headers = Object.keys(rowsArr[0] || {});
              if (headers.length) ws.addRow(headers);
            } else {
              ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
                headers[col - 1] = cell.value?.toString() || '';
              });
              if (!headers.filter(Boolean).length) {
                headers = Object.keys(rowsArr[0] || {});
                ws.insertRow(1, headers);
              }
            }
            // ── Dispatcher: User-Input → richtige Spalten mappen ──────────────
            let mappedRowsArr = rowsArr;
            if (headers.filter(Boolean).length > 0) {
              try {
                const userText = instruction || JSON.stringify(rowsArr);
                const mappingResult = await directOpenAI([{
                  role: 'user',
                  content: `Tabellen-Spalten: ${headers.filter(Boolean).join(', ')}\nUser möchte eintragen: "${userText}"\nRohdaten: ${JSON.stringify(rowsArr)}\n\nErstelle ein JSON-Array mit EXAKT den Spaltennamen der Tabelle. Fülle leere Felder mit "". Antworte NUR mit dem JSON-Array.`
                }], { max_tokens: 400, temperature: 0 });
                if (mappingResult) {
                  const clean = mappingResult.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
                  const parsed = JSON.parse(clean);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    mappedRowsArr = parsed;
                    console.log(`🗺️ Dispatcher gemappt:`, JSON.stringify(mappedRowsArr));
                  }
                }
              } catch(e) { console.warn('⚠️ Dispatcher fehlgeschlagen, nutze Original:', e.message); }
            }
            for (const rowObj of mappedRowsArr) {
              ws.addRow(headers.map(h => rowObj[h] !== undefined ? rowObj[h] : ''));
            }
            rowCount = ws.rowCount - 1;
            newB64   = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
            mime     = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            logMsg   = `✅ ${rowsArr.length} Zeile(n) eingetragen. Gesamt: ${rowCount} Zeilen.`;
          }

          await ftLog(logMsg, 'step');

          // DB updaten
          const oldMeta = artRow?.metadata || {};
          const newMeta = artType === 'xlsx' ? { ...oldMeta, rows: rowCount } : { ...oldMeta };
          const patchResult = await directSupabase('PATCH', `/artifacts?id=eq.${resolvedArtifactId}`, {
            data_base64: newB64,
            metadata: newMeta,
            updated_at: new Date().toISOString()
          });
          console.log(`🗂️ Artifact PATCH: ${patchResult ? '✅ OK' : '❌ fehlgeschlagen'} (${newB64?.length || 0} bytes)`);

          // Lokale Datei auf Disk updaten (damit die xlsx auf Desktop aktuell ist)
          try {
            const fs = require('fs');
            const localFiles = await ftFindFiles([resolvedArtifactName]);
            const localPath = localFiles?.[0]?.path || null;
            if (localPath && fs.existsSync(localPath)) {
              fs.writeFileSync(localPath, Buffer.from(newB64, 'base64'));
              console.log(`💾 Lokale Datei aktualisiert: ${localPath}`);
            }
          } catch(e) { console.warn('⚠️ Lokale Datei update fehlgeschlagen:', e.message); }

          const artSummary = {
            is_artifact_update: true, artifact_id: resolvedArtifactId, artifact_name: resolvedArtifactName,
            rows_written: rowsArr.length, files_count: 1,
            file_base64: newB64, mime,
            target_filename: resolvedArtifactName || `Artifact.${artType}`
          };
          await ftLog(null, 'done', { done: true, summary: artSummary });
          await fetchWithTimeout(`${API}/api/agent/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken, task_id: task.id, status: 'success', result: artSummary })
          }, 10000).catch(() => {});
          return;
        } catch(e) {
          console.error('❌ artifact_edit:', e.message);
          await ftLog(`❌ Fehler: ${e.message}`, 'error');
          await ftLog(null, 'done', { done: true, summary: { error: true, error_msg: e.message } });
          await fetchWithTimeout(`${API}/api/agent/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken, task_id: task.id, status: 'error', result: { error: e.message } })
          }, 10000).catch(() => {});
          return;
        }
      }

      // ── Direkt erstellen: kein Datei-Scan nötig ──────────────────────
      // write_brief = Dokument aus Instruction erstellen (kein Quell-Scan)
      // create_excel = neue Excel-Tabelle (kein Quell-Scan)
      const isDirectCreate = action === 'create_excel' || action === 'write_brief';

      // ── 1. DATEIEN SUCHEN (nur wenn kein direktes Erstellen) ──────────
      let foundFiles = [];
      if (!isDirectCreate) {
        await ftLog('🔍 Durchsuche deinen chaotischen PC... mein Gott ist es hier voll...');
        foundFiles = await ftFindFiles(search_patterns, source_dirs);
        console.log(`🗂️ file_task: ${foundFiles.length} Dateien gefunden`);
      }

      if (isDirectCreate || foundFiles.length === 0) {
        // ── Neue Datei erstellen (explizit angefordert oder keine Quelldatei gefunden) ──
        const logMsg = isDirectCreate
          ? '📋 Erstelle neue Datei...'
          : '📋 Keine passende Datei gefunden — erstelle neue Datei...';
        await ftLog(logMsg, 'step');

        const profileHeaders = ftProfile.excel_headers
          ? ftProfile.excel_headers.split(',').map(h => h.trim()).filter(Boolean)
          : null;
        const defaultHeaderMap = {
          extract_to_excel: ['Datum', 'Absender', 'Betreff', 'Netto', 'MwSt', 'Brutto', 'IBAN'],
          invoice_extract:  ['Datum', 'Rechnungsnummer', 'Absender', 'Netto', 'MwSt', 'Brutto', 'IBAN'],
          create_excel:     ['Datum', 'Beschreibung', 'Betrag', 'Kategorie'],
        };
        // Priorität: custom_headers vom User > Profil-Headers > Action-Default > generisch
        const emptyHeaders = (custom_headers?.length ? custom_headers : null)
          || profileHeaders
          || defaultHeaderMap[action]
          || ['Datum', 'Beschreibung', 'Betrag', 'Kategorie'];

        let newFileResult = null;
        try {
          const emptyData = (action === 'write_docx' || action === 'write_pdf')
            ? { text: '' }
            : { headers: emptyHeaders, rows: [] };
          newFileResult = await ftWriteOutput({ ...parsed, append_if_exists: false }, [], emptyData, ftProfile);
        } catch(e) { console.error('❌ Neue Datei erstellen:', e.message); }

        const pathMod = require('path');
        const newName = newFileResult?.outputPath
          ? pathMod.basename(newFileResult.outputPath)
          : (target_filename || `MIRA_Neu.${target_format || 'xlsx'}`);

        const doneMsg = newFileResult
          ? `✅ Neue Datei erstellt: "${newName}" — direkt weiterarbeiten möglich.`
          : `❌ Datei nicht gefunden und neue Datei konnte nicht erstellt werden.`;
        await ftLog(doneMsg, newFileResult ? 'step' : 'error');

        // Artifact in Supabase speichern
        let newArtifactId = null;
        if (newFileResult?.fileBase64) {
          const artType = (target_format || 'xlsx').toLowerCase();
          const saved = await saveAsArtifact({ name: newName, type: artType, fileBase64: newFileResult.fileBase64, rowCount: 0 });
          newArtifactId = saved?.id || null;
        }

        const newSummary = {
          files_count: 0, rows_written: 0, is_new_file: true,
          output_path:     newFileResult?.outputPath || null,
          target_filename: newName,
          file_base64:     newFileResult?.fileBase64 || null,
          mime:            newFileResult?.mime       || null,
          artifact_id:     newArtifactId,
          error: !newFileResult
        };
        await ftLog(null, 'done', { done: true, summary: newSummary });
        await fetchWithTimeout(`${API}/api/agent/complete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, task_id: task.id, status: newFileResult ? 'success' : 'error', result: newSummary })
        }, 10000).catch(() => {});
        return;
      }

      const fileNames = foundFiles.map(f => f.name).join(', ');
      await ftLog(`📂 Gefunden: ${fileNames}`, 'found');

      // ── Bestehende Zieldatei: rekursiv suchen + Spalten auslesen (für Append-Matching) ──
      let targetFileColHeaders = [];
      let resolvedTargetPath = null;
      if (target_filename && (target_format === 'xlsx' || !target_format)) {
        const targetFound = await ftFindFiles([target_filename]);
        resolvedTargetPath = targetFound?.[0]?.path || null;
        if (resolvedTargetPath) {
          try {
            const ExcelJS = require('exceljs');
            const wbTmp = new ExcelJS.Workbook();
            await wbTmp.xlsx.readFile(resolvedTargetPath);
            const shTmp = wbTmp.getWorksheet(1);
            if (shTmp) {
              const hdrRowNum = findHeaderRow(shTmp);
              shTmp.getRow(hdrRowNum).eachCell({ includeEmpty: false }, (cell) => {
                if (cell.value) targetFileColHeaders.push(cell.value.toString().trim());
              });
              console.log(`📊 Zieldatei gefunden: ${resolvedTargetPath}`);
              console.log(`📊 Zieldatei Header in Zeile ${hdrRowNum}: [${targetFileColHeaders.join(', ')}]`);
            }
          } catch(_) {}
        } else {
          console.log(`📊 Zieldatei "${target_filename}" nicht gefunden → wird neu erstellt`);
        }
      }

      // ── 2. LESEN + EXTRAHIEREN ────────────────────────────────────────
      // Entscheiden ob JSON-Extraktion oder Text-Ausgabe benötigt wird
      const needsJsonExtract = (action === 'extract_to_excel' || action === 'append_section')
        && target_format !== 'pdf' && target_format !== 'docx' && target_format !== 'txt';

      // ── 2a. ALLE DATEIEN LESEN (lokal, kein Netzwerk) ─────────────────
      const fileContents = [];
      for (let i = 0; i < foundFiles.length; i++) {
        const file = foundFiles[i];
        await ftLog(`📄 Lese ${file.name}... ${ftSark(i)}`);
        const content = await ftReadFile(file.path);
        if (content === null || content === undefined) {
          await ftLog(`⚠️ ${file.name} konnte nicht gelesen werden.`, 'step');
          continue;
        }
        const safeContent = content.trim() || `[${file.name} – kein lesbarer Text, möglicherweise gescanntes Bild]`;
        fileContents.push({ name: file.name, ext: file.ext || '', content: safeContent });
      }

      // ── 2b. EINEN EINZIGEN BATCH-CALL — alle Dateien in einem Request ──
      // → kein N×Cold-Start, kein N×Timeout, 1 Vercel-Aufruf statt N
      const allExtracted = [];
      if (fileContents.length > 0) {
        const batchMode = needsJsonExtract ? 'extract' : 'summarize';
        await ftLog(`🧮 Analysiere ${fileContents.length} Datei(en) in einem Durchgang...`);
        try {
          const batchRes = await fetch(`${API}/api/agent/analyze-batch`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken,
              files: fileContents,
              mode: batchMode,
              instruction: instruction || buildFtInstruction(action, target_format, targetFileColHeaders)
            })
          });
          const batchData = await batchRes.json();

          if (batchData.success && batchMode === 'summarize' && batchData.summary_text) {
            // Eine gemeinsame Zusammenfassung für alle Dateien
            allExtracted.push({ file: fileContents.map(f => f.name).join(', '), rawText: batchData.summary_text });
          } else if (batchData.success && batchMode === 'extract' && Array.isArray(batchData.results)) {
            // Ergebnis: Array von Zeilen-Arrays (eine Datei → mehrere Zeilen möglich)
            batchData.results.forEach((result, i) => {
              const fname = fileContents[i]?.name || `Datei ${i + 1}`;
              // Normalisieren: immer Array von Zeilen-Objekten
              const rows = Array.isArray(result)
                ? result.filter(r => r && typeof r === 'object' && !Array.isArray(r))
                : (result && typeof result === 'object' ? [result] : []);
              if (rows.length > 0) {
                rows.forEach(row => allExtracted.push({ file: fname, data: row }));
              } else {
                allExtracted.push({ file: fname, rawText: fileContents[i]?.content || '' });
              }
            });
          } else {
            // Fallback: rohe Texte als Zusammenfassung verwenden
            console.warn('⚠️ Batch fehlgeschlagen, verwende rohe Texte:', batchData.error);
            fileContents.forEach(f => allExtracted.push({ file: f.name, rawText: f.content }));
          }
        } catch(e) {
          console.error('❌ analyze-batch:', e.message);
          // Fallback: rohe Texte
          fileContents.forEach(f => allExtracted.push({ file: f.name, rawText: f.content }));
        }
      }

      // ── 3. OUTPUT BAUEN ──────────────────────────────────────────────
      await ftLog(`✍️ Schreibe ${target_filename || 'Ausgabedatei'}... Zeile für Zeile, wie ein Buchhalter der nie schläft...`);

      if (allExtracted.length === 0) {
        await ftLog('😐 Konnte keinen lesbaren Inhalt aus den Dateien extrahieren. Gescannte PDFs ohne OCR? Da kann ich nichts lesen.', 'error');
        await ftLog(null, 'done', { done: true, summary: { files_count: foundFiles.length, rows_written: 0, error: true, error_msg: 'Kein lesbarer Inhalt' } });
        await fetch(`${API}/api/agent/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, task_id: task.id, status: 'error', result: { error: 'Kein lesbarer Inhalt' } }) });
        return;
      }

      // Gefundenen Zieldatei-Pfad durchreichen (damit ftWriteOutput nicht nochmal sucht)
      const parsedWithTarget = resolvedTargetPath
        ? { ...parsed, target_path: resolvedTargetPath, append_if_exists: true }
        : parsed;

      let outputResult = null;
      try {
        if (action === 'summarize' || action === 'write_report' || action === 'read_to_chat' || action === 'create_pdf' || target_format === 'pdf') {
          // Text-basierte Ausgabe: rawText direkt verwenden (analyze-file wurde bereits übersprungen)
          const summaryText = allExtracted.map(e =>
            `# ${e.file}\n${e.rawText || JSON.stringify(e.data, null, 2)}`
          ).join('\n\n');
          // create_pdf → immer pdf, sonst target_format (xlsx→txt als Fallback)
          const outFmt = (action === 'create_pdf' || target_format === 'pdf') ? 'pdf'
                       : target_format === 'xlsx' ? 'txt' : target_format;
          outputResult = await ftWriteOutput({ ...parsedWithTarget, target_format: outFmt, append_if_exists }, foundFiles, { text: summaryText }, ftProfile);
        } else if (action === 'write_brief') {
          // Brief / Word-Dokument DIN 5008
          const briefText = allExtracted.map(e => e.rawText || JSON.stringify(e.data, null, 2)).join('\n\n');
          outputResult = await ftWriteOutput({ ...parsedWithTarget, target_format: 'docx', append_if_exists }, foundFiles, { text: briefText }, ftProfile);
        } else {
          // extract_to_excel (default) + append_section
          const firstData = allExtracted.find(e => e.data);
          const headers = firstData ? Object.keys(firstData.data) : ['Datei', 'Inhalt'];
          const rows = allExtracted.filter(e => e.data).map(e => {
            const row = {};
            headers.forEach(h => { row[h] = e.data[h] ?? ''; });
            return row;
          });
          outputResult = await ftWriteOutput(parsedWithTarget, foundFiles, { headers, rows }, ftProfile);
        }
      } catch(e) {
        console.error('❌ ftWriteOutput:', e.message);
        await ftLog(`❌ Fehler beim Schreiben: ${e.message}`, 'error');
      }

      // ── 4. FERTIG ─────────────────────────────────────────────────────
      const doneMsg = outputResult
        ? `✅ Fertig. ${foundFiles.length} Datei(en) verarbeitet, ${outputResult.newCount} Einträge geschrieben. Du kannst mich jetzt loben.`
        : `⚠️ Verarbeitung abgeschlossen, aber Ausgabe fehlgeschlagen.`;
      await ftLog(doneMsg, 'step');

      // Artifact in Supabase speichern (nie leer lassen)
      let artifactId = null;
      if (outputResult?.fileBase64) {
        const artType = (target_format || 'xlsx').toLowerCase();
        const artName = target_filename || `MIRA_Output.${artType}`;
        const saved = await saveAsArtifact({ name: artName, type: artType, fileBase64: outputResult.fileBase64, rowCount: outputResult.newCount || 0 });
        artifactId = saved?.id || null;
      }

      const summary = {
        files_count: foundFiles.length,
        rows_written: outputResult?.newCount || 0,
        output_path: outputResult?.outputPath || null,
        target_filename: target_filename || null,
        file_base64: outputResult?.fileBase64 || null,
        mime: outputResult?.mime || null,
        artifact_id: artifactId,
        error: !outputResult
      };
      await ftLog(null, 'done', { done: true, summary });
      // complete mit Timeout — Vercel darf hier nicht ewig hängen
      await fetchWithTimeout(`${API}/api/agent/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken, task_id: task.id, status: outputResult ? 'success' : 'error', result: summary })
      }, 10000).catch(e => console.warn('⚠️ complete timeout:', e.message));

    // ════════════════════════════
    // CODE_TASK — MIRA Code (rekursiver Tool-Loop, Cline-Muster)
    // ════════════════════════════
    } else if (parsed?.type === 'code_task') {
      const fs = require('fs');
      const pathMod = require('path');
      const { execSync } = require('child_process');
      const os = require('os');

      // Fire-and-forget log to server + console
      const ctLog = (message, type = 'step') => {
        if (message) console.log(`💻 [code_task] ${type}: ${message}`);
        fetchWithTimeout(`${API}/api/agent/file-task-log`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, task_id: task.id, message, type })
        }, 5000).catch(() => {});
      };

      // Claude call mit Retry (3x, exponentiell) — längerer Timeout für Code
      const callClaude = async (messages, systemPrompt) => {
        if (!_dk?.claudeKey) throw new Error('Kein Claude Key verfügbar');
        if (_dk.expiresAt && Date.now() > _dk.expiresAt) await bootstrap();
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': _dk.claudeKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                system: systemPrompt,
                messages,
              }),
            }, 90000);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            return data.content?.[0]?.text || null;
          } catch(e) {
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
            } else throw e;
          }
        }
      };

      // XML-Tool-Calls aus AI-Antwort parsen
      const parseToolCalls = (text) => {
        const tools = [];
        const known = ['read_file','write_file','list_files','execute_command','search_files','attempt_completion'];
        const re = /<(read_file|write_file|list_files|execute_command|search_files|attempt_completion)>([\s\S]*?)<\/\1>/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const [, name, inner] = m;
          const params = {};
          const pr = /<(\w+)>([\s\S]*?)<\/\1>/g;
          let pm;
          while ((pm = pr.exec(inner)) !== null) params[pm[1]] = pm[2].trim();
          tools.push({ name, params });
        }
        return tools;
      };

      // Tool ausführen → Ergebnis-String
      const executeTool = async (toolName, params) => {
        try {
          switch (toolName) {
            case 'read_file': {
              const p = params.path;
              if (!p) return 'Fehler: Kein Pfad angegeben';
              if (!fs.existsSync(p)) return `Fehler: Datei nicht gefunden: ${p}`;
              const content = fs.readFileSync(p, 'utf8');
              return content.length > 8000 ? content.substring(0, 8000) + '\n... [gekürzt auf 8000 Zeichen]' : content;
            }
            case 'write_file': {
              const p = params.path;
              const content = params.content || '';
              if (!p) return 'Fehler: Kein Pfad angegeben';
              fs.mkdirSync(pathMod.dirname(p), { recursive: true });
              fs.writeFileSync(p, content, 'utf8');
              return `✅ Datei gespeichert: ${p} (${content.split('\n').length} Zeilen)`;
            }
            case 'list_files': {
              const dir = params.path || os.homedir();
              if (!fs.existsSync(dir)) return `Fehler: Verzeichnis nicht gefunden: ${dir}`;
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              return entries.slice(0, 60).map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
            }
            case 'execute_command': {
              const cmd = params.command;
              if (!cmd) return 'Fehler: Kein Befehl';
              const cwd = params.cwd || os.homedir();
              try {
                const out = execSync(cmd, { timeout: 30000, encoding: 'utf8', cwd });
                return (out || '(kein Output)').substring(0, 2000);
              } catch(e) {
                return `Exit-Code ${e.status || '?'}: ${(e.stdout || e.stderr || e.message).substring(0, 1000)}`;
              }
            }
            case 'search_files': {
              const pattern = params.pattern;
              const dir = params.path || os.homedir();
              if (!pattern) return 'Fehler: Kein Suchmuster';
              try {
                const out = execSync(
                  `grep -r ${JSON.stringify(pattern)} ${JSON.stringify(dir)} --include="*.js" --include="*.ts" --include="*.py" --include="*.json" -l 2>/dev/null | head -20`,
                  { timeout: 10000, encoding: 'utf8' }
                );
                return out.trim() || 'Keine Ergebnisse';
              } catch(e) { return 'Keine Ergebnisse'; }
            }
            default: return `Unbekanntes Tool: ${toolName}`;
          }
        } catch(e) {
          return `Tool-Fehler (${toolName}): ${e.message.substring(0, 300)}`;
        }
      };

      const CT_SYSTEM = `Du bist MIRA Code — ein präziser KI-Coding-Assistent der auf dem Desktop des Users läuft.

Du hast folgende Tools (XML-Format):

<read_file>
<path>/absoluter/pfad/zur/datei.js</path>
</read_file>

<write_file>
<path>/absoluter/pfad/zur/datei.js</path>
<content>
// vollständiger code hier
</content>
</write_file>

<list_files>
<path>/verzeichnis/pfad</path>
</list_files>

<execute_command>
<command>node script.js</command>
<cwd>/optionales/verzeichnis</cwd>
</execute_command>

<search_files>
<pattern>suchbegriff</pattern>
<path>/verzeichnis</path>
</search_files>

<attempt_completion>
<result>Kurze Zusammenfassung was gemacht wurde</result>
</attempt_completion>

REGELN:
- Lies Dateien IMMER zuerst bevor du sie änderst (read_file)
- Schreibe immer vollständige Dateien mit write_file (kein partieller Code)
- Bei Fehlern: analysiere den Fehler, korrigiere und versuche erneut
- Beende IMMER mit attempt_completion
- Antworte auf Deutsch`;

      try {
        const { action, target_file, target_dir, instruction, language, original_command } = parsed;
        await ctLog(`🔍 Starte: "${original_command || instruction}"...`);

        // Zieldatei-Hinweis für AI
        let targetHint = '';
        if (target_file) {
          const found = await ftFindFiles([target_file], target_dir ? [target_dir] : null);
          const fp = found?.[0]?.path;
          if (fp) {
            targetHint = `\nZieldatei auf dem Desktop: ${fp}`;
            await ctLog(`📄 Zieldatei: ${fp}`);
          } else {
            const guessPath = pathMod.join(os.homedir(), 'Desktop', target_file);
            targetHint = `\nNoch nicht vorhanden, erstellen unter: ${guessPath}`;
          }
        }

        // Startmessage
        const messages = [{
          role: 'user',
          content: `Aufgabe: ${instruction}${targetHint}\nAktion: ${action || 'edit_code'}${language ? `\nSprache: ${language}` : ''}`
        }];

        let iteration = 0;
        const MAX_ITER = 10;
        let completionResult = null;
        let writtenFiles = [];
        let execOutputs = [];

        // ── Rekursiver Tool-Loop ────────────────────────────────────────────
        while (iteration < MAX_ITER) {
          iteration++;
          ctLog(`🤔 Schritt ${iteration}/${MAX_ITER}...`);

          const aiResponse = await callClaude(messages, CT_SYSTEM);
          if (!aiResponse) throw new Error('Keine Antwort von Claude');

          // Erste Zeile als Preview loggen
          const firstLine = aiResponse.split('\n').find(l => l.trim()) || '';
          ctLog(`💬 ${firstLine.substring(0, 180)}`);

          const toolCalls = parseToolCalls(aiResponse);

          // Keine Tools → entweder done oder nudge
          if (toolCalls.length === 0) {
            if (iteration >= 3) { completionResult = aiResponse; break; }
            messages.push({ role: 'assistant', content: aiResponse });
            messages.push({ role: 'user', content: 'Nutze attempt_completion wenn du fertig bist, oder verwende Tools um fortzufahren.' });
            continue;
          }

          // attempt_completion → Ende
          const done = toolCalls.find(t => t.name === 'attempt_completion');
          if (done) {
            completionResult = done.params?.result || 'Fertig.';
            ctLog(`✅ ${completionResult}`);
            break;
          }

          // Tools ausführen, Ergebnisse sammeln
          messages.push({ role: 'assistant', content: aiResponse });
          const resultBlocks = [];

          for (const tool of toolCalls) {
            ctLog(`🔧 ${tool.name}${tool.params?.path ? ': ' + pathMod.basename(tool.params.path) : ''}`);
            const result = await executeTool(tool.name, tool.params);

            // Geschriebene Dateien merken
            if (tool.name === 'write_file' && tool.params?.path) {
              writtenFiles.push(tool.params.path);
              const lineCount = (tool.params?.content || '').split('\n').length;
              ctLog(`  ↳ ${lineCount} Zeilen geschrieben`);
            } else if (tool.name === 'execute_command') {
              execOutputs.push(result);
              ctLog(`  ↳ ${result.substring(0, 120)}`);
            } else {
              ctLog(`  ↳ ${result.substring(0, 120)}`);
            }

            resultBlocks.push(`<tool_result tool="${tool.name}">\n${result}\n</tool_result>`);
          }

          // Tool-Ergebnisse als nächste User-Nachricht zurückgeben
          messages.push({ role: 'user', content: resultBlocks.join('\n\n') });
        }

        // ── Artifact speichern (letzte geschriebene Datei) ──────────────────
        if (writtenFiles.length > 0) {
          const primary = writtenFiles[writtenFiles.length - 1];
          if (fs.existsSync(primary)) {
            const content = fs.readFileSync(primary, 'utf8');
            const ext = pathMod.extname(primary).replace('.', '') || language || 'js';
            const b64 = Buffer.from(content, 'utf8').toString('base64');
            await saveAsArtifact({ name: pathMod.basename(primary), type: ext, fileBase64: b64, rowCount: content.split('\n').length });
            ctLog(`💾 Artifact: ${pathMod.basename(primary)}`);
          }
        }

        // ── Git push wenn gewünscht ─────────────────────────────────────────
        if (action === 'git_push' && writtenFiles.length > 0) {
          try {
            const dir = pathMod.dirname(writtenFiles[0]);
            execSync(`cd "${dir}" && git add -A && git commit -m "MIRA: ${(instruction || '').substring(0, 60)}" && git push`, { timeout: 30000, encoding: 'utf8' });
            ctLog('🚀 Git push erfolgreich');
          } catch(e) {
            ctLog(`⚠️ Git: ${e.message.substring(0, 200)}`, 'error');
          }
        }

        ctLog(null, 'done');
        await fetchWithTimeout(`${API}/api/agent/complete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: userToken, task_id: task.id, status: 'success',
            result: { success: true, action, files: writtenFiles, summary: completionResult, exec_outputs: execOutputs, mime: 'text/plain' }
          })
        }, 10000).catch(() => {});

      } catch(e) {
        console.error('❌ code_task:', e.message);
        ctLog(`❌ Fehler: ${e.message}`, 'error');
        await fetchWithTimeout(`${API}/api/agent/complete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, task_id: task.id, status: 'error', result: { error: e.message } })
        }, 10000).catch(() => {});
      }

    // ════════════════════════════
    // RUN_ROUTE
    // ════════════════════════════
    } else if (task.command.startsWith('RUN_ROUTE:')) {
      const parts = task.command.split(':');
      const routeId = parts[1];
      const realW = await nutScreen.width();
      const realH = await nutScreen.height();
      const listRes = await fetch(`${API}/api/agent/route/list?token=${userToken}`);
      const listData = await listRes.json();
      let route = listData.routes?.find(r => r.id === routeId);
      if (!route) {
        // Fallback: check global template library
        try {
          const tmplRes  = await fetch(`${API}/api/templates/${routeId}?token=${userToken}`);
          const tmplData = await tmplRes.json();
          if (tmplData.success && tmplData.template) {
            route = tmplData.template;
            // Increment use_count asynchronously (fire-and-forget)
            fetch(`${API}/api/templates/${routeId}/use`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ token: userToken }),
            }).catch(() => {});
            console.log(`🌐 Template geladen: "${route.name}"`);
          }
        } catch (e) { console.warn(`🌐 Template-Fallback fehlgeschlagen: ${e.message}`); }
      }
      if (!route) { await markTaskComplete(task.id, 'failed'); return; }
      for (let i = 0; i < route.steps.length; i++) {
        const step = { ...route.steps[i], from_route: true };
        await executeRouteStep(step);
        await sleep(1200);
        const validSc = await takeCompressedScreenshot();
        const validRes = await fetch(`${API}/api/agent/route/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, route_id: routeId, screenshot: validSc, screen_size: { width: realW, height: realH }, current_step_index: i }) });
        const validData = await validRes.json();
        if (validData.validation && !validData.validation.ok && validData.validation.correction) {
          const { correction } = validData.validation;
          if (validData.validation.urlError) {
            console.log(`🔗 URL-Fehler: "${validData.validation.reason}" → clear_url + Retry`);
            if (mainWindow) mainWindow.webContents.send('url-error-detected', { reason: validData.validation.reason });
          }
          await executeRouteStep({ action: correction.action, coordinate: correction.coordinate, command: correction.value, screen_width: realW, screen_height: realH });
          await sleep(500); i--; continue;
        }
      }
      console.log(`✅ Route "${route.name}" fertig!`);
      await markTaskComplete(task.id, 'success');

    // ════════════════════════════
    // PREPROCESS / NORMAL TASK
    // ════════════════════════════
    } else {
      const sc = await takeCompressedScreenshot();
      const realW = await nutScreen.width();
      const realH = await nutScreen.height();

      // ── 1. Preprocess — bekannte Route? ──
      const preprocessRes = await fetch(`${API}/api/agent/preprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken, task: task.command, screenshot: sc, screen_size: { width: realW, height: realH } })
      });
      const preprocessData = await preprocessRes.json();
      console.log(`⚡ Preprocess: ${preprocessData.task_type} (${preprocessData.matched_by || 'none'})`);

      if (preprocessData.success && preprocessData.task_type === 'route') {
        // ── Bekannte Route ausführen ──
        const listRes = await fetch(`${API}/api/agent/route/list?token=${userToken}`);
        const listData = await listRes.json();
        const route = listData.routes?.find(r => r.id === preprocessData.route_id);
        if (!route) { await markTaskComplete(task.id, 'failed'); return; }
        for (let i = 0; i < route.steps.length; i++) {
          const step = { ...route.steps[i], from_route: true };
          await executeRouteStep(step);
          await sleep(1200);
          const validSc = await takeCompressedScreenshot();
          const validRes = await fetch(`${API}/api/agent/route/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, route_id: preprocessData.route_id, screenshot: validSc, screen_size: { width: realW, height: realH }, current_step_index: i }) });
          const validData = await validRes.json();
          if (validData.validation && !validData.validation.ok && validData.validation.correction) {
            const { correction } = validData.validation;
            if (validData.validation.urlError) {
              console.log(`🔗 URL-Fehler: "${validData.validation.reason}" → clear_url + Retry`);
              if (mainWindow) mainWindow.webContents.send('url-error-detected', { reason: validData.validation.reason });
            }
            await executeRouteStep({ action: correction.action, coordinate: correction.coordinate, command: correction.value, screen_width: realW, screen_height: realH });
            await sleep(500); i--; continue;
          }
        }
        console.log(`✅ Route "${route.name}" fertig!`);
        await markTaskComplete(task.id, 'success');

      } else {
        // ── Schaltzentrale — Consciousness-based Dispatch ──────────────────
        const szResult = await schaltzentrale.dispatch(task, {
          executeRouteStep,
          executeAction,
          sleep,
          userToken,
          API,
          mathChef,
          axLayer,
          sessionCtx,
          circuit,
          nutScreen,
          extractedValues,
          notifyUser: (type, text) => {
            if (mainWindow) mainWindow.webContents.send('mira-chat-message', { type, text });
          },
          abortFn: () => abortCurrentTask,
        });

        if (szResult === 'success') {
          await markTaskComplete(task.id, 'success');
        } else {
          // ── Letzter Fallback — alter /api/agent/execute Weg ────────────
          console.log(`⚡ Schaltzentrale kein Match → execute Fallback`);
          if (!userToken || !sc) {
            console.warn(`⚠️ Fallback skip: kein Token oder Screenshot`);
            if (mainWindow) mainWindow.webContents.send('mira-chat-message', {
              type: 'error',
              text: userToken ? '📸 Screenshot nicht verfügbar.' : '⚠️ Kein Token — bitte einloggen.'
            });
            await markTaskComplete(task.id, 'failed');
            return;
          }
          const scaleX = realW / 1280;
          const scaleY = realH / 720;
          const fallbackBib = bibLoader.findRelevant(task.command);
          const response = await fetch(`${API}/api/agent/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken, task: task.command, screenshot: sc,
              screen_size: { width: realW, height: realH },
              knowledge_context: fallbackBib.found ? fallbackBib.context : null,
            })
          });
          let data;
          try { data = await response.json(); }
          catch(je) { throw new Error(`Server Antwort kein JSON: ${je.message}`); }
          if (!data.success) throw new Error(data.message || data.error || 'execute-Fehler');
          for (let action of (data.actions || [])) {
            if (action.action === 'mouse_move' && action.coordinate) {
              action.coordinate[0] = Math.round(action.coordinate[0] * scaleX);
              action.coordinate[1] = Math.round(action.coordinate[1] * scaleY);
            }
            await executeAction(action);
          }
          await markTaskComplete(task.id, 'success');
        }
      }
    }

    // SessionContext: erledigten Schritt notieren
    sessionCtx.update({ step_done: task.command.substring(0, 60) });
    wahrnehmung.invalidate(); // Bildschirm hat sich verändert → Cache löschen

  } catch(error) {
    console.error('❌ Task error:', error);
    await markTaskComplete(task.id, 'failed');
  } finally {
    runningTasks.delete(task.id);
    if (runningTasks.size === 0 && mainWindow) {
      mainWindow.webContents.send('task-done');
    }
  }
}
// ═══════════════════════════════════════
// MARK TASK COMPLETE
// ═══════════════════════════════════════

async function markTaskComplete(taskId, status) {
  try {
    await fetch(`${API}/api/agent/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: userToken,
        task_id: taskId,
        status: status
      })
    });
    console.log(`✅ Task ${taskId} marked as ${status}`);
  } catch(e) {
    console.error('❌ markTaskComplete error:', e.message);
  }
}

// ═══════════════════════════════════════
// DIALOG BRIDGE — Website triggert, Electron öffnet nativen Dialog
// ═══════════════════════════════════════

let dialogPollInterval = null;

async function startDialogBridge() {
  if (dialogPollInterval) return;

  dialogPollInterval = setInterval(async () => {
    if (!userToken) return;
    try {
      const r = await fetch(`${API}/api/agent/pending-dialog?token=${userToken}`);
      const d = await r.json();

      if (d.success && d.request) {
        const req = d.request;
        clearInterval(dialogPollInterval);
        dialogPollInterval = null;

        console.log(`🗂️ Dialog-Request: ${req.dialog_type} (id: ${req.request_id})`);

        // ════════════════════
        // TRAINING REQUEST
        // ════════════════════
        if (req.dialog_type === 'training') {
          console.log(`🎓 Training Request vom Server: "${req.command}"`);

          // Steps vom Server holen
          const tsRes = await fetch(`${API}/api/brain/training-start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken, command: req.command })
          });
          const tsData = await tsRes.json();

          if (!tsData.success) {
            console.log(`❌ Training Start fehlgeschlagen: ${tsData.error}`);
            // Trotzdem result schicken damit Website nicht hängt
            await fetch(`${API}/api/agent/dialog-result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: userToken,
                request_id: req.request_id,
                status: 'failed',
                error: tsData.error
              })
            });
            setTimeout(() => startDialogBridge(), 1000);
            return;
          }

          // Training Overlay öffnen
          let trainingWin = new BrowserWindow({
            width: 480, height: 400,
            alwaysOnTop: true,
            frame: false,
            movable: true,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
          });
          trainingWin.loadFile('training-overlay.html');

          trainingWin.webContents.on('did-finish-load', () => {
            trainingWin.webContents.send('training-init', tsData);
          });

          // Server Bescheid geben: Overlay ist offen
          await fetch(`${API}/api/agent/dialog-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken,
              request_id: req.request_id,
              status: 'training_started'
            })
          });

          setTimeout(() => startDialogBridge(), 1000);
          return;
        }

        // ════════════════════
        // FOLDER / FILE DIALOG
        // ════════════════════
        const dialogOptions = req.dialog_type === 'folder'
          ? {
              title: 'Ordner auswählen',
              properties: ['openDirectory']
            }
          : {
              title: 'Datei auswählen',
              filters: [
                { name: 'Alle Dateien', extensions: ['*'] },
                { name: 'PDF', extensions: ['pdf'] },
                { name: 'Tabellen', extensions: ['xlsx', 'xls', 'csv'] },
                { name: 'Word', extensions: ['docx', 'doc'] },
                { name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
              ],
              properties: ['openFile']
            };

        const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

        if (!result.canceled && result.filePaths.length > 0) {
          const selectedPath = result.filePaths[0];
          console.log(`✅ Pfad gewählt: ${selectedPath}`);

          await fetch(`${API}/api/agent/dialog-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken,
              request_id: req.request_id,
              path: selectedPath
            })
          });
        } else {
          await fetch(`${API}/api/agent/dialog-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken,
              request_id: req.request_id,
              path: null,
              cancelled: true
            })
          });
        }

        // Bridge wieder starten
        setTimeout(() => startDialogBridge(), 1000);
      }
    } catch(e) {
      console.error('❌ Dialog bridge error:', e.message);
    }
  }, 1500);
}

//=================================================================================

async function runTask(taskText) {
  const screenshotBase64 = await takeCompressedScreenshot();
  const screenWidth = await nutScreen.width();
  const screenHeight = await nutScreen.height();

  // Screenshot war 1280x720 - echter Bildschirm kann anders sein
  // Genau wie beim Tileset: Koordinaten müssen übersetzt werden!
  const SCREENSHOT_WIDTH = 1280;
  const SCREENSHOT_HEIGHT = 720;
  const scaleX = screenWidth / SCREENSHOT_WIDTH;
  const scaleY = screenHeight / SCREENSHOT_HEIGHT;

  console.log(`📐 Skalierung: ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT} → ${screenWidth}x${screenHeight} (${scaleX.toFixed(2)}x, ${scaleY.toFixed(2)}y)`);

  const response = await fetch(`${API}/api/agent/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: userToken,
      task: taskText,
      screenshot: screenshotBase64,
      screen_size: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT } // Claude sieht 1280x720
    })
  });

  const data = await response.json();
  if (!data.success) throw new Error(data.message);

  console.log(`⚙️ ${data.actions.length} Aktionen ausführen...`);

  for (let action of data.actions) {
    // ← Koordinaten rückskalieren auf echten Bildschirm
    if (action.action === 'mouse_move' && action.coordinate) {
      const originalX = action.coordinate[0];
      const originalY = action.coordinate[1];
      action.coordinate[0] = Math.round(originalX * scaleX);
      action.coordinate[1] = Math.round(originalY * scaleY);
      console.log(`🖱️ Klick: [${originalX}, ${originalY}] → [${action.coordinate[0]}, ${action.coordinate[1]}]`);
    }
    await executeAction(action);
  }
}

// ═══════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════

ipcMain.handle('get-device-info', async () => {
  return { device_id: getDeviceId(), pin: userPin };
});

ipcMain.handle('activate-pin', async (event, pin) => {
  try {
    console.log('🔑 PIN-Login:', pin);
    const response = await fetch(`${API}/api/auth/app-pin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, device_id: getDeviceId() })
    });
    const data = await response.json();
    if (data.success) {
      userToken = data.token;
      userTier = data.tier || 'starter';
      tasksRemaining = data.tasks || 9999;
      userPin = pin;
      agentActive = true;
      saveToken();
      startPolling();
      bootstrap().catch(() => {});
      startLocalServer();
      // Bewusstsein mit User-Token starten
      startCircuit(data.token);
      sysLogMonitor.start({ api: API, token: data.token });
      loadUserProfileSettings().catch(() => {});
      startKeepAlive();
      return { success: true, message: data.message, tier: userTier, tasks: tasksRemaining, balance: data.balance };
    } else {
      return { success: false, message: data.error || data.message };
    }
  } catch(error) {
    console.error('❌ PIN-Login Fehler:', error);
    return { success: false, message: 'Verbindung fehlgeschlagen: ' + error.message };
  }
});

ipcMain.handle('activate-token', async (event, code) => {
  try {
    console.log('🔑 Activating:', code);
    const response = await fetch(`${API}/api/agent/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, device_id: getDeviceId() })
    });
    const data = await response.json();
    console.log('📡 Response:', data);

    if (data.success) {
      userToken = data.token;
      userTier = data.tier;
      tasksRemaining = data.tasks;
      userPin = data.pin;
      agentActive = true;
      saveToken();
      startPolling();
      bootstrap().catch(() => {});
      startLocalServer();
      // Bewusstsein mit User-Token starten
      startCircuit(data.token);
      // Feature 1: System-Log Monitor nach Aktivierung starten
      sysLogMonitor.start({ api: API, token: data.token });
      loadUserProfileSettings().catch(() => {});
      startKeepAlive();
      return {
        success: true,
        message: data.message,
        tier: userTier,
        tasks: tasksRemaining,
        pin: userPin,
        device_id: getDeviceId()
      };
    } else {
      return { success: false, message: data.error };
    }
  } catch(error) {
    console.error('❌ Error:', error);
    return { success: false, message: 'Verbindung fehlgeschlagen: ' + error.message };
  }
});

ipcMain.handle('logout', async () => {
  stopPolling();
  userToken = null;
  userTier = null;
  tasksRemaining = 0;
  userPin = null;
  agentActive = false;
  _dk = null; // Wipe RAM keys on logout
  if (circuit) { circuit.stop(); circuit = null; }
  if (localServer) { localServer.close(); localServer = null; }
  clearToken();
  return { success: true };
});

ipcMain.handle('get-status', async () => {
  return { active: agentActive, token: !!userToken, tier: userTier, tasks: tasksRemaining };
});

ipcMain.handle('load-stats', async () => {
  if (!userToken) return null;
  try {
    const response = await fetch(`${API}/api/agent/stats?token=${userToken}`);
    const data = await response.json();
    if (data.success && data.stats) {
      // ← Lokalen Cache mit echtem Wert überschreiben
      tasksRemaining = data.stats.tasks_remaining === '∞' ? 9999 : (data.stats.tasks_remaining || 0);
      store.set('tasksRemaining', tasksRemaining);
    }
    return data.success ? data.stats : null;
  } catch(error) {
    console.error('❌ Stats error:', error);
    return null;
  }
});

// ═══════════════════════════════════════
// IPC: FOLDER SCANNER → EXCEL
// ═══════════════════════════════════════

ipcMain.handle('scan-folder', async (event, folderPath) => {
  const fs = require('fs');
  

  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, message: 'Ordner nicht gefunden: ' + folderPath };
    }

    const entries = fs.readdirSync(folderPath);
    const files = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(folderPath, entry);
        const stat = fs.statSync(fullPath);
        const ext = path.extname(entry).toLowerCase();

        files.push({
          name: entry,
          extension: ext || '(kein)',
          size_bytes: stat.size,
          size_kb: (stat.size / 1024).toFixed(1),
          created: stat.birthtime.toISOString().split('T')[0],
          modified: stat.mtime.toISOString().split('T')[0],
          is_folder: stat.isDirectory(),
          full_path: fullPath
        });
      } catch(e) {
        // Datei übersprungen wenn kein Zugriff
      }
    }

    console.log(`📂 Scanned ${files.length} files in ${folderPath}`);
    return { success: true, files, count: files.length, folder: folderPath };

  } catch(error) {
    console.error('❌ Scan folder error:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('write-to-excel', async (event, { excelPath, files, columns }) => {
  const fs = require('fs');
  const path = require('path');

  try {
    // Welche Spalten soll MIRA eintragen?
    // columns = ['name', 'size_kb', 'modified', 'extension'] z.B.
    const cols = columns || ['name', 'extension', 'size_kb', 'modified'];

    // CSV bauen (Excel kann CSV öffnen)
    const header = cols.join(';');
    const rows = files.map(f => cols.map(c => f[c] ?? '').join(';'));
    const csv = [header, ...rows].join('\n');

    // Wenn kein Pfad angegeben → Desktop
    const outputPath = excelPath || path.join(require('os').homedir(), 'Desktop', 'MIRA_Scan_' + Date.now() + '.csv');

    fs.writeFileSync(outputPath, '\uFEFF' + csv, 'utf8'); // BOM für Excel

    console.log(`✅ Excel geschrieben: ${outputPath} (${files.length} Zeilen)`);
    return { success: true, path: outputPath, rows: files.length };

  } catch(error) {
    console.error('❌ Write excel error:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('execute-task', async (event, taskText) => {
  if (!userToken) return { success: false, message: 'Nicht aktiviert' };
  if (!agentActive) return { success: false, message: 'Agent deaktiviert' };
  if (tasksRemaining <= 0) return { success: false, message: 'Keine Tasks mehr übrig' };
  try {
    await runTask(taskText);
    tasksRemaining--;
    saveToken();
    return { success: true, message: 'Task ausgeführt!', tasksRemaining };
  } catch(error) {
    console.error('❌ Error:', error);
    return { success: false, message: error.message };
  }
});



// ═══════════════════════════════════════
// EXECUTE ACTION
// ═══════════════════════════════════════

async function executeAction(action) {
  switch(action.action) {
    case 'mouse_move':
      await mouse.setPosition({ x: action.coordinate[0], y: action.coordinate[1] });
      break;
    case 'left_click':
      await mouse.leftClick();
      break;
    case 'right_click':
      await mouse.rightClick();
      break;
    case 'double_click':
      await mouse.doubleClick();
      break;
    case 'type': {
      const _isMac = process.platform === 'darwin';
      if (_isMac) {
        await keyboard.pressKey(Key.LeftSuper, Key.A);
        await keyboard.releaseKey(Key.LeftSuper, Key.A);
      } else {
        await keyboard.pressKey(Key.LeftControl, Key.A);
        await keyboard.releaseKey(Key.LeftControl, Key.A);
      }
      await sleep(80);
      await keyboard.pressKey(Key.Backspace);
      await keyboard.releaseKey(Key.Backspace);
      await sleep(80);
      await typeFormatted(action.text);
      break;
    }
    case 'key':
      const keyMap = {
        'enter': Key.Enter, 'return': Key.Enter,
        'tab': Key.Tab, 'escape': Key.Escape, 'esc': Key.Escape,
        'space': Key.Space, 'backspace': Key.Backspace, 'delete': Key.Delete,
        'up': Key.Up, 'down': Key.Down, 'left': Key.Left, 'right': Key.Right
      };
      const keyToPress = keyMap[action.text.toLowerCase()];
      if (keyToPress) {
        await keyboard.pressKey(keyToPress);
        await keyboard.releaseKey(keyToPress);
      } else {
        await keyboard.type(action.text);
      }
      break;
    default:
      console.log('Unknown action:', action.action);
  }
  await sleep(action.delay || 500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Zwischenspeicher für extract_store → type_stored (A→B Transfers)
const extractedValues = new Map();

// Totschalter — auf true setzen um laufenden Task abzubrechen
let abortCurrentTask = false;

// ─────────────────────────────────────────────────────────────────────
// localDispatch — VERALTET, jetzt in mathematik/schaltzentrale.js
// Bleibt für Legacy-Aufrufe aus recoveryEngine / passiveTrainer
// ─────────────────────────────────────────────────────────────────────
function localDispatch(command) {
  const IS_MAC = process.platform === 'darwin';
  const cmd = command.toLowerCase().trim();

  // Hotkey-Mapping: [regex, windows-key, mac-key]
  const rules = [
    // Bearbeiten
    [/\b(kopier|copy|strg\+?c|ctrl\+?c)\b(?!.*ordner|.*datei|.*route)/i,          'ctrl+c',         'cmd+c'],
    [/\b(einfüg|paste|strg\+?v|ctrl\+?v)\b/i,                                      'ctrl+v',         'cmd+v'],
    [/\b(ausschneid|cut|strg\+?x|ctrl\+?x)\b/i,                                    'ctrl+x',         'cmd+x'],
    [/\b(rückgängig|undo|strg\+?z|ctrl\+?z)\b/i,                                   'ctrl+z',         'cmd+z'],
    [/\b(wiederhol|redo|strg\+?y|ctrl\+?y)\b/i,                                    'ctrl+y',         'cmd+shift+z'],
    [/\b(alles markier|alles auswähl|strg\+?a|ctrl\+?a|select all)\b/i,            'ctrl+a',         'cmd+a'],
    [/\b(speichern?\s+unter|save\s+as)\b/i,                                         'ctrl+shift+s',   'cmd+shift+s'],
    [/\b(speichern?|save|strg\+?s|ctrl\+?s)\b(?!.*unter)/i,                        'ctrl+s',         'cmd+s'],
    // Browser Navigation
    [/\bzurück\b(?!.*mail|.*email|.*track|.*lied)|browser.*zurück|letzte.*seite/i, 'alt+left',       'cmd+['],
    [/\bvorwärts\b(?!.*track)|browser.*vorwärts/i,                                 'alt+right',      'cmd+]'],
    [/\b(neu.*laden|reload|refresh|f5|aktualisier)\b/i,                            'f5',             'cmd+r'],
    [/\b(vergrößer|zoom.*in|größer machen)\b/i,                                    'ctrl+equal',     'cmd+='],
    [/\b(verkleinern?|zoom.*out|kleiner machen)\b/i,                               'ctrl+minus',     'cmd+-'],
    [/\b(zoom.*reset|normal.*größe|zoom.*zurück)\b/i,                              'ctrl+0',         'cmd+0'],
    // Tabs
    [/\b(neuer?\s*tab|new\s*tab|strg\+?t)\b/i,                                    'ctrl+t',         'cmd+t'],
    [/\b(tab\s*schließ|close\s*tab|strg\+?w)\b/i,                                 'ctrl+w',         'cmd+w'],
    [/\b(suche?\s*in\s*(der\s*)?seite|strg\+?f|find\s*in\s*page)\b/i,            'ctrl+f',         'cmd+f'],
    // App-Wechsel
    [/\b(app\s*wechsel|alt\s*tab|switch\s*app)\b/i,                               'alt+tab',        'cmd+tab'],
    // Fenster / System
    [/\b(fenster\s*schließ|close\s*window|alt\+?f4)\b/i,                          'alt+f4',         'cmd+w'],
    [/\b(minimier|fenster.*klein)\b/i,                                             'super+down',     'cmd+m'],
    [/\b(maximier|vollbild|fenster.*groß)\b(?!.*lautstärke)/i,                    'super+up',       'ctrl+cmd+f'],
    [/\b(bildschirm\s*sperr|lock\s*screen|sperr.*bildschirm)\b/i,                 'super+l',        'ctrl+cmd+q'],
    [/\b(desktop\s*(zeig|anzeig)|alle\s*fenster\s*weg|show\s*desktop)\b/i,        'super+d',        'f11'],
    [/\b(neues?\s*dokument|neue\s*datei|new\s*doc|strg\+?n)\b/i,                  'ctrl+n',         'cmd+n'],
    [/\b(datei\s*öffn.*dialog|open\s*file\s*dialog|strg\+?o)\b/i,                 'ctrl+o',         'cmd+o'],
    // Drucken & Screenshot
    [/\b(drucken?|print|strg\+?p)\b/i,                                            'ctrl+p',         'cmd+p'],
    [/\b(screenshot|bildschirmfoto|screen\s*shot)\b/i,                            'super+shift+s',  'cmd+shift+4'],
    // Lautstärke
    [/\b(lauter|volume\s*up|lautstärke\s*(hoch|erhöh))\b/i,                      'volumeup',       'volumeup'],
    [/\b(leiser|volume\s*down|lautstärke\s*(runter|senk))\b/i,                   'volumedown',     'volumedown'],
    [/\b(stumm|mute|ton\s*aus|stummschalten?)\b/i,                                'volumemute',     'volumemute'],
    // Mediensteuerung
    [/\b(nächstes?\s*(lied|song|track|titel)|skip|next\s*track)\b/i,              'medianexttrack', 'medianexttrack'],
    [/\b(vorherige[rs]?\s*(lied|song|track|titel)|previous\s*track)\b/i,          'mediaprevioustrack', 'mediaprevioustrack'],
  ];

  for (const [re, winKey, macKey] of rules) {
    if (re.test(cmd)) {
      const key = IS_MAC ? macKey : winKey;
      return [{ action: 'key', value: key, command: cmd }];
    }
  }

  // Scroll (benötigt direction-Parameter)
  if (/\b(scroll\s*(runter|down|nach\s*unten)|nach\s*unten\s*scroll)\b/i.test(cmd))
    return [{ action: 'scroll', direction: 'down', amount: 5, command: cmd }];
  if (/\b(scroll\s*(hoch|up|nach\s*oben)|nach\s*oben\s*scroll)\b/i.test(cmd))
    return [{ action: 'scroll', direction: 'up', amount: 5, command: cmd }];

  // Play/Pause — nur wenn KEIN Plattform-Keyword dabei
  if (/\b(play|pause|abspielen?|anhalten?)\b/i.test(cmd) &&
      !/youtube|spotify|netflix|musik.*abspiel|video.*abspiel/i.test(cmd))
    return [{ action: 'key', value: 'space', command: cmd }];

  // ── Web-Suche & URL öffnen — kein device_knowledge nötig ─────────────────
  // "google das Wetter", "suche nach X", "such X", "zeig mir X"
  const webSearch = cmd.match(
    /\b(?:google(?:\s+mal)?|such(?:e)?(?:\s+nach)?|find(?:e)?(?:\s+mal)?|zeig(?:\s+mir)?(?:\s+mal)?|schau(?:\s+mal)?(?:\s+nach)?)\s+(.+)/i
  );
  if (webSearch) {
    const q = webSearch[1].trim();
    return [{ action: 'open_url', value: `https://www.google.com/search?q=${encodeURIComponent(q)}`, command: cmd }];
  }

  // "öffne google.com", "geh auf youtube.com", "browser auf example.com"
  const urlOpen = cmd.match(
    /\b(?:öffne?|geh\s+(?:auf|zu)|starte?|browser(?:\s+auf)?|navigier(?:e)?(?:\s+zu)?|zeig(?:\s+mir)?)\s+(https?:\/\/\S+|[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?)/i
  );
  if (urlOpen) {
    let url = urlOpen[1].trim();
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    return [{ action: 'open_url', value: url, command: cmd }];
  }

  // "youtube wetter", "spotify öffnen", bekannte Plattformen direkt
  const platforms = {
    youtube:     'https://www.youtube.com',
    spotify:     'https://open.spotify.com',
    netflix:     'https://www.netflix.com',
    gmail:       'https://mail.google.com',
    'google mail': 'https://mail.google.com',
    'google maps': 'https://maps.google.com',
    maps:        'https://maps.google.com',
    whatsapp:    'https://web.whatsapp.com',
    instagram:   'https://www.instagram.com',
    linkedin:    'https://www.linkedin.com',
    twitter:     'https://www.twitter.com',
    facebook:    'https://www.facebook.com',
    github:      'https://github.com',
    notion:      'https://www.notion.so',
    chatgpt:     'https://chatgpt.com',
    deepl:       'https://www.deepl.com',
    google:      'https://www.google.com',
  };
  for (const [name, url] of Object.entries(platforms)) {
    if (cmd.includes(name)) {
      // Gibt es einen Suchbegriff dahinter? z.B. "youtube katzen videos"
      const after = cmd.replace(new RegExp(`.*?${name}\\s*`), '').trim();
      if (after && !['öffnen', 'öffne', 'starte', 'starten', 'aufmachen', 'auf', 'mal'].includes(after)) {
        if (name === 'youtube') {
          return [{ action: 'open_url', value: `https://www.youtube.com/results?search_query=${encodeURIComponent(after)}`, command: cmd }];
        }
        return [{ action: 'open_url', value: `${url}/search?q=${encodeURIComponent(after)}`, command: cmd }];
      }
      return [{ action: 'open_url', value: url, command: cmd }];
    }
  }

  return null; // → weiter zu tryDispatch (API)
}

// tryDispatch — VERALTET, jetzt in schaltzentrale.serverDispatch
// Wird nicht mehr direkt aufgerufen.

// ═══════════════════════════════════════
// Warning / Security-Dialog Dismiss + Retry
// ═══════════════════════════════════════

/**
 * Wenn miniVerify eine Security-Warning, einen Dialog oder Fehlerseite sieht:
 * 1. Versuche Warning/Dialog wegzuklicken ("Fortfahren", "Ignorieren", "Schließen" etc.)
 * 2. Nimm neuen Screenshot
 * 3. Retry miniFind für das eigentliche Element
 * Returns true wenn Retry erfolgreich, false sonst.
 */
async function dismissWarningAndRetry(postSc, whatISee, elementLabel, realW, realH) {
  const lower = (whatISee || '').toLowerCase();
  const isWarningOrBlocked =
    lower.includes('warnung') || lower.includes('warning') ||
    lower.includes('sicherheit') || lower.includes('security') ||
    lower.includes('gefährlich') || lower.includes('dangerous') ||
    lower.includes('gesperrt') || lower.includes('blocked') ||
    lower.includes('fehler') || lower.includes('error') ||
    lower.includes('dialog') || lower.includes('popup');

  if (isWarningOrBlocked) {
    console.log(`🛡️ Warning/Block erkannt ("${whatISee?.substring(0,60)}") — versuche zu dismisssen`);
    // Suche nach Dismiss-Button im aktuellen Screenshot
    const dismissBtn = await miniFind(postSc,
      'Schließen oder Fortfahren oder Ignorieren oder OK oder Weiter Button');
    if (dismissBtn.found) {
      await mouse.setPosition({
        x: Math.round(dismissBtn.x * (realW / 1280)),
        y: Math.round(dismissBtn.y * (realH / 720))
      });
      await mouse.leftClick();
      console.log(`   ✓ Warning dismissed — warte kurz`);
      await sleep(800);
    }
    // Neuen Screenshot nach Dismiss
    const freshSc = await takeCompressedScreenshot();
    const retry = await miniFind(freshSc, elementLabel);
    if (retry.found) {
      await mouse.setPosition({
        x: Math.round(retry.x * (realW / 1280)),
        y: Math.round(retry.y * (realH / 720))
      });
      await mouse.leftClick();
      console.log(`   ✓ Retry Klick auf "${elementLabel}" nach Warning-Dismiss`);
      return true;
    }
    console.log(`   ✗ "${elementLabel}" nach Warning-Dismiss immer noch nicht gefunden`);
    return false;
  }

  // Kein Warning — normaler miniFind Retry
  const retry = await miniFind(postSc, elementLabel);
  if (retry.found) {
    await mouse.setPosition({
      x: Math.round(retry.x * (realW / 1280)),
      y: Math.round(retry.y * (realH / 720))
    });
    await mouse.leftClick();
    return true;
  }
  return false;
}

// ═══════════════════════════════════════
// Fix 3: Popup / Interrupt-Handler
// ═══════════════════════════════════════

/**
 * Prüft VOR jedem Action-Step ob ein Dialog (AXSheet / AXDialog) das Vorderfeld blockiert.
 * Erkennt OK / Allow / Cancel und klickt den richtigen Button, danach weiter mit Step.
 *
 * Priorität: Confirm-Button (OK / Allow / Erlauben / …) vor Cancel.
 */
async function handleDialogIfPresent() {
  try {
    const app = axLayer.getFrontmostApp();
    if (app.error) return;

    const dialogResult = axLayer.checkForDialog(app.bundleId);
    if (!dialogResult.dialog) return;

    console.log(`🔔 Dialog/Sheet erkannt: "${dialogResult.title}" (${dialogResult.buttons.length} Buttons)`);

    // Bevorzuge: Confirm > erster verfügbarer Nicht-Cancel > Cancel > erster Button
    const btn = dialogResult.buttons.find(b => b.isConfirm)
             || dialogResult.buttons.find(b => !b.isCancel)
             || dialogResult.buttons[0];

    if (!btn) {
      console.log(`⚠️ Dialog ohne auflösbare Buttons — überspringe`);
      return;
    }

    console.log(`   → klicke "${btn.label}" [${btn.centerX}, ${btn.centerY}]`);
    await mouse.setPosition({ x: btn.centerX, y: btn.centerY });
    await sleep(200);
    await mouse.leftClick();
    await sleep(500);
    contextManager.invalidate();
  } catch (e) {
    // Nicht-kritisch — falls Dialog-Check scheitert einfach weiter
    console.warn(`⚠️ handleDialogIfPresent Fehler: ${e.message}`);
  }
}

// ═══════════════════════════════════════
// TYPING HELPER — \n → echte Enter-Keypresses
// ═══════════════════════════════════════
async function typeFormatted(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      await keyboard.type(lines[i]);
    }
    if (i < lines.length - 1) {
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
      await sleep(60);
    }
  }
}

// ═══════════════════════════════════════
// FILE-TASK UTILITIES
// ═══════════════════════════════════════

const FT_SARK = [
  'andere KIs machen Kunst, ich mach Buchhaltung...',
  'du weißt schon, dass man das auch selbst machen könnte?',
  'immer noch Buchhaltung, falls du\'s vergessen hast...',
  'wenn ich einen Euro pro Seite hätte, wäre ich reicher als du...',
  'ich zähle das, du schuldest mir einen Kaffee.',
  'wenigstens lüge ich nicht — ich lese wirklich alles.',
  'Datei ' + '${i+1}' + ' von vielen. Ich fange an, sie persönlich zu nehmen.',
  'nochmal. wirklich. immer ich.',
  'manche nennen es Arbeit. ich nenn\'s digitale Qual.',
  'kurze Pause... nein, Spaß. Direkt weiter.',
];
function ftSark(i) { return FT_SARK[i % FT_SARK.length]; }

async function ftReadPdf(filePath) {
  try {
    const pdfjsLib = require('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const data = new Uint8Array(require('fs').readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text.substring(0, 4000);
  } catch(e) { console.error('❌ ftReadPdf:', e.message); return null; }
}

async function ftReadFile(filePath) {
  const fs = require('fs');
  const path = require('path');
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  try {
    if (ext === 'pdf') return await ftReadPdf(filePath);
    if (ext === 'docx' || ext === 'doc') {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
      return r.value.substring(0, 4000);
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.worksheets[0];
      const rows = [];
      ws.eachRow((row, i) => { if (i <= 100) rows.push(row.values.slice(1).join(' | ')); });
      return rows.join('\n').substring(0, 4000);
    }
    if (ext === 'csv') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.csv.readFile(filePath);
      const ws = wb.worksheets[0];
      const rows = [];
      ws.eachRow((row, i) => { if (i <= 100) rows.push(row.values.slice(1).join(' | ')); });
      return rows.join('\n').substring(0, 4000);
    }
    if (['txt','md','json','xml','html','log'].includes(ext)) {
      return fs.readFileSync(filePath, 'utf8').substring(0, 4000);
    }
    return null;
  } catch(e) { console.error(`❌ ftReadFile ${filePath}:`, e.message); return null; }
}

async function ftFindFiles(patterns, sourceDirs) {
  const fs   = require('fs');
  const path = require('path');
  const os   = require('os');
  const home = os.homedir();

  const expandDir = d => {
    const map = {
      'downloads': path.join(home, 'Downloads'),
      'desktop':   path.join(home, 'Desktop'),
      'dokumente': path.join(home, 'Documents'),
      'documents': path.join(home, 'Documents'),
      'schreibtisch': path.join(home, 'Desktop'),
    };
    return map[d.toLowerCase()] || path.join(home, d);
  };

  const dirs = (sourceDirs && sourceDirs.length)
    ? sourceDirs.map(expandDir)
    : [path.join(home,'Downloads'), path.join(home,'Desktop'), path.join(home,'Documents')];

  const found = [];
  const SKIP = new Set(['node_modules','.git','.Trash','Library','Applications','System']);
  // Entwickler/Konfig-Dateien nie als User-Dokumente zurückgeben
  const SKIP_EXTS = new Set(['js','ts','jsx','tsx','mjs','cjs','json','md','yaml','yml','env','npmrc','gitignore','lock','sh','py','rb','go','rs','c','cpp','h','swift','cs','java','sql']);
  // Wenn kein Pattern angegeben → nur oberste Ebene + max 20 Treffer
  const hasPattern   = patterns && patterns.length > 0 && patterns.some(p => p && p.trim());
  const MAX_FILES    = hasPattern ? 100 : 20;
  const MAX_DEPTH    = hasPattern ? 4    : 1;

  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    if (found.length >= MAX_FILES) return; // Hard-Cap
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      if (entry.startsWith('.') || SKIP.has(entry)) continue;
      const full = path.join(dir, entry);
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      const nameLower = entry.toLowerCase();
      const ext = path.extname(entry).replace('.','').toLowerCase();
      if (SKIP_EXTS.has(ext)) continue; // keine Dev/Konfig-Dateien
      const matches = !hasPattern || patterns.some(p => nameLower.includes(p.toLowerCase()));
      if (matches) found.push({ name: entry, path: full, ext, mtime: stat.mtime, size: stat.size });
    }
  }

  dirs.forEach(d => walk(d, 0));
  return found.sort((a, b) => b.mtime - a.mtime);
}

// Findet die Header-Zeile in einem ExcelJS-Sheet (scannt Zeilen 1–8)
// Kriterium: erste Zeile mit ≥2 Text-Zellen (keine reinen Zahlen/Daten)
function findHeaderRow(sheet) {
  for (let r = 1; r <= Math.min(8, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const cells = [];
    row.eachCell({ includeEmpty: false }, (cell) => { cells.push(cell.value); });
    if (cells.length < 2) continue;
    // Zähle Text-Zellen (kein reiner Zahl-/Datum-Wert)
    const textCount = cells.filter(v => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'number') return false;
      if (v instanceof Date) return false;
      if (typeof v === 'object' && v.result !== undefined) return false; // Formel
      return true;
    }).length;
    // Wenn ≥60% der Zellen Text sind → das ist die Header-Zeile
    if (textCount / cells.length >= 0.6) return r;
  }
  return 1; // Fallback
}

async function ftWriteOutput(parsed, files, extractedRows, profile = {}) {
  const fs   = require('fs');
  const path = require('path');
  const os   = require('os');
  const home = os.homedir();
  const fmt  = (parsed.target_format || 'xlsx').toLowerCase();
  const targetName = parsed.target_filename || `MIRA_Output_${Date.now()}.${fmt}`;

  // Zieldatei rekursiv suchen (wie Quelldatei) — falls schon bekannt via target_path überspringen
  let outputPath = parsed.target_path || null;
  if (!outputPath && parsed.target_filename) {
    const found = await ftFindFiles([parsed.target_filename]);
    outputPath = found?.[0]?.path || null;
    if (outputPath) console.log(`📍 Zieldatei gefunden: ${outputPath}`);
  }
  if (!outputPath) outputPath = path.join(home, 'Desktop', targetName);
  const exists = fs.existsSync(outputPath);

  // ── XLSX ──────────────────────────────────────────────────────────────
  if (fmt === 'xlsx' || fmt === 'csv') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = profile.company_name || 'MIRA Agent';
    let sheet;
    let existingHeaders = null; // Spalten der bestehenden Datei
    let hdrRowIdx = 1;          // Header-Zeilen-Nummer

    if (exists && parsed.append_if_exists !== false) {
      await wb.xlsx.readFile(outputPath);
      sheet = wb.getWorksheet(1) || wb.addWorksheet('MIRA');

      // ExcelJS rowCount ist manchmal unzuverlässig → echte Zeilen zählen
      let actualLastRow = 0;
      sheet.eachRow((row, rowNum) => { actualLastRow = rowNum; });

      // Header-Zeile automatisch erkennen (nicht immer Zeile 1)
      hdrRowIdx = findHeaderRow(sheet);
      existingHeaders = [];
      sheet.getRow(hdrRowIdx).eachCell({ includeEmpty: false }, (cell) => {
        existingHeaders.push((cell.value || '').toString().trim());
      });
      // Alte Summenzeile am Ende entfernen
      const lastRow = sheet.getRow(actualLastRow || sheet.rowCount);
      const lastCell = lastRow.getCell(1);
      if (lastCell.value && typeof lastCell.value === 'string' && lastCell.value === 'Gesamt') {
        sheet.spliceRows(actualLastRow || sheet.rowCount, 1);
      }
      console.log(`📋 Anhänge-Modus: Header in Zeile ${hdrRowIdx}, Spalten=[${existingHeaders.join(', ')}] ab Zeile ${(actualLastRow || sheet.rowCount) + 1}`);
    } else {
      sheet = wb.addWorksheet('MIRA');
    }

    // Neue Zeilen werden nach der letzten echten Zeile angehängt
    const dataStartRow = hdrRowIdx + 1;

    // Aktive Header-Liste bestimmen (Priorität: bestehende Datei > Profil > AI-Ergebnis)
    const profileHeaders = profile.excel_headers
      ? profile.excel_headers.split(',').map(h => h.trim()).filter(Boolean)
      : null;
    const headers = existingHeaders?.length
      ? existingHeaders
      : (profileHeaders || extractedRows?.headers || Object.keys(extractedRows?.rows?.[0] || {}));

    if (!existingHeaders) {
      // Neue Datei: Header-Zeile schreiben
      const hr = sheet.getRow(1);
      headers.forEach((h, i) => {
        const cell = hr.getCell(i + 1);
        cell.value = h.charAt(0).toUpperCase() + h.slice(1);
        cell.font  = { bold: true, name: 'Arial', size: 11 };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
      });
      hr.height = 22; hr.commit();
      sheet.columns = headers.map(() => ({ width: 22 }));
    }

    // Fuzzy-Match: AI-Feldname → bestehende Spalte finden
    function matchField(row, colHeader) {
      const col = colHeader.toLowerCase();
      // 1. Direkter Treffer
      if (row[colHeader] !== undefined) return row[colHeader];
      // 2. Case-insensitive
      const key = Object.keys(row).find(k => k.toLowerCase() === col);
      if (key) return row[key];
      // 3. Teilstring-Match (z.B. "Brutto" trifft "brutto_betrag")
      const partial = Object.keys(row).find(k =>
        k.toLowerCase().includes(col) || col.includes(k.toLowerCase())
      );
      if (partial) return row[partial];
      // 4. Semantische Aliase
      const ALIASES = {
        datum: ['date','rechnungsdatum','belegdatum'],
        betrag: ['brutto','gesamtbetrag','summe','total','amount'],
        netto: ['nettobetrag','net'],
        mwst: ['mehrwertsteuer','tax','ust','steuer'],
        absender: ['firma','lieferant','name','company','sender','von'],
        betreff: ['titel','subject','leistung','bezeichnung','beschreibung'],
        iban: ['bankverbindung','kontonummer'],
      };
      for (const [alias, variants] of Object.entries(ALIASES)) {
        if (col.includes(alias) || alias.includes(col)) {
          const v = variants.find(va => Object.keys(row).find(k => k.toLowerCase().includes(va)));
          if (v) {
            const found = Object.keys(row).find(k => k.toLowerCase().includes(v));
            if (found) return row[found];
          }
        }
      }
      return '';
    }

    let newCount = 0;
    for (const row of (extractedRows?.rows || [])) {
      const values = headers.map(h => {
        const v = matchField(row, h);
        // Beträge als Zahlen
        if (typeof v === 'string' && /^\d[\d.,]*$/.test(v.replace(/[€$£CHF\s]/g,'')))
          return parseFloat(v.replace(',','.').replace(/[€$£\s]/g,'')) || v;
        return v ?? '';
      });
      const r = sheet.addRow(values);
      r.eachCell(c => { c.font = { name: 'Arial', size: 10 }; c.alignment = { vertical: 'middle' }; });
      r.height = 18; newCount++;
    }

    // Summenzeile für numerische Spalten
    const lastDataRow = sheet.rowCount;
    const sumRow = sheet.addRow([]);
    let hasSums = false;
    headers.forEach((h, i) => {
      const col = i + 1;
      const colLetter = String.fromCharCode(64 + col);
      // Letzte Datenzelle auf Zahlentyp prüfen
      let isNumCol = false;
      for (let ri = dataStartRow; ri <= lastDataRow; ri++) {
        const v = sheet.getRow(ri).getCell(col).value;
        if (typeof v === 'number') { isNumCol = true; break; }
      }
      if (isNumCol) {
        sumRow.getCell(col).value = { formula: `SUM(${colLetter}${dataStartRow}:${colLetter}${lastDataRow})` };
        sumRow.getCell(col).font = { bold: true, name: 'Arial', size: 10 };
        hasSums = true;
      }
    });
    if (hasSums) { sumRow.getCell(1).value = sumRow.getCell(1).value || 'Gesamt'; sumRow.height = 20; }
    else { sheet.spliceRows(sheet.rowCount, 1); }

    await wb.xlsx.writeFile(outputPath);
    const fileBase64 = fs.readFileSync(outputPath).toString('base64');
    return { outputPath, fileBase64, newCount, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  // ── DOCX ─────────────────────────────────────────────────────────────
  if (fmt === 'docx') {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
    const content = extractedRows?.text || '';
    const lines   = content.split('\n').filter(l => l.trim());

    // Bestehende Datei: einfach anhängen (docx-lib kann kein echtes Merge → Text-Append als neue Paragraphen)
    // Neue Datei: DIN 5008 Struktur
    const today = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });

    const paragraphs = [];

    const docFont = profile.letter_font || 'Arial';

    if (!exists) {
      // DIN 5008: Absender oben rechts
      if (profile.company_name) {
        const addrLines = [
          profile.company_name,
          profile.company_address,
          [profile.company_zip, profile.company_city].filter(Boolean).join(' '),
          profile.company_phone,
          profile.company_email,
        ].filter(Boolean);
        for (const al of addrLines) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: al, size: 18, color: '888888', font: docFont })],
            alignment: AlignmentType.RIGHT,
          }));
        }
      } else {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: 'MIRA Agent | Erstellt: ' + today, size: 20, color: '888888', font: docFont })],
          alignment: AlignmentType.RIGHT,
        }));
      }
      paragraphs.push(new Paragraph({ text: '' }));
    } else {
      // Trennlinie für Anhang
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '─────────────────────────────', color: 'AAAAAA' })],
      }));
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: 'Anhang vom ' + today, size: 20, color: '888888', italics: true })],
      }));
    }

    for (const line of lines) {
      if (line.startsWith('# ')) {
        paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      } else if (line.startsWith('## ')) {
        paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      } else if (line.startsWith('**') && line.endsWith('**')) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: line.slice(2,-2), bold: true, font: docFont })] }));
      } else {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, font: docFont })] }));
      }
    }

    // Grußformel + Unterschrift aus Profil
    if (profile.letter_salutation || profile.letter_signature) {
      paragraphs.push(new Paragraph({ text: '' }));
      if (profile.letter_salutation) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: profile.letter_salutation, font: docFont })] }));
      }
      if (profile.letter_signature) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: profile.letter_signature, font: docFont })] }));
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
      styles: { paragraphStyles: [{ id: 'Normal', name: 'Normal', run: { font: docFont, size: 22 } }] }
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
    const fileBase64 = buffer.toString('base64');
    return { outputPath, fileBase64, newCount: lines.length, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }

  // ── PDF ──────────────────────────────────────────────────────────────
  if (fmt === 'pdf') {
    const PDFDocument = require('pdfkit');
    const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const contentRaw = extractedRows?.text || '';
    const lines = contentRaw.split('\n');

    // Farben
    const C_DARK   = '#1a1a2e';   // Überschriften / Header
    const C_TEXT   = '#2d2d2d';   // Fließtext
    const C_GRAY   = '#888888';   // Sekundär (Footer, Datum)
    const C_GREEN  = '#00cc66';   // MIRA Akzent
    const C_RULE   = '#e8e8e8';   // Trennlinien

    // Seitenmaße — A4 = 595.28 × 841.89pt
    const ML = 72, MR = 72, MT = 88, MB = 72;
    const PW = 595.28;
    // Explizite Textbreite — das ist der entscheidende Fix gegen vertikale Buchstaben
    const TW = PW - ML - MR;  // 451pt

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        bufferPages: true,
        margins: { top: MT, bottom: MB, left: ML, right: MR },
        info: { Title: parsed.target_filename || 'MIRA Dokument', Author: profile.company_name || 'MIRA Agent', CreationDate: new Date() }
      });

      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => { fs.writeFileSync(outputPath, Buffer.concat(chunks)); resolve(); });
      doc.on('error', reject);

      // ── Hilfsfunktionen ──────────────────────────────────────────────

      // Seitenheader zeichnen (wird auf jeder Seite im Footer-Pass wiederholt)
      function drawPageHeader(pageDoc) {
        const hY = 28;
        // Grüner Akzentbalken links
        pageDoc.rect(ML, hY, 3, 20).fill(C_GREEN);
        // Logo: Firmenname oder "MIRA Agent"
        const label = profile.company_name || 'MIRA Agent';
        pageDoc.font('Helvetica-Bold').fontSize(9).fillColor(C_DARK)
               .text(label, ML + 10, hY + 5, { width: TW / 2, lineBreak: false });
        // Logo-Bild rechts wenn vorhanden
        if (profile.company_logo_base64) {
          try {
            const data = profile.company_logo_base64.includes(',')
              ? profile.company_logo_base64.split(',')[1] : profile.company_logo_base64;
            pageDoc.image(Buffer.from(data, 'base64'), PW - MR - 60, hY, { height: 20, fit: [60, 20] });
          } catch(_) {}
        }
        // Datum rechts
        pageDoc.font('Helvetica').fontSize(8).fillColor(C_GRAY)
               .text(today, ML, hY + 6, { width: TW, align: 'right', lineBreak: false });
        // Trennlinie
        pageDoc.moveTo(ML, hY + 24).lineTo(PW - MR, hY + 24)
               .lineWidth(1).strokeColor(C_GREEN).stroke();
      }

      // Header auf erster Seite
      drawPageHeader(doc);

      // ── Inhalts-Rendering ──────────────────────────────────────────────
      // Wichtig: ALLE text()-Aufrufe mit expliziter X-Position und width=TW
      // → verhindert den vertikalen-Buchstaben-Bug durch falsch vererbte Breiten

      let inTable = false;
      let tableRows = [];

      const flushTable = () => {
        if (!tableRows.length) return;
        const colCount = Math.max(...tableRows.map(r => r.length));
        const colW = Math.floor(TW / colCount);
        tableRows.forEach((cells, ri) => {
          const y0 = doc.y;
          const isHdr = ri === 0;
          if (isHdr) doc.rect(ML, y0 - 2, TW, 16).fill('#f5f5f5').stroke();
          cells.forEach((cell, ci) => {
            doc.font(isHdr ? 'Helvetica-Bold' : 'Helvetica')
               .fontSize(9).fillColor(isHdr ? C_DARK : C_TEXT)
               .text(cell.trim(), ML + ci * colW, y0, { width: colW - 4, lineBreak: false });
          });
          doc.y = y0 + 17;
          doc.moveTo(ML, doc.y - 1).lineTo(PW - MR, doc.y - 1)
             .lineWidth(0.3).strokeColor(C_RULE).stroke();
        });
        doc.moveDown(0.6);
        tableRows = []; inTable = false;
      };

      for (const line of lines) {
        const t = line.trim();

        // Tabelle
        if (t.startsWith('|') && t.endsWith('|')) {
          inTable = true;
          if (/^\|[\s\-:|]+\|$/.test(t)) continue;
          tableRows.push(t.slice(1, -1).split('|'));
          continue;
        } else if (inTable) { flushTable(); }

        // H1 — Dokumenttitel
        if (t.startsWith('# ')) {
          if (doc.y > MT + 10) doc.moveDown(0.8);
          doc.font('Helvetica-Bold').fontSize(18).fillColor(C_DARK)
             .text(t.slice(2), ML, doc.y, { width: TW });
          const lineY = doc.y + 4;
          doc.moveTo(ML, lineY).lineTo(PW - MR, lineY)
             .lineWidth(2).strokeColor(C_GREEN).stroke();
          doc.y = lineY + 12;
          continue;
        }

        // H2 — Abschnitt
        if (t.startsWith('## ')) {
          doc.moveDown(0.7);
          doc.font('Helvetica-Bold').fontSize(13).fillColor(C_DARK)
             .text(t.slice(3), ML, doc.y, { width: TW });
          doc.moveDown(0.3);
          continue;
        }

        // H3 — Unterabschnitt
        if (t.startsWith('### ')) {
          doc.moveDown(0.4);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(C_TEXT)
             .text(t.slice(4), ML, doc.y, { width: TW });
          doc.moveDown(0.25);
          continue;
        }

        // Trennlinie
        if (/^(-{3,}|_{3,}|─{3,})$/.test(t)) {
          doc.moveDown(0.4);
          doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y)
             .lineWidth(0.5).strokeColor(C_RULE).stroke();
          doc.moveDown(0.5);
          continue;
        }

        // Bullet — KEIN continued:true, direkt als "• text" String
        if (t.startsWith('- ') || t.startsWith('* ') || t.startsWith('• ')) {
          const txt = stripInlineMd(t.replace(/^[-*•]\s+/, ''));
          doc.font('Helvetica').fontSize(11).fillColor(C_TEXT)
             .text('• ' + txt, ML + 8, doc.y, { width: TW - 8, lineGap: 3 });
          doc.moveDown(0.2);
          continue;
        }

        // Leerzeile
        if (!t) {
          if (doc.y < doc.page.height - MB - 30) doc.moveDown(0.5);
          continue;
        }

        // Key: Value (kurze Zeile, Doppelpunkt)
        if (/^[\w\säöüÄÖÜß]{2,25}:\s.+$/.test(t) && t.length < 120) {
          const ci = t.indexOf(':');
          const key = t.slice(0, ci).trim();
          const val = t.slice(ci + 1).trim();
          doc.font('Helvetica-Bold').fontSize(11).fillColor(C_DARK)
             .text(key + ': ', ML, doc.y, { width: TW, continued: false });
          // Wert direkt darunter, eingerückt — kein continued um den Breiten-Bug zu vermeiden
          doc.font('Helvetica').fontSize(11).fillColor(C_TEXT)
             .text(val, ML + 12, doc.y - 2, { width: TW - 12, lineGap: 2 });
          doc.moveDown(0.3);
          continue;
        }

        // Normaler Absatz — explizite Position + TW
        doc.font('Helvetica').fontSize(11).fillColor(C_TEXT)
           .text(stripInlineMd(t), ML, doc.y, { width: TW, lineGap: 4, paragraphGap: 2 });
        doc.moveDown(0.3);
      }

      if (inTable) flushTable();

      // ── Header + Footer auf jeder Seite ──────────────────────────────
      const range = doc.bufferedPageRange();
      const pageCount = range.count;

      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(range.start + i);

        // Header (ab Seite 2 nochmal zeichnen)
        if (i > 0) drawPageHeader(doc);

        // Footer-Trennlinie
        const footY = doc.page.height - MB + 8;
        doc.moveTo(ML, footY - 4).lineTo(PW - MR, footY - 4)
           .lineWidth(0.5).strokeColor(C_RULE).stroke();

        // Footer links: Firmenname | USt-ID oder Dateiname
        const footLeft = [profile.company_name, profile.company_ust_id].filter(Boolean).join(' | ')
          || (parsed.target_filename || 'MIRA Dokument');
        doc.font('Helvetica').fontSize(8).fillColor(C_GRAY)
           .text(footLeft, ML, footY, { width: TW - 80, lineBreak: false });

        // Footer rechts: Seitenzahl
        doc.font('Helvetica-Bold').fontSize(8).fillColor(C_DARK)
           .text(`Seite ${i + 1} von ${pageCount}`, ML, footY, { width: TW, align: 'right', lineBreak: false });
      }

      doc.end();
    });

    const buf = fs.readFileSync(outputPath);
    const fileBase64 = buf.toString('base64');
    return { outputPath, fileBase64, newCount: lines.filter(l => l.trim()).length, mime: 'application/pdf' };
  }

  // ── TXT ──────────────────────────────────────────────────────────────
  if (fmt === 'txt' || fmt === 'md') {
    const text = extractedRows?.text || '';
    if (exists && parsed.append_if_exists !== false) {
      require('fs').appendFileSync(outputPath, '\n\n---\n\n' + text, 'utf8');
    } else {
      require('fs').writeFileSync(outputPath, text, 'utf8');
    }
    const fileBase64 = Buffer.from(text).toString('base64');
    return { outputPath, fileBase64, newCount: text.split('\n').length, mime: 'text/plain' };
  }

  return null;
}

function stripInlineMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')       // *italic*
    .replace(/__(.+?)__/g, '$1')       // __bold__
    .replace(/_(.+?)_/g, '$1')         // _italic_
    .replace(/`(.+?)`/g, '$1')         // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [link](url)
}

function buildFtInstruction(action, format, existingColHeaders = []) {
  if (action === 'extract_to_excel' || format === 'xlsx') {
    const colHint = existingColHeaders.length
      ? `Die Zieldatei hat bereits diese Spalten: [${existingColHeaders.join(', ')}]. Gib die Felder GENAU mit diesen Namen zurück (case-sensitive). Felder ohne Wert als leerer String "".`
      : 'Verwende als Feldnamen: datum, absender, betreff, netto, mwst, brutto, iban. Felder ohne Wert als leerer String "".';
    return `Extrahiere alle relevanten Felder aus diesem Dokument. ${colHint} Geldbeträge NUR als Zahlen ohne Währungssymbol (z.B. 595.00 statt 595,00 €). Datum im Format DD.MM.YYYY.`;
  }
  if (format === 'pdf' || action === 'create_pdf') {
    return 'Erstelle einen strukturierten, vollständigen Text für ein PDF-Dokument auf Deutsch. Verwende Markdown-Formatierung: # für Haupttitel, ## für Abschnitte, ### für Unterabschnitte, - für Aufzählungen, **fett** für wichtige Begriffe, Key: Value für Kennzahlen. Beginne mit einem # Titel. Gliedere in sinnvolle Absätze mit Zwischenüberschriften. Behalte alle Zahlen, Daten und Fakten.';
  }
  if (action === 'summarize' || action === 'write_report') {
    return 'Fasse den Inhalt dieser Datei präzise zusammen. Verwende Markdown: # Titel, ## Abschnitte, - Aufzählungen. Behalte alle wichtigen Fakten, Zahlen und Daten. Antwort auf Deutsch.';
  }
  if (action === 'write_brief') {
    return 'Erstelle einen formellen Brief nach DIN 5008 auf Deutsch. Verwende Markdown: # für Betreff (fett, oben), dann Anrede, Absätze, Grußformel. Extrahiere Empfänger, Betreff und Kernaussagen aus dem Inhalt.';
  }
  if (action === 'append_section') {
    return 'Extrahiere und formatiere den neuen Inhalt/Abschnitt mit Markdown (## Überschrift, Absätze, - Listen). Behalte alle relevanten Details.';
  }
  return 'Extrahiere und strukturiere alle relevanten Informationen mit Markdown-Formatierung (# Titel, ## Abschnitte, Aufzählungen, Key: Value Felder).';
}

// ═══════════════════════════════════════
// ROUTE SYSTEM
// ═══════════════════════════════════════
async function executeRouteStep(step) {
  const { scaleWithCalibration } = require('./screen-calibrator');

  // Fix 3: Vor jedem Step auf blockierende Dialoge / Sheets prüfen
  await handleDialogIfPresent();

  switch(step.action) {

    case 'desktop_start':
      await sleep(500);
      break;

    case 'open_url': {
      await require('electron').shell.openExternal(step.value || step.command);
      // Nach URL-Navigation: alle Browser-Caches sofort löschen (Seite komplett neu)
      coordCache.invalidateApp('com.google.Chrome');
      coordCache.invalidateApp('com.apple.Safari');
      coordCache.invalidateApp('com.operasoftware.Opera');
      coordCache.invalidateApp('com.microsoft.edgemac');
      coordCache.invalidateApp('org.mozilla.firefox');
      contextManager.invalidate();
      await sleep(5000);
      break;
    }

    // ═══════════════════════════════════════
    // CLICK — context.js VOR dem Klick
    // ═══════════════════════════════════════
    case 'click': {
      const realW = await nutScreen.width();
      const realH = await nutScreen.height();

      // Label kürzen für Mini — nur das Wesentliche
      const rawLabel = step.command || step.label || 'Element';
      const elementLabel = rawLabel
        .replace(/^klicke? (auf )?(das |die |den )?/i, '')
        .replace(/ in der (leiste|taskbar|menüleiste|dock).*/i, '')
        .replace(/\s+/g, ' ')
        .trim() || rawLabel;

      let finalX, finalY;
      let coordSource    = 'training';
      let finalFingerprint = null;   // AX-Fingerprint für Cache-Persistenz (Fix 2)

      // ── TIER -2a: Trainierte Route-Koordinate (from_route=true) ──────────
      // Route wurde manuell trainiert → gespeicherte Koordinaten sind autoritativ.
      // Kein AX, kein KI — User hat das selbst gezeigt.
      if (step.from_route && step.coordinate) {
        const scaled = scaleWithCalibration(
          step.coordinate[0], step.coordinate[1],
          step.screen_width || realW, step.screen_height || realH,
          calibration
        );
        finalX = scaled.x;
        finalY = scaled.y;
        coordSource = 'route_training';
        console.log(`🗺️ Route-Koordinate: "${elementLabel}" → [${finalX}, ${finalY}] (trainiert)`);
      }

      // ── TIER -2: dispatch-full Koordinate (vorgelöst, kein KI nötig) ──
      // Wenn der Server needs_screenshot:false gesetzt hat, ist die Koordinate
      // aus device_knowledge bereits authorativ — kein resolve-step nötig.
      if (!finalX && step.needs_screenshot === false && step.coordinate) {
        const scaled = scaleWithCalibration(
          step.coordinate[0], step.coordinate[1],
          step.screen_width || realW, step.screen_height || realH,
          calibration
        );
        finalX = scaled.x;
        finalY = scaled.y;
        coordSource = 'dispatch_full';
        console.log(`⚡ dispatch-full Koord: "${elementLabel}" → [${finalX}, ${finalY}]`);
      }

      // ── KONTEXT AUFNEHMEN (einmalig pro Click, alle Tiers nutzen ihn) ──
      const ctx = contextManager.captureState();
      const ctxString = contextManager.toPromptString(ctx);
      console.log(`📋 Kontext: ${contextManager.toShortString(ctx)}`);

      // ── TIER 0a: Im gecachten State suchen (JS, <1ms, kein Subprocess) ──
      // AX-Live immer VOR Cache — echte aktuelle Position gewinnt immer.
      const stateResult = contextManager.findInState(ctx, elementLabel);
      if (stateResult) {
        finalX = stateResult.centerX;
        finalY = stateResult.centerY;
        coordSource = 'ctx_state';
        finalFingerprint = { axLabel: stateResult.title || stateResult.label || elementLabel, axRole: stateResult.role || null, axParent: null };
        console.log(`📋 State-Cache: "${elementLabel}" → [${finalX}, ${finalY}] (confidence: ${Math.round(stateResult.confidence * 100)}%)`);
      }

      // ── TIER 0b: AX Subprocess mit Retry (bis 3×, 500ms — wartet auf Ladezeiten) ──
      if (!finalX) {
        const axResult = await waitForElement(elementLabel, ctx.app?.bundleId);
        if (axResult.found) {
          finalX = axResult.centerX;
          finalY = axResult.centerY;
          coordSource = 'ax';
          finalFingerprint = { axLabel: axResult.title || elementLabel, axRole: axResult.role || null, axParent: null };
          console.log(`♿ AX Layer: "${elementLabel}" → [${finalX}, ${finalY}] (confidence: ${Math.round(axResult.confidence * 100)}%)`);
        }
      }

      // ── TIER -1: Koordinaten-Cache (nur wenn AX nichts gefunden hat) ──
      // Fingerprint ohne Match → Pixel-Koordinaten VERWERFEN (veraltet/verschoben).
      if (!finalX) {
        const cached = coordCache.get(ctx.app?.bundleId, elementLabel);
        if (cached) {
          if (cached.fingerprint) {
            const fpResult = axLayer.findByFingerprint(cached.fingerprint, { bundleId: ctx.app?.bundleId });
            if (fpResult.found) {
              finalX = fpResult.centerX;
              finalY = fpResult.centerY;
              coordSource = 'fingerprint';
              console.log(`🔍 Fingerprint-Match: "${elementLabel}" → [${finalX}, ${finalY}] (AX-Position aktuell)`);
            } else {
              // Fingerprint miss → gespeicherte Pixel-Coords sind unzuverlässig → skip
              coordCache.invalidate(ctx.app?.bundleId, elementLabel);
              console.log(`🗂️ Cache (Fingerprint miss) → verworfen: "${elementLabel}"`);
            }
          } else {
            finalX = cached.x;
            finalY = cached.y;
            coordSource = 'cache';
            console.log(`🗂️ Cache: "${elementLabel}" → [${finalX}, ${finalY}] (hits: ${cached.hitCount}, via ${cached.tier})`);
          }
        }
      }

      // ── TIER 0c: Math Pattern Matching (<100ms, kein API) ──
      if (!finalX) {
        const mathResult = await mathChef.find(elementLabel).catch(() => null);
        if (mathResult?.found) {
          finalX = mathResult.centerX;
          finalY = mathResult.centerY;
          coordSource = 'math_pattern';
          console.log(`🔢 Math: "${elementLabel}" → [${finalX}, ${finalY}] (Score: ${mathResult.score.toFixed(3)})`);
        }
      }

      // Screenshot nur wenn 0a+0b+0c scheitern
      const preSc = finalX ? null : await takeCompressedScreenshot();

      // ── TIER 1: Server fragen — mit Kontext angereichert ──
      if (!finalX) try {
        const contextRes = await fetch(`${API}/api/brain/resolve-step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: userToken,
            step: {
              ...step,
              command: elementLabel,
              calibration: {
                dockHeight: calibration?.dock?.height || 80,
                menubarHeight: calibration?.menubar?.height || 34
              }
            },
            screen_size: { width: realW, height: realH },
            screenshot: preSc,
            context: ctxString        // ← OS-Kontext für besseres Reasoning
          })
        });
        const contextData = await contextRes.json();
        console.log(`🔍 resolve-step Response:`, JSON.stringify(contextData));

        if (contextData.success && contextData.coordinate) {
          finalX = contextData.coordinate[0];
          finalY = contextData.coordinate[1];
          coordSource = contextData.source;
          console.log(`🧠 context.js: "${elementLabel}" → [${finalX}, ${finalY}] (${coordSource}, confidence: ${Math.round((contextData.confidence || 0) * 100)}%)`);
        }
      } catch(e) {
        console.warn(`⚠️ context-check Fehler: ${e.message}`);
      }

      // Fallback: Mini direkt oder Training
      if (!finalX) {
        const miniResult = await miniFind(preSc, elementLabel);

        if (miniResult.found && miniResult.confidence > 0.7) {
          const miniScaled = scaleWithCalibration(miniResult.x, miniResult.y, 1280, 720, calibration);
          finalX = miniScaled.x;
          finalY = miniScaled.y;
          coordSource = 'mini';
          console.log(`👁️ Mini findet "${elementLabel}": x:${finalX} y:${finalY} (${miniResult.confidence})`);
          // Auto-Lernen: nächstes Mal findet Math es ohne API
          mathChef.lernVonErfolg(elementLabel, finalX, finalY, { app: ctx.app?.name, kontext: 'mini-find' }).catch(() => {});
        } else if (step.coordinate) {
          const scaled = scaleWithCalibration(
            step.coordinate[0], step.coordinate[1],
            step.screen_width, step.screen_height,
            calibration
          );
          finalX = scaled.x;
          finalY = scaled.y;
          coordSource = 'training';
          console.log(`📍 Fallback für "${elementLabel}": x:${finalX} y:${finalY}`);
        } else {
          console.log(`❌ Nichts gefunden: "${elementLabel}"`);
          break;
        }
      }

      // ── PRE-CLICK STATE (Baseline für AX Verification) ──
      const preClickState = contextManager.captureState(true);

      // ── KLICK ──
      await mouse.setPosition({ x: finalX, y: finalY });
      await sleep(300);
      await mouse.leftClick();

      // ── AX VERIFICATION: Hat sich der Screen-State verändert? ──
      // Warte kurz damit OS und App den neuen State an AX melden können.
      await sleep(600);
      contextManager.invalidate();
      const postClickState = contextManager.captureState(true);
      const axDiff = contextManager.diffStates(preClickState, postClickState);

      let clickSuccess    = axDiff.changed;
      let clickVerifyNote = axDiff.changed
        ? `AX OK: ${axDiff.changes.join(' | ')}`
        : 'AX: kein State-Delta';

      if (axDiff.changed) {
        console.log(`✅ AX Verify: ${axDiff.changes.join(' | ')}`);

      } else {
        const wasAxFound = coordSource === 'ax' || coordSource === 'ctx_state';
        console.log(`⚠️ AX Verify: kein State-Delta nach Klick (source: ${coordSource})`);

        if (wasAxFound) {
          // ── Retry 1: AX-Element erneut suchen und nochmal klicken ──────────
          const axRetry = axFind(elementLabel);
          if (axRetry.found) {
            console.log(`🔁 AX Retry: "${elementLabel}" → [${axRetry.centerX}, ${axRetry.centerY}]`);
            await mouse.setPosition({ x: axRetry.centerX, y: axRetry.centerY });
            await sleep(200);
            await mouse.leftClick();
            await sleep(600);
            contextManager.invalidate();
            const postRetryState = contextManager.captureState(true);
            const retryDiff = contextManager.diffStates(preClickState, postRetryState);
            if (retryDiff.changed) {
              clickSuccess    = true;
              clickVerifyNote = `AX Retry OK: ${retryDiff.changes.join(' | ')}`;
              console.log(`✅ AX Retry: Klick erfolgreich — ${retryDiff.changes.join(' | ')}`);
            } else {
              clickSuccess    = false;
              clickVerifyNote = 'AX Retry: kein State-Delta nach 2 Versuchen';
              console.log(`❌ AX Retry: weiterhin kein State-Delta für "${elementLabel}"`);
            }
          } else {
            // AX findet Element nicht mehr → Screenshot-Fallback ──────────────
            const postSc  = await takeCompressedScreenshot();
            const verify  = await miniVerify(postSc, step.expected || `${elementLabel} wurde geklickt`);
            clickSuccess    = verify.ok;
            clickVerifyNote = `Screenshot Fallback: ${verify.what_i_see || ''}`;
            if (!verify.ok && verify.confidence > 0.8) {
              console.log(`⚠️ Screenshot Verify: ${verify.what_i_see} — retry`);
              clickSuccess = await dismissWarningAndRetry(postSc, verify.what_i_see, elementLabel, realW, realH);
            }
          }

        } else {
          // Screenshot-basierte Koordinaten → Screenshot-Verify ──────────────
          const postSc = await takeCompressedScreenshot();
          const verify  = await miniVerify(postSc, step.expected || `${elementLabel} wurde geklickt`);
          clickSuccess    = verify.ok;
          clickVerifyNote = `Screenshot: ${verify.what_i_see || ''}`;
          if (!verify.ok && verify.confidence > 0.8) {
            console.log(`⚠️ Screenshot Verify: ${verify.what_i_see} — retry`);
            clickSuccess = await dismissWarningAndRetry(postSc, verify.what_i_see, elementLabel, realW, realH);
          }
        }
      }

      // ── URL-FELD FOKUSSIERT? → CMD+A damit Folge-Typing sauber überschreibt ──
      // Frischer Capture: welches Feld hat jetzt den Fokus?
      contextManager.invalidate();
      const afterFocusState = contextManager.captureState();
      if (afterFocusState.focused &&
          contextManager.isUrlField(afterFocusState.focused) &&
          afterFocusState.focused.value) {
        const urlPreview = afterFocusState.focused.value.substring(0, 60);
        console.log(`🌐 URL-Feld fokussiert: "${urlPreview}" → CMD+A (bereit zum Überschreiben)`);
        await keyboard.pressKey(Key.LeftControl, Key.A);
        await keyboard.releaseKey(Key.LeftControl, Key.A);
        await sleep(150);
      }

      // Kontext-Cache invalidieren
      contextManager.invalidate();

      // ── GefahrenAmt: Wenn Klick keinen State-Delta hatte → Korrektur ────────
      if (!clickSuccess) {
        const appName    = ctx?.frontmostApp || 'unknown';
        const fingerprint = `NO_DELTA:${appName}:${elementLabel.replace(/\s/g,'_').substring(0,30)}`;
        const correction  = await gefahrenAmt.correct({
          fingerprint,
          issue:          `Kein State-Delta nach Klick "${elementLabel}" (source: ${coordSource})`,
          executeStepFn:  (s) => executeRouteStep(s),
          contextManager,
          token:          userToken,
          API,
          deviceKnowledgeId: null // TODO: aus device_knowledge ID setzen wenn vorhanden
        });
        if (correction.corrected) {
          clickSuccess    = true;
          clickVerifyNote = `GefahrenAmt Korrektur OK (Versuch ${correction.attempt || '?'})`;
          console.log(`🔧 GefahrenAmt: Klick korrigiert — ${clickVerifyNote}`);
        }
      }

      // ── Koordinaten-Cache aktualisieren ──────────────────────────────────
      if (clickSuccess) {
        // Erfolgreiche Koordinaten für nächsten Aufruf cachen — mit Fingerprint (Fix 2)
        coordCache.set(ctx.app?.bundleId, elementLabel, finalX, finalY, 1.0, coordSource, finalFingerprint);
      } else if (coordSource === 'cache' || coordSource === 'fingerprint') {
        // Cache/Fingerprint hatte falsche/veraltete Koordinaten → invalidieren
        coordCache.invalidate(ctx.app?.bundleId, elementLabel);
        console.log(`🗂️ Cache invalidiert: "${elementLabel}" (koordinaten veraltet)`);
      }

      // ── Lernkreis: AX-verifizierter Klick → device_knowledge (persistent) ──
      // Nur wenn Click wirklich gewirkt hat (AX-Delta bestätigt) und die Quelle
      // verlässlich ist. Fire-and-forget — blockiert die Route nicht.
      if (clickSuccess && userToken) {
        const LEARN_SOURCES = new Set(['ax', 'ctx_state', 'fingerprint', 'mini', 'training']);
        if (LEARN_SOURCES.has(coordSource)) {
          const learnConfidence = { ax: 0.97, ctx_state: 0.95, fingerprint: 0.95, mini: 0.75, training: 0.70 }[coordSource] || 0.70;
          fetch(`${API}/api/brain/device-knowledge-save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token:       userToken,
              konzept:     elementLabel,
              app_name:    ctx.app?.bundleId || null,
              position_x:  finalX,
              position_y:  finalY,
              screen_width:  realW,
              screen_height: realH,
              methode:     coordSource,
              confidence:  learnConfidence,
            })
          }).catch(() => {});
          console.log(`📚 Lernkreis: "${elementLabel}" → device_knowledge (${coordSource}, ${Math.round(learnConfidence * 100)}%)`);
        }
      }

      // ── Screen Memory speichern ──
      await saveScreenMemory({
        action: 'click',
        element: elementLabel,
        position: { x: finalX, y: finalY },
        success: clickSuccess,
        what_mini_saw: clickVerifyNote
      });

      // ── GPT lernt im Hintergrund ──
      const scAfterClick = await takeCompressedScreenshot();
      fetch(`${API}/api/agent/screen-learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: userToken,
          screenshot: scAfterClick,
          step_command: elementLabel,
          clicked_position: [finalX, finalY],
          screen_size: { width: realW, height: realH }
        })
      }).catch(() => {});

      // ── Kritischer Step gescheitert? Abbrechen um Folge-Chaos zu vermeiden ──
      if (!clickSuccess) {
        const isCritical = /url|leiste|browser|öffnen|navigate|neue mail|compose|new.*mail/i.test(elementLabel);
        if (isCritical) {
          console.log(`🛑 Kritischer Step "${elementLabel}" gescheitert — Route abgebrochen`);
          throw new Error(`Kritischer Klick fehlgeschlagen: "${elementLabel}"`);
        }
      }

      break;
    }

    // ═══════════════════════════════════════
    // TYPE
    // ═══════════════════════════════════════
    case 'type': {
      let textToType = step.value || step.command || '';
      const cmd = (step.command || '').toLowerCase();

      // Extracted context → echte Daten eintippen
      if (step.extracted_context && Object.keys(step.extracted_context).length > 0) {
        const d = step.extracted_context;
        textToType = [
          d.subject           ? `Betreff: ${d.subject}`        : null,
          d.from              ? `Von: ${d.from}`               : null,
          d.date              ? `Datum: ${d.date}`             : null,
          d.message_content   ? `Inhalt: ${d.message_content}` : null,
          d.main_content      ? `Inhalt: ${d.main_content}`    : null,
          d.verification_code ? `Code: ${d.verification_code}` : null,
        ].filter(Boolean).join('\n');
        console.log(`✍️ Tippe extracted data: "${textToType.substring(0, 80).replace(/\n/g, '↵')}..."`);
        await typeFormatted(textToType);
        break;
      }

      const isEnterOnly = textToType.toLowerCase().trim() === 'enter' || textToType === '\n';
      const endsWithEnter = cmd.includes('enter') || cmd.includes('drücke') || cmd.includes('bestätige');

      if (isEnterOnly) {
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        console.log(`   ⌨️ Enter gedrückt`);
        break;
      }

      // Kontext für type: AX weiß welches Feld fokussiert ist
      const typeCtx = contextManager.captureState();
      if (typeCtx.focused) {
        console.log(`✍️ Fokussiertes Feld: ${typeCtx.focused.role} "${typeCtx.focused.title || typeCtx.focused.label || ''}"`);
      }

      // Mini checkt ob Textfeld aktiv ist (nur wenn AX kein fokussiertes Feld kennt)
      const preSc = (!typeCtx.focused) ? await takeCompressedScreenshot() : null;
      const fieldCheck = preSc
        ? await miniVerify(preSc, 'Textfeld oder Eingabefeld ist aktiv')
        : { ok: true, confidence: 1.0 };

      if (!fieldCheck.ok && fieldCheck.confidence > 0.8) {
        console.log(`⚠️ Textfeld nicht aktiv — Mini sucht es`);
        const sc = preSc || await takeCompressedScreenshot();
        const fieldResult = await miniFind(sc, 'aktives Eingabefeld oder Suchfeld');
        if (fieldResult.found) {
          const realW = await nutScreen.width();
          const realH = await nutScreen.height();
          await mouse.setPosition({
            x: Math.round(fieldResult.x * (realW / 1280)),
            y: Math.round(fieldResult.y * (realH / 720))
          });
          await mouse.leftClick();
          await sleep(300);
        }
      }

      // ── Immer erst alles markieren + löschen, dann tippen ──────────────────
      const IS_MAC = process.platform === 'darwin';
      if (IS_MAC) {
        await keyboard.pressKey(Key.LeftSuper, Key.A);
        await keyboard.releaseKey(Key.LeftSuper, Key.A);
      } else {
        await keyboard.pressKey(Key.LeftControl, Key.A);
        await keyboard.releaseKey(Key.LeftControl, Key.A);
      }
      await sleep(80);
      await keyboard.pressKey(Key.Backspace);
      await keyboard.releaseKey(Key.Backspace);
      await sleep(80);
      console.log(`🗑️ Feld geleert (SelectAll+Delete) vor Tippen`);

      const cleanText = textToType
        .replace(/^gebe? (ein|ein:?)\s*/i, '')
        .replace(/\s*und drücke.*/i, '')
        .replace(/\s*und bestätige.*/i, '')
        .replace(/^-\s*/, '')
        .replace(/\s*-$/, '')
        .trim();

      // Mehrzeiliger Text → Clipboard-Paste (sofort, kein Timeout-Risiko)
      if (cleanText.includes('\n')) {
        const { clipboard } = require('electron');
        clipboard.writeText(cleanText);
        await sleep(100);
        if (IS_MAC) {
          await keyboard.pressKey(Key.LeftSuper, Key.V);
          await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
          await keyboard.pressKey(Key.LeftControl, Key.V);
          await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await sleep(200);
        console.log(`   📋 Eingefügt (Clipboard): "${cleanText.substring(0, 80).replace(/\n/g, '↵')}"`);
      } else {
        await typeFormatted(cleanText);
        console.log(`   ⌨️ Getippt: "${cleanText.substring(0, 80).replace(/\n/g, '↵')}"`);
      }
      contextManager.invalidate(); // Feld-Inhalt hat sich geändert
      // Billing: 1.2 Token pro 10 Zeichen (aufgerundet)
      const _typeCost = Math.ceil(cleanText.length / 10) * 1.2;
      trackUsage(_typeCost, 'type').catch(() => {});

      if (endsWithEnter) {
        await sleep(300);

        // ── SELF-CORRECTION: Feldinhalt vor Enter prüfen ──────────────────────
        // AX liest aktuellen Wert des fokussierten Feldes.
        // Stimmt er nicht mit dem eingetippten Text überein → Cmd+A, Delete, neu tippen.
        contextManager.invalidate();
        const scCtx = contextManager.captureState(true);
        const scField = scCtx?.focused;
        if (scField?.value !== undefined && cleanText.trim().length > 0) {
          const currentVal = (scField.value || '').trim();
          const expectedVal = cleanText.trim();
          if (currentVal !== expectedVal) {
            const fieldDesc = scField.title || scField.label || scField.role || 'Feld';
            console.log(`🔄 Self-Correction "${fieldDesc}": hat "${currentVal.substring(0, 50)}", erwartet "${expectedVal.substring(0, 50)}" → neu eingeben`);
            await keyboard.pressKey(Key.LeftControl, Key.A);
            await keyboard.releaseKey(Key.LeftControl, Key.A);
            await sleep(100);
            await keyboard.pressKey(Key.Backspace);
            await keyboard.releaseKey(Key.Backspace);
            await sleep(80);
            await typeFormatted(cleanText);
            await sleep(200);
          } else {
            console.log(`✅ Self-Correction: Feldinhalt korrekt ("${expectedVal.substring(0, 40)}")`);
          }
        }

        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        console.log(`   ↵ Enter nach Text`);
        contextManager.invalidate();
      }
      break;
    }

    case 'url':
      await require('electron').shell.openExternal(step.value || step.command);
      await sleep(2000);
      break;

    case 'extract':
      console.log(`🔍 Extract: ${step.command}`);
      try {
        let sc = await takeCompressedScreenshot();
        const realW = await nutScreen.width();
        const realH = await nutScreen.height();

        // Kontext: welche App/Fenster ist offen? Hilft dem Server beim Extrahieren
        const extractCtx = contextManager.captureState();
        const extractCtxString = contextManager.toPromptString(extractCtx);

        const res1 = await fetch(`${API}/api/agent/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: userToken,
            screenshot: sc,
            command: step.command,
            mark_region: step.mark_region || null,
            screen_size: { width: realW, height: realH },
            context: extractCtxString    // ← App/Fenster-Kontext für bessere Extraktion
          })
        });
        const d1 = await res1.json();
        console.log(`🔍 Extract Versuch 1:`, d1.data);
        let finalData = d1.data || {};

        if (d1.needs_scroll || Object.values(finalData).some(v => v === null)) {
          console.log(`📜 Scrolle...`);
          await mouse.scrollDown(4);
          await sleep(800);
          sc = await takeCompressedScreenshot();

          const res2 = await fetch(`${API}/api/agent/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken,
              screenshot: sc,
              command: step.command,
              previous_data: finalData,
              screen_size: { width: realW, height: realH }
            })
          });
          const d2 = await res2.json();
          for (const [k, v] of Object.entries(d2.data || {})) {
            if ((finalData[k] === null || finalData[k] === undefined) && v !== null) {
              finalData[k] = v;
            }
          }
        }

        step.extracted = finalData;
        console.log(`✅ Extrahiert:`, step.extracted);
        if (mainWindow) mainWindow.webContents.send('data-extracted', step.extracted);

      } catch(e) {
        console.error(`❌ Extract Fehler:`, e.message);
      }
      break;

    case 'key': {
      const _isMac2 = process.platform === 'darwin';
      const _cmd    = _isMac2 ? Key.LeftSuper : Key.LeftControl;
      const _win    = Key.LeftSuper;
      const keyMap = {
        'enter':           Key.Enter,
        'return':          Key.Enter,
        'tab':             Key.Tab,
        'escape':          Key.Escape,
        'esc':             Key.Escape,
        'space':           Key.Space,
        'backspace':       Key.Backspace,
        'delete':          Key.Delete,
        'up':              Key.Up,
        'down':            Key.Down,
        'left':            Key.Left,
        'right':           Key.Right,
        'f5':              Key.F5,
        // Ctrl/Cmd combos
        'ctrl+a':          [Key.LeftControl, Key.A],
        'cmd+a':           [Key.LeftSuper,   Key.A],
        'ctrl+c':          [Key.LeftControl, Key.C],
        'cmd+c':           [Key.LeftSuper,   Key.C],
        'ctrl+v':          [Key.LeftControl, Key.V],
        'cmd+v':           [Key.LeftSuper,   Key.V],
        'ctrl+x':          [Key.LeftControl, Key.X],
        'cmd+x':           [Key.LeftSuper,   Key.X],
        'ctrl+z':          [Key.LeftControl, Key.Z],
        'cmd+z':           [Key.LeftSuper,   Key.Z],
        'ctrl+f':          [Key.LeftControl, Key.F],
        'cmd+f':           [Key.LeftSuper,   Key.F],
        'ctrl+s':          [Key.LeftControl, Key.S],
        'cmd+s':           [Key.LeftSuper,   Key.S],
        'ctrl+t':          [Key.LeftControl, Key.T],
        'cmd+t':           [Key.LeftSuper,   Key.T],
        'ctrl+w':          [Key.LeftControl, Key.W],
        'cmd+w':           [Key.LeftSuper,   Key.W],
        'ctrl+p':          [Key.LeftControl, Key.P],
        'cmd+p':           [Key.LeftSuper,   Key.P],
        'ctrl+g':          [Key.LeftControl, Key.G],
        'cmd+r':           [Key.LeftSuper,   Key.R],
        'ctrl+r':          [Key.LeftControl, Key.R],
        'ctrl+end':        [Key.LeftControl, Key.End],
        'cmd+end':         [Key.LeftSuper,   Key.End],
        'ctrl+home':       [Key.LeftControl, Key.Home],
        'cmd+home':        [Key.LeftSuper,   Key.Home],
        'ctrl+shift+s':    [Key.LeftControl, Key.LeftShift, Key.S],
        'cmd+shift+s':     [Key.LeftSuper,   Key.LeftShift, Key.S],
        'cmd+shift+4':     [Key.LeftSuper,   Key.LeftShift, Key.Num4],
        'super+shift+s':   [Key.LeftSuper,   Key.LeftShift, Key.S],
        'alt+tab':         [Key.LeftAlt,     Key.Tab],
        'cmd+tab':         [Key.LeftSuper,   Key.Tab],
        // Spotlight / Start-Menu
        'cmd+space':       [Key.LeftSuper,   Key.Space],
        'super':           [Key.LeftSuper],
        'super+d':         [Key.LeftSuper,   Key.D],
        'super+l':         [Key.LeftSuper,   Key.L],
        // Browser / Nav
        'cmd+[':           [Key.LeftSuper,   Key.LeftBracket],
        'cmd+]':           [Key.LeftSuper,   Key.RightBracket],
        'alt+left':        [Key.LeftAlt,     Key.Left],
        'alt+right':       [Key.LeftAlt,     Key.Right],
        // Adaptive: wenn Mac → cmd, sonst ctrl (für generische Befehle vom Server)
        'cmd+n':           [_cmd, Key.N],
        'cmd+o':           [_cmd, Key.O],
        'cmd+enter':       [Key.LeftSuper,   Key.Enter],
        'ctrl+enter':      [Key.LeftControl, Key.Enter],
        'alt+s':           [Key.LeftAlt,     Key.S],
      };
      const k = keyMap[(step.value || step.command)?.toLowerCase()];
      if (Array.isArray(k)) {
        await keyboard.pressKey(...k);
        await keyboard.releaseKey(...k);
        console.log(`   ⌨️ Key: ${step.value || step.command}`);
      } else if (k !== undefined && k !== null) {
        await keyboard.pressKey(k);
        await keyboard.releaseKey(k);
        console.log(`   ↵ Key: ${step.value || step.command}`);
      } else {
        console.warn(`⚠️ Unbekannter Key: "${step.value || step.command}"`);
      }
      break;
    }

    // ── Hotkey (wie key aber eigene Action) ──
    case 'hotkey': {
      const hotkeyMap = {
        'ctrl+a':        [Key.LeftControl, Key.A],
        'ctrl+c':        [Key.LeftControl, Key.C],
        'ctrl+v':        [Key.LeftControl, Key.V],
        'ctrl+s':        [Key.LeftControl, Key.S],
        'ctrl+f':        [Key.LeftControl, Key.F],
        'ctrl+z':        [Key.LeftControl, Key.Z],
        'ctrl+t':        [Key.LeftControl, Key.T],
        'ctrl+w':        [Key.LeftControl, Key.W],
        'ctrl+p':        [Key.LeftControl, Key.P],
        'ctrl+g':        [Key.LeftControl, Key.G],
        'ctrl+end':      [Key.LeftControl, Key.End],
        'ctrl+home':     [Key.LeftControl, Key.Home],
        'ctrl+shift+s':  [Key.LeftControl, Key.LeftShift, Key.S],
        'alt+tab':       [Key.LeftAlt, Key.Tab],
      };
      const combo = hotkeyMap[(step.value || '').toLowerCase()];
      if (combo) {
        await keyboard.pressKey(...combo);
        await keyboard.releaseKey(...combo);
        console.log(`   ⌨️ Hotkey: ${step.value}`);
      } else {
        console.warn(`⚠️ Unbekannter Hotkey: "${step.value}"`);
      }
      break;
    }

    // ── extract_store: Screen lesen + unter key speichern (für A→B) ──
    case 'extract_store': {
      console.log(`📥 extract_store [${step.key}]: ${step.command}`);
      try {
        const sc = await takeCompressedScreenshot();
        const realW = await nutScreen.width();
        const realH = await nutScreen.height();
        const extractCtx = contextManager.captureState();
        const extractCtxString = contextManager.toPromptString(extractCtx);

        const res = await fetch(`${API}/api/agent/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: userToken,
            screenshot: sc,
            command: step.command,
            mark_region: step.zone || null,
            screen_size: { width: realW, height: realH },
            context: extractCtxString
          })
        });
        const d = await res.json();
        const rawData = d.data;

        // Strukturiertes JSON → lesbarer Text zum Eintippen
        let extracted;
        if (typeof rawData === 'string') {
          extracted = rawData;
        } else if (rawData && typeof rawData === 'object') {
          extracted = Object.entries(rawData)
            .filter(([k, v]) => v !== null && v !== undefined)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');
        } else {
          extracted = String(rawData || '');
        }

        extractedValues.set(step.key, extracted);
        console.log(`✅ extract_store [${step.key}]: "${extracted.substring(0, 80)}"`);

      } catch(e) {
        console.error(`❌ extract_store Fehler: ${e.message}`);
      }
      break;
    }

    // ── scroll_extract_store: Ganze Seite durchscrollen + lesen + speichern ──
    // Für url_summarize und url_to_word — mehrere Screenshots, merged result
    case 'scroll_extract_store': {
      const key        = step.key        || 'page_content';
      const maxScrolls = step.max_scrolls || 4;
      const region     = step.region     || null;
      const regionHint = region ? ` (Bereich: "${region}")` : '';
      console.log(`📜 scroll_extract_store [${key}]${regionHint}`);

      try {
        const realW = await nutScreen.width();
        const realH = await nutScreen.height();
        const extractCtx = contextManager.captureState();
        const extractCtxString = contextManager.toPromptString(extractCtx);

        let allData    = {};
        let prevData   = null;
        let scrollsDone = 0;

        for (let i = 0; i <= maxScrolls; i++) {
          if (i > 0) {
            await mouse.scrollDown(5);
            await sleep(500);
            scrollsDone++;
          }

          const sc = await takeCompressedScreenshot();
          const prompt = region
            ? `${step.command}\n\nFokussiere nur auf den Bereich: "${region}"`
            : step.command;

          const res = await fetch(`${API}/api/agent/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: userToken,
              screenshot: sc,
              command: prompt,
              previous_data: prevData,
              screen_size: { width: realW, height: realH },
              context: extractCtxString
            })
          });

          const d = await res.json();

          // Fehlende Felder aus neuem Screenshot ergänzen
          for (const [k, v] of Object.entries(d.data || {})) {
            if ((allData[k] === null || allData[k] === undefined) && v !== null) {
              allData[k] = v;
            }
          }
          prevData = allData;

          console.log(`   📸 Scroll ${i}/${maxScrolls}: needs_scroll=${d.needs_scroll}`);
          if (!d.needs_scroll) break;
        }

        // Scroll zurück nach oben
        if (scrollsDone > 0) await mouse.scrollUp(scrollsDone * 5);

        // Objekt → lesbarer Text
        let extracted;
        if (typeof allData === 'string') {
          extracted = allData;
        } else if (allData && typeof allData === 'object') {
          extracted = Object.entries(allData)
            .filter(([k, v]) => v !== null && v !== undefined)
            .map(([k, v]) => `${k}:\n${v}`)
            .join('\n\n');
        } else {
          extracted = String(allData || '');
        }

        extractedValues.set(key, extracted);
        console.log(`✅ scroll_extract_store [${key}]: ${extracted.substring(0, 120)}`);

        // Ergebnis im Chat anzeigen (url_summarize zeigt es dem User)
        if (mainWindow) mainWindow.webContents.send('data-extracted', allData);

      } catch(e) {
        console.error(`❌ scroll_extract_store Fehler: ${e.message}`);
      }
      break;
    }

    // ── type_stored: Gespeicherten Wert eintippen ──
    case 'type_stored': {
      const stored = extractedValues.get(step.key);
      if (stored) {
        const text = typeof stored === 'object' ? JSON.stringify(stored, null, 2) : String(stored);
        await typeFormatted(text);
        console.log(`✍️ type_stored [${step.key}]: "${text.substring(0, 80).replace(/\n/g, '↵')}"`);
      } else {
        console.warn(`⚠️ type_stored: kein Wert für key "${step.key}" — extract_store vorher aufgerufen?`);
      }
      break;
    }

    // ── show_artifact: Extrahierten Inhalt als Artifact-Karte im MIRA-Chat zeigen ──
    case 'show_artifact': {
      const artifactValue = extractedValues.get(step.key);
      if (artifactValue && mainWindow) {
        const raw = typeof artifactValue === 'object' ? JSON.stringify(artifactValue, null, 2) : String(artifactValue);
        // JSON-Objekte in lesbaren Text umwandeln
        let display = raw;
        try {
          const obj = JSON.parse(raw);
          if (typeof obj === 'object' && obj !== null) {
            display = Object.entries(obj)
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n');
          }
        } catch(_) {}
        mainWindow.webContents.send('mira-artifact', {
          title: step.command || step.key,
          content: display,
        });
        console.log(`🖼️ show_artifact [${step.key}]: "${display.substring(0, 100).replace(/\n/g, '↵')}"`);
      } else if (!artifactValue) {
        console.warn(`⚠️ show_artifact: kein Wert für key "${step.key}"`);
      }
      break;
    }

    case 'wait':
      await sleep(step.value || 1000);
      break;

    case 'scroll': {
      const amount = step.amount || step.value || 3;
      const dir = (step.direction || 'down').toLowerCase();
      if (dir === 'up') {
        await mouse.scrollUp(amount);
      } else {
        await mouse.scrollDown(amount);
      }
      break;
    }

    case 'clear_url': {
      // URL-Leiste leeren wenn eine falsche/blockierte URL erkannt wurde
      console.log('🔗 clear_url: URL-Leiste wird geleert...');
      try {
        // Schritt 1: URL-Leiste fokussieren (Cmd+L Mac / Ctrl+L Windows)
        const isMac = process.platform === 'darwin';
        if (isMac) {
          await keyboard.pressKey(Key.LeftSuper, Key.L);
          await keyboard.releaseKey(Key.LeftSuper, Key.L);
        } else {
          await keyboard.pressKey(Key.LeftControl, Key.L);
          await keyboard.releaseKey(Key.LeftControl, Key.L);
        }
        await sleep(300);
        // Schritt 2: Alles markieren
        await keyboard.pressKey(Key.LeftControl, Key.A);
        await keyboard.releaseKey(Key.LeftControl, Key.A);
        await sleep(100);
        // Schritt 3: Löschen
        await keyboard.pressKey(Key.Backspace);
        await keyboard.releaseKey(Key.Backspace);
        await sleep(200);
        console.log('✅ URL-Leiste geleert — bereit für neuen Versuch');
      } catch(e) {
        console.warn('⚠️ clear_url Fehler:', e.message);
      }
      break;
    }

    case 'fill_field': {
      const fieldName  = step.field_name || step.konzept || '';
      const fieldValue = step.value || '';
      if (!fieldName || !fieldValue) break;
      console.log(`✍️ fill_field: "${fieldName}" → "${fieldValue}"`);
      // Tier 1: AX suchen
      try {
        const el = await axLayer.findElement(fieldName, {});
        if (el && el.x != null) {
          const fx = scaleWithCalibration(el.x, el.y).x;
          const fy = scaleWithCalibration(el.x, el.y).y;
          await mouse.setPosition({ x: Math.round(fx), y: Math.round(fy) });
          await mouse.leftClick(); await sleep(60);
          await mouse.leftClick(); await sleep(60);
          await mouse.leftClick(); await sleep(100);
          await keyboard.type(fieldValue);
          contextManager.invalidate();
          console.log(`✅ fill_field AX: "${fieldName}"`);
          trackUsage(1.2, 'fill_field').catch(() => {});
          break;
        }
      } catch(axE) { console.warn(`⚠️ fill_field AX: ${axE.message}`); }
      // Tier 2: miniFind() — Label finden → +260px rechts ins Eingabefeld klicken
      let tier2Hit = false;
      try {
        const sc2 = await takeCompressedScreenshot();
        const _fnCap   = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
        const _fnLower = fieldName.toLowerCase();
        let mfResult = await miniFind(sc2, `Formularfeld-Beschriftung "${_fnCap}" oder "${_fnLower}"`);
        if (!mfResult.found) {
          await sleep(300);
          const sc2b = await takeCompressedScreenshot();
          mfResult = await miniFind(sc2b, `Label ${_fnCap}`);
        }
        if (mfResult.found && mfResult.x != null) {
          // Immer +260px rechts vom gefundenen Label-Punkt → landet im Eingabefeld
          const corrX = Math.min(mfResult.x + 260, 750);
          const sx = Math.round(corrX * (calibration?.scaleX || 1));
          const sy = Math.round(mfResult.y * (calibration?.scaleY || 1));
          await mouse.setPosition({ x: sx, y: sy });
          await mouse.leftClick(); await sleep(60);
          await mouse.leftClick(); await sleep(60);
          await mouse.leftClick(); await sleep(100);
          await keyboard.type(fieldValue);
          contextManager.invalidate();
          console.log(`✅ fill_field: ${fieldName} @ (${sx},${sy}) [raw=${mfResult.x}→${corrX}]`);
          trackUsage(1.2, 'fill_field').catch(() => {});
          tier2Hit = true;
        } else {
          console.warn(`⚠️ fill_field: "${fieldName}" nicht gefunden`);
        }
      } catch(mfE) { console.warn(`⚠️ fill_field miniFind: ${mfE.message}`); }
      if (tier2Hit) break;

      // Kein Tier 3 — Cmd+F gefährlich in Texteditoren
      break;
    }

    case 'screen_fill_from_file': {
      const srcFile = step.source_file;
      const srcDir  = step.source_dir;
      console.log(`📋 screen_fill_from_file: "${srcFile}"`);
      if (!srcFile) { console.warn('⚠️ screen_fill_from_file: kein source_file'); break; }
      // 1. Datei finden
      const dirs = srcDir ? [srcDir] : undefined;
      const foundF = await ftFindFiles([srcFile], dirs);
      if (!foundF.length) { console.warn(`❌ "${srcFile}" nicht gefunden`); break; }
      // 2. Datei lesen
      const fileContent = await ftReadFile(foundF[0].path);
      if (!fileContent) { console.warn('❌ Datei leer'); break; }
      // 3. AX-Layer: echte Feldnamen aus dem offenen Formular lesen
      let axFormFields = [];
      try {
        const axSnap = contextManager.captureState ? contextManager.captureState() : null;
        const snap   = axSnap?.then ? await axSnap : axSnap;
        axFormFields = (snap?.fields || []).map(f => f.label || f.title || '').filter(Boolean);
      } catch(_) {}
      // Fallback: Standard-Felder wenn AX nichts findet (saubere Namen, keine Klammern)
      const fallbackFields = ['Name', 'Nachname', 'Tag', 'Monat', 'Jahr', 'Datum', 'Geburtsdatum', 'Email', 'Telefon', 'PLZ', 'Ort', 'Adresse', 'Betrag'];
      const cleanFields = axFormFields.length > 0 ? axFormFields : fallbackFields;
      console.log(`📋 Formularfelder (AX): ${axFormFields.length > 0 ? axFormFields.join(', ') : '(Fallback)'}`);

      // 4. Datei analysieren — Werte zu Feldern zuordnen
      const fname = foundF[0].path.split('/').pop();
      const fext  = (fname.match(/\.(\w+)$/) || [])[1] || '';
      let matchData = { parsed_data: {} };
      try {
        // Hinweis: AbortController + signal ist inkompatibel mit node-fetch v2 → weglassen
        const matchRes = await fetch(`${API}/api/agent/analyze-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token:     userToken,
            file_name: fname,
            file_ext:  fext,
            extracted: fileContent.substring(0, 3000),
            instruction: cleanFields.join(', ')
          })
        });
        matchData = await matchRes.json();
      } catch(ffE) { console.warn(`⚠️ analyze-file: ${ffE.message}`); }
      const rawFields = matchData?.parsed_data || {};
      const fieldMap  = Object.entries(rawFields)
        .filter(([k, v]) => k && v != null && String(v).trim() !== '' && String(v) !== 'null');
      console.log(`📋 Form-Match: ${fieldMap.length} Felder — ${fieldMap.map(([k,v])=>`${k}:${v}`).join(', ')}`);
      // 5. Felder ausfüllen — Feldname großschreiben damit miniFind Label findet
      for (const [field, value] of fieldMap) {
        const displayField = field.charAt(0).toUpperCase() + field.slice(1);
        await executeRouteStep({ action: 'fill_field', field_name: displayField, value: String(value), command: `${displayField} → ${value}` });
        await sleep(350);
      }
      trackUsage(4.3, 'fill_from_file').catch(() => {});
      break;
    }

    // ── Artifact aus Datei befüllen ───────────────────────────────────────
    case 'artifact_edit_from_file': {
      const foundF = await ftFindFiles([step.source_file], step.source_dir ? [step.source_dir] : undefined);
      if (!foundF.length) { console.warn(`❌ artifact_edit_from_file: "${step.source_file}" nicht gefunden`); break; }
      const fileContent = await ftReadFile(foundF[0].path);
      if (!fileContent) break;
      const fname = foundF[0].path.split('/').pop();
      const fext  = (fname.match(/\.(\w+)$/) || [])[1] || '';
      let parsed_data = {};
      try {
        const r = await fetch(`${API}/api/agent/analyze-file`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, file_name: fname, file_ext: fext, extracted: fileContent.substring(0, 3000), instruction: 'Extrahiere alle Daten als JSON. Jede Information als Schlüssel-Wert-Paar.' })
        });
        parsed_data = (await r.json()).parsed_data || {};
      } catch(e) { console.warn('⚠️ artifact_edit analyze-file:', e.message); }
      const artId   = step.artifact_id   || lastActiveArtifact?.id;
      const artName = step.artifact_name || lastActiveArtifact?.name || fname;
      if (artId) {
        try {
          const ExcelJS = require('exceljs');
          const artRows = await directSupabase('GET', `/artifacts?id=eq.${artId}&limit=1&select=*`);
          const artRow  = artRows?.[0];
          if (!artRow?.data_base64) throw new Error('Artifact nicht gefunden');
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(Buffer.from(artRow.data_base64, 'base64'));
          const ws = wb.worksheets[0];
          const headers = [];
          ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = String(cell.value || ''); });
          ws.addRow(headers.map(h => parsed_data[h] ?? ''));
          const newB64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
          const rowCount = ws.rowCount - 1;
          await directSupabase('PATCH', `/artifacts?id=eq.${artId}`, { data_base64: newB64, metadata: { ...(artRow.metadata || {}), rows: rowCount }, updated_at: new Date().toISOString() });
          console.log(`✅ artifact_edit_from_file: ${rowCount} Zeilen`);
          mainWindow.webContents.send('mira-artifact', { title: `📊 ${artName} — aktualisiert`, content: `${Object.entries(parsed_data).map(([k,v]) => `${k}: ${v}`).join('\n')}\n\n→ ${rowCount} Zeilen gesamt` });
        } catch(e) {
          console.error('❌ artifact_edit_from_file:', e.message);
          mainWindow.webContents.send('mira-artifact', { title: '❌ Artifact Fehler', content: e.message });
        }
      } else {
        mainWindow.webContents.send('mira-artifact', { title: `📊 ${artName}`, content: Object.entries(parsed_data).map(([k,v]) => `${k}: ${v}`).join('\n') });
      }
      break;
    }

    // ── Neues Artifact aus Datei erstellen ───────────────────────────────
    case 'artifact_create_from_file': {
      const foundF = await ftFindFiles([step.source_file], step.source_dir ? [step.source_dir] : undefined);
      if (!foundF.length) { console.warn(`❌ artifact_create_from_file: "${step.source_file}" nicht gefunden`); break; }
      const fileContent = await ftReadFile(foundF[0].path);
      if (!fileContent) break;
      const fname = foundF[0].path.split('/').pop();
      const fext  = (fname.match(/\.(\w+)$/) || [])[1] || '';
      let parsed_data = {};
      try {
        const r = await fetch(`${API}/api/agent/analyze-file`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, file_name: fname, file_ext: fext, extracted: fileContent.substring(0, 3000), instruction: 'Extrahiere alle Daten als JSON.' })
        });
        parsed_data = (await r.json()).parsed_data || {};
      } catch(e) { console.warn('⚠️ artifact_create analyze-file:', e.message); }
      const artName = step.artifact_name || fname.replace(/\.[^.]+$/, '');
      try {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Daten');
        const headers = Object.keys(parsed_data);
        ws.addRow(headers);
        ws.addRow(headers.map(h => parsed_data[h] ?? ''));
        const newB64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
        const artRes = await fetch(`${API}/api/artifacts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
          body: JSON.stringify({ name: artName, type: 'xlsx', data_base64: newB64, rows: 1 })
        });
        const artData = await artRes.json();
        const newId = artData?.artifact?.id || artData?.id;
        if (newId) lastActiveArtifact = { id: newId, name: artName, type: 'xlsx' };
        console.log(`✅ artifact_create_from_file: "${artName}" id=${newId}`);
        mainWindow.webContents.send('mira-artifact', { title: `📊 ${artName} — neu erstellt`, content: Object.entries(parsed_data).map(([k,v]) => `${k}: ${v}`).join('\n') });
      } catch(e) {
        console.error('❌ artifact_create_from_file:', e.message);
        mainWindow.webContents.send('mira-artifact', { title: `📊 ${artName}`, content: Object.entries(parsed_data).map(([k,v]) => `${k}: ${v}`).join('\n') });
      }
      break;
    }

    // ── Dokument/Datei zusammenfassen ────────────────────────────────────
    case 'document_summarize': {
      let fileContent = '';
      let fname = 'Dokument';
      if (step.source_file) {
        const foundF = await ftFindFiles([step.source_file], step.source_dir ? [step.source_dir] : undefined);
        if (foundF.length) { fileContent = await ftReadFile(foundF[0].path) || ''; fname = foundF[0].path.split('/').pop(); }
      }
      if (!fileContent) {
        try {
          const snap = contextManager.captureState ? await contextManager.captureState() : null;
          fileContent = snap ? contextManager.toPromptString(snap) : '';
          fname = snap?.windowTitle || 'Aktuelles Dokument';
        } catch(_) {}
      }
      if (!fileContent) { console.warn('⚠️ document_summarize: kein Inhalt'); break; }
      try {
        const r = await fetch(`${API}/api/agent/analyze-file`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: userToken, file_name: fname, file_ext: 'txt', extracted: fileContent.substring(0, 4000), instruction: 'Zusammenfassung', mode: 'summarize' })
        });
        const j = await r.json();
        const summary = j.summary_text || JSON.stringify(j.parsed_data) || 'Keine Zusammenfassung';
        mainWindow.webContents.send('mira-artifact', { title: `📄 ${fname} — Zusammenfassung`, content: summary });
      } catch(e) {
        console.error('❌ document_summarize:', e.message);
        mainWindow.webContents.send('mira-artifact', { title: '❌ Fehler', content: e.message });
      }
      break;
    }

    default:
      console.log(`⚠️ Unbekannter Step-Typ: ${step.action}`);
  }
}
  

// ── Hilfsfunktionen für Extract ──
function hasNullFields(data) {
  return Object.values(data).some(v => v === null || v === undefined);
}

function mergExtractData(old, fresh) {
  const merged = { ...old };
  for (const [k, v] of Object.entries(fresh)) {
    if ((merged[k] === null || merged[k] === undefined) && v !== null) {
      merged[k] = v;
    }
  }
  return merged;
}

//===========================================================================
                          //Routen
//==========================================================================                          

// Route speichern
ipcMain.handle('route-save', async (event, { name, description, steps }) => {
  if (!userToken) return { success: false, error: 'Nicht aktiviert' };
  try {
    const r = await fetch(`${API}/api/agent/route/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, name, description, steps })
    });
    return await r.json();
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// Alle Routen laden
ipcMain.handle('route-list', async () => {
  if (!userToken) return { success: false, error: 'Nicht aktiviert' };
  try {
    const r = await fetch(`${API}/api/agent/route/list?token=${userToken}`);
    return await r.json();
  } catch(e) {
    return { success: false, error: e.message };
  }
});

//====================================================================
                        //route run
//====================================================================                        

ipcMain.handle('route-run', async (event, routeId) => {
  if (!userToken) return { success: false, error: 'Nicht aktiviert' };
  try {
    const listRes = await fetch(`${API}/api/agent/route/list?token=${userToken}`);
    const listData = await listRes.json();
  const route = listData.routes?.find(r => r.id === routeId);
console.log(`📦 Route geladen:`, JSON.stringify(route?.steps?.slice(0,2), null, 2));
    if (!route) return { success: false, error: 'Route nicht gefunden' };

    const steps = route.steps;
    console.log(`🗺️ Route: "${route.name}" (${steps.length} Steps)`);

    const realW = await nutScreen.width();
    const realH = await nutScreen.height();

    let extractedData = {}; // ← Extracted Daten zwischen Steps teilen

    // ── Zielmodell: Route mit Ziel und erwartetem App-Typ starten ──────────
    recoveryEngine.beginRoute(route.goal || null, route.expectedAppType || null);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.action === 'desktop_start') {
        console.log('⏭️ desktop_start übersprungen');
        continue;
      }

      // ← Extracted Daten an type Steps weitergeben
      if (step.action === 'type' && Object.keys(extractedData).length > 0) {
        step.extracted_context = extractedData;
      }

      const stepLabel = step.command || step.value || step.action;
      console.log(`▶️ Step ${i+1}/${steps.length}: ${step.action} "${stepLabel}"`);

      // ── Pre-Step Snapshot für Undo + Recovery-Kontext ───────────────────
      recoveryEngine.recordStep(step, contextManager.captureState());

      await executeRouteStep(step);
      await sleep(1200);

      // ← Nach Extract: Daten merken
      if (step.action === 'extract' && step.extracted) {
        extractedData = step.extracted;
        console.log(`💾 Extract Daten gespeichert für nächste Steps`);
      }

      // ── AX Post-Step Check: Dialog? Fehlermeldung? Falsches Fenster? ────
      const postCheck = await recoveryEngine.checkPostStep(stepLabel);
      if (!postCheck.ok) {
        const recoveredAll = postCheck.recovered?.every(r => r.ok) ?? false;
        if (recoveredAll) {
          console.log(`✅ Recovery: alle Fehler behoben — Step ${i+1} weiter`);
        } else {
          // Recovery gescheitert — Route stoppen (Eskalation läuft intern)
          return {
            success:       false,
            failed_at_step: i + 1,
            reason:        postCheck.errors?.map(e => e.detail).join('; ') || 'AX-Fehler erkannt',
          };
        }
      }

      const screenshotBase64 = await takeCompressedScreenshot();

      const validRes = await fetch(`${API}/api/agent/route/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: userToken,
          route_id: routeId,
          screenshot: screenshotBase64,
          screen_size: { width: realW, height: realH },
          current_step_index: i
        })
      });
      const validData = await validRes.json();

      if (mainWindow) {
        mainWindow.webContents.send('route-step-update', {
          step: i + 1,
          total: steps.length,
          action: step.action,
          value: stepLabel,
          validation: validData.validation
        });
      }

      if (validData.validation && !validData.validation.ok) {
        const { correction } = validData.validation;
        if (correction) {
          if (validData.validation.urlError) {
            console.log(`🔗 URL-Fehler erkannt: "${validData.validation.reason}" → URL leeren + Retry (Step ${i+1})`);
            if (mainWindow) mainWindow.webContents.send('url-error-detected', { reason: validData.validation.reason, step: i + 1 });
          } else {
            console.log(`🔧 Claude korrigiert Step ${i+1}: [${correction.coordinate}] ${correction.action}`);
          }
          await executeRouteStep({
            action: correction.action,
            coordinate: correction.coordinate,
            command: correction.value,
            screen_width: realW,
            screen_height: realH
          });
          await sleep(500);
          i--;
          continue;
        }
        // Server hat keine Korrektur — Undo versuchen, dann Route stoppen
        console.log(`❌ Step ${i+1} fehlgeschlagen: ${validData.validation.reason}`);
        await recoveryEngine.undoLastSteps(1);
        return { success: false, failed_at_step: i + 1, reason: validData.validation.reason };
      }
      console.log(`✅ Step ${i+1} OK`);
    }

    console.log(`✅ Route "${route.name}" fertig!`);

    // ── Ziel-Verifikation (async, blockiert Route nicht) ─────────────────
    const goalCheck = await recoveryEngine.verifyGoal();
    if (goalCheck.goal) {
      fetch(`${API}/api/brain/verify-goal`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: userToken, goal: goalCheck.goal, context: goalCheck.context, route_id: routeId }),
      }).then(async r => {
        const d = await r.json().catch(() => ({}));
        if (d.achieved === false) {
          console.log(`⚠️ Ziel nicht erreicht: "${goalCheck.goal}" — ${d.reason || ''}`);
          if (mainWindow) mainWindow.webContents.send('goal-not-achieved', { goal: goalCheck.goal, reason: d.reason });
        } else {
          console.log(`🎯 Ziel erreicht: "${goalCheck.goal}"`);
        }
      }).catch(() => {});
    }

    return { success: true, steps_completed: steps.length };

  } catch(e) {
    console.error('❌ route-run error:', e);
    return { success: false, error: e.message };
  }
});

// ═══════════════════════════════════════
// ROUTE RECORDING SYSTEM (0-9)
// ═══════════════════════════════════════

let isRouteRecording = false;
let routeRecordingSteps = [];
let routeRecordingName = '';

ipcMain.handle('start-route-record', async (event, name) => {
  routeRecordingName = name;
  routeRecordingSteps = [];
  isRouteRecording = true;

  if (!calibrationWindow) createCalibrationWindow();
  calibrationWindow.show();
  
  // Durchlassen aber Panel fängt per mouseenter
  calibrationWindow.setIgnoreMouseEvents(true, { forward: true });
  
  calibrationWindow.webContents.send('start-recording-overlay', { name });
  console.log(`🔴 Route Recording gestartet: "${name}"`);
  return { success: true };
});

ipcMain.handle('stop-route-record', async () => {
  isRouteRecording = false;
  return { success: true, steps: routeRecordingSteps };
});

ipcMain.on('recording-cancelled', () => {
  isRouteRecording = false;
  routeRecordingSteps = [];
  routeRecordingName = '';
  if (calibrationWindow) {
    calibrationWindow.setIgnoreMouseEvents(true, { forward: true }); // ← zurücksetzen
    calibrationWindow.hide();
  }
  if (mainWindow) mainWindow.webContents.send('recording-cancelled');
});

ipcMain.handle('get-recording-steps', () => {
  return routeRecordingSteps;
});

// ══════════════════════════════════════════════════════════════════════════════
// ── "Hey MIRA" Kontextfrage generieren ────────────────────────────────────────
function buildContextQuestion(perception) {
  if (!perception || !perception.scene) return 'Was kann ich für dich tun?';
  const scene = perception.scene;
  const app   = (perception.app_type || '').toLowerCase();
  if (perception.is_form)
    return `Ich sehe ${scene}. Ich kann das Formular ausfüllen. Hast du eine Datei mit den Infos oder kannst du sie mir kurz nennen?`;
  if (/word|dokument|schreib|text|pages/i.test(app))
    return `Ich sehe ${scene}. Soll ich weiterschreiben oder etwas anderes machen? Wo finde ich die nötigen Infos?`;
  if (/excel|tabelle|xlsx|numbers/i.test(app))
    return `Ich sehe ${scene}. Was soll ich mit der Tabelle tun?`;
  if (/mail|email|outlook|thunderbird/i.test(app))
    return `Ich sehe ${scene}. Soll ich die Mail schreiben oder bearbeiten?`;
  if (/browser|chrome|opera|firefox|safari|edge/i.test(app))
    return `Ich sehe ${scene}. Was soll ich im Browser für dich erledigen?`;
  return `Ich sehe ${scene}. Was soll ich für dich tun?`;
}

// VOICE COMMAND — empfängt Sprachbefehl vom Renderer, reiht ihn als Task ein
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('voice-command', async (event, { text }) => {
  if (!text || !text.trim()) return { queued: false, reason: 'empty' };
  if (!userToken)            return { queued: false, reason: 'not_connected' };

  const command = text.trim();
  console.log(`🎤 Voice Befehl: "${command}"`);

  try {
    // ── "Hey MIRA" → Context-Modus: Bildschirm scannen + zurückfragen ──────
    const isHeyMira = /^hey\s*mira[,!.]?\s*$/i.test(command);
    if (isHeyMira) {
      console.log('🔮 "Hey MIRA" → Context-Modus');
      try {
        const sc  = await takeCompressedScreenshot();
        const ax  = contextManager.toPromptString(contextManager.captureState());
        const perception = await wahrnehmung.wahrnehmen({ screenshot: sc, axContext: ax, token: userToken, API });
        pendingContextPerception = perception;
        const question = buildContextQuestion(perception);
        console.log(`🔮 Kontextfrage: "${question}"`);
        if (mainWindow) mainWindow.webContents.send('mira-ask', { text: question, mode: 'voice_followup' });
      } catch(e) {
        console.warn('Context-Modus Fehler:', e.message);
        if (mainWindow) mainWindow.webContents.send('mira-ask', { text: 'Was kann ich für dich tun?', mode: 'voice_followup' });
      }
      return { mode: 'context_question' };
    }

    // ── Artifact-Insert Erkennung ──
    // Wenn ein aktives Artifact gesetzt ist + Befehl ist ein Dokument-Task
    // → direkt als artifact_edit routen, NICHT durch Server-Dispatcher (der macht sonst form_fill)
    const hasFileRef   = /\b\w[\w\-]*\.(pdf|docx?|xlsx?|csv|txt|png|jpg)\b/i.test(command);
    const hasInsertKw  = /\b(f[üu]g\w*|erg[äa]nz\w*|hinzu\w*|eintrag\w*|trag\w*|füg\w*|zusammenfass\w*|fass\w*|übertrag\w*|import\w*)\b/i.test(command);
    const hasHierRein  = /\b(hier\s*(rein|ein|drin)|in\s*(das|die|den)\s*(dokument|artifact|tabelle|liste))\b/i.test(command);
    const isInsertCmd  = (hasFileRef || hasHierRein) && hasInsertKw;

    if (isInsertCmd && lastActiveArtifact) {
      console.log(`📂 Voice → artifact_edit (Artifact: ${lastActiveArtifact.name})`);
      // Dateiname aus Befehl extrahieren
      const fileMatch = command.match(/\b([\w\-]+\.(pdf|docx?|xlsx?|csv|txt))\b/i);
      const srcFile   = fileMatch?.[1] || null;
      // Direkt als file-task mit artifact_edit Action einreihen (kein Server-Roundtrip für Klassifizierung)
      const taskPayload = {
        token:   userToken,
        command: command,
        type:    'file_task',
        parsed:  {
          action:        'artifact_edit',
          artifact_id:   lastActiveArtifact.id,
          artifact_name: lastActiveArtifact.name,
          search_patterns: srcFile ? [srcFile] : [],
          instruction:   command,
        }
      };
      try {
        const res  = await fetch(`${API}/api/agent/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskPayload)
        });
        const data = await res.json();
        if (data.success || data.task_id || data.queued) {
          console.log(`✅ artifact_edit eingereiht: ${data.task_id || 'ok'}`);
          return { queued: true };
        }
      } catch(_) {}
      // Fallback: als normaler Queue-Eintrag mit Artifact-Kontext
      const fileCmd = `${command} [ARBEITE_IN_ARTIFACT: ${lastActiveArtifact.name}, ID: ${lastActiveArtifact.id}]`;
      await fetch(`${API}/api/agent/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken, command: fileCmd, source: 'voice' })
      }).catch(() => {});
      return { queued: true };
    }

    // ── Normaler Weg: Kontext aufnehmen + in Queue einreihen ──
    const ctx = contextManager.captureState();
    const ctxString = contextManager.toPromptString(ctx);

    const res = await fetch(`${API}/api/agent/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:   userToken,
        command,
        source:  'voice',
        context: ctxString
      })
    });

    const data = await res.json();
    if (data.success || data.queued) {
      console.log(`✅ Voice Task eingereiht: "${command}"`);
      return { queued: true };
    } else {
      console.warn(`⚠️ Voice Task Fehler:`, data);
      return { queued: false, reason: data.error || 'api_error' };
    }
  } catch (e) {
    console.error(`❌ voice-command Fehler:`, e.message);
    return { queued: false, reason: e.message };
  }
});

// ── Follow-up Antwort nach "Hey MIRA" Context-Frage ──────────────────────────
ipcMain.handle('voice-context-answer', async (event, { text }) => {
  if (!text?.trim()) return { queued: false, reason: 'empty' };
  if (!userToken)    return { queued: false, reason: 'not_connected' };

  const command = text.trim();

  // ── Artifact-Insert: wenn aktives Artifact + Dokument-Befehl → direkt als artifact_edit ──
  if (lastActiveArtifact) {
    const hasFileRef  = /\b\w[\w\-]*\.(pdf|docx?|xlsx?|csv|txt|png|jpg)\b/i.test(command);
    const hasInsertKw = /\b(f[üu]g\w*|erg[äa]nz\w*|hinzu\w*|eintrag\w*|trag\w*|füg\w*|zusammenfass\w*|fass\w*|übertrag\w*|import\w*)\b/i.test(command);
    const hasHierRein = /\b(hier\s*(rein|ein|drin)|in\s*(das|die|den)\s*(dokument|artifact|tabelle|liste))\b/i.test(command);
    if ((hasFileRef || hasHierRein) && hasInsertKw) {
      console.log(`📂 Chat → artifact_edit (Artifact: ${lastActiveArtifact.name})`);
      const fileMatch = command.match(/\b([\w\-]+\.(pdf|docx?|xlsx?|csv|txt))\b/i);
      const srcFile   = fileMatch?.[1] || null;
      try {
        const res = await fetch(`${API}/api/agent/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: userToken, command,
            type:  'file_task',
            parsed: {
              action:          'artifact_edit',
              artifact_id:     lastActiveArtifact.id,
              artifact_name:   lastActiveArtifact.name,
              search_patterns: srcFile ? [srcFile] : [],
              instruction:     command,
            }
          })
        });
        const data = await res.json();
        if (data.success || data.task_id || data.queued) {
          console.log(`✅ artifact_edit (Chat) eingereiht`);
          return { queued: true };
        }
      } catch(_) {}
    }
  }

  const perception = pendingContextPerception;
  pendingContextPerception = null;

  // Befehl explizit für den Dispatcher aufbauen
  const scene    = perception?.scene    || '';
  const appType  = perception?.app_type || '';
  const isForm   = perception?.is_form  || false;

  let enrichedCommand;
  if (isForm && scene) {
    enrichedCommand = `Fülle das sichtbare Formular aus. Was ich auf dem Bildschirm sehe: ${scene}. Der Nutzer sagt dazu: ${command}`;
  } else if (scene) {
    enrichedCommand = `Aufgabe bezogen auf aktuellen Bildschirm (${appType || 'App'}: ${scene}): ${command}`;
  } else {
    enrichedCommand = command;
  }
  console.log(`🔮 Context-Task: "${enrichedCommand.substring(0, 120)}..."`);

  const ctx = contextManager.captureState();
  const ctxString = contextManager.toPromptString(ctx);

  try {
    const res = await fetch(`${API}/api/agent/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:   userToken,
        command: enrichedCommand,
        source:  'voice_context',
        context: ctxString
      })
    });
    const data = await res.json();
    if (data.success || data.queued) {
      console.log(`✅ Context-Answer Task: "${text}"`);
      return { queued: true };
    }
    console.warn(`⚠️ Context-Answer Task fehlgeschlagen: ${data.error || JSON.stringify(data)}`);
    return { queued: false, reason: data.error || 'Unbekannter Fehler' };
  } catch(e) {
    console.error(`❌ Context-Answer Netzwerkfehler: ${e.message}`);
    return { queued: false, reason: 'Verbindung fehlgeschlagen: ' + e.message };
  }
});

// ── Aktives Artifact vom Frontend synchronisieren (für Voice-Routing) ──
ipcMain.handle('set-active-artifact', (event, artifact) => {
  lastActiveArtifact = artifact; // null zum Löschen, oder { id, name, type }
  console.log(artifact ? `📌 Active Artifact: ${artifact.name}` : `📌 Active Artifact: (keins)`);
  return true;
});


// ── Totschalter — laufenden Task sofort als failed markieren ─────────────────
ipcMain.on('kill-current-task', async () => {
  if (runningTasks.size === 0) {
    console.log('🛑 Totschalter: kein laufender Task');
    if (mainWindow) mainWindow.webContents.send('task-killed', { hadTask: false });
    return;
  }
  abortCurrentTask = true;
  const ids = [...runningTasks.keys()];
  console.log(`🛑 Totschalter: ${ids.length} Task(s) abgebrochen`);
  for (const id of ids) {
    await markTaskComplete(id, 'failed').catch(() => {});
  }
  runningTasks.clear();
  setTimeout(() => { abortCurrentTask = false; }, 1000); // Reset nach 1s
  if (mainWindow) mainWindow.webContents.send('task-killed', { hadTask: true });
});

ipcMain.on('recording-next-round', (event, { offset }) => {
  // stepOffset merken für nächste Keypresses
  routeRecordingOffset = offset;
});

ipcMain.handle('clear-recording', () => {
  isRouteRecording = false;
  routeRecordingSteps = [];
  routeRecordingName = '';
  return { success: true };
});

ipcMain.on('route-early-save', async () => {
  if (!isRouteRecording || routeRecordingSteps.length === 0) return;
  isRouteRecording = false;
  try {
    await fetch(`${API}/api/agent/route/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken, name: routeRecordingName, steps: routeRecordingSteps })
    });
  } catch(e) { console.error('❌', e.message); }
  if (calibrationWindow) calibrationWindow.webContents.send('route-record-done', { name: routeRecordingName, steps: routeRecordingSteps.length });
  if (mainWindow) mainWindow.webContents.send('route-record-done', { name: routeRecordingName, steps: routeRecordingSteps.length });

  setTimeout(() => { if (calibrationWindow) calibrationWindow.hide(); }, 2500);
});

uIOhook.on('keydown', async (event) => {

  // F9 = Training Position bestätigen — IMMER, vor allem anderen
  if (event.keycode === 57 && activeTraining) {
    const pos = await mouse.getPosition();
    console.log(`📍 F9 Training-Position bestätigt: [${pos.x}, ${pos.y}]`);
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('training-confirm-position', { x: pos.x, y: pos.y });
    });
    return;
  }

  if (!isRouteRecording) return;

  const numKeys = { 
    11:0,
    2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:7, 9:8, 10:9
  };

  const pressedNum = numKeys[event.keycode];
  if (pressedNum === undefined) return;

  // 0 = Desktop Ausgangspunkt
  if (pressedNum === 0) {
    const sc = await takeCompressedScreenshot();
    const mousePos = await mouse.getPosition();
    routeRecordingSteps = [];
    routeRecordingSteps.push({
      step: 0, action: 'desktop_start',
      screenshot_ref: sc,
      coordinate: [mousePos.x, mousePos.y],
      expected: 'Desktop ist sichtbar'
    });
    console.log('📸 Step 0: Desktop gespeichert');
    if (calibrationWindow) calibrationWindow.webContents.send('route-step-recorded', { stepNum: 0 });
    if (mainWindow) mainWindow.webContents.send('route-step-recorded', { stepNum: 0, total: 1 });
    return;
  }

  // 1-9 = Command Panel zeigen, weiterzählen wenn schon Steps da
  const sc = await takeCompressedScreenshot();
  const mousePos = await mouse.getPosition();

  const vorhandeneSteps = routeRecordingSteps.filter(s => s.step >= 1).length;
  const offset = Math.floor(vorhandeneSteps / 8) * 8;
  const actualStepNum = pressedNum + offset;

  if (calibrationWindow) {
    calibrationWindow.webContents.send('show-cmd-panel', {
      stepNum: actualStepNum,
      coordinate: [mousePos.x, mousePos.y]
    });
  }
});


ipcMain.on('cmd-panel-result', async (event, { stepNum, coordinate, type, command }) => {
  const sc = await takeCompressedScreenshot();
  const screenWidth = await nutScreen.width();
  const screenHeight = await nutScreen.height();

  const step = {
    step: stepNum,
    action: type,
    coordinate,
    command: command || null,
    screenshot_ref: sc,
    screen_width: screenWidth,
    screen_height: screenHeight
  };

  const idx = routeRecordingSteps.findIndex(s => s.step === stepNum);
  if (idx >= 0) routeRecordingSteps[idx] = step;
  else { routeRecordingSteps.push(step); routeRecordingSteps.sort((a,b) => a.step - b.step); }

  console.log(`📍 Step ${stepNum} [${type}]: ${command || 'kein Befehl'}`);
  if (calibrationWindow) calibrationWindow.webContents.send('route-step-recorded', { stepNum });
  if (mainWindow) mainWindow.webContents.send('route-step-recorded', { stepNum, total: routeRecordingSteps.length });
});

app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-gpu');


ipcMain.handle('route-delete', async (event, routeId) => {
  try {
    const token = store.get('userToken'); // ← userToken!
    console.log(`🗑️ Delete Route ${routeId} | Token: ${token ? 'OK' : 'FEHLT'}`);
    const r = await fetch(`${API}/api/agent/route/${routeId}?token=${token}`, {
      method: 'DELETE'
    });
    const d = await r.json();
    console.log(`🗑️ Response:`, d);
    return d;
  } catch(e) {
    return { success: false, error: e.message };
  }
});


/// ═══════════════════════════════════════
// TRAINING — Electron seitig
// ═══════════════════════════════════════

let activeTraining = null;

ipcMain.handle('training-start', async (event, command) => {
  const realW = await nutScreen.width();
  const realH = await nutScreen.height();

  const res = await fetch(`${API}/api/brain/training-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: userToken, command })
  });
  const data = await res.json();
  if (!data.success) return { success: false, error: data.error };

  activeTraining = {
    route_id: data.route_id,
    route_name: data.route_name,
    steps: data.steps,
    current: 0,
    total: data.steps.length,
    screenW: realW,
    screenH: realH
  };

  // Training Overlay Fenster öffnen
  let trainingWin = new BrowserWindow({
    width: 480, height: 420,
    alwaysOnTop: true,
    frame: false,
    movable: true,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  trainingWin.loadFile('training-overlay.html');

  // training-init schicken sobald Overlay geladen ist
  trainingWin.webContents.on('did-finish-load', () => {
    trainingWin.webContents.send('training-init', data);
  });

  console.log(`🎓 Training: "${data.route_name}" — ${data.steps.length} Steps`);
  return { success: true, route_name: data.route_name, total: data.steps.length };
});

ipcMain.handle('training-next-step', async () => {
  if (!activeTraining) return { success: false, error: 'Kein Training aktiv' };
  if (activeTraining.current >= activeTraining.total) {
    return { success: false, done: true };
  }

  const step = activeTraining.steps[activeTraining.current];
  const realW = activeTraining.screenW;
  const realH = activeTraining.screenH;

  const sc = await takeCompressedScreenshot();

  // Manuell bestätigte Koordinate hat höchste Priorität — kein resolve-step
  let x = step.coordinate?.[0] || 0;
  let y = step.coordinate?.[1] || 0;

  if (!step.coordinate || step.coordinate[0] === 0) {
    // Keine gespeicherte Koordinate → resolve-step fragen
    try {
      const ctxRes = await fetch(`${API}/api/brain/resolve-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: userToken,
          step,
          screen_size: { width: realW, height: realH },
          screenshot: sc
        })
      });
      const ctxData = await ctxRes.json();
      if (ctxData.success && ctxData.coordinate) {
        x = ctxData.coordinate[0];
        y = ctxData.coordinate[1];
      }
    } catch(e) {
      console.warn('resolve-step Fehler:', e.message);
    }
  } else {
    console.log(`📍 Training: gespeicherte Koordinate verwendet [${x}, ${y}]`);
  }

  // Maus hinbewegen damit User sieht wo MIRA klicken würde
  await mouse.setPosition({ x, y });

  // Merken für Feedback
  activeTraining.lastStep = step;
  activeTraining.lastClick = { x, y };

  console.log(`🎯 Training Step ${activeTraining.current + 1}/${activeTraining.total}: "${step.command}" @ [${x}, ${y}]`);

  return {
    success: true,
    step_index: activeTraining.current + 1,
    total: activeTraining.total,
    command: step.command,
    clicked_at: [x, y],
    screenshot: sc
  };
});

ipcMain.handle('training-feedback', async (event, { feedback, correct_x, correct_y }) => {
  if (!activeTraining || !activeTraining.lastStep) return { success: false };

  const step = activeTraining.lastStep;
  const clicked = activeTraining.lastClick;

  // ── GLEICHE Kürzung wie in executeRouteStep ──
  const shortLabel = (step.command || '')
    .replace(/^klicke? (auf )?(das |die |den )?/i, '')
    .replace(/ in der (leiste|taskbar|menüleiste|dock).*/i, '')
    .replace(/\s+/g, ' ')
    .trim() || step.command;

  await fetch(`${API}/api/brain/training-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: userToken,
      element_label: shortLabel,  // ← kurzer Label!
      clicked_position: [clicked.x, clicked.y],
      correct_position: feedback === 'correct' ? [clicked.x, clicked.y] : [correct_x, correct_y],
      feedback,
      screen_size: { width: activeTraining.screenW, height: activeTraining.screenH }
    })
  });

  console.log(`✅ Step ${activeTraining.current + 1} gespeichert: "${step.command}" feedback=${feedback}`);

  // ── Wenn Step "senden" enthält → unter "senden" in coord-cache speichern ──
  // Damit der mail_write Senden-Step die trainierte Position findet
  const isSendenStep = /send(en)?|abschick|absend/i.test(shortLabel);
  if (isSendenStep) {
    const finalX = feedback === 'correct' ? clicked.x : correct_x;
    const finalY = feedback === 'correct' ? clicked.y : correct_y;
    if (finalX && finalY) {
      // In coord-cache unter "senden" speichern (für alle Browser)
      for (const bid of ['com.google.Chrome','com.operasoftware.Opera','com.apple.Safari','org.mozilla.firefox','com.microsoft.edgemac']) {
        coordCache.set(bid, 'senden', finalX, finalY, 1.0, 'training', null);
      }
      console.log(`📧 Senden-Koordinate in Cache: [${finalX}, ${finalY}]`);
    }
  }

  // ── Koordinate in der Route aktualisieren wenn falsch ──
  if (feedback === 'wrong' && correct_x != null && correct_y != null) {
    const idx = activeTraining.current;
    if (activeTraining.steps[idx]) {
      activeTraining.steps[idx].coordinate = [correct_x, correct_y];
      console.log(`📍 Route-Koordinate korrigiert: Step ${idx + 1} → [${correct_x}, ${correct_y}]`);
      // Auch coord-cache für dieses Label löschen — damit nächste Ausführung die korrekte Pos nimmt
      try {
        const ctx = await contextManager.captureState().catch?.() || contextManager.captureState();
        const bundleId = (ctx?.app?.bundleId) || null;
        if (bundleId) coordCache.invalidate(bundleId, shortLabel);
        // Alle Browser löschen (falls Label browser-weit gecacht)
        for (const bid of ['com.google.Chrome','com.operasoftware.Opera','com.apple.Safari','org.mozilla.firefox']) {
          coordCache.invalidate(bid, shortLabel);
        }
      } catch {}
    }
    // Route persistieren
    try {
      await fetch(`${API}/api/agent/route/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: userToken,
          name: activeTraining.route_name,
          steps: activeTraining.steps
        })
      });
      console.log(`💾 Route "${activeTraining.route_name}" mit korrigierten Koordinaten gespeichert`);
    } catch (e) {
      console.warn('⚠️ Route konnte nicht gespeichert werden:', e.message);
    }
  }

  // Weiter
  activeTraining.current++;
  const done = activeTraining.current >= activeTraining.total;

  if (done) {
    const name = activeTraining.route_name;
    activeTraining = null;
    console.log(`🎉 Training komplett: "${name}"`);
    return { success: true, done: true, message: `Training "${name}" abgeschlossen!` };
  }

  return { success: true, done: false };
});

ipcMain.handle('training-cancel', async () => {
  activeTraining = null;
  console.log('🛑 Training abgebrochen');
  return { success: true };
});

ipcMain.handle('training-get-mouse-pos', async () => {
  const pos = await mouse.getPosition();
  return { x: pos.x, y: pos.y };
});


ipcMain.handle('open-pc-training', async () => {
  if (pcTrainingWin && !pcTrainingWin.isDestroyed()) {
    pcTrainingWin.focus();
    return { success: true };
  }
  const { width, height } = electronScreen.getPrimaryDisplay().bounds;

  pcTrainingWin = new BrowserWindow({
    x: 0, y: 0,
    width: width, height: height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  pcTrainingWin.loadFile('pc-training-overlay.html');
  pcTrainingWin.setIgnoreMouseEvents(true, { forward: true }); // Maus geht durch, außer über Panel
  pcTrainingWin.setAlwaysOnTop(true, 'screen-saver');
  pcTrainingWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pcTrainingWin.on('closed', () => { pcTrainingWin = null; });
  console.log('🖥️ PC Training geöffnet');
  return { success: true };
});

// Maus-Steuerung für PC-Training Panel
ipcMain.on('pc-training-release-mouse', () => {
  if (pcTrainingWin && !pcTrainingWin.isDestroyed())
    pcTrainingWin.setIgnoreMouseEvents(false);
});
ipcMain.on('pc-training-needs-mouse', () => {
  if (pcTrainingWin && !pcTrainingWin.isDestroyed())
    pcTrainingWin.setIgnoreMouseEvents(true, { forward: true });
});

// Device Knowledge speichern
ipcMain.handle('save-device-knowledge', async (event, data) => {
  try {
    const realW = await nutScreen.width();
    const realH = await nutScreen.height();

    const res = await fetch(`${API}/api/brain/device-knowledge-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: userToken,
        konzept: data.konzept,
        methode: data.methode,
        position_x: data.position_x,
        position_y: data.position_y,
        url: data.url,
        app_name: data.app_name,
        screen_width: realW,
        screen_height: realH
      })
    });

    const result = await res.json();
    console.log(`🖥️ Device Knowledge: "${data.konzept}" → ${data.methode} gespeichert`);
    return result;
  } catch(e) {
    console.error('❌ save-device-knowledge:', e.message);
    return { success: false, error: e.message };
  }
});




// ═══════════════════════════════════════════════════════
// MIRA SETUP OVERLAY — main.js Handler
// ═══════════════════════════════════════════════════════

let setupWindow = null;

// Button in main App → Setup öffnen
ipcMain.handle('open-setup-overlay', async () => {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 820,
    height: 600,
    minWidth: 700,
    minHeight: 500,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  setupWindow.loadFile('mira-setup-overlay.html');

  setupWindow.on('closed', () => {
    setupWindow = null;
  });

  return { success: true };
});

// Screenshot für Mail-Training
ipcMain.handle('setup-screenshot', async () => {
  try {
    const sc = await takeCompressedScreenshot(); // deine bestehende Funktion
    return sc;
  } catch(e) {
    console.error('setup-screenshot Fehler:', e.message);
    return null;
  }
});

// device_knowledge speichern (ergänzt, überschreibt Training Overlay NICHT)
ipcMain.handle('setup-save-knowledge', async (event, { key, value }) => {
  try {
    const res = await fetch(`${API}/api/brain/device-knowledge-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: userToken,
        konzept: key,
        methode: 'wizard',
        position_x: value?.zone?.x1 || null,
        position_y: value?.zone?.y1 || null,
        extra: JSON.stringify(value),  // alles rein als JSON
        source: 'wizard'
      })
    });
    const result = await res.json();
    console.log(`✅ setup-knowledge → ${key}`);
    return result;
  } catch(e) {
    console.error('setup-save-knowledge Fehler:', e.message);
    return { success: false };
  }
});
 

// Setup Fenster schließen
ipcMain.on('setup-close', () => {
  if (setupWindow) {
    setupWindow.close();
    setupWindow = null;
  }
});

ipcMain.handle('setup-capture-zone', async () => {
  setupWindow.hide();
  await sleep(400);

  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().bounds;

let captureWin = new BrowserWindow({
  x: 0, y: 0,
  width: width + 100,
  height: height + 100,
  transparent: true,       // ← MUSS true sein
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  backgroundColor: '#00000000',  // ← vollständig transparent
  webPreferences: { nodeIntegration: true, contextIsolation: false }
});

  captureWin.setAlwaysOnTop(true, 'screen-saver');
  captureWin.loadFile('zone-capture.html');

  const zone = await new Promise(resolve => {
    ipcMain.once('zone-captured', (event, data) => resolve(data));
  });

  captureWin.close();
  await sleep(200);
  setupWindow.show();
  return zone;
});

// ═══════════════════════════════════════
// ONBOARDING IPC
// ═══════════════════════════════════════

// Scan installed apps on Mac (/Applications) or Windows (common paths)
ipcMain.handle('check-ax-permission', () => {
  const result = axLayer.checkPermission();
  // On macOS: if not granted, open System Settings so the user can allow it
  if (process.platform === 'darwin' && !result.granted) {
    const { shell } = require('electron');
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  }
  return { granted: !!result.granted };
});

ipcMain.handle('onboarding-scan-apps', async () => {
  const fs = require('fs');
  const APP_DEFS = [
    // Mail
    { name: 'Mail',        icon: '📧', bundle: 'com.apple.mail',         mac: '/Applications/Mail.app',              win: null },
    { name: 'Outlook',     icon: '📨', bundle: 'com.microsoft.Outlook',   mac: '/Applications/Microsoft Outlook.app', win: 'OUTLOOK.EXE' },
    { name: 'Thunderbird', icon: '⚡', bundle: 'thunderbird',             mac: '/Applications/Thunderbird.app',       win: 'thunderbird.exe' },
    // Browser
    { name: 'Chrome',    icon: '🌐', mac: '/Applications/Google Chrome.app',    win: 'chrome.exe' },
    { name: 'Firefox',   icon: '🦊', mac: '/Applications/Firefox.app',           win: 'firefox.exe' },
    { name: 'Safari',    icon: '🧭', mac: '/Applications/Safari.app',            win: null },
    { name: 'Edge',      icon: '🌀', mac: '/Applications/Microsoft Edge.app',    win: 'msedge.exe' },
    // Office
    { name: 'Word',      icon: '📝', mac: '/Applications/Microsoft Word.app',    win: 'WINWORD.EXE' },
    { name: 'Excel',     icon: '📊', mac: '/Applications/Microsoft Excel.app',   win: 'EXCEL.EXE' },
    { name: 'PowerPoint',icon: '📽', mac: '/Applications/Microsoft PowerPoint.app', win: 'POWERPNT.EXE' },
    { name: 'Numbers',   icon: '🔢', mac: '/Applications/Numbers.app',           win: null },
    { name: 'Pages',     icon: '📄', mac: '/Applications/Pages.app',             win: null },
    // Accounting / Business
    { name: 'DATEV',     icon: '💼', mac: null, win: 'DATEV.exe' },
    { name: 'Lexware',   icon: '📒', mac: null, win: 'Lexware.exe' },
    { name: 'Slack',     icon: '💬', mac: '/Applications/Slack.app',         win: 'slack.exe' },
    { name: 'Teams',     icon: '🤝', mac: '/Applications/Microsoft Teams.app', win: 'Teams.exe' },
    { name: 'Zoom',      icon: '📹', mac: '/Applications/zoom.us.app',        win: 'Zoom.exe' },
    { name: 'Finder',    icon: '📁', mac: '/System/Library/CoreServices/Finder.app', win: null },
  ];

  const isMac = process.platform === 'darwin';
  const found = [];
  for (const def of APP_DEFS) {
    const checkPath = isMac ? def.mac : null; // Windows check would use registry; skip for now
    if (!checkPath) continue;
    try {
      if (fs.existsSync(checkPath)) found.push({ name: def.name, icon: def.icon, bundle: def.bundle || null });
    } catch {}
  }

  // Cap at 9 for the 3-column grid
  return { apps: found.slice(0, 9) };
});

ipcMain.handle('onboarding-complete', async (event, { industry, tasks, apps }) => {
  try {
    const result = await miraBrain.generateFromOnboarding({ industry, tasks, apps });
    console.log(`🧠 Onboarding: KB generiert — ${result.triggerCount} Trigger, ${result.limitCount} Grenzen`);
    return result;
  } catch (e) {
    console.error('❌ Onboarding generateFromOnboarding:', e.message);
    return { triggerCount: 0, limitCount: 0 };
  }
});

ipcMain.handle('onboarding-finish', () => {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow._allowClose = true;
    onboardingWindow.close();
  }
  if (mainWindow) mainWindow.show();
});

// ═══════════════════════════════════════
// WISSENSBASE IPC
// ═══════════════════════════════════════

ipcMain.handle('kb-open', () => {
  createKnowledgeBaseWindow();
});

ipcMain.handle('kb-load', async () => {
  try {
    await miraBrain.load(true);
    return { success: true, kb: miraBrain.get() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('kb-save', async (event, kb) => {
  try {
    await miraBrain.save(kb);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('kb-close', () => {
  if (knowledgeBaseWindow && !knowledgeBaseWindow.isDestroyed()) {
    knowledgeBaseWindow.close();
  }
});

// ── Mitarbeiter IPC ───────────────────────────────────────────────────────
ipcMain.handle('open-mitarbeiter', () => { createMitarbeiterWindow(); });

// ── Device Knowledge IPC ─────────────────────────────────────────────────
ipcMain.handle('open-device-knowledge', () => {
  createDeviceKnowledgeWindow();
});

ipcMain.handle('device-knowledge-screenshot', async () => {
  const sc = await takeCompressedScreenshot();
  const ax = await contextManager.captureState(true);
  return { screenshot: sc, ax_state: contextManager.toPromptString(ax) };
});

ipcMain.handle('device-knowledge-save', async (event, { app_name, text, screenshot, ax_state }) => {
  try {
    const realW = await nutScreen.width();
    const realH = await nutScreen.height();
    const res = await fetch(`${API}/api/brain/device-knowledge-learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: userToken,
        app_name,
        text,
        screenshot: screenshot || null,
        ax_state: ax_state || null,
        screen_width: realW,
        screen_height: realH
      })
    });
    const result = await res.json();
    console.log(`🧠 Device Knowledge Learn: ${result.learned?.length || 0} Konzepte gespeichert`);
    return result;
  } catch(e) {
    console.error('❌ device-knowledge-save:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('device-knowledge-close', () => {
  if (deviceKnowledgeWindow && !deviceKnowledgeWindow.isDestroyed()) deviceKnowledgeWindow.close();
});

// ── User Profile IPC ──────────────────────────────────────────────────────
ipcMain.handle('open-user-profile', () => {
  createUserProfileWindow();
});

ipcMain.handle('profile-get-settings', async () => {
  if (!userToken) return { success: false, error: 'Nicht angemeldet' };
  try {
    const res = await fetch(`${API}/api/users/profile-settings`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const data = await res.json();
    if (data.success) userProfileSettings = data.settings || {};
    return data;
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('profile-save-settings', async (event, settings) => {
  if (!userToken) return { success: false, error: 'Nicht angemeldet' };
  try {
    const res = await fetch(`${API}/api/users/profile-settings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    if (data.success) userProfileSettings = settings;
    return data;
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ── Templates IPC ────────────────────────────────────────────────────────
ipcMain.handle('templates-open', () => {
  createTemplatesWindow();
});

ipcMain.handle('templates-list', async (_, appFilter) => {
  try {
    const url = appFilter
      ? `${API}/api/templates?token=${userToken}&app=${encodeURIComponent(appFilter)}`
      : `${API}/api/templates?token=${userToken}`;
    const res  = await fetch(url);
    const data = await res.json();
    return data.templates || [];
  } catch(e) {
    console.warn(`🌐 templates-list Fehler: ${e.message}`);
    return [];
  }
});

ipcMain.handle('template-publish', async (_, { routeId, appName, description }) => {
  try {
    const res = await fetch(`${API}/api/templates`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: userToken, route_id: routeId, app_name: appName || null, description: description || null }),
    });
    return await res.json();
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('run-template', async (_, templateId) => {
  if (!userToken) return { success: false, error: 'Nicht angemeldet' };
  try {
    // Write a synthetic task into the queue so the full pipeline runs
    const res = await fetch(`${API}/api/agent/task`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        token:   userToken,
        command: `RUN_ROUTE:${templateId}`,
        source:  'template',
        priority: 5,
      }),
    });
    return await res.json();
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ── Planner IPC ─────────────────────────────────────────────────────────
ipcMain.handle('goal-submit', async (event, { goal, context, deadline }) => {
  try {
    const goalId = await miraPlanner.submitGoal(goal, context || {}, deadline || null);
    return { success: true, goal_id: goalId };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('goal-recall', async (event, { query, limit }) => {
  const entries = await miraPlanner.recall(query, limit || 8);
  return { success: true, entries };
});

// ═══════════════════════════════════════
// BRUTCAMP — Math Pattern Training IPC
// ═══════════════════════════════════════

const brutcamp = require('./mathematik/brutcamp');

// Interaktive Session starten — AX scannt Screen, Math prüft bekannte Elemente
ipcMain.handle('brutcamp-start', async () => {
  try {
    return await brutcamp.startInteractiveSession(axLayer, mathChef);
  } catch(e) {
    console.error('BrutCamp Start:', e.message);
    return { error: e.message };
  }
});

// User-Antwort → nächste Frage + Pattern in Community hochladen
ipcMain.handle('brutcamp-answer', async (event, { sessionId, antwort, korrektur }) => {
  try {
    const result = await brutcamp.antwortGeben(sessionId, antwort, korrektur);

    // Nach jeder echten Lerneinheit: neu gespeicherte Patterns in Community teilen
    if (userToken && antwort && antwort.toLowerCase() !== 'überspringen') {
      uploadNewPatternsToCommunity(userToken).catch(() => {});
    }

    return result;
  } catch(e) {
    return { error: e.message };
  }
});

// Alle gespeicherten Patterns auflisten
ipcMain.handle('brutcamp-list', async () => {
  try {
    return { patterns: brutcamp.allePatterns() };
  } catch(e) {
    return { patterns: [], error: e.message };
  }
});

// Pattern löschen (falsch trainiert)
ipcMain.handle('brutcamp-delete', async (event, { key }) => {
  try {
    return { ok: brutcamp.löschePattern(key) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// Pattern manuell hinzufügen mit Screenshot-Region
ipcMain.handle('brutcamp-capture-region', async (event, { x, y, w, h, label, kategorie }) => {
  try {
    const { cropRegion } = require('./mathematik/screen-capture');
    const sc = await require('screenshot-desktop')({ format: 'png' });
    const regionPng = await cropRegion(sc, { x, y, w, h });
    await brutcamp.speicherePattern(label, kategorie || 'icon', regionPng, { kontext: 'Manuell aufgenommen' });
    mathChef.clearCache();
    return { ok: true, label };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// Wissen über ein Formularfeld speichern
ipcMain.handle('brutcamp-lern-feld', async (event, { feldLabel, typ, beschreibung, bereich }) => {
  try {
    wissenstree.lernFeld(feldLabel, { typ, beschreibung, bereich });
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// Math-Stats: wie viele Patterns, letzter Treffer etc.
ipcMain.handle('math-stats', async () => {
  try {
    const patterns = brutcamp.allePatterns();
    return {
      patternCount: patterns.length,
      patterns: patterns.map(p => ({
        label: p.label,
        kategorie: p.kategorie,
        trefferCount: p.trefferCount || 0,
        gelernt: p.gelernt
      }))
    };
  } catch(e) {
    return { patternCount: 0, patterns: [] };
  }
});

// ═══════════════════════════════════════
// Feature 2: PASSIVE TRAINING IPC
// ═══════════════════════════════════════

ipcMain.handle('start-passive-training', async () => {
  if (!userToken) return { success: false, error: 'Nicht aktiviert' };
  const started = passiveTrainer.start({
    api:   API,
    token: userToken,
    onDone: (result) => {
      console.log(`🎓 Training abgeschlossen: ${result.observations} Beobachtungen`);
      if (mainWindow) mainWindow.webContents.send('passive-training-done', result);
    },
    onProgress: (prog) => {
      if (mainWindow) mainWindow.webContents.send('passive-training-progress', prog);
    },
  });
  return { success: started, error: started ? null : 'Bereits aktiv' };
});

ipcMain.handle('stop-passive-training', async () => {
  const result = await passiveTrainer.stop('manual');
  return { success: true, result };
});

ipcMain.handle('get-training-progress', () => {
  return passiveTrainer.getProgress() || { active: false };
});

// ── Target Training IPC ──────────────────────────────────────────────────
ipcMain.handle('open-target-training', () => {
  createTargetTrainingWindow();
});

ipcMain.handle('target-training-shoot', async (event, { targetLogicalX, targetLogicalY }) => {
  try {
    const display  = electronScreen.getPrimaryDisplay();
    const logicalW = display.bounds.width;
    const logicalH = display.bounds.height;
    const physW    = await nutScreen.width();
    const physH    = await nutScreen.height();
    const physScaleX = physW / logicalW;
    const physScaleY = physH / logicalH;

    // Logical screen coords → physical nut.js coords
    const targetPhysX = Math.round(targetLogicalX * physScaleX);
    const targetPhysY = Math.round(targetLogicalY * physScaleY);

    // Apply current calibration offset
    const offsetX = calibration ? (calibration.offsetX || 0) : 0;
    const offsetY = calibration ? (calibration.offsetY || 0) : 0;
    const clickX  = targetPhysX + offsetX;
    const clickY  = targetPhysY + offsetY;

    await mouse.setPosition({ x: clickX, y: clickY });
    await sleep(150);
    await mouse.leftClick();

    // Measure where cursor actually landed
    const actual = await mouse.getPosition();

    // Error in logical pixels (how far off from the target center)
    const errorX = Math.round((actual.x - targetPhysX) / physScaleX);
    const errorY = Math.round((actual.y - targetPhysY) / physScaleY);

    // Convert actual position to window-relative logical coords for splatter rendering
    const bounds = targetTrainingWindow ? targetTrainingWindow.getBounds() : { x: 0, y: 0 };
    const clickWindowX = Math.round(actual.x / physScaleX) - bounds.x;
    const clickWindowY = Math.round(actual.y / physScaleY) - bounds.y;

    console.log(`🎯 Training: target=[${targetLogicalX},${targetLogicalY}] click=[${clickX},${clickY}] actual=[${actual.x},${actual.y}] error=[${errorX},${errorY}]`);
    return { clickWindowX, clickWindowY, errorX, errorY };
  } catch (e) {
    console.error('❌ target-training-shoot:', e.message);
    return { error: e.message };
  }
});

ipcMain.handle('target-training-save-calibration', async (event, { avgErrorX, avgErrorY }) => {
  try {
    const cal = calibration || {};

    // Systematischen Fehler korrigieren: landet MIRA immer +avgErrorX zu weit rechts,
    // wird der Offset um diesen Wert reduziert → nächster Klick trifft genauer.
    cal.offsetX = (cal.offsetX || 0) - avgErrorX;
    cal.offsetY = (cal.offsetY || 0) - avgErrorY;
    cal.lastTrainingAt = new Date().toISOString();

    saveCalibration(cal); // nutzt app.getPath('userData') im packaged App
    calibration = cal;
    console.log(`🎯 Training-Kalibrierung gespeichert: offsetX=${cal.offsetX} offsetY=${cal.offsetY}`);
    return { success: true, offsetX: cal.offsetX, offsetY: cal.offsetY };
  } catch (e) {
    console.error('❌ target-training-save-calibration:', e.message);
    return { success: false, error: e.message };
  }
});

// ── NATIVE TTS (kein User-Gesture nötig) ───────────────────────────────────
ipcMain.handle('tts-speak', (event, { text }) => {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const safe = (text || '').replace(/"/g, '').replace(/\n/g, ' ').substring(0, 300);
    if (process.platform === 'darwin') {
      // macOS: say -v Anna (Deutsche Stimme)
      const proc = spawn('say', ['-v', 'Anna', safe]);
      proc.on('close', () => resolve({ done: true }));
      proc.on('error', () => resolve({ done: false }));
    } else if (process.platform === 'win32') {
      // Windows: PowerShell SAPI
      const ps = `Add-Type -AssemblyName System.Speech; $v=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v.Speak("${safe.replace(/"/g, '')}");`;
      const proc = spawn('powershell', ['-Command', ps]);
      proc.on('close', () => resolve({ done: true }));
      proc.on('error', () => resolve({ done: false }));
    } else {
      resolve({ done: false });
    }
  });
});

// ═══════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// AUTO-UPDATER (electron-updater + GitHub Releases)
// ═══════════════════════════════════════

function setupAutoUpdater() {
  // Im Dev-Modus nicht updaten
  if (!app.isPackaged) return;

  autoUpdater.autoDownload    = true;   // Download sofort im Hintergrund
  autoUpdater.autoInstallOnAppQuit = false; // Wir fragen erst nach

  autoUpdater.on('checking-for-update', () => {
    console.log('🔄 Prüfe auf Updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`🔄 Update verfügbar: ${info.version}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'available',
        version: info.version,
        message: `🔄 Update ${info.version} verfügbar — wird geladen...`
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('✅ MIRA ist aktuell.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'downloading',
        percent: pct,
        message: `🔄 Update wird geladen... ${pct}%`
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`✅ Update ${info.version} heruntergeladen — bereit zum Installieren`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'ready',
        version: info.version,
        message: `✅ Update ${info.version} bereit — Neustart?`
      });
    }
  });

  autoUpdater.on('error', (err) => {
    // Nur loggen, nicht dem User zeigen (z.B. kein Netz, kein Release vorhanden)
    console.warn('⚠️ Auto-Update Fehler (nicht kritisch):', err.message);
  });

  // 3 Sekunden nach Start prüfen (nach Window-Load)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}

// IPC: Renderer sagt "jetzt neustarten"
ipcMain.on('update-install-now', () => {
  autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(async () => {
  createWindow();
  setupAutoUpdater();
  uIOhook.start();

  // ── "Hey MIRA" Keyboard-Trigger (zuverlässiger als Background-Speech) ──
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hey-mira-hotkey');
    }
  });

  calibration = loadCalibration();
  if (!calibration) {
    calibration = await runCalibration();
  }

  await buildDesktopMap();

  // ── InformationsAmt initialisieren ─────────────────────────────────
  // ask-Callback: Bestätigung oder Info-Eingabe via Electron-Dialog
  infoAmt.init(async (question, type) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (type === 'danger') {
      const { response } = await dialog.showMessageBox(win || { }, {
        type: 'warning',
        title: '⚠️ MIRA Bestätigung',
        message: question,
        buttons: ['Abbrechen', 'Ja, fortfahren'],
        defaultId: 0, cancelId: 0
      });
      return response === 1 ? true : null;
    }
    // Info-Frage: kleines Input-Overlay über IPC
    if (win) {
      win.webContents.send('mira-needs-info', { question });
      return new Promise(resolve => {
        const handler = (e, { answer }) => resolve(answer || null);
        ipcMain.once('mira-info-answer', handler);
        setTimeout(() => { ipcMain.removeListener('mira-info-answer', handler); resolve(null); }, 45000);
      });
    }
    return null;
  });
});

app.on('window-all-closed', () => {
  stopPolling();
  sysLogMonitor.stop();
  passiveTrainer.stop('app_close').catch(() => {});
  uIOhook.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  stopPolling();
  sysLogMonitor.stop();
  passiveTrainer.stop('app_close').catch(() => {});
  uIOhook.stop();
  globalShortcut.unregisterAll();
});