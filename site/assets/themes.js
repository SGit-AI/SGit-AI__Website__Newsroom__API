/* newsroom.sgit.ai: the theme, chosen and remembered (card 036).

   A CLASSIC SCRIPT, NOT A MODULE, NOT DEFERRED. It is the first thing in the nav block,
   which chrome.py puts at the top of <body> on every page, and it has to run before the
   first paint: a module is deferred by definition, so the page would paint Newsprint and
   then flip to the reader's theme, which is worse than offering no choice. The stylesheet
   that defines the themes (themes.css) is linked just before it, for the same reason.

   THE STORED VALUE IS A KEY FROM THE LIST BELOW, NEVER ANYTHING ELSE. localStorage is
   writable by anything that runs on this origin, so what comes back is checked against
   THEMES before it reaches the DOM; an unknown value is Newsprint rather than an
   attribute nobody declared.

   What is stored stays in this browser, like everything else the reader does here: it is
   one more key in local storage, next to the meter's, and it never leaves the device (the
   vault carries the reader's account between devices; the theme is a property of the
   screen in front of them, so it is not carried).

   With nothing stored, the operating system's preference decides between the two
   defaults: a system set to dark gets Night, anything else gets Newsprint. The first
   choice in the picker ends that: from then on the reader's word is the one kept. */
(function () {
  'use strict';
  var KEY = 'newsroom.theme';
  var LIGHT = 'newsprint', DARK = 'night';
  var THEMES = {
    newsprint: { label: 'Newsprint', note: 'Warm off-white, teal' },
    night:     { label: 'Night',     note: 'Dark, teal' },
    paper:     { label: 'Paper',     note: 'Warm cream, terracotta' },
    blueprint: { label: 'Blueprint', note: 'White, electric blue' },
    ember:     { label: 'Ember',     note: 'Dark, amber' }
  };
  var has = function (k) { return Object.prototype.hasOwnProperty.call(THEMES, k); };

  function stored() {
    try { var v = localStorage.getItem(KEY); return has(v) ? v : null; }
    catch (e) { return null; }          /* private browsing: no memory, still a colour */
  }
  function system() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT; }
    catch (e) { return LIGHT; }
  }
  function current() { return stored() || system(); }
  function apply(name) {
    document.documentElement.setAttribute('data-theme', name);
    return name;
  }
  function set(name) {
    if (!has(name)) return current();
    try { localStorage.setItem(KEY, name); } catch (e) { /* unremembered, still applied */ }
    apply(name);
    try { window.dispatchEvent(new CustomEvent('newsroom:theme-changed', { detail: { theme: name } })); } catch (e) {}
    return name;
  }

  window.__newsroomTheme = {
    themes: THEMES, key: KEY,
    get: current, stored: stored, set: set,
    applied: function () { return document.documentElement.getAttribute('data-theme'); }
  };
  apply(current());

  /* The system preference can change while the page is open (sunset, on a Mac). Follow it
     only while the reader has not chosen: a choice is theirs to change. */
  try {
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!stored()) { apply(system()); render(); } });
  } catch (e) {}

  /* ---------- the picker ----------
     chrome.py leaves <div class="theme-pick"></div> in the nav's tools cluster; this fills
     it once the DOM exists. Nothing else on the page depends on the control. */
  var pick = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    pick = pick || document.querySelector('.theme-pick');
    if (!pick) return;
    var now = current(), items = '';
    for (var k in THEMES) if (has(k)) {
      items += '<li><button type="button" data-theme="' + k + '" aria-current="' + (k === now) + '">' +
               '<span class="sw sw-' + k + '"></span><span>' + esc(THEMES[k].label) +
               '<span class="n">' + esc(THEMES[k].note) + '</span></span></button></li>';
    }
    pick.innerHTML = '<button type="button" aria-haspopup="true" aria-expanded="false" ' +
      'title="The theme: five to choose from, kept in this browser">' +
      '<span class="sw sw-' + now + '"></span><span class="name">' + esc(THEMES[now].label) + '</span>' +
      '<span class="caret" aria-hidden="true">&#9662;</span></button>' +
      '<ul role="menu" aria-label="Theme" hidden>' + items + '</ul>';
    var toggle = pick.firstChild, menu = pick.lastChild;
    var close = function () { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', function () {
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) { var cur = menu.querySelector('[aria-current="true"]'); if (cur) cur.focus(); }
    });
    var buttons = menu.querySelectorAll('[data-theme]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) { set(e.currentTarget.getAttribute('data-theme')); close(); render(); toggle = pick.firstChild; toggle.focus(); });
    }
    /* the keyboard: arrows move, Escape closes and returns focus, a click elsewhere closes */
    menu.addEventListener('keydown', function (e) {
      var list = [].slice.call(menu.querySelectorAll('[data-theme]')), i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Escape') { close(); toggle.focus(); }
    });
    document.addEventListener('click', function (e) { if (!pick.contains(e.target)) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
}());
