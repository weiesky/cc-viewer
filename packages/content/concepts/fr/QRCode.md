# Accès mobile par QR code

## Fonctionnement

CC Viewer démarre un serveur HTTP et génère une **adresse LAN** (ex : `http://192.168.1.100:7008`). Scannez le QR code pour accéder à Claude Code depuis votre mobile via le même réseau WiFi.

## Pourquoi la connexion échoue ?

1. **Pas sur le même réseau** — Le mobile et l'ordinateur doivent être sur le même WiFi (même routeur/même nom de réseau)
2. **Blocage du pare-feu** — Le pare-feu du système peut bloquer les connexions entrantes
3. **Isolation réseau d'entreprise** — L'isolation AP peut empêcher la communication entre appareils
4. **Interférence VPN** — Un VPN peut perturber le chemin réseau

## Avis de sécurité

> ⚠️ Le service LAN de CC Viewer est accessible à tous les appareils du même réseau.

- Prudence sur les **WiFi publics**
- CC Viewer utilise une **authentification par token** pour protéger l'accès LAN
- Utilisation recommandée sur des réseaux de confiance

## Au-delà du LAN

- **Outils de tunneling** — frp, ngrok, Tailscale, etc.
- **Plugins CC Viewer** — Configurez un proxy middleware via le système de plugins
