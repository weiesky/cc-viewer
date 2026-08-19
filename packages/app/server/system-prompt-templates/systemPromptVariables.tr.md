# systemPromptModel.md değişkenleri

Bu dosya, `systemPromptModel.md` içindeki çalışma zamanında çözülmesi gereken değişkenleri belgeler. Her yaprak düğüm değişkeni bir dize, sayı veya boş dize `""` olarak çözülür; bir değer elde edilemediğinde, eşit şekilde boş bir dizeye geri döner.

## Çalışma alanı ve kullanıcı ortamı

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Geçerli birincil çalışma dizini. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | İşlem/oturum başladığında asıl çalışma dizini. | `/Users/sky/claude-code` |
| `${environment.home}` | Kullanıcı ana dizini, `~` çözmek için kullanılır. | `/Users/sky` |
| `${environment.user}` | Geçerli sistem kullanıcı adı. | `sky` |
| `${environment.workspaceRoots}` | Geçerli oturumun çalışma alanı kökleri; satırbaşı ile ayrılmış dize olarak oluşturulabilir. | `/Users/sky/claude-code` |
| `${environment.path}` | Geçerli işlem PATH. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Geçerli yerel ayar veya dil ortamı. | `zh_CN.UTF-8` |

## İşletim sistemi

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Node.js tarafından tanımlanan platform. | `darwin` |
| `${os.type}` | İşletim sistemi türü. | `Darwin` |
| `${os.arch}` | CPU mimarisi. | `arm64` |
| `${os.shell}` | Geçerli kabuk. | `/bin/zsh` |
| `${os.version}` | İşletim sistemi sürümü açıklaması. | `Darwin Kernel Version ...` |
| `${os.release}` | İşletim sistemi sürümü. | `24.5.0` |
| `${os.hostname}` | Geçerli ana bilgisayar adı. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Kullanılabilir paralelizm. | `10` |
| `${os.totalMemory}` | Toplam sistem belleği, bayt cinsinden. | `34359738368` |
| `${os.freeMemory}` | Boş bellek, bayt cinsinden. | `8589934592` |
| `${os.uptime}` | Sistem çalışma süresi, saniye cinsinden. | `123456` |

## Node.js çalışma zamanı

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Geçerli Node.js sürümü. | `v24.14.0` |
| `${runtime.execPath}` | Geçerli Node.js yürütülebilir dosyasının yolu. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Geçerli işlem kimliği. | `12345` |
| `${runtime.ppid}` | Üst işlem kimliği. | `1234` |

## Zaman

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Geçerli yerel saat dizesi. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Geçerli ISO saati. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Geçerli yerel tarih. | `2026-07-09` |
| `${time.timezone}` | Geçerli sistem saat dilimi. | `Asia/Shanghai` |

## İzinler ve sanal alan

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Geçerli araç izni modu. | `default` |
| `${permissions.approvalsReviewer}` | Geçerli onay politikası veya gözden geçiren modu. | `auto_review` |
| `${sandbox.mode}` | Dosya sistemi sanal alan modu. | `workspace-write` |
| `${sandbox.networkAccess}` | Ağ erişim durumu. | `enabled` |
| `${sandbox.writableRoots}` | Sanal alanın yazma izni verdiği dizinler; satırbaşı ile ayrılmış dize olarak oluşturulabilir. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Geçerli TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Geçerli COLORTERM. | `truecolor` |
| `${terminal.columns}` | Geçerli terminal sütun sayısı. | `120` |
| `${terminal.rows}` | Geçerli terminal satır sayısı. | `40` |

## Dosya sistemi

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Sistem geçici dizini. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Dosya yolu ayırıcı. | `/` |
| `${filesystem.pathDelimiter}` | PATH girdisi sınırlayıcı. | `:` |

## Model

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Geçerli model adı veya kimliği. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Geçerli model bilgi kesintisi; bu değer işletim sisteminden türetilemez ve harici yapılandırma veya geçersiz kılınma yoluyla enjekte edilmelidir. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Geçerli dizinin bir git deposunun içinde olup olmadığı, dize olarak. | `true` |
| `${git.root}` | Git deposu kök dizini. | `/Users/sky/project` |
| `${git.branch}` | Geçerli git dalı veya kısa HEAD hash. | `main` |
| `${git.mainBranch}` | Varsayılan ana dal, tipik olarak PR veya birleştirme hedefi olarak kullanılır. | `main` |
| `${git.userName}` | Geçerli git `user.name`. | `Sky` |
| `${git.status}` | `git status --short` çıkışı. | `M src/index.ts` |
| `${git.recentCommits}` | Son commits özeti. | `abc1234 Fix prompt builder` |

## Bellek

Bellek değişkenleri kalıcı dosya tabanlı bellek dizinini tanımlar. `${memory.dir}` ayarlandığında `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` geçersiz kılınmasından çözülür; aksi takdirde `<home>/.claude/projects/<slug>/memory/` olarak hesaplanır; burada `<slug>` birincil çalışma dizinidir ve tüm alfanumerik olmayan karakterler `-` ile değiştirilir. `${memory.index}` bu dizin içindeki `MEMORY.md` içeriğini tutar (her oturum yüklenen dizin), ve `${memory.enabled}` belleğin kullanılabilir olup olmadığını bildirir. `# Memory` ve `# Memory index` bölümleri yalnızca bellek etkinleştirildiğinde bir araya getirilir.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Çözümlenen bellek dizini. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | `MEMORY.md` içeriği veya yokken `""`. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Belleğin kullanılabilir olup olmadığı, dize olarak. | `true` |

## Karalama alanı

Karalama alanı dizini oturuma özeldir ve işletim sisteminden türetilemez; `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` geçersiz kılınması aracılığıyla enjekte edilmelidir. Ayarlanmadığında `""` olarak geri döner ve `# Scratchpad Directory` bölümü derlemeden çıkarılır.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Oturuma özgü geçici dizin. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
