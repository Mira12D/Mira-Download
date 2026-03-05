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

  // ── E-Mail-Adresse im Befehl → immer mail_write (stärkstes Signal, zuerst) ──
  // "schreibe max@firma.de", "mail an x@y.de", "schick email an ...", etc.
  // Auch wenn kein "mail/email" Keyword vorhanden ist — Adresse ist eindeutig.
  const emailAddrMatch = cmd.match(/\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/i);
  if (emailAddrMatch) {
    const subjectMatch = cmd.match(/(?:betreff|subject)[:\s]+["']?(.+?)["']?(?:\s+(?:und|mit|inhalt|text|schreib|nachricht)|$)/i);
    let body = null;
    // Explizites Body-Keyword
    const bodyKeyMatch = cmd.match(/(?:und\s+)?(?:schreib|text|inhalt|nachricht|sag)[:\s]+["']?(.+?)["']?$/i);
    if (bodyKeyMatch) {
      body = bodyKeyMatch[1].trim();
    } else {
      // Alles nach "und" / "mit" hinter der E-Mail-Adresse = Body (natürliche Sprache)
      const addrEnd = cmd.indexOf(emailAddrMatch[1]) + emailAddrMatch[1].length;
      const afterAddr = cmd.slice(addrEnd).trim();
      const naturalBody = afterAddr.match(/^[,\s]*(?:und|mit|um|für|dass?|das?)\s+(.+)$/i);
      if (naturalBody) body = naturalBody[1].trim();
      else if (afterAddr && !subjectMatch) body = afterAddr.replace(/^[,\s]+/, '').trim() || null;
    }
    return {
      intent:  'mail_write',
      raw:     command,
      to:      emailAddrMatch[1],
      subject: subjectMatch?.[1]?.trim() || null,
      body:    body || null,
    };
  }

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
    // word_open nur wenn User explizit öffnen will — nicht bei Kontext-Beschreibungen wie "möglicherweise Word"
    if (/\b(öffn|start|launch|mach\s*auf|zeig)\b/i.test(cmd))
      return { intent: 'word_open', raw: command };
  }
  if (/\b(brief|anschreiben|bewerbung)\b/i.test(cmd) &&
      /\b(schreib|erstell|verfass|mach)\b/i.test(cmd))
    return { intent: 'word_write', raw: command };

  // ── Mail von Absender suchen / prüfen (VOR generischem mail-Block) ──────
  // "ist eine mail von mustafa gekommen", "gibt es mails von X", "prüf ob X geschrieben hat"
  // "mail von X in notizen eintragen", "checke mails von X und trag in notizen ein"
  const mailVonM = cmd.match(
    /\b(?:ist|war|gibt[\s-]?es|habe?n?|prüf(?:e)?|check|schau(?:e)?|kam(?:en)?)\b.{0,20}?\b(?:e?-?mail|nachricht|post)\b.{0,15}?\bvon\s+([a-zäöü][a-zäöü\s]{1,25}?)(?:\s+ge?komm|\s+da\b|\s+vorhanden|\s+angekommen|[?,]|$)/i
  ) || cmd.match(
    /\b(?:e?-?mail|nachricht)\b.{0,10}?\bvon\s+([a-zäöü][a-zäöü\s]{1,25?}?)\s*(?:les|check|prüf|öffn|anschau|lesen?|checken?|prüfen?|in\s+notiz|eintrag)/i
  );
  if (mailVonM) {
    const sender = (mailVonM[1] || '').replace(/\b(mal|die|das|der|mir|bitte|ob|eine?|auch)\b/gi, '').trim();
    if (sender.length > 1) {
      const zuNotizen = /\b(notiz|notizen|notes?|eintrag|schreib|hinzufüg)\b/i.test(cmd);
      return { intent: zuNotizen ? 'mail_to_notizen' : 'mail_from_check', sender };
    }
  }

  // ── Mail → Word/Excel/Notizen Transfer ────────────────────────────────
  // "emails in word eintragen", "mail in notizen schreiben", "mails nach excel"
  if (/\b(mail|email|e-mail|mails?|posteingang)\b/i.test(cmd)) {
    if (/\b(word|dokument|docx)\b/i.test(cmd))
      return { intent: 'mail_to_word', raw: command };
    if (/\b(excel|tabelle|xlsx)\b/i.test(cmd))
      return { intent: 'mail_to_excel', raw: command };
    if (/\b(notiz|notizen|notes?)\b/i.test(cmd))
      return { intent: 'mail_to_notizen', raw: command };
    if (/\b(schreib|schick|send|verfass|erstell|antwort|absend|weiterleite?)\b/i.test(cmd)) {
      const emailMatch   = cmd.match(/\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/i);
      const subjectMatch = cmd.match(/(?:betreff|subject)[:\s]+["']?(.+?)["']?(?:\s+(?:und|mit|inhalt|text|schreib|nachricht)|$)/i);
      const bodyMatch    = cmd.match(/(?:und\s+)?(?:schreib|text|inhalt|nachricht|sag)[:\s]+["']?(.+?)["']?$/i);
      return {
        intent: 'mail_write', raw: command,
        to:      emailMatch?.[1]  || null,
        subject: subjectMatch?.[1]?.trim() || null,
        body:    bodyMatch?.[1]?.trim()    || null,
      };
    }
    if (/\b(les|lier|öffne?|check|schau|zeig|ruf\s+ab|ab.*check|check.*ab)\b/i.test(cmd))
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

  // ── Formular aus Datei ausfüllen — ZUERST (spezifischer als file_transfer) ──
  // "nimm mitarbeiter.pdf und trage formular ein", "fülle formular mit datei aus"
  const formFileM = cmd.match(
    /(?:nimm|nehme?|aus|von|mit)\s+(.+?(?:\.pdf|\.docx?|\.xlsx?|\.txt|aus\s+downloads?|aus\s+schreibtisch).*?)\s+(?:und\s+)?(?:trag|füll|eingeb|eintrag|ausfüll)\s+(?:\w+\s+)*(?:formular|form|felder?|maske|das\s+offene|ein)/i
  );
  if (formFileM) {
    const srcRaw  = formFileM[1].trim();
    // Dateiname aus dem Text extrahieren
    const fileM   = srcRaw.match(/([a-zäöü0-9\s_-]+\.(?:pdf|docx?|xlsx?|txt|csv))/i);
    const dirM    = srcRaw.match(/(?:aus\s+)?(downloads?|schreibtisch|desktop|dokumente?|documents?)/i);
    return {
      intent:      'form_fill_from_file',
      source_file: fileM ? fileM[1].trim() : srcRaw,
      source_dir:  dirM  ? dirM[1].toLowerCase() : 'downloads',
      raw:         command
    };
  }

  // ── Datei-Transfer: "nimm X und trag in Y" ────────────────────────────
  const transferM = cmd.match(
    /\b(?:nimm|nehme?|aus)\s+(.+?)\s+(?:und\s+)?(?:trag|füge?|schreib|eintrag)\s*(?:es\s+)?(?:in|nach|ins?)\s+(.+)/i
  );
  if (transferM)
    return { intent: 'file_transfer', source: transferM[1].trim(), target: transferM[2].trim(), raw: command };

  // ── Formular ausfüllen (ohne Datei) ───────────────────────────────────
  if (/\b(füll|ausfüll)\b.*\b(formular|form|felder?|maske)\b/i.test(cmd))
    return { intent: 'form_fill', raw: command };

  // ── Notizen / Apple Notes ─────────────────────────────────────────────
  // "öffne Notizen", "neue Notiz", "notiz machen" → neue Notiz + Schreibfläche fokussieren
  if (/\b(notize?n?|neue?\s+notiz|notiz\s+(?:erstell|mach|anlegen|öffne?))\b/i.test(cmd)) {
    const textM = cmd.match(/(?:und\s+)?(?:schreib|tipp|erfass|notier)\s+(?:mir\s+)?(.+)/i);
    return { intent: 'notizen_open', text: textM ? textM[1].trim() : null };
  }

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

// Platzhalter-Step: wird in schaltzentrale.js vor Ausführung durch GPT-reformulierten Text ersetzt
function mailBodyStep(raw) {
  return { action: 'type', value: raw, __reformulate: true, command: raw };
}

// Senden-Step: normaler Click — coord-cache hat die trainierte Position
function sendenStep() {
  return { action: 'click', command: 'Senden', label: 'Senden' };
}

async function bauSteps(intent, { chef, axLayer }) {
  // ── Helpers ──────────────────────────────────────────────────────────
  const url   = (value)  => ({ action: 'open_url', value, command: value });
  const key   = (value)  => ({ action: 'key',      value, command: value });
  const typ   = (value)  => ({ action: 'type',     value, command: value });
  const wait  = (ms)     => ({ action: 'wait',     value: ms, command: `warten ${ms}ms` });
  const click = (coord)  => ({ action: 'click',    coordinate: coord, command: 'klicken' });
  // AX-Label-Klick — kein Pixel, echte Accessibility-Bezeichnung
  const ax    = (label)  => ({ action: 'click',    command: label, label });

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

    case 'mail_from_check':
    case 'mail_to_notizen':
    case 'mail_to_word':
    case 'mail_to_excel':
    case 'mail_read':
      // Mail-Inhalte + Vision-Auswertung + Transfers → Server-AI
      return null;

    case 'mail_write': {
      const prefs = require('./mail-prefs');
      const mailService = prefs.get('mail_service');

      // Unbekannter Maildienst → erst fragen
      if (!mailService) return { __ask_mail_service: true };

      const to   = intent.to   || '';
      const body = intent.body || '';
      const e    = (v) => encodeURIComponent(v);

      // Betreff aus Kontext ableiten wenn nicht explizit angegeben
      const subject = intent.subject || (() => {
        const b = body.toLowerCase();
        if (/termin.*bestätig|bestätig.*termin/i.test(b))  return 'Terminbestätigung';
        if (/termin.*absag|absag.*termin/i.test(b))        return 'Terminabsage';
        if (/termin/i.test(b))                             return 'Termin';
        if (/rechnung/i.test(b))                           return 'Rechnung';
        if (/angebot/i.test(b))                            return 'Angebot';
        if (/bewerbung/i.test(b))                          return 'Bewerbung';
        if (/zusage/i.test(b))                             return 'Zusage';
        if (/absage/i.test(b))                             return 'Absage';
        if (/frage|anfrage/i.test(b))                      return 'Anfrage';
        if (/info|information/i.test(b))                   return 'Information';
        if (/erinnerung/i.test(b))                         return 'Erinnerung';
        if (/bestätig/i.test(b))                           return 'Bestätigung';
        // Fallback: erste 5 Wörter des Body
        return body.split(/\s+/).slice(0, 5).join(' ') || '';
      })();

      if (mailService === 'apple_mail') {
        // Native Mac Mail — App über Spotlight öffnen, dann alles per AX
        s.push(...(IS_MAC
          ? [key('cmd+space'), wait(400), typ('Mail'), wait(600), key('enter'), wait(2000)]
          : [key('super'),     wait(400), typ('Mail'), wait(600), key('enter'), wait(2000)]
        ));
        s.push(ax('Verfassen'));
        s.push(wait(1000));
        if (to)      { s.push(ax('An:'));      s.push(typ(to));      s.push(key('tab')); s.push(wait(300)); }
        if (subject) { s.push(ax('Betreff:')); s.push(typ(subject)); s.push(wait(300)); }
        if (body)    { s.push(ax('Nachrichtenbereich')); s.push(mailBodyStep(body)); s.push(wait(300)); }
        s.push(sendenStep());

      } else if (mailService === 'outlook_app') {
        // Outlook Desktop App — per Spotlight/Start öffnen, dann AX
        s.push(...(IS_MAC
          ? [key('cmd+space'), wait(400), typ('Microsoft Outlook'), wait(600), key('enter'), wait(2500)]
          : [key('super'),     wait(400), typ('Outlook'),           wait(600), key('enter'), wait(2500)]
        ));
        s.push(ax('Neue E-Mail'));
        s.push(wait(1000));
        if (to)      { s.push(ax('An'));      s.push(typ(to));      s.push(key('tab')); s.push(wait(300)); }
        if (subject) { s.push(ax('Betreff')); s.push(typ(subject)); s.push(wait(300)); }
        if (body)    { s.push(ax('Nachrichtenbereich')); s.push(mailBodyStep(body)); s.push(wait(300)); }
        s.push(sendenStep());

      } else if (mailService === 'gmail') {
        s.push(url(`https://mail.google.com/mail/?view=cm&fs=1${to ? `&to=${e(to)}` : ''}`));
        s.push(wait(3500));
        if (subject) { s.push(typ(subject)); s.push(wait(300)); }
        s.push(key('tab')); s.push(wait(300));
        if (body)    { s.push(mailBodyStep(body)); s.push(wait(400)); }
        s.push(sendenStep());

      } else {
        // Outlook Web
        s.push(url(`https://outlook.live.com/mail/0/deeplink/compose${to ? `?to=${e(to)}` : ''}`));
        s.push(wait(3500));
        if (subject) { s.push(typ(subject)); s.push(wait(300)); }
        s.push(key('tab')); s.push(wait(300));
        if (body)    { s.push(mailBodyStep(body)); s.push(wait(400)); }
        s.push(sendenStep());
      }
      break;
    }

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

    // ── Formular aus Datei ausfüllen — PDF lesen + Server-AI für Feldmapping ─
    case 'form_fill_from_file':
      // Commander gibt den Intent zurück, aber KEINE lokalen Steps —
      // stattdessen: enriched_command für Server bauen (source_file + source_dir)
      // Das passiert über den "enriched"-Rückgabepfad im dispatch()
      return { __server_task: 'form_fill_from_file', source_file: intent.source_file, source_dir: intent.source_dir };

    // ── Notizen / Apple Notes ─────────────────────────────────────────────
    // Öffnen + neue Notiz anlegen + Schreibfläche (Body) fokussieren
    case 'notizen_open': {
      // 1. App öffnen via Spotlight/Start
      s.push(...spotlight(IS_MAC ? 'Notizen' : 'Sticky Notes'));
      // 2. Neue Notiz erstellen (cmd+N / ctrl+N)
      s.push(key(IS_MAC ? 'cmd+n' : 'ctrl+n'), wait(600));
      // 3. Titel-Feld → Notiz-Body (Tab)
      //    In Apple Notes landet der Cursor nach cmd+N im Titel-Feld
      s.push(key('tab'), wait(300));
      // 4. Optional: Text direkt eintippen wenn im Befehl angegeben
      if (intent.text) s.push(typ(intent.text));
      break;
    }

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

  const result = await bauSteps(intent, { chef: chef || null, axLayer: axLayer || null });
  if (!result) {
    console.log(`🧠 Commander: "${intent.intent}" braucht Server-AI`);
    return null;
  }

  // Spezial-Rückgaben direkt durchleiten (kein Step-Array)
  if (result.__server_task)    return result;
  if (result.__ask_mail_service) return result;

  console.log(`⚡ Commander: ${result.length} Steps lokal (kein API)`);
  return { intent: intent.intent, steps: result };
}

module.exports = { dispatch, erkennIntent };
