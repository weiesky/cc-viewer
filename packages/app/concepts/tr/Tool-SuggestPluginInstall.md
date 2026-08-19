# SuggestPluginInstall

`SearchPlugins` sonuçlarından satır içi bir eklenti yükleme kartı oluşturur ve eklenti önerilerini kullanıcının isteğine bağlar.

## Ne Zaman Kullanılır

- Bir eklenti araması, kullanıcının yapmaya çalıştığı şeyle eşleşen eklentileri yüzeye çıkardı ve bunları yüklenmesi için sunmak istiyorsunuz.

## Etkinleştirme

- Yalnızca bir Remote Control istemcisi bağlıyken veya oturum yönetilen bir bulut ortamında çalışırken.
- HIPAA kurumsal yapılandırmalarında devre dışıdır.
- Brief modunda değildir.

## Parametreler

- `contextLabel` (string, zorunlu): Öneriyi kullanıcı isteğine bağlayan kısa başlık (en fazla 128 karakter).
- `plugins` (dizi, zorunlu): `SearchPlugins` sonuçlarından alınan eklentiler — 1–16 girdi, her biri şunları içerir:
  - `pluginId` (string, zorunlu)
  - `pluginName` (string, zorunlu)
  - `description` (string, zorunlu)
  - `skills` (dizi, opsiyonel): Eklentinin skill'lerini tanımlayan en fazla 32 `{name, description?}` girdisi.

## Örnekler

### Örnek 1: Eşleşen bir eklenti sunmak

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

Kart kullanıcı için oluşturulur; eklentiyi etkinleştirmek bu aracın dışında gerçekleşir. Gerçekte neyin yüklendiğini keşfetmek için takipte `ListPlugins` çağırın.

## Notlar

- Yalnızca arama sonuçlarından gelen eklentileri dahil edin — asla eklenti girdileri uydurmayın.
