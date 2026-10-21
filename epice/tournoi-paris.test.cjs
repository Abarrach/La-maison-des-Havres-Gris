// Banc d'essai des paris de tournoi : node epice/tournoi-paris.test.cjs
const assert = require('assert');
const E = require('./tournoi-engine.js');
const P = require('./tournoi-paris.js');

let ok = 0;
function test(nom, fn) {
  try { fn(); ok++; }
  catch (e) { console.error('✖ ' + nom + '\n  ' + e.message); process.exitCode = 1; }
}

function tournoi(n, format) {
  return { format: format || 'simple', options: { petiteFinale: false }, statut: 'en_cours', resultats: {},
           joueurs: Array.from({ length: n }, (_, i) => ({ id: 'j' + (i + 1), nom: 'J' + (i + 1), seed: i + 1 })) };
}
function joue(t, mid, w) {
  const m = E.resoudre(t).matchs[mid];
  t.resultats[mid] = { p1: m.a, p2: m.b, w, s1: null, s2: null };
}
let nid = 0;
function pari(qui, cible, choix, mise, t, extra) {
  const p = { id: 'p' + (++nid), qui, cible, choix, mise, contre_soi: false };
  if (cible !== 'vainqueur') { const m = E.resoudre(t).matchs[cible]; p.a = m.a; p.b = m.b; }
  return Object.assign(p, extra || {});
}
// La banque doit toujours tomber juste : pertes encaissées = gains versés + lots.
function equilibre(b) {
  const somme = Object.values(b.soldes).reduce((s, x) => s + x.net, 0);
  assert.strictEqual(somme + b.lots, 0, 'banque déséquilibrée : soldes ' + somme + ', lots ' + b.lots);
}

test('cagnotte partagée au prorata des mises', () => {
  const t = tournoi(4);                           // W1-1 : j1 contre j4
  const paris = [pari('A', 'W1-1', 'j1', 1000, t), pari('B', 'W1-1', 'j1', 3000, t), pari('C', 'W1-1', 'j4', 4000, t)];
  joue(t, 'W1-1', 'j1');
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.cagnottes['W1-1'].total, 8000);
  assert.strictEqual(b.soldes.A.net, 1000);       // 1000 × 8000 / 4000 = 2000, net +1000
  assert.strictEqual(b.soldes.B.net, 3000);
  assert.strictEqual(b.soldes.C.net, -4000);
  assert.strictEqual(b.lots, 0);
  equilibre(b);
});

test('cagnotte sans gagnant : elle va aux lots', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j4', 2000, t), pari('B', 'W1-1', 'j4', 500, t)];
  joue(t, 'W1-1', 'j1');
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.lots, 2500);
  assert.strictEqual(b.soldes.A.net, -2000);
  equilibre(b);
});

test('arrondis : le reste part aux lots, la banque tombe juste', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 1, t), pari('B', 'W1-1', 'j1', 1, t), pari('C', 'W1-1', 'j1', 1, t), pari('D', 'W1-1', 'j4', 1, t)];
  joue(t, 'W1-1', 'j1');
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.soldes.A.net, 0);          // floor(1 × 4 / 3) = 1
  assert.strictEqual(b.lots, 1);
  equilibre(b);
});

test('tout le monde sur le même joueur : chacun récupère sa mise', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 700, t), pari('B', 'W1-1', 'j1', 300, t)];
  joue(t, 'W1-1', 'j1');
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.soldes.A.net, 0);
  assert.strictEqual(b.soldes.B.net, 0);
  equilibre(b);
});

test('match pas encore joué : mise en jeu, ouvert puis fermé par « Combat lancé »', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 1000, t)];
  let b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.cagnottes['W1-1'].etat, 'ouvert');
  assert.strictEqual(b.soldes.A.enJeu, 1000);
  assert.strictEqual(b.soldes.A.net, 0);
  b = P.bilan(t, E.resoudre(t), { paris, verrous: { 'W1-1': { a: 'j4', b: 'j1' } } });
  assert.strictEqual(b.cagnottes['W1-1'].etat, 'ferme');
});

test('fenêtre de pari : ouverte avant la fin, fermée après, ignorée si l\'affiche a changé', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 1000, t)];
  const ouv = { 'W1-1': { a: 'j1', b: 'j4', le: 1000, fin: 1120 } };      // 2 min
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris, ouvertures: ouv, maintenant: 1119 }).cagnottes['W1-1'].etat, 'ouvert');
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris, ouvertures: ouv, maintenant: 1120 }).cagnottes['W1-1'].etat, 'ferme');
  const autre = { 'W1-1': { a: 'j2', b: 'j3', le: 1000, fin: 1120 } };    // fenêtre d'une ancienne affiche
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris, ouvertures: autre, maintenant: 5000 }).cagnottes['W1-1'].etat, 'ouvert');
});

