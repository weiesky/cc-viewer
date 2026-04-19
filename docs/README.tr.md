# CC-Viewer

Claude Code istek izleme sistemi; tum API isteklerini ve yanitlarini gercek zamanli olarak yakalar ve gorsellestirir (orijinal metin, sansursuz). Gelistiricilerin kendi Context'lerini izlemelerini kolaylastirir, boylece Vibe Coding sirasinda sorunlari gozden gecirmek ve hata ayiklamak daha kolay olur.
CC-Viewer'in en son surumu ayrica sunucu tabanli web programlama cozumleri ve mobil programlama araclari sunar. Herkesin kendi projelerinde kullanmasini memnuniyetle karsiliyoruz. Gelecekte daha fazla eklenti ozelligi ve bulut dagitim destegi sunulacaktir.

Once ilginc kisma bakalim — mobil cihazda gorebilecekleriniz:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | Türkçe | [Українська](./README.uk.md)

## Kullanim

### Kurulum

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Programlama Modu

ccv, claude'un dogrudan yerine gecer. Tum parametreler claude'a iletilirken ayni anda Web Viewer baslatilir.

```bash
ccv                    # == claude (etkilesimli mod)
ccv -c                 # == claude --continue (son konusmaya devam et)
ccv -r                 # == claude --resume (konusmayi surdur)
ccv -p "hello"         # == claude --print "hello" (yazdirma modu)
ccv --d                # == claude --dangerously-skip-permissions (kisayol)
ccv --model opus       # == claude --model opus
```

Yazarin en sik kullandigi komut:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Programlama modu baslatildiktan sonra web sayfasi otomatik olarak acilir.

Web sayfasinda claude'u dogrudan kullanabilir, ayni zamanda tam istek mesajlarini ve kod degisikliklerini goruntuleyebilirsiniz.

Ve daha da heyecan verici olani — mobil cihazdan bile programlama yapabilirsiniz!


### Gunluk (Logger) Modu

⚠️ Hala yerel claude aracini veya VS Code eklentisini kullanmayi tercih ediyorsaniz, bu modu kullanin.

Bu modda ```claude``` veya ```claude --dangerously-skip-permissions``` baslatildiginda

otomatik olarak bir gunluk sureci baslatilir ve istekler ~/.claude/cc-viewer/*projeniz*/tarih.jsonl dosyasina kaydedilir.

Gunluk modunu baslatma:
```bash
ccv -logger
```

Konsolda belirli port yazdirilmadiginda, ilk ornegin varsayilan portu 127.0.0.1:7008'dir. Birden fazla eszamanli ornek icin portlar sirasiyla 7009, 7010 seklinde artar.

Bu komut, Claude Code'un kurulum yontemini (NPM veya Native Install) otomatik olarak algilar ve buna gore uyarlanir.

- **Claude code NPM surumu**: Claude Code'un `cli.js` dosyasina otomatik olarak yakalama betigi enjekte eder.
- **Claude code Native surumu**: `claude` ikili dosyasini otomatik olarak algilar, yerel seffaf proxy yapilandirir ve otomatik trafik yonlendirme icin Zsh Shell Hook kurar.
- Bu proje, NPM uzerinden kurulan Claude Code'un kullanilmasini onerir.

Gunluk modunu kaldirma:
```bash
ccv --uninstall
```

### Sorun Giderme (Troubleshooting)

Baslatma sorunlariyla karsilastirsaniz, nihai bir cozum vardir:
Adim 1: Herhangi bir dizinde Claude Code'u acin;
Adim 2: Claude Code'a su talimati verin:
```
cc-viewer npm paketini kurdum, ancak ccv calistirdiktan sonra hala duzgun calismiyor. cc-viewer'in cli.js ve findcc.js dosyalarini incele ve belirli ortama gore yerel Claude Code dagitimini uyarla. Degisiklikleri mumkun oldugunca findcc.js ile sinirla.
```
Claude Code'un hatalari kendisinin kontrol etmesine izin vermek, herhangi birine danismaktan veya herhangi bir belge okumaktan cok daha etkilidir!

Yukaridaki talimatlar tamamlandiktan sonra findcc.js guncellenecektir. Projeniz sik sik yerel dagitim gerektiriyorsa veya fork'lanmis kodun sikca kurulum sorunlarini cozmesi gerekiyorsa, bu dosyayi saklayin ve bir sonraki sefere dogrudan kopyalayin. Gunumuzde bircok proje ve sirket Claude Code'u Mac'te degil, sunucu tarafinda barindirilan dagitimlarda kullanmaktadir. Bu nedenle yazar, cc-viewer kaynak kodu guncellemelerini takip etmeyi kolaylastirmak icin findcc.js'yi ayristirmistir.

