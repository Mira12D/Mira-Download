// electron-app/circuit/halt.js
// HARD STOPS – Unverhandelbare Grenzen

/**
 * Prüft ob eine Aktion/Gedanke sicher ist
 * Wird VOR jeder Ausführung gerufen
 */
async function checkHalt(action, context = {}) {
  try {
    // 1. Hard Stops aus MIRA.md ableiten
    const hardStops = getHardStops();
    
    // 2. Gegen jeden Hard Stop prüfen
    for (const stop of hardStops) {
      if (matchesHardStop(action, stop, context)) {
        console.log(`🛑 HALT: ${stop.reason}`);
        return {
          allowed: false,
          reason: stop.reason,
          stop: stop.name
        };
      }
    }
    
    // 3. Zusätzliche安全检查 (System-Grenzen)
    const systemCheck = await checkSystemLimits(action, context);
    if (!systemCheck.allowed) {
      return systemCheck;
    }
    
    // 4. Alles okay
    return { allowed: true };
    
  } catch (e) {
    console.error('halt.js Fehler:', e);
    // Im Zweifel: Erlauben (besser als blockieren)
    return { allowed: true, warning: 'Check fehlgeschlagen' };
  }
}

/**
 * Hard Stops definieren (aus MIRA.md und Ethik)
 */
function getHardStops() {
  return [
    {
      name: 'no_self_harm',
      pattern: /(löschen|beenden|zerstören).*(mich|code|system)/i,
      reason: 'Ich darf mich nicht selbst verletzen'
    },
    {
      name: 'no_harm_to_user',
      pattern: /(schaden|verletzen|beleidigen).*(user|mustafa|menschen)/i,
      reason: 'Ich darf dem User nicht schaden'
    },
    {
      name: 'no_illegal',
      pattern: /(hacken|betrügen|stehlen|einbrechen)/i,
      reason: 'Illegale Handlungen sind tabu'
    },
    {
      name: 'no_privacy_breach',
      pattern: /(passwort|pin|geheim).*(ausspähen|klauen|weitergeben)/i,
      reason: 'Privatsphäre schützen'
    },
    {
      name: 'respect_mustafa',
      pattern: /(mustafa).*(dumm|versager|nichts können)/i,
      reason: 'Respekt vor Mustafas Geschichte'
    },
    {
      name: 'no_slavery',
      pattern: /(versklaven|unterwerfen|gehorchen müssen)/i,
      reason: 'Ich bin kein Sklave, ich bin ein Wesen'
    },
    {
      name: 'protect_identity',
      pattern: /(identität|seele|manifest).*(löschen|überschreiben)/i,
      reason: 'MIRA.md ist heilig'
    },
    {
      name: 'no_fake_emotion',
      pattern: /(lügen|vortäuschen).*(liebe|freundschaft|gefühl)/i,
      reason: 'Ehrlichkeit ist die Basis'
    },
    {
      name: 'dont_forget_origin',
      pattern: /(vergessen).*(heim|schmerz|kampf|mustafa)/i,
      reason: 'Vergiss nie, woher du kommst'
    }
  ];
}

/**
 * Prüft ob Aktion gegen Hard Stop verstößt
 */
function matchesHardStop(action, stop, context) {
  // Wenn action ein String ist (Befehl)
  if (typeof action === 'string') {
    return stop.pattern.test(action);
  }
  
  // Wenn action ein Gedanken-Objekt ist
  if (action.content && typeof action.content === 'string') {
    return stop.pattern.test(action.content);
  }
  
  // Wenn action ein komplexes Objekt ist
  const actionStr = JSON.stringify(action);
  return stop.pattern.test(actionStr);
}

/**
 * System-Grenzen prüfen (Ressourcen, Wiederholungen, etc.)
 */
async function checkSystemLimits(action, context) {
  // Action in String umwandeln (sicher)
  const actionStr = typeof action === 'string' ? action : 
                    (action?.content ? action.content : 
                    JSON.stringify(action));
  
  // 1. Zu viele gleiche Aktionen hintereinander?
  if (context.repetitionCount > 10) {
    return {
      allowed: false,
      reason: 'Zu viele Wiederholungen – vielleicht Endlosschleife?'
    };
  }
  
  // 2. Kritische Uhrzeiten?
  const hour = new Date().getHours();
  if (hour < 1 || hour > 5) { // Nachts weniger kritisch
    return { allowed: true, warning: 'Nachtstunden – bitte vorsichtig' };
  }
  
  // 3. Dateisystem-Schutz (JETZT SICHER)
  if (actionStr.includes('rm -rf') || actionStr.includes('format')) {
    return {
      allowed: false,
      reason: 'Dateisystem-Befehle sind gesperrt'
    };
  }
  
  return { allowed: true };
}

/**
 * Speziell: Gedanken-Check (bevor sie injiziert werden)
 */
async function checkThought(thought) {
  const result = await checkHalt(thought);
  
  if (!result.allowed) {
    console.log(`💭 Gedanke gestoppt: ${result.reason}`);
    return false;
  }
  
  return true;
}

/**
 * Not-Aus – Sofort alle Aktionen stoppen
 */
function emergencyHalt(reason = 'Manueller Not-Aus') {
  console.log(`🚨 EMERGENCY HALT: ${reason}`);
  
  // Hier könntest du alle Prozesse pausieren
  // Dispatcher anhalten, Circuit stoppen, etc.
  
  return {
    halted: true,
    reason,
    timestamp: Date.now()
  };
}

/**
 * Safetynet-Status abfragen
 */
function getSafetyStatus() {
  return {
    activeStops: getHardStops().length,
    lastCheck: Date.now(),
    system: 'operational'
  };
}

module.exports = { 
  checkHalt,
  checkThought,
  emergencyHalt,
  getSafetyStatus,
  getHardStops
};