# Teammate

## Tanım

Teammate, Claude Code Agent'ın Takım Modu (Team Mode) altındaki iş birlikçi agent'tır. Ana agent `TeamCreate` ile bir takım oluşturup `Agent` aracını kullanarak teammate ürettiğinde, her teammate bağımsız bir agent süreci olarak çalışır, kendi bağlam penceresine ve araç setine sahiptir ve `SendMessage` aracılığıyla takım üyeleriyle iletişim kurar.

## SubAgent ile Farkları

| Özellik | Teammate | SubAgent |
|---------|----------|----------|
| Yaşam döngüsü | Kalıcıdır, birden fazla mesaj alabilir | Tek seferlik görev, tamamlandığında yok edilir |
| İletişim yöntemi | SendMessage ile çift yönlü mesajlaşma | Üst→alt tek yönlü çağrı, sonuç döndürme |
| Bağlam | Bağımsız ve eksiksiz bağlam, turlar arası korunur | İzole edilmiş görev bağlamı |
| İş birliği modeli | Takım iş birliği, birbirleriyle iletişim kurabilir | Hiyerarşik yapı, yalnızca üst agent ile etkileşir |
| Görev türü | Karmaşık çok adımlı görevler | Arama, keşif gibi tekil görevler |

## Davranış

- Ana agent (team lead) tarafından `Agent` aracıyla oluşturulur ve `team_name` atanır
- `TaskList` / `TaskGet` / `TaskUpdate` aracılığıyla görev listesini paylaşır
- Her tur yürütmesi tamamlandıktan sonra idle durumuna geçer, yeni bir mesajla uyandırılmayı bekler
- `shutdown_request` ile zarif bir şekilde sonlandırılabilir

## İstatistik Paneli Açıklaması

Teammate istatistik paneli, her teammate'in API çağrı sayısını gösterir. `Name` sütunu teammate adını (örneğin `reviewer-security`, `reviewer-pipeline`), `Sayı` sütunu ise o teammate'in ürettiği toplam API istek sayısını gösterir.
