# Bash

Kalıcı bir çalışma dizini içinde bir kabuk komutu çalıştırır ve stdout/stderr'ini döndürür. git, npm, docker veya derleme betikleri gibi hiçbir özel Claude Code aracının ifade edemediği işlemler için saklanması en iyisidir.

## Ne Zaman Kullanılır

- Git işlemlerini yürütmek (`git status`, `git diff`, `git commit`, `gh pr create`)
- Paket yöneticilerini ve derleme araçlarını çalıştırmak (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Uzun çalışan süreçleri (dev sunucuları, izleyiciler) `run_in_background` ile arka planda başlatmak
- Yerleşik karşılığı olmayan alana özgü CLI'leri (`docker`, `terraform`, `kubectl`, `gh`) çağırmak
- Sıralama önemli olduğunda bağımlı adımları `&&` ile birbirine zincirlemek

## Parametreler

- `command` (string, zorunlu): Yürütülecek tam kabuk komutu.
- `description` (string, zorunlu): Kısa, etken sesli bir özet (basit komutlar için 5-10 kelime; borulu veya belirsiz olanlar için daha fazla bağlam).
- `timeout` (number, opsiyonel): Milisaniye cinsinden zaman aşımı, `600000`'a (10 dakika) kadar. Varsayılan `120000` (2 dakika).
- `run_in_background` (boolean, opsiyonel): `true` olduğunda komut ayrık çalışır ve tamamlandığında bildirim alırsınız. Kendiniz `&` eklemeyin.

## Örnekler

### Örnek 1: Commit öncesi depo durumunu incelemek
Bağlamı hızlıca toplamak için aynı mesajda `git status` ve `git diff --stat`'i iki paralel `Bash` çağrısı olarak yayınlayın, sonra commit'i bir takip çağrısında oluşturun.

### Örnek 2: Bağımlı derleme adımlarını zincirlemek
Her adımın yalnızca önceki başarılı olduktan sonra çalışması için `npm ci && npm run build && npm test` gibi tek bir çağrı kullanın. Sonraki adımların başarısızlıktan sonra bile çalışmasını kasıtlı olarak istiyorsanız yalnızca `;` kullanın.

### Örnek 3: Uzun çalışan dev sunucusu
`npm run dev`'i `run_in_background: true` ile çağırın. Çıktığında bildirim alacaksınız. `sleep` döngüleriyle yoklama yapmayın; körü körüne tekrar denemek yerine hataları teşhis edin.

## Notlar

- Çalışma dizini çağrılar arasında kalıcıdır, ancak kabuk durumu (dışa aktarılan değişkenler, kabuk fonksiyonları, takma adlar) kalıcı değildir. Mutlak yolları tercih edin ve kullanıcı istemedikçe `cd`'den kaçının.
- Borulu kabuk eşdeğerleri yerine özel araçları tercih edin: `find`/`ls` yerine `Glob`, `grep`/`rg` yerine `Grep`, `cat`/`head`/`tail` yerine `Read`, `sed`/`awk` yerine `Edit`, `echo >` veya heredocs yerine `Write` ve kullanıcıya yönelik çıktı için `echo`/`printf` yerine düz asistan metni.
- Boşluk içeren herhangi bir yolu çift tırnak ile alıntılayın (örneğin `"/Users/me/My Project/file.txt"`).
- Bağımsız komutlar için tek bir mesaj içinde paralel olarak birden fazla `Bash` aracı çağrısı yapın. Yalnızca bir komut diğerine bağlı olduğunda `&&` ile zincirleyin.
- 30000 karakter üzerindeki çıktı kesilir. Büyük günlükleri yakalarken bir dosyaya yönlendirin ve sonra `Read` aracıyla okuyun.
- `git rebase -i` veya `git add -i` gibi etkileşimli bayraklar asla kullanmayın; bu araç üzerinden girdi alamazlar.
- Kullanıcı açıkça istemedikçe git kancalarını (`--no-verify`, `--no-gpg-sign`) atlamayın veya yıkıcı işlemler (`reset --hard`, `push --force`, `clean -f`) gerçekleştirmeyin.
