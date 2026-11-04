// =====================================================================
//  Servidor del asistente de Lavanda (Cloudflare Worker)
//  Recibe la conversación desde la web, pregunta a Claude y devuelve
//  la respuesta. La clave de Claude vive aquí, en secreto
//  (variable ANTHROPIC_API_KEY), nunca en la web.
// =====================================================================
import Anthropic from "@anthropic-ai/sdk";
import { INSTRUCCIONES } from "./negocio.js";

const MODELO = "claude-opus-5-5";

// Webs que pueden usar el asistente
const ORIGENES_PERMITIDOS = [
  "https://lavandavendrell.es",
  "https://www.lavandavendrell.es",
  "https://bardoujuanjose.github.io",
  // mientras GitHub activa HTTPS en el dominio, la web también puede abrirse con http://
  "http://lavandavendrell.es",
  "http://www.lavandavendrell.es",
];

// Límites para que nadie pueda gastar tu saldo con conversaciones enormes
const MAX_MENSAJES = 20;          // mensajes de historial por petición
const MAX_CARACTERES = 1000;      // por mensaje del cliente
const MAX_PETICIONES_IP = 30;     // por cada visitante...
const VENTANA_MS = 10 * 60 * 1000; // ...cada 10 minutos

const RESPUESTA_ERROR =
  "Perdona, ahora mismo no puedo responder. Escríbenos por WhatsApp y te ayudamos.";

// ---------------------------------------------------------------------
//  Comprobaciones de la conversación que llega de la web
// ---------------------------------------------------------------------
export function validarConversacion(body) {
  if (!body || !Array.isArray(body.messages)) return "Falta la conversación.";
  const msgs = body.messages;
  if (msgs.length === 0 || msgs.length > MAX_MENSAJES) return "Conversación demasiado larga.";
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const rolEsperado = i % 2 === 0 ? "user" : "assistant";
    if (!m || m.role !== rolEsperado || typeof m.content !== "string") return "Formato no válido.";
    if (m.content.trim() === "" || m.content.length > MAX_CARACTERES * (m.role === "user" ? 1 : 3)) {
      return "Mensaje vacío o demasiado largo.";
    }
  }
  if (msgs[msgs.length - 1].role !== "user") return "El último mensaje debe ser del cliente.";
  return null;
}

// Separa la línea [WHATSAPP: ...] que el asistente añade cuando hay que pasar con una persona
export function extraerWhatsapp(texto) {
  const patron = /\n?\s*\[WHATSAPP:\s*([^\]\n]+)\]\s*$/;
  const m = texto.match(patron);
  if (!m) return { reply: texto.trim(), whatsapp: null };
  return { reply: texto.replace(patron, "").trim(), whatsapp: m[1].trim() };
}

function horaActualVendrell() {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

// Límite sencillo por visitante (orientativo: cada servidor de Cloudflare lleva su cuenta)
const visitas = new Map();
function demasiadasPeticiones(ip) {
  const ahora = Date.now();
  const lista = (visitas.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  lista.push(ahora);
  visitas.set(ip, lista);
  if (visitas.size > 5000) visitas.clear();
  return lista.length > MAX_PETICIONES_IP;
}

function cabecerasCors(origen) {
  const permitido = ORIGENES_PERMITIDOS.includes(origen) || /^http:\/\/localhost(:\d+)?$/.test(origen || "");
  return {
    "Access-Control-Allow-Origin": permitido ? origen : ORIGENES_PERMITIDOS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(datos, estado, cors) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

// ---------------------------------------------------------------------
//  Pregunta a Claude
// ---------------------------------------------------------------------
export async function preguntarAClaude(client, messages) {
  const response = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 4000,
    output_config: { effort: "low" },          // respuestas de chat: rápidas y económicas
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                      // si Claude rechaza por seguridad, otro modelo lo intenta
    system: [{ type: "text", text: INSTRUCCIONES, cache_control: { type: "ephemeral" } }],
    messages: [
      ...messages,
      // Nota del sistema con la hora actual (no rompe la caché de las instrucciones)
      { role: "system", content: `Hora actual en El Vendrell: ${horaActualVendrell()}.` },
    ],
  });

  if (response.stop_reason === "refusal") {
    return { reply: "Lo siento, con eso no puedo ayudarte. Si tienes alguna duda sobre la lavandería, pregúntame.", whatsapp: null };
  }
  const texto = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!texto) return { reply: RESPUESTA_ERROR, whatsapp: null };
  return extraerWhatsapp(texto);
}

// ---------------------------------------------------------------------
//  Punto de entrada del Worker
// ---------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const cors = cabecerasCors(request.headers.get("Origin"));
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== "/chat") return json({ ok: true, servicio: "Asistente Lavanda" }, 200, cors);
    if (request.method !== "POST") return json({ error: "Usa POST" }, 405, cors);

    const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
    if (demasiadasPeticiones(ip)) {
      return json({ reply: "Has enviado muchos mensajes seguidos. Espera unos minutos o escríbenos por WhatsApp.", whatsapp: null }, 429, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "JSON no válido" }, 400, cors); }
    const problema = validarConversacion(body);
    if (problema) return json({ error: problema }, 400, cors);

    if (!env.ANTHROPIC_API_KEY) {
      console.error("Falta el secreto ANTHROPIC_API_KEY");
      return json({ reply: RESPUESTA_ERROR, whatsapp: null }, 500, cors);
    }
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });

    try {
      const resultado = await preguntarAClaude(client, body.messages);
      return json(resultado, 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        console.error("Clave de Claude no válida");
      } else if (error instanceof Anthropic.RateLimitError) {
        console.error("Límite de uso de Claude alcanzado");
      } else if (error instanceof Anthropic.BadRequestError) {
        console.error("Petición rechazada por Claude:", error.message);
      } else if (error instanceof Anthropic.APIError) {
        console.error(`Error de Claude ${error.status}:`, error.message);
      } else {
        console.error("Error inesperado:", error);
      }
      return json({ reply: RESPUESTA_ERROR, whatsapp: null }, 502, cors);
    }
  },
};
