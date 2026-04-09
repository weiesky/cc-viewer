# Mobil QR-kode adgang

## Sådan virker det

CC Viewer starter en HTTP-server og genererer en **LAN-adresse** (f.eks. `http://192.168.1.100:7008`). Scan QR-koden for at tilgå Claude Code fra din telefon via det samme WiFi-netværk.

## Hvorfor kan jeg ikke oprette forbindelse?

1. **Ikke på det samme netværk** — Telefon og computer skal være på det samme WiFi
2. **Firewall-blokering** — Systemets firewall kan blokere indgående forbindelser
3. **Virksomhedsnetværk-isolation** — AP-isolation kan forhindre kommunikation mellem enheder
4. **VPN-interferens** — En VPN kan forstyrre netværksruten

## Sikkerhedsadvarsel

> ⚠️ CC Viewers LAN-tjeneste er tilgængelig for alle enheder på det samme netværk.

- Vær forsigtig på **offentligt WiFi**
- CC Viewer bruger **token-godkendelse** til at beskytte LAN-adgang
- Anbefales at bruge på betroede netværk

## Ud over LAN

- **Tunneling-værktøjer** — frp, ngrok, Tailscale osv.
- **CC Viewer plugins** — Konfigurer proxy-middleware via plugin-systemet
