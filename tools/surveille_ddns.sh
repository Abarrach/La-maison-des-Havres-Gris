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
if command -v dig > /dev/null 2>&1; then
    IP_DNS=$(dig @8.8.8.8 +short +time=5 "$NOM" 2>/dev/null | tail -1)
else
    IP_DNS=$(nslookup "$NOM" 8.8.8.8 2>/dev/null | awk '/^Address: /{a=$2} END{print a}')
fi

if [ -z "$IP_REELLE" ] || [ -z "$IP_DNS" ]; then
    # Mesure incomplète : on le dit, on ne l'interprète pas.
    echo "$HORODATAGE  INDÉTERMINÉ  ip_réelle=${IP_REELLE:-?}  dns=${IP_DNS:-?}" >> "$JOURNAL"
elif [ "$IP_REELLE" = "$IP_DNS" ]; then
    echo "$HORODATAGE  ok  $IP_REELLE" >> "$JOURNAL"
else
    echo "$HORODATAGE  DIVERGENCE  la box est en $IP_REELLE, le nom renvoie $IP_DNS — injoignable depuis Internet" >> "$JOURNAL"
fi
