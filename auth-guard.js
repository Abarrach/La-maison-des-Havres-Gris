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
    localStorage.removeItem("realRole");
    localStorage.removeItem("previewPlayer");
    window.location.replace(base + "index.html#login");
  }

  // 3. Aperçu "vue joueur" pour les admins : bascule la valeur de "role" LUE
  //    PARTOUT sur le site sur "user", sans toucher au vrai rôle serveur
  //    (conservé à part dans "realRole", resynchronisé en continu par
  //    checkSession). Comme tous les gardes du site (menu, page-guard,
  //    panneaux admin…) ne font que lire localStorage["role"], ce simple
  //    échange suffit à leur faire montrer exactement ce qu'un joueur voit,
  //    sans avoir à modifier chacun d'eux séparément.
  function isPreviewing() { return localStorage.getItem("previewPlayer") === "1"; }

  function togglePreview() {
    if (isPreviewing()) {
      localStorage.setItem("role", localStorage.getItem("realRole") || "user");
      localStorage.removeItem("previewPlayer");
    } else {
      localStorage.setItem("previewPlayer", "1");
      localStorage.setItem("role", "user");
    }
    location.reload();
  }

  function renderPreviewToggle() {
    if (localStorage.getItem("realRole") !== "admin") return;
    if (document.getElementById("preview-toggle-btn")) return;
    var previewing = isPreviewing();
    var btn = document.createElement("button");
    btn.id = "preview-toggle-btn";
    btn.type = "button";
    btn.textContent = previewing
      ? "🎭 Aperçu joueur actif — cliquer pour revenir admin"
      : "👁 Aperçu joueur";
    btn.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99999;"
      + "font-family:'Segoe UI',sans-serif;font-size:12px;font-weight:bold;"
      + "padding:8px 14px;border-radius:20px;cursor:pointer;"
      + "text-transform:uppercase;letter-spacing:.5px;"
      + (previewing
          ? "background:#a83b3b;color:#fff2e0;border:1px solid #ff8888;box-shadow:0 0 12px rgba(168,59,59,0.6);"
          : "background:rgba(10,5,2,0.9);color:#cda434;border:1px solid #7c5e2a;");
    btn.onclick = togglePreview;
    (document.body || document.documentElement).appendChild(btn);
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
        // Synchronise le VRAI rôle (l'admin dérivé de Discord a pu changer).
        // Le rôle AFFICHÉ ("role") n'est resynchronisé que hors aperçu joueur.
        if (res.role) {
          localStorage.setItem("realRole", res.role);
          if (!isPreviewing()) localStorage.setItem("role", res.role);
          renderPreviewToggle();
        }
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
