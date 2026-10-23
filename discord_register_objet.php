<?php
// ============================================================
//  Enregistre les fiches objets auprès de Discord (cf. discord_objet.php) :
//    - le clic droit « Fiches objets » (commande de MESSAGE, type 3) ;
//    - la commande /objet nom:<autocomplétion> (type 1).
//  À lancer UNE FOIS via le navigateur, puis à chaque modification de ces commandes.
//
//  ⚠ POST, surtout PAS PUT. `PUT /applications/{id}/commands` REMPLACE l'ensemble
//  des commandes de l'application : ce script n'en déclarant que deux, un PUT effacerait
//  `/sortie`, `/commande`, `/plan` et `/carte`. POST crée OU met à jour uniquement la
//  commande nommée.
// ============================================================

header('Content-Type: text/plain; charset=utf-8');

$CFG_PATH = __DIR__ . '/epice/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { echo "config absente : {$CFG_PATH}\n"; exit; }
$CFG = require $CFG_PATH;
if (empty($CFG['bot_token']) || $CFG['bot_token'] === 'COLLE_TON_BOT_TOKEN_ICI') {
    echo "bot_token non renseigné dans discord_sortie_config.php\n"; exit;
}
if (!function_exists('curl_init')) { echo "extension cURL absente\n"; exit; }

$commands = [
    // Commande de message : pas de description (Discord la refuse), le nom s'affiche tel
    // quel dans le menu Applications, majuscule et espace compris.
    ['type' => 3, 'name' => 'Fiches objets'],
    [
        'type'        => 1,
        'name'        => 'objet',
        'description' => "Fiche d'une arme, d'une armure ou d'un outil (stats, classement, versions)",
        'options'     => [[
            'type'         => 3, // STRING
            'name'         => 'nom',
            'description'  => "Commence à taper le nom de l'objet",
            'required'     => true,
            'autocomplete' => true,
        ]],
    ],
];

$appId = $CFG['app_id'];
$guild = trim($CFG['guild_id'] ?? '');
$url = $guild !== ''
    ? "https://discord.com/api/v10/applications/{$appId}/guilds/{$guild}/commands"
    : "https://discord.com/api/v10/applications/{$appId}/commands";

echo ($guild !== '' ? "Cible : serveur {$guild} (instantané)\n" : "Cible : GLOBALE (~1h de propagation)\n");
echo "URL   : {$url}\n\n";

foreach ($commands as $cmd) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($cmd, JSON_UNESCAPED_UNICODE),
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

    $nom = $cmd['type'] === 3 ? "clic droit « {$cmd['name']} »" : "/{$cmd['name']}";
    if ($resp === false) { echo "✘ {$nom} : échec cURL : {$err}\n"; continue; }
    if ($code >= 200 && $code < 300) {
        echo "✔ {$nom} enregistré (HTTP {$code}).\n";
    } else {
        echo "✘ {$nom} : HTTP {$code}\n{$resp}\n";
        echo "(401 = bot_token invalide ; 403 = bot pas invité ; 404 = app_id/guild_id erroné)\n";
    }
}
echo "\nDans Discord : clic droit sur un message → Applications → Fiches objets ; ou /objet nom:…\n";
echo "(Discord peut demander de relancer l'application, Ctrl+R, pour voir les nouvelles commandes.)\n";
