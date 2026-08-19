# Experto UltraPlan personalizado — Guía de creación

## Qué hacen los dos campos de entrada

- **Nombre del experto**: la etiqueta mostrada en el botón de rol en la fila de variantes UltraPlan (máx. 30 caracteres). Es solo un nombre de visualización y **nunca** se envía a Claude Code.
- **Cuerpo del prompt**: tu instrucción de rol. Al crear un nuevo experto, el editor **viene precargado** con el envoltorio `<system-reminder>...</system-reminder>` y su encabezado de alcance `[SCOPED INSTRUCTION]` — **escribe tu instrucción de rol dentro del envoltorio**. cc-viewer no envuelve dos veces: si el envoltorio está presente, se envía tal cual; si lo quitas, cc-viewer añade uno de nuevo en el momento del envío.

---

## ¿Cómo es la plantilla del experto?

Cada experto integrado (Code Expert / Research Expert) es esencialmente un bloque `<system-reminder>` inyectado en el contexto de Claude Code. Tu experto personalizado pasa exactamente por la misma canalización. Aquí está la plantilla **Research Expert** desglosada:

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

## Desglose sección por sección

### 1. Encabezado de alcance `[SCOPED INSTRUCTION]` (envoltorio — precargado para ti)
> The following instructions are intended for the next 1–3 interactions...

Esto le dice a Claude Code: **estas instrucciones solo están activas durante los próximos 1–3 turnos**, luego se desvanecen. Evita que la «persona experta» se filtre posteriormente a una conversación no relacionada.

**Esta línea viene precargada en el editor — déjala tal cual; no necesitas reescribirla.**

### 2. Definición de tarea inicial (**esto es lo que deberías reescribir**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Este es el «sujeto-verbo-objeto» de toda la plantilla: **le dice a Claude Code la postura y el objetivo**. El predeterminado «exploración multiagente + plan de implementación» se ajusta bien a las tareas de **ingeniería de software / planificación**, pero resulta incómodo para muchos otros dominios (revisión de contenido, análisis de datos, redacción publicitaria, investigación de mercado, auditoría de cumplimiento…).

**Recomendamos encarecidamente reescribir esta línea para tu objetivo**, por ejemplo:

- **Revisor de contenido**: «Eres un revisor de contenido sénior especializado en {dominio}. Tu objetivo es identificar inexactitudes fácticas, inconsistencias de tono y debilidades estructurales en el material proporcionado.»
- **Analista competitivo**: «Realiza un análisis competitivo riguroso para {categoría de producto}. Produce una matriz de comparación, insights de posicionamiento y recomendaciones estratégicas.»
- **Redactor publicitario**: «Genera múltiples variantes creativas de copy para {escenario}, cada una con posicionamiento, tono y estrategia de llamada a la acción distintos.»

### 3. Pasos del flujo de trabajo (1–5 elementos — **recorta o amplía según la complejidad**)

El Research Expert tiene 5 pasos: **explorar → sintetizar → revisar → enviar plan → ejecutar**. Esto impone «multiagente paralelo + revisión cruzada + aprobación del plan» — tres capas de rigor, apropiadas para tareas de alto riesgo/amplio alcance, pero **excesivas para las ligeras**.

- **Tarea simple** (búsqueda única / pequeña corrección): omite el despacho multiagente y la revisión; simplemente «produce la respuesta» en un solo paso.
- **Tarea moderada**: mantén «explorar → sintetizar → revisar»; omite el baile de ExitPlanMode; entrega el resultado directamente.
- **Tarea compleja y costosa** (gran refactorización, comparación multiopción, investigación interdisciplinaria): mantén los 5 pasos, posiblemente añade un paso de «modelo de riesgo» o «matriz de comparación de opciones».

### 4. Subroles en el Paso 1 (**adapta a tu dominio**)

Research Expert enumera 6 roles potenciales (explorador de la industria, investigador académico, sintetizador + verificador de hechos, analista de la competencia, productor de demo, hueco de extensibilidad). **Reescribe esta lista para tu escenario**:

- **Redacción**: «recopilador de fuentes + analista de estilo + verificador de hechos»
- **Análisis de datos**: «agente de limpieza de datos + agente de modelado estadístico + agente de visualización»
- **Auditoría de código**: «agente de análisis estático + auditor de cadena de dependencias + modelador de amenazas»

### 5. Lista de verificación final de entregables (**alinéala con tu necesidad real**)

> Your final plan must include the following elements: ...

La plantilla original enumera 6 elementos de un «plan de implementación». Tu entregable podría ser algo completamente diferente:

- Un **informe de investigación** → «Resumen ejecutivo / Metodología / Hallazgos clave / Limitaciones / Recomendaciones de acción»
- Un **informe de revisión** → «Lista de problemas / Calificación de gravedad / Sugerencias de corrección / Ejemplos antes y después»
- Una **matriz de comparación** → «Definiciones de dimensiones / Rúbrica de puntuación / Conclusiones / Justificación de la recomendación»

---

## Consejos de creación (TL;DR)

1. **Reescribe la oración inicial**: indica el rol, el objetivo y el formato de salida en una sola línea.
2. **Flexibiliza el flujo de trabajo**: 1–2 pasos para tareas ligeras, el ciclo completo de 5 pasos solo para las complejas.
3. **Reescribe los subroles del Paso 1**: los valores predeterminados (artículos académicos / competidores / demo) probablemente no son lo que quieres.
4. **La «lista de verificación de entregables» final es tu estándar de calidad**: especifica la estructura de salida — Claude Code la seguirá estrictamente.

---

## Un ejemplo refactorizado: Analista competitivo

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

En comparación con el Research Expert original: recortado a 4 pasos, subroles reducidos de 6 a 3, lista de entregables completamente reescrita como «secciones del informe».
