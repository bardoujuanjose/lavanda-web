# Estado del proyecto Lavanda (noviembre de 2026)

Resumen para retomar el trabajo en una conversación nueva.
Lavanda: lavandería autoservicio, Avda. Baix Penedès 33, 43700 El Vendrell.
Titular: Carmen María Mondéjar Castejón (autónoma). Socio: Juan José Bardou (Juanjo).

## Cómo se publica el Worker: Cloudflare Workers Builds conectado a GitHub (bardoujuanjose/lavanda-web), rama de producción main, directorio raíz asistente, comando npx wrangler deploy. Fusionar en main publica. Las ramas dan error en la vista previa de Cloudflare (falta el bloque [previews] en wrangler.toml); no afecta a producción.

Qué hay funcionando

| Pieza | Dónde | Notas |
|---|---|---|
| Web | https://lavandavendrell.es (GitHub Pages, repo `bardoujuanjose/lavanda-web`) | Dominio en DonDominio. Enlaces a Facebook, Instagram y WhatsApp en el pie. |
| Chat de la web | `chat.js` + servidor `/chat` | Solo informa; los problemas los manda a WhatsApp. |
| Asistente de WhatsApp | Cloudflare Worker `lavanda-asistente`, ruta `/whatsapp` | Sustituye a Botpress (apagado). App de Meta "Lavanda Asistente" publicada. Claude Opus 5.5. |
| Asistente de voz | Ruta `/voz` (Twilio ConversationRelay) | Claude Sonnet 5.5 sin razonamiento previo, voz ElevenLabs `2BJPFS2QZRUEpfkbclGy` a 0.9. Probado desde el navegador. |
| Chat de pruebas | https://lavanda-asistente.bardoujuanjose.workers.dev/prueba | Con contraseña (`PRUEBA_CLAVE`). Botones Llamar, Twilio y WhatsApp. |
| Normas de los asistentes | `asistente/src/negocio.js` (plantilla) | Basadas en las de Botpress. Casos A, B, C y D de dinero/cambio, Bizum en 48 h previa verificación. Los datos de Lavanda están en su ficha: `asistente/src/clientes/lavanda.js`. |
| Correo | info@lavandavendrell.es | Reenvío gratuito con ImprovMX a juanjobardou@hotmail.com. |
| Facebook | facebook.com/lavandalaundryelvendrell | Web, correo, teléfono y dirección actualizados. |
| Instagram | @lavandavendrell | Cuenta profesional, en la cuenta de Meta de Juanjo. |
| Google Maps | Perfil de Empresa | Juanjo propietario principal, Carmen propietaria. |
| Google Search Console | Propiedad de dominio lavandavendrell.es | Verificada (TXT google-site-verification en DonDominio, no borrar). Sitemap enviado, indexación solicitada. Web con datos estructurados (Laundromat), sitemap.xml y robots.txt. |

Secretos (en Cloudflare, nunca en el repo): ANTHROPIC_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID,
WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, OWNER_PHONE, PRUEBA_CLAVE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ADMIN_CLAVE, CLAVE_CIFRADO (estos dos creados el 06/11/2026).

## Pendiente

1. **Facebook: recuperar el control total de la página** (en curso).
   - El único admin con control total ("Lavanda Aguas") ya no existe; Carmen tiene acceso parcial.
   - Meta pide abrir una "Disputa de administrador de página" en
     https://www.facebook.com/business-support-home/contact-support y subir el PDF de documentación
     (carta firmada por Carmen, su DNI, recibo de autónomos y anexo). El PDF lo tienen Juanjo/Carmen.
   - Requisito: autenticación en dos pasos activada y sin restricciones en el perfil de quien será admin.
     A Carmen no le deja activarla todavía (revisar "Estado de la cuenta"). Plan B: pedir el control para Juanjo.
2. **Twilio**: número español local pedido. El primer paquete regulatorio ("Lavanda", Individual) se rechazó
   (DNI de una sola cara y datos/dirección que no coincidían). Reenviado a nombre de Carmen María Mondejar
   Castejón, con su DNI (dos caras en un PDF) y la dirección de su DNI. Pendiente de nueva revisión. Cuando se apruebe:
   Voice → A call comes in → Webhook `https://lavanda-asistente.bardoujuanjose.workers.dev/voz` (POST),
   probar llamando desde un móvil y activar desvío en Movistar (`**61*NUMERO**20#`).
