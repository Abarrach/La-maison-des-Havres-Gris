<?php
// ============================================================
//  ENREGISTREMENT de la commande /sortie auprès de Discord
//
//  À lancer UNE FOIS (puis à chaque modification de la commande),
//  depuis le navigateur sur le serveur :
//      https://.../epice/discord_register.php
//  ou en ligne de commande :  php discord_register.php
//
//  - guild_id renseigné  → commande de SERVEUR (apparaît instantanément,
//                          idéal pour tester).
//  - guild_id vide       → commande GLOBALE (propagation jusqu'à ~1h).
//
//  ⚠ Nécessite le bot_token (secret) dans discord_sortie_config.php.
//  ⚠ À SUPPRIMER / protéger une fois la commande enregistrée.
// ============================================================

header('Content-Type: text/plain; charset=utf-8');

$CFG_PATH = __DIR__ . '/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { echo "config absente (copier discord_sortie_config.example.php)\n"; exit; }
$CFG = require $CFG_PATH;

if (empty($CFG['bot_token']) || strpos($CFG['bot_token'], 'COLLE_TON') !== false) {
    echo "bot_token non renseigné dans discord_sortie_config.php\n"; exit;
}
if (!function_exists('curl_init')) { echo "extension cURL absente\n"; exit; }

// Définition de la commande : /sortie creer
$commands = [[
    'name'        => 'sortie',
    'description' => 'Gérer les sorties de la guilde',
    'type'        => 1,
    'options'     => [[
        'type'        => 1, // SUB_COMMAND
        'name'        => 'creer',
        'description' => 'Créer une nouvelle sortie (formulaire)',
        'options'     => [[
            'type'        => 3, // STRING
            'name'        => 'type',
            'description' => 'Type de sortie',
            'required'    => true,
            'choices'     => [
                ['name' => 'Épice (liée au site)', 'value' => 'epice'],
                ['name' => 'Labo',                 'value' => 'labo'],
                ['name' => 'Farm divers',          'value' => 'farm'],
                ['name' => 'Landsraad',            'value' => 'landsraad'],
            ],
        ]],
    ]],
]];

$appId = $CFG['app_id'];
$guild = trim($CFG['guild_id'] ?? '');
$url = $guild !== ''
    ? "https://discord.com/api/v10/applications/{$appId}/guilds/{$guild}/commands"
    : "https://discord.com/api/v10/applications/{$appId}/commands";

echo ($guild !== '' ? "Cible : serveur {$guild} (instantané)\n" : "Cible : GLOBALE (~1h de propagation)\n");
echo "URL   : {$url}\n\n";

// PUT = remplace l'ensemble des commandes (idempotent)
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => 'PUT',
    CURLOPT_POSTFIELDS     => json_encode($commands, JSON_UNESCAPED_UNICODE),
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
    echo "✔ Commande /sortie enregistrée.\n";
    echo "Dans Discord, tape /sortie creer pour ouvrir le formulaire.\n";
} else {
    echo "✘ Échec :\n" . $resp . "\n";
    echo "\n(401 = bot_token invalide ; 403 = bot pas invité sur le serveur ; 404 = app_id/guild_id erroné)\n";
}
