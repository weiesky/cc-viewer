# SuggestConnectors

Resuelve los payloads completos de conectores para los valores `directoryUuid` devueltos por `SearchMcpRegistry`, para poder ofrecer al usuario conectores concretos que habilitar.

## Cuándo usar

- Después de que `SearchMcpRegistry` devuelva conectores candidatos, para obtener sus detalles completos y presentarlos.

## Activación

- Solo disponible en sesiones remotas (claude.ai) en la API first-party.

## Parámetros

- `uuids` (array de strings, obligatorio): Valores `directoryUuid` o `server_id` a resolver. De 1 a 32 elementos, cada uno de 1 a 64 caracteres.

## Ejemplos

### Ejemplo 1: Resolver dos resultados del registro

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Notas

- Nunca adivines UUIDs — solo resuelve identificadores que hayan venido de `SearchMcpRegistry`.
- La herramienta no conecta nada por sí misma; habilitar un conector ocurre fuera de banda.
