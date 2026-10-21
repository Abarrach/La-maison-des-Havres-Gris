<?php
// ============================================================
//  RELEVÉ DE PRÉSENCE — un point par demi-heure passée en vocal
// ============================================================
// Lancé par cron toutes les 30 minutes. Pour chaque sortie OUVERTE dont la
// fenêtre horaire couvre l'instant présent, il note qui se trouve dans le salon
// vocal dédié et enregistre un « tick ». Un tick = un point.
//
//   */30 * * * *  php /srv/dune-map/epice/rally_presence.php >> /srv/dune-map/epice/data/rally_presence.log 2>&1
//
// Essai à blanc (n'écrit RIEN, affiche qui serait compté) :
//   php /srv/dune-map/epice/rally_presence.php --test
//
// Contrôle avant vol (n'appelle même pas Discord) : quelles sorties ouvertes le script
// sait lire, et quand il relèvera dessus. À passer la VEILLE d'une sortie, pour ne pas
// découvrir le lendemain qu'une date en texte libre la rendait invisible :
//   php /srv/dune-map/epice/rally_presence.php --fenetres
//
// Essai de l'alerte (envoie un MP de contrôle, ne relève rien) :
//   php /srv/dune-map/epice/rally_presence.php --alerte-test
//
// ------------------------------------------------------------
//  POURQUOI C'EST FAIT COMME ÇA
// ------------------------------------------------------------
// Notre bot est un endpoint HTTP d'interactions, PAS un bot connecté à la
// gateway : il ne reçoit aucun événement temps réel et ne peut donc pas
// « écouter » les entrées/sorties du salon. Discord n'expose en REST que l'état
// vocal d'UN utilisateur à la fois (`GET /guilds/{g}/voice-states/{u}`), jamais
// la liste des occupants d'un salon. Il faut donc une liste de candidats et les
// interroger un par un.
//
// Candidats, par ordre de préférence :
//   1. les membres de la guilde (`GET /guilds/{g}/members`) — couvre les
//      VISITEURS, ceux qui viennent récolter sans s'être inscrits. Demande
//      l'intent privilégié « Server Members » (à activer dans le portail
//      développeur, côté GM).
//   2. à défaut, les inscrits de la sortie — on a leurs identifiants dans le
//      fichier. Suffisant si tout le monde s'inscrit, aveugle aux visiteurs.
// L'échec du point 1 est JOURNALISÉ, jamais silencieux : sinon on croirait
// relever tout le monde alors qu'on ne voit que les inscrits.
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI uniquement.\n"); }

date_default_timezone_set('Europe/Paris');   // même fuseau que le reste du bot

const BLOC_MINUTES = 30;      // un point par demi-heure
const MAX_CANDIDATS = 500;    // garde-fou : on n'interroge pas une guilde entière sans borne
const PAUSE_US      = 25000;  // 25 ms entre deux appels (limite Discord ~50 req/s)

$essai    = in_array('--test', $argv ?? [], true);
$fenetres = in_array('--fenetres', $argv ?? [], true);
$essaiMp  = in_array('--alerte-test', $argv ?? [], true);

$CFG_PATH = __DIR__ . '/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { fwrite(STDERR, "Config absente : $CFG_PATH\n"); exit(1); }
$CFG = require $CFG_PATH;


define('DATA_FILE', __DIR__ . '/data/debriefs.json');

