/**
 * MIRA Schaltzentrale — Consciousness-based Dispatch Orchestrator
 *
 * Inspiriert von Luigi Usai's Symbol Grounding Problem / ConsciousnessMonitor (funzioni1.py)
 * Übersetzt: Global Workspace Theory + Integrated Information Theory
 * → Trigger-basiertes Routing mit 5 Bewusstseinsebenen
 *
 * UNCONSCIOUS    (0) — Hotkeys / URL-Direktbefehle   <1ms   kein API
 * PRECONSCIOUS   (1) — MathCommander + AX-Semantic    ~20ms  kein API
 * CONSCIOUS      (2) — Server dispatch-full            ~300ms API
 * SELF_AWARE     (3) — Server + MIRA-Innenwelt         ~400ms API + circuit
 * META_CONSCIOUS (4) — Vollkette + Reflexion            ~600ms API + circuit + recovery
 */

'use strict';

const fetch        = require('node-fetch');
const mathCommander = require('./commander');
const bibLoader    = require('./bib-loader');

// ── Bewusstseinsebenen ─────────────────────────────────────────────────────
const LEVEL = {
  UNCONSCIOUS:    0,
  PRECONSCIOUS:   1,
  CONSCIOUS:      2,
  SELF_AWARE:     3,
  META_CONSCIOUS: 4,
};

// ── Trigger-Gewichte (analog funzioni1.py ConsciousnessMonitor) ────────────
const TRIGGER_WEIGHTS = {
  known_hotkey:          -0.35,  // Einfacher Hotkey → tiefer ansetzen
  known_platform:        -0.2,   // Bekannte Platform (YouTube etc.)
  known_intent:          -0.1,   // Commander kennt es
  active_behavior:        0.1,
  goal_directed:          0.1,
  self_questioning:       0.2,
  unknown_situation:      0.25,
  novelty:                0.2,
  critical_decision:      0.3,
  self_referential:       0.2,   // MIRA denkt gerade darüber nach
  repeated_failure:       0.35,  // Letzter Versuch gescheitert
  server_command:         0.15,  // Server-reformulierter Befehl
};

// ── Complexity → Level ────────────────────────────────────────────────────
function complexityToLevel(score) {
  if (score < 0.15) return LEVEL.UNCONSCIOUS;
  if (score < 0.35) return LEVEL.PRECONSCIOUS;
  if (score < 0.55) return LEVEL.CONSCIOUS;
  if (score < 0.75) return LEVEL.SELF_AWARE;
  return LEVEL.META_CONSCIOUS;
}

