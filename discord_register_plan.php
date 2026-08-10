<?php
// ============================================================
//  Enregistre la commande /plan auprès de Discord.
//  À lancer UNE FOIS via le navigateur, puis à chaque modification de la commande.
//
//  ⚠ POST, surtout PAS PUT. `PUT /applications/{id}/commands` REMPLACE l'ensemble
//  des commandes de l'application : ce script ne déclarant que `/plan`, un PUT
//  effacerait `/sortie` ET `/commande`. C'est déjà arrivé — `/commande` a disparu
//  du serveur après un simple réenregistrement de `/sortie`. POST crée OU met à
//  jour uniquement la commande nommée.
// ============================================================

header('Content-Type: text/plain; charset=utf-8');

$CFG_PATH = __DIR__ . '/epice/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { echo "config absente : {$CFG_PATH}\n"; exit; }
$CFG = require $CFG_PATH;
if (empty($CFG['bot_token']) || $CFG['bot_token'] === 'COLLE_TON_BOT_TOKEN_ICI') {
    echo "bot_token non renseigné dans discord_sortie_config.php\n"; exit;
}
if (!function_exists('curl_init')) { echo "extension cURL absente\n"; exit; }

// L'option `nom` est en AUTOCOMPLÉTION : impossible de lister 350 plans en `choices`
// (Discord en accepte 25 au maximum, et une liste figée vieillirait à chaque patch).
// `autocomplete` et `choices` sont mutuellement exclusifs.
$commands = [[
    'name'        => 'plan',
    'description' => 'Registre des plans uniques de la guilde',
    'options'     => [
        [
            'type'        => 1, // SUB_COMMAND
            'name'        => 'qui-a',
            'description' => 'Qui peut crafter ce plan, à quel rang, avec combien de charges',
            'options'     => [[
                'type'         => 3, // STRING
                'name'         => 'nom',
                'description'  => 'Commence à taper le nom du plan',
                'required'     => true,
                'autocomplete' => true,
            ]],
        ],
        [
            'type'        => 1, // SUB_COMMAND
            'name'        => 'manque',
            'description' => 'Angles morts : ce que personne n\'a, ce qu\'une seule personne détient',
        ],
    ],
]];

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
    echo "✔ Commande /plan enregistrée.\n";
    echo "Dans Discord : /plan qui-a puis commence à taper un nom, ou /plan manque.\n";
} else {
    echo "✘ Échec :\n" . $resp . "\n";
    echo "\n(401 = bot_token invalide ; 403 = bot pas invité ; 404 = app_id/guild_id erroné)\n";
}
