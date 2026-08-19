# Skill

Mevcut konuşmanın içinde isimlendirilmiş bir skill çağırır. Skill'ler, harness'in sistem hatırlatıcıları aracılığıyla asistana sunduğu önceden paketlenmiş yetenek paketleridir — alan bilgisi, iş akışları ve bazen araç erişimi.

## Ne Zaman Kullanılır

- Kullanıcı `/review` veya `/init` gibi bir slash komutu yazar — slash komutları skill'lerdir ve bu araç üzerinden yürütülmelidir.
- Kullanıcı, reklamı yapılan bir skill'in tetik koşullarıyla eşleşen bir görevi tanımlar (örneğin, tekrarlanan izin istemleri için transkriptleri taramayı istemek `fewer-permission-prompts` ile eşleşir).
- Bir skill'in belirtilen amacı, mevcut dosya, istek veya konuşma bağlamıyla doğrudan eşleşir.
- Özelleşmiş, tekrarlanabilir iş akışları skill olarak mevcuttur ve standart prosedür ad-hoc bir yaklaşıma tercih edilir.
- Kullanıcı "hangi skill'ler mevcut" diye sorar — reklamı yapılan adları listeleyin ve yalnızca onaylarlarsa çağırın.

## Parametreler

- `skill` (string, zorunlu): Mevcut available-skills sistem hatırlatıcısında listelenen bir skill'in tam adı. Eklenti-namespace'li skill'ler için tam nitelikli `plugin:skill` formunu kullanın (örneğin `skill-creator:skill-creator`). Başına slash koymayın.
- `args` (string, opsiyonel): Skill'e geçirilen serbest biçimli argümanlar. Format ve anlam her skill'in kendi dokümantasyonu tarafından tanımlanır.

## Örnekler

### Örnek 1: Mevcut dalda bir inceleme skill'i çalıştırmak

```
Skill(skill="review")
```

`review` skill'i, mevcut base dala karşı bir pull request'i incelemek için adımları paketler. Çağırmak, harness tarafından tanımlanan inceleme prosedürünü tura yükler.

### Örnek 2: Eklenti-namespace'li bir skill'i argümanlarla çağırmak

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Yazım iş akışının devreye girmesi için isteği `skill-creator` eklentisinin giriş noktası aracılığıyla yönlendirir.

## Notlar

- Yalnızca adları available-skills sistem hatırlatıcısında aynen görünen veya kullanıcının mesajında doğrudan `/name` olarak yazdığı skill'leri çağırın. Bellekten veya eğitim verilerinden asla skill adları tahmin etmeyin veya uydurmayın — skill reklamı yapılmamışsa, bu aracı çağırmayın.
- Bir kullanıcının isteği reklamı yapılan bir skill ile eşleştiğinde, `Skill` çağırmak bloklayıcı bir önkoşuldur: görev hakkında başka herhangi bir yanıt üretmeden önce onu çağırın. Skill'in ne yapacağını tarif etmeyin — çalıştırın.
- Aslında çağırmadan bir skill'den asla adıyla bahsetmeyin. Aracı çağırmadan bir skill'i duyurmak yanıltıcıdır.
- `/help`, `/clear`, `/model` veya `/exit` gibi yerleşik CLI komutları için `Skill` kullanmayın. Bunlar harness tarafından doğrudan ele alınır.
- Mevcut turda zaten çalışan bir skill'i yeniden çağırmayın. Mevcut turda bir `<command-name>` etiketi görürseniz, skill zaten yüklenmiştir — aracı tekrar çağırmak yerine talimatlarını yerinde izleyin.
- Birkaç skill uygulanabilirse, en spesifik olanı seçin. İzinler veya kancalar eklemek gibi yapılandırma değişiklikleri için, genel bir ayarlar yaklaşımı yerine `update-config`'i tercih edin.
- Skill yürütme, turun geri kalanı için yeni sistem hatırlatıcıları, araçlar veya kısıtlar tanıtabilir. Bir skill tamamlandıktan sonra devam etmeden önce konuşma durumunu yeniden okuyun.
