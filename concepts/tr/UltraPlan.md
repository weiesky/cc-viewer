# UltraPlan — Nihai Dilek Makinesi

## UltraPlan Nedir

UltraPlan, cc-viewer'in Claude Code'un yerel `/ultraplan` komutunun **yerelleştirilmiş uygulamasıdır**. `/ultraplan`'ın tüm yeteneklerini **Claude'un resmi uzak hizmetini başlatmaya gerek kalmadan** yerel ortamınızda kullanmanızı sağlar ve Claude Code'u **çoklu ajan işbirliği** kullanarak karmaşık planlama ve uygulama görevlerini yerine getirmeye yönlendirir.

Normal Plan modu veya Agent Team ile karşılaştırıldığında, UltraPlan şunları yapabilir:
- Farklı görev türlerine uygun **Kod uzmanı** ve **Araştırma uzmanı** rolleri sunar
- Kod tabanını keşfetmek veya farklı boyutlardan araştırma yapmak için birden fazla paralel ajan dağıtır
- Sektördeki en iyi uygulamalar için harici araştırma (webSearch) dahil etmek
- Plan yürütmesinden sonra kod incelemesi için otomatik olarak bir Code Review Ekibi oluşturmak
- Tam bir **Planla → Yürüt → İncele → Düzelt** kapalı döngüsü oluşturmak

---

## Önemli Notlar

### 1. UltraPlan Her Şeye Kadir Değildir
UltraPlan daha güçlü bir dilek makinesidir, ancak bu her dileğin gerçekleştirilebileceği anlamına gelmez. Plan ve Agent Team'den daha güçlüdür, ancak doğrudan "size para kazandıramaz". Makul görev ayrıntı düzeyini göz önünde bulundurun — her şeyi tek seferde başarmaya çalışmak yerine büyük hedefleri yürütülebilir orta ölçekli görevlere bölün.

### 2. Şu Anda Programlama Projeleri İçin En Etkili
UltraPlan'ın şablonları ve iş akışları, programlama projeleri için derinlemesine optimize edilmiştir. Diğer senaryolar (dokümantasyon, veri analizi vb.) denenebilir, ancak gelecek sürüm uyarlamalarını beklemek isteyebilirsiniz.

### 3. Yürütme Süresi ve Bağlam Penceresi Gereksinimleri
- Başarılı bir UltraPlan çalıştırması genellikle **30 dakika veya daha fazla** sürer
- MainAgent'in büyük bir bağlam penceresine sahip olmasını gerektirir (1M bağlamlı Opus modeli önerilir)
- Yalnızca 200K modeliniz varsa, **çalıştırmadan önce bağlamı `/clear` ile temizlediğinizden emin olun**
- Claude Code'un `/compact` komutu bağlam penceresi yetersiz olduğunda kötü performans gösterir — alanın tükenmesinden kaçının
- Yeterli bağlam alanını korumak, başarılı UltraPlan yürütmesi için kritik bir ön koşuldur

Yerelleştirilmiş UltraPlan hakkında sorularınız veya önerileriniz varsa, tartışmak ve işbirliği yapmak için [GitHub'da Issues](https://github.com/anthropics/claude-code/issues) açmaktan çekinmeyin.

---

## Nasıl Çalışır

UltraPlan, farklı görev türleri için iki uzman rolü sunar:

### Kod uzmanı
Programlama projeleri için tasarlanmış çoklu ajan iş akışı:
1. Kod tabanını aynı anda keşfetmek için en fazla 5 paralel ajan dağıtma (mimari, dosya tanımlama, risk değerlendirmesi vb.)
2. İsteğe bağlı olarak webSearch aracılığıyla sektör çözümlerini araştırmak için bir araştırma ajanı dağıtma
3. Tüm ajan bulgularını detaylı bir uygulama planında sentezleme
4. Planı birden fazla perspektiften incelemek için bir inceleme ajanı dağıtma
5. Onaylandıktan sonra planı yürütme
6. Uygulamadan sonra kod kalitesini doğrulamak için otomatik olarak Code Review Team oluşturma

### Araştırma uzmanı
Araştırma ve analiz görevleri için tasarlanmış çoklu ajan iş akışı:
1. Farklı boyutlardan araştırma yapmak için birden fazla paralel ajan dağıtma (sektör araştırmaları, akademik makaleler, haberler, rekabet analizi vb.)
2. Toplanan kaynakların titizliğini ve güvenilirliğini doğrularken hedef çözümü sentezlemek için bir ajan atama
3. İsteğe bağlı olarak ürün demosu oluşturmak için bir ajan dağıtma (HTML, Markdown vb.)
4. Tüm bulguları kapsamlı bir uygulama planında sentezleme
5. Planı farklı roller ve perspektiflerden incelemek için birden fazla inceleme ajanı dağıtma
6. Onaylandıktan sonra planı yürütme
