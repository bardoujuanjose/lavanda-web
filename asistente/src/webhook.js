// =====================================================================
//  Entrada de WhatsApp: Meta avisa aquí de cada mensaje nuevo
// =====================================================================
import { firmaValida, extraerMensajes, extraerEcos, normalizarTelefono, clienteWhatsApp } from "./whatsapp.js";
import { leerComandoDueno, textoAyudaDueno } from "./asistente-whatsapp.js";
import { buscarClientePorWhatsApp, entornoDe, nombreMemoria } from "./clientes/index.js";

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

  // 3) Repartir cada mensaje a la memoria de su cliente, según el número de WhatsApp al que han escrito
  //    (cada lavandería tiene el suyo, con su token y su dueño)
  for (const m of extraerMensajes(payload)) {
    try {
      const cliente = buscarClientePorWhatsApp(env, m.numeroId);
      if (!cliente) {
        console.error(`WhatsApp: mensaje para el número ${m.numeroId || "(sin identificar)"}, que no es de ninguna lavandería: se ignora`);
        continue;
      }
      const envC = entornoDe(env, cliente);
      const dueno = normalizarTelefono(envC.OWNER_PHONE);
      if (dueno && m.de === dueno) {
        const comando = leerComandoDueno(m.texto);
        if (comando) {
          await conversacion(env, cliente, comando.telefono).dueno(comando.telefono, comando.texto, cliente.ficha.id);
          continue;
        }
        if (/^\s*(ayuda|help|\?)\s*$/i.test(m.texto)) {
          await clienteWhatsApp(envC).enviarTexto(dueno, textoAyudaDueno(cliente));
          continue;
        }
        // Cualquier otro mensaje del dueño se trata como el de un cliente (sirve para probar)
      }
      await conversacion(env, cliente, m.de).recibir(m, cliente.ficha.id);
    } catch (e) {
      console.error("WhatsApp: no se pudo procesar un mensaje:", e?.message || e);
    }
  }

  // 4) El dueño ha contestado desde la app WhatsApp Business ("coexistencia"): el asistente se calla con ese cliente
  for (const e of extraerEcos(payload)) {
    try {
      const cliente = buscarClientePorWhatsApp(env, e.numeroId);
      if (!cliente || !e.para) continue;
      await conversacion(env, cliente, e.para).eco(e.texto, cliente.ficha.id);
    } catch (err) {
      console.error("WhatsApp: no se pudo procesar un mensaje del dueño desde la app:", err?.message || err);
    }
  }

  // Meta necesita una respuesta rápida; la contestación al cliente se envía después
  return new Response("ok", { status: 200 });
}

// La memoria es de cada cliente DE CADA lavandería: la misma persona escribiendo a dos lavanderías
// tiene dos conversaciones separadas (nombreMemoria pone delante el prefijo de la lavandería).
function conversacion(env, cliente, telefono) {
  return env.CONVERSACIONES.get(env.CONVERSACIONES.idFromName(nombreMemoria(cliente, telefono)));
}
