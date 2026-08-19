# EnterWorktree

Yeni bir dal üzerinde izole bir Git worktree oluşturur veya oturumu mevcut deponun var olan bir worktree'sine geçirir; böylece paralel veya deneysel çalışma, birincil checkout'a dokunmadan ilerleyebilir.

## Ne Zaman Kullanılır

- Kullanıcı açıkça "worktree" diyor — örneğin "bir worktree başlat", "bir worktree oluştur" veya "bir worktree'de çalış".
- `CLAUDE.md` veya kalıcı bellekteki proje talimatları, mevcut görev için worktree kullanmanızı yönlendirir.
- Daha önce worktree olarak kurulmuş bir göreve devam etmek istersiniz (yeniden girmek için `path` geçirin).
- Birden fazla deneysel dalın, sürekli checkout karışıklığı olmadan diskte bir arada bulunması gerekir.
- Uzun süren bir görevin, ana çalışma ağacındaki ilgisiz düzenlemelerden yalıtılması gerekir.

## Parametreler

- `name` (string, opsiyonel): Yeni bir worktree dizini için ad. Her `/`-ayrılmış segment yalnızca harfler, rakamlar, noktalar, alt çizgiler ve tireler içerebilir; tüm string 64 karakterle sınırlıdır. Atlanır ve `path` de atlanırsa, rastgele bir ad oluşturulur. `path` ile karşılıklı olarak birbirini dışlar.
- `path` (string, opsiyonel): Mevcut deponun geçiş yapılacak var olan bir worktree'sinin dosya sistemi yolu. Bu depo için `git worktree list`'te görünmelidir; mevcut deponun kayıtlı worktree'leri olmayan yollar reddedilir. `name` ile karşılıklı olarak birbirini dışlar.

## Örnekler

### Örnek 1: Açıklayıcı bir adla yeni bir worktree oluşturmak

```
EnterWorktree(name="feat/okta-sso")
```

`HEAD`'e dayanan yeni bir dal üzerinde `.claude/worktrees/feat/okta-sso`'yu oluşturur, sonra oturumun çalışma dizinini ona geçirir. Sonraki tüm dosya düzenlemeleri ve kabuk komutları, çıkana kadar o worktree'nin içinde çalışır.

### Örnek 2: Var olan bir worktree'ye yeniden girmek

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Daha önce oluşturulmuş bir worktree'de çalışmaya devam eder. `path` aracılığıyla girdiğiniz için `ExitWorktree` onu otomatik olarak silmez — `action: "keep"` ile ayrılmak sadece orijinal dizine döner.

## Notlar

- Kullanıcı açıkça istemedikçe veya proje talimatları gerektirmedikçe `EnterWorktree`'yi çağırmayın. Sıradan dal değiştirme veya hata düzeltme istekleri, worktrees değil, normal Git komutları kullanmalıdır.
- Bir Git deposunun içinde çağrıldığında, araç `.claude/worktrees/` altında bir worktree oluşturur ve `HEAD`'e dayalı yeni bir dal kaydeder. Bir Git deposunun dışında, VCS'ten bağımsız yalıtım için `settings.json`'daki yapılandırılmış `WorktreeCreate` / `WorktreeRemove` kancalarına devreder.
- Aynı anda yalnızca bir worktree oturumu aktiftir. Halihazırda bir worktree oturumunun içindeyseniz araç çalışmayı reddeder; önce `ExitWorktree` ile çıkın.
- Oturum ortasında ayrılmak için `ExitWorktree` kullanın. Oturum, yeni oluşturulan bir worktree'nin içindeyken sona ererse, kullanıcıdan onu tutması veya kaldırması istenir.
- `path` ile girilen worktrees dışsal olarak kabul edilir — `action: "remove"` ile `ExitWorktree` onları silmez. Bu, kullanıcının manuel olarak yönettiği worktrees'i korumak için bir güvenlik önlemidir.
- Yeni bir worktree, mevcut dalın içeriğini miras alır ancak bağımsız bir çalışma dizinine ve indeksine sahiptir. Ana checkout'taki staged ve unstaged değişiklikler worktree içinde görünmez.
- Adlandırma ipucu: Birden fazla eş zamanlı worktree'yi `git worktree list`'te ayırt etmek kolay olsun diye çalışma türüyle (`feat/`, `fix/`, `spike/`) ön ekleyin.
