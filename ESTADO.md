# Estado del proyecto Lavanda (noviembre de 2026)

Resumen para retomar el trabajo en una conversación nueva.
Lavanda: lavandería autoservicio, Avda. Baix Penedès 33, 43700 El Vendrell.
Titular: Carmen María Mondéjar Castejón (autónoma). Socio: Juan José Bardou (Juanjo).

**Cómo se publica el Worker:** Cloudflare Workers Builds conectado a GitHub (bardoujuanjose/lavanda-web), rama de producción main, directorio raíz asistente, comando npx wrangler deploy. Fusionar en main publica. Las compilaciones de ramas de vista previa están desactivadas en Cloudflare (Ajustes → Construcciones → Vistas previas, 06/11/2026), porque fallaban al faltar el bloque [previews] en wrangler.toml; no afecta a producción.

## Qué hay funcionando

| Pieza | Dónde | Notas |
|---|---|---|
| Web | https://lavandavendrell.es (GitHub Pages, repo `bardoujuanjose/lavanda-web`) | Dominio en DonDominio. Enlaces a Facebook, Instagram y WhatsApp en el pie. |
| Chat de la web | `chat.js` + servidor `/chat` | Solo informa; los problemas los manda a WhatsApp. |
| Asistente de WhatsApp | Cloudflare Worker `lavanda-asistente`, ruta `/whatsapp` | Sustituye a Botpress (apagado). App de Meta "Lavanda Asistente" publicada. Claude Opus 5.5. |
| Asistente de voz | Ruta `/voz` (Twilio ConversationRelay) | Claude Sonnet 5.5 sin razonamiento previo, voz ElevenLabs `2BJPFS2QZRUEpfkbclGy` a 0.9. Probado desde el navegador. |
| Conversaciones de WhatsApp | https://lavanda-asistente.bardoujuanjose.workers.dev/admin/conversaciones | Solo lectura, contraseña `ADMIN_CLAVE`. Se guardan con fecha y hora desde que se publicó (las anteriores, solo los últimos 30 mensajes sin fecha, abriéndolas por teléfono). Máximo 400 mensajes y 1 año por cliente. Las llamadas aún no salen. |
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

Lista única, ordenada el 09/11/2026 (incluye lo que había en un resumen de otro chat de Claude normal).
**Fuente de verdad de los datos de Lavanda:** `asistente/src/clientes/lavanda.js`. Ese resumen tenía datos antiguos
(M 10 kg, L 14 kg, "solo detergente y suavizante", tarjeta "solo si preguntan"); los correctos son M 14 kg, L 16 kg,
detergente + suavizante + desinfectante, y la tarjeta se recomienda cuando viene a cuento.

### A) Lavanda

1. **Voz y Twilio** (en curso)
   - **Decisión (09/11/2026): Lavanda usa el asistente de voz propio (`/voz`), no Retell.** Mismas normas que WhatsApp, voz de Sofía
     (ElevenLabs), pasa la llamada al móvil del dueño en los casos difíciles y avisa por WhatsApp.
   - Paquete regulatorio de Twilio ("Lavanda", España, Individual, Local): **aprobado**. **El número 977 ya está pedido** (5,50 $/mes,
     entrega estimada de 1 a 24 h); a 09/11/2026 aún no aparece en Active numbers. **No comprar otro.**
   - **Siguiente paso:** cuando aparezca en Active numbers: Voice → A call comes in → Webhook
     `https://lavanda-asistente.bardoujuanjose.workers.dev/voz` (POST) y probar llamando desde un móvil.
   - El trunk SIP `retell-limpoi` (creado para Retell) no se usa; dejarlo sin tocar. Puede ser de Limpoi.
   - **Desvío en Movistar, por decidir:** `**61*NUMERO**20#` (solo si no contestas en 20 s) o `**21*NUMERO#` (todas las llamadas al
     asistente; el dueño ya no recibe ninguna directamente). Se cancela con `##002#` / `##61#`. El 689 810 213 no se porta.
   - **Decidir:** portar el 977 de la tienda que no se usa o quedarse con el nuevo de Twilio.
   - Mejoras acordadas, por orden: (1) normas en un archivo de texto sin código, (2) página privada con las transcripciones de llamadas
     y WhatsApp (WhatsApp hecho en `/admin/conversaciones`; faltan las llamadas), (3) grabación de audio solo si se quiere (requiere avisar al cliente y actualizar la política de privacidad).
2. **Los dos arreglos del asistente de WhatsApp** que Juanjo quería enseñar: **por contar** (aún no los ha dicho).
3. **Datos que faltan para los asistentes:** pasos del programa 100 (centrifugado extra), protocolo del corte de luz y si el
   aparcamiento es zona azul (hoy el asistente no dice nada de esto).
4. **Aviso de protección de datos** cuando el asistente pide nombre o teléfono (y en la política de privacidad si se graban llamadas).
5. **Cartel A4 con QR de WhatsApp** (ya verificado): imprimir y colocar en el local.
6. **Documentos:** subir a Drive las versiones nuevas (instrucciones del chat v16, de voz v3, pruebas de límite v15) y actualizar el
   documento de Instagram, que aún dice "Lavanda" y "Resuelto en un minuto" (revisar con Juanjo qué debe decir).
