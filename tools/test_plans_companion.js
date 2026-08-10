#!/usr/bin/env node
/**
 * test_plans_companion.js — Banc d'essai de l'analyseur de collage gaming.tools.
 *
 * Pourquoi un test et pas un simple coup d'œil : le collage vient d'un Ctrl+A sur une
 * page entière, donc du bruit d'interface, des publicités et des compteurs de section
 * traversent l'analyse. Chacun de ces cas a DÉJÀ produit un faux positif pendant
 * l'écriture — notamment le compteur de section pris pour des charges, qui faisait
 * croire que le premier objet de chaque tier était possédé en 17, 90 ou 118 exemplaires.
 *
 * Usage : node tools/test_plans_companion.js
 */
const { parseCompanion } = require('../plans_companion.js');

let echecs = 0;
function verifie(intitule, obtenu, attendu) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) { echecs++; console.log('  ÉCHEC  ' + intitule + '\n         obtenu  : ' + JSON.stringify(obtenu) + '\n         attendu : ' + JSON.stringify(attendu)); }
  else console.log('  ok     ' + intitule);
}

const COLLAGE = `gaming.tools
JEUX
DUNE
Passer à Premium
TABLEAU DE BORD
UNIQUES
Recettes uniques

157 / 366 uniques terminés

275 / 811 niveaux de qualité appris

Rechercher des pièces uniques
Tous les rangs
Ordre par défaut
Produits en cuivre
17

Bottes d'Aren

T1 - armor


0
Jolitre Hajra Mk 1

T1 - utility


1
Ailes de l'Empereur Mk 1

T1 - utility

Produits en duraluminium
90

Armure complète du Bene Gesserit

T5 - armor - 5 objets


2
Bottes achéroniennes

T5 - armor

Produits en plastanium
118


Chacun Son Aiguille

T6 - weapons

G03
G1
G2
G3
G4
G5


Casque d'analyse renforcée

T6 - armor

G014
G11
G2
G3
G4
G5


Guerre d'Antan

T6 - weapons

G09
G11
G20
G3
G41
G5
Supprimer les publicités`;

const r = parseCompanion(COLLAGE);
const par = {};
r.objets.forEach(o => { par[o.nom] = o; });

console.log('Analyseur de collage gaming.tools');

verifie('somme de contrôle lue dans le collage', r.annonce,
  { appris: 157, total: 366, niveauxAppris: 275, niveauxTotal: 811 });

// 8 objets réels dans le collage ci-dessus ; tout le reste (menus, boutons, titres,
// « Supprimer les publicités », en-têtes de section) doit être écarté.
verifie('le bruit d\'interface ne devient pas un objet', r.objets.length, 8);

// Le défaut qui a motivé ce banc d'essai : « Produits en cuivre / 17 » puis un objet.
verifie('compteur de section non pris pour des charges', par["Bottes d'Aren"].charges, null);
verifie('idem sur le tier duraluminium (90)', par['Armure complète du Bene Gesserit'].charges, null);
verifie('idem sur le tier plastanium (118)', par['Chacun Son Aiguille'].charges, null);

// Distinction essentielle pour le registre : « jamais appris » ≠ « appris, plus de charge ».
verifie('jamais appris → charges null', par["Bottes d'Aren"].charges, null);
verifie('appris sans charge → 0, pas null', par['Jolitre Hajra Mk 1'].charges, 0);
verifie('appris avec charge', par["Ailes de l'Empereur Mk 1"].charges, 1);

verifie('ensemble d\'armure marqué non craftable', par['Armure complète du Bene Gesserit'].set, 5);
verifie('objet ordinaire sans marque d\'ensemble', par['Bottes achéroniennes'].set, null);

// Découpe rang/charges : le rang est UN chiffre, le reste est le nombre de charges.
verifie('G03 → rang 0, 3 charges', par['Chacun Son Aiguille'].rangs[0], { rang: 0, charges: 3 });
verifie('rangs non appris → charges null', par['Chacun Son Aiguille'].rangs[1], { rang: 1, charges: null });
verifie('G014 → rang 0, 14 charges (pas rang 0 puis 1, puis 4)', par['Casque d\'analyse renforcée'].rangs[0], { rang: 0, charges: 14 });
verifie('G20 → rang 2, 0 charge (appris, épuisé)', par["Guerre d'Antan"].rangs[2], { rang: 2, charges: 0 });
verifie('les 6 rangs sont conservés', par["Guerre d'Antan"].rangs.length, 6);

console.log(echecs ? `\n${echecs} échec(s).` : '\nTout passe.');
process.exit(echecs ? 1 : 0);
