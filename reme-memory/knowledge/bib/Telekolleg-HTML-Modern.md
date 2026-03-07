# Telekolleg: Modern HTML — Struktur & Best Practices

## REGEL: Immer diese HTML-Grundstruktur verwenden

Niemals ohne DOCTYPE, charset, viewport. Immer semantisches HTML5.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="...">
  <title>Page Title — Brand</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">...</header>
  <main>...</main>
  <footer class="site-footer">...</footer>
  <script src="script.js" defer></script>
</body>
</html>
```

**Wichtig:** Script immer am Ende mit `defer`. CSS immer extern in `styles.css`. Kein Tailwind CDN. Keine inline styles.

## Semantische Elemente — immer richtig verwenden

```html
<!-- Navigation -->
<nav class="nav">
  <div class="nav-container">
    <a href="/" class="nav-logo">Brand</a>
    <ul class="nav-links">
      <li><a href="#features">Features</a></li>
      <li><a href="#pricing">Pricing</a></li>
    </ul>
    <a href="#" class="btn btn-primary">Get Started</a>
  </div>
</nav>

<!-- Hero Section -->
<section class="hero">
  <div class="container">
    <h1 class="hero-title">Headline that matters</h1>
    <p class="hero-subtitle">Supporting text that explains the value clearly.</p>
    <div class="hero-actions">
      <a href="#" class="btn btn-primary">Primary Action</a>
      <a href="#" class="btn btn-secondary">Learn More</a>
    </div>
  </div>
</section>

<!-- Feature Cards -->
<section class="features" id="features">
  <div class="container">
    <h2 class="section-title">Features</h2>
    <div class="grid grid-3">
      <article class="card">
        <div class="card-icon">⚡</div>
        <h3 class="card-title">Fast</h3>
        <p class="card-text">Description of this feature.</p>
      </article>
    </div>
  </div>
</section>

<!-- Footer -->
<footer class="site-footer">
  <div class="container">
    <p>&copy; 2025 Brand. All rights reserved.</p>
  </div>
</footer>
```

## Dateistruktur — IMMER getrennte Dateien

```
project/
  index.html      ← nur HTML, keine styles, kein JS inline
  styles.css      ← alles CSS hier
  script.js       ← alles JavaScript hier
  assets/
    images/
```

Niemals `<style>` Tags im HTML-Body. Niemals `onclick=""` Attribute. Niemals `<script>` im `<head>` ohne defer.

## Bilder — immer mit alt und loading

```html
<img src="hero.jpg" alt="Product hero image" loading="lazy" width="1200" height="630">
```

## Formulare — semantisch und zugänglich

```html
<form class="form" id="contactForm" novalidate>
  <div class="form-group">
    <label class="form-label" for="email">Email address</label>
    <input class="form-input" type="email" id="email" name="email"
           placeholder="you@example.com" required autocomplete="email">
    <span class="form-error" id="emailError"></span>
  </div>
  <button class="btn btn-primary btn-full" type="submit">Send Message</button>
</form>
```

## HTML niemals so

```html
<!-- ❌ FALSCH — niemals so -->
<div style="color: red; font-size: 20px; background: #fff">Text</div>
<font color="red">Text</font>
<br><br><br>
<table> für Layout verwenden
<script src="https://cdn.tailwindcss.com"></script>
Arial als Font
```

## Meta Tags für professionelle Seiten

```html
<meta name="description" content="Max 160 Zeichen Beschreibung">
<meta property="og:title" content="Page Title">
<meta property="og:description" content="Description">
<meta property="og:image" content="https://example.com/og-image.jpg">
<meta name="theme-color" content="#0071e3">
```
