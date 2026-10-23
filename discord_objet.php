<?php
// ============================================================
//  FICHES OBJETS SUR DISCORD — l'équivalent des infobulles wowhead des forums
//
//  Clic droit sur un message → Applications → « Fiches objets » : le bot repère les
//  noms d'armes, d'armures et d'outils cités dans le texte et répond par une fiche
//  par objet (10 au plus) : stats, classement dans SA catégorie, versions Mk, liens
//  gaming.tools et optimiseur.
//  /objet nom:<autocomplétion>  : la même fiche, en tapant le nom.
//
//  Réponses PRIVÉES (éphémères) avec un bouton « Publier dans le salon » : une fiche
//  se consulte d'abord pour soi, et le salon ne se remplit pas de fiches à chaque
//  discussion de stuff. Discord n'exécutant aucun script dans les messages, une vraie
//  infobulle au survol est impossible ; réagir tout seul à chaque message demanderait
//  un bot connecté en permanence avec le droit de lire tout le serveur.
//
//  Données : stuff_data.json (instantané gaming.tools, armes et capacités recoupées
//  avec les fichiers du jeu, cf. tools/build_stuff_snapshot.js). Rien n'est inventé :
//  un objet sans stat comparable n'a pas de classement.
//
//  Classement : on ne compare que le comparable (même `cat` : pistolet contre pistolet,
//  casque léger contre casque léger), sur UNE stat nommée dans la fiche.
//
//  Appelé par le dispatcher racine (discord_interactions.php), qui a déjà vérifié la
//  signature Ed25519. Fonctions pures en tête : tools/test_discord_objet.php les teste.
// ============================================================

const DO_MAX_FICHES    = 10;    // limite Discord : 10 encadrés par message
const DO_MAX_CARACT    = 5800;  // limite Discord : 6000 caractères pour tous les encadrés
const DO_NOM_MIN       = 5;     // « Mamba » oui, mais pas de nom plus court (faux positifs)
const DO_PUB_PREFIXE   = 'objet_pub:';
const DO_NOM_MSG_CMD   = 'Fiches objets';

// Stat de classement, par ordre de priorité : la première que l'objet possède sert.
// [clé, plus grand = meilleur]. Mêmes stats d'armes que l'optimiseur (SLOTS).
const DO_STATS_CLASSEMENT = [
    ['effectiveDps', true], ['dps', true], ['damagePerHit', true],
    ['armorValue', true],
    ['bloodExtractionEfficiency', true], ['fillableCapacity', true], ['dewReapYield', true],
    // Pas de suspensorBeltPowerDrain : une ceinture de vol complet consomme 57/s, une de planage
    // 14/s — ce ne sont pas les mêmes fonctions, et classer sur la conso mettrait en tête celles
    // qui en font le moins. Les ceintures n'ont donc pas de classement.
    ['powerPackPowerPool', true], ['shieldEfficiency', false],
    ['cuttingPoints', true], ['repairSpeed', true], ['scanRange', true],
    ['healthRestored', true], ['waterGeneration', true],
];

// Libellés restés en anglais (ou en clé interne) dans les données gaming.tools.
const DO_LIBELLES = [
    'effectiveDps'                => 'DPS effectif',
    'heavyAttackDamage'           => 'Attaque lourde (bouclier)',
    'heavyAttackDamageUnshielded' => 'Attaque lourde (sans bouclier)',
    'coldProtection'              => 'Protection contre le froid',
    'scanArc'                     => 'Champ visuel',
    'fuelDuration'                => 'Durée de fonctionnement',
    'bloodExtractionEfficiency'   => "Efficacité de l'extraction",
];

const DO_COULEURS = ['Unique' => 0xC9A227, 'Memento' => 0x9B59B6, 'Common' => 0x8C7B65];

