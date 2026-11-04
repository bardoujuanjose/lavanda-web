# Asistente virtual de Lavanda

Chat con IA (Claude) para la web lavandavendrell.es.

## Cómo funciona

```
Cliente en la web  →  chat.js  →  este servidor (Cloudflare Worker)  →  Claude
                                   └ guarda la clave de Claude en secreto
```

- `src/negocio.js`: **lo que sabe el asistente** (precios, horario, normas, incidencias).
  Si cambia algo del negocio, se edita aquí.
- `src/index.js`: el servidor. Recibe la conversación, pregunta a Claude y devuelve la respuesta.
- `wrangler.toml`: configuración de Cloudflare.
- `test/`: pruebas automáticas (`npm test`).

La burbuja de chat de la web está en `../chat.js` y `../chat.css`. Se activa al poner la
dirección del servidor en `data-endpoint` dentro de `../index.html`.

## Secretos

La clave de Claude se guarda en Cloudflare como secreto llamado `ANTHROPIC_API_KEY`
(Workers → lavanda-asistente → Settings → Variables and Secrets). **Nunca** se escribe en
ningún archivo del proyecto.

## Costes y límites

- Modelo: Claude Opus 5.5, con esfuerzo bajo (respuestas rápidas). Aprox. 1 céntimo por respuesta.
- Cada conversación admite hasta 20 mensajes y 1.000 caracteres por mensaje.
- Pon un **límite de gasto mensual** en console.anthropic.com → Settings → Limits.
