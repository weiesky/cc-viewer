# Request Body Alan Aciklamasi

Claude API `/v1/messages` istek govdesinin ust duzey alan aciklamasi.

## Alan Listesi

| Alan | Tur | Aciklama |
|------|------|------|
| **model** | string | Kullanilan model adi, ornegin `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Konusma mesaj gecmisi. Her mesaj `role` (user/assistant) ve `content` (metin, gorsel, tool_use, tool_result gibi blok dizisi) icerir |
| **system** | array | System prompt. Claude Code'un temel talimatlari, arac kullanim aciklamalari, ortam bilgileri, CLAUDE.md icerigi vb. icerir. `cache_control` isaretli bloklar prompt caching ile onbellege alinir |
| **tools** | array | Kullanilabilir arac tanim listesi. Her arac `name`, `description` ve `input_schema` (JSON Schema) icerir. MainAgent genellikle 20'den fazla araca sahipken, SubAgent yalnizca birkacina sahiptir |
| **metadata** | object | Istek meta verileri, genellikle kullaniciyi tanimlamak icin `user_id` icerir |
| **max_tokens** | number | Modelin tek bir yanittaki maksimum token sayisi, ornegin `16000`, `64000` |
| **thinking** | object | Genisletilmis dusunme yapilandirmasi. `type: "enabled"` dusunme modunu etkinlestirir, `budget_tokens` dusunme token ust sinirini kontrol eder |
| **context_management** | object | Baglam yonetimi yapilandirmasi. `truncation: "auto"` Claude Code'un cok uzun mesaj gecmisini otomatik olarak kesmesine izin verir |
| **output_config** | object | Cikis yapilandirmasi, ornegin `format` ayari |
| **stream** | boolean | Akis yaniti etkinlestirilsin mi. Claude Code her zaman `true` kullanir |

## messages Yapisi

Her mesajin `content` alani bir blok dizisidir. Yaygin turler sunlardir:

- **text**: Duz metin icerigi
- **tool_use**: Modelin arac cagrisi (`name`, `input` icerir)
- **tool_result**: Arac yurutme sonucu (`tool_use_id`, `content` icerir)
- **image**: Gorsel icerigi (base64 veya URL)
- **thinking**: Modelin dusunme sureci (genisletilmis dusunme modu)

## system Yapisi

system prompt dizisi genellikle sunlari icerir:

1. **Temel ajan talimatlari** ("You are Claude Code...")
2. **Arac kullanim kurallari**
3. **CLAUDE.md icerigi** (proje duzeyi talimatlar)
4. **Beceri hatirlaticilari** (skills reminder)
5. **Ortam bilgileri** (OS, shell, git durumu vb.) — Aslinda Claude Code git'e buyuk olcude bagimlidir. Projede bir git deposu varsa, Claude Code projeyi daha iyi anlayabilir; uzak degisiklikleri ve commit kayitlarini cekerek analiz surecine yardimci olabilir

`cache_control: { type: "ephemeral" }` ile isaretlenmis bloklar Anthropic API tarafindan 5 dakika boyunca onbellege alinir. Onbellek isabet ettiginde `cache_read_input_tokens` olarak faturalandirilir (`input_tokens`'dan cok daha dusuktur).

> **Not**: Claude Code gibi ozel istemciler icin, Anthropic sunucusu aslinda onbellekleme davranisini belirlemek icin istekteki `cache_control` ozelligine tamamen bagimli degildir. Sunucu, istekte acikca `cache_control` isareti bulunmasa bile belirli alanlar icin (system prompt, arac tanimlari gibi) onbellekleme politikasini otomatik olarak uygular. Bu nedenle, istek govdesinde bu ozelligi gormediyseniz sasirmaniza gerek yoktur — sunucu onbellekleme islemini arka planda zaten tamamlamistir, ancak bu bilgiyi istemciye aciklamamistir. Bu, Claude Code ile Anthropic API arasindaki uskutulen bir anlasmadir.
