<?php
// ============================================================
//  CATALOGUE DES MINI-JEUX — SOURCE UNIQUE
//
//  Ce fichier ne fait que RENVOYER la liste. Il n'inclut rien, ne démarre
//  aucune session, ne touche à aucune configuration : c'est ce qui permet au
//  cron de reset hebdomadaire de le lire sans traîner derrière lui l'auth
//  Discord et un session_start() dont il n'a aucun besoin.
//
//  Le catalogue a existé en cinq exemplaires dans le site, et chaque copie
//  oubliée donnait une panne silencieuse différente (champion de la semaine
//  jamais annoncé, record absent d'une tuile, identifiant brut dans Mon
//  Compte). Il n'y en a plus qu'un : celui-ci. NE PAS LE RECOPIER.
//
//  L'ORDRE compte : c'est celui de l'annonce hebdomadaire et de l'action
//  `games`. Un nouveau jeu se met à la fin, comme sa tuile dans le hub.
// ============================================================

return [
    // Dernier Rempart : défense sans fin. Plancher initial uniquement ;
    // score_ceiling() suit ensuite le record communautaire (facteur partagé).
    'orni_flap' => [
        'name'      => 'Ornithopter Flap',
        'max_score' => 9999,
        'cooldown'  => 2,
    ],
    'spice_runner' => [
        'name'      => 'Spice Runner',
        'max_score' => 99999,
        'cooldown'  => 3,
    ],
    'sandstorm_memory' => [
        'name'      => 'Sandstorm Memory',
        'max_score' => 50000,
        'cooldown'  => 2,
    ],
    // Le score n'a PAS de borne : points de distance = (vitesse/8) × multiplicateur,
    // et le multiplicateur monte de +5 % par épice SANS PLAFOND (`spiceMultiplier()`),
    // dans un jeu sans fin. Repères à 60 im/s, vitesse max : sans épice ≈ 52 pts/s ;
    // avec 40 épices (×3) ≈ 157 pts/s, soit ≈ 142 000 en un quart d'heure de course.
    // C'est exactement ce qui est arrivé le 2026-09-08 : un score RÉEL de 142 640 est
    // passé au-dessus de l'ancien plafond de 99 999 et a été rejeté en silence — ni
    // classement, ni annonce Discord, alors que le jeu affichait fièrement le record
    // (il vient du localStorage, écrit AVANT l'appel serveur).
    // 300 000 = environ deux fois la meilleure course humaine connue. Ne pas serrer.
    'worm_rider' => [
        'name'      => 'Worm Rider',
        'max_score' => 300000,
        'cooldown'  => 3,
    ],
    'muaddib_rescue' => [
        'name'      => "Muad'Dib Rescue",
        'max_score' => 50000,
        'cooldown'  => 2,
    ],
    // Jeu de rythme : 100 pts par empreinte × multiplicateur de série (max 5), plus
    // 1250 par éveil du ver déjoué. Les étapes s'enchaînent SANS FIN, donc le score
    // n'a aucune borne théorique. Repères calculés (parcours sans la moindre faute) :
    //   6 étapes → 84 500 · 10 étapes → 167 500 · 14 étapes → 266 500
    // Une partie réaliste (4-6 étapes, ~85 % de précision) tourne autour de 25 000.
    // Le plafond est donc posé à 300 000 : il couvre un parcours sans-faute d'une
    // quinzaine d'étapes — au-delà, personne ne tiendra un jeu de rythme d'affilée —
    // tout en rejetant encore les scores manifestement forgés. Ne PAS le serrer :
    // un score au-dessus du plafond est rejeté sec (`invalid_score`) sans que le
    // joueur en soit averti, et c'est le meilleur joueur qu'on pénalise en silence.
    'sandwalk' => [
        'name'      => 'La Marche du Désert',
        'max_score' => 300000,
        'cooldown'  => 2,
    ],
    // Dernier arrivé, placé en dernier : l'ordre de GAMES est celui de l'annonce
    // hebdomadaire et de l'action `games`, et il doit suivre l'ordre des tuiles du hub.
    'dernier_rempart' => [
        'name'      => 'Dernier Rempart',
        'max_score' => 300000,
        'cooldown'  => 2,
    ],
];