### Diger Yardimci Komutlar

Yardimi goruntuleme:
```bash
ccv -h
```

### Yapilandirma Gecersiz Kilma (Configuration Override)

Ozel bir API uc noktasi kullanmaniz gerekiyorsa (ornegin kurumsal proxy), `~/.claude/settings.json` dosyasinda yapilandirin veya `ANTHROPIC_BASE_URL` ortam degiskenini ayarlayin. `ccv` bunu otomatik olarak algilar ve istekleri dogru sekilde yonlendirir.

### Sessiz Mod (Silent Mode)

Varsayilan olarak `ccv`, `claude`'u sararken sessiz modda calisir; boylece terminal ciktiniz temiz kalir ve yerel deneyimle ayni olur. Tum gunlukler arka planda yakalanir ve `http://localhost:7008` uzerinden goruntulenebilir.

Yapilandirma tamamlandiktan sonra `claude` komutunu her zamanki gibi kullanin. Izleme arayuzunu gormek icin `http://localhost:7008` adresini ziyaret edin.


## Istemci Surumu

CC-Viewer'in istemci surumu mevcuttur ve GitHub uzerinden indirilebilir.
[Indirme adresi](https://github.com/weiesky/cc-viewer/releases)
Su anda istemci surumu test asamasindadir — herhangi bir sorunla karsilastiginizda geri bildirimde bulunabilirsiniz. Ayrica cc-viewer'i kullanabilmeniz icin bilgisayarinizda Claude Code'un yuklu olmasi gerekmektedir.
Unutmamak gerekir ki: cc-viewer yalnizca iscinin (Claude Code) bir "kiyafeti"dir. Claude Code olmadan kiyafet tek basina calisamaz.

## Ozellikler


### Programlama Modu

ccv ile baslatildiktan sonra sunlari goreceksiniz:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Duzenleme tamamlandiktan sonra dogrudan kod diff'ini goruntuleyebilirsiniz:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Dosyalari acip manuel olarak programlama yapabilirsiniz, ancak bu onerilmez — bu eski usul programlamadir!

### Mobil Programlama

QR kod tarayarak mobil cihazda programlama bile yapabilirsiniz:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Mobil programlama hayallerinizi gerceklestirir. Ayrica bir eklenti mekanizmasi vardir — programlama aliskanliklariniza gore ozellestirmek istiyorsaniz, eklenti hooks guncellemelerini takip edebilirsiniz.

**Sesli giris**: sohbet girisindeki mikrofon simgesine dokunarak sesten metne gecis yapin (Web Speech API; HTTPS veya localhost gerektirir, bu yuzden LAN HTTP erisiminde dugme gizlidir). Android'de Gboard'un yerlesik 🎤 tusunu, iOS'ta klavyedeki sistem dikte ozelligini dogrudan kullanabilirsiniz — her ikisi de HTTPS gerektirmeden cevrimdisi calisir.

### Gunluk Modu (Claude Code tam konusmalarini goruntuleme)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Claude Code'un gonderdigi tum API isteklerini gercek zamanli olarak yakalar, orijinal metin oldugundan emin olur, sansurlenmis gunlukler degil (bu cok onemli!!!)
- Main Agent ve Sub Agent isteklerini otomatik olarak tanımlar ve isaretler (alt turler: Plan, Search, Bash)
- MainAgent istekleri Body Diff JSON'u destekler, onceki MainAgent istegiyle farklari daraltilmis olarak gosterir (yalnizca degisen/yeni alanlar gosterilir)
- Her istek satir ici Token kullanim istatistiklerini gosterir (giris/cikis Token, onbellek olusturma/okuma, isabet orani)
- Claude Code Router (CCR) ve diger proxy senaryolariyla uyumlu — API yol kalibi eslestirmesi ile yedek olarak istekleri eslestirir

### Konusma Modu

Main Agent'in tam konusma gecmisini sohbet arayuzu olarak ayristirmak icin sag ustteki "Konusma Modu" dugmesine tiklayin:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Agent Team goruntuleme henuz desteklenmiyor
- Kullanici mesajlari saga hizali (mavi balon), Main Agent yanitlari sola hizali (koyu balon)
- `thinking` bloklari varsayilan olarak daraltilmis, Markdown olarak islenir. Dusunce surecini gormek icin tiklayin; tek tikla ceviri destekler (ozellik henuz kararsiz)
- Kullanici secim mesajlari (AskUserQuestion) soru-cevap formatinda goruntulenir
- Cift yonlu mod senkronizasyonu: Konusma moduna gecildiginde secili istegin konusmasina otomatik olarak gidilir; orijinal moda geri donuldugunde secili istege otomatik olarak gidilir
- Ayarlar paneli: Arac sonuclarinin ve thinking bloklarinin varsayilan daraltma durumunu degistirebilir
- Mobil konusma gorunumu: Mobil CLI modunda, ust cubraktaki "Konusma Gorunumu" dugmesine tiklayarak salt okunur bir konusma gorunumu acabilir ve mobilde tam konusma gecmisini inceleyebilirsiniz

### Istatistik Araclari

Header alaninda "Veri Istatistikleri" acilir paneli:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Cache creation/read sayisi ve onbellek isabet oranini gosterir
- Onbellek yeniden olusturma istatistikleri: Nedene gore gruplandirılmis (TTL, system/tools/model degisikligi, mesaj kisaltma/degistirme, key degisikligi) sayi ve cache_creation tokens ile
- Arac kullanim istatistikleri: Her aracin cagri sikligini sayiya gore sirali gosterir
- Skill kullanim istatistikleri: Her Skill'in cagri sikligini sayiya gore sirali gosterir
- Teammate istatistiklerini destekler
- Kavram yardimi (?) simgeleri: MainAgent, CacheRebuild ve her arac icin yerlesik belgeleri goruntulemek uzere tiklayin

### Gunluk Yonetimi

Sol ustteki CC-Viewer acilir menusu araciligiyla:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Gunluk Sikistirma**
Gunlukler hakkinda yazar, Anthropic'in resmi tanimlarinda hicbir degisiklik yapilmadigini, gunluklerin butunlugunu garanti etmek icin acikca belirtmek ister.
Ancak opus 1M'nin tek tek gunlukleri zamanla asiri buyudugunden, yazarin MainAgent icin uyguladigi gunluk optimizasyonlari sayesinde gzip olmadan en az %66 boyut kucultme saglanabilmektedir.
Bu sikistirilmis gunlukleri ayristirma yontemi bu depodan cikarilabilir.

### Daha Fazla Kullanisli Ozellik

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Kenar cubugu araciligiyla prompt'unuzu hizlica bulabilirsiniz

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

Ilginc KV-Cache-Text ozelligi, Claude'un gercekte ne gordugunu gormenizi saglar

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Gorsel yukleyerek ihtiyaclarinizi ifade edebilirsiniz. Claude'un gorsel anlama yetenegi son derece gucludur. Ayrica ekran goruntlerini dogrudan Ctrl + V ile yapistirabilirsiniz ve konusma tum iceriginizi gosterir

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Eklentileri dogrudan ozellestirebilir, tum CC-Viewer sureclerini yonetebilir ve CC-Viewer ucuncu taraf API'lere aninda gecis yapabilir (evet, GLM, Kimi, MiniMax, Qwen, DeepSeek kullanabilirsiniz — yazar su an hepsinin oldukca zayif oldugunu dusunse de)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Kesfedilmeyi bekleyen daha fazla ozellik... Ornegin: Sistem Agent Team'i destekler ve yerlesik Code Reviewer'a sahiptir. Yakinda Codex'in Code Reviewer entegrasyonu da gelecek (yazar, Claude Code kodunu incelemek icin Codex kullanilmasini siddetle savunmaktadir)


### Otomatik Guncellemeler

CC-Viewer baslatilirken otomatik olarak guncellemeleri kontrol eder (4 saatte en fazla bir kez). Ayni ana surum icinde (orn. 1.x.x -> 1.y.z) otomatik guncellenir ve bir sonraki baslatmada gecerli olur. Ana surum degisikliginde yalnizca bildirim gosterilir.

Otomatik guncelleme, Claude Code'un genel yapilandirmasi `~/.claude/settings.json`'u takip eder. Claude Code otomatik guncellemeleri devre disi biraktiysa (`autoUpdates: false`), CC-Viewer de otomatik guncellemeyi atlar.

### Coklu Dil Destegi

CC-Viewer 18 dili destekler ve sistem diline gore otomatik olarak gecis yapar:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
