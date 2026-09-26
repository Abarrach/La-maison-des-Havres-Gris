<?php
// ============================================================
//  RATTRAPAGE — réinscrire une demi-heure que le relevé a manquée
// ============================================================
// La grille du site sait cocher et décocher des cases, mais pas créer une COLONNE :
// une demi-heure absente du fichier n'existe nulle part, donc rien à cliquer. C'est
// le cas quand le relevé a échoué au début d'une sortie — permission manquante sur
// le salon, cron arrêté, panne réseau.
//
// Les noms sont résolus contre ceux déjà vus sur la sortie (`presence.noms`), donc
// pas besoin des identifiants Discord : il suffit de recopier la liste que le journal
// du relevé affiche, ou celle d'un passage `--test`.
//
//   php epice/rattraper_presence.php                          → liste les sorties et leurs demi-heures
//   php epice/rattraper_presence.php sortie_1789... 10:30     → montre qui serait ajouté (rien écrit)
//   php epice/rattraper_presence.php sortie_1789... 10:30 "Galatea, Sarazin, Haljiin" --ecrire
//
// L'heure s'écrit « 10:30 » (le jour de la sortie est déduit) ou en entier
// « 2026-09-26T10:30 » pour une sortie à cheval sur minuit.
//
// Un nom inconnu ARRÊTE le script : ajouter des points à la mauvaise personne est pire
// que ne pas en ajouter, et la faute de frappe se voit tout de suite.
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI uniquement.\n"); }
date_default_timezone_set('Europe/Paris');
define('DATA_FILE', __DIR__ . '/data/debriefs.json');

$args    = array_slice($argv, 1);
$ecrire  = in_array('--ecrire', $args, true);
$args    = array_values(array_filter($args, function ($a) { return $a !== '--ecrire'; }));
$sid     = $args[0] ?? '';
$heure   = $args[1] ?? '';
$liste   = $args[2] ?? '';

if (!file_exists(DATA_FILE)) { fwrite(STDERR, "Fichier introuvable : " . DATA_FILE . "\n"); exit(1); }
$d = json_decode(file_get_contents(DATA_FILE), true);
if (!is_array($d)) { fwrite(STDERR, "JSON illisible\n"); exit(1); }

// --- Sans argument : montrer ce qui existe -------------------------------
if ($sid === '') {
    foreach ($d['sorties'] ?? [] as $s) {
        $t = $s['presence']['ticks'] ?? [];
        if (!$t) continue;
        ksort($t);
        echo $s['id'], "  « ", ($s['titre'] ?? ''), " »  ", ($s['date'] ?? ''), "\n";
        echo "   ", count($t), " demi-heure(s) : ", implode(' ', array_map(function ($k) { return substr($k, 11); }, array_keys($t))), "\n";
        // Les TROUS sont ce qu'on cherche : une demi-heure sans relevé entre deux relevés.
        $cles = array_keys($t);
        $prem = strtotime(str_replace('T', ' ', $cles[0]));
        $dern = strtotime(str_replace('T', ' ', end($cles)));
        $trous = [];
        for ($x = $prem; $x <= $dern; $x += 1800) {
            $k = date('Y-m-d\TH:i', $x);
            if (!isset($t[$k])) $trous[] = substr($k, 11);
        }
        if ($trous) echo "   ⚠ trous internes : ", implode(' ', $trous), "\n";
        echo "\n";
    }
    echo "Usage : php rattraper_presence.php <id de sortie> <heure> \"Nom1, Nom2\" [--ecrire]\n";
    exit(0);
}

// --- La sortie ------------------------------------------------------------
$cible = null;
foreach ($d['sorties'] ?? [] as $s) if (($s['id'] ?? '') === $sid) $cible = $s;
if (!$cible) { fwrite(STDERR, "Sortie « $sid » introuvable.\n"); exit(1); }

$noms = $cible['presence']['noms'] ?? [];
if (!$noms) { fwrite(STDERR, "Cette sortie n'a aucun relevé : impossible de résoudre des noms.\n"); exit(1); }

// --- La clé de demi-heure -------------------------------------------------
if (preg_match('/^\d{2}:\d{2}$/', $heure)) {
    $jour = (string)($cible['date'] ?? date('Y-m-d'));
    $cle  = $jour . 'T' . $heure;
} elseif (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $heure)) {
    $cle = $heure;
} else {
    fwrite(STDERR, "Heure attendue : « 10:30 » ou « 2026-09-26T10:30 ».\n"); exit(1);
}
// Aligner sur la demi-heure : une case « 10:17 » ne serait comptée par personne.
$mm  = (int)substr($cle, 14, 2);
$cle = substr($cle, 0, 14) . ($mm < 30 ? '00' : '30');

$deja = $cible['presence']['ticks'][$cle] ?? null;
echo "Sortie : « ", ($cible['titre'] ?? ''), " »\n";
echo "Case   : ", $cle, $deja === null ? "  (absente)\n" : "  (existe déjà, " . count($deja) . " présent(s) — elle sera REMPLACÉE)\n";

