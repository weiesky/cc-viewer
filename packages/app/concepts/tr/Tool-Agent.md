# Agent

Kendi bağlam penceresine sahip, odaklanmış bir görevi yürütüp tek bir birleştirilmiş sonuç döndüren otonom bir Claude Code alt ajanını başlatır. Açık uçlu araştırmaları, paralel çalışmaları veya ekip iş birliğini devretmek için kullanılan başlıca mekanizmadır.

## Ne Zaman Kullanılır

- Hangi dosyaların ilgili olduğunu henüz bilmediğiniz ve birden fazla tur `Glob`, `Grep` ve `Read` gerektirmesini beklediğiniz açık uçlu aramalar.
- Paralel bağımsız çalışma — ayrı alanları eş zamanlı olarak incelemek için tek bir mesajda birkaç ajan başlatın.
- Üst bağlamın derli toplu kalması için gürültülü keşfi ana konuşmadan izole etmek.
- `Explore`, `Plan`, `claude-code-guide` veya `statusline-setup` gibi özelleşmiş bir alt ajan türüne devretmek.
- Koordineli çoklu-ajan çalışması için aktif bir ekibe isimlendirilmiş bir takım arkadaşı dahil etmek.

Hedef dosya veya sembol zaten biliniyorsa KULLANMAYIN — doğrudan `Read`, `Grep` veya `Glob` kullanın. `Agent` üzerinden tek adımlık bir sorgu tam bir bağlam penceresini israf eder ve gecikme ekler.

## Parametreler

- `description` (string, zorunlu): Görevi tanımlayan kısa 3-5 kelimelik etiket; arayüzde ve günlüklerde gösterilir.
- `prompt` (string, zorunlu): Ajanın yürüteceği eksiksiz, kendi kendine yeterli brifing. Gerekli tüm bağlamı, kısıtları ve beklenen dönüş formatını içermelidir.
- `subagent_type` (string, opsiyonel): `general-purpose`, `Explore`, `Plan`, `claude-code-guide` veya `statusline-setup` gibi önceden tanımlı persona. Varsayılan olarak `general-purpose`.
- `run_in_background` (boolean, opsiyonel): True ise ajan eş zamansız çalışır ve üst ajan çalışmaya devam edebilir; sonuçlar daha sonra alınır.
- `model` (string, opsiyonel): Bu ajan için modeli geçersiz kılar — `opus`, `sonnet` veya `haiku`. Varsayılan olarak üst oturum modelini kullanır.
- `isolation` (string, opsiyonel): Ajanı izole bir git worktree içinde çalıştırmak için `worktree` olarak ayarlayın; böylece dosya sistemi yazımları üst ile çakışmaz.
- `team_name` (string, opsiyonel): Var olan bir ekibe dahil edilirken, ajanın katılacağı ekip tanımlayıcısı.
- `name` (string, opsiyonel): Ekip içinde adreslenebilir takım arkadaşı adı; `SendMessage` için `to` hedefi olarak kullanılır.

## Örnekler

### Örnek 1: Açık uçlu kod araması

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Örnek 2: Paralel bağımsız incelemeler

Aynı mesajda iki ajan başlatın — biri derleme hattını inceler, diğeri test altyapısını gözden geçirir. Her biri kendi bağlam penceresini alır ve bir özet döndürür. Tek bir tool-call bloğunda toplu iletişim kurmak onları eş zamanlı çalıştırır.

### Örnek 3: Çalışan bir ekibe takım arkadaşı dahil etme

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Notlar

- Ajanların önceki çalıştırmalara dair belleği yoktur. Her çağrı sıfırdan başlar, bu yüzden `prompt` tamamen kendi kendine yeterli olmalıdır — dosya yollarını, kuralları, soruyu ve istediğiniz yanıtın tam şeklini ekleyin.
- Ajan tam olarak tek bir nihai mesaj döndürür. Çalışma sırasında açıklayıcı sorular soramaz, bu yüzden prompttaki belirsizlik sonuçta tahmine dönüşür.
- Alt görevler bağımsız olduğunda birden fazla ajanı paralel çalıştırmak sıralı çağrılardan önemli ölçüde daha hızlıdır. Onları tek bir tool-call bloğunda toplu olarak gönderin.
- Ajan dosya yazacaksa ve değişiklikleri ana çalışma ağacına birleştirmeden önce incelemek istiyorsanız `isolation: "worktree"` kullanın.
- Yalnızca okumalı keşifler için `subagent_type: "Explore"`, tasarım çalışmaları için `Plan` tercih edin; `general-purpose` karışık okuma/yazma görevleri için varsayılandır.
- Arka plan ajanları (`run_in_background: true`) uzun süren işler için uygundur; bir sleep döngüsünde yoklama yapmaktan kaçının — üst ajan tamamlandığında bildirim alır.
