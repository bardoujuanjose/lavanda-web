# Asistentes virtuales de Lavanda

Un mismo servidor (Cloudflare Worker) con dos asistentes que usan Claude:

| Canal | Ruta | Qué hace |
|---|---|---|
| Chat de la web | `/chat` | Solo informa. Los problemas los manda a WhatsApp. |
| WhatsApp (689 81 02 13) | `/whatsapp` | Informa, entiende fotos, gestiona incidencias y avisa al dueño. |

```
Web:       cliente → chat.js → /chat ─────────────┐
WhatsApp:  cliente → Meta → /whatsapp → memoria ──┴→ Claude
                                         del cliente
```

## Archivos

- `src/negocio.js`: **lo que saben los asistentes** (datos del negocio y normas de cada canal).
  Si cambia algo del negocio, se edita aquí.
- `src/index.js`: reparte las peticiones entre la web y WhatsApp.
- `src/web.js`: el chat de la web.
- `src/webhook.js`: recibe los mensajes de WhatsApp y comprueba que vienen de Meta.
- `src/conversacion.js`: la memoria de cada cliente de WhatsApp (Durable Object).
- `src/asistente-whatsapp.js`: la lógica del asistente de WhatsApp (Claude, avisos, pausa).
- `src/whatsapp.js`: las llamadas a la API de WhatsApp.
- `test/`: pruebas automáticas (`npm test`).

## Cómo funciona WhatsApp

1. El asistente espera 3 segundos por si el cliente manda varios mensajes y contesta a todos juntos.
2. Recuerda los últimos 30 mensajes de cada cliente.
3. Si hay una incidencia o el cliente quiere hablar con una persona, **avisa al dueño** por WhatsApp
   y se queda callado en ese chat (los mensajes nuevos del cliente se reenvían al dueño).
4. El dueño contesta escribiendo al número de Lavanda desde su móvil:
   - `#34612345678 Hola, ya lo hemos revisado` → el cliente lo recibe desde el número de Lavanda.
   - `#34612345678 fin` → el asistente vuelve a atender a ese cliente.
   - `ayuda` → instrucciones.
5. Si nadie del equipo escribe en 12 horas, el asistente vuelve a atender solo.

Si el dueño no ha escrito al número de Lavanda en las últimas 24 horas, WhatsApp no deja enviarle
mensajes libres: entonces el aviso se manda con la plantilla aprobada `aviso_lavanda`
(un parámetro en el cuerpo, idioma `es`).

## Secretos (Cloudflare → Settings → Variables and Secrets → Runtime, tipo **Secret**)

| Nombre | Qué es |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de Claude |
| `WHATSAPP_TOKEN` | Token permanente de la app de Meta |
| `WHATSAPP_PHONE_ID` | Identificador del número de WhatsApp en Meta |
| `WHATSAPP_APP_SECRET` | "App secret" de la app de Meta |
| `WHATSAPP_VERIFY_TOKEN` | Palabra secreta inventada para conectar Meta |
| `OWNER_PHONE` | Móvil personal del dueño (recibe los avisos) |

**Nunca** se escriben en ningún archivo del proyecto (el repositorio es público).

## Costes y límites

- Modelo: Claude Opus 5.5. Aprox. 1 céntimo por respuesta (algo más si hay fotos).
- WhatsApp: Meta cobra según el tipo de conversación; las respuestas a clientes dentro de 24 h suelen ser gratuitas.
- Pon un **límite de gasto mensual** en platform.claude.com → Gasto → Límites.
