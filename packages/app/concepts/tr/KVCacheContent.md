# KV-Cache Önbellek İçeriği

## Prompt Caching Nedir?

Claude ile sohbet ettiğinizde, her API isteği tam konuşma bağlamını (system prompt + araç tanımları + geçmiş mesajlar) gönderir. Anthropic'in prompt caching mekanizması, daha önce hesaplanmış önek içeriğini sunucuda önbelleğe alır; sonraki isteklerde önek aynıysa, önbellek sonuçları doğrudan yeniden kullanılır ve tekrarlanan hesaplamalar atlanır, bu da gecikmeyi ve maliyeti büyük ölçüde azaltır.

cc-viewer'da bu mekanizma "KV-Cache" olarak adlandırılır ve Anthropic API düzeyindeki prompt caching'e karşılık gelir; LLM içindeki transformer dikkat katmanlarının key-value cache'i değildir.

## Önbellek Nasıl Çalışır

Anthropic'in prompt caching özelliği, önbellek anahtarlarını sabit bir sırayla birleştirir:

```
Tools → System Prompt → Messages (cache breakpoint'e kadar)
```

Bu önek, TTL penceresi içindeki herhangi bir önceki istekle tamamen aynı olduğu sürece, API önbelleği vurur (`cache_read_input_tokens` döndürür) ve yeniden hesaplama yapmaz (`cache_creation_input_tokens`).

> **Claude Code `cache_control` özelliğine sıkı sıkıya bağlı değildir; sunucu bu özelliklerin bir kısmını kaldırarak iş birliği yapar, ancak yine de önbelleği başarıyla oluşturabilir. Bu nedenle `cache_control` özelliğini görmemek, önbelleğe alınmadığı anlamına gelmez**
>
> Claude Code gibi özel istemciler için, Anthropic sunucusu önbellek davranışını belirlemek için istekteki `cache_control` özelliğine tamamen bağımlı değildir. Sunucu, belirli alanlar (system prompt, araç tanımları gibi) için otomatik olarak önbellek politikası uygular; istekte açıkça `cache_control` etiketi olmasa bile. Bu nedenle, istek gövdesinde bu özelliği görmediğinizde şaşırmayın — sunucu arka planda önbellek işlemini zaten tamamlamıştır, sadece bu bilgiyi istemciye açıklamamıştır. Bu, Claude Code ile Anthropic API arasındaki örtük bir anlaşmadır.

## "Mevcut KV-Cache Önbellek İçeriği" Nedir?

cc-viewer'da gösterilen "Mevcut KV-Cache Önbellek İçeriği", en son MainAgent isteğinden çıkarılan ve önbellek sınırının (cache breakpoint) öncesinde yer alan içeriktir. Özellikle şunları içerir:

- **System Prompt**: Claude Code'un sistem talimatları; temel agent talimatları, araç kullanım kuralları, CLAUDE.md proje talimatları, ortam bilgisi vb. dahil
- **Tools**: Mevcut kullanılabilir araç tanımlarının listesi (Read, Write, Bash, Agent, MCP araçları vb.)
- **Messages**: Konuşma geçmişinin önbelleğe alınan kısmı (genellikle daha eski mesajlar, son `cache_control` etiketine kadar)

## Neden Önbellek İçeriğini Görüntülemelisiniz?

1. **Bağlamı Anlama**: Claude'un şu anda "hatırladığı" içeriği bilin ve davranışının beklentilerinize uygun olup olmadığını değerlendirmenize yardımcı olun
2. **Maliyet Optimizasyonu**: Önbellek isabetlerinin maliyeti yeniden hesaplamadan çok daha düşüktür. Önbellek içeriğini görüntülemek, belirli isteklerin neden önbellek yeniden oluşturmayı (cache rebuild) tetiklediğini anlamanıza yardımcı olur
3. **Konuşma Hata Ayıklama**: Claude'un yanıtı beklentilerinize uymadığında, önbellek içeriğini kontrol ederek system prompt ve geçmiş mesajların doğru olduğunu onaylayabilirsiniz
4. **Bağlam Kalitesi İzleme**: Hata ayıklama, yapılandırma değiştirme veya prompt ayarlama sırasında, KV-Cache-Text merkezi bir bakış açısı sağlar ve temel bağlamın bozulmadığını ya da beklenmedik içerikle kirlenmediğini hızlıca doğrulamanıza yardımcı olur — orijinal mesajları tek tek gözden geçirmeye gerek kalmadan

## Çok Katmanlı Önbellek Stratejisi

Claude Code'a karşılık gelen KV-Cache tek bir kopyadan ibaret değildir. Sunucu, Tools ve System Prompt için Messages kısmından bağımsız olarak ayrı önbellekler oluşturur. Bu tasarımın avantajı şudur: mesaj yığınında karışıklık olduğunda (bağlam kısaltma, mesaj değiştirme vb.) yeniden oluşturma gerektiğinde, Tools ve System Prompt önbelleği de birlikte geçersiz olmaz ve tüm yeniden hesaplama önlenir.

Bu, mevcut aşamada sunucu tarafındaki bir optimizasyon stratejisidir — çünkü araç tanımları ve System Prompt normal kullanım sırasında oldukça kararlıdır ve nadiren değişir; bunları ayrı ayrı önbelleğe almak gereksiz yeniden oluşturma maliyetini en aza indirir. Bu nedenle önbelleği gözlemlediğinizde, Tools yeniden oluşturmanın tüm önbelleğin yeniden yüklenmesini gerektirmesi dışında, System Prompt ve Messages hasarının hâlâ miras alınabilir bir önbellek bıraktığını fark edeceksiniz.

## Önbelleğin Yaşam Döngüsü

- **Oluşturma**: İlk istekte veya önbellek sona erdikten sonra, API yeni bir önbellek oluşturur (`cache_creation_input_tokens`)
- **İsabet**: Sonraki isteklerin öneki tutarlı olduğunda, önbellek yeniden kullanılır (`cache_read_input_tokens`)
- **Sona Erme**: Önbelleğin 5 dakikalık bir TTL'si (yaşam süresi) vardır ve bu sürenin ardından otomatik olarak sona erer
- **Yeniden Oluşturma**: System prompt, araç listesi, model veya mesaj içeriği değiştiğinde, önbellek anahtarı eşleşmez ve ilgili düzeyde önbellek yeniden oluşturma tetiklenir
