<?php
// ============================================================
//  COMMANDE DISCORD /carte — la carte Deep Desert de la semaine
//
//  /carte              l'image publiée cette semaine + son résumé
//  /carte plan:<nom>   où tombe ce schéma unique cette semaine (sites, case,
//                      chance par coffre)
//
//  PAS de croisement avec le registre des plans (« personne dans la guilde ne
//  l'a ») : ce registre n'est pas en production (décision de l'utilisateur,
//  2026-10-21). Le relevé garde la clé `pid` de chaque schéma pour pouvoir le
//  rebrancher le jour où il le sera.
//
//  Réponses PRIVÉES (éphémères), choix de l'utilisateur : la carte est déjà postée
//  dans le salon Deep Desert, une consultation n'a pas à reremplir le fil.
//
//  Rien n'est calculé ici : on relit le relevé publié par le bouton admin de la
//  carte (dd_cartes/releve.json, cf. dd_discord.php). Le serveur ne peut pas lire
//  les données de la semaine lui-même (Cloudflare).
//
//  Appelé par le dispatcher racine (discord_interactions.php), qui a déjà vérifié
//  la signature Ed25519 — d'où l'absence de contrôle ici, comme discord_plan.php.
// ============================================================

if (!defined('DUNE_INTERACTIONS_DISPATCHED')) {
    http_response_code(403);
    echo 'accès direct interdit';
    exit;
}

require_once __DIR__ . '/dd_discord.php';

