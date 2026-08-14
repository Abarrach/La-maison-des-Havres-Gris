<?php
// ============================================================
//  discord_oauth.php — bibliothèque partagée "Login Discord"
//
//  Utilisée par :
//    - discord_login.php     (départ du flux OAuth2)
//    - discord_callback.php  (retour Discord → session)
//    - session_check.php     (revérification d'appartenance)
//    - import_discord_map.php(pré-chargement du mapping Excel)
//
//  Aucun secret ici : tout est lu depuis discord_oauth_config.php
//  (gitignoré). Si la config est absente, dco_config() renvoie null
//  et les appelants doivent dégrader proprement.
// ============================================================

// Session « rester connecté » 30 jours, posée DANS le code (fiable, sans dépendre
// du .user.ini). cookie_lifetime = cookie persistant ; gc_maxlifetime = durée de
// vie serveur. Le cookie persistant est réellement (ré)émis à la connexion via
// session_regenerate_id() dans discord_callback.php.
if (session_status() === PHP_SESSION_NONE) {
    $dcoLife = 60 * 60 * 24 * 30; // 30 jours
    @ini_set('session.gc_maxlifetime', (string)$dcoLife);
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params([
            'lifetime' => $dcoLife, 'path' => '/', 'secure' => true,
            'httponly' => true, 'samesite' => 'Lax',
        ]);
    } else {
        session_set_cookie_params($dcoLife, '/', '', true, true);
    }
    session_start();
}

const DCO_API = 'https://discord.com/api/v10';

/** Charge la config (discord_oauth_config.php). Renvoie un array ou null si absent/incomplet. */
function dco_config(): ?array {
    static $cfg = null;
    if ($cfg !== null) return $cfg ?: null;
    $path = __DIR__ . '/discord_oauth_config.php';
    if (!file_exists($path)) { $cfg = false; return null; }
    $c = include $path;
    if (!is_array($c) || empty($c['client_id'])) { $cfg = false; return null; }
    // Nettoyage défensif : retire espaces / retours à la ligne parasites
    // (un \n collé dans bot_token ou guild_id casse l'appel → http_0).
    foreach (['client_id','client_secret','bot_token','guild_id','redirect_uri'] as $k) {
        if (isset($c[$k]) && is_string($c[$k])) $c[$k] = trim($c[$k]);
    }
    // Valeurs par défaut
    $c['recheck_seconds'] = isset($c['recheck_seconds']) ? (int)$c['recheck_seconds'] : 900;
    $c['admin_role_ids']  = isset($c['admin_role_ids'])  && is_array($c['admin_role_ids'])  ? array_map('strval', $c['admin_role_ids'])  : [];
    $c['access_role_ids'] = isset($c['access_role_ids']) && is_array($c['access_role_ids']) ? array_map('strval', $c['access_role_ids']) : [];
    $cfg = $c;
    return $cfg;
}

/**
 * Pseudo du responsable du site (Abarrach) — toujours admin, quel que soit son
 * rôle Discord (cohérent avec save.php / get_users.php). À ne pas confondre avec
 * le chef de guilde (Lorhelyne), qui est un rôle Discord/guilde distinct : voir
 * la protection anti-rétrogradation/suppression dans save.php (par discord_id).
 */
function dco_chief(): string { return 'Abarrach'; }

/** Minuscule sûre (repli si l'extension mbstring est absente). */
function dco_lc(string $s): string {
    return function_exists('mb_strtolower') ? mb_strtolower($s) : strtolower($s);
}

// ---------- Fichier utilisateurs (même format que save.php) ----------

function dco_users_path(): string { return __DIR__ . '/users_SECURE_9x.json'; }

function dco_read_users(): array {
    $p = dco_users_path();
    if (!file_exists($p)) return [];
    $j = json_decode(file_get_contents($p), true);
    return is_array($j) ? $j : [];
}

