# Telekolleg: Modern JavaScript — ES2024 Best Practices

## REGEL: Immer diese JS-Basis in script.js

```javascript
'use strict';

// ── App Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  initNav();
  initAnimations();
  initForms();
  // weitere Module hier registrieren
}
```

Niemals `var`. Immer `const` oder `let`. Kein `onclick=""` im HTML.

## Variablen & Konstanten

```javascript
// ❌ FALSCH
var name = 'Max';
var list = [];

// ✅ RICHTIG
const API_URL = 'https://api.example.com';  // Konstante: UPPER_SNAKE_CASE
const userName = 'Max';                      // Unveränderlich: const
let currentIndex = 0;                        // Veränderlich: let
```

## DOM — Modern sauber

```javascript
// Elemente selektieren
const hero     = document.querySelector('.hero');
const cards    = document.querySelectorAll('.card');
const btnLogin = document.getElementById('loginBtn');

// ❌ niemals so
const el = document.getElementsByClassName('card')[0];

// Klassen manipulieren
hero.classList.add('visible');
hero.classList.remove('hidden');
hero.classList.toggle('active');
hero.classList.contains('active'); // → boolean

// Attribute
el.dataset.id;            // data-id="..."
el.setAttribute('aria-expanded', 'true');
el.removeAttribute('hidden');

// Text & HTML
el.textContent = 'Safe text';   // ✅ XSS-sicher
el.innerHTML   = '<b>HTML</b>'; // ⚠️ nur mit sanitized content
```

## Events — Delegation & Modern

```javascript
// ✅ Event Delegation (effizient für Listen)
document.querySelector('.cards-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  openCard(card.dataset.id);
});

// ✅ Mehrere Events
['mouseenter', 'focus'].forEach(event => {
  btn.addEventListener(event, handleHover);
});

// ✅ Options
btn.addEventListener('click', handleClick, { once: true });     // nur 1x
btn.addEventListener('scroll', handleScroll, { passive: true }); // Performance

// Navigation — Smooth Scroll
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
```

## Scroll-Animationen — Intersection Observer

```javascript
// Elemente beim Scrollen einblenden (KEIN scroll event listener!)
function initAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // nur 1x animieren
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.animate-fade-up').forEach(el => {
    observer.observe(el);
  });
}

// CSS dazu:
// .animate-fade-up { opacity: 0; transform: translateY(24px); transition: 0.6s ease; }
// .animate-fade-up.visible { opacity: 1; transform: translateY(0); }
```

## Navigation — Sticky mit Blur

```javascript
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  // Mobile Menu
  const menuBtn  = document.querySelector('.nav-menu-btn');
  const navLinks = document.querySelector('.nav-links');

  menuBtn?.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', isOpen);
  });
}
```

## Fetch & API — Async/Await

```javascript
// ✅ Sauber mit Error Handling
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Fetch failed:', error);
    throw error;
  }
}

// POST Request
async function postData(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Verwendung
async function loadProducts() {
  const loadingEl = document.querySelector('.loading');
  loadingEl.hidden = false;

  try {
    const data = await fetchData('/api/products');
    renderProducts(data.products);
  } catch {
    showError('Laden fehlgeschlagen. Bitte neu laden.');
  } finally {
    loadingEl.hidden = true;
  }
}
```

## Formulare — Validation & Submit

```javascript
function initForms() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;

    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const data = Object.fromEntries(new FormData(form));
      await postData('/api/contact', data);
      showSuccess(form, '✅ Message sent!');
      form.reset();
    } catch {
      showError(form, 'Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  });
}

function validateForm(form) {
  let valid = true;
  form.querySelectorAll('[required]').forEach(input => {
    const error = form.querySelector(`#${input.id}Error`);
    if (!input.value.trim()) {
      error && (error.textContent = 'This field is required');
      input.classList.add('error');
      valid = false;
    } else {
      error && (error.textContent = '');
      input.classList.remove('error');
    }
  });
  return valid;
}
```

## Nützliche Helper-Funktionen

```javascript
// Debounce — für Search, Resize
const debounce = (fn, ms = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// Throttle — für Scroll
const throttle = (fn, ms = 100) => {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
};

// Format Zahlen
const formatNumber = (n) => new Intl.NumberFormat('en-US').format(n);
const formatCurrency = (n, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

// Clipboard
async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

// Local Storage (mit JSON Support)
const storage = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
  remove: (key) => localStorage.removeItem(key),
};
```

## Counter Animation

```javascript
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const duration = 2000;
  const start = performance.now();

  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.floor(eased * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// HTML: <span class="counter" data-target="12500">0</span>
```

## Dark/Light Mode Toggle

```javascript
function initTheme() {
  const saved = storage.get('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(saved);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.set('theme', theme);
}

document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  setTheme(current === 'dark' ? 'light' : 'dark');
});
```

## VERBOTEN — niemals so:

```javascript
// ❌ niemals
var x = 1;
document.write('<p>text</p>');
element.innerHTML = userInput;      // XSS!
onclick="doSomething()"             // Inline Handler
$(document).ready(function() {});  // jQuery
eval('code');
alert('debug');                     // stattdessen console.log
setInterval(fn, 0);                 // busy loop
```
