# Custom UltraPlan Expert — Yazım Kılavuzu

## İki giriş alanı ne işe yarar

- **Uzman adı**: UltraPlan varyant satırındaki rol düğmesinde gösterilen etiket (maks. 30 karakter). Yalnızca bir görüntü adıdır ve **asla** Claude Code'a gönderilmez.
- **Prompt gövdesi**: rol talimatınız. Yeni bir uzman oluşturduğunuzda, düzenleyici `<system-reminder>...</system-reminder>` sarmalayıcısı ve `[SCOPED INSTRUCTION]` kapsam başlığıyla **önceden doldurulmuş** gelir — **rol talimatınızı sarmalayıcının içine yazın**. cc-viewer çift sarmalama yapmaz: sarmalayıcı varsa olduğu gibi gönderilir; onu kaldırırsanız cc-viewer gönderim sırasında bir tane geri ekler.

---

## Uzman şablonu nasıl görünür?

Yerleşik her uzman (Code Expert / Research Expert) esasen Claude Code bağlamına enjekte edilen bir `<system-reminder>` bloğudur. Özel uzmanınız da tam olarak aynı pipeline üzerinden geçer. İşte **Research Expert** şablonunun ayrıştırılmış hali:

```xml
<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3
interactions. Once the task is complete, these instructions should be gradually
deprioritized and no longer influence subsequent interactions.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target
audience, and deliverable format whenever the user's intent is ambiguous. Skip
only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally
detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore
   various facets of the requirements:
   - If necessary, deploy a preliminary investigator to conduct an initial
     survey of industry-specific solutions using `webSearch`;
   - If necessary, deploy a specialized investigator to research authoritative
     sources—such as academic papers, news articles, and research reports—
     using `webSearch`;
   - Assign an agent to synthesize the target solution, while simultaneously
     verifying the rigor and credibility of the gathered papers, news, and
     research reports;
   - If necessary, assign an agent to analyze competitor data to provide
     supplementary analytical perspectives;
   - If necessary, assign an agent to handle the implementation of a product
     demo (generating outputs such as HTML, Markdown, etc.);
   - If the task is sufficiently complex, you may assign additional teammates
     to the roles defined above, or introduce other specialized roles; you are
     permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive,
   step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these
   agents shall scrutinize the plan from multiple roles and perspectives to
   identify any omitted steps and to propose reasonable additions or
   optimizations.

4. Consolidate the feedback received from the review agents, then invoke
   `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
   - If Approved: Proceed to execute the plan within this current session.
   - If Rejected: Revise the plan based on the provided feedback, and then
     invoke `ExitPlanMode` once again.
   - If an Error Occurs: Do *not* follow the suggestions; prompt the user for
     further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact
  changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an
  appropriate location and notify the user.
