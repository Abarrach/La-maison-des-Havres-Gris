#!/bin/sh
# sonde_handshake.sh — combien de poignées de main TCP échouent sur le 443, et QUAND ?
#
# ── Pourquoi ────────────────────────────────────────────────────────────────
# Établi au paquet le 2026-10-21 : la VM répond au SYN de Discord en ~126 µs, mais
# son SYN-ACK n'arrive jamais à destination. Elle le retransmet, personne n'accuse
# réception, Discord envoie un RST et affiche « n'a pas répondu à temps ».
# La perte est donc en SORTIE, dans la box ou chez l'opérateur.
#
# Ce qu'on ignore encore, et qui est la vraie question : POURQUOI ça a commencé.
# Cette sonde ne change rien au système, elle compte. Une ligne par minute :
#
#   23:36  syn=12  synack=12  retrans=5
#
# retrans > 0 = des poignées de main ont échoué cette minute-là. Sur une nuit, on
# obtient une courbe : régulière ? par bouffées ? aux heures des crons ? corrélée à
# quelque chose ? C'est ce qui manque pour remonter à la cause au lieu de la deviner.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#   chmod +x sonde_handshake.sh
#   sudo nohup ./sonde_handshake.sh >> /home/dune/handshake.log 2>&1 &
#
# Lecture :   awk '$4 != "retrans=0"' /home/dune/handshake.log
# Arrêt :     sudo pkill -f sonde_handshake

tcpdump -nn -l -i any 'tcp port 443 and tcp[tcpflags] & tcp-syn != 0' 2>/dev/null | awk '
function emit() {
    if (cur != "") printf "%s  syn=%d  synack=%d  retrans=%d\n", cur, syn, sa, re
    fflush()
}
{
    minute = substr($1, 1, 5)
    if (minute != cur) { emit(); cur = minute; syn = 0; sa = 0; re = 0; delete vus }
}
# SYN entrant : quelquun nous appelle.
$3 == "In" && /Flags \[S\],/ { syn++ }
# SYN-ACK sortant : notre reponse. Le MEME seq une deuxieme fois = retransmission,
# donc la premiere na jamais ete accusee : poignee de main en echec.
$3 == "Out" && /Flags \[S\.\],/ {
    match($0, /seq [0-9]+/)
    cle = $5 "|" $7 "|" substr($0, RSTART + 4, RLENGTH - 4)
    if (cle in vus) re++; else { vus[cle] = 1; sa++ }
}
END { emit() }
'
