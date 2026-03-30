# Tools Neden İlk Sırada Gösterilir?

cc-viewer'ın Bağlam panelinde **Tools, System Prompt ve Messages'tan önce görünür**. Bu sıralama, **Anthropic API'nin KV-Cache önek sırasını** tam olarak yansıtır.

## KV-Cache Önek Sırası

Anthropic'in API'si KV-Cache'i oluştururken, bağlamı bu **sabit sırayla** bir önek olarak birleştirir:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Bu, **Tools'un cache önekinin en başında System Prompt'tan önce yer aldığı** anlamına gelir.

## Tools Neden System'dan Daha Fazla Cache Ağırlığına Sahip?

KV-Cache önek eşleştirmesinde **önceki içerik daha kritiktir** — herhangi bir değişiklik, sonrasındaki her şeyi geçersiz kılar:

1. **Önek eşleştirmesi baştan başlar**: KV-Cache, mevcut isteği önbellekteki önekle baştan token token karşılaştırır. Bir uyuşmazlık bulunduğu anda, sonraki tüm içerik geçersiz kılınır.

2. **Tools değişirse = tüm cache geçersiz**: Tools ilk sırada olduğundan, araç tanımlarındaki herhangi bir değişiklik (tek bir MCP tool eklenmesi veya kaldırılması bile) **öneki en başından bozar** ve önbelleğe alınan tüm System Prompt ile Messages'ı geçersiz kılar.

3. **System değişirse = Messages cache geçersiz**: System Prompt ortada yer aldığından, değişiklikler yalnızca sonrasındaki Messages bölümünü geçersiz kılar.

4. **Messages değişirse = yalnızca kuyruk etkilenir**: Messages en sonda yer aldığından, yeni mesajlar eklemek yalnızca küçük bir son segmenti geçersiz kılar — Tools ve System cache'i bütün kalır.

## Pratik Etki

| Değişiklik Türü | Cache Etkisi | Tipik Senaryo |
|-----------------|-------------|---------------|
| Tool eklendi/kaldırıldı | **Tam geçersizleştirme** | MCP sunucu bağlan/kes, IDE eklentisi aç/kapat |
| System Prompt değişikliği | Messages cache kaybı | CLAUDE.md düzenleme, system reminder enjeksiyonu |
| Yeni mesaj eklendi | Yalnızca kuyruk artışı | Normal konuşma akışı (en yaygın, en ucuz) |

Bu nedenle [CacheRebuild](CacheRebuild.md)'deki `tools_change`, genellikle en pahalı yeniden oluşturma nedenidir — önek zincirini en baştan kırar.

## Araç tanımları neden "beyinden" önce yerleştirilir?

Önbellekleme açısından, Tools'un ilk sırada olması teknik bir gerçektir. Ancak bilişsel tasarım açısından da bu sıralama mantıklıdır — **Tools eller ve ayaklardır, System Prompt beyindir**.

Harekete geçmeden önce, bir kişi hangi uzuvlara ve araçlara sahip olduğunu algılamalıdır. Bir bebek önce dünyanın kurallarını (System) anlayıp sonra tutmayı öğrenmez — önce ellerinin ve ayaklarının olduğunu algılar, ardından çevreyle etkileşim yoluyla kuralları kademeli olarak anlar. Benzer şekilde, bir LLM görev talimatlarını (System Prompt) almadan önce hangi araçları çağırabileceğini (dosya okuma, kod yazma, arama, komut çalıştırma) bilmelidir, böylece talimatları işlerken "ne yapabilirim" ve "nasıl yapmalıyım" sorularını doğru değerlendirebilir.

Eğer tersi olsaydı — modele önce "görevin bu modülü yeniden yapılandırmak", sonra "Read, Edit, Bash araçların var" deseydiniz — model görevi anlarken yetenek sınırları hakkında kritik bilgiden yoksun olurdu, potansiyel olarak gerçekçi olmayan planlar üretebilir veya mevcut yaklaşımları gözden kaçırabilirdi.

**Elindeki kartları bil, sonra nasıl oynayacağına karar ver.** Tools'un System'den önce gelmesinin arkasındaki bilişsel mantık budur.

## MCP araçları neden bu konumda?

MCP (Model Context Protocol) araçları, yerleşik araçlar gibi, Tools alanının en başına yerleştirilir. MCP'nin bağlamdaki konumunu anlamak, gerçek faydalarını ve maliyetlerini değerlendirmeye yardımcı olur.

### MCP Avantajları

- **Yetenek genişletme**: MCP, modellerin harici hizmetlere (veritabanı sorguları, API çağrıları, IDE işlemleri, tarayıcı kontrolü vb.) erişmesini sağlar ve yerleşik araçların sınırlarını aşar
- **Açık ekosistem**: Herkes bir MCP sunucusu uygulayabilir; model yeniden eğitim olmadan yeni yetenekler kazanır
- **İsteğe bağlı yükleme**: MCP sunucuları görev senaryosuna göre seçici olarak bağlanabilir/bağlantısı kesilebilir, esnek araç setleri oluşturulabilir

### MCP Maliyetleri

- **Önbellek katili**: Her MCP aracının JSON Schema tanımı KV-Cache ön ekinin en başına eklenir. Bir MCP aracı eklemek/kaldırmak = **tüm önbellek baştan geçersiz kılınır**. MCP sunucularını sık sık bağlama/bağlantı kesme, önbellek isabet oranını büyük ölçüde düşürür
- **Ön ek şişmesi**: MCP araç Şemaları genellikle yerleşik araçlardan daha büyüktür (ayrıntılı parametre açıklamaları, enum değerleri vb.). Çok sayıda MCP aracı, Tools alanındaki token sayısını önemli ölçüde artırır ve Messages için kullanılabilir bağlam alanını daraltır
- **Gecikme yükü**: MCP araç çağrıları süreçler arası iletişim gerektirir (stdio/SSE üzerinden JSON-RPC), yerleşik fonksiyon çağrılarından bir büyüklük derecesi daha yavaştır
- **Kararlılık riski**: MCP sunucuları çökebilen, zaman aşımına uğrayabilen veya beklenmeyen formatlar döndürebilen harici süreçlerdir ve ek hata işleme gerektirir

### Pratik Öneriler

| Senaryo | Öneri |
|---------|-------|
| Uzun konuşmalar, sık etkileşim | Önbellek ön eki kararlılığını korumak için MCP araç sayısını minimize edin |
| Kısa görevler, tek seferlik işlemler | MCP araçlarını serbestçe kullanın; önbellek etkisi sınırlıdır |
| Sık MCP sunucusu ekleme/kaldırma | Her değişiklik tam önbellek yeniden oluşturmayı tetikler; araç setini sabitlemeyi düşünün |
| Aşırı büyük Tool Şemaları | Ön ek token tüketimini azaltmak için açıklamaları ve enum'ları kısaltın |

cc-viewer'ın Context panelinde, MCP araçları yerleşik araçlarla birlikte Tools alanında görüntülenir ve her aracın Şema boyutunu ve önbellek ön ekine katkısını net bir şekilde gösterir.
