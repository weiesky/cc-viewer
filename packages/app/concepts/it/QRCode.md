# Accesso mobile tramite QR code

## Come funziona

CC Viewer avvia un server HTTP e genera un **indirizzo LAN** (es: `http://192.168.1.100:7008`). Scansiona il QR code per accedere a Claude Code dal tuo smartphone tramite la stessa rete WiFi.

## Perché non riesco a connettermi?

1. **Non sulla stessa rete** — Smartphone e computer devono essere sulla stessa rete WiFi (stesso router/stesso nome di rete)
2. **Blocco firewall** — Il firewall del sistema potrebbe bloccare le connessioni in entrata
3. **Isolamento rete aziendale** — L'isolamento AP può impedire la comunicazione tra dispositivi
4. **Interferenza VPN** — Una VPN può interrompere il percorso di rete

## Avviso di sicurezza

> ⚠️ Il servizio LAN di CC Viewer è accessibile a tutti i dispositivi sulla stessa rete.

- Attenzione nelle **reti WiFi pubbliche**
- CC Viewer utilizza **autenticazione tramite token** per proteggere l'accesso LAN
- Si consiglia l'uso su reti affidabili

## Oltre la LAN

- **Strumenti di tunneling** — frp, ngrok, Tailscale, ecc.
- **Plugin CC Viewer** — Configura un proxy middleware tramite il sistema di plugin
