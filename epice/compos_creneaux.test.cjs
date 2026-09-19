// ============================================================
//  COMPOS PAR CRÉNEAU — modèle de données et héritage
// ============================================================
// Sur un rally, la compo n'est plus unique : une tranche horaire, une relève.
// Le stockage est volontairement ASYMÉTRIQUE — le créneau 0 (et toute sortie qui
// n'est pas un rally) vit dans `assignation`, les suivants dans `assignations` —
// pour que les lecteurs historiques (Manuel de combat, historique, participants)
// n'aient rien à apprendre sur les rallys. Ce test verrouille cette asymétrie,
// qui est exactement le genre de chose qu'une relecture distraite « simplifie »
// en dupliquant le créneau 0 des deux côtés.
//
//     node epice/compos_creneaux.test.cjs
//
// Nécessite `php` dans le PATH, comme creneaux_parite.test.cjs.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');
const { execFileSync } = require('node:child_process');

const API_SRC  = path.join(__dirname, 'data-api.php');
const HTML_SRC = path.join(__dirname, 'debrief.html');

// ------------------------------------------------------------
//  Côté PHP — apply_compos / sortie_compo / roster_from_sortie
// ------------------------------------------------------------
const BOUCHON = String.raw`<?php
$src = file_get_contents($argv[1]);
$manque = [];
foreach (['lc', 'apply_compos', 'sortie_compo', 'sortie_compos', 'roster_from_sortie', 'roster_from_assign'] as $fn) {
    if (preg_match('/\nfunction ' . $fn . '\(.*?\n\}\r?\n/s', $src, $f)) eval($f[0]);
    else $manque[] = $fn . '()';
}
if ($manque) { fwrite(STDERR, 'introuvable dans data-api.php : ' . implode(', ', $manque)); exit(2); }
$in = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($in as $appel) {
    if ($appel['quoi'] === 'apply')   $out[] = apply_compos($appel['sortie'], $appel['input']);
    if ($appel['quoi'] === 'compo')   $out[] = sortie_compo($appel['sortie'], $appel['i']);
    if ($appel['quoi'] === 'roster')  $out[] = roster_from_sortie($appel['sortie']);
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`;