// --- Les noms -------------------------------------------------------------
if (trim($liste) === '') {
    echo "\nPersonnes connues sur cette sortie :\n";
    foreach ($noms as $id => $n) echo "   ", $n, "\n";
    echo "\nRelance avec la liste, entre guillemets, séparée par des virgules.\n";
    exit(0);
}

// Comparaison tolérante : les pseudos portent emojis, accents et ponctuation, et on
// les recopie depuis un journal. On ne garde que [a-z0-9] — sur une chaîne UTF-8 cela
// retire emojis et accents en travaillant sur les OCTETS, donc sans mbstring (absente
// de ce serveur). Appliqué des deux côtés, « Quätrequart » retrouve « Quätrequart ».
// Les accents sont d'abord RAMENÉS à leur lettre de base. Les retirer purement et
// simplement donnait « Quätrequart » → « qutrequart », qui ne retrouvait pas
// « Quatrequart » tapé sans tréma — le cas le plus probable quand on recopie un pseudo
// à la main. Table explicite plutôt qu'iconv : aucune dépendance, aucun réglage de
// locale, et le résultat ne dépend pas de la machine.
$sansAccent = function ($s) {
    return strtr((string)$s, [
        'à'=>'a','á'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a','À'=>'a','Á'=>'a','Â'=>'a','Ä'=>'a','Ã'=>'a','Å'=>'a',
        'è'=>'e','é'=>'e','ê'=>'e','ë'=>'e','È'=>'e','É'=>'e','Ê'=>'e','Ë'=>'e',
        'ì'=>'i','í'=>'i','î'=>'i','ï'=>'i','Ì'=>'i','Í'=>'i','Î'=>'i','Ï'=>'i',
        'ò'=>'o','ó'=>'o','ô'=>'o','ö'=>'o','õ'=>'o','Ò'=>'o','Ó'=>'o','Ô'=>'o','Ö'=>'o','Õ'=>'o',
        'ù'=>'u','ú'=>'u','û'=>'u','ü'=>'u','Ù'=>'u','Ú'=>'u','Û'=>'u','Ü'=>'u',
        'ç'=>'c','Ç'=>'c','ñ'=>'n','Ñ'=>'n','ý'=>'y','ÿ'=>'y','Ý'=>'y',
        'œ'=>'oe','Œ'=>'oe','æ'=>'ae','Æ'=>'ae',
    ]);
};
$clef = function ($s) use ($sansAccent) { return preg_replace('/[^a-z0-9]/', '', strtolower($sansAccent($s))); };
$parClef = [];
foreach ($noms as $id => $n) $parClef[$clef($n)] = (string)$id;

$ids = []; $vus = []; $inconnus = [];
foreach (explode(',', $liste) as $brut) {
    $brut = trim($brut);
    if ($brut === '') continue;
    $k = $clef($brut);
    if (!isset($parClef[$k])) { $inconnus[] = $brut; continue; }
    $id = $parClef[$k];
    if (in_array($id, $ids, true)) continue;   // doublon dans la liste : une présence, un point
    $ids[] = $id; $vus[] = $noms[$id];
}

if ($inconnus) {
    fwrite(STDERR, "\n🧨 Inconnu(s) sur cette sortie : " . implode(', ', $inconnus) . "\n");
    fwrite(STDERR, "Rien n'a été écrit. Vérifie l'orthographe — relance sans liste pour voir les noms connus.\n");
    exit(1);
}

echo "\n", count($ids), " personne(s) : ", implode(', ', $vus), "\n";

if (!$ecrire) { echo "\n(essai à blanc — ajoute --ecrire pour enregistrer)\n"; exit(0); }

// --- Écriture sous verrou, avec relecture --------------------------------
$fp = @fopen(DATA_FILE, 'c+');
if (!$fp) { fwrite(STDERR, "Ouverture impossible (droits ?)\n"); exit(1); }
$ok = false;
for ($n = 0; $n < 30; $n++) { if (flock($fp, LOCK_EX | LOCK_NB)) { $ok = true; break; } usleep(100000); }
if (!$ok) { fclose($fp); fwrite(STDERR, "Verrou indisponible — le relevé écrit peut-être en ce moment, réessaie.\n"); exit(1); }

rewind($fp);
$frais = json_decode(stream_get_contents($fp), true);
if (!is_array($frais)) { flock($fp, LOCK_UN); fclose($fp); fwrite(STDERR, "Relecture illisible\n"); exit(1); }

$fait = false;
foreach ($frais['sorties'] as &$s) {
    if (($s['id'] ?? '') !== $sid) continue;
    if (!isset($s['presence']) || !is_array($s['presence'])) $s['presence'] = ['ticks' => [], 'noms' => [], 'volume' => 0];
    $s['presence']['ticks'][$cle] = $ids;
    ksort($s['presence']['ticks']);
    $fait = true;
    break;
}
unset($s);
if (!$fait) { flock($fp, LOCK_UN); fclose($fp); fwrite(STDERR, "Sortie disparue entre-temps.\n"); exit(1); }

ftruncate($fp, 0); rewind($fp);
fwrite($fp, json_encode($frais, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

echo "\n✅ Case ", $cle, " enregistrée. Recharge la page (⟳ Actualiser) pour la voir.\n";
