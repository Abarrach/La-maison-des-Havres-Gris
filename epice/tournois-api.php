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
//
//  Paris (epice/data/paris.json, fichier À PART : un pari ne doit ni faire
//  monter le numéro de version du tournoi ni bloquer la saisie des scores).
//  De VRAIS Solaris du jeu : le site ne tient que le carnet du banquier.
//    - membre connecté : parier (jamais sur ses propres matchs)
//    - organisateur    : « Combat lancé », annuler un pari, noter un règlement
//  Le bilan (qui a gagné, qui doit quoi) se calcule dans la page avec
//  tournoi-paris.js : ici, on ne vérifie que les règles de dépôt.
// ============================================================
require_once __DIR__ . '/auth_epice.php';

// Mode BIBLIOTHÈQUE : discord_paris.php (parier depuis Discord) définit
// TOURNOIS_LIB avant d'inclure ce fichier, pour reprendre les MÊMES règles de
// pari et le même stockage sans exécuter d'action. tout() lève alors une
// exception au lieu de répondre, et le fichier s'arrête avant le switch.
if (!defined('TOURNOIS_LIB')) {
header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? '';
$input  = json_decode(file_get_contents('php://input'), true) ?? [];

// Les actions de gestion d'UN tournoi ne demandent ici que d'être connecté : le
// droit se vérifie ensuite sur le tournoi lui-même (t_exige_gerer), car son
// créateur le gère sans être organisateur. Seul le classement de saison, qui
// couvre tous les tournois, reste réservé aux organisateurs.
$member   = ['list', 'get', 'paris', 'parier', 'droits_sortie',
             'sorties', 'inscrits', 'membres', 'create', 'save', 'publish', 'delete',
             'paris_verrou', 'paris_annuler', 'paris_regle', 'paris_ouvrir', 'paris_prolonger', 'paris_discord'];
$organize = ['publish_saison'];
if (in_array($action, $organize, true)) epice_require_organize();
elseif (in_array($action, $member, true)) epice_require_login();
else tout(false, [], 'Action inconnue.');
}

const NIVEAUX_T  = ['debutant', 'intermediaire', 'expert'];
const NIVEAU_LBL = ['debutant' => 'Débutants', 'intermediaire' => 'Intermédiaires', 'expert' => 'Vétérans'];
const NIVEAU_ICO = ['debutant' => '🌱', 'intermediaire' => '⚔️', 'expert' => '🔥'];
const STATUTS_T  = ['preparation', 'en_cours', 'termine'];
const MAX_JOUEURS = 128;
const MAX_JOURNAL = 300;
const PLAFOND_PARI = 10000;   // Solaris par pari (même valeur dans tournoi-paris.js)
const MATCH_RE = '/^(W\d+-\d+|L\d+-\d+|GF[12]|P)$/';
// Activités du bot Sorties qui portent un tournoi (cf. SORTIE_TYPES, discord_sortie.php).
const TYPE_NIVEAU = ['tournoi_deb' => 'debutant', 'tournoi_int' => 'intermediaire', 'tournoi_exp' => 'expert'];

