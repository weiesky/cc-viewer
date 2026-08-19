# 커스텀 UltraPlan Expert — 작성 가이드

## 두 입력 필드의 역할

- **Expert 이름**: UltraPlan 변형 행의 역할 버튼에 표시되는 라벨입니다 (최대 30자). 단순한 표시 이름이며 Claude Code로 **절대** 전송되지 않습니다.
- **프롬프트 본문**: 작성하시는 역할 지침입니다. 새 expert를 만들면 에디터에 `<system-reminder>...</system-reminder>` 래퍼와 `[SCOPED INSTRUCTION]` 스코프 헤더가 **미리 채워진** 상태로 표시됩니다 — **역할 지침은 래퍼 안에 작성**하십시오. cc-viewer는 이중으로 감싸지 않습니다: 래퍼가 있으면 그대로 전송하고, 제거하면 전송 시 cc-viewer가 다시 하나를 추가합니다.

---

## Expert 템플릿은 어떤 모습일까요

모든 내장 expert (Code Expert / Research Expert)는 본질적으로 Claude Code의 컨텍스트에 주입되는 `<system-reminder>` 블록입니다. 사용자의 커스텀 expert도 완전히 동일한 파이프라인을 거칩니다. 다음은 **Research Expert** 템플릿을 분해한 것입니다.

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

## 섹션별 분석

### 1. `[SCOPED INSTRUCTION]` 스코프 헤더 (래퍼 — 미리 채워짐)
> The following instructions are intended for the next 1–3 interactions...

이 줄은 Claude Code에게 **이 지침이 다음 1~3턴의 대화에서만 활성화된다**고 알려주며, 그 이후에는 점차 비활성화됩니다. "expert 페르소나"가 무관한 후속 대화로 새어 나가는 것을 방지합니다.

**이 줄은 에디터에 미리 채워져 있습니다 — 그대로 두십시오. 직접 다시 작성할 필요가 없습니다.**

### 2. 첫머리 작업 정의 (**가장 다시 작성할 가치가 있는 부분입니다**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

이는 전체 템플릿의 "주어-동사-목적어"에 해당하며, **Claude Code에게 어떤 자세로 어떤 목표를 향해 작업할지 알려줍니다**. 기본값인 "멀티 에이전트 탐색 + 구현 계획"은 **소프트웨어 엔지니어링 / 계획** 유형의 작업에는 적합하지만, 다른 많은 영역 (콘텐츠 검수, 데이터 분석, 카피라이팅, 시장 조사, 컴플라이언스 감사 등)에는 어색하게 느껴집니다.

**목표에 맞게 이 문장을 다시 작성하시는 것을 강력히 권장합니다.** 예를 들어:

- **콘텐츠 검수자**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **경쟁 분석가**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **카피라이터**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. 워크플로 단계 (1~5개 항목 — **복잡도에 따라 축소 또는 확장**합니다)

Research Expert는 5단계로 구성되어 있습니다: **탐색 → 통합 → 검토 → 계획 제출 → 실행**. 이는 "멀티 에이전트 병렬 처리 + 교차 검토 + 계획 승인"이라는 세 겹의 엄정함을 강제하며, 위험도가 높고 범위가 넓은 작업에는 적합하지만 **경량 작업에는 과합니다**.

- **간단한 작업** (단일 조회 / 소규모 수정): 멀티 에이전트 디스패치와 검토를 제거하고 1단계로 "답을 도출"만 합니다.
- **중간 난이도 작업**: "탐색 → 통합 → 검토"를 유지하고 ExitPlanMode 절차를 제거한 뒤 결과를 직접 제공합니다.
- **복잡하고 비용이 높은 작업** (대규모 리팩토링, 다중 옵션 비교, 여러 영역에 걸친 조사): 5단계를 모두 유지하며, 필요하다면 "리스크 모델링" 또는 "옵션 비교 매트릭스" 단계를 추가합니다.

### 4. Step 1의 서브 역할 (**도메인에 맞게 조정합니다**)

Research Expert는 6개의 잠재적 역할을 나열합니다 (산업 스카우트, 학술 연구자, 통합 + 팩트체커, 경쟁사 분석가, 데모 제작자, 확장 슬롯). **자신의 시나리오에 맞게 이 목록을 다시 작성하십시오**:

- **글쓰기**: "자료 수집자 + 문체 분석가 + 팩트 체커"
- **데이터 분석**: "데이터 클렌징 에이전트 + 통계 모델링 에이전트 + 시각화 에이전트"
- **코드 감사**: "정적 분석 에이전트 + 종속성 체인 감사자 + 위협 모델러"

### 5. 최종 산출물 체크리스트 (**실제 요구 사항에 맞춥니다**)

> Your final plan must include the following elements: ...

원본 템플릿은 "구현 계획"의 6가지 요소를 나열합니다. 하지만 사용자의 산출물은 완전히 다른 것일 수 있습니다:

- **연구 보고서** → "요약 / 방법론 / 핵심 발견 / 한계 / 실행 권장 사항"
- **검수 보고서** → "문제 목록 / 심각도 등급 / 수정 제안 / 수정 전후 예시"
- **비교 매트릭스** → "차원 정의 / 채점 기준 / 결론 / 추천 근거"

---

## 작성 팁 (TL;DR)

1. **첫 문장을 다시 작성하십시오**: 한 줄로 역할, 목표, 출력 형식을 명시합니다.
2. **워크플로를 유연하게**: 가벼운 작업에는 1~2단계로 충분하고, 복잡한 작업에서만 5단계 풀 루프를 사용합니다.
3. **Step 1의 서브 역할을 다시 작성하십시오**: 기본값 (학술 논문 / 경쟁사 / 데모) 은 대개 원하는 것이 아닙니다.
4. **최종 "산출물 체크리스트"는 품질 기준입니다**: 출력 구조를 명확히 적어 두십시오 — Claude Code는 이를 엄격히 따를 것입니다.

---

## 리팩터링된 예시: Competitive Analyst

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

원본 Research Expert와 비교하면: 4단계로 축소되었고, 서브 역할은 6개에서 3개로 줄었으며, 산출물 목록은 "보고서 섹션"으로 완전히 다시 작성되었습니다.
