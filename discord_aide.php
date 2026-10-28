<?php
// ============================================================
//  COMMANDE DISCORD /aide — tout ce que sait faire le bot, en une réponse
//
//  /aide     réponse PRIVÉE, classée par usage (sorties, fabrication, Deep
//            Desert…), chaque commande CLIQUABLE (mention de commande Discord :
//            un clic la pré-remplit dans la barre de saisie) ;
//  📢        bouton « Publier dans le salon », pour l'épingler dans un salon
//            d'accueil — montré aux admins et modérateurs seulement.
//
//  La liste ne ment jamais : on demande à Discord quelles commandes sont RÉELLEMENT
//  enregistrées (serveur `guild_id` + globales). Une commande pas encore en prod
//  n'apparaît pas ; une commande neuve apparaît dès son enregistrement (dans « Autres »
//  tant qu'elle n'a pas de texte ici). Réponse gardée une heure dans
//  epice/data/aide_commandes.json ; si Discord ne répond pas, on prend le cache même
//  périmé, et sans cache tout le catalogue s'affiche, sans liens.
//
//  Appelé par le dispatcher racine (discord_interactions.php), qui a déjà vérifié
//  la signature Ed25519.
// ============================================================

// Le catalogue : une entrée par commande, classée par usage. Clé = « nom » ou
// « nom sous-commande » ; « @Nom » = commande de message (clic droit), qu'on ne peut
// pas mentionner. Ajouter une commande au bot = lui écrire sa ligne ici.
const AIDE_FAMILLES = [
    ['📅 Sorties', [
        ['sortie creer',   "Annoncer une sortie (épice, labo, Landsraad, PvP…) : activité, date, puis chacun s'inscrit par poste avec les boutons de l'annonce."],
        ['sortie panneau', "*(staff)* Poster le panneau de création à épingler : une sortie se crée ensuite en un clic."],
    ]],
    ['🛠️ Fabrication', [
        ['commande creer', "Demander un craft à la guilde. L'annonce a ses boutons : ✋ je m'en charge · ✅ terminé · ↩️ je laisse · 🗑️ supprimer."],
    ]],
    ['🏜️ Deep Desert', [
        ['carte', "La carte de la semaine : épice, filons, grottes, labos, schémas uniques. Avec l'option `plan`, où tombe un schéma unique cette semaine."],
    ]],
    ['🔎 Objets', [
        ['objet',          "Fiche d'une arme, d'une armure ou d'un outil : stats, classement dans sa catégorie, où le trouver."],
        ['@Fiches objets', "Clic droit sur un message (appui long sur mobile) → **Applications → Fiches objets** : la fiche de chaque objet cité."],
    ]],
    ['🏛️ Landsraad', [
        ['decret', "Relever les décrets proposés cette semaine et lancer le vote de la guilde, en trois clics. Ouvert à tous : le premier connecté le lance."],
    ]],
];

// Commandes enregistrées chez Discord qu'on ne présente PAS aux joueurs (nom de commande,
// toutes sous-commandes comprises). /plan : déployé, mais volontairement NON documenté
// (choix de l'utilisateur, 2026-10-28) — sans cette liste, il sortait dans « Autres ».
const AIDE_MASQUEES = ['aide', 'plan'];

const AIDE_PUB   = 'aide_pub';
// Publier l'aide dans un salon : admins et modérateurs seulement (demande de l'utilisateur,
// 2026-10-28 : éviter que chacun la reposte). Reconnus à leurs droits Discord dans le
// salon : Administrateur (0x8) ou Gérer les messages (0x2000), comme pour /decret.
const AIDE_PERM_PUBLIER = 0x2000 | 0x8;
const AIDE_CACHE = __DIR__ . '/epice/data/aide_commandes.json';
const AIDE_TTL   = 3600;

