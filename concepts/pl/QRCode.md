# Mobilny dostęp przez kod QR

## Jak to działa

CC Viewer uruchamia serwer HTTP i generuje **adres LAN** (np. `http://192.168.1.100:7008`). Zeskanuj kod QR, aby uzyskać dostęp do Claude Code z telefonu przez tę samą sieć WiFi.

## Dlaczego nie mogę się połączyć?

1. **Nie w tej samej sieci** — Telefon i komputer muszą być w tej samej sieci WiFi
2. **Blokada zapory** — Zapora systemowa może blokować połączenia przychodzące
3. **Izolacja sieci firmowej** — Izolacja AP może uniemożliwiać komunikację między urządzeniami
4. **Zakłócenia VPN** — VPN może zakłócać trasę sieciową

## Uwagi dotyczące bezpieczeństwa

> ⚠️ Usługa LAN CC Viewer jest dostępna dla wszystkich urządzeń w tej samej sieci.

- Zachowaj ostrożność w **publicznych sieciach WiFi**
- CC Viewer używa **uwierzytelniania tokenem** do ochrony dostępu LAN
- Zalecane w zaufanych sieciach

## Poza LAN

- **Narzędzia tunelowania** — frp, ngrok, Tailscale itp.
- **Wtyczki CC Viewer** — Skonfiguruj proxy middleware przez system wtyczek
