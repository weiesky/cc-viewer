# Mobiler QR-Code-Zugang

## Funktionsweise

CC Viewer startet einen HTTP-Server und generiert eine **LAN-Adresse** (z.B. `http://192.168.1.100:7008`). Scannen Sie den QR-Code, um über dasselbe WiFi-Netzwerk von Ihrem Smartphone auf Claude Code zuzugreifen.

## Warum kann ich keine Verbindung herstellen?

1. **Nicht im selben Netzwerk** — Smartphone und Computer müssen mit demselben WiFi verbunden sein (gleicher Router/gleicher Netzwerkname)
2. **Firewall-Blockierung** — Die OS-Firewall blockiert möglicherweise eingehende Verbindungen
3. **Unternehmensnetzwerk-Isolation** — AP-Isolation kann die Kommunikation zwischen Geräten verhindern
4. **VPN-Störung** — Ein VPN kann den Netzwerkpfad stören

## Sicherheitshinweis

> ⚠️ Der LAN-Dienst von CC Viewer ist für alle Geräte im selben Netzwerk zugänglich.

- Vorsicht bei **öffentlichem WiFi**
- CC Viewer verwendet **Token-Authentifizierung** zum Schutz des LAN-Zugriffs
- Verwendung in vertrauenswürdigen Netzwerken empfohlen

## Über das LAN hinaus

- **Tunneling-Tools** — frp, ngrok, Tailscale usw.
- **CC Viewer Plugins** — Proxy-Middleware über das Plugin-System konfigurieren
