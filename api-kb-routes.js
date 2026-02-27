'use strict';

/**
 * api-kb-routes.js
 *
 * Express route handlers for the MIRA Wissensbase.
 * Mount in your Vercel Express app (server.js / index.js):
 *
 *   const kbRoutes = require('./api-kb-routes');
 *   app.use('/api/brain', kbRoutes);
 *
 * Endpoints:
 *   GET  /api/brain/knowledge-base?token=…&device_id=…
 *   POST /api/brain/knowledge-base   { token, device_id, kb }
 *
 * Requires environment variables already used by the MIRA backend:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const express      = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// ── Supabase client (service role — bypasses RLS) ─────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY nicht konfiguriert');
  return createClient(url, key);
}

// ── Token → device_id validation (re-uses existing mira_tokens table) ─────

async function validateToken(supabase, token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from('mira_tokens')
    .select('device_id, tier')
    .eq('token', token)
    .single();
  if (error || !data) return null;
  return data;
}

// ── GET /api/brain/knowledge-base ─────────────────────────────────────────

router.get('/knowledge-base', async (req, res) => {
  try {
    const { token, device_id } = req.query;
    const sb   = getSupabase();
    const auth = await validateToken(sb, token);
    if (!auth) return res.json({ success: false, error: 'Unauthorized' });

    // device_id from query must match token's device_id
    if (auth.device_id && device_id && auth.device_id !== device_id) {
      return res.json({ success: false, error: 'Device mismatch' });
    }

    const devId = auth.device_id || device_id;
    if (!devId) return res.json({ success: false, error: 'device_id fehlt' });

    const { data, error } = await sb
      .from('mira_knowledge_base')
      .select('context, triggers, contacts, limits, updated_at')
      .eq('device_id', devId)
      .single();

    if (error || !data) {
      // First time — return empty default
      return res.json({
        success: true,
        kb: { context: {}, triggers: [], contacts: [], limits: [] },
        updated_at: null,
      });
    }

    return res.json({ success: true, kb: data, updated_at: data.updated_at });
  } catch (e) {
    console.error('[KB GET]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/brain/knowledge-base ────────────────────────────────────────

router.post('/knowledge-base', async (req, res) => {
  try {
    const { token, device_id, kb } = req.body;
    if (!kb || typeof kb !== 'object') {
      return res.json({ success: false, error: 'kb fehlt oder ungültig' });
    }

    const sb   = getSupabase();
    const auth = await validateToken(sb, token);
    if (!auth) return res.json({ success: false, error: 'Unauthorized' });

    const devId = auth.device_id || device_id;
    if (!devId) return res.json({ success: false, error: 'device_id fehlt' });

    // Validate shape
    const safe = {
      context:  kb.context  && typeof kb.context  === 'object' ? kb.context  : {},
      triggers: Array.isArray(kb.triggers) ? kb.triggers : [],
      contacts: Array.isArray(kb.contacts) ? kb.contacts : [],
      limits:   Array.isArray(kb.limits)   ? kb.limits   : [],
    };

    const { error } = await sb
      .from('mira_knowledge_base')
      .upsert(
        { device_id: devId, ...safe },
        { onConflict: 'device_id' }
      );

    if (error) throw error;

    return res.json({ success: true });
  } catch (e) {
    console.error('[KB POST]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
