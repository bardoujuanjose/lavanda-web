# Asistentes virtuales de Lavanda

Un mismo servidor (Cloudflare Worker) con dos asistentes que usan Claude:

| Canal | Ruta | Qué hace |
|---|---|---|
| Chat de la web | `/chat` | Solo informa. Los problemas los manda a WhatsApp. |
| WhatsApp (689 81 02 13) | `/whatsapp` | Informa, entiende fotos, gestiona incidencias y avisa al dueño. |
| Panel de lavanderías | `/admin` | Alta, edición, conexión y activación de lavanderías (contraseña `ADMIN_CLAVE`). |
| Teléfono (Twilio) | `/voz` | Mismas normas que WhatsApp, hablando. Pasa la llamada al dueño en los casos difíciles. |

```
Web:       cliente → chat.js → /chat ─────────────┐
WhatsApp:  cliente → Meta → /whatsapp → memoria ──┴→ Claude
                                         del cliente
```

## Archivos

- `src/clientes/lavanda.js`: **la ficha de Lavanda**: sus datos (nombre, teléfono, horario, precios, máquinas…).
  Si cambia algo del negocio (un precio, el horario), se edita aquí. Ver `src/clientes/README.md`.
- `src/negocio.js`: **la plantilla**: las normas de cada canal, comunes a todas las lavanderías, con huecos
  que se rellenan con la ficha. `crearTextos(ficha)` monta todo lo que necesitan los asistentes.
- `src/clientes/index.js`: **reconoce de qué lavandería es** cada mensaje de WhatsApp (por su número), cada web (por su
  dominio) y cada llamada (por su número de Twilio). Hoy solo hay una (Lavanda); cada nueva tiene su ficha y su número.
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
3. Sigue las normas de Lavanda (las que se usaban en Botpress): "no arranca" paso a paso, casos de
   cambio y Bizum, derivar al teléfono, fidelización, justificantes, etc.
4. Los audios se transcriben con Workers AI (Whisper). Las fotos las ve Claude directamente.
5. **Avisa al dueño** por WhatsApp al cerrar un Bizum (máquina, importe y teléfono), al recoger un
   servicio personalizado o los datos de un justificante o factura. Después sigue atendiendo.
6. El dueño puede contestar a un cliente escribiendo al número de Lavanda desde su móvil
   (mientras tanto el asistente se calla con ese cliente y le reenvía sus mensajes):
   - `#34612345678 Hola, ya lo hemos revisado` → el cliente lo recibe desde el número de Lavanda.
   - `#34612345678 fin` → el asistente vuelve a atender a ese cliente.
   - `ayuda` → instrucciones.
7. Si nadie del equipo escribe en 12 horas, el asistente vuelve a atender solo.

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
| `ADMIN_CLAVE` | Contraseña del panel `/admin` |
| `CLAVE_CIFRADO` | Clave para cifrar los tokens de WhatsApp de las demás lavanderías (mín. 16 caracteres; no cambiarla) |

**Nunca** se escriben en ningún archivo del proyecto (el repositorio es público).

## Costes y límites

- Modelo: Claude Opus 5.5. Aprox. 1 céntimo por respuesta (algo más si hay fotos).
- WhatsApp: Meta cobra según el tipo de conversación; las respuestas a clientes dentro de 24 h suelen ser gratuitas.
- Pon un **límite de gasto mensual** en platform.claude.com → Gasto → Límites.

## Asistente de voz (Twilio ConversationRelay)

- En Twilio, el número tiene configurado en **Voice → A call comes in**: Webhook
  `https://lavanda-asistente.bardoujuanjose.workers.dev/voz` (HTTP POST).
- Las normas son las mismas que en WhatsApp (`PROCEDIMIENTOS` en la plantilla `negocio.js`) con adaptaciones para
  hablar (`INSTRUCCIONES_VOZ`).
- En los casos en que WhatsApp diría "llama al 689 810 213", la llamada se pasa a `OWNER_PHONE`.
  Si no contesta en 25 s, se le dice al cliente que escriba por WhatsApp y el dueño recibe un aviso
  de llamada perdida.
- Modelo de las llamadas: Claude Sonnet 5.5 con `thinking: between_tools` (sin razonamiento previo, más rápido). Se puede cambiar con la variable `VOZ_MODELO`.
- Voz: `VOZ_TTS_PROVIDER` y `VOZ_VOZ` en `wrangler.toml`.
- Secretos: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
