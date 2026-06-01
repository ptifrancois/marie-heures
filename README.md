# Marie Heures — Clean Attitude

Application de gestion des feuilles d'heures.

## Déploiement Railway

1. Pusher ce repo sur GitHub
2. Connecter Railway au repo
3. Ajouter les variables d'environnement :
   - `APP_PASSWORD` : mot de passe de connexion (ex: marie2025)
   - `SESSION_SECRET` : chaîne aléatoire (ex: abc123xyz)
4. Railway démarre automatiquement

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `APP_PASSWORD` | Mot de passe de l'appli | marie2025 |
| `SESSION_SECRET` | Secret de session | marie-secret-2025 |
| `PORT` | Port serveur | 3000 |
