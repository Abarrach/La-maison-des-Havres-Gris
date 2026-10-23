<?php
// Tests des fonctions pures de discord_objet.php (fiches objets sur Discord).
// Usage : php tools/test_discord_objet.php        → « OK (n) » ou la liste des échecs.
// Les données sont les vraies (stuff_data.json) : si un snapshot renomme un objet,
// le test le dira avant Discord.

define('DO_TESTS', true);
require __DIR__ . '/../discord_objet.php';

$data  = do_charger();
$items = $data['items'];
$ko = []; $n = 0;
$egal = function ($nom, $attendu, $obtenu) use (&$ko, &$n) {
    $n++;
    if ($attendu !== $obtenu) $ko[] = "✘ {$nom}\n   attendu : " . json_encode($attendu, JSON_UNESCAPED_UNICODE)
        . "\n   obtenu  : " . json_encode($obtenu, JSON_UNESCAPED_UNICODE);
};

// ---- Repérage dans un texte ---------------------------------------------------
$egal('message réel (MK6 collé, minuscules)', ['bodyfluidextractor_unique_poison_06'],
    do_trouver("Pour l'extraction du sang je prend Extracteur impur MK6, il y a mieux ?", $items));
$egal('nom sans version → la plus haute', ['bodyfluidextractor_unique_poison_06'],
    do_trouver('ton extracteur impur est nul', $items));
$egal('nom complet prioritaire sur le nom sans version', ['bodyfluidextractor_2h_tier6'],
    do_trouver('Extracteur de sang Mk 6', $items));
$egal('accents et apostrophes ignorés', ['bodyfluidextractor_unique_water_05'],
    do_trouver("l'EXTRACTEUR A FILTRE mk5 !", $items));
$egal('deux objets, dans l’ordre du texte', ['heavypistol_unique_headshot_06', 'bodyfluidextractor_unique_poison_06'],
    do_trouver('Point final ou Extracteur impur Mk 6 ?', $items));
$egal('rien à trouver', [], do_trouver('salut tout le monde, raid ce soir ?', $items));
$egal('mot isolé : pas de correspondance dans un mot plus long', [], do_trouver('pointfinal', $items));
$egal('doublon de nom → tier le plus haut', ['combat_light_unique_scanning_helmet_06'],
    do_trouver("Casque d'analyse renforcée", $items));
$egal('même objet cité deux fois → une fiche', ['bodyfluidextractor_unique_poison_06'],
    do_trouver('Extracteur impur Mk 6, oui, Extracteur impur Mk6', $items));

// ---- Rapprochement (noms abrégés ou mal tapés) — vrais messages du salon ----------
$approche = function ($texte) use ($items) { $ids = do_trouver($texte, $items, $ap); return [$ids, $ap]; };
$egal('« ceinture elohim » (message réel du 21/10)',
    [['uniquesuspensorbelt_t6'], ['uniquesuspensorbelt_t6' => 'ceinture elohim']],
    (function () use ($approche, $items) {
        // l'id exact de la ceinture n'est pas connu d'avance : on le lit par son nom
        foreach ($items as $it) if ($it['name'] === 'Ceinture à suspenseur de classe Elohim') $id = $it['id'];
        [$ids, $ap] = $approche('Alanon, premier run, ceinture elohim 😄');
        return [str_replace($id, 'uniquesuspensorbelt_t6', $ids), array_combine(str_replace($id, 'uniquesuspensorbelt_t6', array_keys($ap)), $ap)];
    })());
$nomDe = function ($ids) use ($items) { return array_map(function ($id) use ($items) { return str_replace("\u{a0}", " ", do_par_id($items, $id)["name"]); }, $ids); }; // les noms du jeu ont une espace insécable avant le chiffre Mk
$egal('faute de frappe (« elohm »)', ['Ceinture à suspenseur de classe Elohim'], $nomDe(do_trouver('une ceinture elohm hier', $items)));
$egal('mots manquants et fautes', ["Casque d'analyse renforcée"], $nomDe(do_trouver("le casque d'analise renforcé", $items)));
$egal('trois mots courants, un seul objet', ['Pistolet disrupteur de Regis'], $nomDe(do_trouver('pistolet disrupteur regis', $items)));
$egal('Mk tapé après un nom approché', ['Extracteur impur Mk 5'], $nomDe(do_trouver('extracteur impure mk5', $items)));
$egal('début de mot + Mk qui écarte la variante « tactique »', ['Combinaison antiradiations Mk 5'], $nomDe(do_trouver('la combi antiradiation mk5', $items)));
$egal('pluriels (message réel)', ['Énorme poche de sang'], $nomDe(do_trouver("donc au final les enormes poches de sang ne font rien perdre", $items)));
$egal('ambigu : plusieurs casques lourds différents → rien', [], do_trouver("le casque lourd c'est mieux", $items));
$egal('ambigu : plusieurs vestes à suspenseur → rien', [], do_trouver('veste suspenseur', $items));
$egal('un mot rare seul ne suffit pas (« au final »)', [], do_trouver("au final c'est mieux", $items));
$egal('message sans objet (réel)', [], do_trouver('Merci à vous pour les beaux moments IG et vocal que vous partagez', $items));
$egal('message sans objet (réel, 2)', [], do_trouver('Envoyez nous un peu de chance 🍀', $items));
$egal('nom exact : pas de mention « rapproché »', [], (function () use ($approche) { return $approche('Extracteur impur Mk 6')[1]; })());
$egal('autocomplétion avec faute', 'Ceinture à suspenseur de classe Elohim', do_par_id($items, do_suggestions('elohm', $items)[0]['value'] ?? '')['name'] ?? null);