function dco_write_users(array $users): bool {
    $p = dco_users_path();
    @chmod($p, 0664);
    $res = file_put_contents($p, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $res !== false;
}

// ---------- Étiquette « parti de la guilde » ----------

/**
 * Mémorise DANS le fichier utilisateurs qu'un compte n'est plus (ou est de
 * nouveau) membre du Discord — champ `left_guild_at` (date ISO du premier
 * constat, absent tant que le compte est membre).
 *
 * Pourquoi le persister : sans ça, l'interface d'administration ne sait qui est
 * parti qu'APRÈS un clic sur « Vérifier Discord ». À l'ouverture de la page, les
 * partis étaient mélangés aux joueurs actifs. L'étiquette permet de les
 * regrouper dès le premier affichage.
 *
 * Le retour d'un joueur avec LE MÊME compte Discord efface l'étiquette tout
 * seul (connexion réussie, revérification de session, ou balayage quotidien) —
 * il n'y a rien à fusionner, `dco_resolve_account()` le retrouve par son id.
 *
 * @return bool true si le fichier a été modifié
 */
function dco_mark_left(string $discordId, bool $left): bool {
    if ($discordId === '') return false;
    $users   = dco_read_users();
    $changed = false;
    foreach ($users as &$u) {
        if ((string)($u['discord_id'] ?? '') !== $discordId) continue;
        $has = trim((string)($u['left_guild_at'] ?? '')) !== '';
        if ($left && !$has) {
            $u['left_guild_at'] = date('c');            // premier constat : on horodate
            $changed = true;
        } elseif (!$left && $has) {
            unset($u['left_guild_at']);                 // de retour
            $changed = true;
        }
        break;
    }
    unset($u);
    return $changed ? dco_write_users($users) : false;
}

/**
 * Applique en une passe le résultat d'une vérification groupée
 * (`dco_guild_members_check`). Les ids ABSENTS du tableau sont des vérifications
 * qui ont échoué : on n'y touche pas — « inconnu » n'est pas « parti ».
 *
 * @return array{marques:int, effaces:int}
 */
function dco_sync_left_flags(array $membership): array {
    $users = dco_read_users();
    $marques = 0; $effaces = 0; $changed = false;
    foreach ($users as &$u) {
        $id = trim((string)($u['discord_id'] ?? ''));
        if ($id === '' || !array_key_exists($id, $membership)) continue;
        $has = trim((string)($u['left_guild_at'] ?? '')) !== '';
        if ($membership[$id] === false && !$has) {
            $u['left_guild_at'] = date('c'); $marques++; $changed = true;
        } elseif ($membership[$id] === true && $has) {
            unset($u['left_guild_at']); $effaces++; $changed = true;
        }
    }
    unset($u);
    if ($changed) dco_write_users($users);
    return ['marques' => $marques, 'effaces' => $effaces];
}

// ---------- Appels HTTP Discord (cURL) ----------

/** GET authentifié. $auth = "Bot xxx" ou "Bearer xxx". Renvoie ['code'=>int,'json'=>array|null]. */
function dco_http_get(string $url, string $auth): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Authorization: ' . $auth],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = ($resp === false) ? curl_error($ch) : '';
    curl_close($ch);
    return ['code' => $code, 'json' => $resp ? json_decode($resp, true) : null, 'err' => $err];
}

/** POST application/x-www-form-urlencoded. Renvoie ['code'=>int,'json'=>array|null]. */
function dco_http_post_form(string $url, array $fields, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($fields),
        CURLOPT_HTTPHEADER     => array_merge(['Content-Type: application/x-www-form-urlencoded'], $headers),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'json' => $resp ? json_decode($resp, true) : null];
}

/**
 * Récupère l'appartenance d'un membre à la guilde via le BOT TOKEN.
 * Renvoie ['in_guild'=>bool, 'roles'=>string[], 'nick'=>?string, 'error'=>?string].
 * 404 = pas membre. Le bot doit être présent dans la guilde (il l'est : bot Sorties).
 */
function dco_guild_member(array $cfg, string $discordUserId): array {
    $token = $cfg['bot_token'] ?? '';
    $guild = $cfg['guild_id'] ?? '';
    if ($token === '' || $guild === '') {
        return ['in_guild' => false, 'roles' => [], 'nick' => null, 'error' => 'config_incomplete'];
    }
    $r = dco_http_get(DCO_API . "/guilds/{$guild}/members/{$discordUserId}", 'Bot ' . $token);
    if ($r['code'] === 200 && is_array($r['json'])) {
        return [
            'in_guild' => true,
            'roles'    => array_map('strval', $r['json']['roles'] ?? []),
            'nick'     => $r['json']['nick'] ?? null,
            'error'    => null,
        ];
    }
    if ($r['code'] === 404) {
        return ['in_guild' => false, 'roles' => [], 'nick' => null, 'error' => null];
    }
    // 0 = échec cURL (réseau/URL/header) ; 401/403/5xx = refus/erreur Discord.
    // On ne sait pas → erreur transitoire (ne pas éjecter abusivement).
    $detail = 'http_' . $r['code'];
    if ($r['code'] === 0 && !empty($r['err'])) $detail .= ' · ' . $r['err'];
    @error_log('Discord guild member check échec : ' . $detail
        . ' (guild=' . $guild . ', uid=' . $discordUserId . ', tokenLen=' . strlen($token) . ')');
    return ['in_guild' => false, 'roles' => [], 'nick' => null, 'error' => $detail];
}

