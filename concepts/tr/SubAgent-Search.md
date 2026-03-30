# SubAgent: Search

## Tanım

Search, kod tabanında arama yapmak üzere Claude Code'un ana agent'ı tarafından oluşturulan bir sub-agent türüdür. Glob, Grep ve Read gibi araçları kullanarak hedefli dosya ve içerik aramaları gerçekleştirir, ardından sonuçları üst agent'a döndürür.

## Davranış

- Ana agent'ın kod tabanını araması veya keşfetmesi gerektiğinde otomatik olarak oluşturulur
- Salt okunur erişimle izole bir bağlamda çalışır
- Dosya deseni eşleştirme için Glob, içerik arama için Grep ve dosya inceleme için Read kullanır
- Arama sonuçlarını daha fazla işlenmek üzere üst agent'a döndürür

## Ne Zaman Görünür

Search sub-agent'ları genellikle şu durumlarda görünür:

1. Ana agent'ın belirli dosyaları, fonksiyonları veya kod desenlerini bulması gerektiğinde
2. Kullanıcı tarafından geniş kapsamlı bir kod tabanı keşfi talep edildiğinde
3. Agent bağımlılıkları, referansları veya kullanım desenlerini araştırdığında
