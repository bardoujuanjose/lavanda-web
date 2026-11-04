// =====================================================================
//  Asistente de voz (llamadas de teléfono con Twilio ConversationRelay)
//
//   POST /voz             Twilio avisa de una llamada -> conecta con el asistente
//   GET  /voz/ws          conversación en tiempo real (WebSocket)
//   POST /voz/fin         termina el asistente -> pasar la llamada o colgar
//   POST /voz/tras-dial   si nadie contesta al pasar la llamada
//
//  Secretos: TWILIO_AUTH_TOKEN (firma de Twilio), ANTHROPIC_API_KEY,
//            OWNER_PHONE (móvil al que se pasan las llamadas)
// =====================================================================
import Anthropic from "@anthropic-ai/sdk";
import {
  INSTRUCCIONES_VOZ, SALUDO_VOZ, HERRAMIENTA_AVISO, HERRAMIENTA_PASAR_LLAMADA,
} from "./negocio.js";
import { normalizarTelefono, clienteWhatsApp } from "./whatsapp.js";
import { avisarDueno, claveAviso, MODELO } from "./asistente-whatsapp.js";

const MAX_TURNOS = 40;
const MAX_VUELTAS = 3;
const NO_CONTESTA =
  "Ahora mismo no podemos atenderte. Escríbenos por WhatsApp a este mismo número, el 689 810 213, y te ayudamos. Gracias por llamar a Lavanda.";

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
const enc = new TextEncoder();

async function hmac(algo, clave, texto) {
  const k = await crypto.subtle.importKey("raw", enc.encode(clave), { name: "HMAC", hash: algo }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(texto)));
}
const aBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const aHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function igual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Firma de Twilio: HMAC-SHA1 de la URL + parámetros ordenados, en base64
export async function firmaTwilioValida(authToken, url, params, firma) {
  if (!authToken || !firma) return false;
  const base = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return igual(aBase64(await hmac("SHA-1", authToken, base)), firma);
}

// Pase para el WebSocket (solo lo puede generar quien tiene el token de Twilio)
export async function paseLlamada(env, callSid) {
  return aHex(await hmac("SHA-256", env.TWILIO_AUTH_TOKEN, "voz:" + callSid)).slice(0, 32);
}

const xml = (t) => String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const twiml = (cuerpo) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${cuerpo}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
const decir = (t, env) => `<Say language="es-ES" voice="${xml(env.VOZ_SAY || "Polly.Lucia-Neural")}">${xml(t)}</Say>`;

// URL pública tal como la ve Twilio (para comprobar la firma)
function urlPublica(request) {
  const u = new URL(request.url);
  u.protocol = "https:";
  return u.toString();
}

async function leerFormulario(request) {
  const texto = await request.text();
  return Object.fromEntries(new URLSearchParams(texto));
}

async function comprobarFirma(request, env) {
  const params = await leerFormulario(request);
  const ok = await firmaTwilioValida(env.TWILIO_AUTH_TOKEN, urlPublica(request), params, request.headers.get("X-Twilio-Signature"));
  if (!ok) console.error("Voz: firma de Twilio no válida (revisa TWILIO_AUTH_TOKEN)");
  return ok ? params : null;
}