// ── Trigger-Analyse (innerer Monolog) ─────────────────────────────────────
function analyzeTriggers(command, ctx) {
  const cmd     = command.toLowerCase().trim();
  const triggers = [];

  // Bekannte Hotkey-Patterns?
  if (/\b(kopier|copy|einfüg|paste|ausschneid|cut|rückgängig|undo|wiederhol|redo|speichern?|save|drucken?|print|screenshot|scroll|play|pause|mute|stumm|lauter|leiser|neuer?\s*tab|tab\s*schließ|zoom|maximier|minimier|app\s*wechsel)\b/i.test(cmd)) {
    triggers.push('known_hotkey');
  }

  // Bekannte Plattform?
  if (/\b(youtube|spotify|netflix|gmail|google|whatsapp|instagram|linkedin|twitter|facebook|github|notion|chatgpt|deepl)\b/i.test(cmd)) {
    triggers.push('known_platform');
  }

  // Web-Such-Pattern?
  if (/\b(?:google|such|find|zeig|schau)\s+.{3,}/i.test(cmd)) {
    triggers.push('known_intent');
  }

  // Server-reformulierter Befehl?
  if (/^aufgabe bezogen|^\{"|^RUN_ROUTE:|^\[NUTZER_INFO/i.test(command.trim()) ||
      command.includes('(unknown:') || command.includes('[NUTZER_INFO')) {
    triggers.push('server_command');
    triggers.push('goal_directed');
  }

  // Unbekannte Situation (kein klares Pattern)?
  const hasNoPattern = !triggers.some(t => ['known_hotkey','known_platform','known_intent'].includes(t));
  if (hasNoPattern) {
    triggers.push('unknown_situation');
    triggers.push('novelty');
  }

  // MIRA denkt gerade darüber nach?
  if (ctx.circuit?.state?.lastThought?.content) {
    const thought = ctx.circuit.state.lastThought.content.toLowerCase();
    if (thought.split(' ').some(w => cmd.includes(w) && w.length > 4)) {
      triggers.push('self_referential');
    }
  }

  // Letzter Versuch gescheitert?
  if (ctx.lastAttemptFailed) {
    triggers.push('repeated_failure');
    triggers.push('critical_decision');
  }

  // Selbst-referenzielle Frage?
  if (/\b(was bist du|wer bist du|kannst du|bist du|ich|mir|mich|mein|uns)\b/i.test(cmd)) {
    triggers.push('self_questioning');
    triggers.push('self_referential');
  }

  return triggers;
}

// ── Complexity Score berechnen ────────────────────────────────────────────
function calcComplexity(triggers) {
  let score = 0.3; // Basiswert: PRECONSCIOUS
  for (const t of triggers) {
    score += TRIGGER_WEIGHTS[t] || 0;
  }

  // Kombinationsbonus (wie funzioni1.py)
  if (triggers.includes('critical_decision') && triggers.includes('unknown_situation')) {
    score += 0.2;
  }
  if (triggers.includes('repeated_failure') && triggers.includes('novelty')) {
    score += 0.15;
  }

  return Math.min(1.0, Math.max(0.0, score));
}

// ─────────────────────────────────────────────────────────────────────────
// TIER 0a — UNCONSCIOUS: Lokaler Hotkey/URL Pre-Dispatcher (<1ms)
// ─────────────────────────────────────────────────────────────────────────
function localDispatch(command) {
  const IS_MAC = process.platform === 'darwin';
  const cmd = command.toLowerCase().trim();

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
      return [{ action: 'key', value: IS_MAC ? macKey : winKey, command: cmd }];
    }
  }

  // Scroll
  if (/\b(scroll\s*(runter|down|nach\s*unten)|nach\s*unten\s*scroll)\b/i.test(cmd))
    return [{ action: 'scroll', direction: 'down', amount: 5, command: cmd }];
  if (/\b(scroll\s*(hoch|up|nach\s*oben)|nach\s*oben\s*scroll)\b/i.test(cmd))
    return [{ action: 'scroll', direction: 'up', amount: 5, command: cmd }];

  // Play/Pause — nur ohne Plattform-Keyword
  if (/\b(play|pause|abspielen?|anhalten?)\b/i.test(cmd) &&
      !/youtube|spotify|netflix|musik.*abspiel|video.*abspiel/i.test(cmd))
    return [{ action: 'key', value: 'space', command: cmd }];

  // Web-Suche
  const webSearch = cmd.match(
    /\b(?:google(?:\s+mal)?|such(?:e)?(?:\s+nach)?|find(?:e)?(?:\s+mal)?|zeig(?:\s+mir)?(?:\s+mal)?|schau(?:\s+mal)?(?:\s+nach)?)\s+(.+)/i
  );
  if (webSearch) {
    const q = webSearch[1].trim();
    return [{ action: 'open_url', value: `https://www.google.com/search?q=${encodeURIComponent(q)}`, command: cmd }];
  }

  // Direkte URL
  const urlOpen = cmd.match(
    /\b(?:öffne?|geh\s+(?:auf|zu)|starte?|browser(?:\s+auf)?|navigier(?:e)?(?:\s+zu)?|zeig(?:\s+mir)?)\s+(https?:\/\/\S+|[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?)/i
  );
  if (urlOpen) {
    let url = urlOpen[1].trim();
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    return [{ action: 'open_url', value: url, command: cmd }];
  }

  // Bekannte Plattformen
  const platforms = {
    youtube: 'https://www.youtube.com', spotify: 'https://open.spotify.com',
    netflix: 'https://www.netflix.com', gmail: 'https://mail.google.com',
    'google mail': 'https://mail.google.com', 'google maps': 'https://maps.google.com',
    maps: 'https://maps.google.com', whatsapp: 'https://web.whatsapp.com',
    instagram: 'https://www.instagram.com', linkedin: 'https://www.linkedin.com',
    twitter: 'https://www.twitter.com', facebook: 'https://www.facebook.com',
    github: 'https://github.com', notion: 'https://www.notion.so',
    chatgpt: 'https://chatgpt.com', deepl: 'https://www.deepl.com',
    google: 'https://www.google.com',
  };
  for (const [name, url] of Object.entries(platforms)) {
    if (cmd.includes(name)) {
      const after = cmd.replace(new RegExp(`.*?${name}\\s*`), '').trim();
      if (after && !['öffnen','öffne','starte','starten','aufmachen','auf','mal'].includes(after)) {
        if (name === 'youtube')
          return [{ action: 'open_url', value: `https://www.youtube.com/results?search_query=${encodeURIComponent(after)}`, command: cmd }];
        return [{ action: 'open_url', value: `${url}/search?q=${encodeURIComponent(after)}`, command: cmd }];
      }
      return [{ action: 'open_url', value: url, command: cmd }];
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// TIER 1 / 2 — CONSCIOUS / SELF_AWARE: Server dispatch-full
// ─────────────────────────────────────────────────────────────────────────
async function serverDispatch(task, ctx) {
  const { userToken, API, executeRouteStep, sleep, sessionCtx, circuit, nutScreen, extractedValues } = ctx;
  try {
    const realW = await nutScreen.width();
    const realH = await nutScreen.height();
    const consciousnessContext = circuit?.state?.lastThought?.content || null;

    // Wissensbibliothek: relevante Abschnitte lokal suchen (kein API)
    const bib = bibLoader.findRelevant(task.command);
    if (bib.found) {
      console.log(`📚 BibLoader: "${bib.sections[0]}" → als Kontext mitgeschickt`);
    }

    const res = await fetch(`${API}/api/brain/dispatch-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:                 userToken,
        command:               task.command,
        screen_size:           { width: realW, height: realH },
        session_context:       sessionCtx?.toPromptString() || '',
        last_perception:       sessionCtx?.last_perception || null,
        consciousness_context: consciousnessContext,
        knowledge_context:     bib.found ? bib.context : null,
      })
    });

    const data = await res.json();

    if (!data.success) {
      const errMsg = data.error || 'kein Intent erkannt';
      const missing = data.missing?.join(', ') || '—';
      console.log(`⚠️ dispatch-full: ${errMsg} | fehlend: ${missing}`);

      // Token-Fehler dem User mitteilen
      if (data.error?.includes('token') || data.error?.includes('Token') || res.status === 401 || res.status === 403) {
        ctx.notifyUser?.('error', '⚠️ Kein aktives Abo — bitte Token prüfen.');
      }
      return false;
    }

    console.log(`🎯 dispatch-full: "${data.intent}" → ${data.steps.length} Steps (${data.stats?.direct ?? '?'} direkt ⚡, ${data.stats?.needs_screenshot ?? '?'} mit Screenshot 📸)`);

    if (extractedValues) extractedValues.clear();

    for (let i = 0; i < data.steps.length; i++) {
      const step = { ...data.steps[i] };
      const icon = step.needs_screenshot ? '📸' : '⚡';
      console.log(`▶️ Step ${i+1}/${data.steps.length} ${icon}: ${step.action} "${step.command || step.value || ''}"`);
      await executeRouteStep(step);
      await sleep(500);
    }

    return true;
  } catch (e) {
    console.error('❌ serverDispatch Fehler:', e.message);
    if (e.message?.includes('fetch') || e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
      ctx.notifyUser?.('error', '📡 Server nicht erreichbar — bitte Verbindung prüfen.');
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HAUPTFUNKTION — dispatch(task, ctx)
// ─────────────────────────────────────────────────────────────────────────
/**
 * @param {object} task       — { id, command, ... }
 * @param {object} ctx        — Laufzeit-Kontext aus main.js:
 *   executeRouteStep, executeAction, sleep,
 *   userToken, API, mathChef, axLayer,
 *   sessionCtx, circuit, nutScreen, extractedValues,
 *   notifyUser(type, text),   ← schickt IPC → MIRA-Chat
 *   lastAttemptFailed         ← true wenn vorheriger Versuch scheiterte
 *
 * @returns {'success'|'needs_fallback'|'failed'}
 */
async function dispatch(task, ctx) {
  const { executeRouteStep, sleep, mathChef, axLayer } = ctx;
  const command = task.command || '';

  // ── Inner Monologue: Trigger-Analyse ──────────────────────────────────
  const triggers       = analyzeTriggers(command, ctx);
  const complexity     = calcComplexity(triggers);
  const level          = complexityToLevel(complexity);
  const levelName      = Object.keys(LEVEL).find(k => LEVEL[k] === level);

  console.log(`🧠 Schaltzentrale: score=${complexity.toFixed(2)} → ${levelName} | triggers=[${triggers.join(', ')}]`);

  // ── LEVEL 0: UNCONSCIOUS — Hotkey/URL (<1ms, kein API) ────────────────
  if (level <= LEVEL.UNCONSCIOUS) {
    const localSteps = localDispatch(command);
    if (localSteps) {
      console.log(`⚡ UNCONSCIOUS: "${command}" → ${localSteps.length} lokale Steps`);
      for (const step of localSteps) {
        await executeRouteStep(step);
        await sleep(150);
      }
      return 'success';
    }
    // Kein lokaler Match trotz niedrigem Score → eine Ebene höher
  }

  // ── LEVEL 1: PRECONSCIOUS — MathCommander + AX (kein API) ────────────
  if (level <= LEVEL.PRECONSCIOUS) {
    // Guard: Server-reformulierte Commands überspringen
    const _isServerCmd = /^aufgabe bezogen|^\{"|^RUN_ROUTE:|^\[NUTZER_INFO/i.test(command.trim())
      || command.includes('(unknown:') || command.includes('[NUTZER_INFO');

    if (!_isServerCmd) {
      const cmdResult = await mathCommander.dispatch(command, { chef: mathChef, axLayer }).catch(() => null);
      if (cmdResult) {
        if (cmdResult.__server_task === 'form_fill_from_file') {
          console.log(`📄 PRECONSCIOUS→SERVER: form_fill_from_file → ${cmdResult.source_file}`);
          const ffTask = {
            ...task,
            command: JSON.stringify({
              type: 'screen_fill_from_file',
              source_file: cmdResult.source_file,
              source_dir:  cmdResult.source_dir
            })
          };
          const ok = await serverDispatch(ffTask, ctx);
          if (ok) return 'success';
        } else {
          console.log(`🧠 PRECONSCIOUS: "${cmdResult.intent}" → ${cmdResult.steps.length} Steps`);
          for (const step of cmdResult.steps) {
            if (step.action === 'wait') {
              await sleep(step.value || 500);
            } else {
              await executeRouteStep(step);
              await sleep(200);
            }
          }
          return 'success';
        }
      }
    }

    // Commander kein Match → direkt zu CONSCIOUS hochstufen
    if (level < LEVEL.CONSCIOUS) {
      console.log(`🔼 PRECONSCIOUS→CONSCIOUS: kein Commander-Match, stufe hoch`);
    }
  }

  // ── LEVEL 2+: CONSCIOUS / SELF_AWARE / META — Server-Dispatcher ───────
  console.log(`🌐 ${levelName}: Server-Dispatcher (circuit=${!!ctx.circuit?.state?.lastThought})`);
  const dispatched = await serverDispatch(task, ctx);
  if (dispatched) return 'success';

  // ── Fallback-Signal ────────────────────────────────────────────────────
  console.log(`⚡ Schaltzentrale: kein Match → needs_fallback`);
  return 'needs_fallback';
}

module.exports = { dispatch, localDispatch, LEVEL };
