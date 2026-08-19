# Workflow

Ejecuta un script que orquesta muchos subagentes de forma determinista —distribución en abanico, canalizaciones, bucles y verificación— para trabajo demasiado amplio, demasiado incierto o demasiado grande para un solo contexto.

## Cuándo usarlo

- Descomponer una tarea grande y cubrirla en paralelo a través de muchos agentes
- Contrastar los hallazgos con una verificación independiente o adversarial antes de confiar en ellos
- Abordar una escala que un solo contexto no puede contener: migraciones, auditorías, barridos amplios en múltiples archivos

## Cómo funciona

- Se ejecuta en segundo plano; se te notifica cuando termina. Sigue el progreso en directo con `/workflows`.
- El script coordina agentes con `agent()`, `parallel()`, `pipeline()` y `phase()`.
- `pipeline()` transmite cada elemento a través de las etapas sin barrera (por defecto); `parallel()` es una barrera que espera todos los resultados.
- Con un `schema`, cada `agent()` devuelve datos estructurados y validados en lugar de texto libre.

## Notas

- Solo se ejecuta cuando el usuario opta explícitamente por la orquestación multiagente; puede generar muchos agentes y consumir una cantidad considerable de token.
- La concurrencia tiene un límite por workflow; los agentes sobrantes se ponen en cola y se ejecutan a medida que se liberan espacios.
- Para un solo subagente, usa en su lugar la herramienta `Agent`; reserva Workflow para una verdadera distribución en abanico.

## Conceptos relacionados

- Se basa en la herramienta `Agent`, ejecutando muchos agentes bajo un flujo de control determinista.