/** Minuscules, sans accents, « Mk 6 » / « MK6 » / « mk-6 » ramenés à « mk6 », ponctuation → espace. */
function do_norm(string $s): string {
    $s = strtr($s, ['É' => 'e', 'È' => 'e', 'Ê' => 'e', 'À' => 'a', 'Â' => 'a', 'Î' => 'i', 'Ô' => 'o', 'Ç' => 'c', 'Œ' => 'oe',
                    'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'î' => 'i', 'ï' => 'i',
                    'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'œ' => 'oe', 'æ' => 'ae']);
    $s = strtolower($s);
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    $s = preg_replace('/\bmk ?(\d)\b/', 'mk$1', $s);
    return trim(preg_replace('/ +/', ' ', $s));
}

/** Nom sans son numéro de version : « extracteur impur mk6 » → « extracteur impur ». */
function do_base(string $norm): string {
    return trim(preg_replace('/ mk\d$/', '', $norm));
}

function do_charger(): array {
    static $d = null;
    if ($d === null) {
        $d = json_decode((string)@file_get_contents(__DIR__ . '/stuff_data.json'), true) ?: ['items' => []];
        foreach ($d['items'] as $i => $it) {
            $d['items'][$i]['_n'] = do_norm($it['name'] ?? '');
            $d['items'][$i]['_b'] = do_base($d['items'][$i]['_n']);
        }
    }
    return $d;
}

/** Objet par identifiant. */
function do_par_id(array $items, string $id): ?array {
    foreach ($items as $it) if (($it['id'] ?? '') === $id) return $it;
    return null;
}

// ---- Rapprochement des noms abrégés ou mal tapés ----------------------------------
// Les joueurs écrivent « ceinture elohim » pour « Ceinture à suspenseur de classe Elohim ».
// Règle : au moins DEUX mots du nom, à moins de DO_FENETRE mots l'un de l'autre, et dont la
// combinaison ne désigne qu'UN objet (ou les versions Mk d'un même objet : on prend alors la
// version tapée, sinon la plus haute). Un mot rare seul ne suffit pas : « final » n'existe que
// dans « Point final », et « au final » est une tournure courante. Par mot : une faute de
// frappe tolérée (2 au-delà de 8 lettres, jamais sur la première lettre ni sous 5 lettres),
// ou un début de mot d'au moins 4 lettres (« combi » → « combinaison »).
const DO_MOTS_VIDES   = ['de', 'du', 'des', 'la', 'le', 'les', 'a', 'au', 'aux', 'et', 'en', 'd', 'l',
                         'pour', 'sur', 'avec', 'un', 'une'];
const DO_FENETRE      = 3;

/** Mots significatifs d'un texte normalisé (sans mots vides ni numéro de version). */
function do_mots(string $norm): array {
    return array_values(array_filter(explode(' ', $norm), function ($w) {
        return $w !== '' && !in_array($w, DO_MOTS_VIDES, true) && !preg_match('/^mk\d$/', $w);
    }));
}

/** Même mot, à une faute de frappe près, ou son début (4 lettres au moins). */
function do_proche(string $saisi, string $mot): bool {
    if ($saisi === $mot) return true;
    $n = strlen($saisi);
    if ($n >= 4 && strpos($mot, $saisi) === 0) return true;
    if ($n < 5 || strlen($mot) < 5 || $saisi[0] !== $mot[0]) return false;
    return levenshtein($saisi, $mot) <= ($n >= 8 ? 2 : 1);
}

/**
 * Candidats approchés : [début, fin, id, score, extrait]. `$exclus` = plages déjà prises
 * par un nom exact (on ne rapproche pas ce qui est déjà reconnu).
 */
function do_approcher(string $t, array $items, array $exclus): array {
    $df = []; $motsItem = [];
    foreach ($items as $k => $it) {
        $motsItem[$k] = array_unique(do_mots($it['_b']));
        foreach ($motsItem[$k] as $w) $df[$w][] = $k;
    }
    $nbItems = max(1, count($items));
    $idf = function ($w) use ($df, $nbItems) { return log($nbItems / count($df[$w])); };

    preg_match_all('/[a-z0-9]+/', $t, $m, PREG_OFFSET_CAPTURE);
    $toks = [];   // [mot, début, fin, mots du vocabulaire qu'il peut désigner]
    foreach ($m[0] as [$w, $p]) {
        $libre = true;
        foreach ($exclus as $q) if ($p < $q[1] && $q[0] < $p + strlen($w)) { $libre = false; break; }
        $vise = [];
        if ($libre && strlen($w) >= 4 && !ctype_digit($w) && !in_array($w, DO_MOTS_VIDES, true)) {
            // Un mot qui existe tel quel n'est pas une faute de frappe : « lourd » (13 casques
            // lourds, donc ambigu) ne doit pas glisser vers « lourde » et un casque précis.
            if (isset($df[$w])) $vise = [$w];
            else foreach ($df as $v => $_) if (do_proche($w, $v)) $vise[] = $v;
        }
        $toks[] = [$w, $p, $p + strlen($w), $vise];
    }

    $cands = [];
    foreach ($toks as $i => [, , , $vise]) {
        $meilleur = null;
        $objets = [];
        foreach ($vise as $v) foreach ($df[$v] as $k) $objets[$k] = true;
        foreach (array_keys($objets) as $k) {
            $pris = [];
            foreach ($vise as $v) if (in_array($v, $motsItem[$k], true)) { $pris[$v] = $i; break; }
            for ($j = max(0, $i - DO_FENETRE); $j <= min(count($toks) - 1, $i + DO_FENETRE); $j++) {
                if ($j === $i) continue;
                foreach ($toks[$j][3] as $u) {
                    if (!isset($pris[$u]) && in_array($u, $motsItem[$k], true)) { $pris[$u] = $j; break; }
                }
            }
            if (count($pris) < 2) continue;
            // La COMBINAISON doit désigner un seul objet (ou les versions Mk d'un même objet) :
            // « pistolet disrupteur regis » (3 mots courants, un seul objet) oui ; « casque lourd »
            // ou « veste suspenseur » (plusieurs objets différents) non — on ne devine pas.
            $communs = null;
            foreach (array_keys($pris) as $u) $communs = $communs === null ? $df[$u] : array_intersect($communs, $df[$u]);
            // Numéro de version tapé juste après (« combi antiradiation mk5 ») : il écarte les
            // objets sans cette version (la « tactique ») et départage la famille.
            $jmax = max($pris);
            $mk = isset($toks[$jmax + 1]) && preg_match('/^mk[0-9]$/', $toks[$jmax + 1][0]) ? $toks[$jmax + 1][0] : '';
            $aMk = function ($c) use ($items, $mk) { return substr($items[$c]['_n'], -strlen($mk) - 1) === ' ' . $mk; };
            if ($mk !== '' && array_filter($communs, $aMk)) $communs = array_filter($communs, $aMk);
            if (!in_array($k, $communs)) continue;
            $familles = [];
            foreach ($communs as $c) $familles[$items[$c]['_b']] = true;
            if (count($familles) !== 1) continue;
            $bonMk = $mk !== '' && $aMk($k);
            $score = array_sum(array_map($idf, array_keys($pris)));
            $cle = [$bonMk ? 1 : 0, $score, count($pris) / count($motsItem[$k]), $items[$k]['tier'] ?? 0];
            if ($meilleur === null || $cle > $meilleur['cle']) {
                $deb = $toks[min($pris)][1]; $fin = $toks[$bonMk ? $jmax + 1 : $jmax][2];
                $meilleur = ['cle' => $cle, 'c' => [$deb, $fin, $items[$k]['id'], $score, substr($t, $deb, $fin - $deb)]];
            }
        }
        if ($meilleur) $cands[] = $meilleur['c'];
    }
    return $cands;
}

/**
 * Objets cités dans un texte, dans l'ordre où ils apparaissent.
 * 1) noms complets (« Extracteur impur Mk 6 ») ; 2) noms sans version (« extracteur impur »
 * → la version la plus haute) ; 3) noms abrégés ou mal tapés (do_approcher), notés dans
 * `$approches` [id => extrait reconnu] pour que la fiche le dise. Le plus long l'emporte
 * quand deux noms se chevauchent ; deux objets de même nom (doublons du jeu) → le tier le
 * plus haut.
 */
function do_trouver(string $texte, array $items, ?array &$approches = null): array {
    $approches = [];
    $t = ' ' . do_norm($texte) . ' ';
    $cands = [];   // [début, fin, id, priorité]
    $parNom = []; $parBase = [];
    foreach ($items as $it) {
        if (strlen($it['_n']) < DO_NOM_MIN) continue;
        $n = $it['_n'];
        if (!isset($parNom[$n]) || ($it['tier'] ?? 0) > ($parNom[$n]['tier'] ?? 0)) $parNom[$n] = $it;
        if ($it['_b'] !== $n && strlen($it['_b']) >= DO_NOM_MIN) {
            $b = $it['_b'];
            if (!isset($parBase[$b]) || ($it['tier'] ?? 0) > ($parBase[$b]['tier'] ?? 0)) $parBase[$b] = $it;
        }
    }
    foreach ([[$parNom, 2], [$parBase, 1]] as [$table, $prio]) {
        foreach ($table as $nom => $it) {
            $aiguille = ' ' . $nom . ' ';
            for ($p = strpos($t, $aiguille); $p !== false; $p = strpos($t, $aiguille, $p + 1)) {
                $cands[] = [$p, $p + strlen($aiguille) - 1, $it['id'], $prio];
            }
        }
    }
    // Plus long d'abord (à longueur égale, le nom complet), puis on écarte les chevauchements.
    usort($cands, function ($a, $b) {
        return [($b[1] - $b[0]), $b[3]] <=> [($a[1] - $a[0]), $a[3]];
    });
    $pris = [];
    foreach ($cands as $c) {
        foreach ($pris as $q) if ($c[0] < $q[1] && $q[0] < $c[1]) continue 2;
        $pris[] = $c;
    }
    // Rapprochements : le meilleur score d'abord, sans chevaucher un nom déjà retenu.
    $approx = do_approcher($t, $items, $pris);
    usort($approx, function ($a, $b) { return $b[3] <=> $a[3]; });
    $exacts = array_column($pris, 2);
    foreach ($approx as $c) {
        if (in_array($c[2], $exacts, true)) continue;
        foreach ($pris as $q) if ($c[0] < $q[1] && $q[0] < $c[1]) continue 2;
        $pris[] = $c;
        $approches[$c[2]] = $c[4];
    }
    usort($pris, function ($a, $b) { return $a[0] <=> $b[0]; });
    $ids = [];
    foreach ($pris as $c) if (!in_array($c[2], $ids, true)) $ids[] = $c[2];
    return array_slice($ids, 0, DO_MAX_FICHES);
}

// Sans mbstring (absent du serveur) : longueurs et coupes en CARACTÈRES, pas en octets.
function do_longueur(string $s): int { return (int)preg_match_all('/./us', $s); }
function do_couper(string $s, int $n): string {
    return (do_longueur($s) > $n && preg_match('/^.{0,' . ($n - 1) . '}/us', $s, $m)) ? rtrim($m[0]) . '…' : $s;
}
// « Efficacité de l'extraction » → « efficacité… » ; un sigle (« DPS effectif ») reste tel quel.
function do_minuscule_initiale(string $s): string {
    if (preg_match('/^\p{Lu}\p{Lu}/u', $s)) return $s;
    foreach (['É' => 'é', 'È' => 'è', 'Ê' => 'ê', 'À' => 'à', 'Â' => 'â', 'Î' => 'î', 'Ô' => 'ô'] as $maj => $min) {
        if (strpos($s, $maj) === 0) return $min . substr($s, strlen($maj));
    }
    return lcfirst($s);
}

function do_stat(array $it, string $k): ?array {
    foreach ($it['stats'] ?? [] as $s) if (($s['k'] ?? '') === $k) return $s;
    return null;
}

function do_nombre(float $v, int $dec): string {
    $s = number_format($v, $dec, ',', ' ');
    return $dec > 0 ? rtrim(rtrim($s, '0'), ',') : $s;
}

/** Valeur affichée selon le format gaming.tools ({v:0}%, {v:0.#}s, {v:+0.#;-0.#}%, {v:P0}…). */
function do_valeur(array $s): string {
    $v = $s['v'] ?? null;
    if ($v === null || $v === '') return '—';
    if (($s['t'] ?? '') === 'duration' && is_numeric($v)) {
        $h = intdiv((int)$v, 3600); $m = intdiv((int)$v % 3600, 60);
        return $h ? ($h . ' h' . ($m ? ' ' . str_pad((string)$m, 2, '0', STR_PAD_LEFT) : '')) : ($m . ' min');
    }
    if (!is_numeric($v)) return (string)$v;
    $f = (string)($s['f'] ?? '');
    $suffixe = ($i = strrpos($f, '}')) !== false ? substr($f, $i + 1) : '';
    if (strpos($f, 'P0') !== false) return do_nombre($v * 100, 0) . ' %';
    $dec = strpos($f, '0.##') !== false ? 2 : (strpos($f, '0.#') !== false ? 1 : 0);
    $txt = do_nombre((float)$v, $dec);
    if (strpos($f, '+0') !== false && $v > 0) $txt = '+' . $txt;
    if ($suffixe === '%') return $txt . ' %';
    return $txt . $suffixe;
}

function do_libelle(array $s): string {
    $n = DO_LIBELLES[$s['k'] ?? ''] ?? (string)($s['n'] ?? $s['k'] ?? '');
    return trim(preg_replace('/\s*(\(%\)|\(m\)|:)\s*$/u', '', $n));
}

/** Rang de l'objet dans sa catégorie : null si aucune stat comparable. */
function do_classement(array $it, array $items): ?array {
    foreach (DO_STATS_CLASSEMENT as [$k, $haut]) {
        $s = do_stat($it, $k);
        if (!$s || !is_numeric($s['v'] ?? null)) continue;
        $pairs = [];
        foreach ($items as $o) {
            if (($o['cat'] ?? '') !== ($it['cat'] ?? '')) continue;
            $os = do_stat($o, $k);
            if ($os && is_numeric($os['v'] ?? null)) $pairs[] = ['it' => $o, 'v' => (float)$os['v'], 's' => $os];
        }
        if (count($pairs) < 3) return null;   // classer parmi 2 objets n'apprend rien
        usort($pairs, function ($a, $b) use ($haut) { return $haut ? $b['v'] <=> $a['v'] : $a['v'] <=> $b['v']; });
        $v = (float)$s['v'];
        $mieux = 0; $egaux = 0;
        foreach ($pairs as $p) {
            if (abs($p['v'] - $v) < 1e-6) { if ($p['it']['id'] !== $it['id']) $egaux++; }
            elseif ($haut ? $p['v'] > $v : $p['v'] < $v) $mieux++;
        }
        return ['rang' => $mieux + 1, 'egaux' => $egaux, 'total' => count($pairs), 'stat' => $s,
                'haut' => $haut, 'liste' => $pairs];
    }
    return null;
}

function do_rang_txt(int $r): string { return $r === 1 ? '1ᵉʳ' : $r . 'ᵉ'; }

/** Ligne de classement, avec les voisins qui comptent (les suivants si 1ᵉʳ, sinon le meilleur). */
function do_classement_txt(array $c, string $id): string {
    $lib = do_minuscule_initiale(do_libelle($c['stat']));
    $txt = '**' . do_rang_txt($c['rang']) . ' sur ' . $c['total'] . '** de sa catégorie'
        . ($c['egaux'] ? ' (ex æquo avec ' . $c['egaux'] . ')' : '') . ', selon ' . $lib;
    $autres = array_values(array_filter($c['liste'], function ($p) use ($id) { return $p['it']['id'] !== $id; }));
    $fmt = function ($p) { return $p['it']['name'] . ' (' . do_valeur($p['s']) . ')'; };
    if ($c['rang'] === 1) {
        $txt .= "\nEnsuite : " . implode(', ', array_map($fmt, array_slice($autres, 0, 2)));
    } else {
        $txt .= "\nLe meilleur : " . $fmt($autres[0]);
    }
    return $txt;
}

/** Les autres versions Mk du même objet (même nom sans numéro, même catégorie). */
function do_versions(array $it, array $items, ?array $c): string {
    if ($it['_b'] === $it['_n']) return '';
    $v = array_filter($items, function ($o) use ($it) { return $o['_b'] === $it['_b'] && $o['_n'] !== $it['_b'] && ($o['cat'] ?? '') === ($it['cat'] ?? ''); });
    if (count($v) < 2) return '';
    usort($v, function ($a, $b) { return ($a['tier'] ?? 0) <=> ($b['tier'] ?? 0); });
    $parts = [];
    foreach (array_slice($v, -6) as $o) {
        preg_match('/mk\d$/', $o['_n'], $m);
        $lab = $m ? 'Mk ' . substr($m[0], 2) : $o['name'];
        $s = $c ? do_stat($o, $c['stat']['k']) : null;
        $lab .= $s ? ' (' . do_valeur($s) . ')' : '';
        $parts[] = $o['id'] === $it['id'] ? '**' . $lab . '**' : $lab;
    }
    return 'Versions : ' . implode(' · ', $parts);
}

/** Lien optimiseur : seulement pour ce qu'il sait équiper (armes, armures). */
function do_lien_optimiseur(array $it, string $base): ?string {
    $g = $it['group'] ?? '';
    if ($g === 'garment' || ($g === 'weapons' && ($it['cat'] ?? '') !== 'weapons/ammunition')) {
        return $base . '/optimiseur.html#objet=' . rawurlencode($it['id']);
    }
    return null;
}

/** Une fiche (encadré Discord). `$compacte` : sans description, 6 stats au plus. */
function do_fiche(array $it, array $data, string $base, bool $compacte, string $approche = ''): array {
    $items = $data['items'];
    $c = do_classement($it, $items);
    $desc = [];
    // Reconnu par rapprochement : on le dit, pour qu'une erreur se voie tout de suite.
    if ($approche !== '') $desc[] = "🔎 Reconnu d'après « {$approche} »";
    if (!$compacte && !empty($it['desc'])) {
        $d = (string)$it['desc'];
        $desc[] = '*' . do_couper($d, 220) . '*';
    }
    if ($c) $desc[] = do_classement_txt($c, $it['id']);
    if ($vers = do_versions($it, $items, $c)) $desc[] = $vers;
    $liens = ['[Fiche gaming.tools](https://dune.gaming.tools/fr/items/' . rawurlencode($it['id']) . ')'];
    if ($o = do_lien_optimiseur($it, $base)) $liens[] = '[Comparer dans l\'optimiseur](' . $o . ')';
    $desc[] = implode(' · ', $liens);

    $fields = [];
    foreach ($it['stats'] ?? [] as $s) {
        if ($compacte && count($fields) >= 6) break;
        if (count($fields) >= 15) break;
        $fields[] = ['name' => do_libelle($s), 'value' => do_valeur($s), 'inline' => true];
    }
    $sous = array_filter([
        isset($it['tier']) ? 'Tier ' . $it['tier'] : null,
        ($it['rarity'] ?? '') === 'Unique' ? 'Unique' : (($it['rarity'] ?? '') === 'Memento' ? 'Memento' : null),
    ]);
    $e = [
        'title'       => $it['name'] . ($sous ? ' · ' . implode(' · ', $sous) : ''),
        'url'         => 'https://dune.gaming.tools/fr/items/' . rawurlencode($it['id']),
        'description' => implode("\n\n", $desc),
        'color'       => DO_COULEURS[$it['rarity'] ?? ''] ?? DO_COULEURS['Common'],
        'fields'      => $fields,
    ];
    // icon_base finit par /images et les chemins commencent aussi par /images : le CDN ne
    // répond qu'avec un seul (vérifié le 2026-10-23, le double renvoie 404).
    if (!empty($it['icon'])) {
        $e['thumbnail'] = ['url' => rtrim((string)($data['icon_base'] ?? ''), '/') . preg_replace('#^/images(?=/)#', '', $it['icon'])];
    }
    return $e;
}

function do_taille(array $embeds): int {
    $n = 0;
    foreach ($embeds as $e) {
        $n += do_longueur($e['title'] ?? '') + do_longueur($e['description'] ?? '') + do_longueur($e['footer']['text'] ?? '');
        foreach ($e['fields'] ?? [] as $f) $n += do_longueur($f['name']) + do_longueur($f['value']);
    }
    return $n;
}

/** Fiches complètes jusqu'à 2 objets, compactes au-delà ; on rogne si on dépasse 6000 caractères. */
function do_fiches(array $ids, array $data, string $base, array $approches = []): array {
    $compacte = count($ids) > 2;
    $embeds = [];
    foreach ($ids as $id) if ($it = do_par_id($data['items'], $id)) $embeds[] = do_fiche($it, $data, $base, $compacte, $approches[$id] ?? '');
    while (do_taille($embeds) > DO_MAX_CARACT) {
        $rogne = false;
        foreach ($embeds as &$e) if (count($e['fields']) > 3) { array_pop($e['fields']); $rogne = true; }
        unset($e);
        if (!$rogne) { array_pop($embeds); }
    }
    if ($embeds) {
        $date = !empty($data['generated_at']) ? date('d/m/Y', strtotime($data['generated_at'])) : '?';
        $embeds[count($embeds) - 1]['footer'] = ['text' => "Havres Gris · données gaming.tools du {$date}"];
    }
    return $embeds;
}

/** Les encadrés renvoyés par Discord portent des champs à lui (proxy_url, type…) : on ne garde que les nôtres. */
function do_nettoyer_embeds(array $embeds): array {
    $out = [];
    foreach (array_slice($embeds, 0, DO_MAX_FICHES) as $e) {
        $n = array_intersect_key($e, array_flip(['title', 'url', 'description', 'color', 'fields']));
        if (!empty($e['thumbnail']['url'])) $n['thumbnail'] = ['url' => $e['thumbnail']['url']];
        if (!empty($e['footer']['text']))   $n['footer']    = ['text' => $e['footer']['text']];
        $out[] = $n;
    }
    return $out;
}

/** Autocomplétion de /objet : tous les mots tapés doivent figurer dans le nom. */
function do_suggestions(string $saisi, array $items): array {
    $mots = array_filter(explode(' ', do_norm($saisi)));
    $res = [];
    foreach ($items as $it) {
        foreach ($mots as $m) if (strpos($it['_n'], $m) === false) continue 2;
        $debut = $mots && strpos($it['_n'], reset($mots)) === 0 ? 0 : 1;
        $res[] = [$debut, -($it['tier'] ?? 0), $it['_n'], $it];
    }
    // Rien en recherche stricte : on retente en tolérant une faute de frappe par mot (« elohm »).
    if (!$res && $mots) foreach ($items as $it) {
        $motsNom = explode(' ', $it['_n']);
        foreach ($mots as $m) {
            if (strpos($it['_n'], $m) !== false) continue;
            foreach ($motsNom as $w) if (do_proche($m, $w)) continue 2;
            continue 2;
        }
        $res[] = [1, -($it['tier'] ?? 0), $it['_n'], $it];
    }
    usort($res, function ($a, $b) { return [$a[0], $a[1], $a[2]] <=> [$b[0], $b[1], $b[2]]; });
    $choix = [];
    foreach (array_slice($res, 0, 25) as $r) {
        $it = $r[3];
        $lab = $it['name'] . (isset($it['tier']) ? ' · T' . $it['tier'] : '') . (($it['rarity'] ?? '') === 'Unique' ? ' · Unique' : '');
        $choix[] = ['name' => do_couper($lab, 100), 'value' => (string)$it['id']];
    }
    return $choix;
}

// ============================================================
//  INTERACTIONS (rien ci-dessous ne s'exécute quand le fichier est inclus par les tests)
// ============================================================
if (!defined('DUNE_INTERACTIONS_DISPATCHED')) {
    if (defined('DO_TESTS')) return;
    http_response_code(403);
    echo 'accès direct interdit';
    exit;
}

function do_base_url(): string {
    return rtrim(trim((string)($GLOBALS['CFG']['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
}

function do_repondre(array $data, int $type = 4): void {
    echo json_encode(['type' => $type, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function do_prive(string $texte): void {
    do_repondre(['content' => $texte, 'flags' => 64]);
}

/** Réponse privée : les fiches + le bouton qui les publie dans le salon. */
function do_repondre_fiches(array $ids, string $msgSource, array $approches = []): void {
    $embeds = do_fiches($ids, do_charger(), do_base_url(), $approches);
    if (!$embeds) do_prive('Aucun objet reconnu.');
    do_repondre([
        'embeds'     => $embeds,
        'flags'      => 64,
        'components' => [['type' => 1, 'components' => [[
            'type' => 2, 'style' => 2, 'label' => 'Publier dans le salon', 'emoji' => ['name' => '📢'],
            'custom_id' => DO_PUB_PREFIXE . $msgSource,
        ]]]],
    ]);
}

$type = (int)($body['type'] ?? 0);
$data = do_charger();

// ---- Autocomplétion de /objet (type 4) ---------------------------------------
if ($type === 4) {
    $saisi = '';
    foreach ($body['data']['options'] ?? [] as $o) if (!empty($o['focused'])) $saisi = (string)($o['value'] ?? '');
    do_repondre(['choices' => do_suggestions($saisi, $data['items'])], 8);
}

// ---- Clic droit « Fiches objets » (commande de message : type 2, data.type 3) ----
if ($type === 2 && (int)($body['data']['type'] ?? 1) === 3) {
    $cible = (string)($body['data']['target_id'] ?? '');
    $msg = $body['data']['resolved']['messages'][$cible] ?? [];
    // Le texte d'un message visé par une commande de message nous est transmis sans
    // l'intention privilégiée « contenu des messages » ; on lit aussi les encadrés
    // (messages de bots, fiches déjà publiées).
    $texte = (string)($msg['content'] ?? '');
    foreach ($msg['embeds'] ?? [] as $e) $texte .= ' | ' . ($e['title'] ?? '') . ' | ' . ($e['description'] ?? '');
    if (trim($texte, ' |') === '') do_prive("Je n'ai pas pu lire le texte de ce message.");
    $ids = do_trouver($texte, $data['items'], $approches);
    if (!$ids) do_prive("Aucun objet reconnu dans ce message. Il faut le nom du jeu en français, complet ou au moins "
        . "deux de ses mots qui ne désignent qu'un objet (« ceinture elohim », « impur mk6 » ne suffit pas). "
        . "Pour chercher par nom : `/objet`.");
    do_repondre_fiches($ids, $cible, $approches);
}

// ---- /objet nom:<…> -----------------------------------------------------------
if ($type === 2) {
    $saisi = '';
    foreach ($body['data']['options'] ?? [] as $o) if (($o['name'] ?? '') === 'nom') $saisi = (string)($o['value'] ?? '');
    // Choix de l'autocomplétion = identifiant ; texte libre validé sans choisir = recherche par nom.
    $approches = [];
    $ids = do_par_id($data['items'], $saisi) ? [$saisi] : do_trouver($saisi, $data['items'], $approches);
    if (!$ids && ($sug = do_suggestions($saisi, $data['items']))) $ids = [$sug[0]['value']];
    if (!$ids) do_prive('Aucun objet ne correspond à « ' . $saisi . ' ».');
    do_repondre_fiches(array_slice($ids, 0, DO_MAX_FICHES), '', $approches);
}

// ---- Bouton « Publier dans le salon » ----------------------------------------
// La réponse privée porte déjà les fiches : on les republie telles quelles, publiquement,
// avec un lien vers le message d'origine (une réponse d'interaction ne peut pas « répondre à »).
if ($type === 3 && strpos((string)($body['data']['custom_id'] ?? ''), DO_PUB_PREFIXE) === 0) {
    $embeds = do_nettoyer_embeds($body['message']['embeds'] ?? []);
    if (!$embeds) do_prive('Ces fiches ne sont plus disponibles, relance la recherche.');
    $uid = (string)($body['member']['user']['id'] ?? $body['user']['id'] ?? '');
    $src = substr((string)$body['data']['custom_id'], strlen(DO_PUB_PREFIXE));
    $txt = ($uid !== '' ? "<@{$uid}> partage " : 'Partage de ') . (count($embeds) > 1 ? 'ces fiches' : 'cette fiche');
    if ($src !== '' && ctype_digit($src) && !empty($body['guild_id']) && !empty($body['channel_id'])) {
        $txt .= " (à propos de https://discord.com/channels/{$body['guild_id']}/{$body['channel_id']}/{$src})";
    }
    do_repondre(['content' => $txt, 'embeds' => $embeds, 'allowed_mentions' => ['parse' => []]]);
}

do_prive('Action inconnue.');
