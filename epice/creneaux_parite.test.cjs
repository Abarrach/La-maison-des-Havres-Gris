// ============================================================
//  GARDE-FOU DE PARITÉ — créneaux de rally
// ============================================================
// Le découpage d'un rally en créneaux est écrit DEUX FOIS :
//   • en PHP  dans epice/discord_sortie.php  (creneaux_sortie / creneau_couverture)
//     → ce que l'encart Discord affiche, et ce qui ÉCRIT les données ;
//   • en JS   dans epice/debrief.html        (creneauxSortie / creneauCouverture)
//     → ce que la grille de l'onglet Assignation affiche.
//
// La duplication est subie, pas choisie : data-api.php ne peut pas inclure
// discord_sortie.php, qui est un endpoint s'exécutant au chargement.
//
// Ce test ne vérifie PAS qu'on a bien pensé à modifier les deux fichiers — un
// tel contrôle hurlerait à chaque virgule déplacée et se ferait désactiver en
// trois semaines. Il vérifie la seule chose qui compte : que les deux
// implémentations RÉPONDENT LA MÊME CHOSE sur un corpus commun. Modifier un
// seul côté casse ce test ; modifier les deux à l'identique ne le casse pas.
//
// La référence est le PHP : c'est lui qui écrit les données et qui parle aux
// joueurs. Quand les deux divergent, c'est le JS qui a tort.
//
//     node epice/creneaux_parite.test.cjs
//
// Nécessite `php` dans le PATH. Sans lui le test ÉCHOUE au lieu de passer en
// silence : un garde-fou qu'on ne voit pas s'éteindre ne garde rien.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');
const { execFileSync } = require('node:child_process');

const PHP_SRC  = path.join(__dirname, 'discord_sortie.php');
const HTML_SRC = path.join(__dirname, 'debrief.html');

// ------------------------------------------------------------
//  CORPUS COMMUN
// ------------------------------------------------------------
// Un test de parité ne vaut que son corpus : ce que personne ne demande aux
// deux implémentations, personne ne saura qu'elles le font différemment.
// D'où les cas tordus — ils ne viendront jamais de Discord, mais ils épinglent
// la LECTURE des données, qui est l'endroit où deux langages divergent le plus
// facilement (un « 2 » en chaîne, un index négatif, un champ qui n'est pas un
// tableau).

const SORTIES = [
  ['8 h depuis 08:00',          { heure: '08:00', duree: '8' }],
  ['6 h — seuil exact',         { heure: '14:00', duree: '6' }],
  ['5 h — sous le seuil',       { heure: '14:00', duree: '5' }],
  ['10 h — cinq blocs',         { heure: '08:00', duree: '10' }],
  ['6 h 30 — dernier tronqué',  { heure: '08:00', duree: '6h30' }],
  ['« 7 h » avec espaces',      { heure: '08:00', duree: '7 h ' }],
  ['passage de minuit',         { heure: '22:00', duree: '6' }],
  ['départ à minuit',           { heure: '00:00', duree: '8' }],
  ['30 h — borne des 12 blocs', { heure: '08:00', duree: '30' }],
  ['heure absente',             { duree: '8' }],
  ['heure mal formée',          { heure: '8:00', duree: '8' }],
  ['durée absente',             { heure: '08:00' }],
  ['durée illisible',           { heure: '08:00', duree: 'longue' }],
  ['sortie vide',               {}],
];