// Une alerte qu'on n'a jamais vue arriver n'est pas une alerte : --alerte-test envoie un
// MP de contrôle. On vérifie le réglage ici, avant tout le reste, pour ne pas laisser
// croire à un échec d'envoi ce qui n'est qu'une configuration absente.
if ($essaiMp && trim((string)($CFG['alerte_user_id'] ?? '')) === '') {
    fwrite(STDERR, "alerte_user_id n'est pas renseigné dans discord_sortie_config.php
");
    exit(1);
}

function plog(string $m): void {
    echo '[' . date('Y-m-d H:i:s') . '] ' . $m . "\n";
}

// ------------------------------------------------------------
//  Alerte à l'organisateur — en MESSAGE PRIVÉ
// ------------------------------------------------------------
// Le 2026-09-26, un 403 sur le salon d'écoute a été journalisé dix-huit fois entre 01:02
// et 10:38 avant d'être vu. L'information existait ; personne ne lisait le fichier.
//
// En message privé et non dans un canal : les autres ne peuvent rien y faire, et une
// alerte technique dans un salon de guilde se transforme en inquiétude ou en bruit.
//
// UNE FOIS par panne, pas une par passage : un marqueur retient la dernière cause
// signalée. Une alerte répétée toutes les 30 minutes serait ignorée aussi sûrement
// qu'un fichier journal — c'est la même erreur sous une autre forme.
const ALERTE_FICHIER = __DIR__ . '/data/rally_alerte.json';
const ALERTE_REPETER_H = 6;   // même cause toujours là après 6 h → on resignale

function alerter(string $cause, string $texte): void {
    global $CFG;
    $uid = trim((string)($CFG['alerte_user_id'] ?? ''));
    if ($uid === '' || empty($CFG['bot_token']) || !function_exists('curl_init')) return;

    $etat = @json_decode((string)@file_get_contents(ALERTE_FICHIER), true) ?: [];
    if (($etat['cause'] ?? '') === $cause && (time() - (int)($etat['ts'] ?? 0)) < ALERTE_REPETER_H * 3600) {
        plog('(alerte déjà envoyée pour cette cause, pas de rappel)');
        return;
    }

    $chan = null;
    $ch = curl_init('https://discord.com/api/v10/users/@me/channels');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['recipient_id' => $uid]),
        CURLOPT_HTTPHEADER => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 6,
    ]);
    $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code >= 200 && $code < 300) $chan = (json_decode((string)$r, true)['id'] ?? null);
    if (!$chan) { plog("(alerte non envoyée : ouverture du MP en échec, HTTP {$code})"); return; }

    $ch = curl_init("https://discord.com/api/v10/channels/{$chan}/messages");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['content' => $texte], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 6,
    ]);
    curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code < 200 || $code >= 300) { plog("(alerte non envoyée, HTTP {$code})"); return; }

    @file_put_contents(ALERTE_FICHIER, json_encode(['cause' => $cause, 'ts' => time()]));
    plog('📨 Alerte envoyée en MP.');
}

// Le relevé repart : on oublie la panne signalée, pour que sa prochaine occurrence
// alerte à nouveau au lieu d'être étouffée par le marqueur.
function alerte_resolue(): void {
    if (!file_exists(ALERTE_FICHIER)) return;
    @unlink(ALERTE_FICHIER);
    plog('(panne précédente résolue)');
}

if ($essaiMp) {
    alerter('essai-' . time(),
        "✅ **Essai d'alerte du relevé de présence.**" . chr(10)
      . "Si tu lis ce message, tu seras prévenu en cas de panne pendant une sortie." . chr(10)
      . "*Envoyé depuis " . gethostname() . " le " . date('d/m/Y à H:i') . ".*");
    @unlink(ALERTE_FICHIER);   // un essai ne doit pas masquer une vraie panne ensuite
    exit(0);
}

// ------------------------------------------------------------
//  Appels Discord
// ------------------------------------------------------------
function discord_get(string $path, array &$erreur = null) {
    global $CFG;
    if (empty($CFG['bot_token']) || !function_exists('curl_init')) { $erreur = ['msg' => 'bot_token ou cURL absent']; return null; }
    $ch = curl_init('https://discord.com/api/v10' . $path);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false)              { $erreur = ['msg' => 'cURL en échec', 'code' => 0];    return null; }
    if ($code === 404)                { $erreur = ['msg' => 'introuvable',   'code' => 404];  return null; }  // pas en vocal = 404, cas NORMAL
    if ($code < 200 || $code >= 300)  { $erreur = ['msg' => substr((string)$resp, 0, 200), 'code' => $code]; return null; }
    return json_decode($resp, true);
}

/** Membres de la guilde (hors bots). [] si l'intent « Server Members » manque. */
function membres_guilde(string $guildId): array {
    $err = null;
    $out = [];
    $after = '';
    // Pagination par 1000 ; une guilde de plus de 3000 membres s'arrête au garde-fou.
    for ($page = 0; $page < 3; $page++) {
        $url = "/guilds/{$guildId}/members?limit=1000" . ($after !== '' ? "&after={$after}" : '');
        $lot = discord_get($url, $err);
        if (!is_array($lot)) {
            plog("⚠️ Liste des membres indisponible (" . ($err['code'] ?? '?') . " " . ($err['msg'] ?? '') . ")."
               . " L'intent privilégié « Server Members » est-il activé dans le portail développeur ?"
               . " → repli sur les seuls INSCRITS, les visiteurs ne seront pas comptés.");
            return [];
        }
        foreach ($lot as $m) {
            $u = $m['user'] ?? [];
            if (!empty($u['bot']) || empty($u['id'])) continue;
            $out[(string)$u['id']] = (string)($m['nick'] ?? ($u['global_name'] ?? ($u['username'] ?? $u['id'])));
            $after = (string)$u['id'];
        }
        if (count($lot) < 1000) break;
    }
    return $out;
}