3. **Google Maps**: corregir horario (pone cierre 22:00; es 8:00–21:00), añadir descripción y redes.
4. **DonDominio**: poner la renovación del dominio en automática (caduca el 04/11/2027).
5. **Meta**: plantilla `aviso_lavanda` (Utilidad, español, cuerpo `Nuevo aviso de Lavanda: {{1}}`) y método de pago.
6. ~~**GitHub Pages**: marcar "Enforce HTTPS"~~ (hecho).
7. **Claude Console**: poner límite de gasto mensual.

## Producto para otras lavanderías (en marcha)

Idea: vender el asistente (web + WhatsApp + voz) a lavanderías autoservicio de toda España. Plan comentado: suscripción
(Básico ≈ 39 €/mes con web y WhatsApp; Completo ≈ 89 €/mes con voz y panel; precios por validar), pilotos con 2-3
lavanderías, distribuidores de maquinaria como canal. Para la voz, un número de Twilio por lavandería (a nombre de la
empresa de Juanjo, no de Carmen) al que cada cliente desvía su teléfono; `ForwardedFrom` no está garantizado.

Hecho: los textos de los asistentes ya son una **plantilla + una ficha por lavandería** (`asistente/src/clientes/`,
ver su README). Lavanda se comporta igual que antes (hay una prueba que lo comprueba letra por letra).
Las normas de incidencias y dinero también van en la ficha (`normas`), porque cambian según cómo cobra cada local
(cajero, tarjeta, app…). Cada lavandería tiene **su propio número de WhatsApp**: el sistema elige la ficha por el número al que escriben (WhatsApp),
la web de origen (chat) y el número de Twilio al que llaman (voz); cada una con sus secretos, su dueño y su memoria de
clientes (las conversaciones actuales de Lavanda se conservan). Probado con peticiones simuladas y dos lavanderías;
**desplegado en producción el 06/11/2026** (PR nº 1 fusionada en main; Lavanda sigue contestando bien por WhatsApp y /admin abre con `ADMIN_CLAVE`), sin probar aún con una segunda lavandería real. Con una sola (hoy) todo funciona como antes.
**Panel `/admin`** (contraseña `ADMIN_CLAVE`): alta y edición de lavanderías en una base de datos (Durable Object
`Registro`), conexión de su WhatsApp (token cifrado con `CLAVE_CIFRADO`) y activación con comprobaciones. Lavanda
sigue siendo fija en el código. Secretos `ADMIN_CLAVE` y `CLAVE_CIFRADO` ya creados en Cloudflare (no cambiar `CLAVE_CIFRADO`).
**Alta de WhatsApp por el dueño** (`/alta/…`, registro integrado de Meta v4): el panel genera un enlace; el dueño
conecta su número con su Facebook, también si ya usa la app WhatsApp Business ("coexistencia": cuando contesta
desde la app, el asistente se calla con ese cliente). Probado con Meta simulado y en navegador, **no con Meta real**.
**Para activarlo hace falta, en Meta:** ser Tech Provider, configurar Facebook Login for Business (dominio del
servidor) y crear la configuración de Embedded Signup; poner `META_APP_ID` y `META_CONFIG_ID` en `wrangler.toml`.
Pasos detallados en `asistente/src/clientes/README.md`.
Pendiente: probar el alta con un número real, modelos de cobro reutilizables cuando haya 2-3 lavanderías reales,
cobro de la suscripción.

## Próxima tarea: publicaciones de Instagram (@lavandavendrell)

Preparar el primer mes de publicaciones para programarlas desde la app de Instagram o desde el
Planificador de Meta Business Suite (no se puede publicar por API: la página de Facebook no tiene
control total).
- Frecuencia: 2 por semana (martes y viernes, 19:00), unas 8 publicaciones.
- Formato: imágenes 1080×1350 con el estilo de la web (colores de `styles.css`, `marca.png`,
  `emblema.png`, ilustración de las botellas de `index.html`) + texto y hashtags para cada una.
- Temas: presentación, precios (M 14 kg 6 €, L 16 kg 8 €, secadora XL 4 €/20 min), detergente +
  suavizante + desinfectante incluidos, edredones (individual M, matrimonio L, programa 1),
  "¿llueve? secadoras XL", tarjeta de fidelización (-10 %), asistente de WhatsApp, consejos de lavado.
- Sin fotos reales por ahora (usar diseños); si llegan fotos del local, combinarlas.
