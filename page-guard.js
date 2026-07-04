/* =======================================================================
   Garde d'accès par page.

   Empêche un joueur d'accéder en direct (URL) à une page « pas active »
   (hidden) ou « en travaux » (wip). Les administrateurs ne sont jamais
   bloqués. L'état est défini depuis Mon Compte > Gestion des pages.

   Usage : après auth-guard.js, dans le <head> de la page :
     <script src="page-guard.js" data-page="map"></script>
   Pour une page dans un sous-dossier (ex. epice/) :
     <script src="../page-guard.js" data-page="debrief" data-root="../"></script>

   La clé data-page doit correspondre à une clé du registre pages.js.
======================================================================= */
(function () {
  var self = document.currentScript;
  var key  = self && self.dataset ? self.dataset.page : null;
  var root = (self && self.dataset && self.dataset.root) || '';
  if (!key) return;
  if (localStorage.getItem('role') === 'admin') return; // admin : accès total

  function block(icon, title, text) {
    var html = ''
      + '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'height:100vh;background:#0a0603;color:#cda434;font-family:\'Segoe UI\',sans-serif;gap:20px;text-align:center;padding:20px;">'
      + '<div style="font-size:2.5rem;">' + icon + '</div>'
      + '<div style="font-size:1.2rem;font-weight:600;text-transform:uppercase;letter-spacing:2px;">' + title + '</div>'
      + '<div style="color:#888;font-size:0.9rem;max-width:420px;">' + text + '</div>'
      + '<a href="' + root + 'menu.html" style="margin-top:10px;padding:10px 28px;background:linear-gradient(to bottom,#a67c33,#6b4a25);'
      + 'border:1px solid #d4a23b;border-radius:4px;color:#1a1007;font-weight:bold;'
      + 'text-decoration:none;text-transform:uppercase;font-size:12px;">← Retour au menu</a>'
      + '</div>';
    if (document.body) { document.body.innerHTML = html; }
    else { document.addEventListener('DOMContentLoaded', function () { document.body.innerHTML = html; }); }
  }

  fetch(root + 'save.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getSettings' })
  })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      var status = (s.pages && s.pages[key]) || 'open';
      if (status === 'open') return;

      // Exception nominative : un ou plusieurs joueurs peuvent recevoir l'accès
      // à une page « pas active »/« en travaux » sans changer son statut global
      // (accordé depuis Mon Compte > Gestion des pages).
      var allowed = (s.pages_access && s.pages_access[key]) || [];
      var me = (localStorage.getItem('user') || '').toLowerCase();
      if (me && allowed.some(function (u) { return String(u).toLowerCase() === me; })) return;

      if (status === 'wip') {
        block('🚧', 'Page en travaux', 'Cette section est en cours de préparation. Revenez bientôt.');
      } else {
        block('🔒', 'Accès restreint', 'Cette section est réservée aux administrateurs.');
      }
    })
    .catch(function () {
      // En cas d'erreur réseau, bloquer par sécurité
      window.location.replace(root + 'menu.html');
    });
})();
