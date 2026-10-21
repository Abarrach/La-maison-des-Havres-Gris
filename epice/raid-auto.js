// Proposition d'organisation : place les inscrits disponibles dans une compo, en
// s'appuyant sur le poste qu'ils ont choisi pour CETTE sortie et sur ce qu'ils
// tiennent d'habitude. Le résultat est un BROUILLON que l'organisateur corrige —
// jamais une décision. D'où le journal : chaque affectation dit d'où elle vient.
//
// Règle de conduite du module : il ne comble JAMAIS un poste critique par défaut.
// S'il n'y a ni transporteur déclaré ni transporteur habituel dans le créneau, la
// case reste vide. Un outil qui promeut d'office un pilote au transporteur ferait
// passer un créneau intenable pour un créneau complet, ce qui est exactement
// l'inverse du service rendu.
(function (root) {
  'use strict';

  const DIRS = ['nord', 'sud', 'est', 'ouest'];
  // Postes Discord qui savent piloter un ornithoptère — cardinaux et patrouille s'y
  // puisent indifféremment, le métier se décide à l'affectation et non à l'inscription.
  const PILOTABLES = ['pilote_orni_cac', 'pilote_orni', 'orni_assaut', 'present', ''];

  const nom = v => typeof v === 'string' ? v.trim() : '';

  function proposer(compo, candidats, stats) {
    stats = stats || {};
    const tous = (candidats || []).map(c => ({ name: nom(c.name), poste: c.poste || '', statut: c.statut || 'present' }))
                                  .filter(c => c.name);
    // Un « peut-être » ne fonde pas une organisation : il est signalé à part, en renfort.
    const libres  = tous.filter(c => c.statut === 'present');
    const renforts = tous.filter(c => c.statut === 'maybe').map(c => c.name);

    const pris = new Set();
    const journal = { poste: [], habitude: [], defaut: [], manque: [], renforts };

    const exp     = (n, r) => (((stats[n] || {}).roles) || {})[r] || 0;
    const sorties = n => (stats[n] || {}).sorties || 0;
    const dispo   = () => libres.filter(c => !pris.has(c.name));

    // Choisit UNE personne pour un rôle, par ordre de légitimité décroissante :
    //   1. elle a déclaré ce poste sur Discord — son choix du jour prime sur tout ;
    //   2. elle tient ce rôle d'habitude — c'est là que sert l'historique ;
    //   3. remplissage, seulement si `remplir` (jamais pour un poste critique).
    // À légitimité égale, le plus expérimenté dans le rôle, puis le plus assidu, puis
    // l'ordre alphabétique — pour que deux exécutions donnent le même résultat.
    function prendre(role, postes, remplir) {
      const restants = dispo();
      let lot = restants.filter(c => postes.indexOf(c.poste) !== -1), origine = 'poste';
      if (!lot.length) { lot = restants.filter(c => exp(c.name, role) > 0); origine = 'habitude'; }
      if (!lot.length && remplir) { lot = restants; origine = 'defaut'; }
      if (!lot.length) return null;
      lot = lot.slice().sort((a, b) => exp(b.name, role) - exp(a.name, role)
                                    || sorties(b.name) - sorties(a.name)
                                    || a.name.localeCompare(b.name, 'fr'));
      const c = lot[0];
      pris.add(c.name);
      journal[origine].push({ nom: c.name, role: role, fois: exp(c.name, role) });
      return c;
    }

    // --- 1. Récolte : les deux postes qui décident de la viabilité d'un créneau ---
    const tr = prendre('transporteur', ['transporteur'], false);
    const mo = prendre('moissonneur',  ['moissonneur'],  false);
    compo.recolte[0].transporteur = tr ? tr.name : '';
    compo.recolte[0].moissonneur  = mo ? mo.name : '';
    if (!tr) journal.manque.push('transporteur');
    if (!mo) journal.manque.push('moissonneur');

    // --- 2. Base avancée : seulement si DEUX personnes l'ont choisie ---
    // Un constructeur seul n'est pas une base avancée, c'est un joueur isolé sur un
    // îlot rocheux. On n'active donc pas le bloc pour le remplir à moitié.
    if (dispo().filter(c => c.poste === 'base_avancee').length >= 2) {
      const cons = prendre('base_constructeur', ['base_avancee'], false);
      const bug  = prendre('base_buggy',        ['base_avancee'], false);
      compo.base_avancee.active       = true;
      compo.base_avancee.constructeur = cons ? cons.name : '';
      compo.base_avancee.buggy        = bug  ? bug.name  : '';
      // sous_fief reste FAUX : personne ne peut le deviner, et l'avertissement
      // « confirmer le sous-fief » est précisément là pour qu'on aille le demander.
    }

    // --- 3. Repérage : tous ceux qui ont choisi scout, sinon un habitué ---
    compo.recon.scouts = [];
    dispo().filter(c => c.poste === 'orni_scout').forEach(c => {
      pris.add(c.name);
      journal.poste.push({ nom: c.name, role: 'scout', fois: exp(c.name, 'scout') });
      compo.recon.scouts.push({ nom: c.name });
    });
    if (!compo.recon.scouts.length) {
      const sc = prendre('scout', [], false);
      if (sc) compo.recon.scouts.push({ nom: sc.name });
      else journal.manque.push('scout');
    }

    // --- 4. Défense rapprochée : quatre cardinaux, servis AVANT la patrouille ---
    const cardinaux = [];
    DIRS.forEach((k, i) => {
      const c = prendre('cardinal', PILOTABLES, true);
      compo.defense[0][k] = { nom: c ? c.name : '', faucon: false, passager: '',
                              cac: !!(c && c.poste === 'pilote_orni_cac'), assaut: false };
      if (c) cardinaux.push(c.name); else if (i < 4) journal.manque.push('cardinal ' + k);
    });
    // Au moins un cardinal en Assaut — c'est une règle, pas une option. Celui qui l'a
    // déjà tenu le plus souvent ; à défaut le premier placé, pour ne pas laisser
    // l'avertissement sur une compo qu'on vient de proposer.
    if (cardinaux.length) {
      const porteur = cardinaux.slice().sort((a, b) => exp(b, 'assaut') - exp(a, 'assaut'))[0];
      DIRS.forEach(k => { if (compo.defense[0][k].nom === porteur) compo.defense[0][k].assaut = true; });
    }

    // --- 5. Patrouille : tout le reste ---
    // Y compris un second moissonneur ou un volontaire base avancée non retenu : mieux
    // vaut une personne mal placée dans un brouillon que absente de l'organisation.
    const patrouille = dispo();
    patrouille.forEach(c => pris.add(c.name));
    compo.distance.pilotes = patrouille.length
      ? patrouille.map(c => ({ nom: c.name, faucon: false, passager: '', cac: c.poste === 'pilote_orni_cac' }))
      : [{ nom: '', faucon: false, passager: '', cac: false }];
    patrouille.forEach(c => journal.defaut.push({ nom: c.name, role: 'patrouille', fois: exp(c.name, 'patrouille') }));

    // --- 6. Patrouilleurs de la base avancée : deux membres de la patrouille ---
    if (compo.base_avancee.active) {
      const noms = patrouille.map(c => c.name);
      compo.base_avancee.patrouilleurs = [noms[0] || '', noms[1] || ''];
      if (noms.length < 2) journal.manque.push('patrouilleurs de la base avancée');
    }

    // --- 7. Commandement ---
    // Un chef ne s'improvise pas : on ne le propose que si quelqu'un a DÉJÀ tenu le
    // poste. Seuls CDR et CP ont un repli structurel (il faut bien que quelqu'un mène
    // l'escouade et la patrouille) ; le Chef de Sortie, lui, reste vide s'il n'y a
    // aucun précédent — le désigner au hasard serait pire que ne rien proposer.
    const meilleur = (liste, role) => {
      const avec = (liste || []).filter(n => n && exp(n, role) > 0);
      if (!avec.length) return '';
      return avec.slice().sort((a, b) => exp(b, role) - exp(a, role) || sorties(b) - sorties(a))[0];
    };
    // Cumuler deux commandements sur la même personne prive un groupe de son
    // interlocuteur : on ne le fait que s'il n'y a littéralement personne d'autre.
    const chefs = new Set();
    const designer = (liste, role, repli) => {
      const pool   = (liste || []).filter(Boolean);
      const autres = pool.filter(n => !chefs.has(n));
      const choix  = autres.length ? autres : pool;
      const n = meilleur(choix, role) || (choix.indexOf(repli) !== -1 ? repli : (choix[0] || ''));
      if (n) chefs.add(n);
      return n;
    };

    const places = Array.from(pris);
    const equipeBase = compo.base_avancee.active
      ? [compo.base_avancee.constructeur, compo.base_avancee.buggy].concat(compo.base_avancee.patrouilleurs || [])
      : [];
    const assaut = DIRS.map(k => compo.defense[0][k]).filter(d => d.assaut && d.nom)[0];
    const patrouilleNoms = patrouille.map(c => c.name);

    // Le Chef de Sortie passe en premier et sans repli : il porte la responsabilité de
    // la journée, le désigner au hasard serait pire que de laisser la case vide.
    compo.commandement.cs = meilleur(places, 'cs');
    if (compo.commandement.cs) chefs.add(compo.commandement.cs);
    compo.commandement.cdr = designer(cardinaux, 'cdr', assaut ? assaut.nom : '');
    compo.commandement.cp  = designer(patrouilleNoms, 'cp', patrouilleNoms[0] || '');
    compo.commandement.cb  = compo.base_avancee.active
      ? designer(equipeBase, 'cb', compo.base_avancee.constructeur)
      : '';
    if (!compo.commandement.cs) journal.manque.push('chef de sortie (aucun précédent)');

    compo.tactical_version = 2;
    return { compo: compo, journal: journal };
  }

  const api = { proposer: proposer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RaidAuto = api;
})(typeof window !== 'undefined' ? window : this);
