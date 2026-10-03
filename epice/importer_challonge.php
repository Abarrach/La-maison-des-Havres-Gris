<?php
// ============================================================
//  importer_challonge.php — reprise des tournois joués sur Challonge
//
//  Usage (sur le serveur, en ligne de commande, une seule fois) :
//      php epice/importer_challonge.php
//
//  Ajoute à epice/data/tournois.json les tournois menés sur Challonge avant
//  l'arrivée de la page Tournois, pour qu'ils figurent dans l'historique et le
//  palmarès. Sans effet sur un tournoi déjà présent (même identifiant) : le
//  relancer ne crée pas de doublon et n'écrase pas une retouche faite depuis.
//
//  Données relevées sur les arbres Challonge, puis passées dans le moteur
//  (tournoi-engine.js) pour produire les résultats dans le format qu'il attend.
//  Ce qui n'était pas affiché n'est PAS inventé : pas de score quand Challonge
//  montrait 0-0, pas de date ni d'organisateur pour le tournoi des nouveaux.
//  Les compléter ensuite depuis la page (✎ Modifier).
// ============================================================
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$TOURNOIS = json_decode(<<<'JSON'
[
 {
  "id": "challonge_veteran",
  "nom": "Veteran",
  "niveau": "expert",
  "format": "double",
  "options": {
   "grandeFinale": "revanche",
   "petiteFinale": false,
   "bestOf": 1
  },
  "date": "2026-10-02",
  "heure": "22:06",
  "description": "",
  "statut": "termine",
  "sortie_id": "",
  "sortie_channel_id": "",
  "joueurs": [
   {
    "id": "ceran1",
    "nom": "Sarazin",
    "discord_id": "",
    "source": "manuel",
    "seed": 1
   },
   {
    "id": "ceran2",
    "nom": "LeFou",
    "discord_id": "",
    "source": "manuel",
    "seed": 2
   },
   {
    "id": "ceran3",
    "nom": "Neuroch",
    "discord_id": "",
    "source": "manuel",
    "seed": 3
   },
   {
    "id": "ceran4",
    "nom": "Bahlor",
    "discord_id": "",
    "source": "manuel",
    "seed": 4
   },
   {
    "id": "ceran5",
    "nom": "Hasashi",
    "discord_id": "",
    "source": "manuel",
    "seed": 5
   },
   {
    "id": "ceran6",
    "nom": "Fenros",
    "discord_id": "",
    "source": "manuel",
    "seed": 6
   },
   {
    "id": "ceran7",
    "nom": "Fenrir",
    "discord_id": "",
    "source": "manuel",
    "seed": 7
   },
   {
    "id": "ceran8",
    "nom": "Lorhelyne",
    "discord_id": "",
    "source": "manuel",
    "seed": 8
   }
  ],
  "resultats": {
   "W1-1": {
    "p1": "ceran1",
    "p2": "ceran8",
    "w": "ceran1",
    "s1": 1,
    "s2": 0,
    "forfait": false
   },
   "W1-2": {
    "p1": "ceran4",
    "p2": "ceran5",
    "w": "ceran4",
    "s1": 1,
    "s2": 0,
    "forfait": false
   },
   "W1-3": {
    "p1": "ceran2",
    "p2": "ceran7",
    "w": "ceran7",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "W1-4": {
    "p1": "ceran3",
    "p2": "ceran6",
    "w": "ceran6",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "W2-1": {
    "p1": "ceran1",
    "p2": "ceran4",
    "w": "ceran4",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "W2-2": {
    "p1": "ceran7",
    "p2": "ceran6",
    "w": "ceran6",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "L1-1": {
    "p1": "ceran8",
    "p2": "ceran5",
    "w": "ceran8",
    "s1": 1,
    "s2": 0,
    "forfait": false
   },
   "L1-2": {
    "p1": "ceran2",
    "p2": "ceran3",
    "w": "ceran3",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "L2-1": {
    "p1": "ceran8",
    "p2": "ceran7",
    "w": "ceran7",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "L2-2": {
    "p1": "ceran3",
    "p2": "ceran1",
    "w": "ceran3",
    "s1": 1,
    "s2": 0,
    "forfait": false
   },
   "L3-1": {
    "p1": "ceran7",
    "p2": "ceran3",
    "w": "ceran3",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "W3-1": {
    "p1": "ceran4",
    "p2": "ceran6",
    "w": "ceran6",
    "s1": 0,
    "s2": 1,
    "forfait": false
   },
   "L4-1": {
    "p1": "ceran3",
    "p2": "ceran4",
    "w": "ceran3",
    "s1": 1,
    "s2": 0,
    "forfait": false
   },
   "GF1": {
    "p1": "ceran6",
    "p2": "ceran3",
    "w": "ceran6",
    "s1": 2,
    "s2": 0,
    "forfait": false
   }
  },
  "podium": [
   {
    "rang": 1,
    "id": "ceran6",
    "nom": "Fenros",
    "v": 4,
    "d": 0
   },
   {
    "rang": 2,
    "id": "ceran3",
    "nom": "Neuroch",
    "v": 4,
    "d": 2
   },
   {
    "rang": 3,
    "id": "ceran4",
    "nom": "Bahlor",
    "v": 2,
    "d": 2
   }
  ],
  "lots": {
   "1": "",
   "2": "",
   "3": ""
  },
  "cree_par": "Bahlor",
  "version": 1,
  "journal": [],
  "publie": {}
 },
 {
  "id": "challonge_nouveaux",
  "nom": "Tournoi des nouveaux",
  "niveau": "debutant",
  "format": "double",
  "options": {
   "grandeFinale": "revanche",
   "petiteFinale": false,
   "bestOf": 1
  },
  "date": "",
  "heure": "",
  "description": "",
  "statut": "termine",
  "sortie_id": "",
  "sortie_channel_id": "",
  "joueurs": [
   {
    "id": "ceaux1",
    "nom": "Shean",
    "discord_id": "",
    "source": "manuel",
    "seed": 1
   },
   {
    "id": "ceaux2",
    "nom": "Haokun",
    "discord_id": "",
    "source": "manuel",
    "seed": 2
   },
   {
    "id": "ceaux3",
    "nom": "Frya",
    "discord_id": "",
    "source": "manuel",
    "seed": 3
   },
   {
    "id": "ceaux4",
    "nom": "Orcote",
    "discord_id": "",
    "source": "manuel",
    "seed": 4
   },
   {
    "id": "ceaux5",
    "nom": "Merlin",
    "discord_id": "",
    "source": "manuel",
    "seed": 5
   },
   {
    "id": "ceaux6",
    "nom": "Militarus",
    "discord_id": "",
    "source": "manuel",
    "seed": 6
   }
  ],
  "resultats": {
   "W1-2": {
    "p1": "ceaux4",
    "p2": "ceaux5",
    "w": "ceaux5",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "W1-4": {
    "p1": "ceaux3",
    "p2": "ceaux6",
    "w": "ceaux6",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "W2-1": {
    "p1": "ceaux1",
    "p2": "ceaux5",
    "w": "ceaux1",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "W2-2": {
    "p1": "ceaux2",
    "p2": "ceaux6",
    "w": "ceaux6",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "L2-1": {
    "p1": "ceaux4",
    "p2": "ceaux2",
    "w": "ceaux2",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "L2-2": {
    "p1": "ceaux3",
    "p2": "ceaux5",
    "w": "ceaux3",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "L3-1": {
    "p1": "ceaux2",
    "p2": "ceaux3",
    "w": "ceaux3",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "W3-1": {
    "p1": "ceaux1",
    "p2": "ceaux6",
    "w": "ceaux1",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "L4-1": {
    "p1": "ceaux3",
    "p2": "ceaux6",
    "w": "ceaux3",
    "s1": null,
    "s2": null,
    "forfait": false
   },
   "GF1": {
    "p1": "ceaux1",
    "p2": "ceaux3",
    "w": "ceaux1",
    "s1": null,
    "s2": null,
    "forfait": false
   }
  },
  "podium": [
   {
    "rang": 1,
    "id": "ceaux1",
    "nom": "Shean",
    "v": 3,
    "d": 0
   },
   {
    "rang": 2,
    "id": "ceaux3",
    "nom": "Frya",
    "v": 3,
    "d": 2
   },
   {
    "rang": 3,
    "id": "ceaux6",
    "nom": "Militarus",
    "v": 2,
    "d": 2
   }
  ],
  "lots": {
   "1": "",
   "2": "",
   "3": ""
  },
  "cree_par": "",
  "version": 1,
  "journal": [],
  "publie": {}
 }
]
JSON, true);

$f = __DIR__ . '/data/tournois.json';
if (!is_dir(dirname($f))) mkdir(dirname($f), 0775, true);
$fp = fopen($f, 'c+');
if (!$fp || !flock($fp, LOCK_EX)) { fwrite(STDERR, "Impossible d'ouvrir ou de verrouiller $f\n"); exit(1); }
$d = json_decode((string)stream_get_contents($fp), true);
if (!is_array($d) || !isset($d['tournois'])) $d = ['tournois' => []];

$deja = array_column($d['tournois'], 'id');
$ajout = 0;
foreach ($TOURNOIS as $t) {
    if (in_array($t['id'], $deja, true)) { echo "déjà présent : {$t['nom']}\n"; continue; }
    $t['cree_le'] = $t['termine_le'] = date('c');
    $t['journal'][] = ['ts' => date('c'), 'par' => 'import', 'texte' => 'Repris de Challonge (tournoi joué avant la page Tournois)'];
    $d['tournois'][] = $t;
    $ajout++;
    echo "ajouté : {$t['nom']} — " . implode(', ', array_column($t['podium'], 'nom')) . "\n";
}
if ($ajout) {
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
}
flock($fp, LOCK_UN); fclose($fp);
// Lancé par « dune », le fichier naîtrait en 644 : la page (www-data) ne pourrait
// plus y écrire. Le groupe www-data vient du setgid du dossier (cf. AGENTS.md §0.6).
@chmod($f, 0664);
echo "$ajout tournoi(s) ajouté(s).\n";
