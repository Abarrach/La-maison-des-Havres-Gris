<?php
// ============================================================
//  tournois-api.php — Tournois PvP (page epice/tournois.html)
//
//  Stockage : epice/data/tournois.json (gitignoré, protégé par le
//  `location ^~ /epice/data/ { deny all; }` de nginx comme le reste).
//
//  ⚠ Le serveur NE CALCULE PAS l'arbre. Il stocke les joueurs et les résultats
//  bruts ; l'arbre, le classement et le podium viennent de tournoi-engine.js,
//  côté page. Le podium enregistré ici est celui que la page a calculé au moment
//  de la sauvegarde — c'est lui que l'annonce Discord publie. Un seul moteur,
//  aucune copie PHP à garder d'accord.
//
//  Droits (session du site, cf. auth_epice.php) :
//    - membre connecté : consultation (liste, arbre, classement, historique)
//    - organisateur    : création, saisie des scores, publication Discord
//    - admin ou créateur du tournoi : suppression
// ============================================================
require_once __DIR__ . '/auth_epice.php';
header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? '';
$input  = json_decode(file_get_contents('php://input'), true) ?? [];

$member   = ['list', 'get'];
$organize = ['sorties', 'inscrits', 'membres', 'create', 'save', 'publish', 'delete'];
if (in_array($action, $organize, true)) epice_require_organize();
elseif (in_array($action, $member, true)) epice_require_login();
else tout(false, [], 'Action inconnue.');

const NIVEAUX_T  = ['debutant', 'intermediaire', 'expert'];
const NIVEAU_LBL = ['debutant' => 'Débutants', 'intermediaire' => 'Intermédiaires', 'expert' => 'Experts'];
const NIVEAU_ICO = ['debutant' => '🌱', 'intermediaire' => '⚔️', 'expert' => '🔥'];
const STATUTS_T  = ['preparation', 'en_cours', 'termine'];
const MAX_JOUEURS = 128;
const MAX_JOURNAL = 300;
// Activités du bot Sorties qui portent un tournoi (cf. SORTIE_TYPES, discord_sortie.php).
const TYPE_NIVEAU = ['tournoi_deb' => 'debutant', 'tournoi_int' => 'intermediaire', 'tournoi_exp' => 'expert'];

function tout(bool $ok, array $payload = [], string $err = ''): void {
    echo json_encode($ok ? array_merge(['ok' => true], $payload) : ['ok' => false, 'error' => $err], JSON_UNESCAPED_UNICODE);
    exit;
}

// Coupe à $n caractères sans mbstring (absent du serveur) : substr() couperait
// au milieu d'un caractère accentué et rendrait le JSON invalide.
function t_cut($s, int $n): string {
    $s = trim(str_replace(["\r", "\0"], '', (string)$s));
    return preg_match('/^.{0,' . $n . '}/us', $s, $m) ? $m[0] : '';
}

// ---- Stockage : lecture-modification-écriture sous UN SEUL verrou ----------
//  Le motif lire / puis écrire sous verrou (data-api.php) laisse une fenêtre où
//  deux organisateurs saisissant en même temps s'écrasent. Ici tout se passe
//  pendant le verrou, et un numéro de version refuse une page restée ouverte sur
//  une copie périmée.
function t_file(): string {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/tournois.json';
}
function t_read(): array {
    $f = t_file();
    if (!file_exists($f)) return ['tournois' => []];
    $d = json_decode((string)file_get_contents($f), true);
    return is_array($d) && isset($d['tournois']) ? $d : ['tournois' => []];
}
function t_mutate(callable $fn) {
    $fp = @fopen(t_file(), 'c+');
    if (!$fp) tout(false, [], "Écriture impossible : droits insuffisants sur epice/data/tournois.json (www-data doit pouvoir l'écrire).");
    $deadline = microtime(true) + 2;
    while (!flock($fp, LOCK_EX | LOCK_NB)) {
        if (microtime(true) > $deadline) { fclose($fp); tout(false, [], 'Fichier des tournois occupé, réessaie dans un instant.'); }
        usleep(50000);
    }
    $raw = stream_get_contents($fp);
    $d = json_decode((string)$raw, true);
    if (!is_array($d) || !isset($d['tournois'])) $d = ['tournois' => []];
    try { $ret = $fn($d); }
    catch (Throwable $e) { flock($fp, LOCK_UN); fclose($fp); tout(false, [], $e->getMessage()); }
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp); flock($fp, LOCK_UN); fclose($fp);
    return $ret;
}

