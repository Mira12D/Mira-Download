# Telekolleg: CSS Design System — Apple Style

## REGEL: Immer diese CSS-Basis verwenden

Jede generierte CSS-Datei MUSS mit diesem Block beginnen:

```css
/* ── Design Tokens ────────────────────────────── */
:root {
  /* Colors */
  --color-primary:     #0071e3;
  --color-primary-hover: #0077ed;
  --color-secondary:   #1d1d1f;
  --color-accent:      #06c;
  --color-success:     #34c759;
  --color-warning:     #ff9f0a;
  --color-danger:      #ff3b30;

  /* Backgrounds */
  --bg-page:     #ffffff;
  --bg-surface:  #f5f5f7;
  --bg-card:     #ffffff;
  --bg-overlay:  rgba(0,0,0,0.04);

  /* Text */
  --text-primary:   #1d1d1f;
  --text-secondary: #6e6e73;
  --text-tertiary:  #86868b;
  --text-inverse:   #ffffff;

  /* Border */
  --border-color:  rgba(0,0,0,0.08);
  --border-radius: 12px;
  --border-radius-sm: 8px;
  --border-radius-lg: 20px;
  --border-radius-xl: 28px;

  /* Shadow */
  --shadow-sm:  0 2px 8px rgba(0,0,0,0.06);
  --shadow-md:  0 4px 20px rgba(0,0,0,0.08);
  --shadow-lg:  0 8px 40px rgba(0,0,0,0.12);
  --shadow-xl:  0 20px 60px rgba(0,0,0,0.15);

  /* Spacing */
  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
  --space-xl:  40px;
  --space-2xl: 64px;
  --space-3xl: 96px;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display',
               'Segoe UI', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;

  /* Transitions */
  --transition: 0.2s ease;
  --transition-slow: 0.4s ease;
}

/* ── Reset ────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }

body {
  font-family: var(--font-sans);
  background: var(--bg-page);
  color: var(--text-primary);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

img, video { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }
ul, ol { list-style: none; }
button { cursor: pointer; border: none; background: none; font: inherit; }
```

## Typography — Apple-Skala

```css
/* Überschriften */
.hero-title {
  font-size: clamp(2.5rem, 6vw, 5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--text-primary);
}

.section-title {
  font-size: clamp(1.8rem, 4vw, 3rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  text-align: center;
  margin-bottom: var(--space-xl);
}

.card-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: var(--space-sm);
}

p {
  font-size: 1rem;
  line-height: 1.7;
  color: var(--text-secondary);
}

.lead {
  font-size: clamp(1.1rem, 2vw, 1.35rem);
  line-height: 1.5;
  color: var(--text-secondary);
}
```

## Layout — Container & Grid

```css
.container {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 var(--space-lg);
}

.container-sm { max-width: 680px; margin: 0 auto; padding: 0 var(--space-lg); }
.container-lg { max-width: 1400px; margin: 0 auto; padding: 0 var(--space-lg); }

/* Grid Systeme */
.grid { display: grid; gap: var(--space-lg); }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

/* Flex Utilities */
.flex        { display: flex; }
.flex-center { display: flex; align-items: center; justify-content: center; }
.flex-between{ display: flex; align-items: center; justify-content: space-between; }
.gap-sm { gap: var(--space-sm); }
.gap-md { gap: var(--space-md); }
.gap-lg { gap: var(--space-lg); }

@media (max-width: 768px) {
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}
@media (max-width: 1024px) {
  .grid-4 { grid-template-columns: repeat(2, 1fr); }
}
```

## Navigation — Apple-Style

```css
.nav {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  height: 52px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid var(--border-color);
}

.nav-container {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 var(--space-lg);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-logo {
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: var(--space-xl);
}

.nav-links a {
  font-size: 0.85rem;
  color: var(--text-secondary);
  transition: color var(--transition);
}
.nav-links a:hover { color: var(--text-primary); }
```

