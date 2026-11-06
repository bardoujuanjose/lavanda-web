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

## Dar de alta una lavandería nueva: el panel `/admin`

`https://lavanda-asistente.bardoujuanjose.workers.dev/admin` (contraseña: secreto `ADMIN_CLAVE`).

1. **+ Nueva lavandería.** El formulario viene relleno con las secciones y normas de Lavanda como punto de
   partida: hay que cambiarlas por las de esa lavandería (sobre todo cómo cobra y cómo devuelve el dinero).
   **Vista previa** enseña las instrucciones que tendrían sus asistentes. Al guardar se valida todo y se avisa si
   quedan datos de otra lavandería (copiar y pegar). Se guarda como **borrador**: no afecta a nada.
2. **Conectar su WhatsApp:** en la ficha, poner el **móvil del dueño** (recibe los avisos) y pulsar
   **"Enlace para que el dueño conecte su WhatsApp"**. Se le manda ese enlace (caduca en 7 días): él entra con
   **su** Facebook y elige su caso:
   - **Su número ya usa la app WhatsApp Business** ("coexistencia"): sigue usando la app en su móvil. Cuando
     contesta él desde la app, el asistente se calla con ese cliente (12 h, o hasta que escriba `#teléfono fin`).
   - **Número nuevo o sin la app:** queda dedicado al asistente.

   El servidor termina el alta solo (comprueba con Meta que el número es de esa cuenta, lo registra o sincroniza
   la app, y guarda el token **cifrado**). **"Comprobar conexión"** dice si sigue funcionando.
   Si hiciera falta, también se puede pegar un token a mano ("Conexión manual").
3. **Pago en Meta:** el dueño tiene que añadir un método de pago en WhatsApp Manager
   (business.facebook.com/wa/manage) si Meta se lo pide.
4. **Voz (opcional):** comprar un número en Twilio, ponerlo en la ficha y configurar en él el webhook `/voz`.
5. **Web (opcional):** poner el chat en su página y su dominio en la ficha.
6. **Activar** desde la lista. Antes se comprueba que esté conectada y que no choque con otra (mismo número de
   WhatsApp, de voz o la misma web). Si algo afecta a otra lavandería, se avisa.

Las fichas de la base de datos se recargan en el servidor cada 30 segundos: un cambio puede tardar eso en notarse.
Lavanda es **fija** (archivo `lavanda.js`): se ve en el panel pero se cambia en el código.

### Secretos que necesita el panel (Cloudflare → Settings → Variables and Secrets)

| Secreto | Qué es |
|---|---|
| `ADMIN_CLAVE` | Contraseña del panel. Larga y distinta de `PRUEBA_CLAVE`. Tras 10 intentos fallidos, se bloquea 10 minutos. |
| `CLAVE_CIFRADO` | Clave para cifrar los tokens (mínimo 16 caracteres, mejor 32 al azar). **No se puede cambiar** sin volver a conectar todos los WhatsApp. |

### Lo que hay que hacer en Meta UNA sola vez (para que funcione el enlace de alta)

Según la documentación de Meta (Embedded Signup v4, octubre de 2026):

1. **Ser "Tech Provider"** en Meta con la empresa que venda el servicio (verificación del negocio y revisión
   de la app). Sin esto, Meta no deja que otras empresas conecten su número a nuestra app.
2. App de Meta → **Facebook Login for Business → Settings**: activar *Client OAuth login*, *Web OAuth login*,
   *Enforce HTTPS*, *Embedded Browser OAuth Login*, *Use Strict Mode for redirect URIs* y *Login with the
   JavaScript SDK*; y en **Allowed domains** y **Valid OAuth redirect URIs** poner
   `lavanda-asistente.bardoujuanjose.workers.dev`.
3. **Facebook Login for Business → Configurations → Create from template** → "WhatsApp Embedded Signup
   Configuration…". Su identificador va en `META_CONFIG_ID` (`wrangler.toml`).
4. El identificador de la app (arriba en el panel de Meta) va en `META_APP_ID`.
5. **WhatsApp → Configuration → Webhooks:** además de `messages`, suscribir `account_update` y, para la
   coexistencia, `history`, `smb_app_state_sync` y `smb_message_echoes`.
6. `GRAPH_VERSION` (`wrangler.toml`) es `v23.0`; la documentación ya usa `v27.0`. Conviene subirla tras probar.

### Dar de alta una lavandería FIJA (en el código, como Lavanda)

Solo si hace falta: copiar `lavanda.js`, cambiar sus datos, añadirla a `FICHAS_FIJAS` en `clientes/index.js`,
poner sus secretos en Cloudflare con los nombres de `secretos`, `npm test` y desplegar.

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
- **El alta por enlace está probada con Meta simulado** (formato de su documentación) y en un navegador, pero
  **no con Meta de verdad**: hace falta completar los pasos de Meta de arriba y probarlo con un número real.
- Coexistencia: el historial antiguo que manda Meta se acepta pero no se carga en la memoria del asistente; y si
  Meta no envía el teléfono del cliente (solo su identificador), un mensaje del dueño desde la app no calla al asistente.
- **Siguen siendo comunes a todas:** la clave de Claude, la app de Meta (`WHATSAPP_APP_SECRET`, token de
  verificación), la cuenta de Twilio y la voz de ElevenLabs.
- **Pruebas con servicios reales:** el enrutado está probado con peticiones simuladas. Falta probarlo con una
  segunda lavandería de verdad (un segundo número de WhatsApp y un número de Twilio).
