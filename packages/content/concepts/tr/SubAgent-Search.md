# SubAgent: Search

## Amaç

Search alt ajanı hafif, yalnızca-okuma bir keşif ajanıdır. Bir kod tabanını anlamanız gerektiğinde — bir şeyin nerede yaşadığını bulmak, bileşenlerin nasıl bir araya geldiğini öğrenmek veya yapısal soruları yanıtlamak — hiçbir dosyayı değiştirmeden gönderin. Ham arama çıktısı yerine özlü bir özet döndürerek, birçok dosya üzerinde birçok küçük okuma için optimize edilmiştir.

Search genel amaçlı bir asistan değildir. Kodu düzenleyemez, derlemeler çalıştıramaz, değişiklikleri commit edemez veya yalnızca-okuma almanın ötesinde ağ bağlantıları açamaz. Değeri, ana ajanın bağlamını tüketmeden büyük bir keşif bütçesini paralel olarak yakabilmesi ve ardından kompakt bir yanıt geri vermesidir.

## Ne Zaman Kullanılır

- Üç veya daha fazla farklı arama veya okuma gerektiren bir soruyu yanıtlamanız gerekiyor. Örnek: "Giriş rotasından oturum deposuna kadar kimlik doğrulama nasıl bağlanıyor?"
- Hedef bilinmiyor — hangi dosya, modül veya sembole bakacağınızı henüz bilmiyorsunuz.
- Değişiklik yapmadan önce deponun tanıdık olmayan bir alanında yapısal bir genel bakışa ihtiyacınız var.
- Birden fazla adayı çapraz referanslamak istersiniz (örneğin, benzer isimli yardımcılardan hangisinin gerçekten üretimde çağrıldığı).
- Edebiyat tarzı bir özete ihtiyacınız var: "X'i içe aktaran her yeri listele ve çağrı sitesine göre kategorilendir."

Search'ü şunlar için kullanmayın:

- Tam dosya ve satırı zaten biliyorsunuz. Doğrudan `Read` çağırın.
- Tek bir `Grep` veya `Glob` soruyu yanıtlayacak. Doğrudan çalıştırın; bir alt ajan göndermek ek yük ekler.
- Görev düzenleme, komut çalıştırma veya herhangi bir yan etki gerektirir. Search tasarım gereği yalnızca-okumadır.
- Bir araç çağrısının kelimesi kelimesine tam çıktısına ihtiyacınız var. Alt ajanlar özetler; ham sonuçları proxy etmezler.

## Ayrıntı Düzeyleri

Sorunun risklerine uyan düzeyi seçin.

- `quick` — birkaç hedefli arama, en iyi çaba yanıtı. Hızlı bir işaretçiye ihtiyacınız olduğunda (örneğin, "env-değişken ayrıştırma mantığı nerede?") ve yanıt eksikse yineleme yapmaktan rahat olduğunuzda kullanın.
- `medium` — varsayılan. Birkaç tur arama, adayları çapraz kontrol etme ve en ilgili dosyaları tam olarak okuma. Tipik "bu alanı anlamama yardım et" soruları için kullanın.
- `very thorough` — kapsamlı keşif. Alt ajan her makul ipucunu takip edecek, çevreleyen bağlamı okuyacak ve özetlemeden önce bulguları iki kez kontrol edecek. Doğruluğun önemli olduğu durumlarda (örneğin, güvenlik incelemesi, geçiş planlaması) veya eksik bir yanıtın yeniden çalışmaya neden olacağı durumlarda kullanın.

Daha yüksek ayrıntı düzeyi alt ajan içinde daha fazla zaman ve token maliyetlidir, ancak bu tokenlar alt ajan içinde kalır — yalnızca nihai özet ana ajana döner.

## Mevcut Araçlar

Search, ana ajanın kullandığı tüm yalnızca-okuma araçlara erişebilir ve başka hiçbir şeye erişemez:

- `Read` — belirli dosyaları okumak için, kısmi aralıklar dahil.
- `Grep` — ağaç genelinde içerik aramaları için.
- `Glob` — ad desenine göre dosya bulmak için.
- Yalnızca-okuma modunda `Bash` — durumu değiştirmeden inceleyen komutlar için (örneğin `git log`, `git show`, `ls`, `wc`).
- `WebFetch` ve `WebSearch` — bu bağlam gerektiğinde dış dokümantasyonu okumak için.

Düzenleme araçları (`Write`, `Edit`, `NotebookEdit`), durumu değiştiren kabuk komutları ve görev-grafiği araçları (`TaskCreate`, `TaskUpdate` vb.) kasıtlı olarak mevcut değildir.

## Notlar

- Search alt ajanına bir konu değil, belirli bir soru verin. "`renderMessage`'ın her çağrıcısını listele ve hangilerinin özel bir tema geçtiğini not et" yararlı bir yanıt döndürür; "render hakkında bana bilgi ver" döndürmez.
- Alt ajan bir özet döndürür. Tam dosya yollarına ihtiyacınız varsa, promptunuzda bunları açıkça isteyin.
- Birden fazla bağımsız soru tek bir uzun prompt yerine paralel Search alt ajanları olarak gönderildiğinde en iyidir, böylece her biri odaklanabilir.
- Search düzenleyemediğinden, neyi değiştireceğinizi bildiğinizde ana ajanda bir takip düzenleme adımıyla eşleştirin.
- Search çıktısını temel doğruluk olarak değil, kanıt olarak ele alın. Taşıyıcı herhangi bir şey için harekete geçmeden önce alıntılanan dosyaları kendiniz açın.