test('correction en amont : les paris sur l\'ancienne affiche sont annulés', () => {
  const t = tournoi(4);                           // finale W2-1 : vainqueurs de W1-1 et W1-2
  joue(t, 'W1-1', 'j1'); joue(t, 'W1-2', 'j2');
  const paris = [pari('A', 'W2-1', 'j1', 1000, t), pari('B', 'W2-1', 'j2', 1000, t)];
  joue(t, 'W1-1', 'j4');                          // correction : j4 avait gagné
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.paris[0].etat, 'annule');
  assert.strictEqual(b.paris[0].raison, 'affiche');
  assert.strictEqual(b.paris[1].etat, 'annule');
  assert.ok(!b.cagnottes['W2-1']);
  equilibre(b);
});

test('correction du vainqueur d\'un match : le bilan se retourne', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 1000, t), pari('B', 'W1-1', 'j4', 1000, t)];
  joue(t, 'W1-1', 'j1');
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris }).soldes.A.net, 1000);
  joue(t, 'W1-1', 'j4');
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.soldes.A.net, -1000);
  assert.strictEqual(b.soldes.B.net, 1000);
});

test('un participant parie, mais jamais contre lui-même', () => {
  const t = tournoi(4);
  // contre_soi est posé par le serveur : vrai si, dans SON combat, le pari vise
  // le camp adverse. Le pari sur le vainqueur est libre (jamais contre_soi).
  const paris = [pari('J1', 'W1-1', 'j1', 1000, t, { contre_soi: false }),   // son match, sur lui : permis
                 pari('J4', 'W1-1', 'j1', 1000, t, { contre_soi: true }),    // son match, contre lui : refusé
                 pari('J1', 'W1-2', 'j2', 1000, t, { contre_soi: false }),   // le match d'à côté : permis
                 pari('J2', 'vainqueur', 'j1', 1000, t, { contre_soi: false })];  // vainqueur : libre
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.paris[0].etat, 'en_jeu');
  assert.strictEqual(b.paris[1].raison, 'contre_soi');
  assert.strictEqual(b.paris[2].etat, 'en_jeu');
  assert.strictEqual(b.paris[3].etat, 'en_jeu');
});

test('vainqueur final : ouvert en préparation, fermé au lancement, réglé au dernier match', () => {
  const t = tournoi(4); t.statut = 'preparation';
  const paris = [pari('A', 'vainqueur', 'j1', 2000, t), pari('B', 'vainqueur', 'j2', 1000, t),
                 pari('C', 'vainqueur', 'j3', 1000, t)];
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris }).cagnottes.vainqueur.etat, 'ouvert');
  t.statut = 'en_cours';
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris }).cagnottes.vainqueur.etat, 'ferme');
  joue(t, 'W1-1', 'j1'); joue(t, 'W1-2', 'j2'); joue(t, 'W2-1', 'j2');
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.cagnottes.vainqueur.etat, 'regle');
  assert.strictEqual(b.soldes.B.net, 3000);
  assert.strictEqual(b.soldes.A.net, -2000);
  equilibre(b);
});

test('vainqueur : un joueur retiré avant le lancement annule les paris sur lui', () => {
  const t = tournoi(4); t.statut = 'preparation';
  const paris = [pari('A', 'vainqueur', 'j4', 2000, t)];
  t.joueurs.pop();
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris }).paris[0].raison, 'joueur_retire');
});

test('retour en préparation : les paris de match sont annulés', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 1000, t)];
  t.statut = 'preparation';
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris }).paris[0].raison, 'preparation');
});

test('pari sur un match pas encore prêt (affiche devinée) : annulé, sans effet', () => {
  const t = tournoi(4);
  const paris = [{ id: 'x', qui: 'A', cible: 'W2-1', choix: 'j1', a: 'j1', b: 'j2', mise: 500, contre_soi: false }];
  const b = P.bilan(t, E.resoudre(t), { paris });
  assert.strictEqual(b.paris[0].etat, 'annule');
});

