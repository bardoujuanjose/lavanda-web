# Fichas de lavanderías

Cada lavandería tiene **una ficha**: un archivo con todos sus datos. Los asistentes de web, WhatsApp y
voz se montan a partir de la ficha y de la plantilla común (`../negocio.js`).

```
clientes/lavanda.js      ficha de Lavanda (El Vendrell)  ← el ejemplo completo
clientes/index.js        registro: dice qué ficha usar (hoy solo hay una)
../negocio.js            plantilla con las normas comunes (no lleva datos de ninguna lavandería)
```

## Qué lleva una ficha

| Campo | Para qué |
|---|---|
| `id` | Nombre corto sin espacios (`"lavanda"`). |
| `nombre`, `ciudad` | Cómo se presenta el asistente y qué ciudad dice en la hora. |
| `direccionCompleta`, `direccionCorta` | Dirección con y sin código postal. |
| `web` | Dominio de la web (sin `https://`). |
| `telefono`, `telefonoWhatsapp` | Teléfono de atención, como se dice (`689 810 213`) y para enlaces (`34689810213`). |
| `horario` | Frase que se repite en muchos mensajes (`de 8:00 a 21:00`). |
| `zonaHoraria` | Normalmente `Europe/Madrid`. |
| `resenaUrl` | Enlace para pedir reseñas en Google. |
| `origenesPermitidos` | Webs desde las que se puede usar el chat. |
| `conocimiento` | Una sección por tema: `general`, `precios`, `pago`, `lavadoras`, `secadora`, `permitido`, `consejos`, `fidelizacion`, `olvidada`. |

- `general`, `precios` y `pago` son obligatorias. Las demás pueden ser `null` si no aplican
  (por ejemplo, si no hay tarjeta de fidelización, el asistente ni la menciona).
- Los textos pueden llevar huecos como `{{telefono}}` o `{{horario}}`: se rellenan con los datos de arriba.
  Si un hueco usa un dato que no existe, **da error al arrancar** en vez de dejar un asistente a medias.

## Dar de alta una lavandería nueva

1. Copiar `lavanda.js` a `clientes/<id>.js` y cambiar el nombre de la constante.
2. Rellenar todos los datos y cada sección de `conocimiento` **con los de esa lavandería**.
3. Añadirla a `FICHAS` en `clientes/index.js`.
4. `npm test` (la ficha se valida sola).

## Qué NO está todavía en la ficha (pendiente)

- **Las normas de dinero** (casos A–D: no arranca, cambio, Bizum, límite de 20 €, 48 horas) siguen en la
  plantilla `PROCEDIMIENTOS` con los ejemplos de Lavanda (máquina 4 = 8 €, etc.). Valen tal cual para una
  lavandería con el mismo sistema de cajero; para otra distinta hay que revisarlas y sacarlas a la ficha.
- **Qué ficha se usa en cada petición.** Hoy `obtenerCliente(env)` devuelve siempre Lavanda. Para varias
  lavanderías hay que elegirla según el número al que llaman (voz), el número de WhatsApp que recibe el
  mensaje o la web desde la que se escribe, y guardar las fichas en una base de datos en vez de en archivos.
- **Datos por lavandería que siguen siendo del servidor:** móvil del dueño (`OWNER_PHONE`), credenciales de
  WhatsApp (`WHATSAPP_*`), nombre de la plantilla de avisos de Meta y voz de ElevenLabs.
