<?php
// ============================================================
//  discord_purge.php — retire de la carte les bases des joueurs
//  qui ont QUITTÉ le Discord de la guilde.
//
//  Pourquoi : un membre qui part ne revient jamais sur le site,
//  donc la revérification de session (session_check.php) ne se
//  déclenche jamais pour lui — sa base restait sur la carte
//  jusqu'à un ménage manuel.
//
//  Deux usages :
//    • CRON  : php discord_purge.php --apply
//              (sans --apply = simulation, n'écrit rien)
//              Cron conseillé : 0 6 * * *  (tous les jours à 6h)
//    • ADMIN : bouton « Purger les bases » de Mon Compte
//              → save.php action `purgeLeftMembersBases`
//
//  PRUDENCE (ce script supprime des données) :
//    - seuls les comptes AVEC un discord_id sont vérifiables ;
//      un compte « mot de passe » n'est jamais touché ;
//    - Discord doit répondre 404 (= plus membre). Toute erreur
//      transitoire (429, 5xx, réseau) est OMISE par
//      dco_guild_members_check() → traitée comme « inconnu »,
//      jamais comme « parti » ;
//    - le responsable du site et la cheffe de guilde sont
//      intouchables ;
//    - les bases retirées sont ARCHIVÉES dans
//      discord_purge_removed.json (restauration possible) et
//      chaque passage est journalisé dans discord_purge.log ;
//    - les bases « orphelines » (pseudo sans compte) sont
//      seulement SIGNALÉES, jamais supprimées : ce sont souvent
//      des points d'intérêt posés par un admin.
//
//  Le compte lui-même n'est PAS supprimé : il porte l'historique
//  (sorties, registre des plans). Le rapport dit qui est parti,
//  la suppression du compte reste une décision d'admin.
// ============================================================

require_once __DIR__ . '/discord_oauth.php';

const DP_BASES_FILE   = __DIR__ . '/bases.json';
const DP_LOG_FILE     = __DIR__ . '/discord_purge.log';
const DP_ARCHIVE_FILE = __DIR__ . '/discord_purge_removed.json';

/** Identifiant Discord de la cheffe de guilde (même valeur que save.php). */
const DP_GUILD_CHIEF_DISCORD_ID = '332476079875031051';

