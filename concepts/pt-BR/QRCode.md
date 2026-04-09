# Acesso móvel por QR code

## Como funciona

CC Viewer inicia um servidor HTTP e gera um **endereço LAN** (ex: `http://192.168.1.100:7008`). Escaneie o QR code para acessar o Claude Code do seu celular pela mesma rede WiFi.

## Por que não consigo conectar?

1. **Não está na mesma rede** — Celular e computador devem estar no mesmo WiFi
2. **Bloqueio do firewall** — O firewall do sistema pode bloquear conexões de entrada
3. **Isolamento de rede corporativa** — O isolamento AP pode impedir a comunicação entre dispositivos
4. **Interferência VPN** — Uma VPN pode interromper a rota de rede

## Aviso de segurança

> ⚠️ O serviço LAN do CC Viewer é acessível a todos os dispositivos na mesma rede.

- Cuidado em **WiFi público**
- CC Viewer usa **autenticação por token** para proteger o acesso LAN
- Recomendado para uso em redes confiáveis

## Além da LAN

- **Ferramentas de tunelamento** — frp, ngrok, Tailscale, etc.
- **Plugins CC Viewer** — Configure um proxy middleware pelo sistema de plugins
