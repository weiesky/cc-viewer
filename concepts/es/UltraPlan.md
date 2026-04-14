# UltraPlan — La Maquina de Deseos Definitiva

## Que es UltraPlan

UltraPlan es la **implementacion localizada** de cc-viewer del comando nativo `/ultraplan` de Claude Code. Te permite usar las capacidades completas de `/ultraplan` en tu entorno local **sin necesidad de iniciar el servicio remoto oficial de Claude**, guiando a Claude Code para lograr tareas complejas de planificacion e implementacion mediante **colaboracion multi-agente**.

En comparacion con el modo Plan regular o Agent Team, UltraPlan puede:
- Ofrece los roles de **Experto en código** y **Experto en investigación** adaptados a diferentes tipos de tareas
- Desplegar múltiples agentes paralelos para explorar el código o realizar investigaciones desde diferentes dimensiones
- Incorporar investigacion externa (webSearch) sobre mejores practicas de la industria
- Ensamblar automaticamente un Code Review Team despues de la ejecucion del plan para revision de codigo
- Formar un ciclo cerrado completo de **Plan → Execute → Review → Fix**

---

## Notas Importantes

### 1. UltraPlan No Es Omnipotente
UltraPlan es una maquina de deseos mas poderosa, pero eso no significa que cada deseo pueda cumplirse. Es mas poderoso que Plan y Agent Team, pero no puede directamente "hacerte ganar dinero". Considera una granularidad de tareas razonable — divide los grandes objetivos en tareas medianas ejecutables en lugar de intentar lograrlo todo de una sola vez.

### 2. Actualmente Mas Efectivo para Proyectos de Programacion
Las plantillas y flujos de trabajo de UltraPlan estan profundamente optimizados para proyectos de programacion. Otros escenarios (documentacion, analisis de datos, etc.) pueden intentarse, pero es recomendable esperar las adaptaciones en versiones futuras.

### 3. Tiempo de Ejecucion y Requisitos de Ventana de Contexto
- Una ejecucion exitosa de UltraPlan normalmente toma **30 minutos o mas**
- Requiere que el MainAgent tenga una ventana de contexto grande (se recomienda el modelo Opus con 1M de contexto)
- Si solo tienes un modelo de 200K, **asegurate de ejecutar `/clear` en el contexto antes de comenzar**
- El `/compact` de Claude Code funciona mal cuando la ventana de contexto es insuficiente — evita quedarte sin espacio
- Mantener suficiente espacio de contexto es un prerequisito critico para la ejecucion exitosa de UltraPlan

Si tienes preguntas o sugerencias sobre el UltraPlan localizado, no dudes en abrir [Issues en GitHub](https://github.com/anthropics/claude-code/issues) para discutir y colaborar.

---

## Cómo funciona

UltraPlan ofrece dos roles de experto, adaptados a diferentes tipos de tareas:

### Experto en código
Un flujo de trabajo de colaboración multi-agente diseñado para proyectos de programación:
1. Desplegar hasta 5 agentes paralelos para explorar el código simultáneamente (arquitectura, identificación de archivos, evaluación de riesgos, etc.)
2. Opcionalmente desplegar un agente de investigación para examinar soluciones del sector vía webSearch
3. Sintetizar todos los hallazgos de los agentes en un plan de implementación detallado
4. Desplegar un agente de revisión para examinar el plan desde múltiples perspectivas
5. Ejecutar el plan una vez aprobado
6. Ensamblar automáticamente un Code Review Team para validar la calidad del código tras la implementación

### Experto en investigación
Un flujo de trabajo de colaboración multi-agente diseñado para tareas de investigación y análisis:
1. Desplegar múltiples agentes paralelos para investigar desde diferentes dimensiones (estudios sectoriales, artículos académicos, noticias, análisis competitivo, etc.)
2. Asignar un agente para sintetizar la solución objetivo verificando la rigurosidad y credibilidad de las fuentes recopiladas
3. Opcionalmente desplegar un agente para crear un demo del producto (HTML, Markdown, etc.)
4. Sintetizar todos los hallazgos en un plan de implementación integral
5. Desplegar múltiples agentes de revisión para examinar el plan desde diferentes roles y perspectivas
6. Ejecutar el plan una vez aprobado
