<?php
// ============================================================
//  add_score_admin.php — ajoute un score À LA MAIN (CLI uniquement)
//
//  Pourquoi ce script existe : un score légitime peut avoir été refusé par
//  l'API (plafond anti-triche dépassé, panne réseau au moment de l'envoi…).
//  Le rejouer est illusoire — un record ne se refait pas sur commande. Il faut
//  donc pouvoir l'inscrire après coup, SANS bricoler les JSON à la main :
//  ce script réutilise les fonctions de scores_api.php, donc les mêmes verrous,
//  les mêmes sauvegardes automatiques, les mêmes droits 664 et les mêmes
//  annonces Discord qu'une soumission normale.
//
//  Usage :
//    php add_score_admin.php <jeu> <joueur> <score> [--annonce] [--dry]
//
//    --annonce  poste sur Discord comme l'aurait fait une soumission normale
//               (record all-time et/ou meneur de la semaine, selon le cas)
//    --dry      n'écrit rien, affiche seulement ce qui serait fait
//
//  Exemple :
//    php add_score_admin.php worm_rider Neuroch 142640 --annonce
//
//  À lancer en tant qu'utilisateur `dune` (propriétaire des fichiers de scores).
// ============================================================

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Ce script est réservé à la ligne de commande.\n");
}

require_once __DIR__ . '/scores_api.php';

$args = array_slice($argv, 1);
$flags = array_values(array_filter($args, fn($a) => str_starts_with($a, '--')));
$pos   = array_values(array_filter($args, fn($a) => !str_starts_with($a, '--')));

$annonce = in_array('--annonce', $flags, true);
$dry     = in_array('--dry', $flags, true);

if (count($pos) < 3) {
    exit("Usage : php add_score_admin.php <jeu> <joueur> <score> [--annonce] [--dry]\n"
       . "Jeux connus : " . implode(', ', array_keys(GAMES)) . "\n");
}

[$gameId, $player, $scoreRaw] = $pos;
$score = (int)$scoreRaw;

if (!isset(GAMES[$gameId])) {
    exit("Jeu inconnu : {$gameId}\nJeux connus : " . implode(', ', array_keys(GAMES)) . "\n");
}
$g = GAMES[$gameId];

if ($score <= 0) exit("Score invalide : {$score}\n");

// On applique le MÊME plafond qu'une soumission normale — celui qui SUIT le record
// établi (cf. score_ceiling()), pas la constante de GAMES. Si le score le dépasse,
// c'est le plafond qu'il faut revoir, pas ce contrôle qu'il faut contourner : sinon
// on réintroduit à la main le trou qu'on essaie de boucher.
$plafond = score_ceiling($gameId);
if ($score > $plafond) {
    exit("Score {$score} au-dessus du plafond de {$gameId} ({$plafond}).\n"
       . "Plancher GAMES = {$g['max_score']}, record actuel × " . SCORE_CEILING_FACTOR . " = {$plafond}.\n"
       . "Inscris d'abord le score intermédiaire, ou relève le plancher si ce score est légitime.\n");
}

$now = time();
$resume = [];

foreach (['alltime', 'weekly'] as $scope) {
    $avant = read_scores($scope);
    $podiumAvant = podium_top3($avant, $gameId);
    $recordAvant = $podiumAvant[0]['score']  ?? 0;
    $tenantAvant = $podiumAvant[0]['player'] ?? '';

    $bestPerso = 0;
    foreach ($avant as $e) {
        if (($e['player'] ?? '') === $player && ($e['game'] ?? '') === $gameId && ($e['score'] ?? 0) > $bestPerso) {
            $bestPerso = $e['score'];
        }
    }

    if ($score <= $bestPerso) {
        $resume[$scope] = "inchangé — {$player} a déjà {$bestPerso} sur ce classement";
        continue;
    }

    if ($dry) {
        $resume[$scope] = "AJOUTERAIT {$score} (perso avant : {$bestPerso}, record : {$recordAvant} par {$tenantAvant})";
        continue;
    }

    with_scores_lock($scope, function (array $all) use ($player, $gameId, $score, $now) {
        // Même règle que l'API : une seule entrée par (joueur, jeu), remplacée
        // uniquement par un meilleur score.
        $all = array_values(array_filter($all, fn($e) =>
            !(($e['player'] ?? '') === $player && ($e['game'] ?? '') === $gameId)));
        $all[] = ['player' => $player, 'game' => $gameId, 'score' => $score,
                  'duration' => 0, 'ts' => $now, 'manual' => true];
        return ['data' => $all];
    });

    $apres = read_scores($scope);
    $rang  = podium_rank(podium_top3($apres, $gameId), $player);
    $resume[$scope] = "ajouté — rang " . ($rang ?? '>3')
                    . " (record avant : {$recordAvant}" . ($tenantAvant ? " par {$tenantAvant}" : '') . ")";

    if ($annonce && $scope === 'alltime' && $score > $recordAvant) {
        $podiumApres = podium_top3($apres, $gameId);
        notify_discord_rank1($gameId, $player, $score, $recordAvant, $tenantAvant, null, $podiumApres);
        $resume['annonce_alltime'] = 'record all-time posté sur Discord';
    }
    if ($annonce && $scope === 'weekly' && $score > $recordAvant) {
        notify_discord_weekly_record($gameId, $player, $score, $recordAvant, $tenantAvant);
        $resume['annonce_weekly'] = 'meneur de la semaine posté sur Discord';
    }
}

echo ($dry ? "[dry-run] " : "") . "{$g['name']} — {$player} : {$score}\n";
foreach ($resume as $k => $v) echo "  {$k} : {$v}\n";
if (!$annonce) echo "  (aucune annonce Discord — ajouter --annonce pour la poster)\n";
