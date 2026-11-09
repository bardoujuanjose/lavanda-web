// =====================================================================
//  Servidor de los asistentes de Lavanda (Cloudflare Worker)
//   /chat      -> chat de la web
//   /whatsapp  -> mensajes de WhatsApp (Meta)
//   /voz       -> llamadas de teléfono (Twilio)
//   /prueba    -> chat de pruebas del asistente de WhatsApp (con contraseña)
//   /admin     -> panel para dar de alta y editar lavanderías (con contraseña)
//   /admin/conversaciones -> conversaciones de WhatsApp, solo lectura (misma contraseña)
//   /alta/…    -> página para que el dueño conecte su WhatsApp (enlace firmado que genera el panel)
// =====================================================================
import { atenderChatWeb } from "./web.js";
import { atenderWhatsApp } from "./webhook.js";
import { atenderPrueba } from "./prueba.js";
import { atenderVoz } from "./voz.js";
import { atenderAdmin } from "./admin.js";
import { atenderAlta } from "./alta.js";
import { prepararRegistro } from "./clientes/index.js";

export { Conversacion } from "./conversacion.js";
export { Registro } from "./registro.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Lavanderías dadas de alta en el panel (con caché; si falla, se sigue con las que había)
    await prepararRegistro(env);
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return atenderAdmin(request, env);
    if (pathname.startsWith("/alta/")) return atenderAlta(request, env);
    if (pathname === "/chat") return atenderChatWeb(request, env);
    if (pathname === "/whatsapp") return atenderWhatsApp(request, env);
    if (pathname === "/voz" || pathname.startsWith("/voz/")) return atenderVoz(request, env, ctx);
    if (pathname === "/prueba" || pathname.startsWith("/prueba/")) return atenderPrueba(request, env);
    return new Response(JSON.stringify({ ok: true, servicio: "Asistente Lavanda" }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
