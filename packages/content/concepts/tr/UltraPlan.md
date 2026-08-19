# UltraPlan — Nihai Dilek Makinesi

## UltraPlan Nedir

UltraPlan, cc-viewer'in Claude Code'un yerel `/ultraplan` komutunun **yerelleştirilmiş uygulamasıdır**. `/ultraplan`'ın tüm yeteneklerini **Claude'un resmi uzak hizmetini başlatmaya gerek kalmadan** yerel ortamınızda kullanmanızı sağlar ve Claude Code'u **çoklu ajan işbirliği** kullanarak karmaşık planlama ve uygulama görevlerini yerine getirmeye yönlendirir.

Normal Plan modu veya Agent Team ile karşılaştırıldığında, UltraPlan şunları yapabilir:
- Farklı görev türlerine uygun **Kod uzmanı** ve **Araştırma uzmanı** rolleri sunar
- Kod tabanını keşfetmek veya farklı boyutlardan araştırma yapmak için birden fazla paralel ajan dağıtır
- Sektördeki en iyi uygulamalar için harici araştırma (webSearch) dahil etmek
- Plan yürütmesinden sonra kod incelemesi için otomatik olarak bir Code Review Ekibi oluşturmak
- Tam bir **Planla → Yürüt → İncele → Düzelt** kapalı döngüsü oluşturmak

---

## Önemli Notlar

### 1. UltraPlan Her Şeye Kadir Değildir
UltraPlan daha güçlü bir dilek makinesidir, ancak bu her dileğin gerçekleştirilebileceği anlamına gelmez. Plan ve Agent Team'den daha güçlüdür, ancak doğrudan "size para kazandıramaz". Makul görev ayrıntı düzeyini göz önünde bulundurun — her şeyi tek seferde başarmaya çalışmak yerine büyük hedefleri yürütülebilir orta ölçekli görevlere bölün.

### 2. Şu Anda Programlama Projeleri İçin En Etkili
UltraPlan'ın şablonları ve iş akışları, programlama projeleri için derinlemesine optimize edilmiştir. Diğer senaryolar (dokümantasyon, veri analizi vb.) denenebilir, ancak gelecek sürüm uyarlamalarını beklemek isteyebilirsiniz.

### 3. Yürütme Süresi ve Bağlam Penceresi Gereksinimleri
- Başarılı bir UltraPlan çalıştırması genellikle **30 dakika veya daha fazla** sürer
- MainAgent'in büyük bir bağlam penceresine sahip olmasını gerektirir (1M bağlamlı Opus modeli önerilir)
- Yalnızca 200K modeliniz varsa, **çalıştırmadan önce bağlamı `/clear` ile temizlediğinizden emin olun**
- Claude Code'un `/compact` komutu bağlam penceresi yetersiz olduğunda kötü performans gösterir — alanın tükenmesinden kaçının
- Yeterli bağlam alanını korumak, başarılı UltraPlan yürütmesi için kritik bir ön koşuldur

