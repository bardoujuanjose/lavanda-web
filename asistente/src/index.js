// =====================================================================
//  Servidor de los asistentes de Lavanda (Cloudflare Worker)
//   /chat      -> chat de la web
//   /whatsapp  -> mensajes de WhatsApp (Meta)
//   /prueba    -> chat de pruebas del asistente de WhatsApp (con contraseña)
// =====================================================================
import { atenderChatWeb } from "./web.js";
import { atenderWhatsApp } from "./webhook.js";
import { atenderPrueba } from "./prueba.js";

export { Conversacion } from "./conversacion.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/chat") return atenderChatWeb(request, env);
    if (pathname === "/whatsapp") return atenderWhatsApp(request, env);
    if (pathname === "/prueba" || pathname.startsWith("/prueba/")) return atenderPrueba(request, env);
    return new Response(JSON.stringify({ ok: true, servicio: "Asistente Lavanda" }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
