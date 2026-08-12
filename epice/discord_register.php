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

// Définition de la commande : /sortie creer + /sortie panneau
//
//  `creer` n'a AUCUNE option : `/sortie creer` + Entrée ouvre directement le
//  sélecteur (catégories → activités → formulaire).
//
//  Historique, pour ne pas refaire le trajet à l'envers :
//   1. `choices` statiques — plafonnent à 25 entrées ET n'offrent aucun filtrage ;
//      le catalogue d'activités devenait illisible bien avant ce plafond.
//   2. option `type` en AUTOCOMPLÉTION — filtrage à la frappe, catalogue illimité,
//      mais Discord NE RELANCE PAS l'autocomplétion après un clic sur une suggestion
//      (vérifié en test) : choisir une catégorie remplissait le champ sans rien
//      dérouler, et il fallait une seconde Entrée. Un menu qui ne mène nulle part.
//   3. plus d'option du tout — un seul chemin, aucun cul-de-sac. Le sélecteur en
//      Components V2 fait tout le travail, et il n'a lui aucune limite de 25.
//
//  ⚠ Retirer une option EST un changement de définition de commande : re-lancer
//  ce script est obligatoire, sinon les clients continuent d'afficher le champ.
$commands = [[
    'name'        => 'sortie',
    'description' => 'Gérer les sorties de la guilde',
    'type'        => 1,
    'options'     => [
        [
            'type'        => 1, // SUB_COMMAND
            'name'        => 'creer',
            'description' => 'Créer une nouvelle sortie (formulaire)',
        ],
        [
            'type'        => 1, // SUB_COMMAND
            'name'        => 'panneau',
            'description' => 'Poster le panneau de création à épingler (staff)',
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

// POST, surtout PAS PUT. `PUT /commands` REMPLACE l'ensemble des commandes de
// l'application : ce script ne déclarant que `/sortie`, chaque exécution effaçait
// silencieusement `/commande` (enregistrée par `discord_register_commande.php`,
// qui prend déjà cette précaution). C'est arrivé — la commande a disparu du serveur
// après une simple mise à jour du libellé d'un type de sortie.
// POST crée OU met à jour UNIQUEMENT la commande nommée, sans toucher aux autres.
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
    echo "✔ Commande /sortie enregistrée.\n";
    echo "  /sortie creer     → sélecteur : catégorie, puis activité, puis formulaire\n";
    echo "  /sortie panneau   → panneau public à épingler dans le canal (staff)\n";
} else {
    echo "✘ Échec :\n" . $resp . "\n";
    echo "\n(401 = bot_token invalide ; 403 = bot pas invité sur le serveur ; 404 = app_id/guild_id erroné)\n";
}