// ---- Mot seul dans un message court ------------------------------------------------
$egal('« Elohim » seul (message réel du 23/10)', ['Ceinture à suspenseur de classe Elohim'], $nomDe(do_trouver('Elohim', $items)));
$egal('mot seul dans une question courte', ['Ceinture à suspenseur de classe Elohim'], $nomDe(do_trouver("c'est quoi l'Elohim ?", $items)));
$egal('mot seul avec faute', ['Ceinture à suspenseur de classe Elohim'], $nomDe(do_trouver('elohm', $items)));
$egal('mot seul + Mk tapé', ["Ailes de l'Empereur Mk 3"], $nomDe(do_trouver("l'empereur mk3", $items)));
$egal('deux noms propres', ['Morsure de Shishakli', 'Ceinture à suspenseur de classe Elohim'], $nomDe(do_trouver('Shishakli ou Elohim ?', $items)));
$egal('mot seul : la fiche le signale', ['elohim'], array_values((function () use ($items) { do_trouver('Elohim', $items, $ap); return $ap; })()));
$egal('message court mais mot en minuscule dans le nom (« au final »)', [], do_trouver("au final c'est mieux", $items));
$egal('vraie phrase : un mot courant ne déclenche rien', [], do_trouver('on va dans le désert profond ce soir', $items));
$egal('nom propre de plusieurs objets (set) → rien', [], do_trouver('Mendia', $items));
$egal('mot isolé ignoré si le message cite déjà un objet', ['Point final'], $nomDe(do_trouver('Point final et Elohim', $items)));

// ---- Valeurs affichées --------------------------------------------------------
$egal('pourcentage', '75 %', do_valeur(['v' => 75, 'f' => '{v:0}%', 't' => 'number']));
$egal('flottant arrondi', '60 %', do_valeur(['v' => 60.000004, 'f' => '{v:0}%', 't' => 'number']));
$egal('décimale optionnelle', '2,8s', do_valeur(['v' => 2.8, 'f' => '{v:0.#}s', 't' => 'number']));
$egal('décimale optionnelle inutile', '3s', do_valeur(['v' => 3.0, 'f' => '{v:0.#}s', 't' => 'number']));
$egal('signé positif', '+8 %', do_valeur(['v' => 8, 'f' => '{v:+0.#;-0.#}%', 't' => 'number']));
$egal('signé négatif', '-6 %', do_valeur(['v' => -6, 'f' => '{v:+0.#;-0.#}%', 't' => 'number']));
$egal('P0', '90 %', do_valeur(['v' => 0.9, 'f' => '{v:P0}', 't' => 'number']));
$egal('durée', '1 h 30', do_valeur(['v' => 5400, 't' => 'duration']));
$egal('texte', 'Extrême (800)', do_valeur(['v' => 'Extrême (800)', 't' => 'string']));
$egal('libellé nettoyé', 'Valeur d\'armure', do_libelle(['k' => 'armorValue', 'n' => "Valeur d'armure :"]));
$egal('libellé traduit', 'DPS effectif', do_libelle(['k' => 'effectiveDps', 'n' => 'Effective DPS']));
$egal('initiale accentuée', 'énergie', do_minuscule_initiale('Énergie'));
$egal('sigle conservé', 'DPS effectif', do_minuscule_initiale('DPS effectif'));

// ---- Classement --------------------------------------------------------------
$c = do_classement(do_par_id($items, 'bodyfluidextractor_unique_poison_06'), $items);
$egal('extracteur impur Mk 6 : 1er sur 10', [1, 10, 'bloodExtractionEfficiency'], [$c['rang'], $c['total'], $c['stat']['k']]);
$c = do_classement(do_par_id($items, 'bodyfluidextractor_02'), $items);
$egal('Mk 2 : 9e sur 10', [9, 10], [$c['rang'], $c['total']]);
$egal('un augment n\'a pas de classement', null, do_classement(do_par_id($items, 't6_augment_lasgun1'), $items));
$pist = do_classement(do_par_id($items, 'heavypistol_unique_headshot_06'), $items);
$egal('un pistolet se compare aux pistolets', true,
    count(array_filter($pist['liste'], function ($p) { return $p['it']['cat'] !== 'weapons/sidearms/pistol'; })) === 0);

