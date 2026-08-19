# Contaminación de contexto de la API de traducción

## Contexto

CC-Viewer incluye una función de traducción integrada (`POST /api/translate`) impulsada por la API de mensajes de Anthropic. En la implementación inicial, las solicitudes de traducción reutilizaban las credenciales de autenticación almacenadas en caché de la sesión de Claude Code, incluyendo tanto los encabezados `x-api-key` como `authorization`. Esto provocó un problema sutil pero grave: los resultados de traducción devolvían con frecuencia contenido irrelevante.

## Causa raíz

### Diferencia fundamental entre los dos métodos de autenticación

La API de Anthropic admite dos métodos de autenticación:

| Método | Encabezado | Origen típico | Características |
|--------|------------|---------------|-----------------|
| Clave API | `x-api-key: sk-ant-...` | Variable de entorno / Console | Sin estado, cada solicitud es independiente |
| Token OAuth | `authorization: Bearer sessionToken` | Inicio de sesión con suscripción de Claude Code | Vinculado a la sesión, el servidor mantiene la asociación de contexto |

La diferencia clave: **las claves API son sin estado** — cada solicitud es completamente independiente; mientras que **los tokens de sesión OAuth son con estado** — el servidor de Anthropic asocia las solicitudes que usan el mismo token al mismo contexto de sesión.

### Cadena de contaminación

Cuando Claude Code utiliza el inicio de sesión OAuth por suscripción, el flujo de autenticación es el siguiente:

```
Conversación principal de Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                                  ↑
Solicitud de traducción de CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Dado que las solicitudes de traducción reutilizaban el mismo token de sesión, el servidor de Anthropic podía asociar las solicitudes de traducción con el contexto de la conversación principal de Claude Code. Esto provoca:

1. **Los resultados de traducción se ven influenciados por el contexto de la conversación principal**: El prompt del sistema de la solicitud de traducción es "eres un traductor", pero el contexto del servidor aún contiene el historial de conversación de Claude Code, lo que puede interferir con el modelo
2. **La conversación principal se ve perturbada por las solicitudes de traducción**: El contenido de las solicitudes de traducción (fragmentos de texto de la interfaz) puede inyectarse en el contexto de la conversación principal, causando que las respuestas de Claude Code se desvíen
3. **Comportamiento impredecible**: Dado que la contaminación de contexto es un comportamiento del lado del servidor, el cliente no puede detectarlo ni controlarlo

## Lecciones aprendidas

- **Los tokens de sesión OAuth no son "simplemente otra clave API"** — llevan estado del lado del servidor, reutilizarlos significa compartir contexto
- **Las llamadas internas de servicio deben usar autenticación independiente y sin estado** para evitar la asociación con sesiones de usuario

## Referencias

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
