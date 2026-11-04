// =====================================================================
//  Conexión con la API oficial de WhatsApp Business (Meta)
// =====================================================================

export const ERROR_FUERA_DE_24H = 131047; // Meta no deja escribir si pasaron más de 24 h desde el último mensaje

function baseGraph(env) {
  return `${env.GRAPH_BASE || "https://graph.facebook.com"}/${env.GRAPH_VERSION || "v23.0"}`;
}

// Teléfono solo con cifras y con prefijo de España si se escribió sin él
export function normalizarTelefono(t) {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length === 9) return "34" + d;
  return d;
}

// ---------------------------------------------------------------------
//  Seguridad: comprueba que el aviso viene de verdad de Meta
// ---------------------------------------------------------------------
export async function firmaValida(secreto, cuerpo, cabecera) {
  if (!secreto || !cabecera || !cabecera.startsWith("sha256=")) return false;
  const clave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, cuerpo));
  const esperada = Array.from(firma, (b) => b.toString(16).padStart(2, "0")).join("");
  const recibida = cabecera.slice(7).toLowerCase();
  if (esperada.length !== recibida.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperada.length; i++) diferencia |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i);
  return diferencia === 0;
}

// ---------------------------------------------------------------------
//  Convierte el aviso de Meta en una lista sencilla de mensajes
// ---------------------------------------------------------------------
export function extraerMensajes(payload) {
  const lista = [];
  for (const entrada of payload?.entry || []) {
    for (const cambio of entrada.changes || []) {
      if (cambio.field !== "messages") continue;
      const v = cambio.value || {};
      const nombres = {};
      for (const c of v.contacts || []) nombres[c.wa_id] = c.profile?.name || "";
      for (const m of v.messages || []) {
        lista.push({
          id: m.id,
          de: m.from,
          nombre: nombres[m.from] || "",
          tipo: m.type,
          texto:
            m.text?.body ??
            m.image?.caption ??
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            "",
          mediaId: m.image?.id || m.audio?.id || null,
        });
      }
    }
  }
  return lista;
}

// ---------------------------------------------------------------------
//  Cliente de la API de WhatsApp
// ---------------------------------------------------------------------
export function clienteWhatsApp(env, fetchImpl = fetch) {
  const base = baseGraph(env);
  const auth = { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
  const urlMensajes = `${base}/${env.WHATSAPP_PHONE_ID}/messages`;

  async function llamar(url, opciones) {
    const r = await fetchImpl(url, opciones);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(datos?.error?.message || `WhatsApp respondió ${r.status}`);
      e.code = datos?.error?.code;
      e.status = r.status;
      throw e;
    }
    return datos;
  }
  const enviar = (cuerpo) =>
    llamar(urlMensajes, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...cuerpo }),
    });

  return {
    enviarTexto: (para, texto) =>
      enviar({ to: para, type: "text", text: { preview_url: false, body: String(texto).slice(0, 4096) } }),

    enviarPlantilla: (para, nombre, idioma, parametros) =>
      enviar({
        to: para,
        type: "template",
        template: {
          name: nombre,
          language: { code: idioma },
          components: [{ type: "body", parameters: parametros.map((t) => ({ type: "text", text: t })) }],
        },
      }),

    enviarAudio: (para, mediaId) => enviar({ to: para, type: "audio", audio: { id: mediaId } }),

    enviarImagen: (para, mediaId, pie) =>
      enviar({ to: para, type: "image", image: { id: mediaId, caption: String(pie || "").slice(0, 1024) } }),

    // Marca como leído y muestra "escribiendo…" al cliente
    marcarLeido: (mensajeId) =>
      llamar(urlMensajes, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", status: "read", message_id: mensajeId, typing_indicator: { type: "text" },
        }),
      }),

    async descargarMedia(mediaId) {
      const info = await llamar(`${base}/${mediaId}`, { headers: auth });
      const r = await fetchImpl(info.url, { headers: auth });
      if (!r.ok) throw new Error(`No se pudo descargar la foto (${r.status})`);
      return { bytes: await r.arrayBuffer(), tipo: info.mime_type || r.headers.get("Content-Type") || "image/jpeg" };
    },

    async subirMedia(bytes, tipo) {
      const formulario = new FormData();
      formulario.append("messaging_product", "whatsapp");
      formulario.append("type", tipo);
      formulario.append("file", new Blob([bytes], { type: tipo }), tipo.startsWith("audio") ? "audio.ogg" : "foto.jpg");
      const datos = await llamar(`${base}/${env.WHATSAPP_PHONE_ID}/media`, { method: "POST", headers: auth, body: formulario });
      return datos.id;
    },
  };
}