/**
 * Vérifie l'appartenance à la guilde pour PLUSIEURS utilisateurs en un seul appel
 * (bouton « Vérifier Discord » de Mon Compte — déclenchement MANUEL uniquement).
 * Trop lent/sensible au rate-limit Discord pour tourner au chargement de la page
 * (tenté puis abandonné — résultats non déterministes à cause des 429 silencieux).
 *
 * Traite par petits lots en parallèle (curl_multi) avec retry sur 429 (Retry-After)
 * pour rester déterministe même proche de la limite de l'API Discord.
 *
 * Renvoie [discord_id => bool in_guild]. Un id resté en erreur transitoire après
 * tous les retries est OMIS du résultat (absent = « inconnu », à ne pas confondre
 * avec « hors guilde »).
 */
function dco_guild_members_check(array $cfg, array $discordIds): array {
    $token = $cfg['bot_token'] ?? '';
    $guild = $cfg['guild_id'] ?? '';
    $result = [];
    if ($token === '' || $guild === '') return $result;

    $pending = array_values(array_unique(array_filter($discordIds, fn($id) => $id !== '')));
    $batchSize = 4;
    $maxRounds = 4;

    for ($round = 0; $round < $maxRounds && !empty($pending); $round++) {
        $retryNext = [];
        $retryAfter = 0.0;

        foreach (array_chunk($pending, $batchSize) as $batch) {
            $mh = curl_multi_init();
            $handles = [];
            foreach ($batch as $id) {
                $ch = curl_init(DCO_API . "/guilds/{$guild}/members/{$id}");
                curl_setopt_array($ch, [
                    CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $token],
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_HEADER         => true,
                    CURLOPT_TIMEOUT        => 10,
                    CURLOPT_CONNECTTIMEOUT => 5,
                ]);
                curl_multi_add_handle($mh, $ch);
                $handles[$id] = $ch;
            }
            $running = null;
            do {
                $mrc = curl_multi_exec($mh, $running);
                if ($running > 0) curl_multi_select($mh);
            } while ($running > 0 && $mrc === CURLM_OK);

            foreach ($handles as $id => $ch) {
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                if ($code === 200) {
                    $result[$id] = true;
                } elseif ($code === 404) {
                    $result[$id] = false;
                } elseif ($code === 429) {
                    $retryNext[] = $id;
                    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
                    $header = substr((string)curl_multi_getcontent($ch), 0, $headerSize);
                    if (preg_match('/Retry-After:\s*([0-9.]+)/i', $header, $m)) {
                        $retryAfter = max($retryAfter, (float)$m[1]);
                    }
                } else {
                    // erreur transitoire (0/401/403/5xx) → retry plutôt que de conclure "hors guilde"
                    $retryNext[] = $id;
                }
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
            }
            curl_multi_close($mh);
            usleep(300000); // pacing entre lots pour rester sous la limite Discord
        }

        $pending = $retryNext;
        if (!empty($pending)) sleep($retryAfter > 0 ? (int)ceil($retryAfter) : 1);
    }

    return $result;
}

/**
 * Le membre a-t-il le DROIT D'ACCÈS au site ?
 *   - doit être dans la guilde (in_guild)
 *   - si access_role_ids est vide  → tout membre de la guilde a accès
 *   - si access_role_ids est défini → il faut porter au moins un de ces rôles
 *     (permet d'exclure les invités / membres d'un autre jeu, etc.)
 * Le responsable du site (Abarrach) garde toujours l'accès.
 */
function dco_member_allowed(array $cfg, array $member, string $pseudo = ''): bool {
    if (empty($member['in_guild'])) return false;
    if ($pseudo !== '' && strcasecmp($pseudo, dco_chief()) === 0) return true;
    $roles = $member['roles'] ?? [];
    // Un rôle ADMIN donne toujours l'accès (un admin n'a pas forcément le rôle « membre »).
    foreach ($cfg['admin_role_ids'] as $rid) {
        if (in_array($rid, $roles, true)) return true;
    }
    $allowed = $cfg['access_role_ids'];
    if (empty($allowed)) return true; // pas de filtre → tout membre de la guilde
    foreach ($allowed as $rid) {
        if (in_array($rid, $roles, true)) return true;
    }
    return false;
}

/**
 * Détermine le rôle du site (admin/user) à partir du pseudo et des rôles Discord.
 *
 * Un admin peut aussi être accordé MANUELLEMENT (indépendamment du rôle Discord)
 * via Mon Compte (Gestion des utilisateurs > Promouvoir) : ce cas se traduit par
 * `role: "admin"` déjà écrit dans users_SECURE_9x.json, qu'on honore ici comme
 * un override persistant. Sans ce 3e cas, la revérification périodique Discord
 * (session_check.php) écrasait silencieusement toute promotion manuelle.
 */
