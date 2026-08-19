# ReportFindings

Kod incelemesi bulgularını, ana makine UI'sinin yerel olarak oluşturduğu yazılı, yapılandırılmış bir liste olarak rapor et — sohbet metni olarak yazdırma yerine.

## Ne Zaman Kullanılır

- Etkin talimatları bu araçla bulguları rapor etmesini açıkça söyleyen bir kod incelemesini sonuçlandırmak
- Düzeltmeler uygulandıktan sonra yeniden rapor verme, incelemenin uygulama talimatları bunu istediğinde (her bulgu daha sonra bir `outcome` taşır)
- **Değil** ad hoc görüşler, sıradan yanıtlar veya talimatlarının farklı bir çıktı biçimi belirttiği incelemeler için — ve asla aynı bulguların metin çoğaltması ile birlikte değil

## Parametreler

- `findings` (dizi, gerekli, maks 32): Doğrulanan bulgular, en ciddi ilk sırada — hiçbiri doğrulama geçmediyse boş dizi. Her bulgu:
  - `file` (dize, gerekli): Depo-göreceli yol.
  - `line` (sayı, isteğe bağlı): 1 indeksli çapa satırı.
  - `summary` (dize, gerekli): Kusurun tek cümlelik ifadesi.
  - `failure_scenario` (dize, gerekli): Somut girdiler/durum → yanlış çıktı veya çökme.
  - `category` (dize, isteğe bağlı): Kısa kebab-case kısaltması, ör. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (dize, isteğe bağlı): `CONFIRMED` veya `PLAUSIBLE` — bir doğrulama geçişi çalıştığında ayarlanır; satır içi incelemelerinde bulunmaz.
  - `outcome` (dize, isteğe bağlı): YALNIZ düzeltmelerden sonra yeniden raporlanırken — `fixed`, `skipped`, veya `no_change_needed`.
- `level` (dize, isteğe bağlı): İncelemenin üzerinde çalıştırıldığı çaba düzeyi — `low`, `medium`, `high`, `xhigh`, veya `max`.

## Notlar

- **Bir kez çağır.** Tam, doğrulanmış, ciddiyet derecesine göre sıralanmış listeyle tek bir çağrı — bulgu başına bir çağrı değil.
- **Boş geçerli bir sonuçtur.** Hiçbir bulgu doğrulamayı geçmediyse, zayıf bulgularla doldurmak yerine boş bir dizi bildir.
- **Metinde çoğaltma yapmayın.** Bu araç sonuçları rapor ettiğinde, bulgular sohbet mesajı olarak da yazdırılmamalıdır.
- **`outcome` yalnızca yeniden raporlama içindir.** İlk raporlamada ayarlanmamış bırakın; uygulama geçişinden sonra, her bulguda ne olduğunu ayarlayın.
