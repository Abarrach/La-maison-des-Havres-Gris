<?php
// ============================================================
//  JEU D'ESSAI — relevé de présence et partage de la récolte
// ============================================================
// Ajoute une ou deux sorties de test à data/debriefs.json, SANS toucher au reste.
// Le fichier contient de vrais retours de soirées : on le relit sous verrou et on
// n'écrit que les sorties de test, jamais une copie complète chargée plus tôt.
//
//   php epice/seed_rally_test.php --partage         → sortie terminée, 16 relevés fictifs
//                                                     (pour tester saisie du volume,
//                                                      calcul des parts et post Discord)
//   php epice/seed_rally_test.php --maintenant 5    → sortie OUVERTE, fenêtre maintenant
//                                                     → +5 h, relevé vide (pour que le
//                                                     cron ait une cible ce soir)
//   php epice/seed_rally_test.php --retirer         → efface les deux sorties de test
//
// Options : --canal <id>  pour forcer le salon Discord de publication (par défaut, celui
//                         de la sortie la plus récente qui en a un).
//
// ⚠ À ne PAS laisser traîner sur le serveur de production une fois les essais finis :
//   c'est un injecteur de fausses données.
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI uniquement.\n"); }
date_default_timezone_set('Europe/Paris');

define('DATA_FILE', __DIR__ . '/data/debriefs.json');
const ID_PARTAGE  = 'sortie_test_partage';
const ID_PRESENCE = 'sortie_test_presence';

$args       = $argv ?? [];
$faitPartage = in_array('--partage', $args, true);
$retirer     = in_array('--retirer', $args, true);
$iMaint      = array_search('--maintenant', $args, true);
$heuresMaint = $iMaint !== false ? max(1, (int)($args[$iMaint + 1] ?? 5)) : 0;
$iCanal      = array_search('--canal', $args, true);
$canalForce  = $iCanal !== false ? (string)($args[$iCanal + 1] ?? '') : '';

if (!$faitPartage && !$heuresMaint && !$retirer) {
    fwrite(STDERR, "Rien à faire. Utiliser --partage, --maintenant <heures> ou --retirer.\n");
    exit(1);
}

// ------------------------------------------------------------
//  La tablée fictive
// ------------------------------------------------------------
// Des présences volontairement inégales : quelqu'un qui tient la journée entière,
// deux relèves qui se croisent, et un passage d'une demi-heure — c'est le cas qui
// vérifie que « valoriser même les petites présences » donne bien un résultat non nul.
$TABLEE = [
    ['289122662817726465', 'Abarrach',         'transporteur',     0, 16],  // toute la journée
    ['1075205341500944454','Sarazin',          'moissonneur',      0, 10],
    ['473759936891977737', 'Bahlor',           'pilote_orni',      4, 16],
    ['332476079875031051', 'Lorhelyne✨',       'orni_scout',       0,  8],
    ['351795015787216901', 'LeFouDuLaBo4/Pit', 'pilote_orni_cac',  8, 16],
    ['291123354767982592', 'Karrel',           'transporteur',    10, 16],
    ['185795206036062208', 'EthanQuix_',       'pilote_orni',     15, 16],  // une demi-heure
];

function cle_demi_heure(DateTime $debut, int $i): string {
    $t = (clone $debut)->modify('+' . ($i * 30) . ' minutes');
    return $t->format('Y-m-d\TH:i');
}

function sortie_partage(string $canal, string $guild): array {
    global $TABLEE;
    $tz    = new DateTimeZone('Europe/Paris');
    $jour  = (new DateTime('now', $tz))->format('Y-m-d');
    $debut = new DateTime($jour . ' 08:00', $tz);

    $signups = [];
    $ticks   = [];
    $noms    = [];
    foreach ($TABLEE as [$id, $nom, $poste, $de, $a]) {
        $signups[] = ['id' => $id, 'name' => $nom, 'poste' => $poste, 'statut' => 'present',
                      'ts' => time(), 'creneaux' => range(intdiv($de, 4), max(intdiv($de, 4), intdiv($a - 1, 4)))];
        $noms[$id] = $nom;
        for ($i = $de; $i < $a; $i++) $ticks[cle_demi_heure($debut, $i)][] = $id;
    }
    ksort($ticks);

    return [
        'id' => ID_PARTAGE, 'type' => 'epice', 'date' => $jour, 'heure' => '08:00', 'duree' => '8',
        'titre' => 'TEST — partage de la récolte',
        'zone' => 'Deep Desert', 'statut' => 'ouverte', 'source' => 'test',
        'createur' => 'Abarrach',
        'description' => "Jeu d'essai : les relevés de présence sont fictifs. Saisis un volume, calcule, publie.",
        'discord' => ['user_id' => '289122662817726465', 'channel_id' => $canal, 'guild_id' => $guild],
        'signups' => $signups,
        'debriefs' => [],
        // volume à 0 : c'est précisément la saisie qu'on veut tester.
        'presence' => ['ticks' => $ticks, 'noms' => $noms, 'volume' => 0],
    ];
}