test('double élimination : revanche inutile → paris annulés', () => {
  const t = tournoi(4, 'double');
  t.options = { grandeFinale: 'revanche' };
  ['W1-1', 'W1-2'].forEach(m => joue(t, m, E.resoudre(t).matchs[m].a));
  joue(t, 'W2-1', 'j1');
  const r = E.resoudre(t);
  Object.keys(r.matchs).filter(id => id[0] === 'L').forEach(id => { if (E.resoudre(t).matchs[id].statut === 'pret') joue(t, id, E.resoudre(t).matchs[id].a); });
  const gf = E.resoudre(t).matchs.GF1;
  assert.strictEqual(gf.statut, 'pret');
  const paris = [{ id: 'x', qui: 'A', cible: 'GF2', choix: 'j1', a: gf.a, b: gf.b, mise: 500, contre_soi: false }];
  joue(t, 'GF1', 'j1');                           // le champion des gagnants l'emporte : pas de revanche
  assert.strictEqual(P.bilan(t, E.resoudre(t), { paris }).paris[0].raison, 'sans_match');
});

test('cote et gain simulé', () => {
  const t = tournoi(4);
  const paris = [pari('A', 'W1-1', 'j1', 1000, t), pari('B', 'W1-1', 'j4', 3000, t)];
  const c = P.bilan(t, E.resoudre(t), { paris }).cagnottes['W1-1'];
  assert.strictEqual(P.cote(c, 'j1'), 4);
  assert.strictEqual(P.cote(c, 'j4'), 4 / 3);
  assert.strictEqual(P.gainSimule(c, 'j1', 1000), 2500);                          // 1000 × 5000 / 2000
  assert.strictEqual(P.gainSimule(c, 'j4', 3000, { choix: 'j4', mise: 3000 }), 4000); // B ne change rien
  assert.strictEqual(P.gainSimule(c, 'j1', 3000, { choix: 'j4', mise: 3000 }), 3000); // B rejoint A sur j1 : plus personne en face
});

test('2 contre 2 : on parie sur des ÉQUIPES, matchs et vainqueur', () => {
  const t = tournoi(8);
  t.options = { equipe: 2, petiteFinale: false };
  t.equipes = [0, 1, 2, 3].map(i => ({ id: 'e' + (i + 1), nom: 'E' + (i + 1), membres: ['j' + (2 * i + 1), 'j' + (2 * i + 2)] }));
  t.statut = 'preparation';
  const pv = [pari('A', 'vainqueur', 'e2', 1000, t), pari('B', 'vainqueur', 'e3', 1000, t),
              pari('C', 'vainqueur', 'j1', 1000, t)];          // un JOUEUR n'est pas un participant
  let b = P.bilan(t, E.resoudre(t), { paris: pv });
  assert.strictEqual(b.paris[0].etat, 'en_jeu');
  assert.strictEqual(b.paris[2].raison, 'joueur_retire');
  t.statut = 'en_cours';
  const m = E.resoudre(t).matchs['W1-1'];
  assert.deepStrictEqual([m.a, m.b], ['e1', 'e4']);
  const pm = [pari('A', 'W1-1', 'e4', 500, t), pari('B', 'W1-1', 'e1', 1500, t)];
  joue(t, 'W1-1', 'e4');
  b = P.bilan(t, E.resoudre(t), { paris: pv.concat(pm) });
  assert.strictEqual(b.soldes.A.net, 1500);                 // 500 × 2000 / 500 − 500
  assert.strictEqual(b.soldes.B.net, -1500);
  equilibre(b);
});

const somme = r => r.reduce((s, p) => s + p.montant, 0);
const pod = rangs => rangs.map((r, i) => ({ rang: r, id: 'j' + (i + 1), nom: 'J' + (i + 1) }));

test('lots des paris : 50 / 30 / 20 sur le podium', () => {
  const r = P.repartirLots(6000, pod([1, 2, 3]));
  assert.deepStrictEqual(r.map(p => p.montant), [3000, 1800, 1200]);
});

test('lots : deux 3ᵉ ex æquo se partagent les 20 %', () => {
  const r = P.repartirLots(6000, pod([1, 2, 3, 3]));
  assert.deepStrictEqual(r.map(p => p.montant), [3000, 1800, 600, 600]);
});

test('lots : tournoi à deux, la part du 3ᵉ revient au vainqueur', () => {
  const r = P.repartirLots(1000, pod([1, 2]));
  assert.deepStrictEqual(r.map(p => p.montant), [700, 300]);
});

test('lots : les arrondis vont au vainqueur, tout est distribué', () => {
  const r = P.repartirLots(7, pod([1, 2, 3, 3]));
  assert.strictEqual(somme(r), 7);
  assert.strictEqual(r[0].montant, 5);             // 3 (50 %) + 2 Solaris d'arrondi
});

test('lots : rien à répartir sans podium', () => {
  assert.deepStrictEqual(P.repartirLots(500, []), []);
});

console.log(ok + ' tests OK' + (process.exitCode ? ' — ÉCHECS ci-dessus' : ''));
