import pandas as pd
from pathlib import Path

# --- CONFIGURATION ---
BASE_DIR = Path(__file__).parent
CSV_FILE = BASE_DIR / "data" / "dune_counts.csv"

def analyze_data():
    if not CSV_FILE.exists():
        print("Erreur : Le fichier de données n'existe pas encore.")
        return

    # Chargement des données
    print(f"Chargement des données depuis {CSV_FILE}...")
    df = pd.read_csv(CSV_FILE, sep=';')

    # Conversion de la colonne timestamp en objet datetime pour l'analyse temporelle
    df['timestamp'] = pd.to_datetime(df['timestamp'], format='mixed')

    print("\n" + "="*40)
    print("📊 RAPPORT DUNE AWAKENING (SERVEURS EU)")
    print("="*40)
    print(f"Période analysée : du {df['timestamp'].min()} au {df['timestamp'].max()}")
    print(f"Total des relevés : {len(df)} lignes\n")

    # --- 1. Serveur le plus peuplé (Moyenne des joueurs totaux par heure) ---
    # D'abord, on somme les joueurs de tous les sietches pour un serveur donné à un instant T
    server_totals = df.groupby(['timestamp', 'serveur'])['joueurs'].sum().reset_index()
    # Ensuite, on calcule la moyenne de ces totaux sur toute la période
    avg_server_pop = server_totals.groupby('serveur')['joueurs'].mean().round(2).sort_values(ascending=False)
    print("🏆 Top 5 Serveurs EU (Moyenne joueurs simultanés dans les sietches) :")
    print(avg_server_pop.head().to_string())
    print("\n")

    # --- 2. Sietch le plus peuplé ---
    # Moyenne de joueurs par sietch sur toute la période
    avg_sietch_pop = df.groupby(['serveur', 'sietch'])['joueurs'].mean().round(2).sort_values(ascending=False)
    print("🛖 Top 5 Sietches les plus actifs :")
    print(avg_sietch_pop.head().to_string())
    print("\n")

    # --- 3. Densité et Répartition (Exemple sur le meilleur serveur) ---
    best_server = avg_server_pop.index[0]
    best_server_data = df[df['serveur'] == best_server]

    # Combien de sietches sont réellement "vivants" (> 0 joueurs en moyenne)
    sietches_alive = best_server_data.groupby('sietch')['joueurs'].mean()
    nb_sietches_actifs = (sietches_alive > 0).sum()
    total_sietches = len(sietches_alive)
    print(f"📈 Focus sur le meilleur serveur : {best_server}")
    print(f"  - Sietches actifs (moyenne > 0) : {nb_sietches_actifs} / {total_sietches}")

    # --- 4. (Bonus) Détection du Prime Time Global ---
    # On ajoute une colonne pour l'heure de la journée
    server_totals['heure'] = server_totals['timestamp'].dt.hour
    prime_time = server_totals.groupby('heure')['joueurs'].sum().sort_values(ascending=False)
    print("\n⏰ Heures d'affluence maximale (Heure UTC) :")
    print(prime_time.head(3).to_string())

if __name__ == "__main__":
    analyze_data()
