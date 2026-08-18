# ListPlugins

Kullanıcının etkin claude.ai eklentilerini listeler; isteğe bağlı olarak anahtar kelimeyle filtrelenir.

## Ne Zaman Kullanılır

- Hangi eklentilerin zaten etkin olduğunu bilmeniz gerekiyor — örneğin, bir `SuggestPluginInstall` kartından sonra neyin yüklendiğini doğrulamak için.
- Kullanıcı hangi eklentilere sahip olduğunu sorar.

## Parametreler

- `keywords` (string dizisi, opsiyonel): Listeyi filtreleyin — en fazla 8 öğe, her biri 1–64 karakter. Her şeyi listelemek için atlayın.

## Örnekler

### Örnek 1: Etkin eklentileri listeleme

```
ListPlugins()
```

### Örnek 2: Anahtar kelimeyle filtreleme

```
ListPlugins(keywords=["figma"])
```

## Notlar

- Eklenti kataloğuna erişilemezse (yasaklı), araç başarısız olmak yerine bir uyarıyla boş bir listeye düşer.
- Kullanılabilirlik oturum türüne ve özellik dağıtımına bağlıdır.
