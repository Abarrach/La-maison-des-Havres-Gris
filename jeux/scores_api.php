<?php
// ============================================================
//  API Scores — Hub de jeux
//
//  Actions :
//    submit   — soumet un score (auth session obligatoire)
//    leaderboard — top N d'un jeu (ou global), scope=weekly|alltime
//    my_scores — scores du joueur connecté
//    games    — liste des jeux connus
//
//  Stockage : jeux/data/scores.json (Hall of Fame, all-time, jamais remis à
//  zéro) + jeux/data/scores_weekly.json (semaine en cours, remis à zéro par
//  weekly_reset.php le mardi 05:00 UTC — cf. tempête de Coriolis). Même format,
//  mêmes règles anti-triche ; un score soumis alimente les DEUX classements.
//  Gitignorés (jeux/data/.gitignore : *). Les deux fichiers doivent rester en
//  664 dune:www-data : le site (www-data) écrit, le cron (dune) remet à zéro.
//  Anti-triche : hash signé côté client + plafond par jeu + cooldown
// ============================================================

require_once __DIR__ . '/../discord_oauth.php';
header('Content-Type: application/json; charset=utf-8');

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? ($_GET['action'] ?? '');

// ---- Jeux connus (id => config anti-triche + méta) ----
const GAMES = [
    'orni_flap' => [
        'name'      => 'Ornithopter Flap',
        'max_score' => 9999,
        'cooldown'  => 2,
    ],
    'spice_runner' => [
        'name'      => 'Spice Runner',
        'max_score' => 99999,
        'cooldown'  => 3,
    ],
    'sandstorm_memory' => [
        'name'      => 'Sandstorm Memory',
        'max_score' => 50000,
        'cooldown'  => 2,
    ],
    'worm_rider' => [
        'name'      => 'Worm Rider',
        'max_score' => 99999,
        'cooldown'  => 3,
    ],
    'muaddib_rescue' => [
        'name'      => "Muad'Dib Rescue",
        'max_score' => 50000,
        'cooldown'  => 2,
    ],
];

// ---- Secret pour le hash anti-triche ----
function score_secret(): string {
    $f = __DIR__ . '/data/score_secret.txt';
    if (file_exists($f)) return trim(file_get_contents($f));
    $s = bin2hex(random_bytes(32));
    @mkdir(dirname($f), 0775, true);
    file_put_contents($f, $s);
    return $s;
}

// ---- Stockage ----
// scope 'alltime' → scores.json (Hall of Fame, jamais remis à zéro)
// scope 'weekly'  → scores_weekly.json (remis à zéro par weekly_reset.php)
function scores_file(string $scope = 'alltime'): string {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . ($scope === 'weekly' ? '/scores_weekly.json' : '/scores.json');
}
function read_scores(string $scope = 'alltime'): array {
    // Lecture "hors verrou" : uniquement pour les actions en lecture seule
    // (leaderboard, my_scores). Ne jamais s'en servir comme base d'une écriture.
    $f = scores_file($scope);
    if (!file_exists($f)) return [];
    return json_decode(file_get_contents($f), true) ?? [];
}

// ---- Sauvegardes automatiques ----
// Déclenchées par le trafic normal (pas besoin de cron sur le serveur) :
// à chaque écriture, on garde un instantané du jour (jamais écrasé une fois
// créé) + une copie de la toute dernière version connue. Objectif : si un
// bug ou une manip malheureuse vide/corrompt un fichier de scores, on peut
// toujours restaurer un état récent depuis data/backups(_weekly)/.
function backups_dir(string $scope = 'alltime'): string {
    $dir = __DIR__ . '/data/backups' . ($scope === 'weekly' ? '_weekly' : '');
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}
function backup_scores(array $data, string $scope = 'alltime'): void {
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    $dir = backups_dir($scope);

    $daily = $dir . '/scores_' . date('Y-m-d') . '.json';
    if (!file_exists($daily)) @file_put_contents($daily, $json);
    @file_put_contents($dir . '/scores_last.json', $json);

    // Purge : ne garde que les 14 derniers instantanés quotidiens.
    $files = glob($dir . '/scores_????-??-??.json');
    if ($files && count($files) > 14) {
        sort($files);
        foreach (array_slice($files, 0, count($files) - 14) as $old) @unlink($old);
    }
}

