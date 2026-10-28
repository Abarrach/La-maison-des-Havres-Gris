<?php
// ============================================================
//  Enregistre la commande /aide auprès de Discord.
//  À lancer UNE FOIS via le navigateur, puis à chaque modification de la commande.
//
//  ⚠ POST, surtout PAS PUT. `PUT /applications/{id}/commands` REMPLACE l'ensemble
//  des commandes de l'application : ce script ne déclarant que `/aide`, un PUT
//  effacerait `/sortie`, `/commande`, `/plan`, `/carte`, `/objet` ET `/decret`. C'est déjà arrivé —
//  `/commande` a disparu du serveur après un simple réenregistrement de `/sortie`.
//  POST crée OU met à jour uniquement la commande nommée.
// ============================================================

header('Content-Type: text/plain; charset=utf-8');

$CFG_PATH = __DIR__ . '/epice/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { echo "config absente : {$CFG_PATH}\n"; exit; }
$CFG = require $CFG_PATH;
if (empty($CFG['bot_token']) || $CFG['bot_token'] === 'COLLE_TON_BOT_TOKEN_ICI') {
    echo "bot_token non renseigné dans discord_sortie_config.php\n"; exit;
}
if (!function_exists('curl_init')) { echo "extension cURL absente\n"; exit; }

// Aucune option : l'aide lit elle-même chez Discord les commandes enregistrées.
$commands = [[
    'name'        => 'aide',
    'description' => 'Tout ce que sait faire le bot de la guilde, commandes cliquables',
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
    echo "✔ Commande /aide enregistrée.\n";
    echo "Dans Discord : /aide. La liste se met à jour seule (cache d'une heure).\n";
} else {
    echo "✘ Échec :\n" . $resp . "\n";
    echo "\n(401 = bot_token invalide ; 403 = bot pas invité ; 404 = app_id/guild_id erroné)\n";
}
