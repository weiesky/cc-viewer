# SendMessage

## Tanım

Bir takım içindeki agent'lar arasında mesaj gönderir. Doğrudan iletişim, yayın ve protokol mesajları (kapatma istekleri/yanıtları, plan onayı) için kullanılır.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `to` | string | Evet | Alıcı: takım üyesinin adı veya `"*"` ile herkese yayın |
| `message` | string / object | Evet | Düz metin mesajı veya yapılandırılmış protokol nesnesi |
| `summary` | string | Hayır | Arayüzde gösterilen 5-10 kelimelik önizleme |

## Mesaj Türleri

### Düz Metin
Takım üyeleri arasında koordinasyon, durum güncellemeleri ve görev tartışmaları için doğrudan mesajlar.

### Kapatma İsteği
Bir takım üyesinden düzenli şekilde kapanmasını ister: `{ type: "shutdown_request", reason: "..." }`

### Kapatma Yanıtı
Takım üyesi kapatmayı onaylar veya reddeder: `{ type: "shutdown_response", approve: true/false }`

### Plan Onay Yanıtı
Bir takım üyesinin planını onaylar veya reddeder: `{ type: "plan_approval_response", approve: true/false }`

## Yayın vs. Doğrudan

- **Doğrudan** (`to: "üye-adı"`): Belirli bir takım üyesine gönder — çoğu iletişim için tercih edilir
- **Yayın** (`to: "*"`): Tüm takım üyelerine gönder — dikkatli kullanın, yalnızca kritik takım çapında duyurular için

## İlgili Araçlar

| Araç | Amaç |
|------|------|
| `TeamCreate` | Yeni bir takım oluştur |
| `TeamDelete` | Tamamlandığında takımı kaldır |
| `Agent` | Takıma katılan takım üyelerini başlat |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Paylaşılan görev listesini yönet |