function tout(bool $ok, array $payload = [], string $err = ''): void {
    if (defined('TOURNOIS_LIB')) throw new RuntimeException($ok ? 'tout() appelé en mode bibliothèque' : $err);
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
//  Deux fichiers suivent ce motif : tournois.json et paris.json (même forme,
//  {tournois: …} — une liste pour le premier, un objet par id pour le second).
function t_file(string $nom = 'tournois.json'): string {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/' . $nom;
}
function t_read(string $nom = 'tournois.json'): array {
    $f = t_file($nom);
    if (!file_exists($f)) return ['tournois' => []];
    $d = json_decode((string)file_get_contents($f), true);
    return is_array($d) && isset($d['tournois']) ? $d : ['tournois' => []];
}
function t_mutate(callable $fn, string $nom = 'tournois.json') {
    $neuf = !file_exists(t_file($nom));
    $fp = @fopen(t_file($nom), 'c+');
    if (!$fp) tout(false, [], "Écriture impossible : droits insuffisants sur epice/data/{$nom} (www-data doit pouvoir l'écrire).");
    // Créé par PHP, le fichier naîtrait en 644 : WinSCP et les crons (dune) ne pourraient plus l'écrire.
    if ($neuf) @chmod(t_file($nom), 0664);
    $deadline = microtime(true) + 2;
    while (!flock($fp, LOCK_EX | LOCK_NB)) {
        if (microtime(true) > $deadline) { fclose($fp); tout(false, [], 'Fichier occupé (' . $nom . '), réessaie dans un instant.'); }
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

// ---- Droits de gestion : PAR TOURNOI -----------------------------------------
//  Avant : tout passait par le rôle « organisateur » (liste globale). Or n'importe
//  quel membre peut créer une sortie « Tournoi PvP » sur Discord, et il restait
//  ensuite bloqué devant son propre tournoi (Neuroch, 2026-10 : l'admin a dû lui
//  donner le rôle). Règle voulue par l'utilisateur : qui crée un tournoi le gère.
//  Gère un tournoi : un organisateur, son créateur sur le site (`cree_par`), ou le
//  créateur de la sortie Discord à laquelle il est rattaché.
function t_createur_sortie(string $sid): bool {
    if ($sid === '') return false;
    $s = t_sortie($sid);
    return $s !== null && epice_is_creator($s);
}
// Le membre connecté est-il cette personne ({nom, discord_id}) ? Par compte
// Discord d'abord, sinon par nom.
function t_est_moi($p): bool {
    if (!is_array($p)) return false;
    $did = (string)($_SESSION['discord_id'] ?? '');
    if ($did !== '' && ($p['discord_id'] ?? '') === $did) return true;
    $me = epice_user() ?? '';
    return $me !== '' && strcasecmp((string)($p['nom'] ?? ''), $me) === 0;
}
function t_peut_gerer(array $t): bool {
    if (epice_can_organize()) return true;
    $me = epice_user() ?? '';
    if ($me !== '' && strcasecmp((string)($t['cree_par'] ?? ''), $me) === 0) return true;
    // Co-organisateurs (2026-10, après le premier vrai tournoi : l'orga arbitrait
    // en jeu ET tenait le site). Ils gèrent ce tournoi-là comme son créateur.
    foreach ($t['coorgas'] ?? [] as $c) if (t_est_moi($c)) return true;
    return t_createur_sortie((string)($t['sortie_id'] ?? ''));
}
// Banquier des paris : désigné à part (souvent quelqu'un qui ne joue pas), sinon
// le créateur du tournoi. Il voit le carnet et note les règlements, sans
// forcément gérer le tournoi.
function t_banquier_nom(array $t): string {
    return (string)(($t['banquier']['nom'] ?? '') ?: ($t['cree_par'] ?? ''));
}
function t_est_banquier(array $t): bool {
    if (!empty($t['banquier']['nom'])) return t_est_moi($t['banquier']);
    $me = epice_user() ?? '';
    return $me !== '' && strcasecmp((string)($t['cree_par'] ?? ''), $me) === 0;
}
function t_exige_banque(array $t): void {
    if (!t_peut_gerer($t) && !t_est_banquier($t)) epice_deny('Réservé au banquier et aux organisateurs du tournoi.');
}
// Personnes saisies dans le formulaire (co-organisateurs, banquier).
function t_clean_personne($p): ?array {
    if (!is_array($p)) return null;
    $nom = t_cut($p['nom'] ?? '', 40);
    if ($nom === '') return null;
    return ['nom' => $nom, 'discord_id' => preg_replace('/\D/', '', (string)($p['discord_id'] ?? ''))];
}
function t_clean_coorgas($l): array {
    $out = [];
    foreach (is_array($l) ? $l : [] as $p) {
        $p = t_clean_personne($p);
        if ($p && count($out) < 4) $out[] = $p;
    }
    return $out;
}
// Durée de la fenêtre de pari d'un combat, en minutes (2 par défaut, réglable par l'orga).
function t_fenetre(array $t): int {
    $m = (int)($t['fenetre_paris'] ?? 2);
    return $m >= 1 && $m <= 30 ? $m : 2;
}
// Ce qu'un MEMBRE reçoit d'un tournoi qu'il ne gère pas. Masquer dans la page ne
// suffit pas : la réponse JSON se lit dans le navigateur.
//  - jamais le journal (onglet réservé à l'orga) ni la force des joueurs ;
//  - en préparation, tant que l'orga n'a pas dévoilé l'arbre : ni les équipes ni
//    l'ordre des têtes de série (joueurs rangés par nom, sans rang), pour que
//    l'orga puisse essayer plusieurs compositions sans rien révéler.
function t_vue_membre(array $t): array {
    $t['journal'] = [];
    $t['joueurs'] = array_map(function ($j) { unset($j['force']); return $j; }, $t['joueurs'] ?? []);
    if (($t['statut'] ?? '') === 'preparation' && empty($t['devoile'])) {
        $t['equipes'] = [];
        $t['joueurs'] = array_map(function ($j) { return ['id' => $j['id'], 'nom' => $j['nom']]; }, $t['joueurs']);
        usort($t['joueurs'], function ($a, $b) { return strcasecmp($a['nom'], $b['nom']); });
        $t['masque'] = true;
    }
    return $t;
}
function t_exige_gerer(array $t): void {
    if (!t_peut_gerer($t)) epice_deny('Réservé aux organisateurs et au créateur du tournoi.');
}
// Gère-t-il au moins un tournoi ? (liste des membres Discord, pour composer la sienne)
function t_gere_un_tournoi(): bool {
    if (epice_can_organize()) return true;
    foreach (t_read()['tournois'] as $t) if (t_peut_gerer($t)) return true;
    return false;
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
        // Force choisie par un organisateur pour composer les équipes (Fort / Moyen /
        // Novice). Absente = proposée par la page d'après les résultats, jamais stockée :
        // seul un choix humain est mémorisé et resservi au tournoi suivant.
        if (in_array($j['force'] ?? '', ['F', 'M', 'N'], true)) $out[count($out) - 1]['force'] = $j['force'];
        if (count($out) >= MAX_JOUEURS) break;
    }
    return $out;
}

// Équipes d'un tournoi par équipes : ce sont ELLES qui s'affrontent dans l'arbre
// (résultats et podium portent leurs identifiants). Un joueur n'est que dans une
// équipe ; ceux qui n'en ont pas sont les remplaçants. Le nom est libre une fois
// renommé (`nom_libre`), sinon la page le recompose à partir des membres.
function t_clean_equipes($list, array $joueurIds, int $taille): array {
    $out = []; $vus = []; $pris = [];
    foreach (is_array($list) ? $list : [] as $e) {
        if (!is_array($e)) continue;
        $id = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($e['id'] ?? ''));
        if ($id === '' || isset($vus[$id])) continue;
        $vus[$id] = true;
        $membres = [];
        foreach (is_array($e['membres'] ?? null) ? $e['membres'] : [] as $m) {
            $m = (string)$m;
            if (isset($joueurIds[$m]) && !isset($pris[$m]) && count($membres) < $taille) { $membres[] = $m; $pris[$m] = true; }
        }
        $out[] = ['id' => $id, 'nom' => t_cut($e['nom'] ?? '', 40) ?: 'Équipe ' . (count($out) + 1),
                  'nom_libre' => !empty($e['nom_libre']), 'membres' => $membres, 'seed' => count($out) + 1];
        if (count($out) >= MAX_JOUEURS) break;
    }
    return $out;
}

function t_clean_resultats($list, array $ids): array {
    $out = [];
    foreach (is_array($list) ? $list : [] as $mid => $r) {
        if (!preg_match(MATCH_RE, (string)$mid) || !is_array($r)) continue;
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
    $bo = (int)($o['bestOf'] ?? 1);   // lu une fois : relire $o['bestOf'] après le ?? plantait si la clé manquait
    $eq = (int)($o['equipe'] ?? 1);
    return [
        'grandeFinale' => ($o['grandeFinale'] ?? '') === 'unique' ? 'unique' : 'revanche',
        'petiteFinale' => $format === 'simple' ? ($o['petiteFinale'] ?? true) !== false : false,
        'bestOf'       => in_array($bo, [1, 3, 5], true) ? $bo : 1,
        // 1 = duel ; 2, 3, 4 = équipes de cette taille (cf. participants() du moteur).
        'equipe'       => in_array($eq, [2, 3, 4], true) ? $eq : 1,
    ];
}

function t_taille_equipe(array $t): int { return (int)($t['options']['equipe'] ?? 1); }

// « 2 contre 2 » pour les annonces ; '' en duel.
function t_libelle_equipe(array $t): string {
    $n = t_taille_equipe($t);
    return $n > 1 ? "{$n} contre {$n}" : '';
}

// Noms des membres d'une équipe, pour les annonces Discord.
function t_noms_membres(array $t, array $e): array {
    $noms = [];
    foreach ($t['joueurs'] ?? [] as $j) $noms[$j['id']] = $j['nom'];
    $out = [];
    foreach ($e['membres'] ?? [] as $m) if (isset($noms[$m])) $out[] = $noms[$m];
    return $out;
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
        'termine_le' => $t['termine_le'] ?? '', 'paris' => !empty($t['paris']),
        'equipe' => t_taille_equipe($t), 'nb_equipes' => count($t['equipes'] ?? []),
    ] + (($t['statut'] ?? '') === 'termine' ? [
        // Le classement de saison se calcule dans la page, avec le moteur (aucune
        // copie PHP des règles) : il lui faut donc l'arbre complet des tournois
        // terminés. Quelques Ko par tournoi, pas de journal. La force choisie par
        // un organisateur suit, pour être reproposée au tournoi par équipes suivant.
        'joueurs'     => array_map(function ($j) { return ['id' => $j['id'], 'nom' => $j['nom'], 'discord_id' => $j['discord_id'] ?? '', 'seed' => $j['seed'] ?? 0] + (isset($j['force']) ? ['force' => $j['force']] : []); }, $t['joueurs'] ?? []),
        'equipes'     => $t['equipes'] ?? [],
        'resultats'   => $t['resultats'] ?? [],
        'options'     => $t['options'] ?? [],
        'ajustements' => $t['ajustements'] ?? (object)[],
    ] : []);
}

// Corrections de points d'un organisateur : {idJoueur: {points, raison}}. La
// raison est OBLIGATOIRE — une correction sans explication ressemble à une
// triche, avec elle c'est un arbitrage. Le calcul d'origine reste affiché.
function t_clean_ajustements($list, array $ids): array {
    $out = [];
    foreach (is_array($list) ? $list : [] as $pid => $a) {
        if (!isset($ids[(string)$pid]) || !is_array($a)) continue;
        $raison = t_cut($a['raison'] ?? '', 120);
        if ($raison === '' || !is_numeric($a['points'] ?? null)) continue;
        $out[(string)$pid] = ['points' => max(0, min(100, (int)$a['points'])), 'raison' => $raison];
    }
    return $out;
}

// Envoi d'un embed par le bot Sorties. Rend la main en cas de succès, répond
// l'erreur à la page sinon, en relayant le motif donné par Discord : « Missing
// Access » (salon invisible au bot) et « Missing Permissions » (visible mais pas
// d'écriture) ne se règlent pas au même endroit, un code nu envoie chercher ailleurs.
function t_discord_post(array $CFG, string $chan, array $embed): void {
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
    if ($resp !== false && $code >= 200 && $code < 300) return;
    $j = json_decode((string)$resp, true);
    $quoiErr = trim((string)($j['message'] ?? ''));
    $aide = stripos($quoiErr, 'Missing Access') !== false ? ' — le bot ne voit pas ce salon : accorde-lui « Voir le salon » et « Envoyer des messages ».'
          : (stripos($quoiErr, 'Missing Permissions') !== false ? ' — le bot voit le salon mais ne peut pas y écrire (« Envoyer des messages », « Intégrer des liens »).' : '');
    tout(false, [], 'Discord a refusé le message (HTTP ' . $code . ($quoiErr !== '' ? ' : ' . $quoiErr : '') . ')' . $aide);
}

// Configuration du bot + salon de publication des tournois.
function t_bot(string $salonSecours = ''): array {
    $cfgPath = __DIR__ . '/discord_sortie_config.php';
    if (!file_exists($cfgPath)) tout(false, [], 'Configuration du bot absente sur le serveur.');
    $CFG = require $cfgPath;
    if (empty($CFG['bot_token']))      tout(false, [], 'Le bot n\'a pas de token configuré.');
    if (!function_exists('curl_init')) tout(false, [], 'cURL indisponible sur le serveur.');
    // Salon : réglage dédié → salon des partages → salon de secours (celui de la sortie).
    $chan = trim((string)($CFG['tournoi_channel_id'] ?? '')) ?: trim((string)($CFG['partage_channel_id'] ?? '')) ?: $salonSecours;
    if ($chan === '') tout(false, [], 'Aucun salon de publication : renseigne `tournoi_channel_id` dans discord_sortie_config.php.');
    $base = rtrim(trim((string)($CFG['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
    return [$CFG, $chan, $base];
}

// ---- Paris ------------------------------------------------------------------
// Le parieur est-il un joueur de ce tournoi ? Rapprochement par compte Discord
// (joueurs importés de la sortie ou choisis parmi les membres), sinon par nom
// (joueur tapé à la main). Fait ICI seulement : la page reçoit le résultat dans
// le champ `contre_soi` de chaque pari (cf. p_vue).
function p_joueur(array $t, string $qui, string $did): string {
    foreach ($t['joueurs'] ?? [] as $j) {
        if ($did !== '' && ($j['discord_id'] ?? '') === $did) return $j['id'];
        if ($qui !== '' && strcasecmp((string)$j['nom'], $qui) === 0) return $j['id'];
    }
    return '';
}
// Participants de l'arbre, ceux sur qui l'on parie : les joueurs en duel, les
// ÉQUIPES en 2v2/3v3/4v4 (cf. participants() du moteur).
function p_participants(array $t): array {
    $liste = t_taille_equipe($t) > 1 ? ($t['equipes'] ?? []) : ($t['joueurs'] ?? []);
    return array_flip(array_column($liste, 'id'));
}
// Camp d'un joueur : lui-même en duel, son équipe sinon ('' = remplaçant sans équipe).
function p_camp(array $t, string $jid): string {
    if ($jid === '' || t_taille_equipe($t) <= 1) return $jid;
    foreach ($t['equipes'] ?? [] as $e) if (in_array($jid, $e['membres'] ?? [], true)) return (string)$e['id'];
    return '';
}
// Les participants parient comme tout le monde, mais JAMAIS CONTRE EUX-MÊMES
// (décision de l'utilisateur, 2026-10 : les interdire de parier était « trop
// compliqué » dans un tournoi ouvert à tous ; il fallait seulement que personne
// n'ait intérêt à perdre). Contre soi = dans SON propre combat, viser le camp
// adverse. Le pari sur le vainqueur du tournoi est LIBRE, même pour un
// participant (révisé à l'usage : limité à sa propre équipe, c'était trop
// strict — Lorhelyne ne pouvait miser que sur elle).
// Un remplaçant sans équipe n'a pas de camp : il parie librement.
function p_contre_soi(array $t, string $jid, string $cible, string $a, string $b, string $choix): bool {
    if ($cible === 'vainqueur') return false;
    $c = p_camp($t, $jid);
    if ($c === '') return false;
    return ($c === $a || $c === $b) && $choix !== $c;
}
function p_meme(array $x, string $a, string $b): bool {
    return (($x['a'] ?? '') === $a && ($x['b'] ?? '') === $b) || (($x['a'] ?? '') === $b && ($x['b'] ?? '') === $a);
}
// Fenêtre de pari d'un combat. Le numéro et le tour (« Match 3 · Demi-finales »)
// viennent de la page de l'orga, seule à calculer l'arbre : ils ne servent qu'à
// l'affichage sur Discord et suivent la fenêtre quand on la rouvre ou la prolonge.
function p_ouverture($avant, string $a, string $b, int $le, int $fin): array {
    $o = ['a' => $a, 'b' => $b, 'le' => $le, 'fin' => $fin];
    if (is_array($avant)) {
        if ((int)($avant['num'] ?? 0) > 0) $o['num'] = min(999, (int)$avant['num']);
        $tour = t_cut($avant['tour'] ?? '', 40);
        if ($tour !== '') $o['tour'] = $tour;
    }
    return $o;
}
function &p_du_tournoi(array &$d, string $id): array {
    if (!isset($d['tournois'][$id]) || !is_array($d['tournois'][$id])) $d['tournois'][$id] = [];
    $P = &$d['tournois'][$id];
    foreach (['paris', 'verrous', 'reglements', 'journal', 'ouvertures'] as $k) if (!isset($P[$k]) || !is_array($P[$k])) $P[$k] = [];
    return $P;
}
function p_journal(array &$P, string $texte, ?string $par = null): void {
    $P['journal'][] = ['ts' => date('c'), 'par' => $par ?? (epice_user() ?? '?'), 'texte' => t_cut($texte, 200)];
    if (count($P['journal']) > 500) $P['journal'] = array_slice($P['journal'], -500);
}
function p_tournoi(string $id): array {
    $d = t_read();
    $i = t_index($d, $id);
    if ($i < 0) tout(false, [], 'Tournoi introuvable.');
    return $d['tournois'][$i];
}
function p_nom(array $t, string $jid): string {
    foreach (array_merge($t['equipes'] ?? [], $t['joueurs'] ?? []) as $j) if ($j['id'] === $jid) return (string)$j['nom'];
    return '?';
}
// Poser, modifier ou retirer (mise 0) un pari — depuis le site comme depuis
// Discord (discord_paris.php) : UNE SEULE copie des règles. Lève une
// RuntimeException au motif lisible par le parieur ; rend 'pose', 'modifie' ou 'retire'.
// Le serveur ne connaît pas l'arbre : il ne peut pas vérifier qu'une affiche est
// bien celle du moment. Une affiche inventée ne rapporte rien pour autant — le
// bilan de la page annule tout pari dont l'affiche ne correspond pas au match réel.
function p_parier(array $t, string $qui, string $did, string $cible, string $choix, int $mise, string $a = '', string $b = ''): string {
    if (empty($t['paris'])) throw new RuntimeException('Les paris ne sont pas ouverts sur ce tournoi.');
    if ($qui === '') throw new RuntimeException('Parieur inconnu.');
    $ids  = p_participants($t);
    $moiJ = p_joueur($t, $qui, $did);
    if ($mise < 0 || $mise > PLAFOND_PARI) throw new RuntimeException('La mise va de 1 à ' . number_format(PLAFOND_PARI, 0, ',', ' ') . ' Solaris.');
    if ($cible === 'vainqueur') {
        $a = $b = '';
        if ($t['statut'] !== 'preparation') throw new RuntimeException('Les paris sur le vainqueur sont fermés : le tournoi est lancé.');
        if (!isset($ids[$choix])) throw new RuntimeException(t_taille_equipe($t) > 1 ? 'Cette équipe ne fait pas partie du tournoi.' : 'Ce joueur ne fait pas partie du tournoi.');
        if ($mise < 1) throw new RuntimeException('Un pari sur le vainqueur est définitif : il ne se retire pas.');
        // On ne parie pas sur des équipes que les membres ne peuvent pas voir.
        if (empty($t['devoile'])) throw new RuntimeException('Les paris sur le vainqueur ouvriront quand l\'organisateur dévoilera l\'arbre.');
    } else {
        if (!preg_match(MATCH_RE, $cible)) throw new RuntimeException('Match inconnu.');
        if ($t['statut'] !== 'en_cours') throw new RuntimeException('Les paris sur les matchs ne sont ouverts que pendant le tournoi.');
        if (!isset($ids[$a]) || !isset($ids[$b]) || $a === $b) throw new RuntimeException('Affiche du match invalide, recharge la page.');
        if ($mise > 0 && $choix !== $a && $choix !== $b) throw new RuntimeException('Ce participant ne joue pas ce match.');
        // Retirer son pari (mise 0) reste toujours possible.
        if ($mise > 0 && p_contre_soi($t, $moiJ, $cible, $a, $b, $choix)) throw new RuntimeException(t_taille_equipe($t) > 1
            ? 'Ton équipe joue ce combat : tu ne peux parier que sur elle.' : 'Tu joues ce combat : tu ne peux parier que sur toi.');
        $r = $t['resultats'][$cible] ?? null;
        if (is_array($r) && p_meme(['a' => (string)($r['p1'] ?? ''), 'b' => (string)($r['p2'] ?? '')], $a, $b)) throw new RuntimeException('Ce match est déjà joué.');
    }
    return t_mutate(function (&$d) use ($t, $qui, $did, $cible, $choix, $mise, $a, $b, $ids) {
        $P = &p_du_tournoi($d, $t['id']);
        if ($cible !== 'vainqueur') {
            $v = $P['verrous'][$cible] ?? null;
            if (is_array($v) && p_meme($v, $a, $b)) throw new RuntimeException('Le combat est lancé : les paris de ce match sont fermés.');
            // Fenêtre de pari écoulée (2 min par défaut après que le combat est devenu prêt).
            $o = $P['ouvertures'][$cible] ?? null;
            if (is_array($o) && p_meme($o, $a, $b) && time() > (int)($o['fin'] ?? 0))
                throw new RuntimeException('Les paris de ce combat sont fermés : le temps de pari est écoulé.');
        }
        // Son pari sur cette cible, reconnu par compte Discord (posé depuis
        // Discord OU depuis le site), sinon par nom.
        $idx = -1;
        foreach ($P['paris'] as $k => $p) {
            if ($p['cible'] !== $cible) continue;
            if (($did !== '' && ($p['discord_id'] ?? '') === $did) || strcasecmp((string)$p['qui'], $qui) === 0) { $idx = $k; break; }
        }
        $avant = $idx >= 0 ? $P['paris'][$idx] : null;
        // « Sans possibilité de changer » : seul un pari devenu caduc (joueur
        // retiré de la liste) peut être remplacé.
        if ($cible === 'vainqueur' && $avant && isset($ids[$avant['choix']])) throw new RuntimeException('Ton pari sur le vainqueur est définitif.');
        $quoi = $cible === 'vainqueur' ? 'vainqueur du tournoi' : 'match ' . $cible;
        if ($mise === 0) {
            if (!$avant) throw new RuntimeException('Aucun pari à retirer.');
            array_splice($P['paris'], $idx, 1);
            p_journal($P, "{$qui} retire son pari ({$quoi})", $qui);
            return 'retire';
        }
        $n = ['id' => $avant['id'] ?? 'b' . substr(md5(uniqid('', true)), 0, 10), 'qui' => $avant['qui'] ?? $qui,
              'discord_id' => $did !== '' ? $did : (string)($avant['discord_id'] ?? ''),
              'cible' => $cible, 'choix' => $choix, 'a' => $a, 'b' => $b, 'mise' => $mise,
              'le' => $avant['le'] ?? date('c')] + ($avant ? ['maj' => date('c')] : []);
        if ($avant) $P['paris'][$idx] = $n; else $P['paris'][] = $n;
        p_journal($P, ($avant ? "{$qui} modifie son pari" : "{$qui} parie") . " ({$quoi}) : {$mise} Solaris sur " . p_nom($t, $choix), $qui);
        return $avant ? 'modifie' : 'pose';
    }, 'paris.json');
}

// Ce que la page reçoit. Un membre voit les cagnottes (montants par joueur) et
// ses propres paris ; QUI a misé quoi reste à ceux qui gèrent le tournoi et au
// banquier (le créateur, ou la personne désignée).
function p_vue(array $t): void {
    $gere = t_peut_gerer($t);
    $orga = $gere || t_est_banquier($t);     // accès au carnet (noms, journal, règlements)
    $moi  = epice_user() ?? '';
    $did  = (string)($_SESSION['discord_id'] ?? '');
    $P = t_read('paris.json')['tournois'][$t['id']] ?? [];
    $alias = []; $paris = [];
    foreach ($P['paris'] ?? [] as $p) {
        // Un booléen et pas l'id du combattant : sur un pari anonymisé, l'id
        // aurait dit QUI avait parié.
        $j = p_joueur($t, (string)$p['qui'], (string)($p['discord_id'] ?? ''));
        $p['contre_soi'] = p_contre_soi($t, $j, (string)$p['cible'], (string)($p['a'] ?? ''), (string)($p['b'] ?? ''), (string)$p['choix']);
        $p['moi'] = strcasecmp((string)$p['qui'], $moi) === 0;
        if (!$orga && !$p['moi']) {
            $k = strtolower((string)$p['qui']);
            if (!isset($alias[$k])) $alias[$k] = 'parieur-' . (count($alias) + 1);
            $p['qui'] = $alias[$k];
        }
        unset($p['discord_id']);
        $paris[] = $p;
    }
    $regl = $P['reglements'] ?? [];
    // Un membre ne voit que ses règlements : comme parieur, et comme lauréat (« lot:<son id> »).
    $moiJ = p_joueur($t, $moi, $did);
    $moiC = p_camp($t, $moiJ);
    $monLot = 'lot:' . $moiC;
    if (!$orga) $regl = array_filter($regl, function ($k) use ($moi, $monLot) {
        return strcasecmp((string)$k, $moi) === 0 || ($monLot !== 'lot:' && (string)$k === $monLot);
    }, ARRAY_FILTER_USE_KEY);
    tout(true, [
        'paris' => $paris, 'verrous' => (object)($P['verrous'] ?? []), 'reglements' => (object)$regl,
        'journal' => $orga ? array_reverse($P['journal'] ?? []) : [],
        // Camp du membre connecté (son id en duel, son équipe sinon) ; « * » =
        // inscrit mais remplaçant ; '' = ne combat pas.
        'moi' => $moi, 'joueur_moi' => $moiC !== '' ? $moiC : ($moiJ !== '' ? '*' : ''),
        'peut_gerer' => $gere, 'peut_banque' => $orga, 'banquier' => t_banquier_nom($t), 'plafond' => PLAFOND_PARI,
        // Fenêtre de pari de chaque combat : {idMatch: {a, b, le, fin}} en secondes
        // epoch, plus l'heure du serveur pour que la page corrige l'horloge du
        // navigateur (un compte à rebours faux de 30 s fermerait trop tôt ou trop tard).
        'ouvertures' => (object)($P['ouvertures'] ?? []), 'maintenant' => time(), 'fenetre' => t_fenetre($t),
    ]);
}

// ---- Paris sur Discord ----------------------------------------------------
//  UN message par tournoi, posté par le bot dès qu'on peut parier (arbre dévoilé
//  en préparation, ou tournoi lancé), puis RÉÉDITÉ à chaque événement : fenêtre
//  ouverte, pari, combat fermé, résultat, clôture. Ses boutons mènent à
//  discord_paris.php (parier sans quitter Discord). Son adresse est rangée dans
//  paris.json (`discord` : {canal, message}).
//  Jamais bloquant : l'envoi part APRÈS la réponse à la page (p_discord_plus_tard),
//  et un refus de Discord ne fait échouer aucune action du site.

// Bot + salon, sans jamais répondre d'erreur (contrairement à t_bot) : pas de bot
// configuré = pas de message, le site fonctionne pareil. Salon '' = aucun salon
// où poster (on peut encore éditer ou effacer un message existant).
function p_discord_cfg(array $t): ?array {
    $cfgPath = __DIR__ . '/discord_sortie_config.php';
    if (!file_exists($cfgPath) || !function_exists('curl_init')) return null;
    $CFG = require $cfgPath;
    if (!is_array($CFG) || empty($CFG['bot_token'])) return null;
    $chan = trim((string)($CFG['tournoi_channel_id'] ?? '')) ?: trim((string)($CFG['partage_channel_id'] ?? '')) ?: (string)($t['sortie_channel_id'] ?? '');
    $base = rtrim(trim((string)($CFG['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
    return [$CFG, $chan, $base];
}
// Appel REST au nom du bot → [code HTTP, réponse décodée]. Un 429 (trop
// d'éditions d'affilée, une rafale de paris) est retenté une fois s'il est court.
function p_discord_api(array $CFG, string $methode, string $chemin, ?array $payload = null): array {
    for ($essai = 0; $essai < 4; $essai++) {
        $ch = curl_init('https://discord.com/api/v10/' . $chemin);
        $opt = [
            CURLOPT_CUSTOMREQUEST  => $methode,
            CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT        => 8,
        ];
        if ($payload !== null) $opt[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE);
        curl_setopt_array($ch, $opt);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $j = json_decode((string)$resp, true);
        if ($code === 429 && $essai < 3 && (float)($j['retry_after'] ?? 9) <= 5) { usleep((int)(1e6 * (float)$j['retry_after']) + 100000); continue; }
        if ($code < 200 || $code >= 300) p_discord_log("{$methode} {$chemin} → HTTP {$code} " . substr((string)$resp, 0, 300));
        return [$code, is_array($j) ? $j : []];
    }
    return [429, []];
}

function p_sol(int $n): string { return number_format($n, 0, ',', ' '); }
// « Match 3 · Demi-finales » : numéro et tour envoyés par la page de l'orga avec
// la fenêtre de pari (le serveur ne calcule pas l'arbre) ; à défaut, l'identifiant.
function p_lib_match(array $o, string $cible): string {
    $n = (int)($o['num'] ?? 0);
    $tour = trim((string)($o['tour'] ?? ''));
    return ($n > 0 ? 'Match ' . $n : $cible) . ($tour !== '' ? ' · ' . $tour : '');
}
// Mises par camp sur un combat (même affiche), pour les cotes du message.
function p_cagnotte(array $P, string $cible, string $a, string $b): array {
    $c = ['camps' => [$a => 0, $b => 0], 'nb' => 0, 'total' => 0];
    foreach ($P['paris'] ?? [] as $p) {
        if (($p['cible'] ?? '') !== $cible || !p_meme($p, $a, $b) || !isset($c['camps'][$p['choix']])) continue;
        $c['camps'][$p['choix']] += (int)$p['mise']; $c['nb']++; $c['total'] += (int)$p['mise'];
    }
    return $c;
}
// « Gurney & Harah 3 000 (×1,7) » — la cote est ce que rapporte 1 Solaris misé
// sur ce camp si la cagnotte restait en l'état.
function p_ligne_camp(array $t, array $c, string $id): string {
    $m = $c['camps'][$id] ?? 0;
    return '**' . p_nom($t, $id) . '** ' . p_sol($m) . ($m > 0 ? ' (×' . number_format($c['total'] / $m, 1, ',', '') . ')' : '');
}
// État de chaque combat connu des fenêtres de pari : 'ouvert', 'lance' (paris
// fermés, pas encore de résultat) ou 'joue'.
function p_etat_combat(array $t, array $P, string $cible, array $o, int $now): string {
    $r = $t['resultats'][$cible] ?? null;
    if (is_array($r) && p_meme(['a' => (string)($r['p1'] ?? ''), 'b' => (string)($r['p2'] ?? '')], (string)$o['a'], (string)$o['b'])) return 'joue';
    $v = $P['verrous'][$cible] ?? null;
    if ((is_array($v) && p_meme($v, (string)$o['a'], (string)$o['b'])) || $now >= (int)($o['fin'] ?? 0)) return 'lance';
    return 'ouvert';
}
// Le message lui-même : un embed + les boutons de pari. Anonyme comme la page :
// des montants par camp, jamais qui a misé.
function p_discord_message(array $t, array $P, string $base): array {
    $now = time();
    $eq  = t_taille_equipe($t) > 1;
    $tid = (string)$t['id'];
    $L = [];
    $boutons = [];
    $L[] = 'Vrais Solaris du jeu · banquier : **' . (t_banquier_nom($t) ?: '—') . '** ' . p_role_banquier($t) . ' · jusqu\'à ' . p_sol(PLAFOND_PARI) . ' par pari · jamais contre soi.';
    if (empty($t['paris'])) {
        $L[] = "\n🔒 Les paris sont désactivés sur ce tournoi.";
    } elseif ($t['statut'] === 'preparation') {
        if (empty($t['devoile'])) {
            $L[] = "\n🙈 L'organisation compose encore l'arbre : les paris sur le vainqueur ouvriront à son dévoilement.";
        } else {
            $tot = []; $nb = 0;
            foreach ($P['paris'] ?? [] as $p) if ($p['cible'] === 'vainqueur') { $tot[$p['choix']] = ($tot[$p['choix']] ?? 0) + (int)$p['mise']; $nb++; }
            arsort($tot);
            $L[] = "\n🏆 **Qui remportera le tournoi ?** Pari ouvert jusqu'au lancement, définitif une fois posé.";
            $L[] = $nb ? '🎲 ' . $nb . ' pari' . ($nb > 1 ? 's' : '') . ' · ' . p_sol(array_sum($tot)) . ' Solaris en jeu' : '🎲 Aucun pari pour l\'instant : à toi d\'ouvrir la cagnotte.';
            $favoris = array_slice($tot, 0, 5, true);
            if ($favoris) $L[] = implode("\n", array_map(function ($id, $m) use ($t, $tot) {
                return '› **' . p_nom($t, (string)$id) . '** ' . p_sol($m) . ' (×' . number_format(array_sum($tot) / $m, 1, ',', '') . ')';
            }, array_keys($favoris), $favoris));
            $boutons[] = ['type' => 2, 'style' => 1, 'label' => 'Parier sur le vainqueur', 'emoji' => ['name' => '🏆'], 'custom_id' => 'tpari:' . $tid . ':vainqueur'];
        }
    } elseif ($t['statut'] === 'en_cours') {
        $nbV = 0; $totV = 0;
        foreach ($P['paris'] ?? [] as $p) if ($p['cible'] === 'vainqueur') { $nbV++; $totV += (int)$p['mise']; }
        if ($nbV) $L[] = "\n🏆 Vainqueur du tournoi : {$nbV} pari" . ($nbV > 1 ? 's' : '') . ' · ' . p_sol($totV) . ' Solaris en jeu (fermé depuis le lancement)';
        $ouverts = []; $lances = [];
        foreach ($P['ouvertures'] ?? [] as $cible => $o) {
            if (!is_array($o) || !preg_match(MATCH_RE, (string)$cible)) continue;
            $e = p_etat_combat($t, $P, (string)$cible, $o, $now);
            if ($e === 'ouvert') $ouverts[$cible] = $o; elseif ($e === 'lance') $lances[$cible] = $o;
        }
        uasort($ouverts, function ($x, $y) { return (int)($x['num'] ?? 0) <=> (int)($y['num'] ?? 0); });
        if ($ouverts) {
            $L[] = "\n🎲 **Paris ouverts** — mise modifiable jusqu'à la fermeture";
            foreach ($ouverts as $cible => $o) {
                $c = p_cagnotte($P, (string)$cible, (string)$o['a'], (string)$o['b']);
                // Heure exacte à la seconde + relatif : au-delà d'une minute, Discord
                // n'affiche le relatif qu'à la minute près (« dans 2 minutes »).
                $L[] = '**' . p_lib_match($o, (string)$cible) . '** · ferme à <t:' . (int)$o['fin'] . ':T> (<t:' . (int)$o['fin'] . ':R>)'
                     . "\n" . p_ligne_camp($t, $c, (string)$o['a']) . ' — ' . p_ligne_camp($t, $c, (string)$o['b'])
                     . ($c['nb'] ? '' : ' · _aucun pari_');
                if (count($boutons) < 20) $boutons[] = ['type' => 2, 'style' => 1, 'label' => t_cut('Match ' . ((int)($o['num'] ?? 0) ?: $cible), 80), 'emoji' => ['name' => '🎲'], 'custom_id' => 'tpari:' . $tid . ':' . $cible];
            }
        } else {
            $L[] = "\n⏳ Aucun pari ouvert pour l'instant : chaque combat s'ouvre aux paris dès que ses adversaires sont connus, pendant " . t_fenetre($t) . ' min.';
        }
        if ($lances) {
            $L[] = "\n⚔️ **Combats lancés** — paris fermés";
            foreach (array_slice($lances, 0, 6, true) as $cible => $o) {
                $c = p_cagnotte($P, (string)$cible, (string)$o['a'], (string)$o['b']);
                $L[] = p_lib_match($o, (string)$cible) . ' : ' . p_nom($t, (string)$o['a']) . ' contre ' . p_nom($t, (string)$o['b']) . ($c['total'] ? ' · ' . p_sol($c['total']) . ' Solaris en jeu' : '');
            }
        }
        $res = array_slice($t['resultats'] ?? [], -3, null, true);
        if ($res) {
            $L[] = "\n📜 **Derniers résultats**";
            foreach (array_reverse($res, true) as $cible => $r) {
                if (empty($r['w'])) continue;
                $perdant = $r['w'] === ($r['p1'] ?? '') ? (string)($r['p2'] ?? '') : (string)($r['p1'] ?? '');
                $o = $P['ouvertures'][$cible] ?? [];
                $L[] = '🏆 ' . p_nom($t, (string)$r['w']) . ' bat ' . p_nom($t, $perdant) . (is_array($o) && !empty($o['num']) ? ' (' . p_lib_match($o, (string)$cible) . ')' : '');
            }
        }
    } else {
        $med = [1 => '🥇', 2 => '🥈', 3 => '🥉'];
        $L[] = "\n🏁 **Tournoi terminé — paris clos.**";
        foreach ($t['podium'] ?? [] as $p) if (isset($med[$p['rang'] ?? 0])) $L[] = $med[$p['rang']] . ' ' . ($eq ? 'Équipe ' : '') . '**' . $p['nom'] . '**';
        $C = $P['comptes'] ?? null;
        if (is_array($C) && !empty($C['soldes'])) {
            // Totaux seulement : QUI doit quoi reste privé (MP à chacun, « Mes paris »),
            // comme sur le site où le carnet est réservé au banquier.
            $enc = 0; $ver = 0;
            foreach ($C['soldes'] as $x) { $n = (int)$x['net']; if ($n < 0) $enc -= $n; else $ver += $n; }
            $lotsTot = array_sum(array_map('intval', $C['lots'] ?? []));
            $L[] = "\n💰 **Les comptes** · " . count($C['soldes']) . ' parieur' . (count($C['soldes']) > 1 ? 's' : '');
            $L[] = 'Le banquier **' . (t_banquier_nom($t) ?: '—') . '** ' . p_role_banquier($t) . ' encaisse **' . p_sol($enc) . '** des perdants, verse **' . p_sol($ver) . '** aux gagnants'
                 . ($lotsTot ? ' et **' . p_sol($lotsTot) . '** aux lots du podium' : '') . ' : il ne gagne ni ne perd rien (ses propres paris mis à part).';
            foreach ($t['podium'] ?? [] as $p) if (!empty($C['lots'][$p['id']])) $L[] = ($med[$p['rang']] ?? '🏅') . ' ' . $p['nom'] . ' : +' . p_sol((int)$C['lots'][$p['id']]) . ' Solaris (paris sans gagnant)';
            $L[] = "\nChaque parieur relié à Discord a reçu son solde en message privé ; « Mes paris » le redonne. Tout se règle en jeu avec le banquier.";
        } else {
            $L[] = "\nLe banquier règle les gains en jeu ; les comptes seront donnés à la publication des résultats (« Mes paris » pour un aperçu).";
        }
    }
    $lien = $base . '/epice/tournois.html?t=' . rawurlencode($tid);
    $rangs = [];
    foreach (array_chunk($boutons, 5) as $r) $rangs[] = ['type' => 1, 'components' => $r];
    $rangs[] = ['type' => 1, 'components' => [
        ['type' => 2, 'style' => 2, 'label' => 'Mes paris', 'emoji' => ['name' => '📋'], 'custom_id' => 'tparimes:' . $tid],
        ['type' => 2, 'style' => 5, 'label' => 'Voir sur le site', 'url' => $lien],
    ]];
    return [
        'embeds' => [[
            'title' => t_cut('🎲 Paris — ' . $t['nom'], 250), 'url' => $lien,
            'description' => t_cut(implode("\n", $L), 4000), 'color' => hexdec('D4A23B'),
            'footer' => ['text' => 'Mis à jour'], 'timestamp' => date('c'),
        ]],
        'components' => $rangs,
        'allowed_mentions' => ['parse' => []],
    ];
}
// Journal des envois à Discord (epice/data/paris_discord.log) : le seul moyen de
// savoir, sur le serveur, ce que Discord a répondu — tout se passe après la
// réponse à la page, aucune erreur ne remonte à l'écran.
function p_discord_log(string $texte): void {
    $f = t_file('paris_discord.log');
    $neuf = !file_exists($f);
    if (!$neuf && filesize($f) > 200000) { @rename($f, $f . '.1'); $neuf = true; }
    @file_put_contents($f, date('c') . ' ' . $texte . "\n", FILE_APPEND | LOCK_EX);
    if ($neuf) @chmod($f, 0664);
}
// Poste le message s'il n'existe pas encore (et qu'il a lieu d'être), le réédite sinon.
// Toujours avec l'état relu à l'instant de l'envoi.
//  ⚠ Course vue au premier test sur /v2 : au lancement, la sauvegarde poste le
//  message pendant que la page ouvre déjà les premiers combats aux paris. Cette
//  2ᵉ mise à jour trouvait le premier envoi en cours (pas encore d'id) et
//  renonçait : le message restait figé sur « aucun pari ouvert ». Désormais elle
//  ATTEND l'id (6 s au plus) puis réédite.
function p_discord_maj(string $tid): void {
    $relances = 0;
    for ($essai = 0; $essai < 30; $essai++) {
        $d = t_read();
        $i = t_index($d, $tid);
        if ($i < 0) return;
        $t = $d['tournois'][$i];
        $cfg = p_discord_cfg($t);
        if (!$cfg) return;
        [$CFG, $chan, $base] = $cfg;
        // Tournoi tout juste lancé, annonce pas encore partie : on ne touche à rien.
        // Les paris s'afficheraient AVANT l'annonce du tournoi (retour du test /v2) ;
        // c'est la publication de l'annonce qui (re)poste le message en dessous.
        // Filet : 90 s après le lancement sans annonce (bot en panne…), on y va quand même.
        if (p_attend_annonce($t)) { p_discord_log("{$tid} en attente de l'annonce de lancement"); return; }
        $P = t_read('paris.json')['tournois'][$tid] ?? [];
        $msg = $P['discord'] ?? null;
        $contenu = p_discord_message($t, $P, $base);
        $vu = p_vu($contenu);
        if (is_array($msg) && !empty($msg['message'])) {
            // Déjà à jour (dernier contenu ACCEPTÉ par Discord) : rien à faire. C'est
            // ce qui permet à la page de l'orga de demander une vérification toutes
            // les 20 s sans rien coûter quand tout va bien.
            if (($msg['vu'] ?? '') === $vu) return;
            [$code] = p_discord_api($CFG, 'PATCH', 'channels/' . $msg['canal'] . '/messages/' . $msg['message'], $contenu);
            p_discord_log("{$tid} édition → HTTP {$code}");
            if ($code === 404) {
                // Supprimé à la main sur Discord : on l'oublie, et on le reposte s'il a encore lieu d'être.
                t_mutate(function (&$d) use ($tid) { if (isset($d['tournois'][$tid])) unset($d['tournois'][$tid]['discord']); }, 'paris.json');
                continue;
            }
            if ($code >= 200 && $code < 300) {
                t_mutate(function (&$d) use ($tid, $msg, $vu) {
                    $P = &p_du_tournoi($d, $tid);
                    if (($P['discord']['message'] ?? '') === $msg['message']) $P['discord']['vu'] = $vu;
                }, 'paris.json');
            } else {
                usleep(1500000);   // refus passager (limite de Discord…) : on retente
            }
            // On repasse dans la boucle : si un pari ou un résultat est arrivé PENDANT
            // l'édition (ou si elle a échoué), le contenu diffère et on réédite ; sinon
            // le « déjà à jour » ci-dessus nous fait sortir.
            if (++$relances > 4) { p_discord_log("{$tid} abandon après 4 rééditions"); return; }
            continue;
        }
        // Premier envoi en cours ailleurs : attendre son id pour rééditer.
        if (is_array($msg) && time() - (int)($msg['reserve'] ?? 0) < 20) { usleep(200000); continue; }
        $aLieu = !empty($t['paris']) && ($t['statut'] === 'en_cours' || ($t['statut'] === 'preparation' && !empty($t['devoile'])));
        if (!$aLieu || $chan === '') return;
        // Place réservée sous verrou, pour que deux requêtes simultanées (deux
        // orgas, un pari) ne postent pas deux messages.
        $libre = t_mutate(function (&$d) use ($tid) {
            $P = &p_du_tournoi($d, $tid);
            $m = $P['discord'] ?? null;
            if (is_array($m) && (!empty($m['message']) || time() - (int)($m['reserve'] ?? 0) < 20)) return false;
            $P['discord'] = ['reserve' => time()];
            return true;
        }, 'paris.json');
        if (!$libre) continue;
        $contenu = p_discord_message($t, t_read('paris.json')['tournois'][$tid] ?? [], $base);
        [$code, $j] = p_discord_api($CFG, 'POST', 'channels/' . $chan . '/messages', $contenu);
        $mid = $code >= 200 && $code < 300 ? (string)($j['id'] ?? '') : '';
        p_discord_log("{$tid} envoi dans {$chan} → HTTP {$code}" . ($mid === '' ? ' ' . substr(json_encode($j, JSON_UNESCAPED_UNICODE), 0, 300) : ''));
        $vu = p_vu($contenu);
        t_mutate(function (&$d) use ($tid, $chan, $mid, $vu) {
            $P = &p_du_tournoi($d, $tid);
            if ($mid === '') unset($P['discord']);
            else $P['discord'] = ['canal' => $chan, 'message' => $mid, 'le' => date('c'), 'vu' => $vu];
        }, 'paris.json');
        if ($mid === '') return;
        continue;          // un événement arrivé pendant l'envoi → réédition aussitôt
    }
    p_discord_log("{$tid} abandon : premier envoi toujours en cours après 6 s");
}
// Empreinte d'un contenu de message, sans l'heure de mise à jour (qui change toujours).
function p_vu(array $contenu): string {
    unset($contenu['embeds'][0]['timestamp']);
    return md5(json_encode($contenu));
}
// « (l'organisateur) » ou « (désigné par l'organisateur) » : qu'on sache à qui payer
// et que le banquier sache que c'est lui.
function p_role_banquier(array $t): string {
    return !empty($t['banquier']['nom']) && strcasecmp((string)$t['banquier']['nom'], (string)($t['cree_par'] ?? '')) !== 0
        ? '(désigné par l\'organisateur)' : '(l\'organisateur du tournoi)';
}
function p_attend_annonce(array $t): bool {
    if (($t['statut'] ?? '') !== 'en_cours' || empty($t['lance_le'])) return false;
    $annonce = strtotime((string)($t['publie']['lancement'] ?? '')) ?: 0;
    return $annonce < (int)$t['lance_le'] && time() - (int)$t['lance_le'] < 90;
}
// Compte Discord d'un membre du site, par son pseudo (users_SECURE_9x.json).
function p_did_site(string $nom): string {
    static $users = null;
    if ($users === null) {
        $f = dirname(__DIR__) . '/users_SECURE_9x.json';
        $users = is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
    }
    foreach ($users as $u) if (strcasecmp((string)($u['user'] ?? ''), $nom) === 0) return preg_replace('/\D/', '', (string)($u['discord_id'] ?? ''));
    return '';
}
// Comptes de fin, envoyés par la page à la publication des résultats : le
// serveur ne calcule pas le bilan (tournoi-paris.js, moteur unique). Rangés dans
// paris.json, ils alimentent le message final, « Mes paris » et les MP.
function p_comptes(array $t, array $soldes, array $lots): void {
    $P0 = t_read('paris.json')['tournois'][$t['id']] ?? [];
    $dids = [];
    foreach ($P0['paris'] ?? [] as $p) if (!empty($p['discord_id'])) $dids[strtolower((string)$p['qui'])] = (string)$p['discord_id'];
    $out = [];
    foreach (array_slice($soldes, 0, 300) as $x) {
        $qui = t_cut(is_array($x) ? ($x['qui'] ?? '') : '', 60);
        if ($qui === '') continue;
        $out[$qui] = ['net' => max(-10000000, min(10000000, (int)($x['net'] ?? 0))), 'did' => $dids[strtolower($qui)] ?? p_did_site($qui)];
    }
    $lotsOk = [];
    foreach ($lots as $id => $m) if (preg_match('/^[A-Za-z0-9_-]+$/', (string)$id) && (int)$m > 0) $lotsOk[(string)$id] = (int)$m;
    t_mutate(function (&$d) use ($t, $out, $lotsOk) {
        $P = &p_du_tournoi($d, $t['id']);
        $P['comptes'] = ['le' => date('c'), 'soldes' => $out, 'lots' => $lotsOk];
    }, 'paris.json');
    p_discord_plus_tard($t['id']);
    register_shutdown_function(function () use ($t) {
        try { p_discord_mp($t['id']); } catch (Throwable $e) { p_discord_log($t['id'] . ' MP : ' . $e->getMessage()); }
    });
}
// Message privé du bot à un membre. false si refusé (MP fermés aux membres du serveur…).
function p_discord_dm(array $CFG, string $did, string $texte): bool {
    [$code, $j] = p_discord_api($CFG, 'POST', 'users/@me/channels', ['recipient_id' => $did]);
    if ($code < 200 || $code >= 300 || empty($j['id'])) return false;
    [$code] = p_discord_api($CFG, 'POST', 'channels/' . $j['id'] . '/messages', ['content' => t_cut($texte, 1900), 'allowed_mentions' => ['parse' => []]]);
    return $code >= 200 && $code < 300;
}
// Un MP à chaque parieur relié à Discord : son solde et à qui le régler. Et au
// banquier, le carnet complet (qui lui doit, à qui verser). Un solde déjà envoyé
// n'est pas renvoyé ; s'il a changé (résultat corrigé puis republié), le MP le dit.
function p_discord_mp(string $tid): void {
    $d = t_read(); $i = t_index($d, $tid);
    if ($i < 0) return;
    $t = $d['tournois'][$i];
    $P = t_read('paris.json')['tournois'][$tid] ?? [];
    $C = $P['comptes'] ?? null;
    $cfg = p_discord_cfg($t);
    if (!$cfg || !is_array($C)) return;
    [$CFG, , $base] = $cfg;
    $lien = $base . '/epice/tournois.html?t=' . rawurlencode($tid);
    $banquier = t_banquier_nom($t) ?: 'le banquier';
    $deja = $P['mp'] ?? [];
    $envoyes = [];
    foreach ($C['soldes'] as $qui => $x) {
        $net = (int)$x['net'];
        if (($x['did'] ?? '') === '' || (array_key_exists($qui, $deja) && (int)$deja[$qui] === $net)) continue;
        $tete = array_key_exists($qui, $deja) ? '✏️ **Correction** (un résultat a changé) — ' : '';
        $txt = $tete . "🎲 **Paris du tournoi « {$t['nom']} »** — c'est terminé.\n"
             . ($net > 0 ? "Tu gagnes **+" . p_sol($net) . " Solaris** : **{$banquier}** te les verse en jeu."
               : ($net < 0 ? "Tu dois **" . p_sol(-$net) . " Solaris** à **{$banquier}** : envoie-les-lui en jeu."
               : "Tu es à l'équilibre : rien à payer, rien à recevoir."))
             . "\nLe détail de tes paris : <{$lien}>";
        $ok = p_discord_dm($CFG, (string)$x['did'], $txt);
        p_discord_log("{$tid} MP {$qui} → " . ($ok ? 'envoyé' : 'refusé'));
        if ($ok) $envoyes[$qui] = $net;
        usleep(250000);
    }
    // Le carnet complet au banquier (renvoyé seulement s'il a changé).
    $didB = !empty($t['banquier']['nom']) ? (string)($t['banquier']['discord_id'] ?? '') : '';
    if ($didB === '') $didB = p_did_site(t_banquier_nom($t));
    $carnet = [];
    $soldes = $C['soldes'];
    uasort($soldes, function ($a, $b) { return $a['net'] <=> $b['net']; });
    foreach ($soldes as $qui => $x) {
        $n = (int)$x['net'];
        $carnet[] = $n < 0 ? "› **{$qui}** te doit " . p_sol(-$n) : ($n > 0 ? "› à verser à **{$qui}** : " . p_sol($n) : "› {$qui} : à l'équilibre");
    }
    foreach ($t['podium'] ?? [] as $p) if (!empty($C['lots'][$p['id']])) $carnet[] = "› lots des paris à **{$p['nom']}** : " . p_sol((int)$C['lots'][$p['id']]);
    $empreinteB = md5(json_encode($carnet));
    if ($didB !== '' && $carnet && ($P['mp']['@banque'] ?? '') !== $empreinteB) {
        $enc = 0; $ver = 0;
        foreach ($C['soldes'] as $x) { $n = (int)$x['net']; if ($n < 0) $enc -= $n; else $ver += $n; }
        $lotsTot = array_sum(array_map('intval', $C['lots'] ?? []));
        $ok = p_discord_dm($CFG, $didB, "📒 **Carnet du banquier — « {$t['nom']} »**\n"
            . "Tu es le banquier " . p_role_banquier($t) . " : tu encaisses **" . p_sol($enc) . "** des perdants et tu verses **" . p_sol($ver) . "** aux gagnants"
            . ($lotsTot ? " et **" . p_sol($lotsTot) . "** aux lots du podium" : '') . ". Ça s'équilibre : la banque ne gagne ni ne perd (tes propres paris mis à part, ton solde de parieur t'est envoyé à part).\n"
            . implode("\n", $carnet) . "\nCoche « Réglé » au fil des échanges : <{$lien}>");
        p_discord_log("{$tid} MP banquier → " . ($ok ? 'envoyé' : 'refusé'));
        if ($ok) $envoyes['@banque'] = $empreinteB;
    }
    if ($envoyes) t_mutate(function (&$d) use ($tid, $envoyes) {
        $P = &p_du_tournoi($d, $tid);
        $P['mp'] = array_merge(is_array($P['mp'] ?? null) ? $P['mp'] : [], $envoyes);
    }, 'paris.json');
}
// Mise à jour APRÈS la réponse : la page de l'orga n'attend pas Discord.
// $enBas : effacer l'ancien message et le reposter en bas du salon. Au lancement
// et après chaque « 📣 Annoncer » : sinon il reste là où il est né (au dévoilement,
// parfois des heures avant), noyé au-dessus des annonces — au test sur /v2,
// l'orga ne voyait que l'annonce et croyait le message des paris pas à jour.
function p_discord_plus_tard(string $tid, bool $enBas = false): void {
    static $prevus = [];
    if ($tid === '') return;
    $deja = isset($prevus[$tid]);
    $prevus[$tid] = ($prevus[$tid] ?? false) || $enBas;
    if ($deja) return;
    register_shutdown_function(function () use ($tid, &$prevus) {
        // Rendre la session tout de suite : sinon la requête suivante du même
        // navigateur attendrait la fin de l'appel à Discord.
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try {
            if ($prevus[$tid]) p_discord_descendre($tid);
            p_discord_maj($tid);
        } catch (Throwable $e) { p_discord_log($tid . ' : ' . $e->getMessage()); }
    });
}
// Efface le message des paris (p_discord_maj le reposte aussitôt, en bas du salon).
function p_discord_descendre(string $tid): void {
    $msg = t_read('paris.json')['tournois'][$tid]['discord'] ?? null;
    if (!is_array($msg) || empty($msg['message'])) return;
    $d = t_read(); $i = t_index($d, $tid);
    $cfg = p_discord_cfg($i >= 0 ? $d['tournois'][$i] : []);
    if (!$cfg) return;
    t_mutate(function (&$d) use ($tid) { if (isset($d['tournois'][$tid])) unset($d['tournois'][$tid]['discord']); }, 'paris.json');
    [$code] = p_discord_api($cfg[0], 'DELETE', 'channels/' . $msg['canal'] . '/messages/' . $msg['message']);
    p_discord_log("{$tid} message déplacé en bas (effacement → HTTP {$code})");
}
// Tournoi supprimé : son message de paris part avec lui.
function p_discord_supprimer(array $msg): void {
    if (empty($msg['message']) || empty($msg['canal'])) return;
    register_shutdown_function(function () use ($msg) {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        $cfg = p_discord_cfg([]);
        if ($cfg) p_discord_api($cfg[0], 'DELETE', 'channels/' . $msg['canal'] . '/messages/' . $msg['message']);
    });
}

if (defined('TOURNOIS_LIB')) return;

switch ($action) {

    case 'list':
        $d = t_read();
        $liste = array_map('t_resume', $d['tournois']);
        // La force des joueurs (resservie pour composer les équipes suivantes) ne
        // sert qu'à ceux qui composent : les autres membres ne la reçoivent pas.
        if (!t_gere_un_tournoi()) foreach ($liste as &$r) {
            if (isset($r['joueurs'])) $r['joueurs'] = array_map(function ($j) { unset($j['force']); return $j; }, $r['joueurs']);
        }
        unset($r);
        usort($liste, function ($a, $b) { return strcmp($b['date'] . $b['heure'], $a['date'] . $a['heure']); });
        tout(true, ['tournois' => $liste, 'peut_gerer' => epice_can_organize(),
                    'admin' => epice_role() === 'admin', 'moi' => epice_user()]);

    case 'get':
        $d = t_read();
        $id = (string)($_GET['id'] ?? '');
        $sid = (string)($_GET['sortie'] ?? '');
        foreach ($d['tournois'] as $t) {
            if (($id !== '' && $t['id'] === $id) || ($id === '' && $sid !== '' && ($t['sortie_id'] ?? '') === $sid)) {
                $gere = t_peut_gerer($t);
                tout(true, ['tournoi' => $gere ? $t : t_vue_membre($t), 'peut_gerer' => $gere,
                            'peut_supprimer' => t_peut_supprimer($t)]);
            }
        }
        tout(false, [], 'Tournoi introuvable.');

    // Lien de l'encart Discord vers un tournoi pas encore monté : le visiteur
    // peut-il le créer ? (organisateur, ou créateur de cette sortie)
    case 'droits_sortie':
        $sid = (string)($_GET['sortie'] ?? '');
        tout(true, ['peut_creer' => epice_can_organize() || t_createur_sortie($sid)]);

    // Sorties Discord récentes auxquelles rattacher un tournoi : UNIQUEMENT les
    // activités « Tournoi PvP ». Les autres étaient proposées en second choix (pour
    // un tournoi improvisé pendant une autre soirée) et noyaient la liste sous les
    // soirées Landsraad et les chantiers — retiré à la demande de l'utilisateur.
    // Un tournoi improvisé se monte sans sortie, joueurs ajoutés depuis les membres.
    case 'sorties':
        $lim = date('Y-m-d', strtotime('-21 days'));
        $deja = [];
        foreach (t_read()['tournois'] as $t) if (!empty($t['sortie_id'])) $deja[$t['sortie_id']] = $t['id'];
        $out = [];
        $orga = epice_can_organize();
        foreach (t_dstore() as $s) {
            // array_key_exists et non isset() : isset() sur une constante est fatal.
            if (!array_key_exists((string)($s['type'] ?? ''), TYPE_NIVEAU)) continue;
            if (!$orga && !epice_is_creator($s)) continue;   // un membre : ses propres sorties seulement
            if (($s['date'] ?? '') !== '' && $s['date'] < $lim) continue;
            $presents = 0;
            foreach ($s['signups'] ?? [] as $su) if (($su['statut'] ?? 'present') === 'present') $presents++;
            $out[] = ['id' => $s['id'], 'titre' => $s['titre'] ?? '', 'type' => $s['type'] ?? '',
                      'niveau' => TYPE_NIVEAU[$s['type']], 'date' => $s['date'] ?? '',
                      'heure' => $s['heure'] ?? '', 'presents' => $presents, 'tournoi' => $deja[$s['id']] ?? ''];
        }
        usort($out, function ($a, $b) { return strcmp($b['date'] . $b['heure'], $a['date'] . $a['heure']); });
        tout(true, ['sorties' => $out]);

    case 'inscrits':
        $s = t_sortie((string)($_GET['sortie'] ?? ''));
        if (!$s) tout(false, [], "Sortie Discord introuvable (supprimée, ou purgée après la fin : ses inscrits ne sont plus lisibles).");
        if (!epice_can_organize() && !epice_is_creator($s)) epice_deny('Réservé aux organisateurs et au créateur de la sortie.');
        tout(true, ['inscrits' => t_inscrits($s)]);

    // Tous les membres du serveur Discord de la guilde, pour pouvoir ajouter un
    // ancien qui n'a jamais touché ni au site ni au bot. Demande l'intent privilégié
    // « Server Members » (le même que le relevé de présence) : sans lui, Discord
    // répond 403 et on le DIT, au lieu de renvoyer une liste vide trompeuse.
    // Cache d'une heure : la liste bouge peu, et la page la redemande à chaque ouverture.
    case 'membres':
        if (!t_gere_un_tournoi()) epice_deny('Réservé aux organisateurs et aux créateurs de tournoi.');
        $cache = __DIR__ . '/data/tournois_membres_cache.json';
        if (empty($_GET['frais']) && file_exists($cache) && filemtime($cache) > time() - 3600) {
            $c = json_decode((string)file_get_contents($cache), true);
            if (is_array($c)) tout(true, ['membres' => $c, 'cache' => true]);
        }
        $cfgPath = __DIR__ . '/discord_sortie_config.php';
        if (!file_exists($cfgPath)) tout(false, [], 'Configuration du bot absente sur le serveur.');
        $CFG = require $cfgPath;
        // Quel serveur lister :
        //  1. `membres_guild_id` du bot, s'il est renseigné — sert sur /v2, où le bot de
        //     dev n'est pas sur la vraie guilde (Discord répond 404 « Unknown Guild ») ;
        //  2. sinon le serveur du login Discord : la vraie guilde par construction, on y
        //     vérifie l'appartenance de chaque membre connecté ;
        //  3. sinon ceux du bot (`guild_id` peut désigner un serveur de test).
        // ⚠ Ne jamais régler ça en touchant au guild_id du login : la connexion au site en dépend.
        $oauth = dirname(__DIR__) . '/discord_oauth_config.php';
        $OA = file_exists($oauth) ? (require $oauth) : [];
        $guild = trim((string)($CFG['membres_guild_id'] ?? '')) ?: trim((string)($OA['guild_id'] ?? ''))
              ?: trim((string)($CFG['rally_guild_id'] ?? '')) ?: trim((string)($CFG['guild_id'] ?? ''));
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
                if ($code === 404 || stripos($msg, 'Unknown Guild') !== false)
                    tout(false, [], "Discord ne connaît pas ce serveur pour ce bot (HTTP {$code}" . ($msg ? " : {$msg}" : '') . ") — le bot n'est pas membre du serveur {$guild}. Sur /v2, renseigne `membres_guild_id` (le serveur où le bot de test est invité) dans discord_sortie_config.php.");
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
        // Un membre crée le tournoi de SA sortie « Tournoi PvP » ; un tournoi sans
        // sortie (improvisé) reste réservé aux organisateurs.
        if (!epice_can_organize() && !($sortie && epice_is_creator($sortie)))
            epice_deny($sortie ? 'Seul le créateur de cette sortie (ou un organisateur) peut en monter le tournoi.'
                               : 'Un tournoi se crée depuis ta sortie Discord « Tournoi PvP » (ou par un organisateur).');
        if ($sortie) foreach (t_read()['tournois'] as $x) if (($x['sortie_id'] ?? '') === $sid)
            tout(false, [], 'Cette sortie a déjà son tournoi : « ' . $x['nom'] . ' ».');

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
            'equipes'     => [],   // composées ensuite dans la page (tournoi par équipes)
            'resultats'   => [],
            'podium'      => [],
            'lots'        => t_clean_lots($input['lots'] ?? []),
            // Paris en Solaris : choix de l'organisateur, DÉSACTIVÉS par défaut.
            'paris'       => !empty($input['paris']),
            'fenetre_paris' => t_fenetre(['fenetre_paris' => $input['fenetre_paris'] ?? 2]),
            'coorgas'     => t_clean_coorgas($input['coorgas'] ?? []),
            'banquier'    => t_clean_personne($input['banquier'] ?? null),
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
        $statutAvant = '';
        $t = t_mutate(function (&$d) use ($id, $n, $input, &$statutAvant) {
            $i = t_index($d, $id);
            if ($i < 0) throw new RuntimeException('Tournoi introuvable.');
            $t = $d['tournois'][$i];
            if (!t_peut_gerer($t)) throw new RuntimeException('Réservé aux organisateurs et au créateur du tournoi.');
            if ((int)($input['version'] ?? 0) !== (int)($t['version'] ?? 1)) {
                throw new RuntimeException('Le tournoi a été modifié entre-temps par ' . (end($t['journal'])['par'] ?? 'quelqu\'un')
                    . ' — recharge la page pour repartir de la dernière version.');
            }
            $ancien = $statutAvant = $t['statut'];
            $statut = in_array($n['statut'] ?? '', STATUTS_T, true) ? $n['statut'] : $ancien;

            $t['nom']         = t_cut($n['nom'] ?? $t['nom'], 80) ?: $t['nom'];
            $t['niveau']      = in_array($n['niveau'] ?? '', NIVEAUX_T, true) ? $n['niveau'] : $t['niveau'];
            $t['date']        = t_clean_date($n['date'] ?? '') ?: $t['date'];
            $t['heure']       = array_key_exists('heure', $n) ? t_clean_heure($n['heure']) : $t['heure'];
            $t['description'] = t_cut($n['description'] ?? $t['description'], 500);
            $t['lots']        = t_clean_lots($n['lots'] ?? $t['lots']);
            // Activables et désactivables à tout moment : éteints, ils ferment les
            // nouveaux paris, ceux déjà posés restent au bilan du banquier.
            $t['paris']       = array_key_exists('paris', $n) ? !empty($n['paris']) : !empty($t['paris']);
            if (array_key_exists('fenetre_paris', $n)) $t['fenetre_paris'] = t_fenetre(['fenetre_paris' => $n['fenetre_paris']]);
            if (array_key_exists('coorgas', $n))  $t['coorgas']  = t_clean_coorgas($n['coorgas']);
            if (array_key_exists('banquier', $n)) $t['banquier'] = t_clean_personne($n['banquier']);
            // Arbre dévoilé aux membres pendant la préparation (choix de l'orga,
            // caché par défaut pour composer en paix). Un retour en préparation le
            // recache : la composition va changer.
            $t['devoile']     = array_key_exists('devoile', $n) ? !empty($n['devoile']) : !empty($t['devoile']);
            if ($statut === 'preparation' && $ancien !== 'preparation') $t['devoile'] = false;

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
            // Tournoi par équipes : l'arbre oppose les équipes, c'est donc sur LEURS
            // identifiants que se valident résultats, podium et corrections de points.
            $taille = t_taille_equipe($t);
            if ($taille > 1) {
                $equipes = t_clean_equipes($n['equipes'] ?? ($t['equipes'] ?? []), $ids, $taille);
                if ($statut !== 'preparation') {
                    if (count($equipes) < 2) throw new RuntimeException('Il faut au moins deux équipes pour lancer le tournoi.');
                    foreach ($equipes as $e) if (count($e['membres']) !== $taille)
                        throw new RuntimeException("L'équipe « {$e['nom']} » n'est pas complète ({$taille} joueurs attendus).");
                    // Lancé : mêmes équipes dans le même ordre (l'arbre en dépend). Les
                    // membres peuvent changer — c'est un remplacement, l'équipe garde son identifiant.
                    if ($ancien !== 'preparation' && array_column($equipes, 'id') !== array_column($t['equipes'] ?? [], 'id'))
                        throw new RuntimeException('Le tournoi est lancé : les équipes sont figées (repasse en préparation pour les recomposer).');
                }
                $t['equipes'] = $equipes;
                $ids = array_flip(array_column($equipes, 'id'));
            } else {
                $t['equipes'] = [];
            }
            // Revenir en préparation efface les scores : l'arbre va changer.
            $t['resultats'] = $statut === 'preparation' ? [] : t_clean_resultats($n['resultats'] ?? $t['resultats'], $ids);
            $t['podium']    = $statut === 'termine' ? t_clean_podium($n['podium'] ?? [], $ids) : [];
            // Les corrections de points ne valent que pour un classement final ;
            // revenir en préparation les efface avec les scores.
            $t['ajustements'] = $statut === 'preparation' ? [] : t_clean_ajustements($n['ajustements'] ?? ($t['ajustements'] ?? []), $ids);
            if ($statut === 'termine' && !$t['podium']) throw new RuntimeException('Classement final manquant : le tournoi n\'est pas allé au bout.');
            if ($statut === 'termine' && $ancien !== 'termine') $t['termine_le'] = date('c');
            // Heure du lancement : le message des paris attend l'annonce de CE lancement.
            if ($statut === 'en_cours' && $ancien === 'preparation') $t['lance_le'] = time();
            if ($statut !== 'termine') unset($t['termine_le']);
            $t['statut']  = $statut;
            $t['version'] = (int)($t['version'] ?? 1) + 1;
            t_journal($t, (string)($input['journal'] ?? ''));
            $d['tournois'][$i] = $t;
            return $t;
        });
        // En préparation, aucun combat n'est ouvert aux paris : on efface fenêtres et
        // verrous, sinon au relancement les fenêtres d'avant seraient déjà écoulées.
        if ($t['statut'] === 'preparation') {
            $P0 = t_read('paris.json')['tournois'][$t['id']] ?? [];
            if (!empty($P0['ouvertures']) || !empty($P0['verrous'])) t_mutate(function (&$d) use ($t) {
                $P = &p_du_tournoi($d, $t['id']);
                $P['ouvertures'] = []; $P['verrous'] = [];
            }, 'paris.json');
        }
        // Au lancement, rien ici : la page publie l'annonce, qui poste ensuite le
        // message des paris juste en dessous (deux posts, dans cet ordre).
        if (!($t['statut'] === 'en_cours' && $statutAvant === 'preparation')) p_discord_plus_tard($t['id']);
        tout(true, ['tournoi' => $t]);

    case 'delete':
        $id = (string)($input['id'] ?? '');
        t_mutate(function (&$d) use ($id) {
            $i = t_index($d, $id);
            if ($i < 0) throw new RuntimeException('Tournoi introuvable.');
            if (!t_peut_supprimer($d['tournois'][$i])) throw new RuntimeException('Réservé aux admins et au créateur du tournoi.');
            array_splice($d['tournois'], $i, 1);
        });
        $msgDiscord = t_read('paris.json')['tournois'][$id]['discord'] ?? [];
        t_mutate(function (&$d) use ($id) { unset($d['tournois'][$id]); }, 'paris.json');
        if (is_array($msgDiscord)) p_discord_supprimer($msgDiscord);
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
        t_exige_gerer($t);
        if ($quoi === 'resultats' && ($t['statut'] !== 'termine' || !$t['podium'])) tout(false, [], 'Clôture le tournoi avant d\'en publier les résultats.');
        if ($quoi === 'lancement' && $t['statut'] === 'preparation') tout(false, [], 'Lance le tournoi avant de publier l\'arbre.');

        [$CFG, $chan, $base] = t_bot((string)($t['sortie_channel_id'] ?? ''));
        $lien = $base . '/epice/tournois.html?t=' . rawurlencode($t['id']);
        $esc  = function ($s) { return preg_replace('/([\\\\*_~`|>])/', '\\\\$1', (string)$s); };
        $niv  = NIVEAU_ICO[$t['niveau']] . ' ' . NIVEAU_LBL[$t['niveau']];
        $fmt  = $t['format'] === 'double' ? 'Double élimination' : 'Simple élimination';
        $eqLbl = t_libelle_equipe($t);
        if ($eqLbl !== '') $fmt = $eqLbl . ' · ' . $fmt;
        // « 8 combattants » en duel ; « 4 équipes · 8 combattants » par équipes.
        $effectif = $eqLbl !== ''
            ? count($t['equipes'] ?? []) . ' équipes · ' . array_sum(array_map(function ($e) { return count($e['membres'] ?? []); }, $t['equipes'] ?? [])) . ' combattants'
            : count($t['joueurs']) . ' combattants';
        $quand = $t['date'] ? date('d/m/Y', strtotime($t['date'])) . ($t['heure'] ? ' à ' . $t['heure'] : '') : '';

        // Même bannière que l'encart de la sortie (epice/img/sortietournoispvp.jpg).
        $embed = ['color' => hexdec('D4A23B'), 'url' => $lien, 'image' => ['url' => $base . '/epice/img/sortietournoispvp.jpg'],
                  'footer' => ['text' => 'Tournoi PvP · ' . $niv . ' · organisé par ' . ($t['cree_par'] ?: '?')]];
        if ($quoi === 'lancement') {
            $lignes = [];
            foreach (array_slice(is_array($input['lignes'] ?? null) ? $input['lignes'] : [], 0, 40) as $l) {
                $l = t_cut($l, 90);
                if ($l !== '') $lignes[] = $l;
            }
            $desc = "⚔️ **{$effectif}** · {$fmt}" . ($quand ? " · 📅 {$quand}" : '')
                  // BO3 = 2 manches gagnantes, BO5 = 3 : l'annonce disait « 3 manches gagnantes » pour un BO3.
                  . ($t['options']['bestOf'] > 1 ? ' · matchs en BO' . $t['options']['bestOf'] . ' (' . intdiv($t['options']['bestOf'] + 1, 2) . ' manches gagnantes)' : '');
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
            $embed['fields'][] = ['name' => 'Arbre en direct', 'value' => !empty($t['paris'])
                ? "[Suivre le tournoi et parier]({$lien})\n🎲 Toute la guilde peut parier des Solaris sur chaque combat : " . t_fenetre($t) . " min dès qu'il est prêt (compte à rebours sur le site)."
                : "[Suivre le tournoi sur le site]({$lien})", 'inline' => false];
        } else {
            $med = [1 => '🥇', 2 => '🥈', 3 => '🥉'];
            // Cagnottes de paris sans gagnant, réparties sur le podium (50/30/20) :
            // {idParticipant: Solaris} (joueur en duel, équipe sinon), calculé par la page.
            $parisLots = is_array($input['paris_lots'] ?? null) ? $input['paris_lots'] : [];
            $eqs = [];
            foreach ($t['equipes'] ?? [] as $e) $eqs[$e['id']] = $e;
            $lignes = [];
            foreach ($t['podium'] as $p) {
                $l = ($med[$p['rang']] ?? '🏅') . ' **' . $esc($p['nom']) . '** — ' . $p['v'] . ' V / ' . $p['d'] . ' D';
                // Équipe renommée : son nom ne dit plus qui la compose, on l'ajoute.
                if (!empty($eqs[$p['id']]['nom_libre'])) $l .= "\n   👥 " . $esc(implode(', ', t_noms_membres($t, $eqs[$p['id']])));
                $lot = $t['lots'][(string)$p['rang']] ?? '';
                if ($lot !== '') $l .= "\n   🎁 " . $esc($lot);
                $sol = max(0, (int)($parisLots[$p['id']] ?? 0));
                if ($sol > 0) $l .= "\n   🎲 +" . number_format($sol, 0, ',', ' ') . ' Solaris (paris sans gagnant)';
                $lignes[] = $l;
            }
            $embed['title'] = '🏆 ' . t_cut($t['nom'], 200) . ' — résultats';
            $embed['description'] = implode("\n", $lignes) . "\n\n{$effectif} · {$fmt}"
                                  . ($quand ? " · {$quand}" : '') . "\n[Voir l'arbre complet]({$lien})";
        }

        t_discord_post($CFG, $chan, $embed);
        // Le message des paris vient se placer juste sous l'annonce (après la
        // réponse, donc une fois `publie` enregistré ci-dessous).
        if ($quoi === 'lancement' && !empty($t['paris'])) p_discord_plus_tard($t['id'], true);
        // Comptes des paris (calculés par la page) : message final + MP aux parieurs.
        if ($quoi === 'resultats' && is_array($input['paris_soldes'] ?? null) && $input['paris_soldes'])
            p_comptes($t, $input['paris_soldes'], $parisLots);
        $t = t_mutate(function (&$d) use ($id, $quoi) {
            $i = t_index($d, $id);
            if ($i < 0) return null;
            $d['tournois'][$i]['publie'][$quoi] = date('c');
            t_journal($d['tournois'][$i], $quoi === 'resultats' ? 'Résultats publiés sur Discord' : 'Lancement annoncé sur Discord');
            return $d['tournois'][$i];
        });
        tout(true, ['tournoi' => $t]);

    // Classement d'une saison pour un niveau. Les lignes sont calculées par la page
    // (moteur unique) ; le serveur ne fait que les mettre en forme et les poster.
    case 'publish_saison':
        $niveau = in_array($input['niveau'] ?? '', NIVEAUX_T, true) ? $input['niveau'] : '';
        $saison = t_cut($input['saison'] ?? '', 40);
        if ($niveau === '' || $saison === '') tout(false, [], 'Saison ou niveau manquant.');
        $lignes = [];
        foreach (array_slice(is_array($input['lignes'] ?? null) ? $input['lignes'] : [], 0, 15) as $l) {
            $l = t_cut($l, 110);
            if ($l !== '') $lignes[] = $l;
        }
        if (!$lignes) tout(false, [], 'Classement vide : aucun tournoi terminé dans cette saison.');
        [$CFG, $chan, $base] = t_bot();
        $val = '';
        foreach ($lignes as $l) { if (strlen($val) + strlen($l) > 3800) { $val .= '…'; break; } $val .= $l . "\n"; }
        $finie = !empty($input['terminee']);
        t_discord_post($CFG, $chan, [
            'title'       => ($finie ? '🏆 Classement final' : '📊 Classement') . ' — saison ' . $saison . ' · ' . NIVEAU_ICO[$niveau] . ' ' . NIVEAU_LBL[$niveau],
            'description' => $val . "\n" . t_cut($input['pied'] ?? '', 300) . "\n[Voir le classement complet](" . $base . '/epice/tournois.html?vue=saison&niveau=' . $niveau . ')',
            'color'       => hexdec('D4A23B'),
            'footer'      => ['text' => 'Points selon la place finale · 3 meilleurs résultats retenus · publié par ' . (epice_user() ?? '?')],
        ]);
        tout(true);

    // ---- Paris --------------------------------------------------------------
    case 'paris':
        p_vue(p_tournoi((string)($_GET['id'] ?? '')));

    // Poser, modifier ou retirer (mise 0) un pari : règles dans p_parier().
    case 'parier':
        $t = p_tournoi((string)($input['id'] ?? ''));
        try {
            p_parier($t, epice_user() ?? '', (string)($_SESSION['discord_id'] ?? ''), (string)($input['cible'] ?? ''),
                     (string)($input['choix'] ?? ''), (int)($input['mise'] ?? 0), (string)($input['a'] ?? ''), (string)($input['b'] ?? ''));
        } catch (RuntimeException $e) { tout(false, [], $e->getMessage()); }
        p_discord_plus_tard($t['id']);
        p_vue($t);

    // « Combat lancé » : ferme les paris d'un match. L'affiche est retenue : si
    // une correction en amont la change, le nouveau match repart ouvert.
    // `silencieux` : verrou posé tout seul à la saisie d'un score, pas journalisé.
    case 'paris_verrou':
        $t = p_tournoi((string)($input['id'] ?? ''));
        t_exige_gerer($t);
        $cible = (string)($input['cible'] ?? '');
        $a = (string)($input['a'] ?? ''); $b = (string)($input['b'] ?? '');
        $ids = p_participants($t);
        if (!preg_match(MATCH_RE, $cible) || !isset($ids[$a]) || !isset($ids[$b])) tout(false, [], 'Match invalide.');
        $on = !empty($input['on']);
        $silence = !empty($input['silencieux']);
        $repere = ['num' => $input['num'] ?? 0, 'tour' => $input['tour'] ?? ''];
        t_mutate(function (&$d) use ($t, $cible, $a, $b, $on, $silence, $repere) {
            $P = &p_du_tournoi($d, $t['id']);
            if ($on) {
                $P['verrous'][$cible] = ['a' => $a, 'b' => $b, 'le' => date('c'), 'par' => epice_user() ?? '?'];
                // Fermer avant la fin du temps : la fenêtre s'arrête là.
                if (isset($P['ouvertures'][$cible]) && p_meme($P['ouvertures'][$cible], $a, $b)) $P['ouvertures'][$cible]['fin'] = time();
            } else {
                unset($P['verrous'][$cible]);
                // Rouvrir = une nouvelle fenêtre complète (numéro et tour du combat conservés).
                $P['ouvertures'][$cible] = p_ouverture(($P['ouvertures'][$cible] ?? []) + $repere, $a, $b, time(), time() + 60 * t_fenetre($t));
            }
            if (!$silence) p_journal($P, ($on ? 'Paris fermés' : 'Paris rouverts (' . t_fenetre($t) . ' min)') . ' : ' . p_nom($t, $a) . ' contre ' . p_nom($t, $b));
        }, 'paris.json');
        p_discord_plus_tard($t['id']);
        p_vue($t);

    // Fenêtres de pari : la page de l'orga, qui calcule l'arbre (le serveur ne le
    // connaît pas), envoie les combats qui viennent de devenir prêts — au
    // lancement et après chaque résultat. Une fenêtre déjà ouverte pour la même
    // affiche n'est jamais réinitialisée (plusieurs orgas peuvent envoyer).
    case 'paris_ouvrir':
        $t = p_tournoi((string)($input['id'] ?? ''));
        t_exige_gerer($t);
        if ($t['statut'] !== 'en_cours' || empty($t['paris'])) p_vue($t);
        $ids = p_participants($t);
        $matchs = array_slice(is_array($input['matchs'] ?? null) ? $input['matchs'] : [], 0, 64);
        t_mutate(function (&$d) use ($t, $matchs, $ids) {
            $P = &p_du_tournoi($d, $t['id']);
            foreach ($matchs as $m) {
                $c = (string)($m['cible'] ?? ''); $a = (string)($m['a'] ?? ''); $b = (string)($m['b'] ?? '');
                if (!preg_match(MATCH_RE, $c) || !isset($ids[$a]) || !isset($ids[$b]) || $a === $b) continue;
                $o = $P['ouvertures'][$c] ?? null;
                if (is_array($o) && p_meme($o, $a, $b)) {
                    // Déjà ouverte (ou jouée) : jamais réinitialisée, mais son numéro suit
                    // celui de la page. La numérotation du moteur n'est pas figée (un
                    // combat est numéroté quand ses deux camps sont connus) : le numéro
                    // retenu à l'ouverture pouvait doubler celui d'un autre combat
                    // (deux « Match 5 » sur Discord au test /v2).
                    $P['ouvertures'][$c] = p_ouverture(['num' => $m['num'] ?? 0, 'tour' => $m['tour'] ?? ''] + $o, $a, $b, (int)$o['le'], (int)$o['fin']);
                    continue;
                }
                $P['ouvertures'][$c] = p_ouverture(['num' => $m['num'] ?? 0, 'tour' => $m['tour'] ?? ''], $a, $b, time(), time() + 60 * t_fenetre($t));
            }
        }, 'paris.json');
        p_discord_plus_tard($t['id']);
        p_vue($t);

    // « +1 min » sur un combat : l'orga laisse un peu plus de temps (un combat qui
    // tarde à démarrer). Rouvre si le temps était écoulé.
    case 'paris_prolonger':
        $t = p_tournoi((string)($input['id'] ?? ''));
        t_exige_gerer($t);
        $cible = (string)($input['cible'] ?? '');
        $a = (string)($input['a'] ?? ''); $b = (string)($input['b'] ?? '');
        $ids = p_participants($t);
        if (!preg_match(MATCH_RE, $cible) || !isset($ids[$a]) || !isset($ids[$b])) tout(false, [], 'Match invalide.');
        $repere = ['num' => $input['num'] ?? 0, 'tour' => $input['tour'] ?? ''];
        t_mutate(function (&$d) use ($t, $cible, $a, $b, $repere) {
            $P = &p_du_tournoi($d, $t['id']);
            $o = $P['ouvertures'][$cible] ?? null;
            $fin = is_array($o) && p_meme($o, $a, $b) ? max((int)$o['fin'], time()) : time();
            $P['ouvertures'][$cible] = p_ouverture((is_array($o) ? $o : []) + $repere, $a, $b, (int)($o['le'] ?? time()), min($fin + 60, time() + 1800));
            unset($P['verrous'][$cible]);
        }, 'paris.json');
        p_discord_plus_tard($t['id']);
        p_vue($t);

    // La page de l'orga voit un compte à rebours arriver à zéro : on réédite le
    // message Discord, qui ne peut pas le faire seul (le combat passe en « lancés »).
    case 'paris_discord':
        $t = p_tournoi((string)($input['id'] ?? ''));
        t_exige_gerer($t);
        p_discord_plus_tard($t['id']);
        tout(true);

    // Une erreur de saisie (10 000 au lieu de 1 000) se corrige ainsi : le pari
    // disparaît, le journal des paris en garde la trace.
    case 'paris_annuler':
        $t = p_tournoi((string)($input['id'] ?? ''));
        t_exige_banque($t);
        $pid = (string)($input['pari'] ?? '');
        t_mutate(function (&$d) use ($t, $pid) {
            $P = &p_du_tournoi($d, $t['id']);
            foreach ($P['paris'] as $k => $p) {
                if ($p['id'] !== $pid) continue;
                array_splice($P['paris'], $k, 1);
                p_journal($P, "Pari de {$p['qui']} annulé par l'organisation ({$p['mise']} Solaris sur " . p_nom($t, $p['choix']) . ')');
                return;
            }
            throw new RuntimeException('Pari introuvable.');
        }, 'paris.json');
        p_discord_plus_tard($t['id']);
        p_vue($t);

    // Le banquier coche ceux qui ont réglé. Le montant réglé est retenu : si une
    // correction de score change le solde ensuite, la page le signale.
    case 'paris_regle':
        $t = p_tournoi((string)($input['id'] ?? ''));
        t_exige_banque($t);
        $qui = t_cut($input['qui'] ?? '', 60);
        if ($qui === '') tout(false, [], 'Parieur manquant.');
        $montant = (int)($input['montant'] ?? 0);
        $on = !empty($input['on']);
        t_mutate(function (&$d) use ($qui, $montant, $on, $t) {
            $P = &p_du_tournoi($d, $t['id']);
            if ($on) $P['reglements'][$qui] = ['montant' => $montant, 'le' => date('c'), 'par' => epice_user() ?? '?'];
            else unset($P['reglements'][$qui]);
            // « lot:<id joueur> » = part d'un lauréat dans les lots des paris.
            $nom = strpos($qui, 'lot:') === 0 ? 'lots des paris de ' . p_nom($t, substr($qui, 4)) : $qui;
            p_journal($P, $on ? "Règlement ({$nom}) noté : {$montant} Solaris" : "Règlement ({$nom}) décoché");
        }, 'paris.json');
        p_vue($t);
}