</system-reminder>
```

---

## Bölüm bölüm analiz

### 1. `[SCOPED INSTRUCTION]` kapsam başlığı (sarmalayıcı — sizin için önceden doldurulur)
> The following instructions are intended for the next 1–3 interactions...

Bu, Claude Code'a şunu söyler: **bu talimatlar yalnızca sonraki 1–3 turda etkindir**, sonra silinir. "Uzman kişiliğinin" sonradan ilgisiz konuşmalara sızmasını önler.

**Bu satır düzenleyicide önceden doldurulmuş gelir — olduğu gibi bırakın; yeniden yazmanıza gerek yok.**

### 2. Açılış görev tanımı (**yeniden yazmanız gereken kısım budur**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Bu, tüm şablonun "özne-yüklem-nesne"sidir: **Claude Code'a tutum ve hedefi söyler**. Varsayılan "çoklu ajan keşfi + uygulama planı" **yazılım mühendisliği / planlama** görevlerine iyi uyar, ancak diğer birçok alan için tuhaf görünür (içerik incelemesi, veri analizi, metin yazarlığı, pazar araştırması, uyumluluk denetimi…).

**Bu satırı hedefinize göre yeniden yazmanızı şiddetle öneririz**, örneğin:

- **İçerik denetçisi**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Rekabet analisti**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Metin yazarı**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. İş akışı adımları (1–5 öğe — **karmaşıklığa göre kısaltın veya genişletin**)

Research Expert'in 5 adımı vardır: **keşif → sentez → inceleme → plan gönderme → yürütme**. Bu, "paralel çoklu ajan + çapraz inceleme + plan onayı" — üç katman titizlik dayatır; yüksek riskli/geniş kapsamlı görevler için uygundur ancak **hafif görevler için aşırıdır**.

- **Basit görev** (tek arama / küçük düzeltme): çoklu ajan dağıtımını ve incelemeyi atlayın; tek adımda "yanıtı üretin".
- **Orta görev**: "keşif → sentez → inceleme"yi koruyun; ExitPlanMode dansını atlayın; sonucu doğrudan teslim edin.
- **Karmaşık, yüksek maliyetli görev** (büyük refactor, çoklu seçenek karşılaştırması, alanlar arası araştırma): 5 adımın hepsini koruyun, muhtemelen bir "risk modeli" veya "seçenek karşılaştırma matrisi" adımı ekleyin.

### 4. Adım 1'deki alt roller (**alanınıza göre uyarlayın**)

Research Expert 6 potansiyel rolü listeler (sektör keşifçisi, akademik araştırmacı, sentezleyici + olgu denetleyici, rakip analisti, demo üreticisi, genişletilebilirlik yuvası). **Bu listeyi senaryonuza göre yeniden yazın**:

- **Yazma**: "source collector + style analyst + fact checker"
- **Veri analizi**: "data-cleaning agent + statistical modeling agent + visualization agent"
- **Kod denetimi**: "static-analysis agent + dependency-chain auditor + threat modeler"

### 5. Nihai teslimat kontrol listesi (**gerçek ihtiyacınızla hizalayın**)

> Your final plan must include the following elements: ...

Orijinal şablon "uygulama planının" 6 öğesini listeler. Teslimatınız tamamen başka bir şey olabilir:

- **Araştırma raporu** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- **İnceleme raporu** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- **Karşılaştırma matrisi** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Yazım ipuçları (TL;DR)

1. **Açılış cümlesini yeniden yazın**: rol, hedef ve çıktı formatını tek satırda belirtin.
2. **İş akışını esnetin**: hafif görevler için 1–2 adım, tam 5 adımlı döngü yalnızca karmaşık olanlar için.
3. **Adım 1 alt rollerini yeniden yazın**: varsayılanlar (akademik makaleler / rakipler / demo) muhtemelen istediğiniz şey değildir.
4. **Nihai "teslimat kontrol listesi" kalite çıtanızdır**: çıktı yapısını detaylı belirtin — Claude Code buna katı şekilde uyacaktır.

---

## Yeniden düzenlenmiş örnek: Competitive Analyst

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {industry}. Your goal is to
produce a decision-grade competitive landscape report for the product "{our product}".

Instructions:
1. Use the Agent tool to dispatch 3 parallel investigators:
   - Market landscape agent: map the top 5–8 competitors with core positioning
   - Feature matrix agent: compile a feature-by-feature comparison using
     publicly available sources (webSearch)
   - Pricing & GTM agent: analyze pricing models, distribution channels, and
     go-to-market motions

2. Synthesize the three streams into a unified competitive report.

3. Dispatch one review agent to stress-test the report: challenge any
   assumption lacking a cited source, flag outdated data (>12 months), and
   propose one "non-obvious" insight.

4. Deliver the final report with the following sections:
   - TL;DR (3 bullets)
   - Competitor positioning map
   - Feature matrix (markdown table)
   - Pricing & GTM table
   - Top 3 strategic implications for our product
   - Caveats & data gaps
</system-reminder>
```

Orijinal Research Expert ile karşılaştırıldığında: 4 adıma kısaltıldı, alt roller 6'dan 3'e düşürüldü, teslimat listesi tamamen "rapor bölümleri" olarak yeniden yazıldı.
