# Estado del proyecto Lavanda (noviembre de 2026)

Resumen para retomar el trabajo en una conversación nueva.
Lavanda: lavandería autoservicio, Avda. Baix Penedès 33, 43700 El Vendrell.
Titular: Carmen María Mondéjar Castejón (autónoma). Socio: Juan José Bardou (Juanjo).

## Qué hay funcionando

| Pieza | Dónde | Notas |
|---|---|---|
| Web | https://lavandavendrell.es (GitHub Pages, repo `bardoujuanjose/lavanda-web`) | Dominio en DonDominio. Enlaces a Facebook, Instagram y WhatsApp en el pie. |
| Chat de la web | `chat.js` + servidor `/chat` | Solo informa; los problemas los manda a WhatsApp. |
| Asistente de WhatsApp | Cloudflare Worker `lavanda-asistente`, ruta `/whatsapp` | Sustituye a Botpress (apagado). App de Meta "Lavanda Asistente" publicada. Claude Opus 5.5. |
| Asistente de voz | Ruta `/voz` (Twilio ConversationRelay) | Claude Sonnet 5.5 sin razonamiento previo, voz ElevenLabs `2BJPFS2QZRUEpfkbclGy` a 0.9. Probado desde el navegador. |
| Chat de pruebas | https://lavanda-asistente.bardoujuanjose.workers.dev/prueba | Con contraseña (`PRUEBA_CLAVE`). Botones Llamar, Twilio y WhatsApp. |
| Normas de los asistentes | `asistente/src/negocio.js` | Basadas en las de Botpress. Casos A, B, C y D de dinero/cambio, Bizum en 48 h previa verificación. |
| Correo | info@lavandavendrell.es | Reenvío gratuito con ImprovMX a juanjobardou@hotmail.com. |
| Facebook | facebook.com/lavandalaundryelvendrell | Web, correo, teléfono y dirección actualizados. |
| Instagram | @lavandavendrell | Cuenta profesional, en la cuenta de Meta de Juanjo. |
| Google Maps | Perfil de Empresa | Juanjo propietario principal, Carmen propietaria. |
| Google Search Console | Propiedad de dominio lavandavendrell.es | Verificada (TXT google-site-verification en DonDominio, no borrar). Sitemap enviado, indexación solicitada. Web con datos estructurados (Laundromat), sitemap.xml y robots.txt. |

Secretos (en Cloudflare, nunca en el repo): ANTHROPIC_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID,
WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, OWNER_PHONE, PRUEBA_CLAVE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.

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
6. **GitHub Pages**: marcar "Enforce HTTPS".
7. **Claude Console**: poner límite de gasto mensual.
