# Body Diff JSON (Comparación incremental del cuerpo de la solicitud)

## Contexto

El MainAgent de Claude Code utiliza un mecanismo de envío de contexto completo: cada solicitud incluye el historial completo de la conversación, el system prompt, las definiciones de herramientas, etc. Esto significa que a medida que avanza la conversación, el cuerpo de la solicitud se vuelve cada vez más grande, y es difícil identificar rápidamente "qué se agregó en esta ronda" al ver el Body sin procesar.

Body Diff JSON resuelve exactamente este problema: compara automáticamente los cuerpos de dos solicitudes MainAgent consecutivas, extrae la parte incremental y te permite ver de un vistazo el contenido realmente nuevo en esta solicitud.

## Cómo funciona

1. **Identificar solicitudes MainAgent consecutivas**: La solicitud actual debe ser de tipo MainAgent y debe existir una solicitud MainAgent anterior
2. **Comparación campo por campo**: Recorre todos los campos de nivel superior del cuerpo de la solicitud, omitiendo las propiedades internas con prefijo `_`
3. **Extracción inteligente de diferencias**:
   - Campos nuevos: Se muestran directamente
   - Campos eliminados: No se muestran (generalmente no afectan la comprensión)
   - Campos modificados: Se muestra el valor actual
   - Tratamiento especial del array `messages`: Solo se muestran los mensajes nuevos (ya que en una conversación normal se usa el modo de adición, los mensajes previos no cambian)
4. **Detección de reducción del cuerpo**: Si el cuerpo actual es más pequeño que el anterior, indica un truncamiento de contexto o reinicio de sesión, y se muestra un mensaje informativo en lugar del diff

## Escenarios típicos

En una ronda normal de conversación, el Body Diff JSON generalmente solo contiene:
- `messages`: 1~2 mensajes nuevos (la entrada del usuario + la respuesta del asistente de la ronda anterior)

Si ves cambios en `system`, `tools`, `model` u otros campos en el diff, significa que hubo un cambio de configuración en esta ronda, lo cual suele ser también la causa de la reconstrucción de caché.

## Cómo usarlo

- El Body Diff JSON se muestra en el panel de detalles de la solicitud MainAgent
- Haz clic en el título para expandir/contraer
- Soporta dos modos de visualización: JSON y Text, además de copiar con un clic
- En **CC-Viewer → Configuración global** (esquina superior izquierda), puedes configurar "Expandir Body Diff JSON por defecto"