// ---- Fiches : limites Discord ----------------------------------------------------
$tous = array_slice(array_column(array_filter($items, function ($i) { return ($i['group'] ?? '') === 'weapons'; }), 'id'), 0, 10);
$f = do_fiches($tous, $data, 'https://exemple');
$egal('10 armes : 10 fiches sous 6000 caractères', [10, true], [count($f), do_taille($f) <= 6000]);
$f = $f2 = do_fiches(['bodyfluidextractor_unique_poison_06'], $data, 'https://exemple');
$egal('fiche : versions Mk présentes', true, strpos($f[0]['description'], 'Versions : Mk 5 (60 %) · **Mk 6 (75 %)**') !== false);
$egal('fiche : pas de lien optimiseur pour un outil', false, strpos($f[0]['description'], 'optimiseur') !== false);
$f = do_fiches(['heavypistol_unique_headshot_06'], $data, 'https://exemple');
$egal('fiche : lien optimiseur pour une arme', true, strpos($f[0]['description'], 'https://exemple/optimiseur.html#objet=heavypistol_unique_headshot_06') !== false);
$egal('autocomplétion : mots dans le désordre', 'bodyfluidextractor_unique_poison_06', do_suggestions('impur extr', $items)[0]['value'] ?? null);
$egal('autocomplétion : 25 au plus', true, count(do_suggestions('', $items)) === 25);
$egal('icône : un seul /images', 'https://cdn-hosted.gaming.tools/dune/images/dune/gui/textures/icons/gameplay/tools/t_ui_icontoolbodyfluidextractor_unique_poison_06r_d.webp', $f2[0]['thumbnail']['url'] ?? null);
$egal('ceinture : pas de classement (fonctions différentes)', null, do_classement(do_par_id($items, 'fullsuspensorbelt_unique_durability'), $items));
// ---- Où le trouver -----------------------------------------------------------------
$dataDD = $data;
$dataDD['_dd'] = dd_plans_semaine(['sites' => [   // relevé factice, au format de dd_cartes/releve.json
    ['type' => 'shipwreck', 'cell' => 'A2', 'name' => '', 'uniques' => [['nom' => 'Extracteur impur Mk 6', 'pid' => '', 'p' => 0.006, 'pp' => 0.11]]],
    ['type' => 'ecolab', 'cell' => 'E8', 'name' => '', 'uniques' => [['nom' => 'Extracteur impur Mk 6', 'pid' => '', 'p' => 0.031]]],
]]);
$lx = do_lieux(do_par_id($items, 'bodyfluidextractor_unique_poison_06'), $dataDD, false);
$egal('Deep Desert de la semaine : un site + renvoi vers /carte plan', true,
    count($lx) === 1 && strpos($lx[0], 'Deep Desert cette semaine') !== false && strpos($lx[0], '(+1 autre site, `/carte plan`)') !== false);
$egal('sans relevé publié : rien sur le Deep Desert', [], do_lieux(do_par_id($items, 'bodyfluidextractor_unique_poison_06'), $data, false));
$lx = do_lieux(do_par_id($items, 'heavypistol_unique_headshot_06'), $data, false);
$egal('lieu nommé avec sa chance', ['📍 **Lieux nommés** : Station expérimentale (Poison) 15,1 % — *chance par coffre ultra-rare*'], $lx);
$mendia = null; foreach ($items as $it) if ($it['name'] === 'Bottes de Mendia') $mendia = $it;
$lx = do_lieux($mendia, $data, false);
$egal('coffres de schémas : types de lieux, sans chance', true, count($lx) === 1 && strpos($lx[0], 'sans chance connue') !== false && strpos($lx[0], '%') === false);
$egal('fiche compacte : pas de coffres de schémas', [], do_lieux($mendia, $data, true));
$egal('objet fabriqué : rien', [], do_lieux(do_par_id($items, 'powerpack4'), $data, false));
$avecLieux = array_slice(array_column(array_filter($items, function ($i) use ($dataDD) { return do_lieux($i, $dataDD, true); }), 'id'), 0, 10);
$f = do_fiches($avecLieux, $dataDD, 'https://exemple');
$egal('10 fiches avec lieux : sous 6000 caractères', [10, true], [count($f), do_taille($f) <= 6000]);
$egal('coupe en caractères', 'éé…', do_couper('ééééé', 3));

echo $ko ? implode("\n", $ko) . "\n\n" . count($ko) . " échec(s) sur {$n}\n" : "OK ({$n})\n";
exit($ko ? 1 : 0);
