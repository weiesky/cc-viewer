# SendFile

Bir veya daha fazla dosyayı başka bir Claude Code oturumuna gönderir — `ListAgents` tarafından listelenen bir eş veya açık bir oturum adresi.

## Ne Zaman Kullanılır

- Bir eş oturumun kendi görevine devam etmesi için çalışma dizininizden bir dosyaya ihtiyacı vardır (bir rapor, bir yama, bir fikstür).
- Oturumlar arasında işi koordine ediyorsunuz ve yalnızca metin değil, yapıtları devretmek istiyorsunuz (metin için `SendMessage` kullanın).

## Etkinleştirme

- Oturumlar arası dosya aktarımı oturumda mevcut olmalıdır; olmadığında doğrulama "Cross-session file transfer is not available in this session." hatasıyla başarısız olur.
- `ListAgents` ile aynı oturumlar arası mesajlaşma koşullarıyla sınırlıdır (sunucu tarafı özellik bayrakları, varsayılan olarak kapalı).

## Parametreler

- `to` (string, zorunlu): Alıcı — `ListAgents`'tan bir eş oturum adı veya açık bir `uds:<socket>` / `bridge:<session id>` adresi.
- `files` (string dizisi, zorunlu): Gönderilecek dosya yolları (mutlak veya çalışma dizinine göreli). Tek bir dosya için bile her zaman bir dizi geçirin. 1–16 dosya, her biri en fazla 30 MiB.
- `message` (string, opsiyonel): Dosyalarla birlikte iletilen kısa mesaj.

## Örnekler

### Örnek 1: Bir eş oturuma rapor göndermek

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Notlar

- Uzak makinelere aktarımlar ek onay gerektirebilir.
- Dosya içeriğini okumak gönderimin bir parçasıdır — dosya okuma izin kuralları tarafından devre dışı bırakılmışsa reddedilir.
