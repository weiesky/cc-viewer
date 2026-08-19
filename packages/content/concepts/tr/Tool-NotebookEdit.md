# NotebookEdit

Bir Jupyter notebook'undaki (`.ipynb`) tek bir hücreyi değiştirir. Notebook yapısının geri kalanını koruyarak bir hücrenin kaynağını değiştirmeyi, yeni bir hücre eklemeyi veya var olan bir hücreyi silmeyi destekler.

## Ne Zaman Kullanılır

- Bir analiz notebook'undaki kod hücresini tüm dosyayı yeniden yazmadan düzeltmek veya güncellemek
- Anlatıyı iyileştirmek veya belge eklemek için bir markdown hücresini değiştirmek
- Var olan bir notebook'ta bilinen bir konuma yeni bir kod veya markdown hücresi eklemek
- Aşağı akış hücreleri artık ona bağımlı olmasın diye eski veya bozuk bir hücreyi kaldırmak
- Hücreler üzerinde tek tek yineleyerek yeniden üretilebilir bir notebook hazırlamak

## Parametreler

- `notebook_path` (string, zorunlu): `.ipynb` dosyasının mutlak yolu. Göreceli yollar reddedilir.
- `new_source` (string, zorunlu): Yeni hücre kaynağı. `replace` ve `insert` için hücre gövdesi olur; `delete` için yok sayılır ancak şema tarafından hala gereklidir.
- `cell_id` (string, opsiyonel): Hedef hücrenin ID'si. `replace` ve `delete` modlarında, araç bu hücre üzerinde çalışır. `insert` modunda, yeni hücre bu ID'ye sahip hücrenin hemen ardından eklenir; notebook'un başına eklemek için atlayın.
- `cell_type` (enum, opsiyonel): `code` veya `markdown`. `edit_mode` `insert` olduğunda gereklidir. `replace` sırasında atlandığında, mevcut hücrenin türü korunur.
- `edit_mode` (enum, opsiyonel): `replace` (varsayılan), `insert` veya `delete`.

## Örnekler

### Örnek 1: Hatalı bir kod hücresini değiştirmek
`notebook_path`'i mutlak yola, `cell_id`'i hedef hücrenin ID'sine ve `new_source`'u düzeltilmiş Python kodunu içerecek şekilde ayarlayarak `NotebookEdit`'i çağırın. `edit_mode`'u varsayılan `replace`'te bırakın.

### Örnek 2: Markdown açıklaması eklemek
Var olan bir `setup` hücresinden hemen sonra markdown hücresi eklemek için `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id`'i setup hücresinin ID'sine ayarlayın ve anlatıyı `new_source`'a koyun.

### Örnek 3: Eski bir hücreyi silmek
`edit_mode: "delete"` olarak ayarlayın ve kaldırılacak hücrenin `cell_id`'sini sağlayın. `new_source` için herhangi bir string sağlayın; uygulanmaz.

## Notlar

- Her zaman mutlak bir yol geçirin. `NotebookEdit` göreceli yolları çalışma dizinine göre çözmez.
- Araç yalnızca hedeflenen hücreyi yeniden yazar; ilgisiz hücrelerin yürütme sayıları, çıktıları ve meta verileri dokunulmamış kalır.
- `cell_id` olmadan eklemek, yeni hücreyi notebook'un en başına yerleştirir.
- `cell_type` eklemeler için zorunludur. Değiştirmeler için, bir kod hücresini markdown'a veya tam tersine dönüştürmek istemediğiniz sürece atlayın.
- Hücreleri incelemek ve ID'lerini almak için önce notebook'ta `Read` aracını kullanın; hücreleri içerikleri ve çıktılarıyla birlikte döndürür.
- Düz kaynak dosyaları için normal `Edit` kullanın; `NotebookEdit` `.ipynb` JSON'a özgüdür ve hücre yapısını anlar.
