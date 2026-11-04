// =====================================================================
//  Entrada de WhatsApp: Meta avisa aquí de cada mensaje nuevo
// =====================================================================
import { firmaValida, extraerMensajes, normalizarTelefono, clienteWhatsApp } from "./whatsapp.js";
import { leerComandoDueno, textoAyudaDueno } from "./asistente-whatsapp.js";

export async function atenderWhatsApp(request, env) {
  const url = new URL(request.url);

  // 1) Meta comprueba la dirección al configurarla (una sola vez)
  if (request.method === "GET") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      env.WHATSAPP_VERIFY_TOKEN &&
      url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
    return ok
      ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 })
      : new Response("No autorizado", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Método no permitido", { status: 405 });

  // 2) Comprobar que el aviso viene de verdad de Meta
  const cuerpo = await request.arrayBuffer();
  if (!(await firmaValida(env.WHATSAPP_APP_SECRET, cuerpo, request.headers.get("X-Hub-Signature-256")))) {
    console.error("WhatsApp: firma no válida (revisa WHATSAPP_APP_SECRET)");
    return new Response("Firma no válida", { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(cuerpo)); } catch { return new Response("JSON no válido", { status: 400 }); }

  // 3) Repartir cada mensaje a la memoria de su cliente
  const dueno = normalizarTelefono(env.OWNER_PHONE);
  for (const m of extraerMensajes(payload)) {
    try {
      if (dueno && m.de === dueno) {
        const comando = leerComandoDueno(m.texto);
        if (comando) {
          await conversacion(env, comando.telefono).dueno(comando.telefono, comando.texto);
          continue;
        }
        if (/^\s*(ayuda|help|\?)\s*$/i.test(m.texto)) {
          await clienteWhatsApp(env).enviarTexto(dueno, textoAyudaDueno());
          continue;
        }
        // Cualquier otro mensaje del dueño se trata como el de un cliente (sirve para probar)
      }
      await conversacion(env, m.de).recibir(m);
    } catch (e) {
      console.error("WhatsApp: no se pudo procesar un mensaje:", e?.message || e);
    }
  }

  // Meta necesita una respuesta rápida; la contestación al cliente se envía después
  return new Response("ok", { status: 200 });
}

function conversacion(env, telefono) {
  return env.CONVERSACIONES.get(env.CONVERSACIONES.idFromName(telefono));
}
