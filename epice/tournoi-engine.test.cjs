// Banc d'essai du moteur de tournois : node epice/tournoi-engine.test.cjs
// Le cas de référence rejoue le tournoi « Veteran » organisé sur Challonge
// (8 joueurs, double élimination) et doit en retrouver le podium exact.
const assert = require('assert');
const E = require('./tournoi-engine.js');

let ok = 0;
function test(nom, fn) {
  try { fn(); ok++; }
  catch (e) { console.error('✖ ' + nom + '\n  ' + e.message); process.exitCode = 1; }
}

function tournoi(noms, format, options) {
  return { format, options: options || {}, resultats: {},
           joueurs: noms.map((nom, i) => ({ id: 'j' + (i + 1), nom, seed: i + 1 })) };
}
const idDe = (t, nom) => t.joueurs.find(j => j.nom === nom).id;
// Joue un match en désignant le vainqueur par son nom, en relisant l'affiche courante.
function joue(t, matchId, gagnant, s = [1, 0]) {
  const m = E.resoudre(t).matchs[matchId];
  assert.strictEqual(m.statut, 'pret', matchId + ' devrait être prêt (statut ' + m.statut + ')');
  const w = idDe(t, gagnant);
  assert.ok(w === m.a || w === m.b, gagnant + ' ne joue pas ' + matchId);
  t.resultats[matchId] = { p1: m.a, p2: m.b, w, s1: w === m.a ? s[0] : s[1], s2: w === m.a ? s[1] : s[0] };
}

