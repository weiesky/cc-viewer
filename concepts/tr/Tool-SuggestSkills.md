# SuggestSkills

Konu anahtar kelimelerine dayanarak kullanıcının ekleyebileceği bağımsız skill'lerden (henüz etkin olmayan skill'ler) oluşan bir kart oluşturur.

## Ne Zaman Kullanılır

- Kullanıcının isteği, etkinleştirmedikleri skill'lerle eşleşir (istediklerinde `trigger="user_asked"`, istenmeden önerdiğinizde `trigger="proactive"`).

## Etkinleştirme

- Yalnızca bir Remote Control istemcisi bağlıyken veya oturum yönetilen bir bulut ortamında çalışırken.
- HIPAA kurumsal yapılandırmalarında devre dışıdır.
- Brief modunda değildir.

## Parametreler

- `keywords` (string dizisi, zorunlu): Kullanıcının isteğindeki konu anahtar kelimeleri. 1–8 öğe, her biri 1–64 karakter.
- `contextLabel` (string, opsiyonel): Öneriyi isteğe bağlayan kısa etiket (en fazla 128 karakter).
- `trigger` (string, opsiyonel): Bu önerinin nasıl başladığı — `user_asked` veya `proactive`.

## Örnekler

### Örnek 1: Konuya göre skill önermek

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Zaten etkin olan skill'ler sonuçtan filtrelenir.

## Notlar

- Yalnızca bir öneri kartı oluşturur — bir skill eklemek bu aracın dışında gerçekleşir; doğrulamak için sonrasında `ListSkills` çağırın.
