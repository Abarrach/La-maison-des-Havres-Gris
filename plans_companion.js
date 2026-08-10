// plans_companion.js — Analyseur du collage brut de gaming.tools (onglets UNIQUES et AUGMENTATIONS).
// Conçu pour un Ctrl+A / Ctrl+C de la page entière : on ne demande AUCUNE sélection
// précise au joueur, l'outil trie. Toute ligne non reconnue est ignorée, jamais
// devinée — une ligne d'interface prise pour un objet polluerait le registre.
//
// Grammaire observée, par objet :
//     [<charges>]            ← nombre AVANT le nom ; absent = jamais appris
//     <Nom de l'objet>
//     T<n> - <type>[ - N objets]
//     [G<rang><charges?> …]  ← uniquement quand l'objet a des rangs
//
// Les lignes G énumèrent les rangs QUI EXISTENT pour cet objet (d'où 3 à 6 selon
// les cas), et le nombre collé juste après est le nombre de charges à ce rang.
// `G014` = rang 0, quatorze charges — le rang est toujours UN chiffre (0-5), donc
// la découpe est sans ambiguïté.

const RE_TYPE   = /^T([1-6])\s*[-–]\s*([a-zéèêà]+)(?:\s*[-–]\s*(\d+)\s+objets?)?$/i;
const RE_GRADE  = /^G([0-5])(\d*)$/;
const RE_NOMBRE = /^\d+$/;
const RE_TOTAUX = /^(\d+)\s*\/\s*(\d+)\s+(?:uniques?|augmentations?)\s+termin/i;
const RE_NIVEAUX= /^(\d+)\s*\/\s*(\d+)\s+niveaux?\s+de\s+qualit/i;

function parseCompanion(txt) {
  const lignes = String(txt).replace(/ /g, ' ').split(/\r?\n/).map(s => s.trim());

  const objets = [];
  let annonce = null;          // somme de contrôle imprimée par l'addon lui-même
  let candidatNom = null;      // dernière ligne « texte libre » vue
  let charges = null;          // nombre rencontré juste avant un nom
  let courant = null;          // objet en cours, tant qu'on peut lui ajouter des rangs

  for (const l of lignes) {
    if (!l) continue;

    let m = l.match(RE_TOTAUX);
    if (m) { annonce = { ...(annonce || {}), appris: +m[1], total: +m[2] }; candidatNom = null; charges = null; continue; }
    m = l.match(RE_NIVEAUX);
    if (m) { annonce = { ...(annonce || {}), niveauxAppris: +m[1], niveauxTotal: +m[2] }; candidatNom = null; charges = null; continue; }

    // Rang : se rattache à l'objet courant. Sa présence prouve qu'on était bien
    // sur un objet, ce qui protège d'un faux positif sur une ligne d'interface.
    m = l.match(RE_GRADE);
    if (m && courant) {
      courant.rangs.push({ rang: +m[1], charges: m[2] === '' ? null : +m[2] });
      continue;
    }

    // Ligne de type : elle CONFIRME que la ligne précédente était un nom d'objet.
    m = l.match(RE_TYPE);
    if (m && candidatNom) {
      courant = {
        nom: candidatNom,
        tier: +m[1],
        type: m[2].toLowerCase(),
        set: m[3] ? +m[3] : null,   // « - 5 objets » = ensemble d'armure, pas un objet craftable
        charges,                     // null = jamais appris ; 0 = appris, plus de charge
        rangs: [],
      };
      objets.push(courant);
      candidatNom = null; charges = null;
      continue;
    }

    // Nombre isolé. Deux sens possibles, que la POSITION distingue sans ambiguïté :
    //   · précédé d'une ligne de texte → compteur de section (« Produits en cuivre »
    //     puis « 17 ») : à jeter, sinon le premier objet de chaque section hérite du
    //     compte de la section et paraît possédé en 17 exemplaires ;
    //   · sinon → charges de l'objet qui suit, puisque les charges s'écrivent AVANT
    //     le nom.
    if (RE_NOMBRE.test(l)) {
      if (candidatNom !== null) { candidatNom = null; charges = null; }
      else                      { charges = +l; }
      courant = null;
      continue;
    }

    // Tout le reste est un nom POSSIBLE. Il ne deviendra un objet que si une ligne
    // de type suit immédiatement : c'est ce qui élimine menus, boutons et publicités
    // sans avoir à les lister.
    candidatNom = l;
    courant = null;
  }

  return { objets, annonce };
}

// ── Contrôle : l'analyse doit reproduire les totaux affichés par l'addon ──────
function verifier(r) {
  const craftables = r.objets.filter(o => !o.set);
  const total = craftables.length;
  // « terminé » = appris à tous les rangs existants ; pour un objet sans rang,
  // = appris tout court (charges non nulles).
  const termines = craftables.filter(o => o.rangs.length
    ? o.rangs.every(g => g.charges !== null)
    : o.charges !== null).length;
  const niveauxTotal = craftables.reduce((n, o) => n + (o.rangs.length || 1), 0);
  const niveauxAppris = craftables.reduce((n, o) => n + (o.rangs.length
    ? o.rangs.filter(g => g.charges !== null).length
    : (o.charges !== null ? 1 : 0)), 0);
  return { total, termines, niveauxTotal, niveauxAppris };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseCompanion, verifier };
