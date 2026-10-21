<?php
// ============================================================
//  RATTRAPAGE — réinscrire des demi-heures que le relevé a manquées
// ============================================================
// La grille du site coche et décoche des cases, mais ne sait pas créer une COLONNE :
// une demi-heure absente du fichier n'existe nulle part, il n'y a rien à cliquer.
// C'est le cas quand le relevé a échoué (permission, cron arrêté, panne réseau) ou
// quand la sortie déborde de sa fenêtre déclarée.
//
//   php epice/rattraper_presence.php
//       → liste les sorties, leurs demi-heures, et les TROUS
//
//   php epice/rattraper_presence.php <sortie> 20:00,20:30 --copier 19:30
//       → reprend les présents d'une demi-heure existante (le cas du débordement)
//
//   php epice/rattraper_presence.php <sortie> 10:00,10:30 "Galatea, Sarazin, Haljiin"
//       → liste explicite (le cas du démarrage manqué : on la recopie du journal)
//
//   … --ecrire   pour enregistrer. Sans lui, rien n'est touché.
//
// ⚠ UN TROU N'EST PAS FORCÉMENT UNE PANNE. Une demi-heure où le salon était vide
//   n'est pas écrite — c'est voulu, une tranche creuse ne doit pas diluer les parts.
//   Remplir une pause déjeuner donnerait des points pour du temps que personne n'a
//   passé. Ne rattrape que ce dont tu es sûr.
//
// Un nom inconnu ARRÊTE le script : donner des points à la mauvaise personne est pire
// que ne pas en donner, et la faute de frappe se voit tout de suite.
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI uniquement.\n"); }
date_default_timezone_set('Europe/Paris');
define('DATA_FILE', __DIR__ . '/data/debriefs.json');

// --- Arguments ------------------------------------------------------------
$argsBruts = array_slice($argv, 1);
$ecrire    = false;
$copier    = '';
$positifs  = [];
for ($i = 0; $i < count($argsBruts); $i++) {
    $a = $argsBruts[$i];
    if ($a === '--ecrire') { $ecrire = true; continue; }
    if ($a === '--copier') { $copier = (string)($argsBruts[++$i] ?? ''); continue; }
    $positifs[] = $a;
}
$sid    = $positifs[0] ?? '';
$heures = $positifs[1] ?? '';
$liste  = $positifs[2] ?? '';

if (!file_exists(DATA_FILE)) { fwrite(STDERR, "Fichier introuvable : " . DATA_FILE . "\n"); exit(1); }
$d = json_decode(file_get_contents(DATA_FILE), true);
if (!is_array($d)) { fwrite(STDERR, "JSON illisible\n"); exit(1); }

// --- Sans argument : l'inventaire ----------------------------------------
if ($sid === '') {
    foreach ($d['sorties'] ?? [] as $s) {
        $t = $s['presence']['ticks'] ?? [];
        if (!$t) continue;
        ksort($t);
        $cles = array_keys($t);
        echo $s['id'], "   « ", ($s['titre'] ?? ''), " »   ", ($s['date'] ?? ''), "\n";
        echo "   ", count($t), " demi-heure(s), de ", substr($cles[0], 11), " à ", substr(end($cles), 11), "\n";
        $trous = [];
        for ($x = strtotime(str_replace('T', ' ', $cles[0])); $x <= strtotime(str_replace('T', ' ', end($cles))); $x += 1800)
            if (!isset($t[date('Y-m-d\TH:i', $x)])) $trous[] = date('H:i', $x);
        if ($trous) {
            echo "   ⚠ trous : ", implode(' ', $trous), "\n";
            echo "     (salon vide à ces heures-là ? alors c'est NORMAL, ne les remplis pas)\n";
        }
        echo "\n";
    }
    echo "Usage :\n";
    echo "  php rattraper_presence.php <sortie> <heures> --copier <heure source> [--ecrire]\n";
    echo "  php rattraper_presence.php <sortie> <heures> \"Nom1, Nom2\"           [--ecrire]\n";
    echo "  <heures> accepte plusieurs demi-heures : 20:00,20:30\n";
    exit(0);
}

// --- La sortie ------------------------------------------------------------
$cible = null;
foreach ($d['sorties'] ?? [] as $s) if (($s['id'] ?? '') === $sid) $cible = $s;
if (!$cible) { fwrite(STDERR, "Sortie « $sid » introuvable.\n"); exit(1); }

$noms  = $cible['presence']['noms']  ?? [];
$ticks = $cible['presence']['ticks'] ?? [];
if (!$noms) { fwrite(STDERR, "Cette sortie n'a aucun relevé : impossible de résoudre des noms.\n"); exit(1); }

echo "Sortie : « ", ($cible['titre'] ?? ''), " »   ", ($cible['date'] ?? ''), "\n";