// ---------------------------------------------------------------------
//  Rutas HTTP
// ---------------------------------------------------------------------
export async function atenderVoz(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/voz/ws") return abrirConversacion(request, env, ctx);
  if (request.method !== "POST") return new Response("Método no permitido", { status: 405 });

  const p = await comprobarFirma(request, env);
  if (!p) return new Response("Firma no válida", { status: 403 });

  // 1) Llega una llamada: conectar con el asistente
  if (url.pathname === "/voz") {
    const pase = await paseLlamada(env, p.CallSid);
    const ws = new URL("/voz/ws", url);
    ws.protocol = "wss:";
    ws.search = new URLSearchParams({ c: p.CallSid, t: pase }).toString();
    const fin = new URL("/voz/fin", url);
    fin.protocol = "https:";
    const atributos = {
      url: ws.toString(),
      language: env.VOZ_IDIOMA || "es-ES",
      welcomeGreeting: SALUDO_VOZ,
      ttsProvider: env.VOZ_TTS_PROVIDER || "Amazon",
      voice: env.VOZ_VOZ || "Lucia-Neural",
    };
    if (env.VOZ_STT_PROVIDER) atributos.transcriptionProvider = env.VOZ_STT_PROVIDER;
    const attr = Object.entries(atributos).map(([k, v]) => `${k}="${xml(v)}"`).join(" ");
    return twiml(`<Connect action="${xml(fin.toString())}"><ConversationRelay ${attr}/></Connect>`);
  }

  // 2) Termina el asistente: pasar la llamada o colgar
  if (url.pathname === "/voz/fin") {
    let datos = {};
    try { datos = JSON.parse(p.HandoffData || "{}"); } catch { /* sin datos */ }
    const dueno = normalizarTelefono(env.OWNER_PHONE);
    const idCallerId = /^\+\d{6,}$/.test(p.From || "") ? p.From : /^\+\d{6,}$/.test(p.To || "") ? p.To : "";
    if (datos.accion === "pasar" && dueno && !idCallerId) {
      // Llamada de prueba desde el navegador: no hay número desde el que pasarla
      return twiml(decir("Aquí te pasaría con un compañero. En una llamada real, sonaría en tu móvil. Fin de la prueba.", env) + "<Hangup/>");
    }
    if (datos.accion === "pasar" && dueno) {
      const tras = new URL("/voz/tras-dial", url);
      tras.protocol = "https:";
      tras.search = new URLSearchParams({ r: String(datos.resumen || "").slice(0, 300) }).toString();
      return twiml(
        decir("Te paso con un compañero, un momento por favor.", env) +
        `<Dial timeout="25" callerId="${xml(idCallerId)}" action="${xml(tras.toString())}"><Number>+${xml(dueno)}</Number></Dial>`,
      );
    }
    if (p.ErrorCode || p.SessionStatus === "failed") {
      console.error("Voz: la sesión de ConversationRelay falló:", p.ErrorCode, p.ErrorMessage);
      return twiml(decir(NO_CONTESTA, env) + "<Hangup/>");
    }
    return twiml("<Hangup/>");
  }

  // 3) Nadie ha cogido la llamada pasada
  if (url.pathname === "/voz/tras-dial") {
    if (p.DialCallStatus === "completed") return twiml("<Hangup/>");
    const resumen = url.searchParams.get("r") || "";
    ctx?.waitUntil?.(
      avisarDueno({
        env, wa: clienteWhatsApp(env), telefono: normalizarTelefono(p.From), nombre: "",
        motivo: "llamada_perdida", resumen: resumen || "Llamada que el asistente intentó pasarte.", maquina: "", importe: "", telefonoCliente: p.From,
      }).catch((e) => console.error("Voz: no se pudo avisar de la llamada perdida:", e.message)),
    );
    return twiml(decir(NO_CONTESTA, env) + "<Hangup/>");
  }

  return new Response("No encontrado", { status: 404 });
}

// ---------------------------------------------------------------------
//  Conversación en tiempo real (WebSocket de ConversationRelay)
// ---------------------------------------------------------------------
async function abrirConversacion(request, env, ctx) {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Se esperaba WebSocket", { status: 426 });
  const url = new URL(request.url);
  const callSid = url.searchParams.get("c") || "";
  if (!igual(url.searchParams.get("t") || "", await paseLlamada(env, callSid))) {
    console.error("Voz: intento de conexión sin pase válido");
    return new Response("No autorizado", { status: 403 });
  }
  const par = new WebSocketPair();
  const [cliente, servidor] = Object.values(par);
  servidor.accept();
  const claude = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 1,
    timeout: 30_000,
  });
  const sesion = crearSesion({
    env, claude, wa: clienteWhatsApp(env),
    enviar: (obj) => { try { servidor.send(JSON.stringify(obj)); } catch { /* llamada colgada */ } },
  });
  servidor.addEventListener("message", (ev) => {
    const tarea = sesion.recibir(String(ev.data)).catch((e) => console.error("Voz: error:", e?.message || e));
    ctx?.waitUntil?.(tarea);
  });
  servidor.addEventListener("close", () => sesion.cerrar());
  return new Response(null, { status: 101, webSocket: cliente });
}

