<?php
// ============================================================
//  COMMANDE DISCORD /decret — le sondage des décrets du Landsraad
//
//  /decret          menu PRIVÉ : on coche les décrets que le jeu propose
//                   cette semaine (2 ou 3) ;
//  choix validé  →  le bot poste un SONDAGE Discord natif dans le salon
//                   `decret_channel_id` (à défaut, le salon de la commande).
//
//  Pourquoi un menu : les décrets de la semaine sont tirés au sort par serveur et
//  aucun site ne les publie (recherche du 2026-10-28). Il faut qu'un membre les voie en
//  jeu ; on réduit le reste à trois clics, pour que le premier connecté du matin lance
//  le vote sans attendre un officier. Ouvert à TOUS les membres, comme la carte.
//
//  Un seul sondage par semaine (même découpage que la carte Deep Desert : mardi, blocs
//  fixes de 7 × 24 h). Celui qui l'a lancé, ou un membre qui peut gérer les messages,
//  peut le REMPLACER (erreur de saisie) : l'ancien est supprimé, le neuf reposté.
//
//  Catalogue : landsraad_decrets.json, extrait du jeu (tools/build_landsraad_decrets.js).
//  État de la semaine : epice/data/decret_semaine.json.
//
//  Appelé par le dispatcher racine (discord_interactions.php), qui a déjà vérifié
//  la signature Ed25519 — d'où l'absence de contrôle ici, comme discord_carte.php.
// ============================================================

if (!defined('DUNE_INTERACTIONS_DISPATCHED')) {
    http_response_code(403);
    echo 'accès direct interdit';
    exit;
}

require_once __DIR__ . '/dd_discord.php';   // dd_reset_courant, dd_date_fr, dd_api, dd_refus, JSON atomique

const DECRET_ETAT = __DIR__ . '/epice/data/decret_semaine.json';
// Gérer les messages (0x2000) ou Administrateur (0x8) : peut remplacer le sondage d'un autre.
const DECRET_PERM_GERER = 0x2000 | 0x8;

function decret_log($msg) {
    $dir = __DIR__ . '/epice/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    @file_put_contents($dir . '/discord_decret.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
}

/** Coupe à $n caractères, sans mbstring (absent du serveur) : substr couperait un accent. */
function decret_coupe(string $s, int $n): string {
    return preg_match('/^.{0,' . $n . '}/us', $s, $m) ? $m[0] : $s;
}

