# Skill

## Tanım

Ana konuşmada bir beceri (skill) çalıştırır. Beceriler, kullanıcının slash command (örn. `/commit`, `/review-pr`) aracılığıyla çağırabileceği özel yeteneklerdir.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `skill` | string | Evet | Beceri adı (örn. "commit", "review-pr", "pdf") |
| `args` | string | Hayır | Beceri parametreleri |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Kullanıcı `/<skill-name>` formatında slash command girdiğinde
- Kullanıcının isteği kayıtlı bir becerinin işlevselliğiyle eşleştiğinde

**Kullanıma uygun değil:**
- Yerleşik CLI komutları (örn. `/help`, `/clear`)
- Zaten çalışmakta olan bir beceri
- Kullanılabilir beceri listesinde olmayan beceri adları

## Dikkat Edilecekler

- Beceri çağrıldıktan sonra tam bir prompt'a genişletilir
- Tam nitelikli adları destekler (örn. `ms-office-suite:pdf`)
- Kullanılabilir beceri listesi system-reminder mesajlarında sağlanır
- `<command-name>` etiketi görüldüğünde beceri zaten yüklenmiş demektir, bu aracı tekrar çağırmak yerine doğrudan çalıştırılmalıdır
- Aracı gerçekten çağırmadan bir beceriden bahsetmeyin

## cc-viewer'da Önemi

Skill çağrıları istek günlüğünde `tool_use` content block olarak görünür. Beceri genişletildikten sonraki prompt, sonraki isteklerin system prompt'unu veya mesaj içeriğini etkiler.

## Orijinal Metin

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
