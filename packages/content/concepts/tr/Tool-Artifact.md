# Artifact

Bir HTML veya Markdown dosyasını Artifact olarak oluştur — kullanıcının tarayıcıda açabileceği ve daha sonra paylaşmayı seçebileceği, claude.ai üzerinde barındırılan özel bir web sayfası. Görsel iletişim terminal metninden daha iyi olduğunda kullanın.

## Ne Zaman Kullanılır

- Görsel bir sonuç yayınlama: rapor, pano, hata araştırması yazısı veya UI maquette
- Daha önce yayınlanmış bir sayfayı aynı yerde güncelleme (aynı dosya yolu aynı URL'ye yeniden yayınlanır)
- Kullanıcının mevcut artifaktlarını listeleme, önceki bir oturumdan birini bulmak için (`action: "list"`)
- **Değil** yerel kalması gereken içerik, düz metin yanıtlar veya görüntüleme sırasında dış ağ kaynakları gerektiren herhangi bir şey için — katı CSP tüm harici hostları engeller

## Etkinleştirme

- claude.ai girişi (`/login`) olan bir Pro, Max, Team veya Enterprise planı gerektirir.
- Yalnızca Anthropic API — Amazon Bedrock, Google Cloud veya Microsoft Foundry'de kullanılamaz.
- Claude Code ≥ 2.1.183 veya Desktop uygulaması ≥ 1.13576.0 gerektirir.
- `disableArtifact` ayarı veya `CLAUDE_CODE_DISABLE_ARTIFACT=1` ile devre dışı bırakın.

## Parametreler

- `file_path` (dize): Oluşturulacak `.html` veya `.md` dosyasının yolu. Dosya yayınlanırken bir belge iskeletiyle sarılır, bu nedenle sayfa içeriğini doğrudan yazın — `<!DOCTYPE>`, `<html>`, `<head>` veya `<body>` etiketleri yok. Aynı yol → yeniden yayınlama sırasında aynı URL; farklı bir yol yeni bir URL talep eder.
- `favicon` (dize, yayınlama için gerekli): Tarayıcı sekmesi simgesi olarak kullanılan bir veya iki emoji (ör. `"📊"`). Yalnızca emoji, işaretleme yok. Yeniden yayınlama sırasında aynı şekilde tutun — kullanıcılar sekmelerini simgesine göre bulurlar.
- `description` (dize): Artifact galeri kartında gösterilen bir cümlelik altyazı.
- `url` (dize, isteğe bağlı): Bunu aynı yerden yapılan ancak yayınlamayan bir konuşmadan güncellemek için mevcut bir artifaktın URL'sini geçin. Bunu yapmazsa yeni bir konuşma her zaman yeni bir URL oluşturur.
- `label` (dize, isteğe bağlı): Sürüm seçicide gösterilen kısa, insan tarafından okunabilir sürüm adı (maks 60 karakter).
- `action` (dize, isteğe bağlı): `"publish"` (varsayılan) veya `"list"` — kullanıcının yayınlanmış artifaktlarını listele (başlık, URL, son güncelleme), isteğe bağlı olarak `limit` ile.
- `force` (mantıksal, isteğe bağlı): Çakışma kontrolü olmadan üzerine yaz. Yalnızca eşzamanlı yazma işleminden 409 aldıktan sonra çözüldüğünde.

## Notlar

- **Yalnızca kendini içeren içerik.** Katı CSP tüm dış hostlara istekleri engeller — CDN betikleri, harici stil sayfaları, uzak görüntüler, fetch/WebSockets. Tüm CSS/JS'yi satır içine alın ve varlıkları `data:` URI'leri olarak gömün.
- **Duyarlı ve temaya duyarlı.** Sayfalar görüntüleyicinin açık veya koyu temasında oluşturulur; her ikisini de şekillendirin (`prefers-color-scheme` artı görüntüleyicinin `data-theme` geçersiz kılması). Geniş içerik kendi konteynerinin içinde kaydırılır — sayfanın ana bölümü yatay olarak asla kaydırılmamalıdır.
- **Sohbetler arasında güncelleme `url` gerektirir.** Aynı dosya yolunun yeniden yayınlanması URL'yi yalnızca bunu yayınlayan sohbet içinde yeniden kullanır; daha eski bir artifaktın bağlantısını tutmak için URL'sini `action: "list"` ile bulun ve `url` olarak geçin.
- **Yayınlama dışa dönüktür.** Artifact hizmetine gönderilen içerik, daha sonra silinse bile önbelleğe alınabilir — makinede özel kalması gereken hiçbir şey yayınlamayın.
- **WebFetch ile geri oku.** claude.ai artifact URL'leri WebFetch aracılığıyla getirilebilir (curl değil, bu da uygulama kabuğunu alır).
