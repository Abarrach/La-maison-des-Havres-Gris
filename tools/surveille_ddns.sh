#!/bin/sh
# surveille_ddns.sh — Le nom havresgris.ddns.net pointe-t-il VRAIMENT là où il faut ?
#
# ── Pourquoi ────────────────────────────────────────────────────────────────
# Les pannes du bot Discord vont par périodes : ça marche, puis ça ne marche plus,
# puis ça remarche. C'est la forme exacte d'un changement d'IP publique suivi d'un
# retard de propagation DDNS : pendant la fenêtre, Discord frappe à l'ancienne
# adresse et personne ne répond. Depuis le réseau local on ne voit RIEN, puisqu'on
# ne passe pas par le nom public.
#
# Cette sonde compare, toutes les deux minutes :
#   - l'IP publique réelle de la box,
#   - ce que le nom renvoie, demandé à un résolveur PUBLIC (pas au cache local).
# Une divergence = la fenêtre d'injoignabilité, horodatée. C'est ce qu'il manquait
# pour relier les pannes à une cause au lieu de les subir.
#
# ── Installation ────────────────────────────────────────────────────────────
#   cp surveille_ddns.sh /home/dune/ && chmod +x /home/dune/surveille_ddns.sh
#   crontab -e   puis :  */2 * * * * /home/dune/surveille_ddns.sh
#
# Lecture :  grep DIVERGENCE /home/dune/ddns_surveillance.log
# Le journal ne grossit pas : une ligne toutes les 2 min, ~90 Ko par mois.

NOM="havresgris.ddns.net"
JOURNAL="/home/dune/ddns_surveillance.log"
HORODATAGE=$(date -Is)

# IP publique réelle. Deux sources : si la première est injoignable, on ne veut pas
# conclure à tort que l'IP a changé — une sonde qui crie au loup ne sert à rien.
IP_REELLE=$(curl -s --max-time 8 https://api.ipify.org 2>/dev/null)
[ -z "$IP_REELLE" ] && IP_REELLE=$(curl -s --max-time 8 https://ifconfig.me/ip 2>/dev/null)

# Ce que le nom renvoie, demandé à un résolveur PUBLIC : le cache local du serveur
# donnerait la bonne réponse même quand le reste du monde a l'ancienne.
#
# Quatre méthodes en cascade, parce qu'on ne sait pas d'avance ce qui est installé
# ni ce que la box laisse sortir. La dernière passe par HTTPS : elle ne dépend que
# de curl, et traverse un filtrage du port 53 sortant.
IP_DNS=""
METHODE=""

if command -v dig > /dev/null 2>&1; then
    IP_DNS=$(dig @8.8.8.8 +short +time=5 "$NOM" 2>/dev/null | grep -E '^[0-9.]+$' | tail -1)
    [ -n "$IP_DNS" ] && METHODE=dig
fi

if [ -z "$IP_DNS" ] && command -v nslookup > /dev/null 2>&1; then
    # Debian sépare par une TABULATION, et la première ligne « Address » est celle
    # du résolveur lui-même (8.8.8.8#53) : on l'écarte sur le '#'.
    IP_DNS=$(nslookup "$NOM" 8.8.8.8 2>/dev/null | awk '/^Address/ && $NF !~ /#/ {a=$NF} END{print a}')
    [ -n "$IP_DNS" ] && METHODE=nslookup
fi

if [ -z "$IP_DNS" ] && command -v host > /dev/null 2>&1; then
    IP_DNS=$(host "$NOM" 8.8.8.8 2>/dev/null | awk '/has address/ {a=$NF} END{print a}')
    [ -n "$IP_DNS" ] && METHODE=host
fi

if [ -z "$IP_DNS" ]; then
    # DNS-over-HTTPS : même question, posée au même résolveur, mais en 443.
    IP_DNS=$(curl -s --max-time 8 -H 'accept: application/dns-json' \
        "https://dns.google/resolve?name=$NOM&type=A" 2>/dev/null \
        | tr ',' '\n' | awk -F'"' '/"data"/ {a=$4} END{print a}')
    [ -n "$IP_DNS" ] && METHODE=doh
fi

if [ -z "$IP_REELLE" ] || [ -z "$IP_DNS" ]; then
    # Mesure incomplète : on le dit, on ne l'interprète pas.
    echo "$HORODATAGE  INDÉTERMINÉ  ip_réelle=${IP_REELLE:-?}  dns=${IP_DNS:-?}  (aucune méthode DNS n'a répondu)" >> "$JOURNAL"
elif [ "$IP_REELLE" = "$IP_DNS" ]; then
    echo "$HORODATAGE  ok  $IP_REELLE  ($METHODE)" >> "$JOURNAL"
else
    echo "$HORODATAGE  DIVERGENCE  la box est en $IP_REELLE, le nom renvoie $IP_DNS — injoignable depuis Internet" >> "$JOURNAL"
fi
