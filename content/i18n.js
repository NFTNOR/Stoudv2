/**
 * STOUD i18n content loader
 * Fetches /content/{lang}.json and applies translations to the current page.
 * Activated by ?lang=ja or ?lang=zh URL parameter.
 */
(async function () {
  const lang = new URLSearchParams(location.search).get('lang');
  if (!lang || lang === 'en') return;

  let data;
  try {
    const r = await fetch(`/content/${lang}.json?v=${Date.now()}`);
    if (!r.ok) return;
    data = await r.json();
  } catch (e) {
    console.warn('[i18n] Could not load', lang, e);
    return;
  }

  /* ── helpers ── */
  function get(path) {
    return path.split('.').reduce((o, k) =>
      (o == null ? undefined : isNaN(k) ? o[k] : o[parseInt(k)]), data);
  }
  // Replace text of an element, keeping any child <span> elements intact
  function setText(el, text) {
    if (!el || !text) return;
    const spans = [...el.querySelectorAll('span')];
    el.textContent = text;
    spans.forEach(s => el.prepend(s));
  }
  // Replace a text node within an element (avoids overwriting child spans)
  function setTextNode(el, text) {
    if (!el || !text) return;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        node.textContent = text;
        return;
      }
    }
    // fallback
    el.append(document.createTextNode(text));
  }

  /* ── page detection ── */
  const file = location.pathname.split('/').pop() || 'stoud-home-v6.html';

  /* ── nav labels (all pages) ── */
  const NAV_HREFS = {
    'stoud-home-v6.html': 'nav.home',
    'stoud-about.html':   'nav.about',
    'stoud-people.html':  'nav.people',
    'stoud-expertise.html': 'nav.expertise',
    'stoud-career.html':  'nav.career',
    'stoud-contact.html': 'nav.contact',
  };
  document.querySelectorAll('.menu a, .mob-links a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const filename = href.split('/').pop().split('?')[0];
    const key = NAV_HREFS[filename];
    if (key) setTextNode(a, get(key));
  });

  /* ── language switcher links ── */
  document.querySelectorAll('[data-lang]').forEach(a => {
    const url = new URL(a.href, location.href);
    url.searchParams.set('lang', a.dataset.lang);
    a.href = url.toString();
  });

  /* ── update html lang attribute ── */
  document.documentElement.lang = lang;

  /* ── page-specific content ── */

  // ABOUT
  if (file === 'stoud-about.html') {
    setText(document.querySelector('.title'), get('about.title'));
    document.querySelectorAll('.content > p').forEach((p, i) => {
      setText(p, get(`about.body.${i}`));
    });
  }

  // EXPERTISE
  if (file === 'stoud-expertise.html') {
    setText(document.querySelector('.title'), get('expertise.title'));
    const headings = document.querySelectorAll('.content h2');
    const paras    = document.querySelectorAll('.content p');
    headings.forEach((h, i) => setText(h, get(`expertise.sections.${i}.heading`)));
    paras.forEach((p, i)    => setText(p, get(`expertise.sections.${i}.body`)));
  }

  // CAREER
  if (file === 'stoud-career.html') {
    setText(document.querySelector('.title'), get('career.title'));
    const paras = document.querySelectorAll('.content > p');
    paras.forEach((p, i) => {
      const text = get(`career.body.${i}`);
      if (!text) return;
      // Last paragraph may have an <a> mailto link — preserve it
      if (p.querySelector('a')) {
        const a = p.querySelector('a');
        p.textContent = text.replace(/info@stoud\.com/, '');
        p.appendChild(a);
      } else {
        setText(p, text);
      }
    });
  }

  // CONTACT
  if (file === 'stoud-contact.html') {
    setText(document.querySelector('.title'), get('contact.title'));
    setText(document.querySelector('.content .lead'), get('contact.intro'));
    const headings = document.querySelectorAll('.content h2');
    const allPs = document.querySelectorAll('.content p:not(.lead)');
    headings.forEach((h, i) => setText(h, get(`contact.sections.${i}.heading`)));
    // Flatten all section lines into the paragraphs
    let pIdx = 0;
    const sections = get('contact.sections') || [];
    sections.forEach(s => {
      (s.lines || []).forEach(line => {
        if (allPs[pIdx]) { setText(allPs[pIdx], line); pIdx++; }
      });
    });
  }

  // PEOPLE — rebuild the PEOPLE array from JSON, then re-render the grid
  if (file === 'stoud-people.html') {
    setText(document.querySelector('.title'), get('people.title'));
    const persons = get('people.persons');
    if (persons && window.__renderPeople) {
      window.__renderPeople(persons);
    }
  }

  // HOME — update the page meta if present
  if (file === 'stoud-home-v6.html') {
    // Home has no main body text to translate, just nav labels (handled above)
  }

})();
