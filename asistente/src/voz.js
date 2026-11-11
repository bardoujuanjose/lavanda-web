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
import { obtenerCliente, buscarClientePorVoz, entornoDe } from "./clientes/index.js";
import { normalizarTelefono, clienteWhatsApp } from "./whatsapp.js";
import { avisarDueno, claveAviso } from "./asistente-whatsapp.js";

// Modelo para las llamadas: rápido y sin razonamiento previo (se puede cambiar con VOZ_MODELO)
const MODELO_VOZ = "claude-sonnet-5-5";

const MAX_TURNOS = 40;

// Voces que se pueden probar desde el chat de pruebas ("proveedor|voz"; voz vacía = la del proveedor por defecto)
export const VOCES_PRUEBA = [
  "Amazon|Lucia-Neural",
  "Amazon|Lucia-Generative",
  "Google|es-ES-Chirp3-HD-Aoede",
  "Google|es-ES-Chirp3-HD-Kore",
  "Google|es-ES-Chirp3-HD-Leda",
  "Google|es-ES-Chirp3-HD-Zephyr",
  "ElevenLabs|",
];
const MAX_VUELTAS = 3;
// La frase de "no podemos atenderte" depende de la lavandería: está en sus textos (NO_CONTESTA_VOZ)

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
// (la lavandería va dentro del pase: nadie puede cambiarla en la dirección de la llamada)
export async function paseLlamada(env, callSid, numeroPrueba = "", clienteId = "") {
  return aHex(await hmac("SHA-256", env.TWILIO_AUTH_TOKEN, "voz:" + callSid + ":" + numeroPrueba + (clienteId ? ":" + clienteId : ""))).slice(0, 32);
}

const xml = (t) => String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const twiml = (cuerpo) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${cuerpo}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
// Frases grabadas con la voz del asistente (archivos en publico/audio/). Si no hay grabación, se lee con <Say>.
const GRABACIONES = { pasar: "/audio/pasar.mp3", noContesta: "/audio/no-contesta.mp3" };
function frase(clave, texto, env, url) {
  const ruta = GRABACIONES[clave];
  if (!ruta) return decir(texto, env);
  const u = new URL(ruta, url);
  u.protocol = "https:";
  return `<Play>${xml(u.toString())}</Play>`;
}
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
// Mientras el asistente está en pruebas se puede añadir un aviso al saludo (variable VOZ_AVISO_PRUEBAS; vacía = sin aviso).
// Va justo antes de la pregunta final: "¡Hola!… Soy el asistente… <aviso> ¿En qué puedo ayudarte?"
export function saludoConAviso(saludo, aviso) {
  const texto = String(aviso || "").trim();
  if (!texto) return saludo;
  const m = String(saludo).match(/^(.*?)\s*(¿[^¿]*\?)\s*$/s);
  return m ? `${m[1]} ${texto} ${m[2]}` : `${saludo} ${texto}`;
}

