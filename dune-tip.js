// ============================================================
//  dune-tip.js — infobulles au survol, dans le thème du site
//
//  Remplace l'attribut `title` natif du navigateur, qui est hors
//  thème et met 1 à 2 secondes à apparaître.
//
//  Usage : <script src="dune-tip.js" defer></script> puis remplacer
//          title="…" par data-tip="…" sur les éléments concernés.
//          (Depuis un sous-dossier : src="../dune-tip.js")
//
//  - Délégation d'événements sur le document → fonctionne aussi
//    pour les éléments créés dynamiquement (barres d'outils,
//    listes rendues en JS…).
//  - Les retours à la ligne (\n) sont conservés : plusieurs pages
//    s'en servent pour lister des sources ou des lieux de drop.
//  - Accessibilité : `title` servait aussi de nom accessible aux
//    boutons à icône. On reporte donc `data-tip` dans `aria-label`
//    quand l'élément n'a ni texte visible ni libellé propre.
// ============================================================

(function () {
  'use strict';

  var CSS =
    '#dune-tip{position:fixed;z-index:99999;pointer-events:none;' +
    'background:rgba(20,12,4,.96);border:1px solid #5c4025;color:#f5deb3;' +
    'font-family:sans-serif;font-size:12px;font-weight:bold;line-height:1.45;' +
    'padding:5px 9px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.7);' +
    'max-width:320px;white-space:pre-line;opacity:0;transition:opacity .08s linear}' +
    '#dune-tip.on{opacity:1}';

  var tip = null;

  function box() {
    if (!tip) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      tip = document.createElement('div');
      tip.id = 'dune-tip';
      document.body.appendChild(tip);
    }
    return tip;
  }

  // Nom accessible : sans `title`, un bouton à icône n'en aurait plus.
  function label(el) {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
    if ((el.textContent || '').trim() !== '') return;   // il a déjà un texte visible
    el.setAttribute('aria-label', el.getAttribute('data-tip'));
  }

  function place(el) {
    var t = box();
    var r = el.getBoundingClientRect();
    var w = t.offsetWidth, h = t.offsetHeight, m = 8;
    var top = r.top - h - m;                 // au-dessus par défaut…
    if (top < m) top = r.bottom + m;         // …en dessous s'il n'y a pas la place
    var left = r.left + r.width / 2 - w / 2; // centré, puis ramené dans l'écran
    left = Math.max(m, Math.min(left, window.innerWidth - w - m));
    t.style.left = Math.round(left) + 'px';
    t.style.top  = Math.round(top) + 'px';
  }

  function show(el) {
    var txt = el.getAttribute('data-tip');
    if (!txt) return;
    var t = box();
    t.textContent = txt;
    t.classList.add('on');
    label(el);
    place(el);
  }

  function hide() { if (tip) tip.classList.remove('on'); }

  function target(e) {
    var n = e.target;
    if (!n || !n.closest) return null;       // nœud texte / SVG ancien
    return n.closest('[data-tip]');
  }

  document.addEventListener('mouseover', function (e) { var el = target(e); if (el) show(el); });
  document.addEventListener('mouseout',  function (e) { if (target(e)) hide(); });
  // Un clic peut redessiner la zone survolée (ou déplacer la carte) → on masque.
  document.addEventListener('click', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  // Noms accessibles du balisage statique (les éléments créés en JS sont
  // traités au premier survol, cf. show()).
  function initLabels() {
    var els = document.querySelectorAll('[data-tip]');
    for (var i = 0; i < els.length; i++) label(els[i]);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLabels);
  } else {
    initLabels();
  }
})();