/**
 * Les commandes enregistrées, réduites à ce dont l'aide a besoin :
 * clé (« nom », « nom sous-commande », « @Nom ») → ['id' => …, 'desc' => …].
 * $brut = la réponse de Discord (liste d'objets ApplicationCommand).
 */
function aide_index(array $brut): array {
    $out = [];
    foreach ($brut as $c) {
        $nom = (string)($c['name'] ?? '');
        if ($nom === '') continue;
        $id = (string)($c['id'] ?? '');
        if ((int)($c['type'] ?? 1) !== 1) { $out['@' . $nom] = ['id' => $id, 'desc' => '']; continue; }
        $subs = array_filter($c['options'] ?? [], function ($o) { return (int)($o['type'] ?? 0) === 1; });
        if (!$subs) { $out[$nom] = ['id' => $id, 'desc' => (string)($c['description'] ?? '')]; continue; }
        foreach ($subs as $s) $out[$nom . ' ' . $s['name']] = ['id' => $id, 'desc' => (string)($s['description'] ?? '')];
    }
    return $out;
}

/** Une commande, cliquable si on connaît son identifiant. */
function aide_mention(string $cle, ?array $cmds): string {
    if ($cle[0] === '@') return '🖱️ **' . substr($cle, 1) . '**';
    $id = $cmds[$cle]['id'] ?? '';
    return $id !== '' ? "</{$cle}:{$id}>" : "`/{$cle}`";
}

/**
 * L'encart d'aide. $cmds = aide_index(…) des commandes enregistrées, ou null si on
 * n'a pas pu les connaître (tout le catalogue, sans liens).
 */
function aide_embed(?array $cmds, string $base): array {
    $champs = [];
    $connues = [];
    foreach (AIDE_FAMILLES as [$famille, $entrees]) {
        $lignes = [];
        foreach ($entrees as [$cle, $texte]) {
            $connues[$cle] = true;
            if ($cmds !== null && !isset($cmds[$cle])) continue;   // pas enregistrée : on ne l'annonce pas
            $lignes[] = aide_mention($cle, $cmds) . ' — ' . $texte;
        }
        if ($lignes) $champs[] = ['name' => $famille, 'value' => implode("\n", $lignes)];
    }
    // Enregistrées mais sans texte ici : affichées avec leur description Discord,
    // pour qu'une commande neuve ne reste jamais invisible.
    if ($cmds !== null) {
        $autres = [];
        foreach ($cmds as $cle => $c) {
            if (isset($connues[$cle]) || in_array(explode(' ', $cle)[0], AIDE_MASQUEES, true)) continue;
            $autres[] = aide_mention($cle, $cmds) . ($c['desc'] !== '' ? ' — ' . $c['desc'] : '');
        }
        if ($autres) $champs[] = ['name' => '🧩 Autres', 'value' => implode("\n", $autres)];
    }
    return [
        'title'       => '🤖 Ce que sait faire le bot de la guilde',
        'description' => "Clique sur une commande pour la lancer. Les consultations (carte, fiches, aide) "
                       . "te répondent en privé : personne d'autre ne les voit.",
        'color'       => 0xC89210,
        'fields'      => $champs,
        'footer'      => ['text' => $cmds === null
            ? "Liste complète : Discord n'a pas donné les commandes actives, certaines peuvent ne pas l'être."
            : 'Liste tenue à jour toute seule : une nouvelle commande apparaît ici dès son enregistrement.'],
    ];
}

if (!defined('DUNE_INTERACTIONS_DISPATCHED')) {
    if (defined('AIDE_TESTS')) return;
    http_response_code(403);
    echo 'accès direct interdit';
    exit;
}

// ============================================================
//  INTERACTIONS
// ============================================================

require_once __DIR__ . '/dd_discord.php';   // dd_lire_json, dd_ecrire_json

/**
 * Commandes enregistrées (serveur + globales), en cache une heure. Les deux appels
 * partent EN MÊME TEMPS et sont bornés à 1,5 s : on doit répondre à Discord en 3 s.
 */
