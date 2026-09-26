<?php
// ============================================================
//  PARTAGE AU PRORATA DE LA PRÉSENCE — le calcul qui ne doit pas se tromper
// ============================================================
// C'est le seul chiffre de tout le portail qui se traduit en ressources dans les
// poches des joueurs. Une erreur ici ne se voit pas : elle se découvre trois
// semaines plus tard, quand quelqu'un refait le calcul à la main.
//
//     php epice/parts_presence.test.php

$src = file_get_contents(__DIR__ . '/data-api.php');
foreach (['parts_presence', 'message_parts'] as $fn) {
    if (!preg_match('/\nfunction ' . $fn . '\(.*?\n\}\r?\n/s', $src, $m)) {
        fwrite(STDERR, "introuvable dans data-api.php : $fn()\n"); exit(2);
    }
    eval($m[0]);
}

$ko = 0;
function ok(string $label, bool $cond) {
    global $ko;
    echo ($cond ? '  ok  ' : '  KO  ') . $label . "\n";
    if (!$cond) $ko++;
}

/** Construit des ticks à partir de [pseudo => nombre de demi-heures consécutives]. */
function sortie(array $presences, int $volume): array {
    $ticks = []; $noms = [];
    $max = $presences ? max($presences) : 0;
    foreach ($presences as $nom => $n) $noms[$nom] = $nom;
    for ($i = 0; $i < $max; $i++) {
        $cle = sprintf('2026-09-26T%02d:%02d', 8 + intdiv($i, 2), ($i % 2) * 30);
        foreach ($presences as $nom => $n) if ($i < $n) $ticks[$cle][] = $nom;
    }
    return ['titre' => 'Rally test', 'date' => '2026-09-26', 'heure' => '08:00',
            'presence' => ['ticks' => $ticks, 'noms' => $noms, 'volume' => $volume]];
}

// --- L'exemple publié à la guilde : il doit tomber au chiffre près ---
$s = sortie(['Sarazin' => 16, 'Abarrach' => 8, 'Karrel' => 2, 'Lohre' => 6], 64000);
$r = parts_presence($s);
$par = [];
foreach ($r['lignes'] as $l) $par[$l['nom']] = $l;

ok('32 points au total',        $r['total_points'] === 32);
ok('1 point = 2 000',           (float)$r['par_point'] === 2000.0);
ok('Sarazin 16 pts -> 32 000',  $par['Sarazin']['part'] === 32000);
ok('Abarrach 8 pts -> 16 000',  $par['Abarrach']['part'] === 16000);
ok('Lohre 6 pts -> 12 000',     $par['Lohre']['part'] === 12000);
ok('Karrel 2 pts -> 4 000',     $par['Karrel']['part'] === 4000);
ok('rien ne se perd en route',  $r['distribue'] === 64000 && $r['reliquat'] === 0);
ok('trie par points decroissants', $r['lignes'][0]['nom'] === 'Sarazin');

// --- Effectif fluctuant : la valeur du point ne dépend PAS du nombre de présents ---
// C'est la propriété qui a été promise à la guilde. Deux journées identiques en
// points totaux doivent donner la même valeur de point, quel que soit le nombre de gens.
$a = parts_presence(sortie(['A' => 10, 'B' => 10], 40000));          // 2 joueurs, 20 pts
$b = parts_presence(sortie(['A' => 5, 'B' => 5, 'C' => 5, 'D' => 5], 40000)); // 4 joueurs, 20 pts
ok('valeur du point indifférente à l effectif', (float)$a['par_point'] === (float)$b['par_point']);
ok('2 joueurs -> 20 000 chacun', $a['lignes'][0]['part'] === 20000);
ok('4 joueurs -> 10 000 chacun', $b['lignes'][0]['part'] === 10000);

// --- Arrondi à la centaine : le reliquat retourne au pot, jamais à quelqu un ---
$r = parts_presence(sortie(['A' => 1, 'B' => 1, 'C' => 1], 10000));  // 3333,33 chacun
$parts = array_column($r['lignes'], 'part');
ok('parts arrondies à la centaine', $parts === [3300, 3300, 3300]);
ok('reliquat identifié',            $r['reliquat'] === 100);
ok('jamais plus que la récolte',    $r['distribue'] <= $r['volume']);

// --- Cas limites : rien ne doit exploser ni inventer ---
$vide = parts_presence(['presence' => ['ticks' => [], 'noms' => [], 'volume' => 50000]]);
ok('aucune présence -> aucune ligne', $vide['lignes'] === [] && $vide['total_points'] === 0);
ok('aucune présence -> pas de division par zéro', $vide['par_point'] === 0);

$sansVolume = parts_presence(sortie(['A' => 4], 0));
ok('volume non saisi -> part nulle', $sansVolume['lignes'][0]['part'] === 0);

