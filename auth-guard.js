/* =======================================================================
   Garde d'authentification.

   1. Vérif INSTANTANÉE côté client (localStorage) → redirection immédiate
      vers le login si aucune session locale (UX rapide, comme avant).
   2. Vérif SERVEUR via session_check.php : valide la session PHP et,
      pour les comptes Discord, revérifie périodiquement l'appartenance
      à la guilde. Si le membre a quitté la guilde (ou session expirée),
      on purge le localStorage et on renvoie au login — même si une
      session était encore "ouverte" côté navigateur.

   Le chemin de session_check.php est dérivé de l'emplacement de ce
   script, pour fonctionner à la racine comme dans un sous-dossier (epice/).
======================================================================= */
(function () {
  // 1. Garde client instantané
  if (!localStorage.getItem("user")) {
    window.location.replace("index.html#login");
    return;
  }

  // Base = dossier de auth-guard.js (gère racine et sous-dossiers)
  var base = "";
  try {
    var src = document.currentScript && document.currentScript.src;
    if (src) base = src.replace(/auth-guard\.js(\?.*)?$/, "");
  } catch (e) { /* noop */ }

  function toLogin() {
    localStorage.removeItem("user");
    localStorage.removeItem("role");
    window.location.replace(base + "index.html#login");
  }

  // 2. Validation serveur (revérif d'appartenance Discord côté PHP).
  //    Appelée au chargement PUIS toutes les 5 min (ping de maintien) : ça
  //    rafraîchit le fichier de session côté serveur tant qu'un onglet est
  //    ouvert (sinon le ramasse-miettes PHP purge la session après ~24 min
  //    d'inactivité, même avec un cookie persistant), et ça resserre la
  //    revérif d'appartenance à la guilde.
  function checkSession() {
    fetch(base + "session_check.php", { method: "POST", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || res.ok !== true) {
          // Session invalide / sortie de guilde → éjection
          toLogin();
          return;
        }
        // Synchronise le rôle (l'admin dérivé de Discord a pu changer)
        if (res.role) localStorage.setItem("role", res.role);
        if (res.user) localStorage.setItem("user", res.user);
      })
      .catch(function () {
        // Erreur réseau ponctuelle : on NE déconnecte PAS (évite d'éjecter
        // tout le monde sur un hoquet serveur). Le prochain ping retentera.
      });
  }

  checkSession();
  setInterval(checkSession, 5 * 60 * 1000); // ping de maintien toutes les 5 min
})();
