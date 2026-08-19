# WebFetch

Genel bir web sayfasının içeriklerini alır, HTML'i Markdown'a dönüştürür ve ihtiyacınız olan bilgiyi çıkarmak için sonuç üzerinde doğal dil promptuyla küçük bir yardımcı modeli çalıştırır.

## Ne Zaman Kullanılır

- Konuşmada bahsedilen genel bir dokümantasyon sayfası, blog yazısı veya RFC'yi okumak.
- Tam sayfayı bağlama yüklemeden bilinen bir URL'den belirli bir gerçek, kod parçacığı veya tablo çıkarmak.
- Açık bir web kaynağından yayın notlarını veya changelog'ları özetlemek.
- Kaynak yerel depoda olmadığında bir kitaplığın genel API referansını kontrol etmek.
- Takip sorusunu yanıtlamak için kullanıcının sohbete yapıştırdığı bir bağlantıyı takip etmek.

## Parametreler

- `url` (string, zorunlu): Tam biçimli mutlak URL. Düz `http://` otomatik olarak `https://`'e yükseltilir.
- `prompt` (string, zorunlu): Küçük çıkarma modeline geçirilen talimat. Sayfadan tam olarak neyi çıkaracağınızı açıklayın, örneğin "tüm dışa aktarılan fonksiyonları listele" veya "desteklenen minimum Node sürümünü döndür".

## Örnekler

### Örnek 1: Bir yapılandırma varsayılanını çıkarmak

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

Araç Vite dokümantasyon sayfasını alır, Markdown'a dönüştürür ve "Varsayılan `5173`'tür; yalnızca bir sayı kabul eder." gibi kısa bir yanıt döndürür.

### Örnek 2: Bir changelog bölümünü özetlemek

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Kullanıcı "Node 20.11'de neler değişti" diye sorduğunda ve yayın sayfası uzun olduğunda kullanışlıdır.

## Notlar

- `WebFetch`, kimlik doğrulama, çerezler veya VPN gerektiren herhangi bir URL'de başarısız olur. Google Docs, Confluence, Jira, özel GitHub kaynakları veya dahili wikiler için, bunun yerine kimlik doğrulamalı erişim sağlayan özel bir MCP sunucusu kullanın.
- GitHub'da barındırılan herhangi bir şey için (PR'lar, konular, dosya blob'ları, API yanıtları), web arayüzünü kazımak yerine `Bash` aracılığıyla `gh` CLI'yi tercih edin. `gh pr view`, `gh issue view` ve `gh api` yapılandırılmış veri döndürür ve özel depolarda çalışır.
- Alınan sayfa çok büyük olduğunda sonuçlar özetlenebilir. Tam metne ihtiyacınız varsa, literal bir alıntı istemek için `prompt`'u daraltın.
- URL başına kendi kendini temizleyen 15 dakikalık bir önbellek uygulanır. Bir oturum sırasında aynı sayfaya tekrarlanan çağrılar neredeyse anlıktır ancak biraz eski içerik döndürebilir. Tazelik önemliyse, promptta bahsedin veya önbelleği bekleyin.
- Hedef ana bilgisayar bir çapraz-ana bilgisayar yönlendirmesi verirse, araç özel bir yanıt bloğunda yeni URL'yi döndürür ve otomatik olarak takip etmez. Hala içeriği istiyorsanız yönlendirme hedefiyle `WebFetch`'i yeniden çağırın.
- Prompt, ana asistandan daha küçük, daha hızlı bir model tarafından yürütülür. Dar ve somut tutun; karmaşık çok adımlı akıl yürütme, alındıktan sonra ham Markdown'u kendiniz okuyarak daha iyi ele alınır.
- URL'e gömülü sırları, tokenları veya oturum tanımlayıcılarını asla geçirmeyin — sayfa içerikleri ve çıktıda yansıyan sorgu stringleri yukarı akış hizmetleri tarafından günlüğe kaydedilebilir.
