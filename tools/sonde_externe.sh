#!/bin/sh
# sonde_externe.sh — l'endpoint Discord est-il joignable DEPUIS INTERNET, en continu ?
#
# ── Pourquoi ────────────────────────────────────────────────────────────────
# Le journal du dispatcher l'a établi : lors d'un échec « n'a pas répondu à temps »,
# AUCUNE requête n'arrive jusqu'à PHP. La VM, elle, est propre (pas de pare-feu en
# entrée, pas de fail2ban, pool php-fpm jamais saturé). La perte est donc en amont :
# box, NAT, ou chemin réseau. Depuis la VM on ne peut pas la voir — il faut regarder
# de l'extérieur, au moment où ça tombe.
#
# À installer sur une machine HORS du réseau de la box (le dédié OVH convient).
#
# ── Installation ────────────────────────────────────────────────────────────
#   chmod +x sonde_externe.sh
#   crontab -e   puis :  * * * * * /chemin/vers/sonde_externe.sh
#
# Lecture :  grep -E 'ECHEC|LENT|ANORMAL' ~/sonde_externe.log
#
# 401 est la BONNE réponse : le handler rejette une requête sans signature Discord.
# Pour l'obtenir, toute la chaîne doit fonctionner — c'est un test de bout en bout.

URL="https://havresgris.ddns.net/discord_interactions.php"
JOURNAL="$HOME/sonde_externe.log"
ATTENDU=401
SEUIL_LENT=2.0      # secondes ; Discord abandonne à 3

# Connexion NEUVE à chaque fois, comme Discord quand il revient après une pause :
# c'est justement l'établissement à froid qu'on soupçonne.
#   time_connect    = TCP établi
#   time_appconnect = poignée TLS terminée
#   time_total      = réponse complète
MESURE=$(curl -s -o /dev/null --max-time 5 \
    -w '%{http_code} tcp=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s' \
    "$URL" 2>/dev/null)
RC=$?
HOR=$(date -Is)

if [ "$RC" -ne 0 ] || [ -z "$MESURE" ]; then
    # C'EST la ligne qu'on cherche : injoignable vu d'Internet, horodaté.
    echo "$HOR  ECHEC  curl rc=$RC (delai depasse ou connexion impossible)" >> "$JOURNAL"
    exit 0
fi

CODE=$(echo "$MESURE" | awk '{print $1}')
TOTAL=$(echo "$MESURE" | sed 's/.*total=\([0-9.]*\)s.*/\1/')
LENT=$(awk -v t="$TOTAL" -v s="$SEUIL_LENT" 'BEGIN{ print (t+0 > s+0) ? 1 : 0 }')

if [ "$CODE" != "$ATTENDU" ]; then
    echo "$HOR  ANORMAL  $MESURE" >> "$JOURNAL"
elif [ "$LENT" = "1" ]; then
    echo "$HOR  LENT  $MESURE" >> "$JOURNAL"
else
    echo "$HOR  ok  $MESURE" >> "$JOURNAL"
fi
