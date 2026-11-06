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
| `equipoCobro` | Con qué se paga, en una frase corta: `del cajero`, `del lector de tarjetas`… |
| `ejemploNoExiste` | Algo que el asistente no debe inventar (`no existe ninguna máquina de cambio`). |
| `origenesPermitidos` | Webs desde las que se puede usar el chat. |
| `secretos` | **Nombres** de los secretos de Cloudflare con su `phoneId` de WhatsApp, su `token` y el móvil del `dueno`. Nunca los valores: el repositorio es público. |
| `numerosVoz` | Números de Twilio por los que reciben llamadas (`+34…`). Con varias lavanderías, una llamada a un número que no figura aquí no se atiende. |
| `plantillaAviso` | (Opcional) Plantilla de Meta para avisar al dueño pasadas 24 h. Es de la cuenta de WhatsApp de cada lavandería. |
| `prefijoMemoria` | (Opcional) Solo Lavanda lo usa (`""`) para no perder las conversaciones que ya tiene guardadas. Las demás no lo ponen. |
| `conocimiento` | Una sección por tema: `general`, `precios`, `pago`, `lavadoras`, `secadora`, `permitido`, `consejos`, `fidelizacion`, `olvidada`. |

- `general`, `precios` y `pago` son obligatorias. Las demás pueden ser `null` si no aplican
  (por ejemplo, si no hay tarjeta de fidelización, el asistente ni la menciona).
- Los textos pueden llevar huecos como `{{telefono}}` o `{{horario}}`: se rellenan con los datos de arriba.
  Si un hueco usa un dato que no existe, **da error al arrancar** en vez de dejar un asistente a medias.

## Cómo se sabe de qué lavandería es cada cosa

Cada lavandería tiene **su propio número de WhatsApp**, su web y su teléfono de voz. El sistema las reconoce así
(`clientes/index.js`):

| Canal | Se reconoce por | Si no se reconoce |
|---|---|---|
| WhatsApp | El número de WhatsApp al que han escrito (Meta lo incluye en cada aviso). | Se ignora el mensaje y se anota en el registro. |
| Web | La página desde la que escriben. | 403, sin datos de ninguna lavandería. |
| Voz | El número de Twilio al que llaman. | Mensaje de "número no disponible" y se cuelga. |

**Regla de seguridad:** con varias lavanderías, algo que no se reconoce **no se atiende nunca** (no se contesta
con los datos de otra). Con **una sola**, se atiende con ella aunque no coincida, como hasta ahora, para no cortar
nada por un fallo de configuración.

La memoria de los clientes de WhatsApp es **por lavandería**: la misma persona escribiendo a dos lavanderías tiene
dos conversaciones separadas. Las conversaciones que ya existen de Lavanda se conservan tal cual.

## Dar de alta una lavandería nueva

1. **Ficha:** copiar `lavanda.js` a `clientes/<id>.js`, cambiar la constante y rellenar todos sus datos, textos y
   `normas` con los de esa lavandería.
2. **Registrarla:** añadirla en `clientes/index.js` (o con `registrarCliente`, que la valida al momento).
3. **Secretos en Cloudflare** (Settings → Variables and Secrets), con los nombres que puso en `secretos`:
   el identificador de su número de WhatsApp, su token y el móvil del dueño.
4. **WhatsApp (Meta):** su número tiene que estar en la app de Meta de la que cuelga este servidor, con el
   webhook `/whatsapp` activado, y tener creada su plantilla de avisos (nombre en `plantillaAviso`).
5. **Voz (Twilio):** comprar un número, apuntarlo en `numerosVoz` y configurar en él el webhook `/voz`.
6. **Web:** poner el chat en su página y su dominio en `origenesPermitidos`.
7. `npm test` (la ficha se valida sola) y desplegar.

> ⚠️ **Al añadir la segunda lavandería, Lavanda deja de ser "la única".** A partir de ese momento hay que tener
> en la ficha de Lavanda su número de Twilio en `numerosVoz` (si no, sus llamadas se rechazan) y el secreto
> `WHATSAPP_PHONE_ID` bien puesto (si no, sus mensajes se ignoran). Compruébalo antes de desplegar.

## Las normas (`normas`): lo que cambia según cómo se cobra

Cada lavandería cobra de una forma (cajero de efectivo, tarjeta en cada máquina, app, fichas…) y resuelve
los problemas de otra. Por eso las normas de incidencias **no son comunes**: se escriben en la ficha.

| Campo de `normas` | Qué es |
|---|---|
| `procedimientos` | Problemas con máquinas, dinero, cambio y devoluciones; otros casos frecuentes; justificantes. Es lo que más cambia entre lavanderías. (WhatsApp y voz) |
| `web` | El chat de la web solo informa: qué hace cuando hay un problema (normalmente, derivar). |
| `whatsapp` | Cuándo sugerir llamar y qué no se puede prometer. |
| `avisos` | Cuándo usar la herramienta que avisa al dueño. |
| `voz` | Adaptaciones al hablar por teléfono (resolver dinero, pasar la llamada, decir teléfonos…). |
| `motivosAviso` | Los motivos de aviso que existen (`bizum`, `devolucion`…) con el título del mensaje que recibe el dueño. |
| `herramientaAviso` | Cuándo usarla y cómo se llaman el importe y el teléfono. |

Ejemplo de otro modo de cobro (tarjeta, devolución a la tarjeta, sin Bizum): `test/fixtures/pepito.js`.

## Qué NO está todavía resuelto (pendiente)

- **Escribir las normas de una lavandería nueva es trabajo manual.** Lo previsto: cuando haya 2 o 3 lavanderías
  reales con modos de cobro parecidos, sacar **modelos de cobro reutilizables** ("cajero de efectivo con Bizum",
  "tarjeta en la máquina", "app"…) con un cuestionario de alta que los elija y rellene sus importes.
  No se hace antes de ver casos reales para no inventar una estructura que luego no sirva.
- **La regla de dinero de Lavanda** (límite de 20 €, 48 h, ejemplos con las máquinas 3 y 4) está escrita dentro de
  `procedimientos`; es de Lavanda y no se aplica a otras.
- **Las fichas siguen siendo archivos del código.** Dar de alta una lavandería exige tocar el repositorio y volver
  a desplegar. Lo siguiente es cargarlas de una base de datos (el registro ya lo permite con `registrarCliente`).
- **Los tokens de WhatsApp de cada lavandería se guardan como secretos a mano.** Con muchas, lo normal es el
  "registro integrado" de Meta (el dueño conecta su número él mismo) y guardar su token cifrado en la base de datos.
- **Siguen siendo comunes a todas:** la clave de Claude, la app de Meta (`WHATSAPP_APP_SECRET`, token de
  verificación), la cuenta de Twilio y la voz de ElevenLabs.
- **Pruebas con servicios reales:** el enrutado está probado con peticiones simuladas. Falta probarlo con una
  segunda lavandería de verdad (un segundo número de WhatsApp y un número de Twilio).