// --- Les demi-heures visées ----------------------------------------------
// « 10:30 » suffit (le jour de la sortie est déduit) ; la forme complète
// « 2026-09-26T10:30 » sert aux sorties à cheval sur minuit.
$vers_cle = function ($h) use ($cible) {
    $h = trim($h);
    if (preg_match('/^\d{2}:\d{2}$/', $h))                          $k = (string)($cible['date'] ?? date('Y-m-d')) . 'T' . $h;
    elseif (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $h))     $k = $h;
    else return null;
    // Aligner sur la demi-heure : une case « 10:17 » ne serait comptée par personne.
    return substr($k, 0, 14) . ((int)substr($k, 14, 2) < 30 ? '00' : '30');
};

$cibles = [];
foreach (explode(',', $heures) as $h) {
    if (trim($h) === '') continue;
    $k = $vers_cle($h);
    if ($k === null) { fwrite(STDERR, "Heure illisible : « " . trim($h) . " ». Attendu « 20:00 » ou « 2026-09-26T20:00 ».\n"); exit(1); }
    if (!in_array($k, $cibles, true)) $cibles[] = $k;
}
if (!$cibles) { fwrite(STDERR, "Aucune demi-heure indiquée.\n"); exit(1); }

// --- Qui ? ----------------------------------------------------------------
// Comparaison tolérante : on recopie ces pseudos à la main, depuis un journal ou une
// capture. Les accents sont RAMENÉS à leur lettre de base avant comparaison — les
// retirer donnait « Quätrequart » → « qutrequart », qui ne retrouvait pas
// « Quatrequart » tapé sans tréma. Table explicite plutôt qu'iconv : aucune
// dépendance, aucun réglage de locale, résultat identique sur toute machine.
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

$ids = [];
if ($copier !== '') {
    $src = $vers_cle($copier);
    if ($src === null)            { fwrite(STDERR, "Heure source illisible : « $copier ».\n"); exit(1); }
    if (!isset($ticks[$src]))     {
        fwrite(STDERR, "La demi-heure source " . substr($src, 11) . " n'existe pas dans cette sortie.\n");
        fwrite(STDERR, "Demi-heures disponibles : " . implode(' ', array_map(function ($k) { return substr($k, 11); }, array_keys($ticks))) . "\n");
        exit(1);
    }
    $ids = array_values(array_unique(array_map('strval', $ticks[$src])));
    echo "Source : ", substr($src, 11), " (", count($ids), " présent(s))\n";
} elseif (trim($liste) !== '') {
    $parClef = [];
    foreach ($noms as $id => $n) $parClef[$clef($n)] = (string)$id;
    $inconnus = [];
    foreach (explode(',', $liste) as $brut) {
        $brut = trim($brut);
        if ($brut === '') continue;
        $k = $clef($brut);
        if (!isset($parClef[$k])) { $inconnus[] = $brut; continue; }
        if (!in_array($parClef[$k], $ids, true)) $ids[] = $parClef[$k];   // un doublon = une présence
    }
    if ($inconnus) {
        fwrite(STDERR, "\n🧨 Inconnu(s) sur cette sortie : " . implode(', ', $inconnus) . "\n");
        fwrite(STDERR, "Rien n'a été écrit. Relance sans liste pour voir les noms connus.\n");
        exit(1);
    }
} else {
    echo "\nPersonnes connues sur cette sortie :\n";
    foreach ($noms as $n) echo "   ", $n, "\n";
    echo "\nIndique qui, soit par --copier <heure>, soit par une liste entre guillemets.\n";
    exit(0);
}

// --- Récapitulatif --------------------------------------------------------
$affiche = [];
foreach ($ids as $id) $affiche[] = $noms[$id] ?? $id;
echo "\n", count($ids), " personne(s) : ", implode(', ', $affiche), "\n\n";
foreach ($cibles as $k) {
    $etat = isset($ticks[$k]) ? "existe déjà (" . count($ticks[$k]) . " présent(s)) — sera REMPLACÉE" : "absente — sera créée";
    echo "   ", substr($k, 11), "   ", $etat, "\n";
}

if (!$ecrire) { echo "\n(essai à blanc — ajoute --ecrire pour enregistrer)\n"; exit(0); }

// --- Écriture sous verrou, avec relecture --------------------------------
// Le fichier est partagé avec le site et le relevé automatique : on le relit à
// l'intérieur du verrou plutôt que de réécrire la copie chargée plus haut.
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
    foreach ($cibles as $k) $s['presence']['ticks'][$k] = $ids;
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

echo "\n✅ ", count($cibles), " demi-heure(s) enregistrée(s). Recharge la page (⟳ Actualiser) pour les voir.\n";
