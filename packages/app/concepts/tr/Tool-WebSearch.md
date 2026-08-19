# WebSearch

Canlı bir web araması gerçekleştirir ve asistanın modelin eğitim kesiminin ötesindeki mevcut bilgilerde yanıtını temellendirmek için kullandığı sıralanmış sonuçlar döndürür.

## Ne Zaman Kullanılır

- Güncel olaylar, son yayınlar veya son dakika haberleri hakkındaki soruları yanıtlamak.
- Bir kitaplık, çerçeve veya CLI aracının en son sürümünü aramak.
- Tam URL bilinmediğinde dokümantasyon veya blog yazıları bulmak.
- Model eğitildiğinden beri değişmiş olabilecek bir gerçeği doğrulamak.
- `WebFetch` ile herhangi bir sayfayı almadan önce bir konudaki birden fazla bakış açısını keşfetmek.

## Etkinleştirme

- Kullanılabilirlik sağlayıcıya ve modele bağlıdır: Anthropic API ve AWS üzerinde Claude Platform'da kullanılabilir; Microsoft Foundry'de Anthropic tarafından barındırılan bir dağıtım gerektirir; Google Cloud'da Claude 4+ modelleriyle çalışır.
- Amazon Bedrock'ta kullanılamaz.
- `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` ile oturum başına 200 çağrıyla sınırlayın.

## Parametreler

- `query` (string, zorunlu): Arama sorgusu. Minimum uzunluk 2 karakter. Sonuçların taze olması için "en son" veya "yakın zamandaki" bilgiler hakkında sorarken mevcut yılı dahil edin.
- `allowed_domains` (string dizisi, opsiyonel): Sonuçları yalnızca bu alan adlarıyla sınırlar, örneğin `["nodejs.org", "developer.mozilla.org"]`. Belirli bir kaynağa güvendiğinizde kullanışlıdır.
- `blocked_domains` (string dizisi, opsiyonel): Bu alan adlarından gelen sonuçları hariç tutar. Aynı alan adını `allowed_domains` ve `blocked_domains`'e geçirmeyin.

## Örnekler

### Örnek 1: Mevcut yıl ile sürüm araması

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Resmi duyuruları döndürür ve düşük kaliteli toplayıcı sitelerden kaçınır.

### Örnek 2: Gürültülü kaynakları hariç tutmak

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Sonuçları satıcı uyarıları ve güvenlik izleyicilerine odaklı tutar.

## Notlar

- Bir yanıtta `WebSearch` kullandığınızda, yanıtınızın sonuna her alıntılanan sonucu `[Title](URL)` biçiminde bir Markdown köprüsü olarak listeleyen bir `Sources:` bölümü eklemeniz gerekir. Bu isteğe bağlı değil, zorunlu bir gerekliliktir.
- `WebSearch` yalnızca Amerika Birleşik Devletleri'ndeki kullanıcılara sunulmaktadır. Araç bölgenizde kullanılamıyorsa, bilinen bir URL'ye karşı `WebFetch`'e geri dönün veya kullanıcıdan ilgili içeriği yapıştırmasını isteyin.
- Her çağrı tek bir gidiş-dönüşte aramayı gerçekleştirir — akış yapamaz veya sayfalara ayıramazsınız. İlk sonuç kümesi hedef dışıysa sorguyu iyileştirin.
- Araç parçacıklar ve meta veri döndürür, tam sayfa içerikleri değil. Belirli bir sonucu derinlemesine okumak için, döndürülen URL ile `WebFetch` ile takip edin.
- CVE'ler veya uyumluluk gibi güvenliğe duyarlı sorular için yetkili kaynak temini uygulamak için `allowed_domains`'i ve dokümantasyonu yansıtan SEO çiftliklerini kesmek için `blocked_domains`'i kullanın.
- Sorguları kısa ve anahtar kelime odaklı tutun. Doğal dil soruları işe yarar ancak birincil kaynaklardan ziyade konuşma yanıtları döndürme eğilimindedir.
- Arama sezgisine dayalı olarak URL'ler uydurmayın — her zaman aramayı çalıştırın ve aracın gerçekten döndürdüğünü alıntılayın.