## Buttons — Clean & Modern

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: 12px 22px;
  border-radius: 980px; /* Apple pill-shape */
  font-size: 0.9rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  transition: all var(--transition);
  white-space: nowrap;
}

.btn-primary {
  background: var(--color-primary);
  color: #fff;
}
.btn-primary:hover {
  background: var(--color-primary-hover);
  transform: scale(1.02);
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--color-primary);
}
.btn-secondary:hover {
  background: rgba(0,0,0,0.08);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}
.btn-ghost:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-full { width: 100%; }
.btn-lg { padding: 16px 32px; font-size: 1rem; }
.btn-sm { padding: 8px 16px; font-size: 0.8rem; }
```

## Cards — Modern & Clean

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-lg);
  padding: var(--space-xl);
  transition: transform var(--transition), box-shadow var(--transition);
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.card-icon {
  font-size: 2rem;
  margin-bottom: var(--space-md);
  width: 56px;
  height: 56px;
  background: var(--bg-surface);
  border-radius: var(--border-radius);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Glass Card */
.card-glass {
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: var(--border-radius-lg);
  padding: var(--space-xl);
}
```

## Hero Section

```css
.hero {
  padding: calc(52px + var(--space-3xl)) 0 var(--space-3xl);
  text-align: center;
  background: linear-gradient(180deg, #fbfbfd 0%, #ffffff 100%);
}

.hero-eyebrow {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
  margin-bottom: var(--space-md);
}

.hero-subtitle {
  font-size: clamp(1.1rem, 2vw, 1.35rem);
  color: var(--text-secondary);
  max-width: 600px;
  margin: var(--space-lg) auto var(--space-xl);
  line-height: 1.5;
}

.hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}
```

## Sections — Spacing & Background

```css
.section { padding: var(--space-3xl) 0; }
.section-alt { background: var(--bg-surface); }
.section-dark { background: var(--text-primary); color: var(--text-inverse); }

/* Section Header */
.section-eyebrow {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
  text-align: center;
  margin-bottom: var(--space-md);
}

.section-subtitle {
  font-size: 1.1rem;
  color: var(--text-secondary);
  text-align: center;
  max-width: 500px;
  margin: -var(--space-md) auto var(--space-xl);
}
```

## Dark Mode Support

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page:    #000000;
    --bg-surface: #1c1c1e;
    --bg-card:    #1c1c1e;
    --bg-overlay: rgba(255,255,255,0.05);
    --text-primary:   #f5f5f7;
    --text-secondary: #a1a1a6;
    --text-tertiary:  #6e6e73;
    --border-color: rgba(255,255,255,0.1);
  }
  .nav {
    background: rgba(0,0,0,0.85);
    border-bottom-color: rgba(255,255,255,0.08);
  }
  .hero {
    background: linear-gradient(180deg, #0a0a0a 0%, #000000 100%);
  }
}
```

## Animationen — Subtle & Smooth

```css
/* Fade in beim Laden */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

.animate-fade-up {
  animation: fadeUp 0.6s ease both;
}
.animate-delay-1 { animation-delay: 0.1s; }
.animate-delay-2 { animation-delay: 0.2s; }
.animate-delay-3 { animation-delay: 0.3s; }
```

## Formular — Apple Style

```css
.form-group { margin-bottom: var(--space-lg); }

.form-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: var(--space-sm);
}

.form-input, .form-textarea, .form-select {
  width: 100%;
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-family: var(--font-sans);
  font-size: 1rem;
  color: var(--text-primary);
  transition: border-color var(--transition), box-shadow var(--transition);
  outline: none;
}

.form-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(0,113,227,0.15);
}

.form-textarea { min-height: 120px; resize: vertical; }
```

## VERBOTEN — niemals so:

```css
/* ❌ Niemals */
font-family: Arial, sans-serif;
color: #ffcc00;
background-color: #1a1a1a;  /* ohne Design System */
font-size: 20px;             /* ohne Skala */
margin: 20px;                /* ohne Design Tokens */
* { box-sizing: border-box; } /* ohne vollständigen Reset */
```