// Lecture/écriture silencieuses : un échec (droits, fichier illisible) est traité
// par la valeur de retour — inutile d'en plus remplir le log d'erreurs PHP du
// serveur, l'appelant décide quoi faire.
function dp_read_json(string $path): array {
    if (!is_file($path)) return [];
    $raw = @file_get_contents($path);
    if ($raw === false) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function dp_write_json(string $path, array $data): bool {
    @chmod($path, 0664);
    return @file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

/**
 * Clé de comparaison d'un pseudo (insensible à la casse ET aux accents).
 *
 * ⚠ Le serveur n'a PAS mbstring : `strtolower()` y travaille octet par octet et
 * ne descend donc pas les majuscules accentuées — « Élodie » et « élodie » ne se
 * retrouvaient pas, si bien que la base du joueur n'était pas rattachée à son
 * compte et ressortait à tort comme « orpheline ». On ramène donc à la main les
 * majuscules accentuées avant de passer en minuscules (sans effet si mbstring
 * est présent, mb_strtolower faisant déjà le travail).
 */
function dp_key(string $s): string {
    static $accents = [
        'À'=>'à','Á'=>'á','Â'=>'â','Ã'=>'ã','Ä'=>'ä','Å'=>'å','Æ'=>'æ','Ç'=>'ç',
        'È'=>'è','É'=>'é','Ê'=>'ê','Ë'=>'ë','Ì'=>'ì','Í'=>'í','Î'=>'î','Ï'=>'ï',
        'Ñ'=>'ñ','Ò'=>'ò','Ó'=>'ó','Ô'=>'ô','Õ'=>'õ','Ö'=>'ö','Ø'=>'ø',
        'Ù'=>'ù','Ú'=>'ú','Û'=>'û','Ü'=>'ü','Ý'=>'ý','Œ'=>'œ',
    ];
    return dco_lc(strtr(trim($s), $accents));
}

function dp_log(string $msg): void {
    @file_put_contents(DP_LOG_FILE, '[' . date('c') . '] ' . $msg . PHP_EOL, FILE_APPEND);
}

/**
 * Interroge Discord et dresse l'état des lieux SANS rien modifier.
 *
 * @return array{
 *   ok:bool, error?:string,
 *   partis:array<int,array{user:string,discord_id:string,bases:int}>,
 *   inconnus:string[],       // vérification impossible (erreur transitoire)
 *   sans_discord:string[],   // comptes non liés à Discord (jamais purgés)
 *   orphelines:array<int,array{user:string,bases:int}>,
 *   total_bases:int, a_supprimer:int
 * }
 */
function dp_scan(): array {
    $cfg = dco_config();
    if (!$cfg) return ['ok' => false, 'error' => 'Configuration Discord absente.'];
    if (($cfg['bot_token'] ?? '') === '' || ($cfg['guild_id'] ?? '') === '') {
        return ['ok' => false, 'error' => 'bot_token ou guild_id manquant dans la configuration.'];
    }

    $users = dco_read_users();
    $bases = dp_read_json(DP_BASES_FILE);

    // Nombre de bases par pseudo (comparaison insensible à la casse : le pseudo
    // stocké dans bases.json vient de localStorage, il peut différer en casse).
    // On garde à part le libellé d'ORIGINE pour l'affichage du rapport — sinon
    // les points d'intérêt posés en admin ressortent en minuscules.
    $basesByUser  = [];
    $labelByUser  = [];
    foreach ($bases as $b) {
        $nom = trim((string)($b['user'] ?? ''));
        $k   = dp_key($nom);
        if ($k === '') continue;
        $basesByUser[$k] = ($basesByUser[$k] ?? 0) + 1;
        if (!isset($labelByUser[$k])) $labelByUser[$k] = $nom;
    }

    $ids = [];
    $sansDiscord = [];
    $knownPseudos = [];
    foreach ($users as $u) {
        $pseudo = trim((string)($u['user'] ?? ''));
        if ($pseudo === '') continue;
        $knownPseudos[dp_key($pseudo)] = true;
        $id = trim((string)($u['discord_id'] ?? ''));
        if ($id === '') { $sansDiscord[] = $pseudo; continue; }
        $ids[] = $id;
    }

    $membership = dco_guild_members_check($cfg, $ids);

    $partis = [];
    $inconnus = [];
    $aSupprimer = 0;
    foreach ($users as $u) {
        $pseudo = trim((string)($u['user'] ?? ''));
        $id     = trim((string)($u['discord_id'] ?? ''));
        if ($pseudo === '' || $id === '') continue;

        // Protections : responsable du site et cheffe de guilde.
        if (strcasecmp($pseudo, dco_chief()) === 0) continue;
        if ($id === DP_GUILD_CHIEF_DISCORD_ID) continue;

        if (!array_key_exists($id, $membership)) { $inconnus[] = $pseudo; continue; }
        if ($membership[$id] === true) continue;

        $n = $basesByUser[dp_key($pseudo)] ?? 0;
        $partis[] = ['user' => $pseudo, 'discord_id' => $id, 'bases' => $n];
        $aSupprimer += $n;
    }

    // Bases dont le pseudo ne correspond à aucun compte : signalées seulement.
    $orphelines = [];
    foreach ($basesByUser as $k => $n) {
        if (!isset($knownPseudos[$k])) $orphelines[] = ['user' => $labelByUser[$k] ?? $k, 'bases' => $n];
    }

    return [
        'ok' => true,
        'partis' => $partis,
        'inconnus' => $inconnus,
        'sans_discord' => $sansDiscord,
        'orphelines' => $orphelines,
        'total_bases' => count($bases),
        'a_supprimer' => $aSupprimer,
        'membership' => $membership,   // pour l'étiquetage par dp_apply()
    ];
}

/**
 * Supprime réellement les bases des comptes listés comme partis par dp_scan().
 * Archive ce qui est retiré avant d'écrire.
 *
 * @return array{ok:bool, error?:string, supprimees:int, joueurs:string[]}
 */
function dp_apply(array $scan): array {
    if (empty($scan['ok'])) return ['ok' => false, 'error' => $scan['error'] ?? 'scan_failed', 'supprimees' => 0, 'joueurs' => []];

    // Étiquetage AVANT tout : c'est ce qui permet à l'administration de classer
    // les anciens joueurs dès l'ouverture de la page, sans vérification manuelle.
    // Se fait même quand il n'y a aucune base à retirer — c'est aussi ce qui
    // EFFACE l'étiquette des joueurs revenus dans la guilde.
    if (!empty($scan['membership'])) {
        $tags = dco_sync_left_flags($scan['membership']);
        if ($tags['marques'] || $tags['effaces']) {
            dp_log("Étiquettes : {$tags['marques']} compte(s) marqué(s) parti(s), {$tags['effaces']} de retour.");
        }
    }

    if (empty($scan['partis'])) return ['ok' => true, 'supprimees' => 0, 'joueurs' => []];

    $cibles = [];
    foreach ($scan['partis'] as $p) $cibles[dp_key($p['user'])] = $p['user'];

    $bases   = dp_read_json(DP_BASES_FILE);
    $gardees = [];
    $retirees = [];
    foreach ($bases as $b) {
        $k = dp_key((string)($b['user'] ?? ''));
        if ($k !== '' && isset($cibles[$k])) {
            $b['_purged_at'] = date('c');
            $b['_purged_reason'] = 'a quitté le Discord de la guilde';
            $retirees[] = $b;
        } else {
            $gardees[] = $b;
        }
    }

    if (empty($retirees)) return ['ok' => true, 'supprimees' => 0, 'joueurs' => []];

    // Archive AVANT écriture : si l'archive échoue, on ne supprime rien.
    $archive = dp_read_json(DP_ARCHIVE_FILE);
    $archive = array_merge($archive, $retirees);
    if (!dp_write_json(DP_ARCHIVE_FILE, $archive)) {
        dp_log('ABANDON : impossible d\'écrire l\'archive ' . DP_ARCHIVE_FILE . ' — aucune base supprimée.');
        return ['ok' => false, 'error' => "Archive impossible (droits sur discord_purge_removed.json) — rien n'a été supprimé.", 'supprimees' => 0, 'joueurs' => []];
    }

    if (!dp_write_json(DP_BASES_FILE, array_values($gardees))) {
        dp_log('ERREUR : écriture de bases.json impossible.');
        return ['ok' => false, 'error' => 'Écriture de bases.json impossible.', 'supprimees' => 0, 'joueurs' => []];
    }

    $joueurs = array_values($cibles);
    dp_log('Purge : ' . count($retirees) . ' base(s) retirée(s) pour ' . count($joueurs) . ' joueur(s) parti(s) : ' . implode(', ', $joueurs));
    return ['ok' => true, 'supprimees' => count($retirees), 'joueurs' => $joueurs];
}

// ── Exécution en ligne de commande ──────────────────────────────────────────
if (PHP_SAPI === 'cli' && isset($argv) && realpath($argv[0]) === realpath(__FILE__)) {
    $apply = in_array('--apply', $argv, true);

    $scan = dp_scan();
    if (empty($scan['ok'])) {
        fwrite(STDERR, 'ERREUR : ' . $scan['error'] . PHP_EOL);
        dp_log('ERREUR : ' . $scan['error']);
        exit(1);
    }

    echo 'Comptes partis du Discord : ' . count($scan['partis']) . PHP_EOL;
    foreach ($scan['partis'] as $p) {
        echo "  - {$p['user']} ({$p['bases']} base(s))" . PHP_EOL;
    }
    echo 'Bases à supprimer : ' . $scan['a_supprimer'] . ' / ' . $scan['total_bases'] . PHP_EOL;
    if (!empty($scan['inconnus'])) {
        echo 'Non vérifiables cette fois (ignorés) : ' . implode(', ', $scan['inconnus']) . PHP_EOL;
    }
    if (!empty($scan['orphelines'])) {
        echo 'Bases orphelines (signalées, NON supprimées) : ' . count($scan['orphelines']) . PHP_EOL;
        foreach ($scan['orphelines'] as $o) echo "  - {$o['user']} ({$o['bases']})" . PHP_EOL;
    }

    if (!$apply) {
        echo PHP_EOL . 'SIMULATION — rien n\'a été modifié. Relancer avec --apply pour appliquer.' . PHP_EOL;
        dp_log('Simulation : ' . count($scan['partis']) . ' parti(s), ' . $scan['a_supprimer'] . ' base(s) concernée(s).');
        exit(0);
    }

    $res = dp_apply($scan);
    if (empty($res['ok'])) {
        fwrite(STDERR, 'ERREUR : ' . $res['error'] . PHP_EOL);
        exit(1);
    }
    echo 'Supprimé : ' . $res['supprimees'] . ' base(s).' . PHP_EOL;
    exit(0);
}