function decret_repondre(int $type, array $data): void {
    echo json_encode(['type' => $type, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function decret_prive(string $texte): void {
    decret_repondre(4, ['content' => $texte, 'flags' => 64, 'allowed_mentions' => ['parse' => []]]);
}

/** Catalogue des décrets, indexé par identifiant. */
function decret_catalogue(): array {
    $d = dd_lire_json(__DIR__ . '/landsraad_decrets.json');
    $out = [];
    foreach (($d['decrets'] ?? []) as $x) if (!empty($x['id'])) $out[$x['id']] = $x;
    return $out;
}

/** Le sondage de la semaine en cours, ou null. */
function decret_semaine(): ?array {
    $e = dd_lire_json(DECRET_ETAT);
    return ($e && (int)($e['reset'] ?? 0) === dd_reset_courant()) ? $e : null;
}

function decret_auteur(array $body): array {
    $u = $body['member']['user'] ?? ($body['user'] ?? []);
    return [
        'id'   => (string)($u['id'] ?? ''),
        'nom'  => trim((string)($body['member']['nick'] ?? '')) ?: (trim((string)($u['global_name'] ?? '')) ?: (string)($u['username'] ?? '?')),
        // Permissions du membre dans CE salon, en chaîne décimale (bitfield 64 bits).
        'perm' => (int)($body['member']['permissions'] ?? 0),
    ];
}

function decret_peut_remplacer(array $auteur, ?array $existant): bool {
    if (!$existant) return true;
    return $auteur['id'] !== '' && $auteur['id'] === (string)($existant['par_id'] ?? '')
        || ($auteur['perm'] & DECRET_PERM_GERER) !== 0;
}

function decret_lien(array $e): string {
    return !empty($e['guild_id']) && !empty($e['message_id'])
        ? "https://discord.com/channels/{$e['guild_id']}/{$e['channel_id']}/{$e['message_id']}" : '';
}

/** Modifie la réponse privée d'origine (après fastcgi_finish_request). */
function decret_maj_reponse(array $body, string $texte): void {
    global $CFG;
    $token = (string)($body['token'] ?? '');
    if ($token === '') return;
    [$code] = dd_api(['token' => $CFG['bot_token']], 'PATCH',
        "/webhooks/{$CFG['app_id']}/{$token}/messages/@original",
        ['content' => $texte, 'components' => [], 'allowed_mentions' => ['parse' => []]]);
    if ($code < 200 || $code >= 300) decret_log("PATCH réponse refusé (HTTP {$code})");
}

$type = $body['type'] ?? 0;
$cat  = decret_catalogue();
if (!$cat) {
    decret_log('catalogue landsraad_decrets.json absent ou vide');
    decret_prive("⚠️ Catalogue des décrets absent du serveur (landsraad_decrets.json). Préviens un admin.");
}

// ============================================================
//  /decret — le menu
// ============================================================
if ($type === 2) {
    $auteur   = decret_auteur($body);
    $existant = decret_semaine();
    if ($existant && !decret_peut_remplacer($auteur, $existant)) {
        $lien = decret_lien($existant);
        decret_prive("🗳️ Le sondage des décrets de cette semaine est déjà lancé par **{$existant['par']}**"
            . ($lien !== '' ? " : {$lien}" : '.')
            . "\n-# Pour le corriger, demande-lui ou à un modérateur.");
    }

    $options = [];
    foreach ($cat as $d) {
        $options[] = [
            'label'       => decret_coupe($d['court'], 100),
            'value'       => $d['id'],
            'description' => decret_coupe($d['effet'], 100),
            'emoji'       => ['name' => $d['emoji']],
        ];
    }
    $texte = "🏛️ **Décrets du Landsraad — semaine du mardi " . dd_date_fr(dd_reset_courant()) . "**\n"
           . "Coche les décrets que le jeu propose cette semaine (Landsraad → décrets), puis valide : "
           . "le sondage part aussitôt pour toute la guilde.";
    if ($existant) {
        $texte .= "\n\n⚠️ Un sondage existe déjà (lancé par **{$existant['par']}**) : il sera **supprimé et remplacé**.";
    }
    decret_repondre(4, [
        'content'          => $texte,
        'flags'            => 64,
        'allowed_mentions' => ['parse' => []],
        'components'       => [[
            'type'       => 1,
            'components' => [[
                'type'        => 3,
                'custom_id'   => 'decret_choix',
                'placeholder' => 'Les décrets proposés cette semaine (2 ou 3)',
                'min_values'  => 2,
                'max_values'  => min(3, count($options)),
                'options'     => $options,
            ]],
        ]],
    ]);
}

// ============================================================
//  Menu validé — publier le sondage
// ============================================================
if ($type === 3 && ($body['data']['custom_id'] ?? '') === 'decret_choix') {
    $auteur = decret_auteur($body);
    $choix  = [];
    foreach (($body['data']['values'] ?? []) as $v) if (isset($cat[$v])) $choix[] = $cat[$v];
    if (count($choix) < 2) decret_repondre(7, ['content' => "⚠️ Choisis au moins deux décrets.", 'components' => []]);

    // Réponse IMMÉDIATE (remplace le menu), puis publication hors délai : la suppression
    // de l'ancien sondage + le POST du nouveau peuvent dépasser les 3 s de Discord.
    echo json_encode(['type' => 7, 'data' => ['content' => "⏳ Publication du sondage…", 'components' => []]],
        JSON_UNESCAPED_UNICODE);
    while (ob_get_level() > 0) ob_end_flush();
    flush();
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();

    // Revérifié ici : deux membres peuvent avoir ouvert le menu en même temps.
    $existant = decret_semaine();
    if ($existant && !decret_peut_remplacer($auteur, $existant)) {
        $lien = decret_lien($existant);
        decret_maj_reponse($body, "🗳️ **{$existant['par']}** vient de lancer le sondage de la semaine" . ($lien !== '' ? " : {$lien}" : '.'));
        exit;
    }

    $bot   = ['token' => $CFG['bot_token']];
    $chan  = trim((string)($CFG['decret_channel_id'] ?? '')) ?: (string)($body['channel_id'] ?? '');
    $guild = (string)($body['guild_id'] ?? '');
    $role  = trim((string)($CFG['decret_role_id'] ?? ''));
    $heures = max(1, min(768, (int)($CFG['decret_poll_heures'] ?? 8)));

    if ($existant && !empty($existant['message_id'])) {
        [$code, $j] = dd_api($bot, 'DELETE', "/channels/{$existant['channel_id']}/messages/{$existant['message_id']}");
        if (($code < 200 || $code >= 300) && $code !== 404) {   // 404 : déjà supprimé à la main
            decret_log("suppression de l'ancien sondage refusée : " . dd_refus($code, $j));
            decret_maj_reponse($body, "⚠️ Impossible de supprimer l'ancien sondage (" . dd_refus($code, $j) . "). Rien n'a été reposté.");
            exit;
        }
    }

    $lignes = array_map(function ($d) { return "{$d['emoji']} **{$d['nom']}** — {$d['effet']}"; }, $choix);
    $msg = [
        'content' => ($role !== '' ? "<@&{$role}>\n" : '')
            . "🏛️ **Décrets du Landsraad — semaine du mardi " . dd_date_fr(dd_reset_courant()) . "**\n"
            . implode("\n", $lignes)
            . "\n-# Proposés par le jeu cette semaine · relevés par {$auteur['nom']} avec /decret",
        'poll' => [
            'question'          => ['text' => 'Quel décret la guilde soutient-elle cette semaine ?'],
            'answers'           => array_map(function ($d) {
                return ['poll_media' => ['text' => decret_coupe($d['court'], 55), 'emoji' => ['name' => $d['emoji']]]];
            }, $choix),
            'duration'          => $heures,
            'allow_multiselect' => false,
            'layout_type'       => 1,
        ],
        'allowed_mentions' => $role !== '' ? ['parse' => [], 'roles' => [$role]] : ['parse' => []],
    ];
    [$code, $j] = dd_api($bot, 'POST', "/channels/{$chan}/messages", $msg);
    if ($code < 200 || $code >= 300) {
        $motif = dd_refus($code, $j);
        if (stripos((string)($j['message'] ?? ''), 'Missing Permissions') !== false) $motif .= ' — et « Créer des sondages »';
        decret_log("POST sondage refusé (salon {$chan}) : {$motif} " . json_encode($j, JSON_UNESCAPED_UNICODE));
        decret_maj_reponse($body, "⚠️ Sondage non publié : {$motif}.");
        exit;
    }

    $etat = [
        'reset'      => dd_reset_courant(),
        'message_id' => (string)($j['id'] ?? ''),
        'channel_id' => $chan,
        'guild_id'   => $guild,
        'par'        => $auteur['nom'],
        'par_id'     => $auteur['id'],
        'decrets'    => array_column($choix, 'id'),
        'le'         => gmdate('c'),
    ];
    if (!is_dir(dirname(DECRET_ETAT))) @mkdir(dirname(DECRET_ETAT), 0775, true);
    if (!dd_ecrire_json(DECRET_ETAT, $etat)) decret_log('écriture de ' . DECRET_ETAT . ' impossible (droits ?)');
    decret_log("sondage publié par {$auteur['nom']} : " . implode(', ', $etat['decrets']) . " → {$etat['message_id']}");

    $lien = decret_lien($etat);
    decret_maj_reponse($body, "✅ Sondage publié" . ($existant ? ' (l\'ancien a été remplacé)' : '')
        . ($lien !== '' ? " : {$lien}" : " dans <#{$chan}>."));
    exit;
}

decret_prive("Interaction /decret non gérée.");
