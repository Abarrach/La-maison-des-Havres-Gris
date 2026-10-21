<?php
// ============================================================
//  APERÇU — lire le message de partage avant de le publier
// ============================================================
// Le bouton « Publier sur Discord » envoie un message définitif dans un salon de guilde.
// Sans moyen de le relire d'abord, la seule façon de savoir ce qu'il contient est de
// faire confiance à celui qui a touché au code — ce qui a déjà conduit à retarder un
// déploiement par prudence, faute de pouvoir vérifier.
//
//   php epice/apercu_partage.php               → liste les sorties qui ont un partage
//   php epice/apercu_partage.php <id sortie>   → affiche le message, au caractère près
//
// Il lit les fonctions DU FICHIER DÉPLOYÉ (data-api.php) et les données réelles : ce
// qu'il affiche est ce que Discord recevrait. Rien n'est envoyé, rien n'est écrit.
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI uniquement.\n"); }
date_default_timezone_set('Europe/Paris');

$API  = __DIR__ . '/data-api.php';
$DATA = __DIR__ . '/data/debriefs.json';

foreach ([$API, $DATA] as $f)
    if (!file_exists($f)) { fwrite(STDERR, "Introuvable : $f\n"); exit(1); }

// On extrait les fonctions au lieu d'inclure data-api.php, qui démarre une session et
// exige une authentification : ce script doit tourner depuis une console, sans cookie.
$src = file_get_contents($API);
foreach (['parts_presence', 'message_parts'] as $fn) {
    if (!preg_match('/\nfunction ' . $fn . '\(.*?\n\}\r?\n/s', $src, $m)) {
        fwrite(STDERR, "Fonction $fn() introuvable dans data-api.php — le fichier a-t-il été déployé ?\n");
        exit(2);
    }
    eval($m[0]);
}

$d = json_decode(file_get_contents($DATA), true);
if (!is_array($d)) { fwrite(STDERR, "debriefs.json illisible\n"); exit(1); }

$sid = $argv[1] ?? '';

if ($sid === '') {
    $n = 0;
    foreach ($d['sorties'] ?? [] as $s) {
        if (empty($s['presence']['ticks'])) continue;
        $n++;
        $r = parts_presence($s);
        printf("%-26s %s  « %s »%s", $s['id'], ($s['date'] ?? ''), ($s['titre'] ?? ''), PHP_EOL);
        printf("   %d demi-heure(s), %d point(s), volume %s%s%s",
            $r['nb_ticks'], $r['total_points'],
            $r['volume'] > 0 ? number_format($r['volume'], 0, ',', ' ') : 'NON SAISI',
            !empty($s['presence']['publie']) ? '   [déjà publié]' : '', PHP_EOL);
    }
    if (!$n) echo "Aucune sortie n'a de relevé de présence.\n";
    else     echo PHP_EOL . "Relance avec un identifiant pour lire le message.\n";
    exit(0);
}

$cible = null;
foreach ($d['sorties'] ?? [] as $s) if (($s['id'] ?? '') === $sid) $cible = $s;
if (!$cible) { fwrite(STDERR, "Sortie « $sid » introuvable.\n"); exit(1); }

$r = parts_presence($cible);
if ($r['total_points'] <= 0) { fwrite(STDERR, "Aucune présence relevée : rien à publier.\n"); exit(1); }
if ($r['volume'] <= 0)       { fwrite(STDERR, "Volume non saisi : le site refusera de publier.\n"); exit(1); }

$msg = message_parts($cible, $r);
echo str_repeat('─', 60), PHP_EOL, $msg, PHP_EOL, str_repeat('─', 60), PHP_EOL;

// Un message Discord est rejeté EN ENTIER au-delà de 2000 caractères : autant le savoir
// ici plutôt qu'au clic.
$n = strlen($msg);
printf("%d caractères sur 2000%s%s", $n,
    $n > 2000 ? '  ⚠ TROP LONG, Discord refusera le message' : '', PHP_EOL);
printf("Somme des parts : %s + %s de reliquat = %s (récolte %s)%s",
    number_format($r['distribue'], 0, ',', ' '), $r['reliquat'],
    number_format($r['distribue'] + $r['reliquat'], 0, ',', ' '),
    number_format($r['volume'], 0, ',', ' '), PHP_EOL);
