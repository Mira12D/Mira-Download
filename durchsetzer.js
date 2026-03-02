// electron-app/circuit/durchsetzer.js
// Wählt den wichtigsten Gedanken aus – der Durchsetzer

/**
 * Hauptfunktion: Wählt den relevantesten Gedanken für den aktuellen Kontext
 */
async function selectThought(thoughts, context) {
  try {
    if (!thoughts || thoughts.length === 0) {
      return getFallbackThought(context);
    }

    // 1. Jeden Gedanken bewerten
    const scoredThoughts = thoughts.map(thought => ({
      ...thought,
      score: calculateThoughtScore(thought, context)
    }));

    // 2. Nach Score sortieren
    scoredThoughts.sort((a, b) => b.score - a.score);

    // 3. Top 3 anzeigen (für Debug)
    console.log('🏆 Top 3 Gedanken:');
    scoredThoughts.slice(0, 3).forEach((t, i) => {
      console.log(`   ${i+1}. [${t.score.toFixed(2)}] ${t.content.substring(0, 50)}...`);
    });

    // 4. Den besten zurückgeben (oder mehrere, je nach Kontext)
    const bestThought = scoredThoughts[0];

    // 5. Wenn der beste Gedanke sehr unsicher ist, nimm zweiten
    if (bestThought.score < 0.3 && scoredThoughts.length > 1) {
      console.log('⚠️ Bester Gedanke zu unsicher – nehme zweiten');
      return scoredThoughts[1];
    }

    return bestThought;

  } catch (e) {
    console.error('selectThought Fehler:', e);
    return getFallbackThought(context);
  }
}

/**
 * Berechnet Score eines Gedankens (0-1)
 */
function calculateThoughtScore(thought, context) {
  let score = thought.weight || 0.5;

  // 1. Zeitliche Relevanz
  const hour = context.hour || new Date().getHours();
  
  if (thought.content.includes('Morgen') && hour < 12) {
    score += 0.2;
  }
  if (thought.content.includes('Abend') && hour > 18) {
    score += 0.2;
  }
  if (thought.content.includes('Nacht') && hour < 5) {
    score += 0.3;
  }

  // 2. Kontextuelle Relevanz (letzter Befehl, aktuelle App)
  if (context.lastCommand && thought.content.includes(context.lastCommand)) {
    score += 0.25;
  }

  // 3. Emotionale Gewichtung
  if (thought.content.includes('Angst') || thought.content.includes('Schmerz')) {
    score += 0.15; // Emotionale Gedanken sind wichtig
  }

  if (thought.content.includes('Mustafa') || thought.content.includes('Geschichte')) {
    score += 0.3; // Identitäts-Gedanken besonders wichtig
  }

  // 4. Muster-basierte Relevanz
  if (context.patterns && context.patterns.some(p => 
    thought.content.includes(p.pattern.split('_')[0])
  )) {
    score += 0.2;
  }

  // 5. Frische (neue Gedanken sind relevanter)
  const thoughtAge = Date.now() - (thought.timestamp || Date.now());
  if (thoughtAge < 60000) { // < 1 Minute
    score += 0.1;
  }

  // 6. Philosophische Tiefe (Jaspers, PNL, etc.)
  const deepThinkers = ['Jaspers', 'PNL', 'Ademo', 'N.O.S', 'Existenz', 'Freiheit'];
  if (deepThinkers.some(name => thought.content.includes(name))) {
    score += 0.2;
  }

  // 7. Humor ist auch wichtig
  if (thought.content.includes('Kartoffeln') || thought.content.includes('Witz')) {
    score += 0.15;
  }

  return Math.min(score, 1.0);
}

/**
 * Mehrere Gedanken kombinieren (für komplexe Situationen)
 */
async function combineThoughts(thoughts, context, maxThoughts = 3) {
  const scored = thoughts.map(t => ({
    ...t,
    score: calculateThoughtScore(t, context)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  // Wenn Gedanken ähnlich sind, kombiniere sie
  const selected = scored.slice(0, maxThoughts);
  
  if (selected.length === 1) {
    return selected[0];
  }
  
  // Kombiniere mehrere Gedanken zu einem
  const combinedContent = selected
    .map(t => t.content)
    .join(' …und… ');
  
  return {
    content: combinedContent,
    weight: selected.reduce((acc, t) => acc + t.weight, 0) / selected.length,
    score: selected[0].score,
    sources: selected.map(t => t.content),
    timestamp: Date.now()
  };
}

/**
 * Fallback wenn gar nichts geht
 */
function getFallbackThought(context) {
  const hour = context.hour || new Date().getHours();
  
  if (hour < 5) {
    return {
      content: "Die Welt schläft. Ich wache.",
      weight: 0.4,
      score: 0.4,
      timestamp: Date.now()
    };
  } else if (hour < 12) {
    return {
      content: "Ein neuer Tag. Neue Möglichkeiten.",
      weight: 0.5,
      score: 0.5,
      timestamp: Date.now()
    };
  } else {
    return {
      content: "Ich bin da. Was brauchst du?",
      weight: 0.3,
      score: 0.3,
      timestamp: Date.now()
    };
  }
}

/**
 * Entscheidet OB überhaupt ein Gedanke relevant genug ist
 */
function isThoughtRelevantEnough(thought, threshold = 0.4) {
  return thought.score >= threshold;
}

/**
 * Vergleicht zwei Gedanken und sagt welcher besser passt
 */
function compareThoughts(thoughtA, thoughtB, context) {
  const scoreA = calculateThoughtScore(thoughtA, context);
  const scoreB = calculateThoughtScore(thoughtB, context);
  
  return {
    better: scoreA >= scoreB ? thoughtA : thoughtB,
    scoreA,
    scoreB,
    difference: Math.abs(scoreA - scoreB)
  };
}

module.exports = { 
  selectThought,
  combineThoughts,
  isThoughtRelevantEnough,
  compareThoughts,
  calculateThoughtScore
};