function php(appels) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'compos-'));
  const f = path.join(dossier, 'bouchon.php');
  fs.writeFileSync(f, BOUCHON);
  try {
    return JSON.parse(execFileSync('php', [f, API_SRC], { input: JSON.stringify(appels), encoding: 'utf8' }));
  } catch (e) {
    if (e.code === 'ENOENT') assert.fail('`php` absent du PATH : le modèle de données n a PAS été vérifié.');
    assert.fail('bouchon PHP en échec : ' + (e.stderr || e.message));
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

const compo = n => ({ commandement: { cs: n, cdr: '', cp: '', cb: '' }, recolte: [{ transporteur: n, moissonneur: n + '2' }] });

test('apply_compos range le créneau 0 dans assignation et les suivants dans assignations', () => {
  const [r] = php([{ quoi: 'apply', sortie: { id: 'x' }, input: { assignations: { 0: compo('A'), 1: compo('B'), 2: compo('C') } } }]);
  assert.deepEqual(r.assignation, compo('A'), 'le créneau 0 doit rester dans `assignation`');
  assert.deepEqual(Object.keys(r.assignations), ['1', '2']);
  assert.deepEqual(r.assignations['1'], compo('B'));
  assert.ok(!('0' in r.assignations), 'le créneau 0 ne doit PAS être dupliqué dans `assignations`');
});

test('une sortie sans relève ne laisse aucune clé assignations derrière elle', () => {
  const [r] = php([{ quoi: 'apply', sortie: { id: 'x', assignations: { 1: compo('vieux') } }, input: { assignations: { 0: compo('A') } } }]);
  assert.deepEqual(r.assignation, compo('A'));
  assert.ok(!('assignations' in r), 'les relèves retirées doivent disparaître du fichier');
});

test('un créneau vide n est pas persisté', () => {
  const [r] = php([{ quoi: 'apply', sortie: {}, input: { assignations: { 0: compo('A'), 1: {}, 2: compo('C') } } }]);
  assert.deepEqual(Object.keys(r.assignations), ['2']);
});

test('un vieux client ne détruit pas les relèves d un rally', () => {
  // Page laissée ouverte depuis la veille : elle n envoie que `assignation`.
  const avant = { assignation: compo('A'), assignations: { 1: compo('B') } };
  const [r] = php([{ quoi: 'apply', sortie: avant, input: { assignation: compo('Z') } }]);
  assert.deepEqual(r.assignation, compo('Z'), 'le créneau 0 est bien mis à jour');
  assert.deepEqual(r.assignations, { 1: compo('B') }, 'les relèves doivent survivre');
});

test('sortie_compo lit au bon endroit selon le créneau', () => {
  const s = { assignation: compo('A'), assignations: { 2: compo('C') } };
  const r = php([
    { quoi: 'compo', sortie: s, i: 0 },
    { quoi: 'compo', sortie: s, i: 2 },
    { quoi: 'compo', sortie: s, i: 1 },   // jamais composé → null, l héritage est côté affichage
    { quoi: 'compo', sortie: s, i: 9 },
  ]);
  assert.deepEqual(r[0], compo('A'));
  assert.deepEqual(r[1], compo('C'));
  assert.equal(r[2], null);
  assert.equal(r[3], null);
});

test('les participants sont l union de tous les créneaux', () => {
  // Quelqu un qui n a joué que de 14 h à 16 h doit pouvoir déposer son retour.
  const s = { assignation: compo('Matin'), assignations: { 3: compo('Soir') } };
  const [noms] = php([{ quoi: 'roster', sortie: s }]);
  assert.ok(noms.includes('Matin'),  'le créneau 0 manque dans les participants');
  assert.ok(noms.includes('Soir'),   'un joueur présent seulement en fin de journée serait privé de retour');
  assert.equal(new Set(noms).size, noms.length, 'la liste doit rester dédupliquée');
});

// ------------------------------------------------------------
//  Côté JS — recopie vers l avant et héritage à l affichage
// ------------------------------------------------------------
// basculerCreneau() et orgaCompoCreneau() portent les deux règles d ergonomie du
// lot : un créneau jamais ouvert REPREND le précédent (une relève se règle en
// changeant deux noms), et la vue joueur n affiche jamais « non défini » quand un
// créneau antérieur est composé.
function chargerJs() {
  const html = fs.readFileSync(HTML_SRC, 'utf8');
  // Découpe UNE fonction nommée, de sa déclaration à son accolade en colonne 0.
  // Découper « de tel repère à tel autre » ramassait les voisines et leurs appels
  // au DOM, qui n'existe pas ici.
  const fonction = nom => {
    const re = new RegExp(String.raw`^function ${nom}\([\s\S]*?^\}$`, 'm');
    const m = re.exec(html);
    assert.ok(m, 'fonction introuvable dans debrief.html : ' + nom + '()');
    return m[0] + '\n';
  };
  const code = ['mkDefenseSquad', 'emptyCompo', 'normalizeCompo', 'cleanCompo',
                'basculerCreneau', 'orgaCompoCreneau'].map(fonction).join('');
  return new Function(`
    let currentCompos = {}, currentCreneau = 0, currentCompo = null, orgaData = null;
    ${code}
    return {
      basculer: (i) => { basculerCreneau(i, true); return currentCompo; },
      poser: (i, c) => { currentCompos[i] = c; },
      compos: () => currentCompos,
      orga: (d, i) => { orgaData = d; return orgaCompoCreneau(i); },
    };`)();
}

test('un créneau jamais ouvert reprend le dernier créneau composé', () => {
  const js = chargerJs();
  const base = js.basculer(0);
  base.commandement.cs = 'Lorhelyne';
  const suivant = js.basculer(2);          // on saute le 1 : la reprise remonte au plus proche
  assert.equal(suivant.commandement.cs, 'Lorhelyne', 'la relève devrait partir de la compo précédente');
  suivant.commandement.cs = 'Bahlor';
  assert.equal(js.basculer(0).commandement.cs, 'Lorhelyne',
    'modifier une relève ne doit PAS remonter sur le créneau d origine (copie, pas référence)');
});

test('le premier créneau d une sortie vierge part d une compo vide, pas d un plantage', () => {
  const js = chargerJs();
  assert.equal(js.basculer(0).commandement.cs, '');
});

test('la vue joueur hérite du dernier créneau composé et dit d où il vient', () => {
  const js = chargerJs();
  const d = { assignation: compo('Matin'), assignations: { 2: compo('AprèsMidi') } };
  assert.deepEqual(js.orga(d, 0), { compo: compo('Matin'),     source: 0 });
  assert.deepEqual(js.orga(d, 1), { compo: compo('Matin'),     source: 0 }, 'le créneau 1 doit hériter du 0');
  assert.deepEqual(js.orga(d, 3), { compo: compo('AprèsMidi'), source: 2 }, 'le créneau 3 doit hériter du 2');
  assert.deepEqual(js.orga({ assignation: null }, 2), { compo: null, source: -1 });
});