7. **Botpress:** dar de baja la suscripción, si hay plan de pago, unos días después de ver estable el asistente nuevo (ya está apagado).
8. **Google Maps:** corregir horario (pone cierre 22:00; es 8:00–21:00), añadir descripción, redes y fotos.
9. **DonDominio:** renovación del dominio en automática (caduca el 04/11/2027).
10. **Meta:** plantilla `aviso_lavanda` (Utilidad, español, cuerpo `Nuevo aviso de Lavanda: {{1}}`) y método de pago.
11. **Claude Console:** límite de gasto mensual.
12. **Facebook: recuperar el control total de la página** (en pausa; no es urgente).
    - El único admin con control total ("Lavanda Aguas") ya no existe; Carmen tiene acceso parcial.
    - Meta pide una "Disputa de administrador de página" (https://www.facebook.com/business-support-home/contact-support) con el PDF de
      documentación (carta firmada por Carmen, su DNI, recibo de autónomos y anexo). Requisito: autenticación en dos pasos y sin
      restricciones en el perfil de quien será admin; a Carmen no le deja activarla. Plan B: pedir el control para Juanjo.

### B) Producto para otras lavanderías (Limpoi)

Limpoi es el nombre del producto. Detalles en la sección siguiente.
- Montar el **asistente comercial** (instrucciones v1: preguntas previas, demo y aviso con los datos del contacto) en nuestro servidor
  (no en Botpress) y una SIM aparte para su WhatsApp.
- Comprobar que **Limpoi** está libre en Instagram, Google, OEPM y dominio.
- Lanzar **anuncios** con poco presupuesto (5-10 € al día durante 7 días) y comparar mensajes. Hay imagen 4:5, tres vídeos y una landing
  publicada sin precio (el precio se dice después, en conversación).
- **Verificación de negocio en Meta** y decidir qué entidad la hace (ver la sección siguiente).
- Revisar si se puede **revender** el servicio y el aviso de protección de datos para otras lavanderías.

### C) Hecho o descartado

- ✅ Probar la voz con una llamada desde el navegador.
- ✅ Enforce HTTPS en GitHub Pages.
- ❌ Retell para Lavanda (descartado el 09/11/2026).

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

### Prueba con una segunda lavandería (06/11/2026)

- Cuestionario para dueños (Google Forms): https://docs.google.com/forms/d/e/1FAIpQLScWJszEtRNeia4OX8KgcJuJQYhVO51jM5I4RqjfQIK_jbMsFQ/viewform . Proceso: el dueño lo rellena, Claude redacta las secciones y normas de la ficha a partir de sus respuestas, Juanjo las pega en /admin, revisa la Vista previa y prueba antes de Activar. Los datos y hechos del negocio los pone el dueño; la parte "de inteligencia" (secciones y normas) la redactamos nosotros. Las decisiones del dueño (devoluciones, límites, cuándo llamar) se le preguntan, no se suponen.
- Ficha de prueba "Lavandería Prueba" (id prueba-tarragona, ficticia) guardada como borrador en /admin, con otro horario, otros precios y otro pago (solo monedas, sin cajero). La vista previa sale sin datos de Lavanda. Fallos del panel anotados para mejorar: (1) no avisa si una sección es idéntica a la de Lavanda y las secciones nuevas vienen copiadas de Lavanda (mejor vacías); (2) el campo normas.voz es obligatorio aunque no haya voz; (3) si la ventana de Vista previa ya está abierta, el botón no la actualiza; (4) el campo "Con qué se paga" está pensado para un cajero; (5) el panel no comparte la sesión entre pestañas.
- Número de prueba gratuito de Meta (app, Paso 1. Probar): +1 555 193 2140, phone_number_id 1389173520950151, cuenta de mensajes de prueba 2593317907817485, con el móvil de Juanjo como destinatario verificado. Conexión manual hecha en el panel con un token temporal (caduca en unas 24 h; se genera en Meta y se pega en el panel, nunca en el chat ni en el repo).
- BLOQUEO: los envíos desde la cuenta de prueba fallan con el error 131031 "Business Account locked" (3 intentos el 06/11/2026), aunque el Centro de ayuda dice "No account issues". El asistente automático de soporte de Meta dice que la cuenta está en Tier 0 y que hace falta iniciar la Verificación de negocio (empresa "Lavanda Laundry El Vendrell", portfolio 1118108350582417, no verificada); no está confirmado por una persona. La cuenta de WhatsApp de Lavanda real (+34 689 81 02 13, de tipo "Aplicación de WhatsApp Business") no admite un segundo número (el botón "Añadir número de teléfono" sale desactivado) y sigue funcionando bien.
- DECISIÓN PENDIENTE: qué entidad verifica en Meta. Hoy solo existe Lavanda (Carmen María Mondéjar Castejón, autónoma): necesita su visto bueno y sus documentos, y los datos deben coincidir letra por letra con el documento (como pasó con Twilio); no usar las direcciones que autocompleta Chrome. Para vender el producto haría falta una entidad propia de Juanjo (alta de autónomo o sociedad; consultar con un gestor) y probablemente otro portfolio de Meta.
- Pendiente: verificación de negocio en Meta, reintentar el envío de la cuenta de prueba, activar "Lavandería Prueba" y probar con el móvil que cada número contesta con su ficha.

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