const ROSTERS = [
  ['aucun inscrit', []],

  ['formation complète partout', [
    { name: 'Lorhelyne', poste: 'transporteur',    creneaux: [0, 1, 2, 3] },
    { name: 'Bahlor',    poste: 'moissonneur',     creneaux: [0, 1, 2, 3] },
    { name: 'Paul',      poste: 'pilote_orni',     creneaux: [0, 1, 2, 3] },
    { name: 'Chani',     poste: 'pilote_orni_cac', creneaux: [0, 1, 2, 3] },
    { name: 'Stilgar',   poste: 'pilote_orni',     creneaux: [0, 1, 2, 3] },
    { name: 'Duncan',    poste: 'pilote_orni',     creneaux: [0, 1, 2, 3] },
  ]],

  ['journée en relève', [
    { name: 'Lorhelyne', poste: 'transporteur',    creneaux: [0, 1] },
    { name: 'Jessica',   poste: 'transporteur',    creneaux: [2, 3] },
    { name: 'Bahlor',    poste: 'moissonneur',     creneaux: [0, 1, 2, 3] },
    { name: 'Paul',      poste: 'pilote_orni',     creneaux: [0] },
    { name: 'Chani',     poste: 'pilote_orni_cac', creneaux: [3, 4] },
    { name: 'Leto',      poste: 'base_avancee',    creneaux: [1, 2] },
  ]],

  ['aucun créneau déclaré (rétrocompat)', [
    { name: 'Gurney', poste: 'transporteur' },
    { name: 'Thufir', poste: 'moissonneur' },
    { name: 'Feyd',   poste: 'present' },
  ]],

  ['peut-être, absents, statut inconnu', [
    { name: 'Irulan', poste: 'transporteur', creneaux: [0, 1], statut: 'maybe' },
    { name: 'Rabban', poste: 'moissonneur',  creneaux: [0, 1], statut: 'absent' },
    { name: 'Alia',   poste: 'pilote_orni',  creneaux: [0],    statut: 'present' },
    { name: 'Hawat',  poste: 'pilote_orni',  creneaux: [0],    statut: 'inconnu' },
    { name: 'Yueh',   poste: 'pilote_orni',  creneaux: [0] },
  ]],

  ['postes hors catalogue', [
    { name: 'Shaddam', poste: 'present',       creneaux: [0, 1, 2] },
    { name: 'Fenring', poste: 'orni_scout',    creneaux: [0] },
    { name: 'Mohiam',  poste: 'defenseur_cac', creneaux: [0] },
    { name: 'Piter',   poste: 'poste_invente', creneaux: [0] },
    { name: 'Kynes',   creneaux: [0] },
  ]],

  ['index hors plage, doublons, négatifs', [
    { name: 'Harah', poste: 'pilote_orni', creneaux: [0, 0, 99, -1, 3] },
  ]],

  ['index en chaînes de caractères', [
    { name: 'Otheym', poste: 'transporteur', creneaux: ['0', '2'] },
    { name: 'Korba',  poste: 'moissonneur',  creneaux: ['1'] },
  ]],

  ['index illisibles', [
    { name: 'Esmar', poste: 'pilote_orni', creneaux: ['abc', '2x'] },
  ]],

  ['créneaux vide = disponible nulle part', [
    { name: 'Tuek', poste: 'moissonneur', creneaux: [] },
  ]],

  ['créneaux qui n est pas un tableau', [
    { name: 'Kudu',  poste: 'transporteur', creneaux: '08-10' },
    { name: 'Nefud', poste: 'pilote_orni',  creneaux: null },
  ]],
];

// Produit cartésien : chaque horaire confronté à chaque tablée.
const CAS = [];
for (const [nomSortie, sortie] of SORTIES)
  for (const [nomRoster, signups] of ROSTERS)
    CAS.push({ nom: nomSortie + ' × ' + nomRoster, sortie, signups });

// Nombre de créneaux sondés, au-delà du découpage le plus long du corpus : la
// couverture d'un index inexistant doit elle aussi concorder.
const SONDES = 13;

// ------------------------------------------------------------
//  CÔTÉ JS — extrait de debrief.html
// ------------------------------------------------------------
function chargerJs() {
  const html  = fs.readFileSync(HTML_SRC, 'utf8');
  const debut = html.indexOf('// GRILLE DES CRÉNEAUX');
  const fin   = html.indexOf('function renderCreneauxGrid()');
  assert.ok(debut !== -1, 'repère « // GRILLE DES CRÉNEAUX » introuvable dans debrief.html');
  assert.ok(fin > debut,  'renderCreneauxGrid() introuvable dans debrief.html');
  const code = html.slice(debut, fin);
  for (const c of ['RALLY_SEUIL_H', 'RALLY_BLOC_H', 'RALLY_MINIMUM'])
    assert.ok(code.includes(c), 'constante ' + c + ' absente du bloc JS des créneaux');
  // Le bloc extrait n'appelle ni esc() ni le DOM : il se suffit à lui-même.
  return new Function(code + '\nreturn { creneauxSortie, creneauCouverture };')();
}

function releveJs(api, cas) {
  const blocs = api.creneauxSortie(cas.sortie);
  const cov = [];
  for (let i = 0; i < SONDES; i++) cov.push(api.creneauCouverture(cas.signups, i));
  return { blocs: blocs.map(b => [b.i, b.label, b.court]), cov };
}