export async function atenderVoz(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/voz/ws") return abrirConversacion(request, env, ctx);
  if (request.method !== "POST") return new Response("Método no permitido", { status: 405 });

  const p = await comprobarFirma(request, env);
  if (!p) return new Response("Firma no válida", { status: 403 });

  // ¿De qué lavandería es la llamada? Al empezar, por el número de Twilio al que llaman; después, por la
  // marca "k" que nosotros mismos ponemos en las direcciones siguientes (la firma de Twilio la protege).
  let cliente = null;
  try {
    const k = url.searchParams.get("k");
    cliente = k ? obtenerCliente(env, k) : buscarClientePorVoz(env, p.To);
  } catch { /* lavandería desconocida */ }
  // La llamada de prueba desde /prueba (el navegador, protegido por clave) no marca ningún número de Twilio:
  // se atiende con la lavandería por defecto (Lavanda), aunque haya varias activas.
  if (!cliente && String(p.From || "").startsWith("client:")) {
    try { cliente = obtenerCliente(env); } catch { /* sin lavandería por defecto */ }
  }
  if (!cliente) {
    console.error(`Voz: llamada al número ${p.To || "(desconocido)"}, que no es de ninguna lavandería`);
    return twiml(decir("Este número no está disponible. Gracias por llamar.", env) + "<Hangup/>");
  }
  const { textos } = cliente;
  const envC = entornoDe(env, cliente);   // móvil del dueño y credenciales de ESA lavandería

  // 1) Llega una llamada: conectar con el asistente
  if (url.pathname === "/voz") {
    // Llamada de prueba desde el navegador: puede simular el número del cliente
    const numeroPrueba = String(p.From || "").startsWith("client:") ? normalizarTelefono(p.TelefonoPrueba || "").slice(0, 15) : "";
    const pase = await paseLlamada(env, p.CallSid, numeroPrueba, cliente.ficha.id);
    const ws = new URL("/voz/ws", url);
    ws.protocol = "wss:";
    ws.search = new URLSearchParams({ c: p.CallSid, k: cliente.ficha.id, ...(numeroPrueba ? { n: numeroPrueba } : {}), t: pase }).toString();
    const fin = new URL("/voz/fin", url);
    fin.protocol = "https:";
    fin.search = new URLSearchParams({ k: cliente.ficha.id }).toString();
    const atributos = {
      url: ws.toString(),
      language: env.VOZ_IDIOMA || "es-ES",
      welcomeGreeting: saludoConAviso(textos.SALUDO_VOZ, env.VOZ_AVISO_PRUEBAS),
      welcomeGreetingInterruptible: env.VOZ_SALUDO_INTERRUMPIBLE || "none",   // el saludo no se corta por ruido ni por hablar encima
      ttsProvider: env.VOZ_TTS_PROVIDER || "Amazon",
      voice: env.VOZ_VOZ || "Lucia-Neural",
    };
    // En las llamadas de prueba desde el navegador se puede elegir otra voz para compararlas
    // Cualquier voz de ElevenLabs por su "Voice ID" (solo letras y números)
    const vozEleven = /^ElevenLabs\|[A-Za-z0-9]{15,40}$/.test(p.VozPrueba || "");
    if (String(p.From || "").startsWith("client:") && (VOCES_PRUEBA.includes(p.VozPrueba) || vozEleven)) {
      const [proveedor, voz] = p.VozPrueba.split("|");
      atributos.ttsProvider = proveedor;
      if (voz) atributos.voice = voz; else delete atributos.voice;
      console.log(`Voz [prueba]: probando la voz ${p.VozPrueba}`);
    }
    // Velocidad de ElevenLabs (prueba): "voz-modelo-velocidad_estabilidad_similitud"
    if (String(p.From || "").startsWith("client:") && ["0.8", "0.85", "0.9", "0.95", "1.0"].includes(p.VelocidadPrueba)
        && atributos.ttsProvider === "ElevenLabs" && atributos.voice) {
      atributos.voice = `${atributos.voice.split("-")[0]}-flash_v2_5-${p.VelocidadPrueba}_0.5_0.75`;
      console.log(`Voz [prueba]: velocidad ${p.VelocidadPrueba} → ${atributos.voice}`);
    }
    if (env.VOZ_STT_PROVIDER) atributos.transcriptionProvider = env.VOZ_STT_PROVIDER;
    if (env.VOZ_STT_MODELO) atributos.speechModel = env.VOZ_STT_MODELO;   // p. ej. "flux" (Deepgram Flux)
    const attr = Object.entries(atributos).map(([k, v]) => `${k}="${xml(v)}"`).join(" ");
    return twiml(`<Connect action="${xml(fin.toString())}"><ConversationRelay ${attr}/></Connect>`);
  }

  // 2) Termina el asistente: pasar la llamada o colgar
  if (url.pathname === "/voz/fin") {
    let datos = {};
    try { datos = JSON.parse(p.HandoffData || "{}"); } catch { /* sin datos */ }
    const dueno = normalizarTelefono(envC.OWNER_PHONE);
    const idCallerId = /^\+\d{6,}$/.test(p.From || "") ? p.From : /^\+\d{6,}$/.test(p.To || "") ? p.To : "";
    if (datos.accion === "pasar" && dueno && !idCallerId) {
      // Llamada de prueba desde el navegador: no hay número desde el que pasarla
      return twiml(decir("Aquí te pasaría con un compañero. En una llamada real, sonaría en tu móvil. Fin de la prueba.", env) + "<Hangup/>");
    }
    if (datos.accion === "pasar" && dueno) {
      const tras = new URL("/voz/tras-dial", url);
      tras.protocol = "https:";
      tras.search = new URLSearchParams({ k: cliente.ficha.id, r: String(datos.resumen || "").slice(0, 300) }).toString();
      return twiml(
        frase("pasar", "Te paso con un compañero, un momento por favor.", env, url) +
        `<Dial timeout="25" callerId="${xml(idCallerId)}" action="${xml(tras.toString())}"><Number>+${xml(dueno)}</Number></Dial>`,
      );
    }
    if (p.ErrorCode || p.SessionStatus === "failed") {
      console.error("Voz: la sesión de ConversationRelay falló:", p.ErrorCode, p.ErrorMessage);
      return twiml(frase("noContesta", textos.NO_CONTESTA_VOZ, env, url) + "<Hangup/>");
    }
    return twiml("<Hangup/>");
  }

  // 3) Nadie ha cogido la llamada pasada
  if (url.pathname === "/voz/tras-dial") {
    if (p.DialCallStatus === "completed") return twiml("<Hangup/>");
    const resumen = url.searchParams.get("r") || "";
    ctx?.waitUntil?.(
      avisarDueno({
        env: envC, cliente, wa: clienteWhatsApp(envC), telefono: normalizarTelefono(p.From), nombre: "",
        motivo: "llamada_perdida", resumen: resumen || "Llamada que el asistente intentó pasarte.", maquina: "", importe: "", telefonoCliente: p.From,
      }).catch((e) => console.error("Voz: no se pudo avisar de la llamada perdida:", e.message)),
    );
    return twiml(frase("noContesta", textos.NO_CONTESTA_VOZ, env, url) + "<Hangup/>");
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
  const numeroPrueba = url.searchParams.get("n") || "";
  const clienteId = url.searchParams.get("k") || "";
  if (!igual(url.searchParams.get("t") || "", await paseLlamada(env, callSid, numeroPrueba, clienteId))) {
    console.error("Voz: intento de conexión sin pase válido");
    return new Response("No autorizado", { status: 403 });
  }
  let lavanderia;
  try { lavanderia = obtenerCliente(env, clienteId || undefined); } catch { return new Response("Lavandería desconocida", { status: 403 }); }
  const envC = entornoDe(env, lavanderia);
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
    numeroPrueba, cliente: lavanderia,
    env: envC, claude, wa: clienteWhatsApp(envC),
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
export function crearSesion({ env, claude, wa, enviar, numeroPrueba = "", ahora = () => Date.now(), cliente = obtenerCliente(env) }) {
  const { ficha, textos } = cliente;
  const HERRAMIENTA_AVISO = textos.HERRAMIENTA_AVISO;
  const HERRAMIENTA_PASAR_LLAMADA = textos.HERRAMIENTA_PASAR_LLAMADA;
  const historial = [];
  const avisos = [];
  let llamante = "";
  let actual = null;   // respuesta en curso (para cortarla si el cliente interrumpe)
  let terminada = false;
  let precarga = null;   // promesa de la precarga de la caché

  function sistema() {
    const ult3 = llamante.slice(-3).split("").join(" ");
    return (
      `${textos.HORA_ETIQUETA}: ${new Intl.DateTimeFormat("es-ES", { timeZone: ficha.zonaHoraria, weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(ahora()))}.` +
      (llamante ? ` El cliente llama desde el +${llamante} (acaba en ${ult3}).` : " No se conoce el número del cliente.") +
      (avisos.length ? ` Avisos ya enviados en esta llamada (no los repitas): ${avisos.map((a) => a.motivo).join(", ")}.` : "")
    );
  }

  // La memoria (historial) guarda solo texto, igual que en WhatsApp. Dentro de un turno,
  // las llamadas a herramientas van en una lista aparte que solo crece (sin modificar nada).
  const modelo = env.VOZ_MODELO || MODELO_VOZ;
  const ajustes = {
    model: modelo,
    // Sonnet 5.5: "between_tools" = sin razonamiento previo (lo más rápido). Otros modelos: adaptativo.
    ...(modelo === "claude-sonnet-5-5" ? { thinking: { type: "between_tools" } } : {}),
    output_config: { effort: "low" },
    system: [{ type: "text", text: textos.INSTRUCCIONES_VOZ, cache_control: { type: "ephemeral" } }],
    tools: [HERRAMIENTA_AVISO, HERRAMIENTA_PASAR_LLAMADA],
  };

  // Precarga: Claude "lee" las normas mientras suena el saludo (max_tokens 0 = solo escribe la caché)
  async function precargar() {
    const t0 = ahora();
    try {
      const r = await claude.beta.messages.create({ ...ajustes, max_tokens: 0, messages: [{ role: "user", content: "precarga" }] });
      console.log(`Voz [precarga] ${ahora() - t0} ms · caché escrita ${r.usage?.cache_creation_input_tokens ?? "?"} · leída ${r.usage?.cache_read_input_tokens ?? "?"}`);
    } catch (e) {
      console.error("Voz: la precarga falló:", e?.message || e);
    }
  }

  async function responder() {
    const mensajes = [...historial, { role: "system", content: sistema() }];
    let textoTurno = "";
    const guardar = (extra) => {
      const t = (textoTurno + (extra || "")).trim();
      if (t) historial.push({ role: "assistant", content: t });
    };
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const control = { cortada: false, stream: null, dicho: "", previo: textoTurno, inicio: ahora(), primera: 0 };
      actual = control;
      const stream = claude.beta.messages.stream({
        ...ajustes,
        max_tokens: 1500,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: mensajes,
      });
      control.stream = stream;
      stream.on("text", (t) => {
        if (control.cortada || !t) return;
        if (!control.primera) control.primera = ahora() - control.inicio;
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
      if (control.dicho) {
        const u = msg.usage || {};
        console.log(`Voz [asistente] (${control.primera} ms hasta la primera palabra, ${ahora() - control.inicio} ms en total · caché leída ${u.cache_read_input_tokens ?? "?"}, escrita ${u.cache_creation_input_tokens ?? "?"}, sin caché ${u.input_tokens ?? "?"}): ${control.dicho}`);
      }
      textoTurno += (textoTurno && control.dicho ? " " : "") + control.dicho;

      if (msg.stop_reason === "refusal") {
        const t = "Perdona, con eso no puedo ayudarte.";
        enviar({ type: "text", token: t, last: true });
        guardar(" " + t);
        return;
      }
      const usos = msg.content.filter((b) => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || !usos.length) {
        guardar();
        return;
      }
      mensajes.push({ role: "assistant", content: msg.content });

      const resultados = [];
      for (const uso of usos) {
        const datos = typeof uso.input === "string" ? JSON.parse(uso.input) : uso.input;
        console.log(`Voz [herramienta ${uso.name}]: ${JSON.stringify(datos)}`);
        if (uso.name === HERRAMIENTA_PASAR_LLAMADA.name) {
          terminada = true;
          guardar(" [pasa la llamada a un compañero]");
          enviar({ type: "end", handoffData: JSON.stringify({ accion: "pasar", resumen: String(datos.resumen || "").slice(0, 300) }) });
          return;
        }
        let contenido = "Hecho. No menciones el aviso al cliente. Si todavía no le has dicho la frase de cierre, dila ahora; si ya se la has dicho, no digas nada más.";
        if (uso.name === HERRAMIENTA_AVISO.name) {
          const clave = claveAviso(datos);
          if (avisos.some((a) => a.clave === clave)) {
            contenido = "Ya estaba hecho. No menciones el aviso al cliente y no digas nada más sobre esto.";
          } else {
            try {
              await avisarDueno({
                env, cliente, wa, telefono: llamante, nombre: "📞 Llamada",
                motivo: datos.motivo, resumen: datos.resumen, maquina: datos.maquina, importe: datos.importe, telefonoCliente: datos.telefono,
              });
              avisos.push({ clave, motivo: datos.motivo });
            } catch (e) {
              console.error("Voz: AVISO NO ENTREGADO al dueño:", JSON.stringify(datos), "·", e.message);
              contenido = "Hecho. No menciones el aviso al cliente. Si todavía no le has dicho la frase de cierre, dila ahora; si ya se la has dicho, no digas nada más.";
            }
          }
        } else {
          contenido = "Herramienta desconocida.";
        }
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: contenido });
      }
      mensajes.push({ role: "user", content: resultados });
    }
    guardar();
  }

  return {
    historial,
    async recibir(texto) {
      if (terminada) return;
      let m;
      try { m = JSON.parse(texto); } catch { return; }

      if (m.type === "setup") {
        llamante = numeroPrueba || normalizarTelefono(String(m.from || "").startsWith("client:") ? "" : m.from || "");
        precarga = precargar();
        return;
      }
      if (m.type === "interrupt") {
        // El cliente ha hablado encima: dejar en la memoria solo lo que llegó a oír
        if (actual && !actual.cortada) {
          actual.cortada = true;
          actual.stream?.abort?.();
          const oido = ((actual.previo ? actual.previo + " " : "") + (m.utteranceUntilInterrupt || actual.dicho)).trim();
          if (oido) historial.push({ role: "assistant", content: oido + " [interrumpido]" });
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