function t_index(array $d, string $id): int {
    foreach ($d['tournois'] as $i => $t) if (($t['id'] ?? '') === $id) return $i;
    return -1;
}

function t_peut_supprimer(array $t): bool {
    if (epice_role() === 'admin') return true;
    $me = epice_user() ?? '';
    return $me !== '' && strcasecmp((string)($t['cree_par'] ?? ''), $me) === 0;
}

function t_journal(array &$t, string $texte): void {
    $texte = t_cut($texte, 200);
    if ($texte === '') return;
    $t['journal'][] = ['ts' => date('c'), 'par' => epice_user() ?? '?', 'texte' => $texte];
    if (count($t['journal']) > MAX_JOURNAL) $t['journal'] = array_slice($t['journal'], -MAX_JOURNAL);
}

// ---- Store des sorties Discord non-épice (écrit par discord_sortie.php) ----
function t_dstore(): array {
    $f = __DIR__ . '/data/discord_sorties.json';
    if (!file_exists($f)) return [];
    $d = json_decode((string)file_get_contents($f), true);
    return is_array($d['sorties'] ?? null) ? $d['sorties'] : [];
}
function t_sortie(string $sid): ?array {
    foreach (t_dstore() as $s) if (($s['id'] ?? '') === $sid) return $s;
    return null;
}

// Inscrits d'une sortie, prêts à devenir des joueurs. Les « peut-être » sont
// renvoyés (signalés) : c'est l'organisateur qui décide de les prendre.
function t_inscrits(array $s): array {
    $out = [];
    foreach ($s['signups'] ?? [] as $su) {
        $statut = $su['statut'] ?? 'present';
        if ($statut === 'absent') continue;
        $nom = t_cut($su['name'] ?? '', 40);
        if ($nom === '') continue;
        $out[] = ['nom' => $nom, 'discord_id' => (string)($su['id'] ?? ''), 'statut' => $statut];
    }
    return $out;
}

// ---- Nettoyage des données envoyées par la page ----------------------------
function t_clean_joueurs($list): array {
    $out = []; $vus = [];
    foreach (is_array($list) ? $list : [] as $j) {
        $id  = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($j['id'] ?? ''));
        $nom = t_cut($j['nom'] ?? '', 40);
        if ($id === '' || $nom === '' || isset($vus[$id])) continue;
        $vus[$id] = true;
        $out[] = [
            'id'         => $id,
            'nom'        => $nom,
            'discord_id' => preg_replace('/\D/', '', (string)($j['discord_id'] ?? '')),
            // discord = inscrit à la sortie ; membre = choisi dans la liste des membres
            // du serveur Discord ; manuel = nom tapé librement (invité hors Discord).
            'source'     => in_array($j['source'] ?? '', ['discord', 'membre'], true) ? $j['source'] : 'manuel',
            'seed'       => count($out) + 1, // la position dans la liste fait foi
        ];
        if (count($out) >= MAX_JOUEURS) break;
    }
    return $out;
}