function aide_commandes(array $cfg): ?array {
    $cache = dd_lire_json(AIDE_CACHE);
    if ($cache && time() - (int)($cache['le'] ?? 0) < AIDE_TTL && is_array($cache['cmds'] ?? null)) return $cache['cmds'];

    $app   = (string)($cfg['app_id'] ?? '');
    $guild = trim((string)($cfg['guild_id'] ?? ''));
    $urls  = ["https://discord.com/api/v10/applications/{$app}/commands"];
    if ($guild !== '') $urls[] = "https://discord.com/api/v10/applications/{$app}/guilds/{$guild}/commands";

    $multi = curl_multi_init();
    $poignees = [];
    foreach ($urls as $u) {
        $ch = curl_init($u);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . ($cfg['bot_token'] ?? '')],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 1000,
            CURLOPT_TIMEOUT_MS     => 1500,
        ]);
        curl_multi_add_handle($multi, $ch);
        $poignees[] = $ch;
    }
    do { $st = curl_multi_exec($multi, $actifs); if ($actifs) curl_multi_select($multi, 0.2); } while ($actifs && $st === CURLM_OK);

    $brut = [];
    $ok = true;
    foreach ($poignees as $ch) {
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $j = json_decode((string)curl_multi_getcontent($ch), true);
        if ($code !== 200 || !is_array($j)) $ok = false; else $brut = array_merge($brut, $j);
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }
    curl_multi_close($multi);

    if (!$ok) return is_array($cache['cmds'] ?? null) ? $cache['cmds'] : null;   // cache périmé plutôt que rien
    $cmds = aide_index($brut);
    if (!is_dir(dirname(AIDE_CACHE))) @mkdir(dirname(AIDE_CACHE), 0775, true);
    dd_ecrire_json(AIDE_CACHE, ['le' => time(), 'cmds' => $cmds]);
    return $cmds;
}

function aide_repondre(array $data): void {
    echo json_encode(['type' => 4, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$base = rtrim(trim((string)($CFG['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
$lienSite = ['type' => 2, 'style' => 5, 'label' => 'Le site de la guilde', 'emoji' => ['name' => '🌐'], 'url' => $base . '/'];
$type = (int)($body['type'] ?? 0);

// ---- /aide : privé, avec le bouton qui publie -----------------------------------
// Droits du membre dans CE salon (chaîne décimale, absente en message privé).
$peutPublier = ((int)($body['member']['permissions'] ?? 0) & AIDE_PERM_PUBLIER) !== 0;

if ($type === 2) {
    $boutons = [$lienSite];
    if ($peutPublier) array_unshift($boutons,
        ['type' => 2, 'style' => 2, 'label' => 'Publier dans le salon', 'emoji' => ['name' => '📢'], 'custom_id' => AIDE_PUB]);
    aide_repondre([
        'embeds'     => [aide_embed(aide_commandes($CFG), $base)],
        'flags'      => 64,
        'components' => [['type' => 1, 'components' => $boutons]],
    ]);
}

// ---- 📢 Publier dans le salon : l'aide, publique, recalculée -------------------
if ($type === 3 && ($body['data']['custom_id'] ?? '') === AIDE_PUB) {
    // Revérifié au clic : le bouton n'est montré qu'aux bons membres, mais un droit retiré
    // entre-temps ne doit pas pouvoir servir.
    if (!$peutPublier) aide_repondre(['content' => "📢 Publier l'aide est réservé aux admins et modérateurs.", 'flags' => 64]);
    aide_repondre([
        'embeds'           => [aide_embed(aide_commandes($CFG), $base)],
        'components'       => [['type' => 1, 'components' => [$lienSite]]],
        'allowed_mentions' => ['parse' => []],
    ]);
}

aide_repondre(['content' => 'Action inconnue.', 'flags' => 64]);