// ------------------------------------------------------------
//  CÔTÉ PHP — extrait de discord_sortie.php
// ------------------------------------------------------------
// Le bouchon est ÉCRIT À LA VOLÉE dans le dossier temporaire, jamais déposé
// dans epice/ : un fichier qui évalue du code extrait n'a rien à faire dans un
// répertoire servi par nginx.
//
// Il relit les constantes DANS LE FICHIER au lieu de les redéfinir : sans ça,
// changer RALLY_BLOC_H côté PHP passerait inaperçu — le bouchon imposerait
// l'ancienne valeur et le test resterait vert en mentant.
const BOUCHON_PHP = String.raw`<?php
$src = file_get_contents($argv[1]);
$manque = [];
preg_match_all('/^const\s+(RALLY_\w+)\s*=\s*([^;]+);/m', $src, $m, PREG_SET_ORDER);
foreach ($m as $c) define($c[1], eval('return ' . $c[2] . ';'));
foreach (['RALLY_SEUIL_H', 'RALLY_BLOC_H', 'RALLY_MINIMUM'] as $k)
    if (!defined($k)) $manque[] = 'const ' . $k;
foreach (['creneaux_sortie', 'creneau_couverture'] as $fn) {
    if (preg_match('/\nfunction ' . $fn . '\(.*?\n\}\r?\n/s', $src, $f)) eval($f[0]);
    else $manque[] = $fn . '()';
}
if ($manque) {
    fwrite(STDERR, 'introuvable dans discord_sortie.php : ' . implode(', ', $manque));
    exit(2);
}
$in  = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($in['cas'] as $cas) {
    $r = ['blocs' => [], 'cov' => []];
    foreach (creneaux_sortie($cas['sortie']) as $b) $r['blocs'][] = [$b['i'], $b['label'], $b['court']];
    for ($i = 0; $i < $in['sondes']; $i++) {
        $cv = creneau_couverture($cas['signups'], $i);
        unset($cv['noms']);   // la grille ne liste pas les noms par créneau : rien à comparer
        $r['cov'][] = $cv;
    }
    $out[] = $r;
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`;

function relevePhp(cas) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'cren-'));
  const bouchon = path.join(dossier, 'bouchon.php');
  fs.writeFileSync(bouchon, BOUCHON_PHP);
  try {
    return JSON.parse(execFileSync('php', [bouchon, PHP_SRC], {
      input: JSON.stringify({ cas, sondes: SONDES }),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (e) {
    if (e.code === 'ENOENT')
      assert.fail('`php` absent du PATH : la parité PHP-JS n a PAS été vérifiée.');
    assert.fail('bouchon PHP en échec : ' + (e.stderr || e.message));
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------
//  LE TEST
// ------------------------------------------------------------
test('PHP et JS découpent et couvrent les créneaux à l identique', () => {
  const api = chargerJs();
  const php = relevePhp(CAS);
  assert.equal(php.length, CAS.length, 'le bouchon PHP n a pas traité tous les cas');

  const divergences = [];
  CAS.forEach((cas, n) => {
    const a = JSON.stringify(php[n]);
    const b = JSON.stringify(releveJs(api, cas));
    if (a !== b) divergences.push('  · ' + cas.nom + '\n      PHP : ' + a + '\n      JS  : ' + b);
  });

  assert.ok(divergences.length === 0,
    divergences.length + ' cas sur ' + CAS.length + ' où les deux lectures divergent.\n' +
    'Le PHP fait foi : c est lui qui écrit les données et qui parle aux joueurs.\n' +
    divergences.join('\n'));
});

// Le corpus lui-même a une valeur à défendre : un découpage rendant zéro bloc
// partout passerait la parité haut la main tout en ne testant plus rien.
test('le corpus exerce bien un vrai rally', () => {
  const api = chargerJs();
  const tailles = new Set(CAS.map(c => api.creneauxSortie(c.sortie).length));
  assert.ok(tailles.has(0),  'aucun cas sous le seuil : le « rien ne change » n est pas testé');
  assert.ok(tailles.has(4),  'aucune journée de 8 h dans le corpus');
  assert.ok(tailles.has(12), 'la borne des 12 blocs n est pas atteinte');
});
