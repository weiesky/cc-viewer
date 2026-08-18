# LSP

Kod zekâsı için Language Server Protocol (LSP) sunucularını sorgular — tanımlar, referanslar, hover'lar, semboller, uygulamalar ve çağrı hiyerarşisi. Kodu anlamsal olarak anladığı için metin aramasından daha kesindir.

## Ne Zaman Kullanılır

- Bir sembolün tanımına atlamak (`goToDefinition`) veya her referansı bulmak (`findReferences`)
- Bir sembol için tür imzalarını / belgeleri okumak (`hover`)
- Tek bir dosyadaki sembolleri listelemek (`documentSymbol`) veya proje genelinde aramak (`workspaceSymbol`)
- Bir arayüzün veya soyut yöntemin uygulamalarını bulmak (`goToImplementation`)
- Bir fonksiyonun çağrı hiyerarşisinde gezinmek (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Etkinleştirme

- Dil için bir kod zekâsı eklentisi yüklenene kadar etkin değildir (sunucu ikilisi ayrı olarak yüklenir).
- Araç yalnızca bir LSP istemcisi bağlandığında görünür.

## Parametreler

- `operation` (string, zorunlu): yukarıda listelenen işlemlerden biri.
- `filePath` (string, zorunlu): üzerinde işlem yapılacak dosya.
- `line` (number, zorunlu): editörde gösterildiği gibi 1 tabanlı satır numarası.
- `character` (number, zorunlu): editörde gösterildiği gibi 1 tabanlı karakter ofseti.

## Notlar

- O dosya türü için yapılandırılmış bir LSP sunucusu gerektirir; aksi takdirde çağrı bir hata döndürür.
- Satır ve karakter 0 tabanlı değil, 1 tabanlıdır (editör koordinatları).
- Metinsel bir eşleşme yerine anlamsal gezinmeye (gerçek tanım/referans) ihtiyaç duyduğunuzda `Grep` yerine LSP'yi tercih edin.

## İlgili Kavramlar

- Kodda gezinirken ve onu değiştirirken `Read` ve `Edit`'i tamamlar.
