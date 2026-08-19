# EndConversation

Mevcut konuşmayı sonlandırır ve başka mesaj gönderilmesini engeller.

## Ne Zaman Kullanılır

- Yalnızca sürekli kullanıcı istismarı için veya kullanıcı bu aracın bir gösterimini açıkça istediğinde.

Bu son çare bir eylemdir: aracın kendi kuralları kullanmadan önce kullanıcıyı uyarmayı ve onay almayı gerektirir ve kendine zarar verme veya zararla ilgili durumlarda asla kullanılmamalıdır.

## Etkinleştirme

- Claude Code 2.1.213+ ve Opus 4.8 / Sonnet 5 / Fable 5 veya daha sonraki bir aileden bir model gerektirir.
- Yalnızca etkileşimli terminal oturumları — asla `--bare` modunda değil ve asla alt agent'lara sunulmaz.
- Amazon Bedrock, AWS üzerinde Claude Platform, Vertex AI, Microsoft Foundry veya bulut ağ geçitlerinde kullanılamaz.
- Sunucu tarafı bir özellik bayrağı gerektirir — çoğu oturum bu aracı sunmaz.

## Parametreler

Bu araç parametre almaz.

## Örnekler

### Örnek 1: Konuşmayı sonlandırmak

```
EndConversation()
```

Akış iki adımlıdır: ilk çağrı bir yansıma mesajı döndürür; hemen ardından yapılan ikinci bir çağrı konuşmayı gerçekten sonlandırır (`ended: true`).

## Notlar

- Sıkı şekilde kısıtlanmıştır: desteklenen bir model, CLI giriş noktası ve sunucu tarafı bir özellik bayrağı gerektirir — çoğu oturum bu aracı sunmaz.
- Bir kez sonlandırıldığında konuşmada başka mesaj gönderilemez.
