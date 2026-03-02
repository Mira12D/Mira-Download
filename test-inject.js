// Test: Injizierte Gedanken abrufen
const { getCurrentThought, waitForNextThought } = require('./circuit/inject');

// Alle 2 Sekunden aktuellen Gedanken zeigen
setInterval(() => {
  const thought = getCurrentThought();
  if (thought) {
    console.log('🧠 Aktueller Gedanke:', thought.content);
  }
}, 2000);

// Auf nächsten Gedanken warten
waitForNextThought().then(thought => {
  if (thought) {
    console.log('✨ Neuer Gedanke eingetroffen:', thought.content);
  }
});