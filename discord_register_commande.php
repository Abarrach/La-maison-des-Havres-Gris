<?php
// ============================================================
//  ENREGISTREMENT de la commande /commande auprès de Discord
//
//  À lancer UNE FOIS (puis à chaque modification de la commande) :
//      https://.../discord_register_commande.php
//  ou en CLI :  php discord_register_commande.php
//
//  - guild_id renseigné dans discord_sortie_config.php → commande de
//    SERVEUR (apparaît instantanément — idéal pour tester en dev).
//  - guild_id vide → commande GLOBALE (propagation ~1h).
//
//  ⚠ Nécessite le bot_token (secret) dans discord_sortie_config.php.
//  ⚠ Utilise le MÊME app_id que /sortie (une seule application Discord
//    pour tout le bot, cf. discord_interactions.php le dispatcher).
// ============================================================

header('Content-Type: text/plain; charset=utf-8');

$CFG_PATH = __DIR__ . '/epice/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { echo "config absente (copier epice/discord_sortie_config.example.php)\n"; exit; }
$CFG = require $CFG_PATH;

if (empty($CFG['bot_token']) || strpos($CFG['bot_token'], 'COLLE_TON') !== false) {
    echo "bot_token non renseigné dans epice/discord_sortie_config.php\n"; exit;
}
if (!function_exists('curl_init')) { echo "extension cURL absente\n"; exit; }

// Définition : /commande creer categorie:<choix>
$commands = [[
    'name'        => 'commande',
    'description' => 'Gérer les demandes de fabrication de la guilde',
    'type'        => 1,
    'options'     => [[
        'type'        => 1, // SUB_COMMAND
        'name'        => 'creer',
        'description' => 'Créer une nouvelle demande de fabrication (formulaire)',
        'options'     => [[
            'type'        => 3, // STRING
            'name'        => 'categorie',
            'description' => "Catégorie de l'objet à fabriquer",
            'required'    => true,
            'choices'     => [
                ['name' => 'Armes',        'value' => 'armes'],
                ['name' => 'Armures',      'value' => 'armures'],
                ['name' => 'Outils',       'value' => 'outils'],
                ['name' => 'Véhicules',    'value' => 'vehicules'],
                ['name' => 'Consommables', 'value' => 'consommables'],
                ['name' => 'Modules',      'value' => 'modules'],
                ['name' => 'Autre',        'value' => 'autre'],
            ],
        ]],
    ]],
]];

// NB : on POST juste /commande (PUT écraserait aussi /sortie déjà enregistrée).
// L'endpoint POST /applications/{id}/[guilds/{g}/]commands crée OU met à jour
// UNIQUEMENT la commande dont le nom est fourni, sans toucher aux autres.
$appId = $CFG['app_id'];
$guild = trim($CFG['guild_id'] ?? '');
$url = $guild !== ''
    ? "https://discord.com/api/v10/applications/{$appId}/guilds/{$guild}/commands"
    : "https://discord.com/api/v10/applications/{$appId}/commands";

echo ($guild !== '' ? "Cible : serveur {$guild} (instantané)\n" : "Cible : GLOBALE (~1h de propagation)\n");
echo "URL   : {$url}\n\n";

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($commands[0], JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bot ' . $CFG['bot_token'],
        'Content-Type: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($resp === false) { echo "Échec cURL : {$err}\n"; exit; }
echo "HTTP {$code}\n\n";
if ($code >= 200 && $code < 300) {
    echo "✔ Commande /commande enregistrée.\n";
    echo "Dans Discord, tape /commande creer pour ouvrir le formulaire.\n";
} else {
    echo "✘ Échec :\n" . $resp . "\n";
    echo "\n(401 = bot_token invalide ; 403 = bot pas invité sur le serveur ; 404 = app_id/guild_id erroné)\n";
}
