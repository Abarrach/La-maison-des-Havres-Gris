<?php
// ============================================================
//  API Scores — Hub de jeux
//
//  Actions :
//    submit   — soumet un score (auth session obligatoire)
//    leaderboard — top N d'un jeu (ou global)
//    my_scores — scores du joueur connecté
//    games    — liste des jeux connus
//
//  Stockage : jeux/data/scores.json  (gitignoré)
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
function scores_file(): string {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/scores.json';
}
function read_scores(): array {
    // Lecture "hors verrou" : uniquement pour les actions en lecture seule
    // (leaderboard, my_scores). Ne jamais s'en servir comme base d'une écriture.
    $f = scores_file();
    if (!file_exists($f)) return [];
    return json_decode(file_get_contents($f), true) ?? [];
}

// Lit + modifie + réécrit le fichier de scores sous un seul verrou exclusif,
// pour éviter qu'une écriture concurrente écrase les données d'une autre
// (deux joueurs qui soumettent en même temps ne doivent jamais se marcher dessus).
function with_scores_lock(callable $mutator) {
    $fp = @fopen(scores_file(), 'c+');
    if (!$fp) return null;
    if (!flock($fp, LOCK_EX)) { fclose($fp); return null; }

    rewind($fp);
    $raw = stream_get_contents($fp);
    $data = json_decode($raw, true);
    if (!is_array($data)) $data = [];

    $result = $mutator($data);

    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($result['data'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    return $result;
}

// ---- Webhook Discord (record battu) ----
function notify_discord_record(string $game, string $player, int $score, int $oldRecord, string $oldHolder): void {
    $f = __DIR__ . '/data/discord_webhook.txt';
    if (!file_exists($f)) return;
    $url = trim(file_get_contents($f));
    if ($url === '' || !function_exists('curl_init')) return;

    $g = GAMES[$game] ?? null;
    $gameName = $g ? $g['name'] : $game;

    // Lien direct vers le jeu (le nom de fichier correspond à l'id du jeu),
    // pour que le clic sur le message ramène droit dessus et relance l'envie de jouer.
    $link = 'https://havresgris.ddns.net/jeux/' . rawurlencode($game) . '.html';

    $desc = "**{$player}** vient de battre le record sur **{$gameName}** !\n\n"
          . "🏆 Nouveau record : **{$score}**\n";
    if ($oldRecord > 0) {
        $desc .= "📉 Ancien record : {$oldRecord} (par {$oldHolder})\n";
    }
    $desc .= "\n▶️ [Défie-le sur {$gameName}]({$link})";

    $embed = [
        'title'       => "🎮 Nouveau record — {$gameName}",
        'url'         => $link,
        'description' => $desc,
        'color'       => hexdec('D4A23B'),
        'footer'      => ['text' => 'Hub de jeux — Les Havres Gris'],
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
    $all    = read_scores();

    $entries = [];
    foreach ($all as $e) {
        if ($gameId !== '' && ($e['game'] ?? '') !== $gameId) continue;
        $entries[] = $e;
    }

    usort($entries, fn($a, $b) => ($b['score'] ?? 0) - ($a['score'] ?? 0));
    $entries = array_slice($entries, 0, $limit);

    echo json_encode(['ok' => true, 'leaderboard' => $entries]);
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

    // Tout le cycle lecture → vérif cooldown → fusion → écriture se fait
    // sous un seul verrou exclusif, pour ne jamais écraser un score soumis
    // par un autre joueur au même moment.
    $now = time();
    $cooldownHit = false;
    $oldRecord = 0; $oldHolder = '';
    $bestPerso = 0;

    $result = with_scores_lock(function (array $all) use ($user, $gameId, $g, $score, $dur, $now, &$cooldownHit, &$oldRecord, &$oldHolder, &$bestPerso) {
        // Anti-triche : cooldown (pas 2 scores en moins de N secondes)
        foreach ($all as $e) {
            if (($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId) {
                if ($now - ($e['ts'] ?? 0) < $g['cooldown']) {
                    $cooldownHit = true;
                    return ['data' => $all];
                }
            }
        }

        // Record actuel ?
        foreach ($all as $e) {
            if (($e['game'] ?? '') === $gameId && ($e['score'] ?? 0) > $oldRecord) {
                $oldRecord = $e['score'];
                $oldHolder = $e['player'] ?? '?';
            }
        }

        // Meilleur score perso ?
        foreach ($all as $e) {
            if (($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId && ($e['score'] ?? 0) > $bestPerso) {
                $bestPerso = $e['score'];
            }
        }

        // On ne remplace l'entrée existante que si ce score bat le record perso.
        // Sinon on ne touche surtout pas à $all : l'ancien meilleur score doit
        // rester en place (avant, il était supprimé par le filtre puis jamais
        // réécrit si le nouveau score était plus bas — ça effaçait le record).
        if ($score > $bestPerso) {
            $all = array_values(array_filter($all, function ($e) use ($user, $gameId) {
                return !(($e['player'] ?? '') === $user && ($e['game'] ?? '') === $gameId);
            }));
            $all[] = [
                'player'   => $user,
                'game'     => $gameId,
                'score'    => $score,
                'duration' => $dur,
                'ts'       => $now,
            ];
        }

        return ['data' => $all];
    });

    if ($result === null) { echo json_encode(['ok' => false, 'error' => 'storage_error']); exit; }
    if ($cooldownHit) { echo json_encode(['ok' => false, 'error' => 'cooldown']); exit; }

    $isNewRecord = $score > $oldRecord;
    $isNewPersonal = $score > $bestPerso;

    if ($isNewRecord) {
        if (function_exists('fastcgi_finish_request')) {
            echo json_encode(['ok' => true, 'new_record' => true, 'new_personal' => true, 'score' => $score]);
            fastcgi_finish_request();
        }
        notify_discord_record($gameId, $user, $score, $oldRecord, $oldHolder);
        if (!function_exists('fastcgi_finish_request')) {
            echo json_encode(['ok' => true, 'new_record' => true, 'new_personal' => true, 'score' => $score]);
        }
    } else {
        echo json_encode(['ok' => true, 'new_record' => false, 'new_personal' => $isNewPersonal, 'score' => $score]);
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
