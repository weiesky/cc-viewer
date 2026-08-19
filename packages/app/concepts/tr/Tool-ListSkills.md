# ListSkills

Kullanıcının etkin claude.ai skill'lerini listeler; isteğe bağlı olarak anahtar kelimeyle filtrelenir.

## Ne Zaman Kullanılır

- Şu anda etkin olan skill'lerin yetkili listesine ihtiyacınız var — birini çağırmadan önce veya bir `SuggestSkills` kartının ne eklediğini doğrulamak için.
- Kullanıcı hangi skill'lere sahip olduğunu sorar.

## Etkinleştirme

- Eklenti kayıt defteri erişim izni gerektirir.
- HIPAA ortamlarında devre dışıdır.
- Uzak oturumlarda her zaman kullanılabilir.

## Parametreler

- `keywords` (string dizisi, opsiyonel): Listeyi filtreleyin — en fazla 8 öğe, her biri 1–64 karakter. Her şeyi listelemek için atlayın.

## Örnekler

### Örnek 1: Etkin skill'leri listeleme

```
ListSkills()
```

### Örnek 2: Anahtar kelimeyle filtreleme

```
ListSkills(keywords=["review"])
```

## Notlar

- Kataloğa erişilemezse (yasaklı), araç başarısız olmak yerine bir uyarıyla boş bir listeye düşer.
- Bu, *etkin* skill'leri listeler; kullanıcının ekleyebileceği skill'leri yüzeye çıkarmak için `SuggestSkills` kullanın.