Yerelleştirilmiş UltraPlan hakkında sorularınız veya önerileriniz varsa, tartışmak ve işbirliği yapmak için [GitHub'da Issues](https://github.com/anthropics/claude-code/issues) açmaktan çekinmeyin.

---

## Nasıl Çalışır

UltraPlan, farklı görev türleri için iki uzman rolü sunar:

### Kod uzmanı
Programlama projeleri için tasarlanmış çoklu ajan iş akışı:
1. Kod tabanını aynı anda keşfetmek için en fazla 5 paralel ajan dağıtma (mimari, dosya tanımlama, risk değerlendirmesi vb.)
2. İsteğe bağlı olarak webSearch aracılığıyla sektör çözümlerini araştırmak için bir araştırma ajanı dağıtma
3. Tüm ajan bulgularını detaylı bir uygulama planında sentezleme
4. Planı birden fazla perspektiften incelemek için bir inceleme ajanı dağıtma
5. Onaylandıktan sonra planı yürütme
6. Uygulamadan sonra kod kalitesini doğrulamak için otomatik olarak Code Review Team oluşturma

### Araştırma uzmanı
Araştırma ve analiz görevleri için tasarlanmış çoklu ajan iş akışı:
1. Farklı boyutlardan araştırma yapmak için birden fazla paralel ajan dağıtma (sektör araştırmaları, akademik makaleler, haberler, rekabet analizi vb.)
2. Toplanan kaynakların titizliğini ve güvenilirliğini doğrularken hedef çözümü sentezlemek için bir ajan atama
3. İsteğe bağlı olarak ürün demosu oluşturmak için bir ajan dağıtma (HTML, Markdown vb.)
4. Tüm bulguları kapsamlı bir uygulama planında sentezleme
5. Planı farklı roller ve perspektiflerden incelemek için birden fazla inceleme ajanı dağıtma
6. Onaylandıktan sonra planı yürütme

---

## Raw Templates

Below are the two raw prompt templates UltraPlan actually sends to Claude Code (see `src/utils/ultraplanTemplates.js`):

### Code Expert (codeExpert)

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify user intent whenever the request is ambiguous (target element, interaction style, scope of platforms, etc.). Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate a highly detailed implementation plan.

Instructions:
1. Use the `Agent` tool to spawn parallel agents that simultaneously explore different aspects of the codebase:
- If necessary, assign a preliminary researcher to use the `webSearch` tool to first investigate cutting-edge solutions in the relevant industry domain;
- One agent responsible for understanding the relevant existing code and architecture;
- One agent responsible for identifying all files that need to be modified;
- One agent responsible for identifying potential risks, edge cases, and dependencies;
- You may add other roles or deploy additional agents beyond the three listed above; the maximum number of concurrently dispatched agents is 5.

2. Synthesize the findings from all agents into a detailed, step-by-step implementation plan.

3. Use the `Agent` tool to spawn 2-3 review agents that examine the plan from different perspectives, checking for missing steps, potential risks, or corresponding mitigation strategies.

4. Integrate the feedback gathered during the review process, then call `ExitPlanMode` to submit your final plan.

5. Once `ExitPlanMode` returns a result:
- If approved: proceed to execute the plan within this session.
- If rejected: revise the plan based on the feedback provided and call `ExitPlanMode` again.
- If an error occurs (including receiving a "Not in Plan Mode" message): do **not** follow the suggestions provided in the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, with precise details of the required changes for each file;
- A step-by-step execution sequence;
- Testing and validation procedures;
- Potential risks and their corresponding mitigation strategies;

6. After the final plan has been successfully executed:
First run `git diff --quiet && git diff --cached --quiet` (or equivalent) to detect whether the working tree actually has non-trivial changes; if there are no real changes (or only whitespace/comment-only edits), skip the UltraReview step.
Otherwise, if the project is managed with Git:
Initiate a team (`TeamCreate`), dynamically allocating the number of teammates based on task complexity (5 is recommended);
If the `TeamCreate` tool is unavailable, spawn teammates directly with the `Agent` tool (note: as teammates, not plain subagents);
Task: Conduct a Code Review of the current git changes from multiple perspectives;
Pre-requisites:
- The git repository may be located in a subdirectory of the current directory; prefer `git rev-parse --show-toplevel` (fall back to recursive lookup) before proceeding;
- In the case of multiple repositories, tasks may be executed separately;
The team's goal is to analyze the current Git change log and validate each modification from different perspectives, specifically including:
- Whether requirements/objectives have been met and functionality is complete;
- Whether newly added code introduces side effects, breaks existing functionality, or poses potential risks;
- Code quality: naming, readability, complexity, technical debt, maintainability;
- Testing and documentation: whether there is adequate test coverage, and whether critical logic has necessary comments or documentation;
- Dependencies and compatibility: whether new dependencies or version compatibility issues have been introduced;
Workflow:
- Each teammate, according to their own role, covers the review dimensions one by one and independently outputs a report;
- After consolidating the reports, perform a cross-review to identify conflicts or shared concerns;
- Distill specific, actionable modification suggestions and annotate them with priority levels (P0/P1/P2/P3);
- Upon completion, adopt P0 items, and selectively adopt P1 items when they are concrete and low-risk; defer P2/P3 to backlog;
- After execution is complete, close the team (`TeamDelete`);
- If the `TeamDelete` tool is unavailable, notify each teammate to exit individually;
</system-reminder></textarea>

### Research Expert (researchExpert)

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode` and `WebSearch`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target audience, and deliverable format whenever the user's intent is ambiguous. Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore various facets of the requirements:
- If necessary, deploy a preliminary investigator to conduct an initial survey of industry-specific solutions using `webSearch`;
- If necessary, deploy a specialized investigator to research authoritative sources—such as academic papers, news articles, and research reports—using `webSearch`;
- Assign an agent to synthesize the target solution, while simultaneously verifying the rigor and credibility of the gathered papers, news, and research reports;
- If necessary, assign an agent to analyze competitor data to provide supplementary analytical perspectives;
- If necessary, assign an agent to handle the implementation of a product demo (generating outputs such as HTML, Markdown, etc.);
- If the task is sufficiently complex, you may assign additional teammates to the roles defined above, or introduce other specialized roles; you are permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive, step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these agents shall scrutinize the plan from multiple roles and perspectives to identify any omitted steps and to propose reasonable additions or optimizations.

4. Consolidate the feedback received from the review agents, then invoke `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
- If Approved: Proceed to execute the plan within this current session.
- If Rejected: Revise the plan based on the provided feedback, and then invoke `ExitPlanMode` once again.
- If an Error Occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an appropriate location and notify the user.
</system-reminder></textarea>
