# Workflow

Tek bir bağlam için fazla geniş, fazla belirsiz veya fazla büyük işler için birçok alt ajanı deterministik biçimde düzenleyen bir betik çalıştırır — fan-out, hatlar, döngüler ve doğrulama.

## Ne Zaman Kullanılır

- Büyük bir görevi ayrıştırmak ve birçok ajan arasında paralel olarak kapsamak
- Bulguları, onlara bağlanmadan önce bağımsız veya çekişmeli doğrulamayla çapraz kontrol etmek
- Tek bir bağlamın taşıyamayacağı ölçeği üstlenmek: göçler, denetimler, geniş çok dosyalı taramalar

## Nasıl Çalışır

- Arka planda çalışır; bittiğinde bildirim alırsınız. Canlı ilerlemeyi `/workflows` ile izleyin.
- Betik, ajanları `agent()`, `parallel()`, `pipeline()` ve `phase()` ile koordine eder.
- `pipeline()` her öğeyi bariyer olmadan aşamalardan akıtır (varsayılan); `parallel()` ise tüm sonuçları bekleyen bir bariyerdir.
- Bir schema ile her `agent()`, serbest metin yerine doğrulanmış yapılandırılmış veri döndürür.

## Notlar

- Yalnızca kullanıcı çoklu-ajan düzenlemesini açıkça seçtiğinde çalışır; birçok ajan oluşturabilir ve önemli miktarda token tüketebilir.
- Eşzamanlılık workflow başına sınırlandırılmıştır; fazla ajanlar kuyruğa girer ve yerler boşaldıkça çalışır.
- Tek bir alt ajan için bunun yerine `Agent` aracını kullanın — Workflow'u gerçek fan-out için saklayın.

## İlgili Kavramlar

- `Agent` aracının üzerine inşa edilir; birçok ajanı deterministik akış kontrolü altında çalıştırır.
