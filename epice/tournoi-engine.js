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
    expert:        { label: 'Vétérans',       icon: '🔥' }  // clé `expert` conservée, libellé adouci
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

      // Exemption : dès qu'une case est vide pour de bon, le match n'aura jamais
      // lieu, même si l'autre joueur n'est pas encore connu. Le reconnaître tout de
      // suite (et non après le tour précédent) permet de masquer ces matchs dès le
      // départ — chez les perdants, un tour entier peut n'être fait que de ça.
      // Le vainqueur reste alors « inconnu » et se résoudra au calcul suivant :
      // l'arbre est recalculé de zéro à chaque fois.
      if (e.a === null || e.b === null) {
        e.statut = 'exempt';
        e.vainqueur = e.a === null ? e.b : e.a;
        e.perdant = null;
        return;
      }
      if (e.a === undefined || e.b === undefined) return;     // en attente
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

  // Tours du tableau des perdants qui contiennent au moins un vrai match. Avec un
  // effectif qui n'est pas une puissance de deux, des tours entiers ne sont faits
  // que d'exemptions : Challonge les fait disparaître et renumérote, on fait pareil
  // (sinon une colonne vide s'intercale et « tour 2 » devient le premier joué).
  function toursPerdants(res) {
    var tours = [];
    res.ordre.forEach(function (id) {
      var m = res.matchs[id];
      if (m.bracket === 'L' && m.statut !== 'exempt' && tours.indexOf(m.round) < 0) tours.push(m.round);
    });
    return tours.sort(function (a, b) { return a - b; });
  }

  function libelleTour(bracket, round, st, res) {
    if (bracket === 'GF') return round === 1 ? 'Grande finale' : 'Revanche';
    if (bracket === 'P')  return 'Petite finale';
    if (bracket === 'L') {
      var dernier = 2 * (st.k - 1);
      if (round === dernier) return 'Finale des perdants';
      var rang = res ? toursPerdants(res).indexOf(round) + 1 : round;
      return 'Perdants — tour ' + (rang || round);
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
    // Match d'exemption : on remonte au joueur qui le traverse.
    if (m && m.statut === 'exempt') {
      if (src.lose) return 'Exempt';
      return libelleSource(m.a === null ? m.src.b : m.src.a, res);
    }
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

  // =====================================================================
  //  POINTS ET SAISONS
  //
  //  Décisions de l'utilisateur (2026-10), après discussion avec les joueurs :
  //   - les points viennent de la PLACE FINALE, jamais des matchs gagnés : en
  //     double élimination, le rescapé des perdants gagne autant de matchs que le
  //     champion (Veteran : Neuroch 4 victoires = Fenros 4 victoires, 2ᵉ et 1ᵉʳ) ;
  //   - barème FIXE, les ex æquo prennent les points de leur rang ;
  //   - saisons de DEUX MOIS, par niveau ;
  //   - seuls les 3 MEILLEURS résultats d'un joueur comptent dans la saison :
  //     sinon on finit premier en étant simplement présent partout.
  //  Un vainqueur de tournoi peut donc ne pas mener la saison — c'est voulu, d'où
  //  les TITRES affichés à part et utilisés pour départager les égalités.
  // =====================================================================
  var BAREME = { 1: 5, 2: 4, 3: 3, 4: 2 };
  var POINTS_PARTICIPATION = 1;
  var MEILLEURS_RESULTATS = 3;
  var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function pointsDuRang(rang) { return rang == null ? 0 : (BAREME[rang] != null ? BAREME[rang] : POINTS_PARTICIPATION); }

  // Identité d'un joueur d'un tournoi à l'autre : l'identifiant Discord quand on
  // l'a (il survit à un changement de pseudo), sinon le nom sans casse ni accents.
  function sansAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function cleJoueur(j) { return j && j.discord_id ? 'd:' + j.discord_id : 'n:' + sansAccents(j && j.nom); }

  // Points de chaque joueur d'un tournoi TERMINÉ. Un ajustement d'organisateur
  // (t.ajustements[idJoueur] = {points, raison}) remplace le calcul, qui reste
  // fourni (`auto`) pour l'afficher au survol : une correction se voit toujours.
  function pointsTournoi(t, res) {
    res = res || resoudre(t);
    if (!res.termine) return [];
    var aj = t.ajustements || {};
    return classement(t, res).map(function (c) {
      var j = res.joueurs.filter(function (x) { return x.id === c.id; })[0];
      var auto = pointsDuRang(c.rang), a = aj[c.id];
      var ajuste = !!a && a.points != null;
      return { id: c.id, cle: cleJoueur(j), nom: c.nom, rang: c.rang, auto: auto,
               points: ajuste ? a.points : auto, ajuste: ajuste, raison: ajuste ? (a.raison || '') : '' };
    });
  }

  // Saisons de deux mois commençant les mois PAIRS : oct.–nov., déc.–janv.,
  // févr.–mars… Calées ainsi pour que la première démarre au lancement des
  // tournois (octobre 2026) au lieu de s'arrêter quatre semaines plus tard, ce
  // qu'aurait donné le découpage janv.–févr. / … / sept.–oct.
  // L'appartenance se lit sur la DATE DU TOURNOI, pas sur sa création : un tournoi
  // préparé fin novembre pour le 2 décembre compte dans la saison de décembre.
  // déc.–janv. est à cheval sur deux années : elle prend l'année de décembre.
  function saisonDe(date) {
    var m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date || '');
    if (!m) return null;
    var an = +m[1], mois = +m[2];                     // 1..12
    var debut = mois % 2 === 0 ? mois : mois - 1;      // mois pair de départ
    if (debut === 0) { debut = 12; an--; }             // janvier → saison de décembre
    var finAn = debut === 12 ? an + 1 : an, finMois = debut === 12 ? 1 : debut + 1;
    var fin = new Date(Date.UTC(finAn, finMois, 0));    // dernier jour du 2ᵉ mois
    return {
      id: an + '-' + String(debut).padStart(2, '0'),
      label: MOIS_COURTS[debut - 1] + (finAn !== an ? ' ' + an : '') + '–' + MOIS_COURTS[finMois - 1] + ' ' + finAn,
      debut: an + '-' + String(debut).padStart(2, '0') + '-01',
      fin: fin.toISOString().slice(0, 10)
    };
  }

  // Classement d'une saison pour UN niveau (on ne mélange jamais les niveaux : un
  // podium chez les débutants ne vaut pas un podium chez les vétérans).
  // `tournois` : tournois complets (joueurs, résultats, format…), tous niveaux.
  function classementSaison(tournois, saisonId, niveau, meilleurs) {
    meilleurs = meilleurs || MEILLEURS_RESULTATS;
    var parCle = {};
    tournois.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
      if (t.statut !== 'termine' || t.niveau !== niveau) return;
      var s = saisonDe(t.date);
      if (!s || s.id !== saisonId) return;
      pointsTournoi(t).forEach(function (p) {
        var r = parCle[p.cle] || (parCle[p.cle] = { cle: p.cle, nom: p.nom, resultats: [], titres: 0, podiums: 0 });
        r.nom = p.nom;      // le nom le plus récent l'emporte (tournois parcourus par date croissante)
        r.resultats.push({ tournoi: t.id, nomTournoi: t.nom, date: t.date, rang: p.rang, points: p.points, ajuste: p.ajuste });
        if (p.rang === 1) r.titres++;
        if (p.rang != null && p.rang <= 3) r.podiums++;
      });
    });
    var lignes = Object.keys(parCle).map(function (k) {
      var r = parCle[k];
      // Les meilleurs résultats d'abord ; à points égaux, le plus récent est gardé.
      var tri = r.resultats.slice().sort(function (a, b) { return (b.points - a.points) || (a.date < b.date ? 1 : -1); });
      tri.forEach(function (x, i) { x.compte = i < meilleurs; });
      r.points = tri.filter(function (x) { return x.compte; }).reduce(function (s, x) { return s + x.points; }, 0);
      r.resultats.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      return r;
    });
    // Départage : points, puis titres, puis podiums. Au-delà, rang partagé —
    // comme pour les ex æquo d'un tournoi, on n'invente pas d'ordre.
    lignes.sort(function (a, b) { return (b.points - a.points) || (b.titres - a.titres) || (b.podiums - a.podiums) || a.nom.localeCompare(b.nom); });
    lignes.forEach(function (r, i) {
      var p = lignes[i - 1];
      r.rang = p && p.points === r.points && p.titres === r.titres && p.podiums === r.podiums ? p.rang : i + 1;
    });
    return lignes;
  }

  // Saisons où au moins un tournoi est terminé, plus la saison du jour : la
  // saison en cours apparaît même vide, pour qu'on sache qu'elle a commencé.
  function saisons(tournois, aujourdhui) {
    var vus = {}, out = [];
    function ajoute(s) { if (s && !vus[s.id]) { vus[s.id] = true; out.push(s); } }
    ajoute(saisonDe(aujourdhui));
    tournois.forEach(function (t) { if (t.statut === 'termine') ajoute(saisonDe(t.date)); });
    return out.sort(function (a, b) { return a.debut < b.debut ? 1 : -1; });
  }

  // Conseil de montée de niveau, au survol. Les joueurs CHOISISSENT leur niveau :
  // ceci n'est qu'un avis, toujours positif — on dit « tu peux tenter plus haut »,
  // jamais « redescends ». Lu sur les 3 derniers tournois du joueur À CE NIVEAU,
  // toutes saisons confondues (une saison qui commence n'efface pas la forme).
  var NIVEAU_SUIVANT = { debutant: 'intermediaire', intermediaire: 'expert' };
  function conseilMontee(tournois, cle, niveau) {
    var suivant = NIVEAU_SUIVANT[niveau];
    if (!suivant) return null;
    var derniers = [];
    tournois.filter(function (t) { return t.statut === 'termine' && t.niveau === niveau && t.date; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
      .forEach(function (t) {
        if (derniers.length >= 3) return;
        var p = pointsTournoi(t).filter(function (x) { return x.cle === cle; })[0];
        if (p) derniers.push({ nom: t.nom, rang: p.rang });
      });
    var titres = derniers.filter(function (d) { return d.rang === 1; }).length;
    var podiums = derniers.filter(function (d) { return d.rang != null && d.rang <= 3; }).length;
    var detail = derniers.map(function (d) { return (d.rang === 1 ? '1ᵉʳ' : d.rang + 'ᵉ') + ' — ' + d.nom; }).join('\n');
    var cible = NIVEAUX[suivant].label;
    if (titres >= 1 || podiums >= 2) {
      return { niveau: 'pret', vers: suivant,
               texte: 'Prêt à tenter les ' + cible + ' : ' + (titres ? titres + ' victoire' + (titres > 1 ? 's' : '') : podiums + ' podiums')
                    + ' sur ses ' + derniers.length + ' derniers tournois ' + NIVEAUX[niveau].label + '.\n' + detail };
    }
    if (podiums === 1) {
      return { niveau: 'progression', vers: suivant,
               texte: 'En progression : 1 podium sur ses ' + derniers.length + ' derniers tournois ' + NIVEAUX[niveau].label
                    + '. Un deuxième, ou une victoire, et les ' + cible + ' lui tendent les bras.\n' + detail };
    }
    return null;
  }

  return {
    FORMATS: FORMATS, NIVEAUX: NIVEAUX,
    ordreTetes: ordreTetes, structure: structure, resoudre: resoudre,
    classement: classement, podium: podium, libelleTour: libelleTour,
    libelleSource: libelleSource, aJouer: aJouer, resultatsValides: resultatsValides,
    toursPerdants: toursPerdants,
    BAREME: BAREME, POINTS_PARTICIPATION: POINTS_PARTICIPATION, MEILLEURS_RESULTATS: MEILLEURS_RESULTATS,
    pointsDuRang: pointsDuRang, cleJoueur: cleJoueur, pointsTournoi: pointsTournoi,
    saisonDe: saisonDe, saisons: saisons, classementSaison: classementSaison, conseilMontee: conseilMontee
  };
});
