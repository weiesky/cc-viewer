# RemoteTrigger

Zamanlanmış görevleri ve isteğe bağlı tetikleyici yürütmelerini yönetmek için claude.ai uzak tetikleyici API'sini çağırır. OAuth jetonu araç tarafından dahili olarak işlenir ve modele veya kabuğa hiçbir zaman açık değildir.

## Ne Zaman Kullanılır

- Mevcut tetikleyicileri listeleme, inceleme ve güncelleme dahil olmak üzere claude.ai'daki uzak ajanları (tetikleyicileri) yönetme
- Tekrarlayan bir takvime göre Claude ajanını çalıştıran yeni bir cron tabanlı otomatik görev oluşturma
- Mevcut bir tetikleyiciyi bir sonraki zamanlanmış çalıştırmasını beklemeden isteğe bağlı olarak tetikleme
- Yapılandırmalarını ve durumlarını incelemek için mevcut tüm tetikleyicileri listeleme veya denetleme
- Tetikleyiciyi yeniden oluşturmak zorunda kalmadan zamanlama, yük veya açıklama gibi tetikleyici ayarlarını güncelleme

## Etkinleştirme

- Bir claude.ai Pro, Max, Team veya Enterprise planı gerektirir.
- Amazon Bedrock, AWS üzerinde Claude Platform, Google Cloud veya Microsoft Foundry'de kullanılamaz.
- Sunucu tarafı özellik bayrakları ve `allow_remote_sessions` / `allow_routines` ilke ayarlarını gerektirir.
- Uzak oturumların kendisi için değildir.

## Parametreler

- `action` (string, zorunlu): gerçekleştirilecek işlem — `list`, `get`, `create`, `update` veya `run` değerlerinden biri
- `trigger_id` (string, `get`, `update` ve `run` için zorunlu): işlem yapılacak tetikleyicinin tanımlayıcısı; `^[\w-]+$` desenine uymalıdır (yalnızca sözcük karakterleri ve tire işaretleri)
- `body` (object, `create` ve `update` için zorunlu; `run` için isteğe bağlı): API'ye gönderilen istek yükü

## Örnekler

### Örnek 1: tüm tetikleyicileri listele

```json
{
  "action": "list"
}
```

`GET /v1/code/triggers` çağrısını yapar ve kimliği doğrulanmış hesapla ilişkili tüm tetikleyicilerin JSON dizisini döndürür.

### Örnek 2: her hafta içi sabahı çalışan yeni bir tetikleyici oluştur

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Her hafta içi UTC 08:00'de günlük özet oluştur"
  }
}
```

Sağlanan gövdeyle `POST /v1/code/triggers` çağrısını yapar ve atanan `trigger_id` dahil yeni oluşturulan tetikleyici nesnesini döndürür.

### Örnek 3: bir tetikleyiciyi isteğe bağlı olarak çalıştır

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Zamanlanmış saati atlayarak `POST /v1/code/triggers/my-report-trigger/run` çağrısını hemen yapar.

### Örnek 4: tek bir tetikleyici getir

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

`GET /v1/code/triggers/my-report-trigger` çağrısını yapar ve tam tetikleyici yapılandırmasını döndürür.

## Notlar

- OAuth jetonu araç tarafından işlem içinde enjekte edilir — jetonları hiçbir zaman manuel olarak kopyalamayın, yapıştırmayın veya kaydetmeyin; bunu yapmak güvenlik riski oluşturur ve bu aracı kullanırken gereksizdir.
- Tüm tetikleyici API çağrıları için ham `curl` veya diğer HTTP istemcileri yerine bu aracı tercih edin; doğrudan HTTP kullanımı güvenli jeton enjeksiyonunu atlar ve kimlik bilgilerini açığa çıkarabilir.
- Araç, API'den ham JSON yanıtını döndürür; çağıran taraf yanıtı ayrıştırmaktan ve hata durum kodlarını işlemekten sorumludur.
- `trigger_id` değeri `^[\w-]+$` deseniyle eşleşmelidir — yalnızca alfanümerik karakterlere, alt çizgilere ve tirelere izin verilir; boşluklar veya özel karakterler isteğin başarısız olmasına neden olur.