function dco_compute_role(array $cfg, string $pseudo, array $discordRoles): string {
    if (strcasecmp($pseudo, dco_chief()) === 0) return 'admin';
    foreach ($cfg['admin_role_ids'] as $rid) {
        if (in_array($rid, $discordRoles, true)) return 'admin';
    }
    foreach (dco_read_users() as $u) {
        if (strcasecmp((string)($u['user'] ?? ''), $pseudo) === 0) {
            return (($u['role'] ?? 'user') === 'admin') ? 'admin' : 'user';
        }
    }
    return 'user';
}

// ---------- Mapping Discord ↔ pseudo du site ----------

/**
 * Trouve (ou crée) le compte du site correspondant à un utilisateur Discord.
 * Stratégie (cohérente avec l'import Excel) :
 *   1. par discord_id numérique (lien définitif)
 *   2. par discord_match (pseudo Discord pré-chargé depuis l'Excel) → on lie alors l'id
 *   3. sinon : création d'un compte (pseudo = global_name, dédupliqué)
 *
 * @return array ['pseudo'=>string, 'created'=>bool]
 */
function dco_resolve_account(string $discordId, string $discordName): array {
    $users = dco_read_users();
    $nameLc = dco_lc(trim($discordName));
    $changed = false;
    $pseudo = null;

    // 1. lien définitif par id
    foreach ($users as &$u) {
        if (($u['discord_id'] ?? '') !== '' && (string)$u['discord_id'] === $discordId) {
            $pseudo = $u['user'];
            break;
        }
    }
    unset($u);

    // 2. appariement par pseudo Discord (Excel 2 colonnes) → on lie l'id
    if ($pseudo === null && $nameLc !== '') {
        foreach ($users as &$u) {
            if (($u['discord_id'] ?? '') === '' && dco_lc((string)($u['discord_match'] ?? '')) === $nameLc) {
                $u['discord_id'] = $discordId;
                $pseudo = $u['user'];
                $changed = true;
                break;
            }
        }
        unset($u);
    }

    // 3. création d'un nouveau compte
    $created = false;
    if ($pseudo === null) {
        $base = trim($discordName) !== '' ? trim($discordName) : ('Membre' . substr($discordId, -4));
        $candidate = $base; $n = 2;
        $taken = function ($name) use ($users) {
            foreach ($users as $u) { if (strcasecmp($u['user'], $name) === 0) return true; }
            return false;
        };
        while ($taken($candidate)) { $candidate = $base . $n; $n++; }
        $users[] = ['user' => $candidate, 'role' => 'user', 'discord_id' => $discordId];
        $pseudo = $candidate;
        $created = true; $changed = true;
    }

    if ($changed) dco_write_users($users);
    return ['pseudo' => $pseudo, 'created' => $created];
}

/** POST JSON authentifié (Bot xxx). Renvoie ['code'=>int,'json'=>array|null]. */
function dco_http_post_json(string $url, array $payload, string $auth): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Authorization: ' . $auth, 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'json' => $resp ? json_decode($resp, true) : null];
}

/**
 * Envoie un MP Discord à un membre via le bot (même token que l'appartenance
 * guilde/bot Sorties). Best-effort : ne lève jamais, renvoie juste true/false
 * (MP fermés, membre introuvable, config absente… tout est silencieux).
 */
function dco_dm_send(array $cfg, string $discordId, string $content): bool {
    $token = $cfg['bot_token'] ?? '';
    if ($token === '' || $discordId === '' || !function_exists('curl_init')) return false;
    $open = dco_http_post_json(DCO_API . '/users/@me/channels', ['recipient_id' => $discordId], 'Bot ' . $token);
    $chan = $open['json']['id'] ?? '';
    if ($open['code'] < 200 || $open['code'] >= 300 || $chan === '') return false;
    $send = dco_http_post_json(DCO_API . "/channels/{$chan}/messages", ['content' => $content], 'Bot ' . $token);
    return $send['code'] >= 200 && $send['code'] < 300;
}

// ---------- Session ----------

/** Pose la session du site (mêmes clés que auth.php) + métadonnées de revérif Discord. */
function dco_apply_session(string $pseudo, string $role, string $discordId): void {
    $_SESSION['user']            = $pseudo;
    $_SESSION['role']            = $role;
    $_SESSION['discord_id']      = $discordId;
    $_SESSION['discord_checked'] = time();
    // On n'arrive ici qu'après vérification de l'appartenance à la guilde :
    // si le compte était étiqueté « parti », c'est qu'il est revenu.
    dco_mark_left($discordId, false);
}

function dco_clear_session(): void {
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
}