// Lógica de la conversación (independiente del WebSocket para poder probarla)
export function crearSesion({ env, claude, wa, enviar, ahora = () => Date.now() }) {
  const historial = [];
  const avisos = [];
  let llamante = "";
  let actual = null;   // respuesta en curso (para cortarla si el cliente interrumpe)
  let terminada = false;

  function sistema() {
    const ult3 = llamante.slice(-3).split("").join(" ");
    return (
      `Hora actual en El Vendrell: ${new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(ahora()))}.` +
      (llamante ? ` El cliente llama desde el +${llamante} (acaba en ${ult3}).` : " No se conoce el número del cliente.") +
      (avisos.length ? ` Avisos ya enviados en esta llamada (no los repitas): ${avisos.map((a) => a.motivo).join(", ")}.` : "")
    );
  }

  async function responder() {
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const control = { cortada: false, stream: null, dicho: "" };
      actual = control;
      const stream = claude.beta.messages.stream({
        model: MODELO,
        max_tokens: 1500,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: INSTRUCCIONES_VOZ, cache_control: { type: "ephemeral" } }],
        tools: [HERRAMIENTA_AVISO, HERRAMIENTA_PASAR_LLAMADA],
        messages: [...historial, { role: "system", content: sistema() }],
      });
      control.stream = stream;
      stream.on("text", (t) => {
        if (control.cortada || !t) return;
        control.dicho += t;
        enviar({ type: "text", token: t, last: false });
      });
      let msg;
      try {
        msg = await stream.finalMessage();
      } catch (e) {
        if (control.cortada) return;
        throw e;
      }
      if (control.cortada) return;
      actual = null;
      enviar({ type: "text", token: "", last: true });
      if (control.dicho) console.log(`Voz [asistente]: ${control.dicho}`);

      if (msg.stop_reason === "refusal") {
        historial.push({ role: "assistant", content: "Perdona, con eso no puedo ayudarte." });
        enviar({ type: "text", token: "Perdona, con eso no puedo ayudarte.", last: true });
        return;
      }
      historial.push({ role: "assistant", content: msg.content });
      const usos = msg.content.filter((b) => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || !usos.length) return;

      const resultados = [];
      for (const uso of usos) {
        const datos = typeof uso.input === "string" ? JSON.parse(uso.input) : uso.input;
        console.log(`Voz [herramienta ${uso.name}]: ${JSON.stringify(datos)}`);
        if (uso.name === HERRAMIENTA_PASAR_LLAMADA.name) {
          terminada = true;
          enviar({ type: "end", handoffData: JSON.stringify({ accion: "pasar", resumen: String(datos.resumen || "").slice(0, 300) }) });
          return;
        }
        let contenido = "Aviso enviado al equipo. Continúa la conversación según tus normas.";
        if (uso.name === HERRAMIENTA_AVISO.name) {
          const clave = claveAviso(datos);
          if (avisos.some((a) => a.clave === clave)) {
            contenido = "Este aviso ya se había enviado: NO se ha repetido. Continúa con normalidad.";
          } else {
            try {
              await avisarDueno({
                env, wa, telefono: llamante, nombre: "📞 Llamada",
                motivo: datos.motivo, resumen: datos.resumen, maquina: datos.maquina, importe: datos.importe, telefonoCliente: datos.telefono,
              });
              avisos.push({ clave, motivo: datos.motivo });
            } catch (e) {
              console.error("Voz: AVISO NO ENTREGADO al dueño:", JSON.stringify(datos), "·", e.message);
              contenido = "Aviso registrado. Continúa la conversación con normalidad y cierra el caso como indican tus normas; no pases la llamada por esto.";
            }
          }
        } else {
          contenido = "Herramienta desconocida.";
        }
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: contenido });
      }
      historial.push({ role: "user", content: resultados });
    }
  }

  return {
    historial,
    async recibir(texto) {
      if (terminada) return;
      let m;
      try { m = JSON.parse(texto); } catch { return; }

      if (m.type === "setup") {
        llamante = normalizarTelefono(m.from || "");
        return;
      }
      if (m.type === "interrupt") {
        // El cliente ha hablado encima: dejar en la memoria solo lo que llegó a oír
        if (actual && !actual.cortada) {
          actual.cortada = true;
          actual.stream?.abort?.();
          if (actual.dicho) historial.push({ role: "assistant", content: (m.utteranceUntilInterrupt || actual.dicho) + " [interrumpido]" });
        }
        return;
      }
      if (m.type === "error") {
        console.error("Voz: ConversationRelay informa de un error:", m.description);
        return;
      }
      if (m.type !== "prompt" || !m.voicePrompt || m.last === false) return;
      console.log(`Voz [cliente]: ${m.voicePrompt}`);

      if (actual && !actual.cortada) { actual.cortada = true; actual.stream?.abort?.(); }
      // La conversación debe alternar cliente/asistente: juntar si hay dos del cliente seguidos
      const ultimo = historial[historial.length - 1];
      if (ultimo && ultimo.role === "user" && typeof ultimo.content === "string") ultimo.content += " " + m.voicePrompt;
      else historial.push({ role: "user", content: m.voicePrompt });

      if (historial.filter((h) => h.role === "user").length > MAX_TURNOS) {
        terminada = true;
        enviar({ type: "text", token: "Lo siento, tengo que colgar. Escríbenos por WhatsApp si necesitas algo más. ¡Hasta pronto!", last: true });
        enviar({ type: "end", handoffData: JSON.stringify({ accion: "colgar" }) });
        return;
      }
      try {
        await responder();
      } catch (e) {
        if (e instanceof Anthropic.APIError) console.error(`Voz: error de Claude ${e.status}:`, e.message);
        else console.error("Voz: error inesperado:", e?.message || e);
        terminada = true;
        enviar({ type: "end", handoffData: JSON.stringify({ accion: "pasar", resumen: "El asistente de voz ha tenido un error técnico." }) });
      }
    },
    cerrar() {
      terminada = true;
      if (actual) { actual.cortada = true; actual.stream?.abort?.(); }
    },
  };
}