/** L'utilisateur est-il dans CE salon vocal ? */
function est_dans_le_salon(string $guildId, string $userId, string $channelId): bool {
    $err = null;
    $vs  = discord_get("/guilds/{$guildId}/voice-states/{$userId}", $err);
    if (!is_array($vs)) return false;   // 404 = pas connecté au vocal, cas courant
    return (string)($vs['channel_id'] ?? '') === $channelId;
}

// ------------------------------------------------------------
//  Fenêtre d'une sortie
// ------------------------------------------------------------
/** Début et fin d'une sortie, ou null si la date/heure n'est pas exploitable. */
function fenetre_sortie(array $s): ?array {
    $date  = trim((string)($s['date'] ?? ''));
    $heure = trim((string)($s['heure'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $heure)) return null;
    $debut = DateTime::createFromFormat('Y-m-d H:i', "$date $heure", new DateTimeZone('Europe/Paris'));
    if (!$debut) return null;
    // Même lecture de la durée que creneaux_sortie() : « 8 » ou « 2h30 ».
    $d = trim((string)($s['duree'] ?? ''));
    if (ctype_digit($d))                                    $h = (float)$d;
    elseif (preg_match('/^(\d+)\s*h\s*(\d+)?$/i', $d, $m))   $h = (float)$m[1] + (isset($m[2]) && $m[2] !== '' ? ((int)$m[2]) / 60 : 0);
    else return null;
    $fin = (clone $debut)->modify('+' . (int)round($h * 60) . ' minutes');
    return [$debut, $fin];
}

/** Clé du tick : la demi-heure en cours, en heure locale. Stable et lisible. */
function cle_tick(DateTime $now): string {
    $m = (int)$now->format('i') < BLOC_MINUTES ? '00' : (string)BLOC_MINUTES;
    return $now->format('Y-m-d\TH:') . $m;
}

// ------------------------------------------------------------
//  Programme
// ------------------------------------------------------------
// Le serveur du RELEVÉ n'est pas forcément celui des commandes. On peut vouloir compter
// les présences sur la vraie guilde tout en publiant sur un serveur de test : `guild_id`
// sert aussi à enregistrer les commandes /sortie, le détourner poserait celles de v2 sur
// la production. D'où un réglage à part, qui retombe sur `guild_id` quand il est vide.
$guildId   = (string)($CFG['rally_guild_id'] ?? '');
if ($guildId === '') $guildId = (string)($CFG['guild_id'] ?? '');
$channelId = (string)($CFG['rally_voice_channel_id'] ?? '');
if ($guildId === '' || $channelId === '') {
    fwrite(STDERR, "rally_voice_channel_id et guild_id (ou rally_guild_id) doivent être renseignés dans discord_sortie_config.php\n");
    exit(1);
}

if (!file_exists(DATA_FILE)) { plog('Aucun fichier de sorties.'); exit(0); }
$data = json_decode(file_get_contents(DATA_FILE), true);
if (!is_array($data)) { fwrite(STDERR, "debriefs.json illisible\n"); exit(1); }

$now  = new DateTime('now', new DateTimeZone('Europe/Paris'));
$tick = cle_tick($now);

// --- Contrôle avant vol ---------------------------------------------------
// Une sortie dont la date est en texte libre (« Dimanche 28/06/26 21h », l'ancien
// format) n'a pas de fenêtre exploitable : le relevé l'ignore, en silence. C'est la
// panne qu'on ne veut pas découvrir le jour même, d'où ce listing à passer la veille.
if ($fenetres) {
    plog('Il est ' . $now->format('Y-m-d H:i') . ' — sorties OUVERTES :');
    $vues = 0;
    foreach ($data['sorties'] ?? [] as $s) {
        if (($s['statut'] ?? '') !== 'ouverte') continue;
        $vues++;
        $titre = substr((string)($s['titre'] ?? '?'), 0, 34);
        $f = fenetre_sortie($s);
        if (!$f) {
            plog(sprintf('  ✖ %-34s  ILLISIBLE (date="%s" heure="%s" duree="%s") — jamais relevée',
                 $titre, $s['date'] ?? '', $s['heure'] ?? '', $s['duree'] ?? ''));
            continue;
        }
        $etat = ($now >= $f[0] && $now <= $f[1]) ? 'EN COURS — relevée maintenant'
              : ($now < $f[0] ? 'à venir' : 'terminée');
        $nb = count($s['presence']['ticks'] ?? []);
        plog(sprintf('  %s %-34s  %s → %s  %s%s',
             ($now >= $f[0] && $now <= $f[1]) ? '▶' : ' ',
             $titre, $f[0]->format('d/m H:i'), $f[1]->format('d/m H:i'), $etat,
             $nb ? "  [{$nb} relevé(s) déjà enregistré(s)]" : ''));
    }
    if (!$vues) plog('  (aucune sortie ouverte)');
    plog('Salon écouté : ' . $channelId . ' sur le serveur ' . $guildId);
    exit(0);
}

// Quelles sorties sont en cours ? Plusieurs peuvent l'être (multi-sorties).
$encours = [];
foreach ($data['sorties'] ?? [] as $i => $s) {
    if (($s['statut'] ?? '') !== 'ouverte') continue;
    $f = fenetre_sortie($s);
    if (!$f) continue;
    if ($now >= $f[0] && $now <= $f[1]) $encours[$i] = $s;
}

// En essai, on continue MÊME sans sortie ouverte : la première question à laquelle on
// veut répondre est « le bot me voit-il dans le salon ? », et elle n'a rien à voir avec
// l'existence d'une sortie. Exiger une sortie en cours obligerait à en créer une juste
// pour vérifier une permission Discord.
if (!$encours) {
    if (!$essai) { plog('Aucune sortie en cours — rien à relever.'); exit(0); }
    plog('Aucune sortie en cours — en essai, on vérifie quand même le salon.');
}

// Vérification du salon. Elle vient APRÈS le tri des sorties, et pas avant : hors
// fenêtre il n'y a rien à relever, donc rien à vérifier — inutile d'appeler Discord
// toutes les 30 minutes de la nuit, et surtout inutile d'alerter pour une panne qui ne
// fait perdre aucun point.
// Sans elle, les trois erreurs possibles — identifiant erroné, salon textuel, salon
// d'un autre serveur — donnent toutes le même « 0 présent » muet.
$err   = null;
$salon = $fenetres ? true : discord_get("/channels/{$channelId}", $err);
$sortieEnCours = $encours ? reset($encours) : null;
$titre = $sortieEnCours ? (string)($sortieEnCours['titre'] ?? '') : '';

if ($salon !== true && !is_array($salon)) {
    $m = "Salon {$channelId} illisible (HTTP " . ($err['code'] ?? '?') . ") — identifiant erroné, ou le bot n'a pas accès à ce salon.";
    plog('🧨 ' . $m);
    if ($encours) alerter('salon-illisible-' . ($err['code'] ?? '?'),
        "🧨 **Le relevé de présence ne tourne pas.**" . chr(10)
      . "Sortie en cours : « {$titre} »." . chr(10) . chr(10)
      . $m . chr(10)
      . "Un **403** est un droit, pas un identifiant : vérifie que le bot a « Voir le salon » et « Se connecter » sur le salon vocal." . chr(10)
      . "Un **404** est un identifiant : vérifie `rally_voice_channel_id`." . chr(10) . chr(10)
      . "*Aucun point n'est compté tant que ce n'est pas réglé. Les demi-heures manquées se rattrapent ensuite dans la grille.*");
    exit(1);
}
if ($salon !== true && (int)($salon['type'] ?? -1) !== 2) {
    $m = "« " . ($salon['name'] ?? '?') . " » n'est pas un salon VOCAL (type " . ($salon['type'] ?? '?') . ", il en faut 2).";
    plog('🧨 ' . $m);
    if ($encours) alerter('salon-pas-vocal', "🧨 **Le relevé de présence ne tourne pas.** " . $m);
    exit(1);
}
if ($salon !== true && (string)($salon['guild_id'] ?? '') !== $guildId) {
    $m = "Le salon « " . ($salon['name'] ?? '?') . " » appartient au serveur " . ($salon['guild_id'] ?? '?')
       . ", or on interroge l'état vocal sur {$guildId} : personne ne sera jamais trouvé.";
    plog('🧨 ' . $m);
    if ($encours) alerter('salon-mauvais-serveur',
        "🧨 **Le relevé de présence ne tourne pas.**" . chr(10) . $m . chr(10)
      . "Corrige `rally_guild_id` (le serveur du salon) ou `rally_voice_channel_id`.");
    exit(1);
}
if ($salon !== true) plog("Salon vocal « " . ($salon['name'] ?? '?') . " » sur le serveur {$guildId} — OK.");

// Candidats : les membres de la guilde (visiteurs compris), à défaut les inscrits.
$candidats = membres_guilde($guildId);
$source    = 'membres de la guilde';
if (!$candidats) {
    $source = 'inscrits des sorties en cours (repli)';
    foreach ($encours as $s) {
        foreach ($s['signups'] ?? [] as $su) {
            if (!empty($su['id'])) $candidats[(string)$su['id']] = (string)($su['name'] ?? $su['id']);
        }
    }
}
if (!$candidats) {
    $m = 'Aucun candidat à interroger : ni liste de membres, ni inscrit dans la sortie.';
    plog('⚠️ ' . $m . ' Rien ne peut être relevé.');
    if ($encours) alerter('aucun-candidat',
        "🧨 **Le relevé de présence ne trouve personne à interroger.**" . chr(10)
      . "Sortie en cours : « {$titre} »." . chr(10) . chr(10)
      . $m . chr(10)
      . "L'intent privilégié **« Server Members »** est-il toujours activé dans le portail développeur ?");
    exit($essai ? 0 : 1);
}
if (count($candidats) > MAX_CANDIDATS) {
    plog('⚠️ ' . count($candidats) . " candidats, tronqué à " . MAX_CANDIDATS . '.');
    $candidats = array_slice($candidats, 0, MAX_CANDIDATS, true);
}
plog(count($candidats) . " candidats ($source) — salon $channelId — tick $tick");

$presents = [];
foreach ($candidats as $id => $nom) {
    if (est_dans_le_salon($guildId, (string)$id, $channelId)) $presents[(string)$id] = $nom;
    usleep(PAUSE_US);
}

if (!$presents) { plog('Salon vide — tick non enregistré.'); exit(0); }
plog(count($presents) . ' présent(s) : ' . implode(', ', $presents));

if ($essai) { plog('--test : rien n’a été écrit.'); exit(0); }

// ------------------------------------------------------------
//  Écriture — relecture SOUS VERROU
// ------------------------------------------------------------
// Le fichier est partagé avec le site et le bot d'interactions : on le relit à
// l'intérieur du verrou plutôt que de réécrire la copie chargée en mémoire il y a
// trente secondes, sinon une inscription arrivée entre-temps serait effacée.
$fp = @fopen(DATA_FILE, 'c+');
if (!$fp) { fwrite(STDERR, "Ouverture impossible de " . DATA_FILE . "\n"); exit(1); }
$ok = false;
for ($essais = 0; $essais < 30; $essais++) {
    if (flock($fp, LOCK_EX | LOCK_NB)) { $ok = true; break; }
    usleep(100000);
}
if (!$ok) { fclose($fp); fwrite(STDERR, "Verrou indisponible sur debriefs.json\n"); exit(1); }

rewind($fp);
$frais = json_decode(stream_get_contents($fp), true);
if (!is_array($frais)) { flock($fp, LOCK_UN); fclose($fp); fwrite(STDERR, "Relecture illisible\n"); exit(1); }

$touche = 0;
foreach ($frais['sorties'] as $i => &$s) {
    if (!isset($encours[$i]) || ($s['id'] ?? '') !== ($encours[$i]['id'] ?? '~')) {
        // L'index a bougé (sortie créée/supprimée entre-temps) : on retrouve par id.
        continue;
    }
    if (!isset($s['presence']) || !is_array($s['presence'])) $s['presence'] = ['ticks' => [], 'noms' => [], 'volume' => 0];
    $s['presence']['ticks'][$tick] = array_values(array_map('strval', array_keys($presents)));
    foreach ($presents as $id => $nom) $s['presence']['noms'][(string)$id] = $nom;
    $touche++;
}
unset($s);

// Repêchage par id si les index ont bougé pendant le relevé.
if ($touche === 0) {
    $ids = array_map(function ($s) { return $s['id'] ?? ''; }, $encours);
    foreach ($frais['sorties'] as &$s) {
        if (!in_array($s['id'] ?? '', $ids, true)) continue;
        if (!isset($s['presence']) || !is_array($s['presence'])) $s['presence'] = ['ticks' => [], 'noms' => [], 'volume' => 0];
        $s['presence']['ticks'][$tick] = array_values(array_map('strval', array_keys($presents)));
        foreach ($presents as $id => $nom) $s['presence']['noms'][(string)$id] = $nom;
        $touche++;
    }
    unset($s);
}

ftruncate($fp, 0); rewind($fp);
fwrite($fp, json_encode($frais, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

plog("✅ tick $tick enregistré sur $touche sortie(s).");
alerte_resolue();