function sortie_maintenant(int $heures, string $canal, string $guild): array {
    $tz = new DateTimeZone('Europe/Paris');
    // On démarre la fenêtre une demi-heure DANS LE PASSÉ : sinon, lancé à 21h02, le
    // premier relevé du cron (21h30) tomberait bien dedans, mais un essai manuel
    // immédiat se ferait répondre « aucune sortie en cours » — et on chercherait
    // l'erreur du mauvais côté.
    $debut = (new DateTime('now', $tz))->modify('-30 minutes');
    return [
        'id' => ID_PRESENCE, 'type' => 'epice',
        'date' => $debut->format('Y-m-d'), 'heure' => $debut->format('H:i'), 'duree' => (string)$heures,
        'titre' => 'TEST — enregistrement des présences',
        'zone' => '', 'statut' => 'ouverte', 'source' => 'test',
        'createur' => 'Abarrach',
        'description' => "Fenêtre ouverte jusqu'à " . (clone $debut)->modify("+{$heures} hours")->format('H:i')
                       . ". Le cron relèvera le salon vocal toutes les 30 minutes.",
        'discord' => ['user_id' => '289122662817726465', 'channel_id' => $canal, 'guild_id' => $guild],
        'signups' => [], 'debriefs' => [],
        'presence' => ['ticks' => [], 'noms' => [], 'volume' => 0],
    ];
}

// ------------------------------------------------------------
//  Écriture sous verrou
// ------------------------------------------------------------
if (!file_exists(DATA_FILE)) { fwrite(STDERR, "Fichier introuvable : " . DATA_FILE . "\n"); exit(1); }
$fp = @fopen(DATA_FILE, 'c+');
if (!$fp) { fwrite(STDERR, "Ouverture impossible (droits ?)\n"); exit(1); }
$ok = false;
for ($n = 0; $n < 30; $n++) { if (flock($fp, LOCK_EX | LOCK_NB)) { $ok = true; break; } usleep(100000); }
if (!$ok) { fclose($fp); fwrite(STDERR, "Verrou indisponible\n"); exit(1); }

rewind($fp);
$d = json_decode(stream_get_contents($fp), true);
if (!is_array($d) || !isset($d['sorties'])) { flock($fp, LOCK_UN); fclose($fp); fwrite(STDERR, "JSON illisible\n"); exit(1); }

// On retire d'abord les éventuelles sorties de test précédentes : relancer le script
// doit remplacer, jamais empiler des doublons.
$avant = count($d['sorties']);
$d['sorties'] = array_values(array_filter($d['sorties'], function ($s) {
    return !in_array($s['id'] ?? '', [ID_PARTAGE, ID_PRESENCE], true);
}));
$retirees = $avant - count($d['sorties']);

if ($retirer) {
    echo "Sorties de test retirées : $retirees\n";
} else {
    // Salon de publication : celui de la sortie la plus récente qui en a un, pour que
    // le post atterrisse là où le bot parle déjà. Sinon --canal.
    $canal = $canalForce;
    $guild = '';
    foreach (array_reverse($d['sorties']) as $s) {
        $c = (string)(($s['discord'] ?? [])['channel_id'] ?? '');
        if ($c !== '') { if ($canal === '') $canal = $c; $guild = (string)(($s['discord'] ?? [])['guild_id'] ?? ''); break; }
    }
    if ($canal === '') {
        flock($fp, LOCK_UN); fclose($fp);
        fwrite(STDERR, "Aucun salon Discord trouvé dans les sorties existantes. Relance avec --canal <id>.\n");
        exit(1);
    }

    if ($faitPartage) {
        $d['sorties'][] = sortie_partage($canal, $guild);
        echo "✅ « TEST — partage de la récolte » ajoutée (16 relevés, 7 joueurs, volume à saisir).\n";
    }
    if ($heuresMaint) {
        $d['sorties'][] = sortie_maintenant($heuresMaint, $canal, $guild);
        echo "✅ « TEST — enregistrement des présences » ajoutée (fenêtre de $heuresMaint h, ouverte maintenant).\n";
    }
    echo "   Salon de publication : $canal\n";
    if ($retirees) echo "   ($retirees sortie(s) de test précédente(s) remplacée(s))\n";
}

ftruncate($fp, 0); rewind($fp);
fwrite($fp, json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);
echo "Fichier écrit.\n";
