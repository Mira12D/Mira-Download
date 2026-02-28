const { app, BrowserWindow, ipcMain, screen: electronScreen } = require('electron');
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
const mailMonitor    = require('./mail-monitor');
const recoveryEngine = require('./recovery-engine');
const miraBrain      = require('./mira-brain');
const miraPlanner    = require('./mira-planner');
const sysLogMonitor  = require('./system-log-monitor');
const passiveTrainer = require('./passive-trainer');
const path           = require('path');

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

// Ganz oben nach den let-Variablen einfügen
const runningTasks = new Set();

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
    // ── CORS für Browser-Frontend ──
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url     = new URL(req.url, `http://127.0.0.1:${LOCAL_PORT}`);
    const pathname = url.pathname;

    // Body einlesen (POST/PATCH)
    let body = {};
    if (!['GET', 'DELETE'].includes(req.method)) {
      const raw = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
      try { body = JSON.parse(raw); } catch(_) {}
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
    if (pathname === '/api/artifacts' && req.method === 'GET') {
      const rows = await directSupabase('GET', `/artifacts?user_id=eq.${userId}&select=id,name,type,rows,pages,preview_data,created_at,updated_at&order=updated_at.desc&limit=50`);
      if (Array.isArray(rows)) return json({ success: true, artifacts: rows }); // Supabase gibt Array zurück
      // rows ist null (kein _dk) oder Fehler-Objekt (Tabelle fehlt etc.) → Vercel-Fallback
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
        if (rows?.[0]) return json({ success: true, artifact: rows[0] });
        try {
          const r = await fetch(`${API}/api/artifacts/${aId}`, { headers: { 'Authorization': `Bearer ${tok}` } });
          return json(await r.json());
        } catch(e) { return json({ success: false, error: 'Not found' }, 404); }
      }

      if (req.method === 'POST') {
        const row = await directSupabase('POST', `/artifacts`, {
          user_id: userId, ...body,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (row?.[0]) return json({ success: true, artifact: row[0] });
      }

      if (req.method === 'PATCH') {
        const row = await directSupabase('PATCH', `/artifacts?id=eq.${aId}&user_id=eq.${userId}`, {
          ...body, updated_at: new Date().toISOString()
        });
        if (row?.[0]) return json({ success: true, artifact: row[0] });
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
        await directSupabase('DELETE', `/artifacts?id=eq.${aId}&user_id=eq.${userId}`);
        return json({ success: true });
      }
    }

    // POST /api/artifacts (ohne :id) ─────────────────────────────────────
    if (pathname === '/api/artifacts' && req.method === 'POST') {
      const row = await directSupabase('POST', `/artifacts`, {
        user_id: userId, ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (row?.[0]) return json({ success: true, artifact: row[0] });
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
      const proxyRes = await fetch(`${API}${pathname}${url.search}`, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: ['GET', 'DELETE'].includes(req.method) ? undefined : JSON.stringify(body),
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
    // Feature 1: System-Log Monitor mit gespeichertem Token starten
    sysLogMonitor.start({ api: API, token: savedToken });
    loadUserProfileSettings().catch(() => {});
    startKeepAlive();
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
            { type: 'text', text: `Finde dieses Element: "${elementDescription}"\nAntworte NUR mit JSON:\n{"found": true, "x": 120, "y": 450, "confidence": 0.95, "description": "was du siehst"}\noder wenn nicht gefunden:\n{"found": false, "confidence": 0}\nKoordinaten für 1280x720.` }
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
  // GUARD — Task nur einmal ausführen
  if (runningTasks.has(task.id)) {
    console.log(`⏭️ Skip — läuft bereits: ${task.id}`);
    return;
  }
  runningTasks.add(task.id);

  console.log(`⚙️ Executing: ${task.command.substring(0, 80)}`);
  try {

    let parsed = null;
    try { parsed = JSON.parse(task.command); } catch(e) {}

    console.log(`🔍 Command: ${task.command.substring(0, 100)}`);
    console.log(`🔍 Parsed type: ${parsed?.type}`);

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
        try {
          // 8s Timeout — ftLog ist unkritisch, darf den Task nicht blockieren
          await fetchWithTimeout(`${API}/api/agent/file-task-log`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken, task_id: task.id, message, type, ...extra })
          }, 8000);
        } catch(e) { console.error('⚠️ ftLog failed:', e.message); }
      };

      const { search_patterns, source_dirs, target_filename, target_format = 'xlsx', action, instruction, append_if_exists, custom_headers } = parsed;

      // ── create_excel: direkt neue Datei erstellen, kein Suchen ───────
      const isDirectCreate = action === 'create_excel';

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

        const newSummary = {
          files_count: 0, rows_written: 0, is_new_file: true,
          output_path:     newFileResult?.outputPath || null,
          target_filename: newName,
          file_base64:     newFileResult?.fileBase64 || null,
          mime:            newFileResult?.mime       || null,
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

      // ── Bestehende Zieldatei: Spalten auslesen (für Append-Matching) ──
      let targetFileColHeaders = [];
      if (target_filename && (target_format === 'xlsx' || !target_format)) {
        const fs = require('fs');
        const os = require('os');
        const pathMod = require('path');
        const home = os.homedir();
        for (const dir of [pathMod.join(home,'Desktop'), pathMod.join(home,'Downloads'), pathMod.join(home,'Documents')]) {
          const candidate = pathMod.join(dir, target_filename);
          if (fs.existsSync(candidate)) {
            try {
              const ExcelJS = require('exceljs');
              const wbTmp = new ExcelJS.Workbook();
              await wbTmp.xlsx.readFile(candidate);
              const shTmp = wbTmp.getWorksheet(1);
              if (shTmp) {
                const hdrRowNum = findHeaderRow(shTmp);
                shTmp.getRow(hdrRowNum).eachCell({ includeEmpty: false }, (cell) => {
                  if (cell.value) targetFileColHeaders.push(cell.value.toString().trim());
                });
                console.log(`📊 Zieldatei Header in Zeile ${hdrRowNum}: [${targetFileColHeaders.join(', ')}]`);
              }
            } catch(_) {}
            break;
          }
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
            // Ein JSON-Objekt pro Datei
            batchData.results.forEach((result, i) => {
              const fname = fileContents[i]?.name || `Datei ${i + 1}`;
              if (result && typeof result === 'object') {
                allExtracted.push({ file: fname, data: result });
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

      // Profil sicherstellen
      if (!userProfileSettings.company_name) await loadUserProfileSettings().catch(() => {});
      const ftProfile = userProfileSettings;

      if (allExtracted.length === 0) {
        await ftLog('😐 Konnte keinen lesbaren Inhalt aus den Dateien extrahieren. Gescannte PDFs ohne OCR? Da kann ich nichts lesen.', 'error');
        await ftLog(null, 'done', { done: true, summary: { files_count: foundFiles.length, rows_written: 0, error: true, error_msg: 'Kein lesbarer Inhalt' } });
        await fetch(`${API}/api/agent/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userToken, task_id: task.id, status: 'error', result: { error: 'Kein lesbarer Inhalt' } }) });
        return;
      }

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
          outputResult = await ftWriteOutput({ ...parsed, target_format: outFmt, append_if_exists }, foundFiles, { text: summaryText }, ftProfile);
        } else if (action === 'write_brief') {
          // Brief / Word-Dokument DIN 5008
          const briefText = allExtracted.map(e => e.rawText || JSON.stringify(e.data, null, 2)).join('\n\n');
          outputResult = await ftWriteOutput({ ...parsed, target_format: 'docx', append_if_exists }, foundFiles, { text: briefText }, ftProfile);
        } else {
          // extract_to_excel (default) + append_section
          const firstData = allExtracted.find(e => e.data);
          const headers = firstData ? Object.keys(firstData.data) : ['Datei', 'Inhalt'];
          const rows = allExtracted.filter(e => e.data).map(e => {
            const row = {};
            headers.forEach(h => { row[h] = e.data[h] ?? ''; });
            return row;
          });
          outputResult = await ftWriteOutput({ ...parsed, append_if_exists }, foundFiles, { headers, rows }, ftProfile);
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

      const summary = {
        files_count: foundFiles.length,
        rows_written: outputResult?.newCount || 0,
        output_path: outputResult?.outputPath || null,
        target_filename: target_filename || null,
        file_base64: outputResult?.fileBase64 || null,
        mime: outputResult?.mime || null,
        error: !outputResult
      };
      await ftLog(null, 'done', { done: true, summary });
      // complete mit Timeout — Vercel darf hier nicht ewig hängen
      await fetchWithTimeout(`${API}/api/agent/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken, task_id: task.id, status: outputResult ? 'success' : 'error', result: summary })
      }, 10000).catch(e => console.warn('⚠️ complete timeout:', e.message));

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
        const step = { ...route.steps[i] };
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
          const step = { ...route.steps[i] };
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
        // ── 2a. Lokaler Pre-Dispatcher — kein API-Call nötig ──
        const localSteps = localDispatch(task.command);
        if (localSteps) {
          console.log(`⚡ Local dispatch: "${task.command}" (kein API)`);
          for (const step of localSteps) {
            await executeRouteStep(step);
            await sleep(150);
          }
          await markTaskComplete(task.id, 'success');
          return;
        }

        // ── 2b. Dispatcher — device_knowledge + GPT-mini nutzen ──
        console.log(`🧠 Kein Route-Match → Dispatcher versuchen`);
        const dispatched = await tryDispatch(task);

        if (dispatched) {
          console.log(`✅ Dispatcher erfolgreich`);
          await markTaskComplete(task.id, 'success');
        } else {
          // ── 3. Fallback — alter execute Weg ──
          console.log(`⚡ Dispatcher kein Match → execute Fallback`);
          const scaleX = realW / 1280;
          const scaleY = realH / 720;
          const response = await fetch(`${API}/api/agent/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken, task: task.command, screenshot: sc, screen_size: { width: 1280, height: 720 } })
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.message);
          for (let action of data.actions) {
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

  } catch(error) {
    console.error('❌ Task error:', error);
    await markTaskComplete(task.id, 'failed');
  } finally {
    runningTasks.delete(task.id);
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

 const { dialog } = require('electron');
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

// ─────────────────────────────────────────────────────────────────────
// localDispatch — clientseitiger Pre-Dispatcher ohne API-Call.
//
// Erkennt ~50 "pure Hotkey" Intents lokal per Regex (<1ms).
// Für diese Intents werden Steps direkt gebaut und ausgeführt —
// weder Netzwerk noch server-seitige KI nötig.
//
// Rückgabe: Array von Steps (sofort ausführbar) oder null.
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

  return null; // → weiter zu tryDispatch (API)
}

async function tryDispatch(task) {
  try {
    const realW = await nutScreen.width();
    const realH = await nutScreen.height();

    // dispatch-full: kein Screenshot nötig — Koordinaten kommen vorgelöst zurück
    const res = await fetch(`${API}/api/brain/dispatch-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: userToken,
        command: task.command,
        screen_size: { width: realW, height: realH }
      })
    });

    const data = await res.json();

    if (!data.success) {
      console.log(`⚠️ dispatch-full: ${data.error || 'kein Intent'} | fehlend: ${data.missing?.join(', ') || '—'}`);
      return false;
    }

    console.log(`🎯 dispatch-full: "${data.intent}" → ${data.steps.length} Steps (${data.stats?.direct ?? '?'} direkt ⚡, ${data.stats?.needs_screenshot ?? '?'} mit Screenshot 📸)`);

    extractedValues.clear(); // Frisch für jeden Task

    for (let i = 0; i < data.steps.length; i++) {
      const step = { ...data.steps[i] };
      const icon = step.needs_screenshot ? '📸' : '⚡';
      console.log(`▶️ Step ${i+1}/${data.steps.length} ${icon}: ${step.action} "${step.command || step.value || ''}"`);
      await executeRouteStep(step);
      await sleep(500); // Kürzer — wait-Steps kommen bereits vom Server
    }

    return true;

  } catch(e) {
    console.error('❌ tryDispatch Fehler:', e.message);
    return false;
  }
}

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

  function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP.has(entry)) continue;
      const full = path.join(dir, entry);
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      const nameLower = entry.toLowerCase();
      const matches = !patterns || patterns.length === 0
        || patterns.some(p => nameLower.includes(p.toLowerCase()));
      if (matches) found.push({ name: entry, path: full, ext: path.extname(entry).replace('.','').toLowerCase(), mtime: stat.mtime, size: stat.size });
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

  // Zieldatei suchen (Desktop → Downloads → Documents → direkt)
  let outputPath = null;
  for (const dir of [path.join(home,'Desktop'), path.join(home,'Downloads'), path.join(home,'Documents')]) {
    const c = path.join(dir, targetName);
    if (fs.existsSync(c)) { outputPath = c; break; }
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

      // Header-Zeile automatisch erkennen (nicht immer Zeile 1)
      hdrRowIdx = findHeaderRow(sheet);
      existingHeaders = [];
      sheet.getRow(hdrRowIdx).eachCell({ includeEmpty: false }, (cell) => {
        existingHeaders.push((cell.value || '').toString().trim());
      });
      // Alte Summenzeile am Ende entfernen
      const lastRow = sheet.getRow(sheet.rowCount);
      const lastCell = lastRow.getCell(1);
      if (lastCell.value && typeof lastCell.value === 'string' && lastCell.value === 'Gesamt') {
        sheet.spliceRows(sheet.rowCount, 1);
      }
      console.log(`📋 Anhänge-Modus: Header in Zeile ${hdrRowIdx}, Spalten=[${existingHeaders.join(', ')}] ab Zeile ${sheet.rowCount + 1}`);
    } else {
      sheet = wb.addWorksheet('MIRA');
    }

    // Daten starten eine Zeile nach der Header-Zeile
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

    case 'open_url':
      await require('electron').shell.openExternal(step.value || step.command);
      await sleep(5000);
      break;

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

      // ── TIER -2: dispatch-full Koordinate (vorgelöst, kein KI nötig) ──
      // Wenn der Server needs_screenshot:false gesetzt hat, ist die Koordinate
      // aus device_knowledge bereits authorativ — kein resolve-step nötig.
      if (step.needs_screenshot === false && step.coordinate) {
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

      // ── TIER -1: Koordinaten-Cache (persistent, kein Subprocess, <1ms) ──
      if (!finalX) {
        const cached = coordCache.get(ctx.app?.bundleId, elementLabel);
        if (cached) {
          // Fix 2: Fingerprint vorhanden → Element im aktuellen AX-Baum suchen
          // (fängt App-Verschiebung / Resize auf, da Koordinaten veraltet sein können)
          if (cached.fingerprint) {
            const fpResult = axLayer.findByFingerprint(cached.fingerprint, { bundleId: ctx.app?.bundleId });
            if (fpResult.found) {
              finalX = fpResult.centerX;
              finalY = fpResult.centerY;
              coordSource = 'fingerprint';
              console.log(`🔍 Fingerprint-Match: "${elementLabel}" → [${finalX}, ${finalY}] (AX-Position aktuell)`);
            } else {
              // Fingerprint nicht im aktuellen Baum → cached Koordinaten als Fallback
              finalX = cached.x;
              finalY = cached.y;
              coordSource = 'cache';
              console.log(`🗂️ Cache (Fingerprint miss): "${elementLabel}" → [${finalX}, ${finalY}] (hits: ${cached.hitCount})`);
            }
          } else {
            finalX = cached.x;
            finalY = cached.y;
            coordSource = 'cache';
            console.log(`🗂️ Cache: "${elementLabel}" → [${finalX}, ${finalY}] (hits: ${cached.hitCount}, via ${cached.tier})`);
          }
        }
      }

      // ── TIER 0a: Im gecachten State suchen (JS, <1ms, kein Subprocess) ──
      const stateResult = contextManager.findInState(ctx, elementLabel);
      if (stateResult && !finalX) {
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

      // Screenshot nur wenn 0a+0b scheitern
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

      await typeFormatted(cleanText);
      console.log(`   ⌨️ Getippt: "${cleanText.substring(0, 80).replace(/\n/g, '↵')}"`);
      contextManager.invalidate(); // Feld-Inhalt hat sich geändert

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
      const keyMap = {
        'enter':         Key.Enter,
        'tab':           Key.Tab,
        'escape':        Key.Escape,
        'space':         Key.Space,
        'backspace':     Key.Backspace,
        'ctrl+a':        [Key.LeftControl, Key.A],
        'ctrl+c':        [Key.LeftControl, Key.C],
        'ctrl+v':        [Key.LeftControl, Key.V],
        'ctrl+f':        [Key.LeftControl, Key.F],
        'ctrl+s':        [Key.LeftControl, Key.S],
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
      const k = keyMap[(step.value || step.command)?.toLowerCase()];
      if (Array.isArray(k)) {
        await keyboard.pressKey(...k);
        await keyboard.releaseKey(...k);
        console.log(`   ⌨️ Key: ${step.value || step.command}`);
      } else if (k) {
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
// VOICE COMMAND — empfängt Sprachbefehl vom Renderer, reiht ihn als Task ein
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('voice-command', async (event, { text }) => {
  if (!text || !text.trim()) return { queued: false, reason: 'empty' };
  if (!userToken)            return { queued: false, reason: 'not_connected' };

  const command = text.trim();
  console.log(`🎤 Voice Befehl: "${command}"`);

  try {
    // Kontext aufnehmen damit MIRA weiß in welcher App sie sich befindet
    const ctx = contextManager.captureState();
    const ctxString = contextManager.toPromptString(ctx);

    // Befehl + Kontext als Task an das Backend schicken
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

  // Beste Koordinate via resolve-step
  let x = step.coordinate?.[0] || 0;
  let y = step.coordinate?.[1] || 0;

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

  calibration = loadCalibration();
  if (!calibration) {
    calibration = await runCalibration();
  }

  await buildDesktopMap();
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
});