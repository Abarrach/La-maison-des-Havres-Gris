/* =======================================================================
   Moteur des tournois PvP — arbre, propagation des résultats, classement.

   Module PUR (aucun DOM) : chargé par epice/tournois.html, et par Node pour
   le banc d'essai (node epice/tournoi-engine.test.cjs).

   ⚠ C'EST LE SEUL ENDROIT où l'arbre est calculé. Le serveur
   (tournois-api.php) ne recalcule rien : il stocke les résultats bruts et le
   classement que la page lui envoie après chaque saisie. Pas de miroir PHP —
   le découpage des rallys a montré ce que coûtent deux implémentations à
   garder d'accord (cf. AGENTS.md, creneaux_parite).

   Principe : l'ARBRE ne se stocke pas. Il se déduit du nombre de joueurs, du
   format et des options. Seuls les résultats sont stockés, chacun avec les
   deux joueurs qu'il opposait : si une correction en amont change l'affiche
   d'un match, son ancien résultat ne correspond plus et tombe tout seul.
   Aucun « effacement en cascade » à écrire, donc aucun à rater.

   Valeur d'une case : identifiant de joueur | null (exempt, « BYE ») |
   undefined (pas encore connu).
======================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TournoiEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMATS = {
    double: 'Double élimination',
    simple: 'Simple élimination'
  };
  var NIVEAUX = {
    debutant:      { label: 'Débutants',      icon: '🌱' },
    intermediaire: { label: 'Intermédiaires', icon: '⚔️' },
    expert:        { label: 'Experts',        icon: '🔥' }
  };

  function puissance2(n) { var s = 1; while (s < n) s *= 2; return s; }

  // Placement standard des têtes de série : 1-8, 4-5, 2-7, 3-6 pour huit.
  // Les deux meilleures ne peuvent se croiser qu'en finale, et les exemptions
  // (têtes de série au-delà du nombre de joueurs) tombent sur les mieux classés.
  function ordreTetes(S) {
    var o = [1];
    while (o.length < S) {
      var m = o.length * 2, n = [];
      for (var i = 0; i < o.length; i++) { n.push(o[i]); n.push(m + 1 - o[i]); }
      o = n;
    }
    return o;
  }

  // ---------------------------------------------------------------------
  //  STRUCTURE : la liste des matchs et l'origine de chaque case.
  //  Origine : {seed:k} | {win:id} | {lose:id} | {same:id, side:'a'|'b'}
  // ---------------------------------------------------------------------
  function structure(n, format, options) {
    options = options || {};
    var S = Math.max(2, puissance2(n)), k = Math.round(Math.log(S) / Math.LN2);
    var matchs = [], parId = {};
    function ajoute(m) { matchs.push(m); parId[m.id] = m; }
    var ordre = ordreTetes(S), r, i, cnt;

    // Tableau principal (gagnants)
    for (r = 1; r <= k; r++) {
      cnt = S / Math.pow(2, r);
      for (i = 1; i <= cnt; i++) {
        ajoute({
          id: 'W' + r + '-' + i, bracket: 'W', round: r, index: i,
          a: r === 1 ? { seed: ordre[2 * (i - 1)] }     : { win: 'W' + (r - 1) + '-' + (2 * i - 1) },
          b: r === 1 ? { seed: ordre[2 * (i - 1) + 1] } : { win: 'W' + (r - 1) + '-' + (2 * i) }
        });
      }
    }

    if (format === 'double') {
      var champPerdants;
      if (k >= 2) {
        // Perdants, tour 1 : les battus du premier tour s'affrontent entre eux.
        cnt = S / 4;
        for (i = 1; i <= cnt; i++) {
          ajoute({ id: 'L1-' + i, bracket: 'L', round: 1, index: i,
                   a: { lose: 'W1-' + (2 * i - 1) }, b: { lose: 'W1-' + (2 * i) } });
        }
        for (var j = 1; j <= k - 1; j++) {
          // Tour « majeur » : les rescapés reçoivent les battus du tour j+1 du
          // tableau principal. Ordre inversé un tour sur deux, comme Challonge :
          // sinon deux joueurs déjà opposés au premier tour se retrouvent tout de suite.
          cnt = S / Math.pow(2, j + 1);
          for (i = 1; i <= cnt; i++) {
            ajoute({ id: 'L' + (2 * j) + '-' + i, bracket: 'L', round: 2 * j, index: i,
                     a: { win: 'L' + (2 * j - 1) + '-' + i },
                     b: { lose: 'W' + (j + 1) + '-' + (j % 2 === 1 ? cnt + 1 - i : i) } });
          }
          // Tour « mineur » : les rescapés entre eux.
          if (j < k - 1) {
            for (i = 1; i <= cnt / 2; i++) {
              ajoute({ id: 'L' + (2 * j + 1) + '-' + i, bracket: 'L', round: 2 * j + 1, index: i,
                       a: { win: 'L' + (2 * j) + '-' + (2 * i - 1) },
                       b: { win: 'L' + (2 * j) + '-' + (2 * i) } });
            }
          }
        }
        champPerdants = { win: 'L' + (2 * (k - 1)) + '-1' };
      } else {
        champPerdants = { lose: 'W1-1' }; // deux joueurs : la finale est une revanche
      }
      ajoute({ id: 'GF1', bracket: 'GF', round: 1, index: 1, a: { win: 'W' + k + '-1' }, b: champPerdants });
      // Revanche : le finaliste venu des perdants n'a encore qu'une défaite.
      // S'il gagne la grande finale, les deux joueurs sont à une défaite chacun.
      if (options.grandeFinale !== 'unique') {
        ajoute({ id: 'GF2', bracket: 'GF', round: 2, index: 1, cond: 'revanche',
                 a: { same: 'GF1', side: 'a' }, b: { same: 'GF1', side: 'b' } });
      }
    } else if (options.petiteFinale !== false && k >= 2) {
      ajoute({ id: 'P', bracket: 'P', round: 1, index: 1,
               a: { lose: 'W' + (k - 1) + '-1' }, b: { lose: 'W' + (k - 1) + '-2' } });
    }

    // Profondeur = ordre de jeu possible. Sert à numéroter les matchs comme on
    // les jouerait, et garantit qu'une source est résolue avant ses dépendants.
    var prof = {};
    function profondeur(m) {
      if (prof[m.id] != null) return prof[m.id];
      var d = 0;
      [m.a, m.b].forEach(function (s) {
        var src = s.win || s.lose || s.same;
        if (src) d = Math.max(d, profondeur(parId[src]));
      });
      return (prof[m.id] = d + 1);
    }
    var rangBracket = { W: 0, L: 1, P: 2, GF: 3 };
    matchs.forEach(profondeur);
    matchs.sort(function (x, y) {
      return (prof[x.id] - prof[y.id]) || (rangBracket[x.bracket] - rangBracket[y.bracket])
          || (x.round - y.round) || (x.index - y.index);
    });
    matchs.forEach(function (m) { m.depth = prof[m.id]; });

    return { taille: S, k: k, format: format === 'double' ? 'double' : 'simple', matchs: matchs, parId: parId };
  }

  // Joueurs triés par tête de série ; la position dans la liste fait foi
  // (un champ `seed` manquant ou en double ne casse rien).
  function joueursOrdonnes(t) {
    return (t.joueurs || []).slice().sort(function (a, b) {
      return ((a.seed || 1e9) - (b.seed || 1e9));
    });
  }

  // ---------------------------------------------------------------------
  //  RÉSOLUTION : qui joue chaque match, qui l'a gagné, ce qui reste à jouer.
  // ---------------------------------------------------------------------
  function resoudre(t) {
    var joueurs = joueursOrdonnes(t);
    var n = joueurs.length;
    var st = structure(n, t.format, t.options);
    var resultats = t.resultats || {};
    var etat = {}, num = 0;

    function valeur(src) {
      if (src.seed != null) return src.seed <= n ? joueurs[src.seed - 1].id : null;
      var m = etat[src.win || src.lose || src.same];
      if (src.win)  return m.vainqueur;
      if (src.lose) return m.perdant;
      return m[src.side];
    }

    st.matchs.forEach(function (m) {
      var e = { id: m.id, bracket: m.bracket, round: m.round, index: m.index, depth: m.depth,
                src: { a: m.a, b: m.b }, a: valeur(m.a), b: valeur(m.b),
                vainqueur: undefined, perdant: undefined, statut: 'attente' };
      etat[m.id] = e;

      if (m.cond === 'revanche') {
        var g = etat.GF1;
        if (g.statut !== 'joue') { e.a = undefined; e.b = undefined; return; }
        if (g.vainqueur === g.a) {           // le champion des gagnants l'a emporté
          e.statut = 'inutile'; e.vainqueur = g.vainqueur; e.perdant = g.perdant;
          return;
        }
      }

      if (e.a === undefined || e.b === undefined) return;     // en attente
      if (e.a === null || e.b === null) {                       // exemption
        e.statut = 'exempt';
        e.vainqueur = e.a === null ? e.b : e.a;
        e.perdant = null;
        return;
      }
      e.num = ++num;
      var r = resultats[m.id];
      if (r && ((r.p1 === e.a && r.p2 === e.b) || (r.p1 === e.b && r.p2 === e.a))
            && (r.w === e.a || r.w === e.b)) {
        var droit = r.p1 === e.a;
        e.statut = 'joue';
        e.vainqueur = r.w;
        e.perdant = r.w === e.a ? e.b : e.a;
        e.s1 = droit ? r.s1 : r.s2;
        e.s2 = droit ? r.s2 : r.s1;
        e.forfait = !!r.forfait;
      } else {
        e.statut = 'pret';
      }
    });

    // Numéros des matchs non encore affichables (attente) : on continue la
    // numérotation pour que « Perdant du match 7 » ait toujours un sens.
    st.matchs.forEach(function (m) {
      var e = etat[m.id];
      if (e.num == null && e.statut !== 'exempt' && e.statut !== 'inutile') e.num = ++num;
    });

    var finale = st.format === 'double' ? (etat.GF2 && etat.GF2.statut !== 'inutile' ? etat.GF2 : etat.GF1)
                                        : etat['W' + st.k + '-1'];
    var termine = !!finale && finale.statut === 'joue';
    if (termine && etat.GF2 && etat.GF2.statut === 'attente') termine = false;
    if (termine && etat.P && etat.P.statut !== 'joue' && etat.P.statut !== 'exempt') termine = false;

    return { structure: st, joueurs: joueurs, matchs: etat, ordre: st.matchs.map(function (m) { return m.id; }),
             champion: termine ? finale.vainqueur : undefined, termine: termine };
  }

  // ---------------------------------------------------------------------
  //  CLASSEMENT : rang final + bilan victoires/défaites.
  //  Les joueurs éliminés au même tour partagent leur rang (5ᵉ ex æquo…),
  //  comme sur Challonge : rien ne les départage, on n'invente pas d'ordre.
  // ---------------------------------------------------------------------
  function classement(t, res) {
    res = res || resoudre(t);
    var st = res.structure, k = st.k;
    var stats = {};
    res.joueurs.forEach(function (j) { stats[j.id] = { id: j.id, nom: j.nom, v: 0, d: 0, etape: undefined }; });

    res.ordre.forEach(function (id) {
      var m = res.matchs[id];
      if (m.statut !== 'joue') return;
      if (stats[m.vainqueur]) stats[m.vainqueur].v++;
      if (stats[m.perdant])   stats[m.perdant].d++;
      var p = stats[m.perdant];
      if (!p) return;
      if (st.format === 'double') {
        if (m.bracket === 'L') p.etape = m.round;
        else if (m.bracket === 'GF') {
          // Après la GF1, le battu n'est éliminé que s'il n'y a pas de revanche à jouer.
          var revanche = res.matchs.GF2;
          if (m.id === 'GF2' || !revanche || revanche.statut === 'inutile') p.etape = 1000;
        }
        // Une défaite dans le tableau principal n'élimine pas : on file chez les perdants.
      } else {
        if (m.bracket === 'W') p.etape = m.round;
        if (m.bracket === 'P') p.etape = k - 0.5;
      }
    });
    if (st.format === 'simple' && res.matchs.P && res.matchs.P.statut === 'joue') {
      stats[res.matchs.P.vainqueur].etape = k - 0.25;
    }
    if (res.champion !== undefined && stats[res.champion]) stats[res.champion].etape = Infinity;

    var liste = Object.keys(stats).map(function (id) { return stats[id]; });
    liste.forEach(function (s) {
      if (s.etape === undefined) { s.rang = null; return; }
      s.rang = 1 + liste.filter(function (o) { return o.etape !== undefined && o.etape > s.etape; }).length
                 + liste.filter(function (o) { return o.etape === undefined; }).length;
    });
    liste.sort(function (a, b) {
      if (a.rang == null && b.rang == null) return (b.v - a.v) || (a.d - b.d);
      if (a.rang == null) return -1;      // encore en lice : en tête
      if (b.rang == null) return 1;
      return a.rang - b.rang || (b.v - a.v);
    });
    return liste;
  }

  // Podium (trois premières places) prêt à stocker et à publier.
  function podium(t, res) {
    res = res || resoudre(t);
    if (!res.termine) return [];
    return classement(t, res).filter(function (s) { return s.rang != null && s.rang <= 3; })
      .map(function (s) { return { rang: s.rang, id: s.id, nom: s.nom, v: s.v, d: s.d }; });
  }

  function libelleTour(bracket, round, st) {
    if (bracket === 'GF') return round === 1 ? 'Grande finale' : 'Revanche';
    if (bracket === 'P')  return 'Petite finale';
    if (bracket === 'L') {
      var dernier = 2 * (st.k - 1);
      return round === dernier ? 'Finale des perdants' : 'Perdants — tour ' + round;
    }
    var d = st.k - round;
    if (d === 0) return st.format === 'double' ? 'Finale des gagnants' : 'Finale';
    if (d === 1) return 'Demi-finales';
    if (d === 2) return 'Quarts de finale';
    return 'Tour ' + round;
  }

  // Texte d'une case encore vide : « Vainqueur du match 7 ».
  function libelleSource(src, res) {
    if (!src) return '';
    if (src.seed != null) return 'Exempt';
    var m = res.matchs[src.win || src.lose || src.same];
    if (!m || m.num == null) return src.lose ? 'Exempt' : '—';
    if (src.win)  return 'Vainqueur du match ' + m.num;
    if (src.lose) return 'Perdant du match ' + m.num;
    return src.side === 'a' ? 'Finaliste des gagnants' : 'Finaliste des perdants';
  }

  // Matchs jouables maintenant (pour les annonces et le bandeau « à jouer »).
  function aJouer(res) {
    return res.ordre.map(function (id) { return res.matchs[id]; })
      .filter(function (m) { return m.statut === 'pret'; });
  }

  // Résultats encore valides : sert à purger les orphelins avant sauvegarde,
  // pour que le fichier ne garde pas la trace de matchs qui n'existent plus.
  function resultatsValides(t, res) {
    res = res || resoudre(t);
    var out = {};
    Object.keys(t.resultats || {}).forEach(function (id) {
      var m = res.matchs[id];
      if (m && m.statut === 'joue') out[id] = t.resultats[id];
    });
    return out;
  }

  return {
    FORMATS: FORMATS, NIVEAUX: NIVEAUX,
    ordreTetes: ordreTetes, structure: structure, resoudre: resoudre,
    classement: classement, podium: podium, libelleTour: libelleTour,
    libelleSource: libelleSource, aJouer: aJouer, resultatsValides: resultatsValides
  };
});
