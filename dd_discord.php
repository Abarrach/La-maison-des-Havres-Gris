<?php
// ============================================================
//  dd_discord.php — la carte Deep Desert de la semaine, côté Discord
//  (inclus par dd_publish.php et discord_carte.php)
//
//  Fonctions seules, aucun effet à l'inclusion : les messages peuvent être
//  construits et vérifiés en ligne de commande sans rien envoyer.
//
//  Pourquoi un RELEVÉ et pas un calcul serveur : Cloudflare bloque le serveur sur
//  l'API acteurs et le .d.json de gaming.tools (403, revérifié le 2026-10-21).
//  Seul un navigateur lit les données de la semaine. Le bouton de la carte
//  compose donc l'image et envoie ce qu'il voit ; on le garde dans
//  `dd_cartes/releve.json`, que `/carte` relit sans rien recalculer.
//
//  ⚠ Impasse explorée le 2026-10-21 — préparer les 12 variantes d'avance et les
//  faire poster par un cron : chez gaming.tools, l'épice et les filons des 2
//  PROCHAINES variantes sont vides (0 acteur) ; ils ne sont relevés qu'une fois la
//  semaine commencée et changent sans doute à chaque passage. Une carte préparée
//  12 semaines plus tôt serait fausse. Chrome sans fenêtre reste bloqué par le
//  défi Cloudflare. D'où le bouton, ouvert aux membres pour ne pas dépendre d'un admin.
//
//  Décisions de l'utilisateur (2026-10-21) :
//    - publication par un BOUTON de la carte DD, ouvert à TOUT MEMBRE une fois par
//      semaine (« le premier qui passe envoie l'info »), puis grisé ; seul un
//      admin peut alors republier ;
//    - message = image + les CASES des grands champs d'épice, du titane, du
//      stravidium, des labos et des grottes, hors rangée A, rien d'autre (premier
//      essai jugé « trop long » avec le détail des schémas et la liste des manques) ;
//    - rappel bien visible de `/carte plan` et lien vers la carte interactive ;
//    - AUCUN croisement avec le registre des plans de la guilde : il n'est pas
//      en production. Les `pid` restent dans le relevé pour le rebrancher plus tard ;
//    - `/carte` (image de la semaine) et `/carte plan:<nom>`, réponses PRIVÉES.
//
//  Salon : `dd_channel_id` dans epice/discord_sortie_config.php (pas de repli sur
//  un autre salon : la carte n'a rien à faire dans le salon des sorties).
//  Images passées PAR URL PUBLIQUE (doctrine du dépôt : jamais de multipart).
// ============================================================

const DD_CARTES_DIR = __DIR__ . '/dd_cartes';
const DD_RELEVE     = DD_CARTES_DIR . '/releve.json';
const DD_GARDER     = 12;   // images conservées : les anciens messages pointent dessus

// Référence du compteur hebdo : 16 = semaine du mardi 9 juin 2026, 05:00 Paris.
// Même référence que `currentActorSeed()` (script.js) et `dd_week_count()`
// (dd_map_update.php) : le titre du message tombe ainsi sur la même semaine que
// la carte affichée.
const DD_REF_COUNT = 16;
const DD_REF_DATE  = '2026-06-09 05:00:00';

// Couches résumées dans le message (mêmes identifiants que DD_LAYERS dans
// script.js). Les autres restent visibles sur l'image si l'admin les a cochées.
const DD_COUCHES = [
    'spice_large'  => "🟠 Grands champs d'épice",
    'titanium'     => '⛏️ Titane',
    'stravidium'   => '💠 Stravidium',
    'ecolab'       => '🔬 Labos',
    'cave'         => '🕳️ Grottes',
];
const DD_TYPES = ['cave' => 'Grotte', 'ecolab' => 'Labo', 'shipwreck' => 'Épave', 'lootur' => 'Coffre isolé'];
const DD_MOIS  = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
                  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Config du bot pour la carte, ou un message d'erreur (string). */
