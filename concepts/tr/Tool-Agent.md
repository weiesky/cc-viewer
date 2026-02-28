# Agent

## Tanım

Karmaşık çok adımlı görevleri otonom olarak işlemek için bir alt agent (SubAgent) başlatır. Alt agent'lar bağımsız alt süreçlerdir ve her birinin kendine özel araç seti ve bağlamı vardır. Agent, yeni Claude Code sürümlerinde Task aracının yeniden adlandırılmış versiyonudur.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `prompt` | string | Evet | Alt agent'ın yürüteceği görev açıklaması |
| `description` | string | Evet | 3-5 kelimelik kısa özet |
| `subagent_type` | string | Evet | Alt agent türü, kullanılabilir araç setini belirler |
| `model` | enum | Hayır | Model belirtme (sonnet / opus / haiku), varsayılan üst seviyeden miras |
| `max_turns` | integer | Hayır | Maksimum agentic tur sayısı |
| `run_in_background` | boolean | Hayır | Arka planda çalıştırılıp çalıştırılmayacağı, arka plan görevleri output_file yolu döndürür |
| `resume` | string | Hayır | Devam ettirilecek agent ID'si, son yürütmeden devam eder. Bağlamı kaybetmeden önceki bir alt agent'ı sürdürmek için kullanışlı |
| `isolation` | enum | Hayır | İzolasyon modu, `worktree` geçici git worktree oluşturur |

## Alt Agent Türleri

| Tür | Kullanım Amacı | Kullanılabilir Araçlar |
|-----|----------------|----------------------|
| `Bash` | Komut çalıştırma, git işlemleri | Bash |
| `general-purpose` | Genel amaçlı çok adımlı görevler | Tüm araçlar |
| `Explore` | Hızlı kod tabanı keşfi | Agent/Edit/Write/NotebookEdit/ExitPlanMode hariç tüm araçlar |
| `Plan` | Uygulama planı tasarlama | Agent/Edit/Write/NotebookEdit/ExitPlanMode hariç tüm araçlar |
| `claude-code-guide` | Claude Code kullanım kılavuzu soru-cevap | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Durum çubuğu yapılandırma | Read, Edit |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Çok adımlı otonom tamamlama gerektiren karmaşık görevler
- Kod tabanı keşfi ve derinlemesine araştırma (Explore türü ile)
- İzole ortam gerektiren paralel çalışma
- Arka planda çalıştırılması gereken uzun süreli görevler

**Kullanıma uygun değil:**
- Belirli dosya yolunu okuma — doğrudan Read veya Glob kullanın
- 2-3 bilinen dosyada arama — doğrudan Read kullanın
- Belirli sınıf tanımı arama — doğrudan Glob kullanın

## Dikkat Edilecekler

- Alt agent tamamlandığında tek bir mesaj döndürür; sonuçları kullanıcıya görünmez, ana agent'ın aktarması gerekir
- Verimliliği artırmak için tek mesajda birden fazla paralel Agent çağrısı yapılabilir
- Arka plan görevleri TaskOutput aracıyla ilerleme kontrolü yapılır
- Explore türü doğrudan Glob/Grep çağrısından yavaştır, yalnızca basit arama yeterli olmadığında kullanın
- Anında sonuç gerektirmeyen uzun süreli görevler için `run_in_background: true` kullanın; devam etmeden önce sonuç gerektiğinde ön plan modunu (varsayılan) kullanın
- `resume` parametresi, daha önce başlatılmış bir alt agent oturumunu birikmiş bağlamı koruyarak sürdürmeye olanak tanır

## cc-viewer'da Önemi

Agent, son Claude Code sürümlerinde Task aracının yeni adıdır. Agent çağrıları SubAgent istek zinciri oluşturur; istek listesinde MainAgent'tan bağımsız alt istek dizileri görülebilir. SubAgent istekleri genellikle kısaltılmış system prompt ve daha az araç tanımına sahiptir ve MainAgent ile belirgin bir kontrast oluşturur. cc-viewer'da, kaydedilen konuşmada kullanılan Claude Code sürümüne bağlı olarak `Task` veya `Agent` araç adları görünebilir.