// Lit + modifie + réécrit un fichier de scores sous un seul verrou exclusif,
// pour éviter qu'une écriture concurrente écrase les données d'une autre
// (deux joueurs qui soumettent en même temps ne doivent jamais se marcher dessus).
function with_scores_lock(string $scope, callable $mutator) {
    $path  = scores_file($scope);
    $isNew = !file_exists($path);
    $fp = @fopen($path, 'c+');
    if (!$fp) return null;
    // Fichier créé par www-data → umask 022 → 644, donc NON inscriptible par le
    // groupe. weekly_reset.php tourne en tant que dune : sans écriture groupe, il
    // ne peut pas remettre scores_weekly.json à zéro (panne du 21/07/2026).
    if ($isNew) @chmod($path, 0664);
    if (!flock($fp, LOCK_EX)) { fclose($fp); return null; }

    rewind($fp);
    $raw = stream_get_contents($fp);
    $data = json_decode($raw, true);
    if (!is_array($data)) $data = [];

    // Sauvegarde l'état AVANT écriture : même si ce qui suit tourne mal,
    // on ne perd jamais plus que les tout derniers changements.
    backup_scores($data, $scope);

    $result = $mutator($data);

    // Garde-fou de diagnostic : une écriture qui viderait complètement un
    // classement non-vide ne devrait normalement jamais arriver hors reset
    // hebdo volontaire (déjà vu une fois par le passé sur l'all-time) — on la
    // laisse passer mais on la journalise pour pouvoir enquêter si ça se reproduit.
    if ($scope === 'alltime' && !empty($data) && empty($result['data'])) {
        @file_put_contents(__DIR__ . '/data/scores_wipe_debug.log',
            date('c') . " ATTENTION: écriture qui vide scores.json (" . count($data) . " -> 0 entrées)\n",
            FILE_APPEND);
    }

    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($result['data'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    return $result;
}

// ---- Podium (top 3) d'un jeu, à partir d'une liste d'entrées ----
function podium_top3(array $all, string $gameId): array {
    $entries = array_values(array_filter($all, fn($e) => ($e['game'] ?? '') === $gameId));
    usort($entries, fn($a, $b) => ($b['score'] ?? 0) - ($a['score'] ?? 0));
    return array_slice($entries, 0, 3);
}
// Rang (1-3) d'un joueur dans un podium donné, ou null s'il n'y est pas.
function podium_rank(array $podium, string $player): ?int {
    foreach ($podium as $i => $e) {
        if (($e['player'] ?? '') === $player) return $i + 1;
    }
    return null;
}

// ---- Webhook Discord (podium) ----
function discord_webhook_url(): ?string {
    $f = __DIR__ . '/data/discord_webhook.txt';
    if (!file_exists($f)) return null;
    $url = trim(file_get_contents($f));
    return ($url === '' || !function_exists('curl_init')) ? null : $url;
}

function send_discord_embed(array $embed): void {
    $url = discord_webhook_url();
    if ($url === null) return;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['embeds' => [$embed]], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

// Relance ajoutée au message quand cette soumission éjecte l'ancien 3ème du podium.
function ousted_note(?array $ousted, string $gameName, ?array $newPodium): string {
    if ($ousted === null || !isset($newPodium[2])) return '';
    $seuil = $newPodium[2]['score'];
    return "\n\n─────────\n"
         . "🌪️ **{$ousted['player']}**, le vent de sable vient de t'arracher ta 3ème place ! "
         . "Score à dépasser pour la reprendre : **{$seuil}**. "
         . "Le désert ne pardonne qu'aux plus déterminés — retourne sur **{$gameName}** et reprends ce qui t'appartient 🔥";
}

function notify_discord_rank1(string $game, string $player, int $score, int $oldRecord, string $oldHolder, ?array $ousted, ?array $newPodium): void {
    $g = GAMES[$game] ?? null;
    $gameName = $g ? $g['name'] : $game;
    // Lien direct vers le jeu (le nom de fichier correspond à l'id du jeu),
    // pour que le clic sur le message ramène droit dessus et relance l'envie de jouer.
    $link = 'https://havresgris.ddns.net/jeux/' . rawurlencode($game) . '.html';

    if ($oldHolder === $player) {
        $title = "🥇 Record amélioré — {$gameName}";
        $desc  = "**{$player}** garde la tête sur **{$gameName}** et repousse encore la limite du désert !\n\n"
               . "🏆 Nouveau record : **{$score}** (précédent : {$oldRecord})\n\n"
               . "▶️ [Défie-le sur {$gameName}]({$link})";
    } else {
        $title = "🥇 Nouveau record — {$gameName}";
        $desc  = "**{$player}** s'empare de la 1ère place sur **{$gameName}** ! Le sable a un nouveau maître 🐛\n\n"
               . "🏆 Nouveau record : **{$score}**\n";
        if ($oldRecord > 0) {
            $desc .= "📉 Ancien record : {$oldRecord} (par {$oldHolder})\n";
        }
        $desc .= "\n▶️ [Défie-le sur {$gameName}]({$link})";
    }

    $desc .= ousted_note($ousted, $gameName, $newPodium);

    send_discord_embed([
        'title'       => $title,
        'url'         => $link,
        'description' => $desc,
        'color'       => hexdec('D4A23B'),
        'footer'      => ['text' => 'Hub de jeux — Les Havres Gris'],
    ]);
}

function notify_discord_rank2(string $game, string $player, int $score, array $newPodium, ?array $ousted): void {
    $g = GAMES[$game] ?? null;
    $gameName = $g ? $g['name'] : $game;
    $link = 'https://havresgris.ddns.net/jeux/' . rawurlencode($game) . '.html';
    $leader = $newPodium[0]['player'] ?? '?';
    $gap = max(0, ($newPodium[0]['score'] ?? 0) - $score);

    $desc = "**{$player}** plante sa tente sur le podium de **{$gameName}** et prend la **2ème place** !\n\n"
          . "⚡ Score : **{$score}**\n"
          . "🎯 Encore **{$gap}** points avant de renverser **{$leader}** et prendre le pouvoir !\n\n"
          . "▶️ [Tente ta chance sur {$gameName}]({$link})";

    $desc .= ousted_note($ousted, $gameName, $newPodium);

    send_discord_embed([
        'title'       => "🥈 2ème place — {$gameName}",
        'url'         => $link,
        'description' => $desc,
        'color'       => hexdec('C0C0C0'),
        'footer'      => ['text' => 'Hub de jeux — Les Havres Gris'],
    ]);
}

function notify_discord_rank3(string $game, string $player, int $score, ?array $ousted, ?array $newPodium): void {
    $g = GAMES[$game] ?? null;
    $gameName = $g ? $g['name'] : $game;
    $link = 'https://havresgris.ddns.net/jeux/' . rawurlencode($game) . '.html';

    $desc = "**{$player}** s'invite sur le podium de **{$gameName}** et arrache la **3ème place** !\n\n"
          . "⚡ Score : **{$score}**\n\n"
          . "▶️ [Monte sur le podium toi aussi sur {$gameName}]({$link})";

    $desc .= ousted_note($ousted, $gameName, $newPodium);

    send_discord_embed([
        'title'       => "🥉 3ème place — {$gameName}",
        'url'         => $link,
        'description' => $desc,
        'color'       => hexdec('CD7F32'),
        'footer'      => ['text' => 'Hub de jeux — Les Havres Gris'],
    ]);
}

// ---- Webhook Discord (meneur de la semaine battu) ----
// Distinct du podium all-time (notify_discord_rank1/2/3 ci-dessus) : sert le
// principe d'interaction du reset hebdo — sans ce message, personne ne sait
// qu'un défi est en cours et personne ne le relève. Couleur différente
// (bleu Discord au lieu de l'or) pour ne pas le confondre avec un vrai record
// all-time / Hall of Fame au premier coup d'œil dans le salon.
function notify_discord_weekly_record(string $game, string $player, int $score, int $oldRecord, string $oldHolder): void {
    $f = __DIR__ . '/data/discord_webhook.txt';
    if (!file_exists($f)) return;
    $url = trim(file_get_contents($f));
    if ($url === '' || !function_exists('curl_init')) return;

    $g = GAMES[$game] ?? null;
    $gameName = $g ? $g['name'] : $game;
    $link = 'https://havresgris.ddns.net/jeux/' . rawurlencode($game) . '.html';

    $desc = "**{$player}** prend la tête du classement **de la semaine** sur **{$gameName}** !\n\n"
          . "🥇 Score : **{$score}**\n";
    if ($oldRecord > 0) {
        $desc .= "📉 Ancien meneur de la semaine : {$oldRecord} (par {$oldHolder})\n";
    }
    $desc .= "\n🗓️ Classement remis à zéro chaque mardi (tempête de Coriolis) — ce score ne rejoint le Hall of Fame que s'il bat aussi le record all-time.\n"
          . "\n▶️ [Relève le défi sur {$gameName}]({$link})";

    $embed = [
        'title'       => "🗓️ Nouveau meneur de la semaine — {$gameName}",
        'url'         => $link,
        'description' => $desc,
        'color'       => hexdec('5865F2'),
        'footer'      => ['text' => 'Hub de jeux — Les Havres Gris · classement hebdomadaire'],
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['embeds' => [$embed]], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

// ---- Test CLI uniquement (jamais exposé au web) : poste un exemple de chaque
// notif Discord liée aux scores (rank1/2/3 all-time + meneur de la semaine) sans
// toucher à scores.json / scores_weekly.json — utile pour valider un webhook
// après un changement, sans devoir vraiment battre un record en jouant.
//   php scores_api.php --test-discord [game_id]
if (PHP_SAPI === 'cli' && in_array('--test-discord', $argv ?? [], true)) {
    $gid = $argv[2] ?? 'worm_rider';
    if (!isset(GAMES[$gid])) { fwrite(STDERR, "jeu inconnu : $gid\n"); exit(1); }
    // Podium fictif pour ousted_note : l'ancien 3ème se fait éjecter par notre nouveau score.
    $fakePodium = [
        ['player' => 'TestPlayer',    'score' => 99999],
        ['player' => 'DeuxiemeJoueur','score' => 87000],
        ['player' => 'AncienTroisieme','score' => 50000],
    ];
    $fakeOusted = ['player' => 'EjecteDuPodium', 'score' => 42000];
    echo "Envoi 🥇 rank1 (record all-time) sur {$gid}...\n";
    notify_discord_rank1($gid, 'TestPlayer', 99999, 12345, 'AncienChampion', $fakeOusted, $fakePodium);
    echo "Envoi 🥈 rank2 sur {$gid}...\n";
    notify_discord_rank2($gid, 'TestPlayer', 87000, $fakePodium, null);
    echo "Envoi 🥉 rank3 sur {$gid}...\n";
    notify_discord_rank3($gid, 'TestPlayer', 50000, null, $fakePodium);
    echo "Envoi 🗓️ meneur de la semaine sur {$gid}...\n";
    notify_discord_weekly_record($gid, 'TestPlayer', 500, 179, 'AncienMeneur');
    echo "Terminé — vérifie le salon Discord pointé par jeux/data/discord_webhook.txt.\n";
    exit;
}

// ================================================================
//  ACTIONS
// ================================================================

if ($action === 'games') {
    $out = [];
    foreach (GAMES as $id => $g) {
        $out[] = ['id' => $id, 'name' => $g['name']];
    }
    echo json_encode(['ok' => true, 'games' => $out]);
    exit;
}

if ($action === 'leaderboard') {
    $gameId = $input['game'] ?? ($_GET['game'] ?? '');
    $limit  = min((int)($input['limit'] ?? 20), 100);
    $scope  = ($input['scope'] ?? ($_GET['scope'] ?? 'alltime')) === 'weekly' ? 'weekly' : 'alltime';
    $all    = read_scores($scope);

    $entries = [];
    foreach ($all as $e) {
        if ($gameId !== '' && ($e['game'] ?? '') !== $gameId) continue;
        $entries[] = $e;
    }

    usort($entries, fn($a, $b) => ($b['score'] ?? 0) - ($a['score'] ?? 0));
    $entries = array_slice($entries, 0, $limit);

    echo json_encode(['ok' => true, 'leaderboard' => $entries, 'scope' => $scope]);
    exit;
}

if ($action === 'my_scores') {
    $user = $_SESSION['user'] ?? '';
    if ($user === '') { echo json_encode(['ok' => false, 'error' => 'no_session']); exit; }
    $gameId = $input['game'] ?? ($_GET['game'] ?? '');
    $all    = read_scores();

    $mine = [];
    foreach ($all as $e) {
        if (($e['player'] ?? '') !== $user) continue;
        if ($gameId !== '' && ($e['game'] ?? '') !== $gameId) continue;
        $mine[] = $e;
    }
    usort($mine, fn($a, $b) => ($b['score'] ?? 0) - ($a['score'] ?? 0));

    echo json_encode(['ok' => true, 'scores' => array_slice($mine, 0, 50)]);
    exit;
}

if ($action === 'submit') {
    $user = $_SESSION['user'] ?? '';
    if ($user === '') { echo json_encode(['ok' => false, 'error' => 'no_session']); exit; }

    $gameId = $input['game']  ?? '';
    $score  = (int)($input['score'] ?? 0);
    $hash   = $input['hash']  ?? '';
    $dur    = (int)($input['duration'] ?? 0);

    if (!isset(GAMES[$gameId])) { echo json_encode(['ok' => false, 'error' => 'unknown_game']); exit; }
    $g = GAMES[$gameId];

    // Anti-triche : plafond
    if ($score <= 0 || $score > $g['max_score']) {
        echo json_encode(['ok' => false, 'error' => 'invalid_score']); exit;
    }

    // Anti-triche : hash = sha256(game + score + duration + secret)
    $expected = hash('sha256', $gameId . $score . $dur . score_secret());
    if ($hash !== $expected) {
        echo json_encode(['ok' => false, 'error' => 'invalid_hash']); exit;
    }

    // Remplace l'entrée (player, game) existante par le nouveau score UNIQUEMENT
    // s'il bat le meilleur score déjà connu dans ce store — jamais on n'efface
    // un meilleur score par un moins bon. Utilisé identiquement pour le store
    // all-time (Hall of Fame) et le store hebdomadaire.
    $upsert_best = function (array $all, string $user, string $gameId, int $score, int $dur, int $now, float $bestPerso): array {
        if ($score <= $bestPerso) return $all;
        $all = array_values(array_filter($all, function ($e) use ($user, $gameId) {
            return !(($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId);
        }));
        $all[] = ['player' => $user, 'game' => $gameId, 'score' => $score, 'duration' => $dur, 'ts' => $now];
        return $all;
    };

    // Tout le cycle lecture → vérif cooldown → fusion → écriture se fait
    // sous un seul verrou exclusif, pour ne jamais écraser un score soumis
    // par un autre joueur au même moment. Le cooldown/anti-triche est
    // tranché UNE SEULE FOIS sur le store all-time (continu, jamais remis à
    // zéro) : ça évite qu'un reset hebdo serve de fenêtre pour contourner le
    // cooldown juste après une remise à zéro du store hebdomadaire.
    $now = time();
    $cooldownHit = false;
    $oldRecord = 0; $oldHolder = '';
    $bestPerso = 0;
    $oldPodium = []; $newPodium = [];

    $result = with_scores_lock('alltime', function (array $all) use ($user, $gameId, $g, $score, $dur, $now, $upsert_best, &$cooldownHit, &$oldRecord, &$oldHolder, &$bestPerso, &$oldPodium, &$newPodium) {
        // Anti-triche : cooldown (pas 2 scores en moins de N secondes)
        foreach ($all as $e) {
            if (($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId) {
                if ($now - ($e['ts'] ?? 0) < $g['cooldown']) {
                    $cooldownHit = true;
                    return ['data' => $all];
                }
            }
        }

        // Podium (et record) avant cette soumission.
        $oldPodium = podium_top3($all, $gameId);
        $oldRecord = $oldPodium[0]['score'] ?? 0;
        $oldHolder = $oldPodium[0]['player'] ?? '';

        // Meilleur score perso ?
        foreach ($all as $e) {
            if (($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId && ($e['score'] ?? 0) > $bestPerso) {
                $bestPerso = $e['score'];
            }
        }

        // Fusion mutualisée avec le store hebdo (cf. $upsert_best) — corrige au
        // passage l'ancien bug où l'entrée était filtrée puis pas réécrite si le
        // nouveau score était plus bas, ce qui effaçait le record perso.
        $all = $upsert_best($all, $user, $gameId, $score, $dur, $now, $bestPerso);

        // Podium après cette soumission (identique à l'ancien si le score ne
        // battait pas le record perso, puisque $all n'a alors pas bougé).
        $newPodium = podium_top3($all, $gameId);

        return ['data' => $all];
    });

    if ($result === null) { echo json_encode(['ok' => false, 'error' => 'storage_error']); exit; }
    if ($cooldownHit) { echo json_encode(['ok' => false, 'error' => 'cooldown']); exit; }

    // Score accepté (anti-triche OK) : alimente aussi le classement hebdomadaire
    // (remis à zéro le mardi par weekly_reset.php), indépendamment du all-time.
    // On repère aussi le meneur hebdo AVANT écriture, pour savoir s'il vient de
    // changer (notif Discord dédiée, distincte du record all-time — cf. plus bas).
    $oldWeeklyRecord = 0; $oldWeeklyHolder = '';
    $weeklyResult = with_scores_lock('weekly', function (array $weekly) use ($user, $gameId, $score, $dur, $now, $upsert_best, &$oldWeeklyRecord, &$oldWeeklyHolder) {
        $bestWeek = 0;
        foreach ($weekly as $e) {
            if (($e['game'] ?? '') === $gameId && ($e['score'] ?? 0) > $oldWeeklyRecord) {
                $oldWeeklyRecord = $e['score'];
                $oldWeeklyHolder = $e['player'] ?? '?';
            }
            if (($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId && ($e['score'] ?? 0) > $bestWeek) {
                $bestWeek = $e['score'];
            }
        }
        return ['data' => $upsert_best($weekly, $user, $gameId, $score, $dur, $now, $bestWeek)];
    });

    $isNewRecord = $score > $oldRecord;
    $isNewPersonal = $score > $bestPerso;
    $newRank = podium_rank($newPodium, $user);
    $oldRank = podium_rank($oldPodium, $user);

    // Ancien 3ème qui vient de se faire sortir du podium par cette soumission
    // (jamais le joueur qui soumet lui-même : s'il progresse, il n'est pas "éjecté").
    $ousted = null;
    if (isset($oldPodium[2])) {
        $oustedPlayer = $oldPodium[2]['player'] ?? '';
        if ($oustedPlayer !== '' && $oustedPlayer !== $user && podium_rank($newPodium, $oustedPlayer) === null) {
            $ousted = $oldPodium[2];
        }
    }

    // Meneur de la semaine : distinct du podium all-time. On ne le notifie QUE si
    // aucune notif podium n'est déclenchée (sinon double message pour la même
    // performance, le joueur reçoit déjà une notif dorée plus importante), et que
    // l'écriture hebdo a RÉELLEMENT réussi ($weeklyResult !== null — sinon
    // $oldWeeklyRecord reste à 0 et TOUT score semblerait battre "le meneur",
    // même si rien n'est enregistré, ex. dossier data/ non inscriptible).
    $isPodiumNotif = $isNewRecord
                  || ($newRank === 2 && $oldRank !== 2)
                  || ($newRank === 3 && $oldRank !== 3);
    $isNewWeeklyRecord = $weeklyResult !== null && !$isPodiumNotif && $score > $oldWeeklyRecord;

    // On choisit la notif — au plus UNE par soumission (podium OU meneur hebdo).
    $notifyFn = null;
    if ($isNewRecord) {
        $notifyFn = fn() => notify_discord_rank1($gameId, $user, $score, $oldRecord, $oldHolder, $ousted, $newPodium);
    } elseif ($newRank === 2 && $oldRank !== 2) {
        $notifyFn = fn() => notify_discord_rank2($gameId, $user, $score, $newPodium, $ousted);
    } elseif ($newRank === 3 && $oldRank !== 3) {
        $notifyFn = fn() => notify_discord_rank3($gameId, $user, $score, $ousted, $newPodium);
    } elseif ($isNewWeeklyRecord) {
        $notifyFn = fn() => notify_discord_weekly_record($gameId, $user, $score, $oldWeeklyRecord, $oldWeeklyHolder);
    }

    $payload = ['ok' => true, 'new_record' => $isNewRecord, 'new_weekly_record' => $isNewWeeklyRecord, 'new_personal' => $isNewPersonal, 'score' => $score];

    if ($notifyFn !== null) {
        if (function_exists('fastcgi_finish_request')) {
            echo json_encode($payload);
            fastcgi_finish_request();
        }
        $notifyFn();
        if (!function_exists('fastcgi_finish_request')) {
            echo json_encode($payload);
        }
    } else {
        echo json_encode($payload);
    }
    exit;
}

// Token anti-triche : le client le demande au début de partie
if ($action === 'token') {
    $gameId = $input['game'] ?? '';
    if (!isset(GAMES[$gameId])) { echo json_encode(['ok' => false]); exit; }
    echo json_encode(['ok' => true, 'secret' => score_secret()]);
    exit;
}

echo json_encode(['ok' => false, 'error' => 'unknown_action']);
