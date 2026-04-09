# Acceso móvil por código QR

## Cómo funciona

CC Viewer inicia un servidor HTTP y genera una **dirección LAN** (ej: `http://192.168.1.100:7008`). Escanea el código QR para acceder a Claude Code desde tu móvil a través de la misma red WiFi.

## ¿Por qué no puedo conectar?

1. **No están en la misma red** — El móvil y el ordenador deben estar en el mismo WiFi
2. **Bloqueo del firewall** — El firewall del sistema puede bloquear conexiones entrantes
3. **Aislamiento de red corporativa** — El aislamiento AP puede impedir la comunicación entre dispositivos
4. **Interferencia VPN** — Una VPN puede interrumpir la ruta de red

## Aviso de seguridad

> ⚠️ El servicio LAN de CC Viewer es accesible para todos los dispositivos en la misma red.

- Ten cuidado en **WiFi público**
- CC Viewer usa **autenticación por token** para proteger el acceso LAN
- Se recomienda usar en redes de confianza

## Más allá de la LAN

- **Herramientas de túnel** — frp, ngrok, Tailscale, etc.
- **Plugins de CC Viewer** — Configura un proxy middleware mediante el sistema de plugins