test('placement des têtes de série', () => {
  assert.deepStrictEqual(E.ordreTetes(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepStrictEqual(E.ordreTetes(4), [1, 4, 2, 3]);
});

test('nombre de matchs en double élimination', () => {
  // 2N-1 matchs + revanche éventuelle (N = taille de l'arbre)
  assert.strictEqual(E.structure(8, 'double', {}).matchs.length, 15);
  assert.strictEqual(E.structure(8, 'double', { grandeFinale: 'unique' }).matchs.length, 14);
  assert.strictEqual(E.structure(16, 'double', {}).matchs.length, 31);
  assert.strictEqual(E.structure(8, 'simple', {}).matchs.length, 8);   // 7 + petite finale
});

test('tournoi Veteran (Challonge) : podium et bilans', () => {
  const t = tournoi(['Sarazin', 'LeFou', 'Neuroch', 'Bahlor', 'Hasashi', 'Fenros', 'Fenrir', 'Lorhelyne'], 'double');
  const r1 = E.resoudre(t);
  const affiche = id => [r1.matchs[id].a, r1.matchs[id].b].map(x => t.joueurs.find(j => j.id === x).nom);
  assert.deepStrictEqual(affiche('W1-1'), ['Sarazin', 'Lorhelyne']);
  assert.deepStrictEqual(affiche('W1-2'), ['Bahlor', 'Hasashi']);
  assert.deepStrictEqual(affiche('W1-3'), ['LeFou', 'Fenrir']);
  assert.deepStrictEqual(affiche('W1-4'), ['Neuroch', 'Fenros']);

  joue(t, 'W1-1', 'Sarazin'); joue(t, 'W1-2', 'Bahlor'); joue(t, 'W1-3', 'Fenrir'); joue(t, 'W1-4', 'Fenros');
  joue(t, 'W2-1', 'Bahlor');  joue(t, 'W2-2', 'Fenros');
  joue(t, 'L1-1', 'Lorhelyne'); joue(t, 'L1-2', 'Neuroch');
  // Croisement de Challonge : le battu du 2ᵉ match du tour 2 retrouve le haut des perdants.
  const r2 = E.resoudre(t);
  assert.strictEqual(r2.matchs['L2-1'].b, idDe(t, 'Fenrir'));
  assert.strictEqual(r2.matchs['L2-2'].b, idDe(t, 'Sarazin'));
  joue(t, 'L2-1', 'Fenrir'); joue(t, 'L2-2', 'Neuroch');
  joue(t, 'L3-1', 'Neuroch');
  joue(t, 'W3-1', 'Fenros');
  joue(t, 'L4-1', 'Neuroch');
  joue(t, 'GF1', 'Fenros', [2, 0]);

  const res = E.resoudre(t);
  assert.strictEqual(res.matchs.GF2.statut, 'inutile', 'pas de revanche quand le champion des gagnants gagne');
  assert.ok(res.termine);
  const pod = E.podium(t, res).map(p => [p.rang, p.nom, p.v + '-' + p.d]);
  assert.deepStrictEqual(pod, [[1, 'Fenros', '4-0'], [2, 'Neuroch', '4-2'], [3, 'Bahlor', '2-2']]);
  const cl = E.classement(t, res);
  const rang = nom => cl.find(c => c.nom === nom).rang;
  assert.strictEqual(rang('Fenrir'), 4);
  assert.strictEqual(rang('Sarazin'), 5); assert.strictEqual(rang('Lorhelyne'), 5);
  assert.strictEqual(rang('LeFou'), 7);   assert.strictEqual(rang('Hasashi'), 7);
});

test('tournoi des nouveaux (Challonge) : 6 joueurs, exemptions et tour vide chez les perdants', () => {
  const t = tournoi(['Shean', 'Haokun', 'Frya', 'Orcote', 'Merlin', 'Militarus'], 'double');
  let res = E.resoudre(t);
  // Le premier tour des perdants n'est fait que d'exemptions, et ça se sait AVANT de jouer.
  assert.strictEqual(res.matchs['L1-1'].statut, 'exempt');
  assert.strictEqual(res.matchs['L1-2'].statut, 'exempt');
  assert.deepStrictEqual(E.toursPerdants(res), [2, 3, 4]);
  assert.strictEqual(E.libelleTour('L', 2, res.structure, res), 'Perdants — tour 1');
  assert.strictEqual(E.libelleSource(res.matchs['L2-1'].src.a, res), 'Perdant du match ' + res.matchs['W1-2'].num);

  joue(t, 'W1-2', 'Merlin'); joue(t, 'W1-4', 'Militarus');
  joue(t, 'W2-1', 'Shean');  joue(t, 'W2-2', 'Militarus');
  res = E.resoudre(t);
  const affiche = id => [res.matchs[id].a, res.matchs[id].b].map(x => t.joueurs.find(j => j.id === x).nom).sort();
  // Mêmes affiches que la « Manche des perdants 1 » de Challonge.
  assert.deepStrictEqual(affiche('L2-1'), ['Haokun', 'Orcote']);
  assert.deepStrictEqual(affiche('L2-2'), ['Frya', 'Merlin']);
  joue(t, 'L2-1', 'Haokun'); joue(t, 'L2-2', 'Frya');
  joue(t, 'L3-1', 'Frya');
  joue(t, 'W3-1', 'Shean');
  joue(t, 'L4-1', 'Frya');
  joue(t, 'GF1', 'Shean');
  res = E.resoudre(t);
  assert.ok(res.termine);
  assert.deepStrictEqual(E.podium(t, res).map(p => [p.rang, p.nom, p.v + '-' + p.d]),
    [[1, 'Shean', '3-0'], [2, 'Frya', '3-2'], [3, 'Militarus', '2-2']]);
  const cl = E.classement(t, res), rang = nom => cl.find(c => c.nom === nom).rang;
  assert.strictEqual(rang('Haokun'), 4);
  assert.strictEqual(rang('Orcote'), 5); assert.strictEqual(rang('Merlin'), 5);
  // Challonge numérote 10 matchs joués : un tour passé sans adversaire n'en est pas un.
  assert.strictEqual(res.ordre.filter(id => res.matchs[id].statut === 'joue').length, 10);
});

test('revanche jouée quand le finaliste des perdants gagne la grande finale', () => {
  const t = tournoi(['A', 'B', 'C', 'D'], 'double');
  joue(t, 'W1-1', 'A'); joue(t, 'W1-2', 'B'); joue(t, 'W2-1', 'A');
  joue(t, 'L1-1', 'C'); joue(t, 'L2-1', 'C');
  joue(t, 'GF1', 'C');
  let res = E.resoudre(t);
  assert.ok(!res.termine, 'pas terminé avant la revanche');
  assert.strictEqual(res.matchs.GF2.statut, 'pret');
  joue(t, 'GF2', 'C');
  res = E.resoudre(t);
  assert.ok(res.termine);
  assert.deepStrictEqual(E.podium(t, res).map(p => p.nom), ['C', 'A', 'B']);
});

test('nombre de joueurs impair : exemptions automatiques', () => {
  const t = tournoi(['A', 'B', 'C', 'D', 'E'], 'double');
  const res = E.resoudre(t);
  // 5 joueurs dans un arbre de 8 : les têtes 1, 2, 3 sont exemptées.
  assert.strictEqual(res.matchs['W1-1'].statut, 'exempt');
  assert.strictEqual(res.matchs['W1-2'].statut, 'pret');  // 4 contre 5
  assert.strictEqual(res.matchs['W1-3'].statut, 'exempt');
  assert.strictEqual(res.matchs['W1-4'].statut, 'exempt');
  // Joue tout ce qui est prêt en donnant la victoire au premier, jusqu'à la fin.
  let garde = 0;
  while (!E.resoudre(t).termine && garde++ < 50) {
    const m = E.aJouer(E.resoudre(t))[0];
    assert.ok(m, 'blocage : plus rien à jouer mais tournoi non terminé');
    joue(t, m.id, t.joueurs.find(j => j.id === m.a).nom);
  }
  const cl = E.classement(t);
  assert.ok(cl.every(c => c.rang != null), 'tout le monde classé');
  assert.strictEqual(cl.filter(c => c.rang === 1).length, 1);
});

test('tous les effectifs de 2 à 17, deux formats : le tournoi va au bout', () => {
  for (const format of ['double', 'simple']) {
    for (let n = 2; n <= 17; n++) {
      const t = tournoi(Array.from({ length: n }, (_, i) => 'J' + (i + 1)), format);
      let garde = 0;
      while (!E.resoudre(t).termine && garde++ < 200) {
        const m = E.aJouer(E.resoudre(t))[0];
        assert.ok(m, format + ' ' + n + ' joueurs : blocage');
        // Le moins bien classé gagne un match sur deux : on secoue l'arbre.
        const gagnant = garde % 2 ? m.b : m.a;
        joue(t, m.id, t.joueurs.find(j => j.id === gagnant).nom);
      }
      const cl = E.classement(t);
      assert.ok(cl.every(c => c.rang != null), format + ' ' + n + ' : joueur non classé');
      assert.strictEqual(cl[0].rang, 1);
      if (n >= 2) assert.strictEqual(cl.filter(c => c.rang === 2).length, 1, format + ' ' + n + ' : un seul 2ᵉ');
      if (n >= 4) assert.strictEqual(cl.filter(c => c.rang === 3).length, 1, format + ' ' + n + ' : un seul 3ᵉ');
      // En double élimination, personne n'est éliminé sans deux défaites (sauf le champion, invaincu ou à une).
      if (format === 'double') cl.forEach(c => { if (c.rang > 1) assert.strictEqual(c.d, 2, n + ' joueurs : ' + c.nom + ' a ' + c.d + ' défaites'); });
    }
  }
});

test('simple élimination : petite finale pour la 3ᵉ place', () => {
  const t = tournoi(['A', 'B', 'C', 'D'], 'simple');
  joue(t, 'W1-1', 'A'); joue(t, 'W1-2', 'B');
  joue(t, 'W2-1', 'B');
  assert.ok(!E.resoudre(t).termine, 'attend la petite finale');
  joue(t, 'P', 'C');
  assert.deepStrictEqual(E.podium(t).map(p => p.rang + p.nom), ['1B', '2A', '3C']);

  const sans = tournoi(['A', 'B', 'C', 'D'], 'simple', { petiteFinale: false });
  joue(sans, 'W1-1', 'A'); joue(sans, 'W1-2', 'B'); joue(sans, 'W2-1', 'A');
  const pod = E.podium(sans);
  assert.deepStrictEqual(pod.map(p => p.rang), [1, 2, 3, 3], 'demi-finalistes 3ᵉ ex æquo');
});

test('corriger un résultat en amont invalide les matchs qui en dépendaient', () => {
  const t = tournoi(['A', 'B', 'C', 'D'], 'double');
  joue(t, 'W1-1', 'A'); joue(t, 'W1-2', 'B'); joue(t, 'W2-1', 'A'); joue(t, 'L1-1', 'C');
  // Correction : finalement D avait battu A au premier tour.
  const m = E.resoudre(t).matchs['W1-1'];
  t.resultats['W1-1'] = { p1: m.a, p2: m.b, w: idDe(t, 'D'), s1: 0, s2: 1 };
  const res = E.resoudre(t);
  assert.strictEqual(res.matchs['W2-1'].statut, 'pret', 'la finale des gagnants change d\'affiche');
  assert.strictEqual(res.matchs['L1-1'].statut, 'pret', 'le repêchage aussi');
  assert.deepStrictEqual(Object.keys(E.resultatsValides(t, res)).sort(), ['W1-1', 'W1-2']);
});

test('numérotation : chaque match visible a un numéro unique', () => {
  const res = E.resoudre(tournoi(Array.from({ length: 6 }, (_, i) => 'J' + i), 'double'));
  const nums = res.ordre.map(id => res.matchs[id]).filter(m => m.num != null).map(m => m.num);
  assert.strictEqual(new Set(nums).size, nums.length);
});

console.log((process.exitCode ? '✖ ' : '✔ ') + ok + ' test(s) réussi(s)');
