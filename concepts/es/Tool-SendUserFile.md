# SendUserFile

Envía uno o más archivos al usuario — artefactos generados, capturas de pantalla, informes — con control sobre cómo los presenta el cliente.

## Cuándo usar

- Produjiste un archivo que el usuario necesita (un informe, una imagen, una página HTML) y quieres hacerlo visible, no solo mencionar su ruta.
- Responder con un adjunto (`status="normal"`), o hacer visible de forma proactiva algo que el usuario no ha pedido pero necesita ver ahora (`status="proactive"`).

## Activación

- Solo disponible cuando hay un cliente de Remote Control conectado, o cuando la sesión se ejecuta en un entorno de nube gestionado (p. ej. Claude Code en la web).
- No disponible en Amazon Bedrock, Google Cloud ni Microsoft Foundry.
- Requiere que la sesión permita enviar archivos (una capacidad restringida por configuración/función); no se ofrece en modo brief.

## Parámetros

- `files` (array de strings, obligatorio): Rutas de archivos (absolutas o relativas al directorio de trabajo actual) a enviar al usuario. Pasa siempre un array, incluso para un solo archivo.
- `caption` (string, opcional): Leyenda corta para el/los archivo(s).
- `status` (string, obligatorio): `proactive` al hacer visible un archivo que el usuario no ha pedido y necesita ver ahora — un artefacto generado, un informe completado; `normal` al responder a algo que el usuario acaba de decir.
- `display` (string, opcional): `render` abre el archivo en línea en el panel lateral (HTML, SVG, Mermaid, imágenes, PDFs); `attach` muestra solo una tarjeta de descarga (entregables que el usuario guardará y abrirá en otro lugar). Omítelo para que el cliente decida por tipo de archivo.

## Ejemplos

### Ejemplo 1: Entregar un informe generado

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Notas

- Elige `display="attach"` para archivos que el usuario guarda y abre en otra aplicación; `render` para cualquier cosa que deba mirar de inmediato.