function t_clean_resultats($list, array $ids): array {
    $out = [];
    foreach (is_array($list) ? $list : [] as $mid => $r) {
        if (!preg_match('/^(W\d+-\d+|L\d+-\d+|GF[12]|P)$/', (string)$mid) || !is_array($r)) continue;
        $p1 = (string)($r['p1'] ?? ''); $p2 = (string)($r['p2'] ?? ''); $w = (string)($r['w'] ?? '');
        if (!isset($ids[$p1]) || !isset($ids[$p2]) || $p1 === $p2 || ($w !== $p1 && $w !== $p2)) continue;
        $score = function ($v) { return ($v === '' || $v === null) ? null : max(0, min(999, (int)$v)); };
        $out[$mid] = ['p1' => $p1, 'p2' => $p2, 'w' => $w, 's1' => $score($r['s1'] ?? null),
                      's2' => $score($r['s2'] ?? null), 'forfait' => !empty($r['forfait'])];
    }
    return $out;
}

function t_clean_podium($list, array $ids): array {
    $out = [];
    foreach (is_array($list) ? $list : [] as $p) {
        $id = (string)($p['id'] ?? '');
        if (!isset($ids[$id])) continue;
        $out[] = ['rang' => max(1, min(3, (int)($p['rang'] ?? 3))), 'id' => $id, 'nom' => t_cut($p['nom'] ?? '', 40),
                  'v' => max(0, (int)($p['v'] ?? 0)), 'd' => max(0, (int)($p['d'] ?? 0))];
        if (count($out) >= 6) break; // 3ᵉ ex æquo possible en simple élimination
    }
    return $out;
}

function t_clean_options($o, string $format): array {
    $o = is_array($o) ? $o : [];
    return [
        'grandeFinale' => ($o['grandeFinale'] ?? '') === 'unique' ? 'unique' : 'revanche',
        'petiteFinale' => $format === 'simple' ? ($o['petiteFinale'] ?? true) !== false : false,
        'bestOf'       => in_array((int)($o['bestOf'] ?? 1), [1, 3, 5], true) ? (int)$o['bestOf'] : 1,
    ];
}

function t_clean_lots($l): array {
    $l = is_array($l) ? $l : [];
    return ['1' => t_cut($l['1'] ?? '', 120), '2' => t_cut($l['2'] ?? '', 120), '3' => t_cut($l['3'] ?? '', 120)];
}

function t_clean_date($s): string { return preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$s) ? (string)$s : ''; }
function t_clean_heure($s): string { return preg_match('/^\d{2}:\d{2}$/', (string)$s) ? (string)$s : ''; }

// Résumé pour la liste et l'historique : pas d'arbre, pas de journal.
function t_resume(array $t): array {
    return [
        'id' => $t['id'], 'nom' => $t['nom'], 'niveau' => $t['niveau'], 'format' => $t['format'],
        'statut' => $t['statut'], 'date' => $t['date'], 'heure' => $t['heure'],
        'nb_joueurs' => count($t['joueurs'] ?? []), 'podium' => $t['podium'] ?? [],
        'lots' => $t['lots'] ?? [], 'cree_par' => $t['cree_par'] ?? '', 'sortie_id' => $t['sortie_id'] ?? '',
        'termine_le' => $t['termine_le'] ?? '',
    ];
}

