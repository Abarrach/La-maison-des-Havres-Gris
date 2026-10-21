/* =======================================================================
   Paris sur les tournois PvP — qui a gagné quoi, qui doit quoi au banquier.

   Module PUR (aucun DOM) : chargé par epice/tournois.html après
   tournoi-engine.js, et par Node pour le banc d'essai
   (node epice/tournoi-paris.test.cjs).

   Les Solaris sont de VRAIS Solaris du jeu : le site ne fait que tenir le
   carnet. Un pari compte dès qu'il est posé ; à la fin, le banquier (l'orga
   du tournoi) encaisse les pertes et verse les gains, d'après ce bilan.

   Calcul en CAGNOTTE PARTAGÉE (pari mutuel) : toutes les mises d'un pari
   forment la cagnotte, que les gagnants se partagent au prorata de leur mise.
   Le banquier ne gagne ni ne perd rien. Une cagnotte sans aucun gagnant (et
   les quelques Solaris d'arrondi) va aux LOTS du tournoi.

   Comme pour l'arbre, rien de ce bilan n'est stocké : seuls les paris bruts
   le sont, chacun avec l'affiche qu'il visait. Une correction de score en
   amont qui change l'affiche d'un match annule d'elle-même les paris posés
   sur l'ancienne affiche ; une correction du vainqueur retourne le bilan.

   Un pari : { id, qui, cible: 'vainqueur' | idMatch, choix: idJoueur,
               a, b (affiche visée, paris de match), mise, contre_soi }
   Les participants parient comme tout le monde, mais JAMAIS CONTRE EUX-MÊMES
   (personne ne doit avoir intérêt à perdre) : dans leur propre combat,
   seulement sur leur camp (eux en duel, leur équipe sinon). Le pari sur le
   vainqueur du tournoi reste libre. `contre_soi` est posé par le serveur : vrai si le pari viole cette
   règle. Recalculé à chaque lecture : un joueur changé d'équipe après coup
   voit son pari annulé s'il vise désormais l'équipe adverse. Rapprochement
   parieur ↔ joueur par compte Discord ou par nom, fait UNE fois, en PHP. Un
   simple booléen et non le camp du parieur : les membres voient les paris des
   autres sans leur nom, le camp aurait trahi qui avait parié.
======================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TournoiParis = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLAFOND = 10000;   // mise maximale par pari, en Solaris (même valeur dans tournois-api.php)
  // Partage des Solaris « aux lots » (cagnottes sans gagnant + arrondis) entre
  // les places du podium, en pourcentage. Choix de l'utilisateur, 2026-10.
  var REPARTITION_LOTS = { 1: 50, 2: 30, 3: 20 };

  var RAISONS = {
    contre_soi: 'pari contre son propre camp',
    joueur_retire: 'joueur retiré du tournoi',
    affiche: 'l\'affiche du match a changé',
    preparation: 'tournoi revenu en préparation',
    sans_match: 'ce match n\'a pas lieu'
  };

  function memeAffiche(p, m) {
    return (p.a === m.a && p.b === m.b) || (p.a === m.b && p.b === m.a);
  }

  // État d'une cagnotte : 'ouvert' (on peut parier), 'ferme' (combat lancé ou
  // tournoi lancé, résultat attendu), 'regle' (gagnant connu).
  // Un pari qui ne peut pas aboutir reçoit une raison d'annulation.
  function situer(p, t, res, verrous, ouvertures, maintenant) {
    // Ce qu'on peut désigner vainqueur : les PARTICIPANTS de l'arbre (joueurs en
    // duel, équipes en 2v2/3v3/4v4), tels que le moteur les a résolus.
    var ids = {};
    (res.joueurs || t.joueurs || []).forEach(function (j) { ids[j.id] = true; });

    if (p.cible === 'vainqueur') {
      if (p.contre_soi) return { annule: 'contre_soi' };
      if (!ids[p.choix]) return { annule: 'joueur_retire' };
      if (t.statut === 'preparation') return { etat: 'ouvert' };
      if (res.champion !== undefined) return { etat: 'regle', gagnant: res.champion };
      return { etat: 'ferme' };
    }

    if (t.statut === 'preparation') return { annule: 'preparation' };
    var m = res.matchs[p.cible];
    if (!m || m.statut === 'exempt' || m.statut === 'inutile') return { annule: 'sans_match' };
    if (m.a == null || m.b == null || !memeAffiche(p, m)) return { annule: 'affiche' };
    if (p.contre_soi) return { annule: 'contre_soi' };    // affiche déjà vérifiée identique
    if (m.statut === 'joue') return { etat: 'regle', gagnant: m.vainqueur };
    var v = verrous && verrous[p.cible];
    if (v && memeAffiche(v, m)) return { etat: 'ferme' };
    // Fenêtre de pari écoulée (2 min par défaut après que le combat est devenu prêt).
    var o = ouvertures && ouvertures[p.cible];
    if (o && memeAffiche(o, m) && maintenant >= o.fin) return { etat: 'ferme' };
    return { etat: 'ouvert', a: m.a, b: m.b };
  }

  // ---------------------------------------------------------------------
  //  BILAN : chaque pari situé, chaque cagnotte, le solde de chaque parieur.
  //  t : le tournoi ; res : TournoiEngine.resoudre(t) ;
  //  donnees : { paris: [...], verrous: { idMatch: {a, b} } }
  // ---------------------------------------------------------------------
  function bilan(t, res, donnees) {
    donnees = donnees || {};
    var verrous = donnees.verrous || {}, ouvertures = donnees.ouvertures || {};
    // Heure de référence (secondes epoch) : celle du serveur corrigée par la page,
    // sinon l'horloge locale.
    var maintenant = donnees.maintenant != null ? donnees.maintenant : Date.now() / 1000;
    var cagnottes = {}, soldes = {}, lots = 0;

    var paris = (donnees.paris || []).map(function (p) {
      var s = situer(p, t, res, verrous, ouvertures, maintenant);
      var o = {};
      for (var k in p) o[k] = p[k];
      o.mise = Math.max(0, Math.floor(+p.mise || 0));
      if (s.annule) { o.etat = 'annule'; o.raison = s.annule; o.gain = 0; o.net = 0; return o; }
      o.etat = s.etat === 'regle' ? (p.choix === s.gagnant ? 'gagne' : 'perdu') : 'en_jeu';
      var c = cagnottes[p.cible];
      if (!c) {
        c = cagnottes[p.cible] = { cible: p.cible, etat: s.etat, gagnant: s.gagnant, total: 0, nb: 0,
                                   parChoix: {}, versLots: 0 };
      }
      c.total += o.mise; c.nb++;
      var pc = c.parChoix[p.choix] || (c.parChoix[p.choix] = { montant: 0, nb: 0 });
      pc.montant += o.mise; pc.nb++;
      return o;
    });

    // Partage des cagnottes réglées. Arrondi à l'unité inférieure pour chaque
    // gagnant : le reste (quelques Solaris) part aux lots avec les cagnottes
    // orphelines, ainsi la banque tombe toujours juste.
    Object.keys(cagnottes).forEach(function (cible) {
      var c = cagnottes[cible];
      if (c.etat !== 'regle') return;
      var w = (c.parChoix[c.gagnant] || { montant: 0 }).montant;
      var verse = 0;
      paris.forEach(function (p) {
        if (p.cible !== cible || p.etat === 'annule') return;
        if (p.etat === 'gagne') {
          p.gain = w > 0 ? Math.floor(p.mise * c.total / w) : 0;
          verse += p.gain;
        } else p.gain = 0;
        p.net = p.gain - p.mise;
      });
      c.versLots = c.total - verse;
      lots += c.versLots;
    });

    paris.forEach(function (p) {
      if (p.etat === 'en_jeu') { p.gain = 0; p.net = 0; }
      var s = soldes[p.qui] || (soldes[p.qui] = { qui: p.qui, net: 0, enJeu: 0, nbParis: 0 });
      if (p.etat === 'annule') return;
      s.nbParis++;
      if (p.etat === 'en_jeu') s.enJeu += p.mise;
      else s.net += p.net;
    });

    return { paris: paris, cagnottes: cagnottes, soldes: soldes, lots: lots };
  }

  // Multiplicateur actuel d'un choix : ce que rapporterait 1 Solaris misé
  // dessus si la cagnotte s'arrêtait là (mise comprise). null si personne
  // n'a encore misé dessus.
  function cote(c, choix) {
    if (!c) return null;
    var pc = c.parChoix[choix];
    return pc && pc.montant > 0 ? c.total / pc.montant : null;
  }

  // Ce que rapporterait une mise posée MAINTENANT (la cagnotte grossit de la
  // mise elle-même). Sert à l'aperçu avant de valider. `ancien` = le pari que
  // le parieur a déjà dans cette cagnotte ({choix, mise}), qu'il remplacerait.
  function gainSimule(c, choix, mise, ancien) {
    mise = Math.max(0, Math.floor(+mise || 0));
    var total = (c ? c.total : 0) + mise, surChoix = (c && c.parChoix[choix] ? c.parChoix[choix].montant : 0) + mise;
    if (ancien) {
      total -= ancien.mise;
      if (ancien.choix === choix) surChoix -= ancien.mise;
    }
    return surChoix > 0 ? Math.floor(mise * total / surChoix) : 0;
  }

  // Répartition des lots des paris sur le podium (TournoiEngine.podium) :
  // [{rang, id, nom, part (%), montant}]. Les ex æquo d'une place (deux 3ᵉ en
  // simple élimination sans petite finale) se partagent sa part ; la part d'une
  // place vide (tournoi à deux) et les Solaris d'arrondi reviennent au
  // vainqueur : tout est distribué, la banque tombe juste.
  function repartirLots(lots, podium) {
    lots = Math.max(0, Math.floor(+lots || 0));
    podium = podium || [];
    var champions = podium.filter(function (p) { return p.rang === 1; });
    if (!champions.length) return [];
    var out = podium.filter(function (p) { return p.rang >= 1 && p.rang <= 3; })
      .map(function (p) { return { rang: p.rang, id: p.id, nom: p.nom, part: 0, montant: 0 }; });
    var orphelin = 0;
    [1, 2, 3].forEach(function (r) {
      var qui = out.filter(function (p) { return p.rang === r; });
      if (!qui.length) { orphelin += REPARTITION_LOTS[r]; return; }
      qui.forEach(function (p) { p.part = REPARTITION_LOTS[r] / qui.length; });
    });
    var parChamp = orphelin / champions.length;
    out.forEach(function (p) { if (p.rang === 1) p.part += parChamp; });
    var distribue = 0;
    out.forEach(function (p) { p.montant = Math.floor(lots * p.part / 100); distribue += p.montant; });
    var reste = lots - distribue;
    for (var i = 0; reste > 0; i = (i + 1) % out.length) {
      if (out[i].rang === 1) { out[i].montant++; reste--; }
    }
    return out;
  }

  return { PLAFOND: PLAFOND, REPARTITION_LOTS: REPARTITION_LOTS, RAISONS: RAISONS, situer: situer, bilan: bilan,
           cote: cote, gainSimule: gainSimule, repartirLots: repartirLots };
});
