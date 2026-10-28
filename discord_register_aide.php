<?php
// ============================================================
//  Enregistre /aide et le clic droit « Aide du bot » auprès de Discord.
//  À lancer UNE FOIS via le navigateur, puis à chaque modification de la commande.
//
//  ⚠ POST, surtout PAS PUT. `PUT /applications/{id}/commands` REMPLACE l'ensemble
//  des commandes de l'application : ce script ne déclarant que `/aide` et « Aide du bot », un PUT
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

// /aide n'a aucune option : l'aide lit elle-même chez Discord les commandes enregistrées.
// « Aide du bot » = commande de MEMBRE (type 2) : clic droit sur un membre → Applications.
// Discord ne sait pas la limiter au profil du bot : elle apparaît sur tous les membres,
// et répond la même aide quel que soit le membre visé.
$commands = [
    [
        'type'        => 1,
        'name'        => 'aide',
        'description' => 'Tout ce que sait faire le bot de la guilde, commandes cliquables',
    ],
    // Pas de description pour une commande de membre (Discord la refuse).
    ['type' => 2, 'name' => 'Aide du bot'],
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

    $nom = $cmd['type'] === 1 ? "/{$cmd['name']}" : "clic droit « {$cmd['name']} »";
    if ($resp === false) { echo "✘ {$nom} : échec cURL : {$err}\n"; continue; }
    if ($code >= 200 && $code < 300) {
        echo "✔ {$nom} enregistré (HTTP {$code}).\n";
    } else {
        echo "✘ {$nom} : HTTP {$code}\n{$resp}\n";
        echo "(401 = bot_token invalide ; 403 = bot pas invité ; 404 = app_id/guild_id erroné)\n";
    }
}
echo "\nDans Discord : /aide, ou clic droit sur un membre (le bot par exemple) → Applications → Aide du bot.\n";
echo "(Discord peut demander de relancer l'application, Ctrl+R, pour voir les nouvelles commandes.)\n";
