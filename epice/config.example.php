<?php
// ============================================================
// config.example.php — MODÈLE à copier en config.php
//   cp config.example.php config.php   puis renseigner les valeurs.
// config.php est gitignoré (ne JAMAIS committer la clé Gemini).
// Utilisé par : api-gemini.php (synthèse IA) et data-api.php (retours de soirée).
// ============================================================

define('GEMINI_API_KEY', 'VOTRE_CLE_GEMINI_ICI');           // Clé API Google Gemini
define('APP_SECRET',     'CHANGEZ_CE_TOKEN_PARTAGE');        // Token partagé avec debrief.html (même valeur que APP_SECRET côté JS)
