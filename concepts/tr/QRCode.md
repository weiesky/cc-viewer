# Mobil QR Kod Erişimi

## Nasıl çalışır

CC Viewer bir HTTP sunucusu başlatır ve bir **LAN adresi** oluşturur (ör: `http://192.168.1.100:7008`). QR kodu tarayarak aynı WiFi ağı üzerinden telefonunuzdan Claude Code'a erişebilirsiniz.

## Neden bağlanamıyorum?

1. **Aynı ağda değil** — Telefon ve bilgisayar aynı WiFi'ye bağlı olmalıdır
2. **Güvenlik duvarı engeli** — Sistem güvenlik duvarı gelen bağlantıları engelleyebilir
3. **Kurumsal ağ izolasyonu** — AP izolasyonu cihazlar arası iletişimi engelleyebilir
4. **VPN müdahalesi** — VPN ağ yolunu bozabilir

## Güvenlik uyarısı

> ⚠️ CC Viewer'ın LAN hizmeti aynı ağdaki tüm cihazlara açıktır.

- **Herkese açık WiFi**'da dikkatli olun
- CC Viewer, LAN erişimini korumak için **token kimlik doğrulaması** kullanır
- Güvenilir ağlarda kullanılması önerilir

## LAN ötesi

- **Tünel araçları** — frp, ngrok, Tailscale vb.
- **CC Viewer eklentileri** — Eklenti sistemiyle proxy middleware yapılandırın