ok('sortie sans clé presence',  parts_presence(['titre' => 'x'])['total_points'] === 0);

// Un même joueur listé deux fois dans le MÊME tick (bug de relevé) ne doit pas
// compter double : la présence est un booléen par demi-heure, pas un compteur.
$double = parts_presence(['presence' => [
    'ticks'  => ['2026-09-26T08:00' => ['A', 'A', 'B']],
    'noms'   => ['A' => 'A', 'B' => 'B'],
    'volume' => 1000,
]]);
$pts = array_column($double['lignes'], 'points', 'nom');
ok('un doublon dans un tick ne compte pas double', $pts['A'] === 1);

// --- Les plages de présence -----------------------------------------------
// Elles se fusionnent sur les demi-heures RÉELLEMENT relevées, pas sur l'horloge :
// c'est toute la subtilité. Une demi-heure où le salon était vide n'existe pour
// personne et ne doit donc couper la plage de personne.

/** Ticks explicites : ['10:00' => ['A','B'], …]. */
function brut(array $parHeure, int $volume = 0): array {
    $ticks = []; $noms = [];
    foreach ($parHeure as $h => $gens) {
        $ticks['2026-09-26T' . $h] = $gens;
        foreach ($gens as $g) $noms[$g] = $g;
    }
    return ['presence' => ['ticks' => $ticks, 'noms' => $noms, 'volume' => $volume]];
}
function plageDe(array $r, string $nom): string {
    foreach ($r['lignes'] as $l) if ($l['nom'] === $nom) return (string)$l['plage'];
    return '(absent)';
}

$r = parts_presence(brut([
    '10:00' => ['A', 'B'],
    '10:30' => ['A', 'B'],
    '11:00' => ['A'],
    '11:30' => ['A', 'B'],
]));
ok('présence continue -> une seule plage',  plageDe($r, 'A') === '10:00–11:30');
ok('absence au milieu -> deux plages',      plageDe($r, 'B') === '10:00–10:30, 11:30');

// Le cas du 26 septembre : personne entre 12:30 et 13:30, donc ces demi-heures ne
// sont pas écrites. Elles ne doivent couper la plage de personne.
$r = parts_presence(brut([
    '12:00' => ['A'],
    '14:00' => ['A'],
    '14:30' => ['A'],
]));
ok('demi-heure vide pour TOUS -> pas de coupure', plageDe($r, 'A') === '12:00–14:30');

$r = parts_presence(brut(['09:00' => ['A']]));
ok('une seule demi-heure -> pas de tiret',  plageDe($r, 'A') === '09:00');

// --- Le message Discord ---
$s = sortie(['Sarazin' => 16, 'Abarrach' => 8, 'Karrel' => 2, 'Lohre' => 6], 64000);
$msg = message_parts($s, parts_presence($s));
ok('le message tient dans les 2000 caractères de Discord', strlen($msg) < 2000);
ok('il nomme la sortie',        strpos($msg, 'Rally test') !== false);
ok('il donne la valeur du point', strpos($msg, 'par point') !== false);
// Le pied explicatif a été retiré à la demande de l'organisateur : la règle est
// annoncée une fois à la guilde, pas répétée sous chaque partage. On le VÉRIFIE, pour
// qu'un retour en arrière involontaire se voie.
// Le pied explicatif a été retiré à la demande de l'organisateur : la règle est
// annoncée une fois à la guilde, pas répétée sous chaque partage. Le reliquat, lui,
// RESTE : sans lui, la somme des parts ne retombant pas sur la récolte ferait croire
// à une erreur de calcul. On vérifie les deux, pour qu'un retour en arrière se voie.
ok('pas de rappel de règle',    strpos($msg, 'Aucun prélèvement') === false
                             && strpos($msg, 'arrondies à la centaine') === false);
$avecReliquat = sortie(['A' => 1, 'B' => 1, 'C' => 1], 10000);   // 3 333,33 chacun -> 100 de reste
ok('le reliquat est annoncé', strpos(message_parts($avecReliquat, parts_presence($avecReliquat)), 'Reliquat de 100') !== false);
ok('rien à annoncer quand il n y a pas de reste', strpos($msg, 'Reliquat') === false || $r['reliquat'] > 0);
ok('il liste les parts',        strpos($msg, '32 000') !== false);

// 40 joueurs sur 16 demi-heures : le pire cas réaliste doit rester publiable.
$gros = [];
for ($i = 0; $i < 40; $i++) $gros['Joueur' . $i . 'AuPseudoTresLong'] = 16;
$sg  = sortie($gros, 500000);
$mg  = message_parts($sg, parts_presence($sg));
ok('40 joueurs : message toujours sous 2000 car.', strlen($mg) < 2000);

echo "\n" . ($ko ? "$ko ÉCHEC(S)\n" : "tout passe\n");
exit($ko ? 1 : 0);
