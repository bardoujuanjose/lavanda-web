// =====================================================================
//  Servidor de los asistentes de Lavanda (Cloudflare Worker)
//   /chat      -> chat de la web
//   /whatsapp  -> mensajes de WhatsApp (Meta)
// =====================================================================
import { atenderChatWeb } from "./web.js";
import { atenderWhatsApp } from "./webhook.js";

export { Conversacion } from "./conversacion.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/chat") return atenderChatWeb(request, env);
    if (pathname === "/whatsapp") return atenderWhatsApp(request, env);
    return new Response(JSON.stringify({ ok: true, servicio: "Asistente Lavanda" }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
