#!/usr/bin/env bash
# ============================================================
#  Télécharge les 12 fonds de carte Deep Desert (paquets .gtpk de gaming.tools)
#  dans dd_fonds/, pour que dd_map_update.php compose la carte de la semaine SANS
#  rien demander à gaming.tools (cf. son en-tête).
#
#  À lancer depuis CE PC (Git Bash), puis déposer dd_fonds/ sur le serveur (WinSCP) :
#      bash tools/fetch_dd_fonds.sh            # les 12 variantes
#      bash tools/fetch_dd_fonds.sh 3 11       # seulement deepdesert_1_03 et _11
#
#  Pourquoi d'ici et pas du serveur : Cloudflare présente un défi JavaScript au serveur
#  (« Just a moment… », vérifié le 2026-10-23), et ici même PHP et Node sont refusés —
#  seul le curl de Git Bash (TLS Schannel) passe, avec des en-têtes de navigateur. Si un
#  jour il est bloqué aussi : récupérer les paquets par le navigateur, comme le snapshot
#  de l'optimiseur (tools/recepteur_snapshot.cjs).
#
#  Quand relancer : quand dd_map_update.php envoie l'alerte « fond local périmé » (un
#  patch a changé la carte d'une variante). Les paquets ne changent pas d'une semaine à
#  l'autre : celui de la variante 11 date du 2 juillet 2026.
# ============================================================
set -u
cd "$(dirname "$0")/.." || exit 1
mkdir -p dd_fonds

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
BASE='https://cdn-hosted.gaming.tools/dune/map-tiles'
VARIANTES=("$@"); [ ${#VARIANTES[@]} -eq 0 ] && VARIANTES=(0 1 2 3 4 5 6 7 8 9 10 11)
ok=0; ko=0

for v in "${VARIANTES[@]}"; do
  nom=$(printf 'deepdesert_1_%02d' "$v")
  tmp="dd_fonds/$nom.gtpk.tmp"
  code=$(curl -s -o "$tmp" -w '%{http_code}' -A "$UA" \
    -H 'Referer: https://dune.gaming.tools/' -H 'Origin: https://dune.gaming.tools' "$BASE/$nom.gtpk")
  # Contrôle : signature GTPK et taille qui couvre la dernière tuile de l'index. Une page
  # Cloudflare ou un téléchargement tronqué ne doivent jamais remplacer un bon paquet.
  sig=$(head -c 4 "$tmp" 2>/dev/null)
  taille=$(wc -c < "$tmp" 2>/dev/null || echo 0)
  if [ "$code" = 200 ] && [ "$sig" = GTPK ] && [ "$taille" -gt 100000 ]; then
    mv -f "$tmp" "dd_fonds/$nom.gtpk"
    echo "✔ $nom.gtpk ($((taille / 1024)) Ko)"; ok=$((ok + 1))
  else
    rm -f "$tmp"
    echo "✘ $nom : HTTP $code, signature « $sig » — bloqué par Cloudflare ?"; ko=$((ko + 1))
  fi
done

echo
echo "$ok paquet(s) téléchargé(s), $ko échec(s). Dossier : dd_fonds/ (à déposer à la racine du site, et dans /v2)."
[ $ko -eq 0 ]