function dd_discord_config() {
    $path = __DIR__ . '/epice/discord_sortie_config.php';
    if (!file_exists($path)) return 'configuration du bot absente sur le serveur';
    $c = @include $path;
    if (!is_array($c)) return 'configuration du bot illisible';
    $token = trim((string)($c['bot_token'] ?? ''));
    if ($token === '' || strpos($token, 'COLLE_TON') !== false) return "le bot n'a pas de token configuré";
    if (!function_exists('curl_init')) return 'cURL indisponible sur le serveur';
    $chan = trim((string)($c['dd_channel_id'] ?? ''));
    if ($chan === '') return 'aucun salon : renseigne `dd_channel_id` dans epice/discord_sortie_config.php';
    $base = rtrim(trim((string)($c['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
    return ['token' => $token, 'chan' => $chan, 'base' => $base, 'guild' => trim((string)($c['guild_id'] ?? ''))];
}

/** Nombre de semaines écoulées depuis la référence (blocs fixes de 7 × 24 h). */
function dd_semaines(?int $now = null): int {
    $ref = (new DateTime(DD_REF_DATE, new DateTimeZone('Europe/Paris')))->getTimestamp();
    return (int)floor((($now ?? time()) - $ref) / (7 * 24 * 3600));
}

/**
 * Début de la semaine Deep Desert en cours. Calculé comme le compteur, en blocs
 * FIXES de 7 × 24 h depuis la référence — et non « mardi 05:00 heure de Paris » :
 * à l'heure d'hiver les deux divergent d'une heure, et le titre du message aurait
 * annoncé l'ancienne semaine avec la nouvelle carte (constaté en simulant le 27/10).
 */
function dd_reset_courant(?int $now = null): int {
    $ref = (new DateTime(DD_REF_DATE, new DateTimeZone('Europe/Paris')))->getTimestamp();
    return $ref + dd_semaines($now) * 7 * 24 * 3600;
}


function dd_date_fr(int $ts): string {
    $d = (new DateTime('@' . $ts))->setTimezone(new DateTimeZone('Europe/Paris'));
    return (int)$d->format('j') . ' ' . DD_MOIS[(int)$d->format('n') - 1];
}

function dd_lire_json(string $f): ?array {
    if (!file_exists($f)) return null;
    $d = json_decode((string)@file_get_contents($f), true);
    return is_array($d) ? $d : null;
}

/** Écriture par fichier temporaire + renommage : jamais de relevé à moitié écrit. */
function dd_ecrire_json(string $f, array $d): bool {
    $tmp = $f . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) return false;
    @chmod($tmp, 0664);
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    return true;
}

function dd_lire_releve(): ?array {
    return dd_lire_json(DD_RELEVE);
}

/** Le relevé a-t-il été publié depuis le dernier reset ? */
function dd_releve_a_jour(array $r): bool {
    return (int)($r['reset'] ?? 0) >= dd_reset_courant();
}

/**
 * Les schémas uniques de la semaine, regroupés par plan : clé → nom, pid et
 * sites (type, case, nom, chance par coffre), meilleure chance d'abord.
 * Clé = pid (clé de plans_uniques.json) quand on l'a, sinon le nom.
 */
function dd_plans_semaine(array $r): array {
    $plans = [];
    foreach ((array)($r['sites'] ?? []) as $s) {
        foreach ((array)($s['uniques'] ?? []) as $u) {
            $pid = (string)($u['pid'] ?? '');
            $nom = (string)($u['nom'] ?? '');
            $cle = $pid !== '' ? $pid : 'n:' . $nom;
            if (!isset($plans[$cle])) $plans[$cle] = ['nom' => $nom, 'pid' => $pid, 'sites' => []];
            $plans[$cle]['sites'][] = ['type' => (string)($s['type'] ?? ''), 'cell' => (string)($s['cell'] ?? ''),
                                       'name' => (string)($s['name'] ?? ''), 'p' => (float)($u['p'] ?? 0)]
                                     + (isset($u['pp']) ? ['pp' => (float)$u['pp']] : []);
        }
    }
    // Meilleure chance d'abord, PvP compris : c'est elle qu'on vient chercher.
    $fort = function ($s) { return max($s['p'], $s['pp'] ?? 0); };
    foreach ($plans as &$p) usort($p['sites'], function ($a, $b) use ($fort) { return $fort($b) <=> $fort($a); });
    unset($p);
    return $plans;
}

function dd_pct(float $p): string {
    return $p >= 0.01 ? round($p * 100) . ' %' : '< 1 %';
}

/**
 * Chance d'un site : PvE, puis PvP quand la table diffère. Un même coffre est décrit
 * une fois par zone chez gaming.tools, avec des chances très différentes (épave
 * tombée : 3 % en PvE, 20 % en PvP) ; p = 0 avec pp = schéma absent de la table PvE.
 */
function dd_pct_site(array $s): string {
    if (($s['p'] ?? 0) <= 0 && isset($s['pp'])) return 'PvP ' . dd_pct($s['pp']);
    return dd_pct($s['p'] ?? 0) . (isset($s['pp']) ? ' · PvP ' . dd_pct($s['pp']) : '');
}

function dd_site_txt(array $s): string {
    $t = (DD_TYPES[$s['type']] ?? 'Site') . ' **' . $s['cell'] . '**';
    if ($s['name'] !== '') $t .= ' « ' . $s['name'] . ' »';
    return $t;
}

/** Coupe sans mbstring, sur une ligne entière, en annonçant ce qui manque. */
function dd_lignes(array $lignes, int $max, string $suite = ''): string {
    $out = ''; $n = 0;
    foreach ($lignes as $l) {
        if (strlen($out) + strlen($l) + 1 > $max) break;
        $out .= ($out === '' ? '' : "\n") . $l; $n++;
    }
    if ($n < count($lignes)) $out .= "\n_… et " . (count($lignes) - $n) . ' autres' . $suite . '_';
    return $out;
}

/**
 * Résumé de ce qui est SUR L'IMAGE (relevé `affiche`) : les CASES, rien d'autre.
 * Retour de l'utilisateur au premier vrai message (2026-10-21) : avec le détail
 * des schémas et la liste des manques, c'était « trop long ». Le détail vit dans
 * `/carte plan` et la carte interactive, que le message rappelle.
 */
function dd_resume(array $r): array {
    $lignes = [];
    foreach (DD_COUCHES as $id => $lib) {
        $liste = $r['affiche'][$id] ?? null;
        if (!is_array($liste) || !$liste) continue;
        // Filons : les plus gros champs d'abord ; le reste dans l'ordre des cases.
        $filons = isset($liste[0]['count']);
        if ($filons) usort($liste, function ($a, $b) { return ($b['count'] ?? 0) <=> ($a['count'] ?? 0); });
        $cases = array_values(array_unique(array_map(function ($i) { return (string)$i['cell']; }, $liste)));
        // Rangée A retirée du TEXTE (demande de l'utilisateur, 2026-10-21) : la bande
        // sud se lit sur l'image, la lister ne faisait qu'allonger le message.
        // L'image et `/carte plan` la gardent.
        $cases = array_values(array_filter($cases, function ($c) { return $c[0] !== 'A'; }));
        if (!$cases) continue;
        if (!$filons) sort($cases);
        $lignes[] = '**' . $lib . '** : ' . implode(' · ', $cases);
    }
    return $lignes;
}

function dd_lien_carte(string $base): array {
    return [[
        'type' => 1,
        'components' => [['type' => 2, 'style' => 5, 'label' => 'Carte interactive', 'emoji' => ['name' => '🗺️'],
                          'url' => $base . '/map.html?carte=dd']],
    ]];
}

/** Encart de la semaine (message du salon ET réponse de `/carte`). */
function dd_embed_semaine(array $r, string $base): array {
    $desc = '';
    if (!dd_releve_a_jour($r)) {
        $desc .= "⚠️ **Carte de la semaine dernière** — celle de cette semaine n'a pas encore été publiée, "
               . "les positions ont changé au reset du mardi.\n\n";
    }
    $desc .= dd_lignes(dd_resume($r), 1800);

    // Les deux portes vers le détail, en évidence (demande de l'utilisateur) :
    // le message ne porte plus que les cases.
    $desc .= "\n\n🔎 **Un schéma unique en tête ?** Tape **`/carte plan:`** puis son nom : "
           . "où il tombe cette semaine, case et chance par coffre."
           . "\n🗺️ **[Carte interactive](" . $base . '/map.html?carte=dd)** pour les autres filtres '
           . '(épice moyenne, épaves, tous les champs de filons) et le détail de chaque site.';

    $embed = [
        'title'       => '🏜️ Deep Desert — semaine du mardi ' . dd_date_fr((int)($r['reset'] ?? dd_reset_courant())),
        'url'         => $base . '/map.html?carte=dd',
        'description' => $desc,
        'color'       => 0xCDA434,
        'footer'      => ['text' => 'Seed #' . (int)($r['seed'] ?? 0)
                         . (!empty($r['par']) ? ' · publiée par ' . $r['par'] : '')],
    ];
    if (!empty($r['image'])) $embed['image'] = ['url' => $base . '/' . ltrim((string)$r['image'], '/')];
    return $embed;
}

/** Appel REST au nom du bot. Renvoie [code HTTP, corps décodé]. */
function dd_api(array $cfg, string $methode, string $chemin, ?array $corps = null): array {
    $ch = curl_init('https://discord.com/api/v10' . $chemin);
    $opts = [
        CURLOPT_CUSTOMREQUEST  => $methode,
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => 10,
    ];
    if ($corps !== null) $opts[CURLOPT_POSTFIELDS] = json_encode($corps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$resp === false ? 0 : $code, json_decode((string)$resp, true)];
}

/** Motif lisible d'un refus Discord (mêmes aides que les tournois et les Stories). */
function dd_refus(int $code, $j): string {
    $err = trim((string)(is_array($j) ? ($j['message'] ?? '') : ''));
    $aide = stripos($err, 'Missing Access') !== false ? ' — le bot ne voit pas ce salon (« Voir le salon », « Envoyer des messages »)'
          : (stripos($err, 'Missing Permissions') !== false ? ' — le bot ne peut pas y écrire (« Envoyer des messages », « Intégrer des liens »)' : '');
    return $code === 0 ? 'Discord injoignable depuis le serveur'
                       : 'Discord a refusé (HTTP ' . $code . ($err !== '' ? ' : ' . $err : '') . ')' . $aide;
}

/**
 * Publie le relevé en REMPLAÇANT (supprime + reposte) le dernier message de carte :
 * celui de la semaine (un admin qui republie ne doit pas doubler le message) comme
 * celui de la semaine passée (demande de l'utilisateur, 2026-10-21 : le salon ne
 * garde que la carte en cours, une carte périmée n'y sert qu'à induire en erreur).
 * Renvoie ['ok' => true, 'id', 'edite', 'lien'] ou ['ok' => false, 'error'].
 */
function dd_publier(array $r, ?array $ancien): array {
    $cfg = dd_discord_config();
    if (!is_array($cfg)) return ['ok' => false, 'error' => $cfg];
    $msg = [
        'embeds'           => [dd_embed_semaine($r, $cfg['base'])],
        'components'       => dd_lien_carte($cfg['base']),
        'allowed_mentions' => ['parse' => []],
    ];

    // Republier = SUPPRIMER le message de la semaine puis en poster un neuf, et non
    // l'éditer : un PATCH qui change l'URL de l'image faisait DISPARAÎTRE l'image
    // dans Discord (constaté le 2026-10-21 sur /v2, alors que la nouvelle image était
    // bien servie : 200, 408 Ko). Un message neuf l'affiche toujours, et arrive en bas
    // du salon où on le voit. Il n'y a jamais qu'UN message de carte dans le salon.
    $edite = false;
    if ($ancien && !empty($ancien['message_id']) && (string)($ancien['channel_id'] ?? '') === $cfg['chan']) {
        $memeSemaine = (int)($ancien['reset'] ?? 0) === (int)$r['reset'];
        [$code, $j] = dd_api($cfg, 'DELETE', '/channels/' . $cfg['chan'] . '/messages/' . $ancien['message_id']);
        $supprime = ($code >= 200 && $code < 300) || $code === 404;   // 404 : déjà supprimé à la main
        // Refus sur le message de CETTE semaine : on s'arrête, sinon on le doublerait.
        // Sur celui de la semaine passée : on poste quand même — une vieille carte
        // restée en place vaut mieux que pas de carte du tout.
        if (!$supprime && $memeSemaine) return ['ok' => false, 'error' => dd_refus($code, $j)];
        $edite = $supprime;
    }
    [$code, $j] = dd_api($cfg, 'POST', '/channels/' . $cfg['chan'] . '/messages', $msg);
    if ($code < 200 || $code >= 300) return ['ok' => false, 'error' => dd_refus($code, $j)];
    $id = (string)($j['id'] ?? '');

    $guild = $cfg['guild'];
    if ($guild === '') {
        [$code, $c] = dd_api($cfg, 'GET', '/channels/' . $cfg['chan']);
        $guild = (string)($c['guild_id'] ?? '');
    }
    return ['ok' => true, 'id' => $id, 'chan' => $cfg['chan'], 'edite' => $edite,
            'lien' => $guild !== '' && $id !== '' ? "https://discord.com/channels/{$guild}/{$cfg['chan']}/{$id}" : ''];
}