/** URL publique du site (prod ou /v2), même si `dd_channel_id` n'est pas renseigné. */
function dc_base(): string {
    return rtrim(trim((string)($GLOBALS['CFG']['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
}

function dc_repondre(array $embed): void {
    $base = dc_base();
    echo json_encode(['type' => 4, 'data' => [
        'embeds'     => [$embed],
        'components' => dd_lien_carte($base),
        'flags'      => 64,
    ]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Même normalisation que /plan (dp_norm), sans mbstring. */
function dc_norm($s) {
    $s = strtolower((string)$s);
    $s = str_replace(['’', '‘', '`', '´'], "'", $s);
    $s = preg_replace('/\s+/u', ' ', $s);
    // Accents usuels ramenés à l'ASCII : « epee » doit trouver « Épée ».
    $s = strtr($s, ['é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'É' => 'e', 'È' => 'e', 'Ê' => 'e',
                    'à' => 'a', 'â' => 'a', 'À' => 'a', 'î' => 'i', 'ï' => 'i', 'ô' => 'o', 'Ô' => 'o',
                    'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'Ç' => 'c', 'œ' => 'oe']);
    $s = preg_replace('/[^a-z0-9\' ]/u', '', $s);
    return trim($s);
}
function dc_cut($s, $n) {
    return (strlen($s) > $n && preg_match('/^.{0,' . ($n - 1) . '}/us', $s, $m)) ? $m[0] . '…' : $s;
}

$type   = (int)($body['type'] ?? 0);
$opts   = $body['data']['options'] ?? [];
$releve = dd_lire_releve();

// ============================================================
//  AUTOCOMPLÉTION (type 4) de l'option `plan` — 25 choix maximum
// ============================================================
if ($type === 4) {
    $saisi = '';
    foreach ($opts as $o) if (!empty($o['focused'])) $saisi = (string)($o['value'] ?? '');
    $q = dc_norm($saisi);
    $choix = [];
    $plans = $releve ? dd_plans_semaine($releve) : [];
    uasort($plans, function ($a, $b) { return strcmp(dc_norm($a['nom']), dc_norm($b['nom'])); });
    foreach ($plans as $cle => $p) {
        if ($q !== '' && strpos(dc_norm($p['nom']), $q) === false) continue;
        // Le meilleur site dès la liste (« Labo E8 · 14 % ») : souvent, c'est tout
        // ce qu'on venait chercher. Libellé ET valeur : 100 caractères au plus.
        $s   = $p['sites'][0] ?? null;
        $ou  = $s ? ' — ' . (DD_TYPES[$s['type']] ?? 'Site') . ' ' . $s['cell'] . ' · ' . dd_pct_site($s)
                  . (count($p['sites']) > 1 ? ' (+' . (count($p['sites']) - 1) . ' autre' . (count($p['sites']) > 2 ? 's' : '')
                     . ' site' . (count($p['sites']) > 2 ? 's' : '') . ')' : '') : '';
        $choix[] = ['name' => dc_cut($p['nom'], 100 - strlen($ou)) . $ou, 'value' => dc_cut((string)$cle, 100)];
        if (count($choix) >= 25) break;
    }
    // Une liste VIDE ne dit rien : Discord n'affiche aucune proposition et l'on croit
    // la commande cassée (constaté en prod le 2026-10-21 : aucune carte n'y avait
    // encore été envoyée). On répond donc toujours par au moins une ligne qui explique.
    if (!$choix) {
        $choix[] = !$plans
            ? ['name' => '⏳ Carte de la semaine pas encore envoyée — ouvre la carte Deep Desert du site', 'value' => '__aucune_carte__']
            : ['name' => dc_cut('Aucun schéma unique « ' . $saisi . ' » sur la carte de la semaine', 100), 'value' => dc_cut($saisi !== '' ? $saisi : '?', 100)];
    }
    echo json_encode(['type' => 8, 'data' => ['choices' => $choix]], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!$releve) {
    dc_repondre([
        'title'       => '🏜️ Pas encore de carte cette semaine',
        // Le bouton n'a plus de texte : c'est un rond au logo Discord, au bout de la
        // barre de filtres (cf. ddPublishBtn dans script.js). Le décrire tel qu'on le voit.
        'description' => "N'importe quel membre peut l'envoyer en un clic :\n"
                       . "1. ouvre la **[carte Deep Desert](" . dc_base() . "/map.html?carte=dd)** du site ;\n"
                       . "2. clique sur le **bouton rond au logo Discord**, tout au bout de la barre de filtres en bas de la carte (juste après ★).\n\n"
                       . "La carte part dans le salon Deep Desert pour toute la guilde, et `/carte` la montrera ensuite.",
        'color'       => 0x7A6A4A,
    ]);
}

$plan = '';
foreach ($opts as $o) if (($o['name'] ?? '') === 'plan') $plan = trim((string)($o['value'] ?? ''));
if ($plan === '__aucune_carte__') $plan = '';   // ligne d'explication de l'autocomplétion

// ============================================================
//  /carte — l'encart de la semaine
// ============================================================
if ($plan === '') {
    dc_repondre(dd_embed_semaine($releve, dc_base()));
}

// ============================================================
//  /carte plan:<nom>
// ============================================================
$plans = dd_plans_semaine($releve);
$p = $plans[$plan] ?? null;
if (!$p) {
    // Saisie libre sans passer par la liste : on tente le nom.
    $q = dc_norm($plan);
    foreach ($plans as $c) if ($q !== '' && dc_norm($c['nom']) === $q) { $p = $c; break; }
}
$semaine = 'semaine du mardi ' . dd_date_fr((int)($releve['reset'] ?? dd_reset_courant()));
$alerte  = dd_releve_a_jour($releve) ? '' : "⚠️ **Relevé de la semaine dernière** — la carte de cette semaine n'a pas encore été publiée.\n\n";

if (!$p) {
    dc_repondre([
        'title'       => '❔ ' . dc_cut($plan, 200),
        'description' => $alerte . "Ce schéma n'est dans aucun coffre de la carte publiée ({$semaine}).\n"
                       . "Choisis-le dans la liste proposée pendant la saisie : elle ne contient que les schémas de la semaine.",
        'color'       => 0xB85428,
    ]);
}

$l = [];
foreach (array_slice($p['sites'], 0, 15) as $s) {
    $l[] = '• ' . dd_site_txt($s) . ' — ' . dd_pct_site($s) . ' par coffre';
}
$desc = $alerte . implode("\n", $l);
if (count($p['sites']) > 15) $desc .= "\n_… et " . (count($p['sites']) - 15) . ' autres sites_';

$base  = dc_base();
$embed = [
    'title'       => '📜 ' . dc_cut($p['nom'], 240),
    'description' => $desc,
    'color'       => 0xCDA434,
    'footer'      => ['text' => 'Deep Desert · ' . $semaine . ' · cases A1-I9 de la carte'],
];
if (!empty($releve['image'])) $embed['image'] = ['url' => $base . '/' . ltrim((string)$releve['image'], '/')];
dc_repondre($embed);