switch ($action) {

    case 'list':
        $d = t_read();
        $liste = array_map('t_resume', $d['tournois']);
        usort($liste, function ($a, $b) { return strcmp($b['date'] . $b['heure'], $a['date'] . $a['heure']); });
        tout(true, ['tournois' => $liste, 'peut_gerer' => epice_can_organize(),
                    'admin' => epice_role() === 'admin', 'moi' => epice_user()]);

    case 'get':
        $d = t_read();
        $id = (string)($_GET['id'] ?? '');
        $sid = (string)($_GET['sortie'] ?? '');
        foreach ($d['tournois'] as $t) {
            if (($id !== '' && $t['id'] === $id) || ($id === '' && $sid !== '' && ($t['sortie_id'] ?? '') === $sid)) {
                tout(true, ['tournoi' => $t, 'peut_gerer' => epice_can_organize(),
                            'peut_supprimer' => t_peut_supprimer($t)]);
            }
        }
        tout(false, [], 'Tournoi introuvable.');

    // Sorties Discord récentes auxquelles rattacher un tournoi. Les activités
    // « Tournoi » d'abord ; les autres restent proposées (un tournoi improvisé
    // pendant une soirée d'entraînement, par exemple).
    case 'sorties':
        $lim = date('Y-m-d', strtotime('-21 days'));
        $deja = [];
        foreach (t_read()['tournois'] as $t) if (!empty($t['sortie_id'])) $deja[$t['sortie_id']] = $t['id'];
        $out = [];
        foreach (t_dstore() as $s) {
            if (($s['date'] ?? '') !== '' && $s['date'] < $lim) continue;
            $presents = 0;
            foreach ($s['signups'] ?? [] as $su) if (($su['statut'] ?? 'present') === 'present') $presents++;
            $out[] = ['id' => $s['id'], 'titre' => $s['titre'] ?? '', 'type' => $s['type'] ?? '',
                      'niveau' => TYPE_NIVEAU[$s['type'] ?? ''] ?? '', 'date' => $s['date'] ?? '',
                      'heure' => $s['heure'] ?? '', 'presents' => $presents, 'tournoi' => $deja[$s['id']] ?? ''];
        }
        usort($out, function ($a, $b) {
            return (($b['niveau'] !== '') <=> ($a['niveau'] !== '')) ?: strcmp($b['date'] . $b['heure'], $a['date'] . $a['heure']);
        });
        tout(true, ['sorties' => $out]);

    case 'inscrits':
        $s = t_sortie((string)($_GET['sortie'] ?? ''));
        if (!$s) tout(false, [], "Sortie Discord introuvable (supprimée, ou purgée après la fin : ses inscrits ne sont plus lisibles).");
        tout(true, ['inscrits' => t_inscrits($s)]);

    // Tous les membres du serveur Discord de la guilde, pour pouvoir ajouter un
    // ancien qui n'a jamais touché ni au site ni au bot. Demande l'intent privilégié
    // « Server Members » (le même que le relevé de présence) : sans lui, Discord
    // répond 403 et on le DIT, au lieu de renvoyer une liste vide trompeuse.
    // Cache d'une heure : la liste bouge peu, et la page la redemande à chaque ouverture.
    case 'membres':
        $cache = __DIR__ . '/data/tournois_membres_cache.json';
        if (empty($_GET['frais']) && file_exists($cache) && filemtime($cache) > time() - 3600) {
            $c = json_decode((string)file_get_contents($cache), true);
            if (is_array($c)) tout(true, ['membres' => $c, 'cache' => true]);
        }
        $cfgPath = __DIR__ . '/discord_sortie_config.php';
        if (!file_exists($cfgPath)) tout(false, [], 'Configuration du bot absente sur le serveur.');
        $CFG = require $cfgPath;
        // Le serveur de la GUILDE : celui du login Discord d'abord (c'est la vraie guilde
        // par construction — on y vérifie l'appartenance de chaque membre), puis ceux du bot.
        // `guild_id` du bot peut désigner un serveur de test.
        $oauth = dirname(__DIR__) . '/discord_oauth_config.php';
        $OA = file_exists($oauth) ? (require $oauth) : [];
        $guild = trim((string)($OA['guild_id'] ?? '')) ?: trim((string)($CFG['rally_guild_id'] ?? '')) ?: trim((string)($CFG['guild_id'] ?? ''));
        $token = trim((string)($CFG['bot_token'] ?? ''));
        if ($guild === '' || $token === '') tout(false, [], 'Identifiant du serveur Discord ou token du bot manquant dans la configuration.');
        if (!function_exists('curl_init')) tout(false, [], 'cURL indisponible sur le serveur.');
        $membres = []; $after = '';
        for ($page = 0; $page < 5; $page++) {      // 5 000 membres : largement au-delà d'une guilde
            $ch = curl_init("https://discord.com/api/v10/guilds/{$guild}/members?limit=1000" . ($after !== '' ? "&after={$after}" : ''));
            curl_setopt_array($ch, [CURLOPT_HTTPHEADER => ['Authorization: Bot ' . $token], CURLOPT_RETURNTRANSFER => true,
                                    CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 10]);
            $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
            $lot = json_decode((string)$resp, true);
            if ($code < 200 || $code >= 300 || !is_array($lot)) {
                $msg = is_array($lot) ? trim((string)($lot['message'] ?? '')) : '';
                if ($code === 403 || stripos($msg, 'intent') !== false)
                    tout(false, [], "Discord refuse la liste des membres (HTTP {$code}" . ($msg ? " : {$msg}" : '') . ") — active l'intent « Server Members » du bot dans le portail développeur (Bot → Privileged Gateway Intents).");
                tout(false, [], "Liste des membres indisponible (HTTP {$code}" . ($msg ? " : {$msg}" : '') . ').');
            }
            foreach ($lot as $m) {
                $u = $m['user'] ?? [];
                if (!empty($u['bot']) || empty($u['id'])) continue;
                $after = (string)$u['id'];
                // Le surnom du serveur d'abord : c'est le nom sous lequel la guilde se connaît.
                $nom = t_cut($m['nick'] ?? '', 40) ?: t_cut($u['global_name'] ?? '', 40) ?: t_cut($u['username'] ?? '', 40);
                if ($nom === '') continue;
                $membres[] = ['discord_id' => (string)$u['id'], 'nom' => $nom, 'pseudo' => (string)($u['username'] ?? '')];
            }
            if (count($lot) < 1000) break;
        }
        usort($membres, function ($a, $b) { return strcasecmp($a['nom'], $b['nom']); });
        @file_put_contents($cache, json_encode($membres, JSON_UNESCAPED_UNICODE));
        @chmod($cache, 0664);
        tout(true, ['membres' => $membres, 'cache' => false]);

    case 'create':
        $nom = t_cut($input['nom'] ?? '', 80);
        if ($nom === '') tout(false, [], 'Donne un nom au tournoi.');
        $niveau = in_array($input['niveau'] ?? '', NIVEAUX_T, true) ? $input['niveau'] : 'intermediaire';
        $format = ($input['format'] ?? '') === 'simple' ? 'simple' : 'double';
        $sid = (string)($input['sortie_id'] ?? '');
        $sortie = $sid !== '' ? t_sortie($sid) : null;
        if ($sid !== '' && !$sortie) tout(false, [], 'Sortie Discord introuvable.');

        // Joueurs de départ : les présents de la sortie (et les « peut-être » si demandé).
        $joueurs = [];
        if ($sortie) {
            foreach (t_inscrits($sortie) as $i => $p) {
                if ($p['statut'] === 'maybe' && empty($input['avec_peut_etre'])) continue;
                $joueurs[] = ['id' => 'j' . substr(md5($p['discord_id'] . $p['nom'] . $i), 0, 8), 'nom' => $p['nom'],
                              'discord_id' => $p['discord_id'], 'source' => 'discord'];
            }
        }
        $t = [
            'id'          => 'tournoi_' . date('Ymd_His') . '_' . substr(md5(uniqid('', true)), 0, 4),
            'nom'         => $nom,
            'niveau'      => $niveau,
            'format'      => $format,
            'options'     => t_clean_options($input['options'] ?? [], $format),
            'date'        => t_clean_date($input['date'] ?? '') ?: ($sortie['date'] ?? date('Y-m-d')),
            'heure'       => t_clean_heure($input['heure'] ?? '') ?: ($sortie['heure'] ?? ''),
            'description' => t_cut($input['description'] ?? '', 500),
            'statut'      => 'preparation',
            'sortie_id'   => $sortie ? $sid : '',
            'sortie_channel_id' => $sortie ? (string)($sortie['discord']['channel_id'] ?? '') : '',
            'joueurs'     => t_clean_joueurs($joueurs),
            'resultats'   => [],
            'podium'      => [],
            'lots'        => t_clean_lots($input['lots'] ?? []),
            'cree_par'    => epice_user() ?? '',
            'cree_le'     => date('c'),
            'version'     => 1,
            'journal'     => [],
            'publie'      => [],
        ];
        t_journal($t, 'Tournoi créé' . ($sortie ? ' depuis la sortie « ' . ($sortie['titre'] ?? '') . ' » (' . count($t['joueurs']) . ' inscrits importés)' : ''));
        t_mutate(function (&$d) use ($t) { $d['tournois'][] = $t; });
        tout(true, ['tournoi' => $t]);

    case 'save':
        $id = (string)($input['id'] ?? '');
        $n  = $input['tournoi'] ?? [];
        if (!is_array($n)) tout(false, [], 'Données invalides.');
        $t = t_mutate(function (&$d) use ($id, $n, $input) {
            $i = t_index($d, $id);
            if ($i < 0) throw new RuntimeException('Tournoi introuvable.');
            $t = $d['tournois'][$i];
            if ((int)($input['version'] ?? 0) !== (int)($t['version'] ?? 1)) {
                throw new RuntimeException('Le tournoi a été modifié entre-temps par ' . (end($t['journal'])['par'] ?? 'quelqu\'un')
                    . ' — recharge la page pour repartir de la dernière version.');
            }
            $ancien = $t['statut'];
            $statut = in_array($n['statut'] ?? '', STATUTS_T, true) ? $n['statut'] : $ancien;

            $t['nom']         = t_cut($n['nom'] ?? $t['nom'], 80) ?: $t['nom'];
            $t['niveau']      = in_array($n['niveau'] ?? '', NIVEAUX_T, true) ? $n['niveau'] : $t['niveau'];
            $t['date']        = t_clean_date($n['date'] ?? '') ?: $t['date'];
            $t['heure']       = array_key_exists('heure', $n) ? t_clean_heure($n['heure']) : $t['heure'];
            $t['description'] = t_cut($n['description'] ?? $t['description'], 500);
            $t['lots']        = t_clean_lots($n['lots'] ?? $t['lots']);

            $joueurs = t_clean_joueurs($n['joueurs'] ?? $t['joueurs']);
            if ($ancien === 'preparation') {
                // Le format et la liste ne bougent qu'avant le lancement : ensuite,
                // ils définissent l'arbre, et le changer redistribuerait tous les matchs.
                $t['format']  = ($n['format'] ?? $t['format']) === 'simple' ? 'simple' : 'double';
                $t['options'] = t_clean_options($n['options'] ?? $t['options'], $t['format']);
                $t['joueurs'] = $joueurs;
            } elseif ($statut !== 'preparation') {
                // Lancé : on accepte un renommage, jamais un ajout, un retrait ni un réordonnancement.
                $avant = array_column($t['joueurs'], 'id');
                if ($avant !== array_column($joueurs, 'id')) throw new RuntimeException('Le tournoi est lancé : la liste des joueurs est figée (repasse en préparation pour la modifier).');
                $t['joueurs'] = $joueurs;
            }
            if ($statut !== 'preparation' && count($t['joueurs']) < 2) throw new RuntimeException('Il faut au moins deux joueurs pour lancer le tournoi.');

            $ids = array_flip(array_column($t['joueurs'], 'id'));
            // Revenir en préparation efface les scores : l'arbre va changer.
            $t['resultats'] = $statut === 'preparation' ? [] : t_clean_resultats($n['resultats'] ?? $t['resultats'], $ids);
            $t['podium']    = $statut === 'termine' ? t_clean_podium($n['podium'] ?? [], $ids) : [];
            if ($statut === 'termine' && !$t['podium']) throw new RuntimeException('Classement final manquant : le tournoi n\'est pas allé au bout.');
            if ($statut === 'termine' && $ancien !== 'termine') $t['termine_le'] = date('c');
            if ($statut !== 'termine') unset($t['termine_le']);
            $t['statut']  = $statut;
            $t['version'] = (int)($t['version'] ?? 1) + 1;
            t_journal($t, (string)($input['journal'] ?? ''));
            $d['tournois'][$i] = $t;
            return $t;
        });
        tout(true, ['tournoi' => $t]);

    case 'delete':
        $id = (string)($input['id'] ?? '');
        t_mutate(function (&$d) use ($id) {
            $i = t_index($d, $id);
            if ($i < 0) throw new RuntimeException('Tournoi introuvable.');
            if (!t_peut_supprimer($d['tournois'][$i])) throw new RuntimeException('Réservé aux admins et au créateur du tournoi.');
            array_splice($d['tournois'], $i, 1);
        });
        tout(true);

    // Annonce sur Discord, par le bot Sorties : lancement (affiches du premier
    // tour, calculées par la page) ou résultats (podium enregistré + lots).
    case 'publish':
        $id   = (string)($input['id'] ?? '');
        $quoi = ($input['quoi'] ?? '') === 'resultats' ? 'resultats' : 'lancement';
        $d = t_read();
        $i = t_index($d, $id);
        if ($i < 0) tout(false, [], 'Tournoi introuvable.');
        $t = $d['tournois'][$i];
        if ($quoi === 'resultats' && ($t['statut'] !== 'termine' || !$t['podium'])) tout(false, [], 'Clôture le tournoi avant d\'en publier les résultats.');
        if ($quoi === 'lancement' && $t['statut'] === 'preparation') tout(false, [], 'Lance le tournoi avant de publier l\'arbre.');

        $cfgPath = __DIR__ . '/discord_sortie_config.php';
        if (!file_exists($cfgPath)) tout(false, [], 'Configuration du bot absente sur le serveur.');
        $CFG = require $cfgPath;
        if (empty($CFG['bot_token']))      tout(false, [], 'Le bot n\'a pas de token configuré.');
        if (!function_exists('curl_init')) tout(false, [], 'cURL indisponible sur le serveur.');
        // Salon : réglage dédié → salon des partages → salon où la sortie a été créée.
        $chan = trim((string)($CFG['tournoi_channel_id'] ?? '')) ?: trim((string)($CFG['partage_channel_id'] ?? ''))
             ?: (string)($t['sortie_channel_id'] ?? '');
        if ($chan === '') tout(false, [], 'Aucun salon de publication : renseigne `tournoi_channel_id` dans discord_sortie_config.php, ou rattache le tournoi à une sortie Discord.');

        $base = rtrim(trim((string)($CFG['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
        $lien = $base . '/epice/tournois.html?t=' . rawurlencode($t['id']);
        $esc  = function ($s) { return preg_replace('/([\\\\*_~`|>])/', '\\\\$1', (string)$s); };
        $niv  = NIVEAU_ICO[$t['niveau']] . ' ' . NIVEAU_LBL[$t['niveau']];
        $fmt  = $t['format'] === 'double' ? 'Double élimination' : 'Simple élimination';
        $quand = $t['date'] ? date('d/m/Y', strtotime($t['date'])) . ($t['heure'] ? ' à ' . $t['heure'] : '') : '';

        $embed = ['color' => hexdec('D4A23B'), 'url' => $lien,
                  'footer' => ['text' => 'Tournoi PvP · ' . $niv . ' · organisé par ' . ($t['cree_par'] ?: '?')]];
        if ($quoi === 'lancement') {
            $lignes = [];
            foreach (array_slice(is_array($input['lignes'] ?? null) ? $input['lignes'] : [], 0, 40) as $l) {
                $l = t_cut($l, 90);
                if ($l !== '') $lignes[] = $l;
            }
            $desc = "⚔️ **" . count($t['joueurs']) . " combattants** · {$fmt}" . ($quand ? " · 📅 {$quand}" : '')
                  . ($t['options']['bestOf'] > 1 ? ' · matchs en ' . $t['options']['bestOf'] . ' manches gagnantes' : '');
            if ($t['description'] !== '') $desc = $esc($t['description']) . "\n\n" . $desc;
            $lots = [];
            foreach (['1' => '🥇', '2' => '🥈', '3' => '🥉'] as $r => $ico) if (($t['lots'][$r] ?? '') !== '') $lots[] = "{$ico} " . $esc($t['lots'][$r]);
            $embed['title'] = '⚔️ ' . t_cut($t['nom'], 200) . ' — c\'est parti !';
            $embed['description'] = $desc;
            $embed['fields'] = [];
            if ($lignes) {
                $val = '';
                foreach ($lignes as $l) { if (strlen($val) + strlen($l) > 980) { $val .= "…"; break; } $val .= $l . "\n"; }
                $embed['fields'][] = ['name' => 'À jouer maintenant', 'value' => $val, 'inline' => false];
            }
            if ($lots) $embed['fields'][] = ['name' => '🎁 Lots', 'value' => implode("\n", $lots), 'inline' => false];
            $embed['fields'][] = ['name' => 'Arbre en direct', 'value' => "[Suivre le tournoi sur le site]({$lien})", 'inline' => false];
        } else {
            $med = [1 => '🥇', 2 => '🥈', 3 => '🥉'];
            $lignes = [];
            foreach ($t['podium'] as $p) {
                $l = ($med[$p['rang']] ?? '🏅') . ' **' . $esc($p['nom']) . '** — ' . $p['v'] . ' V / ' . $p['d'] . ' D';
                $lot = $t['lots'][(string)$p['rang']] ?? '';
                if ($lot !== '') $l .= "\n   🎁 " . $esc($lot);
                $lignes[] = $l;
            }
            $embed['title'] = '🏆 ' . t_cut($t['nom'], 200) . ' — résultats';
            $embed['description'] = implode("\n", $lignes) . "\n\n" . count($t['joueurs']) . " combattants · {$fmt}"
                                  . ($quand ? " · {$quand}" : '') . "\n[Voir l'arbre complet]({$lien})";
        }

        $ch = curl_init('https://discord.com/api/v10/channels/' . $chan . '/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['embeds' => [$embed], 'allowed_mentions' => ['parse' => []]], JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT        => 10,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false || $code < 200 || $code >= 300) {
            // Relayer le motif donné par Discord : « Missing Access » (salon invisible au
            // bot) et « Missing Permissions » (visible mais pas d'écriture) ne se règlent
            // pas au même endroit. Un code nu envoie chercher au mauvais endroit.
            $j = json_decode((string)$resp, true);
            $quoiErr = trim((string)($j['message'] ?? ''));
            $aide = stripos($quoiErr, 'Missing Access') !== false ? ' — le bot ne voit pas ce salon : accorde-lui « Voir le salon » et « Envoyer des messages ».'
                  : (stripos($quoiErr, 'Missing Permissions') !== false ? ' — le bot voit le salon mais ne peut pas y écrire (« Envoyer des messages », « Intégrer des liens »).' : '');
            tout(false, [], 'Discord a refusé le message (HTTP ' . $code . ($quoiErr !== '' ? ' : ' . $quoiErr : '') . ')' . $aide);
        }
        $t = t_mutate(function (&$d) use ($id, $quoi) {
            $i = t_index($d, $id);
            if ($i < 0) return null;
            $d['tournois'][$i]['publie'][$quoi] = date('c');
            t_journal($d['tournois'][$i], $quoi === 'resultats' ? 'Résultats publiés sur Discord' : 'Lancement annoncé sur Discord');
            return $d['tournois'][$i];
        });
        tout(true, ['tournoi' => $t]);
}
