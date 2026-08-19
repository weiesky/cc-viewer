# ExitWorktree

`EnterWorktree` tarafından daha önce oluşturulmuş bir worktree oturumunu sonlandırır ve oturumu özgün çalışma dizinine geri döndürür. Bu araç yalnızca mevcut oturumda `EnterWorktree` tarafından oluşturulan worktree'ler üzerinde çalışır; böyle bir oturum aktif değilse çağrı hiçbir etki üretmez.

## Ne Zaman Kullanılır

- İzole bir worktree'deki çalışma tamamlandı ve ana çalışma dizinine dönmek istiyorsunuz.
- Bir özellik dalı worktree'sindeki görev tamamlandı ve birleştirme (merge) işleminin ardından dal ve dizini temizlemek istiyorsunuz.
- Worktree'yi daha sonra kullanmak üzere saklamak ve hiçbir şeyi silmeden yalnızca özgün dizine geri dönmek istiyorsunuz.
- Disk üzerinde herhangi bir artifact bırakmadan deneysel ya da geçici bir dalı terk etmek istiyorsunuz.
- Yeni bir `EnterWorktree` oturumu başlatmanız gerekiyor; bu da önce mevcut oturumu sonlandırmayı gerektiriyor.

## Parametreler

- `action` (dize, zorunlu): `"keep"` worktree dizinini ve dalını disk üzerinde olduğu gibi bırakarak daha sonra geri dönülmesine olanak tanır; `"remove"` dizini ve dalı silerek temiz bir çıkış yapar.
- `discard_changes` (mantıksal, isteğe bağlı, varsayılan `false`): Yalnızca `action` değeri `"remove"` olduğunda anlamlıdır. Worktree'de kaydedilmemiş dosyalar ya da özgün dalda bulunmayan commit'ler varsa, `discard_changes` değeri `true` olarak ayarlanmadıkça araç kaldırma işlemini reddeder. Hata yanıtı, yeniden çağrılmadan önce kullanıcıyla doğrulama yapılabilmesi için ilgili değişiklikleri listeler.

## Örnekler

### Örnek 1: değişiklikleri birleştirdikten sonra temiz çıkış

Bir worktree'deki çalışmayı tamamlayıp dalı main'e birleştirdikten sonra, worktree dizinini ve dalını silmek ve özgün çalışma dizinine dönmek için `action: "remove"` ile `ExitWorktree` çağrısı yapın.

```
ExitWorktree(action: "remove")
```

### Örnek 2: kaydedilmemiş deneysel kod içeren geçici bir worktree'yi atmak

Bir worktree tamamen atılması gereken deneysel, kaydedilmemiş değişiklikler içeriyorsa önce `action: "remove"` deneyin. Araç reddedecek ve kaydedilmemiş değişiklikleri listeleyecektir. Kullanıcının değişikliklerin atılabileceğini onaylamasının ardından `discard_changes: true` ile yeniden çağırın.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Notlar

- Bu araç yalnızca mevcut oturumda `EnterWorktree` tarafından oluşturulan worktree'ler üzerinde çalışır. `git worktree add` ile oluşturulan worktree'leri, önceki oturumlardaki worktree'leri ya da `EnterWorktree` hiç çağrılmamışsa sıradan çalışma dizinini etkilemez; bu durumlarda çağrı hiçbir etki üretmez.
- `action: "remove"`, worktree'de kaydedilmemiş değişiklikler veya özgün dalda bulunmayan commit'ler varsa, `discard_changes: true` açıkça belirtilmediği sürece reddedilir. Veriler kurtarılamayacağından `discard_changes: true` ayarlanmadan önce her zaman kullanıcıyla doğrulayın.
- Worktree'ye bağlı bir tmux oturumu varsa: `remove` işleminde sonlandırılır; `keep` işleminde çalışmaya devam eder ve kullanıcının daha sonra yeniden bağlanabilmesi için oturum adı döndürülür.
- `ExitWorktree` tamamlandıktan sonra yeni bir worktree oturumu başlatmak için `EnterWorktree` yeniden çağrılabilir.
