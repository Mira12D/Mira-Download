// mathematik/commander.js
// Lokale Schaltzentrale — kein Server, kein API, kein GPT
//
// FLOW:
//   Befehl → erkennIntent (Regex, <1ms)
//         → bauSteps (Pattern-Suche + AX-Layer + URL-Fallback)
//         → Steps oder null (→ Server-AI)
//
// Versteht: Web, Apps, Office, Mail, Kalender, Teams, Screenshot,
//           Plattformen, Datei-Transfer, Formular, Systemaktionen

'use strict';

const IS_MAC = process.platform === 'darwin';

// ═══════════════════════════════════════
// INTENT-ERKENNUNG (Regex, <1ms, kein I/O)
// ═══════════════════════════════════════

function erkennIntent(command) {
  const cmd = command.toLowerCase().trim();

  // ── Web: Google-Suche ──────────────────────────────────────────────────
  const wsM = cmd.match(
    /\b(?:google(?:\s+mal)?|such(?:e)?(?:\s+(?:mal|nach))?|finde?(?:\s+mal)?|zeig(?:\s+mir)?(?:\s+mal)?|schlag\s+nach|suche?\s+im\s+(?:web|internet)|was\s+ist|was\s+kostet?|wie\s+geht|wie\s+wird|wann\s+ist|wer\s+ist|erkl[äa]r(?:e)?(?:\s+mir)?)\s+(.+)/i
  );
  if (wsM) return { intent: 'web_search', query: wsM[1].replace(/[.?!]+$/, '').trim() };

  // ── Web: URL direkt ────────────────────────────────────────────────────
  const urlM = cmd.match(
    /\b(?:öffne?|geh\s+(?:auf|zu)|navigier\w*(?:\s+zu)?|zeig(?:\s+mir)?|ruf\s+(?:mal\s+)?auf)\s+(https?:\/\/\S+|[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\.[a-z]{2,}(?:\/\S*)?)/i
  );
  if (urlM) {
    let url = urlM[1].trim();
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    return { intent: 'web_open', url };
  }

  // ── Plattformen (exact-first, dann generisch) ──────────────────────────
  if (/\byoutube\b/i.test(cmd)) {
    const q = cmd.replace(/.*youtube\s*/i, '').replace(/\b(öffnen?|starten?|aufmachen?|mal)\b/gi, '').trim();
    return q
      ? { intent: 'youtube_search', query: q }
      : { intent: 'web_open', url: 'https://www.youtube.com' };
  }
  if (/\bspotify\b/i.test(cmd))   return { intent: 'app_open', query: 'Spotify',           url: 'https://open.spotify.com' };
  if (/\bnetflix\b/i.test(cmd))   return { intent: 'web_open', url: 'https://www.netflix.com' };
  if (/\bwhatsapp\b/i.test(cmd))  return { intent: 'app_open', query: 'WhatsApp',           url: 'https://web.whatsapp.com' };
  if (/\binstagram\b/i.test(cmd)) return { intent: 'web_open', url: 'https://www.instagram.com' };
  if (/\blinkedin\b/i.test(cmd))  return { intent: 'web_open', url: 'https://www.linkedin.com' };
  if (/\b(twitter|x\.com)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://www.twitter.com' };
  if (/\b(chatgpt)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://chatgpt.com' };
  if (/\bgithub\b/i.test(cmd))    return { intent: 'web_open', url: 'https://github.com' };
  if (/\bnotion\b/i.test(cmd))    return { intent: 'web_open', url: 'https://www.notion.so' };
  if (/\b(deepl)\b/i.test(cmd))   return { intent: 'web_open', url: 'https://www.deepl.com' };
  if (/\b(google\s*maps|maps)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://maps.google.com' };
  if (/\b(gmail|google\s*mail)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://mail.google.com' };
  if (/\b(google\s*drive|gdrive)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://drive.google.com' };
  if (/\b(google\s*docs)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://docs.google.com' };
  if (/\b(google\s*sheets)\b/i.test(cmd)) return { intent: 'web_open', url: 'https://sheets.google.com' };

  // ── Excel ──────────────────────────────────────────────────────────────
  if (/\b(excel|xlsx|spreadsheet)\b/i.test(cmd)) {
    if (/\b(schreib|trag\s+ein|eingeb|füll|eintrag|hinzufüg|erfass)\b/i.test(cmd))
      return { intent: 'excel_write', raw: command };
    return { intent: 'excel_open', raw: command };
  }
  // "Tabelle öffnen / machen / fertig" — nur wenn kein Word-Kontext
  if (/\btabelle\b/i.test(cmd) && !/\bword\b/i.test(cmd)) {
    if (/\b(schreib|trag|eingeb|füll)\b/i.test(cmd)) return { intent: 'excel_write', raw: command };
    return { intent: 'excel_open', raw: command };
  }

  // ── Word / Dokument ────────────────────────────────────────────────────
  if (/\b(word|docx|word\s*datei)\b/i.test(cmd)) {
    if (/\b(schreib|tipp|verfass|füll|erstell|trag)\b/i.test(cmd))
      return { intent: 'word_write', raw: command };
    return { intent: 'word_open', raw: command };
  }
  if (/\b(brief|anschreiben|bewerbung)\b/i.test(cmd) &&
      /\b(schreib|erstell|verfass|mach)\b/i.test(cmd))
    return { intent: 'word_write', raw: command };

  // ── Mail / Outlook ─────────────────────────────────────────────────────
  if (/\b(mail|email|e-mail|outlook)\b/i.test(cmd)) {
    if (/\b(schreib|send|verfass|erstell|antwort)\b/i.test(cmd))
      return { intent: 'mail_write', raw: command };
    if (/\b(les|lier|öffne?|check|schau|zeig|ruf\s+ab)\b/i.test(cmd))
      return { intent: 'mail_read' };
    return { intent: 'mail_open' };
  }
  if (/\b(posteingang)\b/i.test(cmd)) return { intent: 'mail_read' };

  // ── Kalender / Termin ──────────────────────────────────────────────────
  if (/\b(kalender|calendar|appointment)\b/i.test(cmd)) {
    if (/\b(hinzufüg|trag\s+ein|erstell|neue[rn]?|mach|eintrag)\b/i.test(cmd))
      return { intent: 'calendar_add', raw: command };
    return { intent: 'calendar_open' };
  }
  if (/\b(termin|meeting)\b/i.test(cmd) && /\b(erstell|trag|hinzufüg|eintrag|neu)\b/i.test(cmd))
    return { intent: 'calendar_add', raw: command };

  // ── Teams ──────────────────────────────────────────────────────────────
  if (/\b(teams|microsoft\s*teams)\b/i.test(cmd)) {
    if (/\b(schreib|send|nachricht|message|chat)\b/i.test(cmd))
      return { intent: 'teams_message', raw: command };
    return { intent: 'app_open', query: 'Microsoft Teams', url: 'https://teams.microsoft.com' };
  }

  // ── Zoom ───────────────────────────────────────────────────────────────
  if (/\bzoom\b/i.test(cmd) && !/\bzoom\s*(in|out|rein|raus|rück|reset|normal)\b/i.test(cmd))
    return { intent: 'app_open', query: 'Zoom', url: 'https://zoom.us' };

  // ── Chrome / Browser öffnen ────────────────────────────────────────────
  if (/\b(chrome|firefox|safari|opera|browser)\b/i.test(cmd) &&
      /\b(öffne?|starte?|mach\s+auf)\b/i.test(cmd)) {
    const appName = cmd.match(/\b(chrome|firefox|safari|opera)\b/i)?.[1] || 'Chrome';
    return { intent: 'app_open', query: appName };
  }

  // ── Finder / Explorer ──────────────────────────────────────────────────
  if (/\b(finder|explorer|dateimanager|dateien?\s+öffne?)\b/i.test(cmd))
    return { intent: 'app_open', query: IS_MAC ? 'Finder' : 'Explorer' };

  // ── Screenshot ─────────────────────────────────────────────────────────
  if (/\b(screenshot|bildschirmfoto|screen\s*shot|capture)\b/i.test(cmd))
    return { intent: 'screenshot' };

  // ── Bildschirm lesen ───────────────────────────────────────────────────
  if (/\b(was\s+steht|les\s+(?:mal\s+)?(?:vor|den?\s+bildschirm)|zeig\s+(?:mir\s+)?was\s+(?:da|hier|dort)\s+steht|lies\s+(?:den?\s+)?(?:bildschirm|screen))\b/i.test(cmd))
    return { intent: 'screen_read' };

  // ── Datei-Transfer: "nimm X und trag in Y" ────────────────────────────
  const transferM = cmd.match(
    /\b(?:nimm|nehme?|aus)\s+(.+?)\s+(?:und\s+)?(?:trag|füge?|schreib|eintrag)\s*(?:es\s+)?(?:in|nach|ins?)\s+(.+)/i
  );
  if (transferM)
    return { intent: 'file_transfer', source: transferM[1].trim(), target: transferM[2].trim(), raw: command };

  // ── Formular ausfüllen ─────────────────────────────────────────────────
  if (/\b(füll|ausfüll)\b.*\b(formular|form|felder?|maske)\b/i.test(cmd))
    return { intent: 'form_fill', raw: command };

  // ── App öffnen generisch — ZULETZT, um spezifischere Regeln nicht zu überschreiben ──
  const appM = cmd.match(
    /\b(?:öffne?|starte?|mach\s+(?:mal\s+)?auf|ruf\s+(?:mal\s+)?auf)\s+([a-zäöü][a-zäöü0-9\s]{1,30}?)(?:\s+(?:auf|mal|bitte|jetzt|schnell))?\s*$/i
  );
  if (appM) {
    const name = appM[1].trim();
    const stopWords = ['das', 'die', 'den', 'eine?', 'mal', 'bitte', 'mir', 'kurz', 'schnell'];
    if (!stopWords.some(w => new RegExp(`^${w}$`, 'i').test(name)) && name.length > 1) {
      return { intent: 'app_open', query: name };
    }
  }

  return null; // → Server-AI
}

// ═══════════════════════════════════════
// STEPS BAUEN (async — Pattern + AX + Fallback)
// ═══════════════════════════════════════

async function bauSteps(intent, { chef, axLayer }) {
  // ── Helpers ──────────────────────────────────────────────────────────
  const url   = (value)  => ({ action: 'open_url', value, command: value });
  const key   = (value)  => ({ action: 'key',      value, command: value });
  const typ   = (value)  => ({ action: 'type',     value, command: value });
  const wait  = (ms)     => ({ action: 'wait',     value: ms, command: `warten ${ms}ms` });
  const click = (coord)  => ({ action: 'click',    coordinate: coord, command: 'klicken' });

  // Pattern-Suche + AX-Fallback
  async function findeElement(namen) {
    for (const name of namen) {
      if (chef) {
        try {
          const r = await chef.find(name, { multiScale: true });
          if (r?.found) return [r.centerX, r.centerY];
        } catch {}
      }
      if (axLayer) {
        try {
          const el = await axLayer.findElement(name);
          if (el?.centerX) return [el.centerX, el.centerY];
        } catch {}
      }
    }
    return null;
  }

  // App über Spotlight (Mac) oder Start-Menu (Win) öffnen — immer zuverlässig
  function spotlight(appName) {
    if (IS_MAC) return [key('cmd+space'), wait(400), typ(appName), wait(600), key('enter'), wait(2000)];
    return           [key('super'),       wait(400), typ(appName), wait(600), key('enter'), wait(2000)];
  }

  const s = [];

  switch (intent.intent) {

    // ── Web ──────────────────────────────────────────────────────────────
    case 'web_search':
      s.push(url(`https://www.google.com/search?q=${encodeURIComponent(intent.query)}`));
      break;

    case 'youtube_search':
      s.push(url(`https://www.youtube.com/results?search_query=${encodeURIComponent(intent.query)}`));
      break;

    case 'web_open':
      s.push(url(intent.url));
      break;

    // ── App öffnen ────────────────────────────────────────────────────────
    case 'app_open': {
      const namen = [intent.query, intent.query.toLowerCase().replace(/\s+/g, '-')];
      const pos = await findeElement(namen);
      if (pos) {
        s.push(click(pos), wait(1500));
      } else if (intent.url) {
        s.push(url(intent.url));            // Web-App Fallback
      } else {
        s.push(...spotlight(intent.query)); // Spotlight / Start-Menu
      }
      break;
    }

    // ── Excel ─────────────────────────────────────────────────────────────
    case 'excel_open': {
      const pos = await findeElement(['excel', 'microsoft excel', 'xlsx']);
      if (pos) {
        s.push(click(pos), wait(2000));
      } else {
        s.push(...spotlight(IS_MAC ? 'Microsoft Excel' : 'Excel'));
      }
      break;
    }

    case 'excel_write':
      return null; // → Server-AI (braucht Zellenbestimmung + Inhaltsanalyse)

    // ── Word ──────────────────────────────────────────────────────────────
    case 'word_open': {
      const pos = await findeElement(['word', 'microsoft word', 'docx']);
      if (pos) {
        s.push(click(pos), wait(2000));
      } else {
        s.push(...spotlight(IS_MAC ? 'Microsoft Word' : 'Word'));
      }
      break;
    }

    case 'word_write':
      return null; // → Server-AI

    // ── Mail ──────────────────────────────────────────────────────────────
    case 'mail_open': {
      const pos = await findeElement(['mail', 'outlook', 'gmail', 'e-mail']);
      if (pos) {
        s.push(click(pos), wait(2000));
      } else if (IS_MAC) {
        s.push(...spotlight('Mail'));
      } else {
        s.push(url('https://mail.google.com'));
      }
      break;
    }

    case 'mail_read':
    case 'mail_write':
      // Mail öffnen lokal, Inhaltsverarbeitung → Server
      return null;

    // ── Kalender ──────────────────────────────────────────────────────────
    case 'calendar_open': {
      const pos = await findeElement(['kalender', 'calendar', 'calendars']);
      if (pos) {
        s.push(click(pos), wait(2000));
      } else if (IS_MAC) {
        s.push(...spotlight('Kalender'));
      } else {
        s.push(url('https://calendar.google.com'));
      }
      break;
    }

    case 'calendar_add':
      return null; // → Server-AI (braucht Datum/Zeit-Parsing)

    // ── Teams ──────────────────────────────────────────────────────────────
    case 'teams_message':
      return null; // → Server-AI (braucht Empfänger + Inhalt)

    // ── Screenshot ────────────────────────────────────────────────────────
    case 'screenshot':
      s.push(key(IS_MAC ? 'cmd+shift+4' : 'super+shift+s'));
      break;

    // ── Bildschirm lesen / komplexe Transfers ─────────────────────────────
    case 'screen_read':
    case 'file_transfer':
    case 'form_fill':
      return null; // → Server-AI (braucht Vision)

    default:
      return null;
  }

  return s.length > 0 ? s : null;
}

// ═══════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════

/**
 * Versucht Befehl lokal zu dispatchen.
 * @returns {{ intent, steps }} oder null (→ Server-AI)
 */
async function dispatch(command, { chef, axLayer } = {}) {
  const intent = erkennIntent(command);
  if (!intent) return null;

  console.log(`🧠 Commander: "${command.substring(0, 60)}" → ${intent.intent}`);

  const steps = await bauSteps(intent, { chef: chef || null, axLayer: axLayer || null });
  if (!steps) {
    console.log(`🧠 Commander: "${intent.intent}" braucht Server-AI`);
    return null;
  }

  console.log(`⚡ Commander: ${steps.length} Steps lokal (kein API)`);
  return { intent: intent.intent, steps };
}

module.exports = { dispatch, erkennIntent };
