# Projects

Kullanıcının Claude proje bilgi tabanındaki proje dokümanlarını yönetir: dokümanları okuma, arama, yazma ve silme ya da proje bilgilerini çekme.

## Ne Zaman Kullanılır

- Bir dokümanı (çıktı, notlar, referans materyali) oturumdan sonra da varlığını sürdürmesi için kullanıcının projesine kaydetme.
- Mevcut görevi önceki bağlama temellendirmek için mevcut proje dokümanlarını okuma veya arama.
- İçeriğini bağlama yüklemeden projeye yerel bir dosya yükleme.
- Güncelliğini yitirmiş bir proje dokümanını kaldırma.

## Parametreler

- `method` (string, zorunlu): Şunlardan biri: `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, opsiyonel): `project_read`/`project_write`/`project_delete` için: doküman yolu. `project_write` için: mevcut bir yol yerinde değiştirilir; yeni, çıplak bir dosya adı ("/" yok) `claude/<name>` olarak ad uzayına alınır.
- `content` (string, opsiyonel): `project_write` için: satır içi doküman metni. `local_path` ile karşılıklı dışlayıcıdır.
- `local_path` (string, opsiyonel): `project_write` için: çalışma dizini içinde yüklenecek bir dosya — içeriği asla bağlamınıza girmez. `content` ile karşılıklı dışlayıcıdır.
- `present_to_user` (mantıksal, opsiyonel): `project_write` için: bu dokümanı kullanıcının görmesi gereken çıktı olarak işaretleyin. Varsayılan false'tur; rutin kayıtlar ve toplu yazmalar için ayarlanmadan bırakın.
- `query` (string, opsiyonel): `project_search` için: bilgi tabanı sorgusu.
- `n` (number, opsiyonel): `project_search` için: isabet sayısı (varsayılan 5).

## Örnekler

### Örnek 1: Çıktıyı projeye yazmak

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Yerel dosyayı içeriğini bağlama çekmeden yükler ve kullanıcının çıktısı olarak işaretler.

### Örnek 2: Bilgi tabanında arama yapmak

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Notlar

- `content` satır içinde yazdığınız metin içindir; `local_path` zaten diskte olan her şey içindir — ikisini asla karıştırmayın.
- `present_to_user=true` değerini idareli kullanın: yalnızca kullanıcının istediği veya üzerinde işlem yapması gereken tek doküman için.
