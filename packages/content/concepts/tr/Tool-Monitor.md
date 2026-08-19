# Monitor

Uzun süre çalışan bir betikten olayları akışla ileten bir arka plan monitörü başlatır. Her stdout satırı bir bildirim olur — siz çalışmaya devam ederken olaylar sohbete gelir.

## Ne Zaman Kullanılır

- Bir deployment çalışırken günlük dosyasındaki hataları, uyarıları veya çökme imzalarını takip etmek için
- Yeni durum olaylarını tespit etmek amacıyla uzak bir API, PR veya CI ardışık düzenini her 30 saniyede sorgulamak için
- Dosya sistemi dizinindeki veya derleme çıktısındaki değişiklikleri gerçek zamanlı izlemek için
- Birçok yineleme boyunca belirli bir koşulu beklemek için (örneğin bir eğitim adımı kilometre taşı veya bir kuyruğun boşaltılması)
- Basit "tamamlanana kadar bekle" için **kullanmayın** — bunun için `run_in_background` ile `Bash` kullanın; süreç sona erdiğinde tek bir tamamlama bildirimi gönderir

## Etkinleştirme

- Varsayılan olarak kapalıdır (sunucu tarafı bir özellik bayrağı).
- Amazon Bedrock, Google Cloud ve Microsoft Foundry'de kullanılamaz.
- `DISABLE_TELEMETRY` veya `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` ayarlandığında kapalıdır.
- WebSocket kaynağı Claude Code 2.1.195+ gerektirir.

## Parametreler

- `command` (dize, zorunlu): Çalıştırılacak shell komutu veya betiği. Stdout'a yazılan her satır ayrı bir bildirim olayı olur. Süreç sona erdiğinde monitör biter.
- `description` (dize, zorunlu): Her bildirimde gösterilen kısa, okunabilir etiket. Spesifik olun — "deploy.log'daki hatalar" ifadesi "günlükleri izliyor" ifadesinden daha iyidir. Bu etiket hangi monitörün tetiklendiğini tanımlar.
- `timeout_ms` (sayı, varsayılan `300000`, maks `3600000`): Zorla sonlandırma süresi (milisaniye). Bu süreden sonra süreç sonlandırılır. `persistent: true` olduğunda görmezden gelinir.
- `persistent` (mantıksal, varsayılan `false`): `true` olduğunda monitör zaman aşımı olmaksızın oturumun tüm ömrü boyunca çalışır. `TaskStop` ile açıkça durdurun.

## Örnekler

### Örnek 1: Günlük dosyasını hatalar ve çökmeler için izlemek

Bu örnek tüm terminal durumlarını kapsar: başarı işaretçisi, geri izleme, yaygın hata anahtar kelimeleri, OOM sonlandırması ve beklenmedik süreç çıkışı.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Her pipe'ta `grep --line-buffered` kullanın. Kullanılmazsa işletim sistemi çıktıyı 4 KB'lık bloklar halinde tamponlar ve olaylar dakikalarca gecikebilir. Alternasyon deseni hem başarı yolunu (`deployed`) hem de hata yollarını (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`) kapsar. Yalnızca başarı işaretçisini izleyen bir monitör çökme sırasında sessiz kalır — sessizlik "hâlâ çalışıyor" ile aynı görünür.

### Örnek 2: Uzak API'yi her 30 saniyede sorgulamak

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` geçici bir ağ hatasının döngüyü sonlandırmasını engeller. Hız sınırlarından kaçınmak için uzak API'ler için 30 saniye veya daha fazla sorgulama aralıkları uygundur. API tarafındaki hatalar sessizlikle maskelenmemesi için grep desenini hem başarı hem de hata yanıtlarını yakalayacak şekilde ayarlayın.

## Notlar

- **Pipe'larda her zaman `grep --line-buffered` kullanın.** Kullanılmazsa, işletim sistemi bir 4 KB blok dolana kadar çıktıyı biriktirdiğinden pipe tamponlaması olayları dakikalarca geciktirir. `--line-buffered` her satırdan sonra zorla boşaltma yapar.
- **Filtre hem başarı hem de hata imzalarını kapsamalıdır.** Yalnızca başarı işaretçisini izleyen bir monitör çökme, takılma veya beklenmedik çıkış durumunda sessiz kalır. Alternasyonu genişletin: başarı anahtar kelimesinin yanına `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` ve benzeri terminal durum işaretçilerini ekleyin.
- **Sorgulama aralıkları: Uzak API'ler için 30 saniye veya daha fazla.** Harici hizmetlerin sık sorgulanması hız sınırı hatalarına veya engellemelere yol açabilir. Yerel dosya sistemi veya süreç kontrolleri için 0,5–1 saniye uygundur.
- **Oturum ömrü boyunca çalışan monitörler için `persistent: true` kullanın.** Varsayılan `timeout_ms` değeri 300.000 ms (5 dakika) süreyi sonlandırır. Açıkça durdurulana kadar çalışması gereken monitörler için `persistent: true` ayarlayın ve bittiğinde `TaskStop` çağırın.
- **Olay seli durumunda otomatik durdurma.** Her stdout satırı bir sohbet mesajıdır. Filtre çok geniş olup çok fazla olay üretirse monitör otomatik olarak durdurulur. Daha dar bir `grep` deseniyle yeniden başlatın. 200 ms içinde gelen satırlar tek bir bildirimde toplanır.
