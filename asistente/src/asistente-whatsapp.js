// =====================================================================
//  Lógica del asistente de WhatsApp
//  (sin dependencias de Cloudflare, para poder probarla fácilmente)
// =====================================================================
import { obtenerCliente } from "./clientes/index.js";
import { ERROR_FUERA_DE_24H, normalizarTelefono } from "./whatsapp.js";

export const MODELO = "claude-opus-5-5";
export const ESPERA_MS = 3000;                  // espera por si el cliente manda varios mensajes seguidos
export const HISTORIAL_MAX = 30;                // mensajes que recuerda de cada cliente
export const PAUSA_MAX_MS = 12 * 60 * 60 * 1000; // si nadie del equipo escribe en 12 h, el asistente vuelve
const FOTO_MAX_BYTES = 5 * 1024 * 1024;
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_VUELTAS = 4;

// Frase de error de la lavandería por defecto (cada lavandería tiene la suya en sus textos)
export const RESPUESTA_ERROR = obtenerCliente().textos.RESPUESTA_ERROR;

export function estadoInicial() {
  return { historial: [], pausa: null, avisos: [] };
}

const AVISO_CADUCA_MS = 7 * 24 * 60 * 60 * 1000; // pasada una semana, el mismo caso se puede volver a avisar

// Identifica un aviso para no enviarlo dos veces
export function claveAviso(datos) {
  const cifras = (t) => String(t || "").replace(/\D/g, "");
  return [datos.motivo, cifras(datos.telefono), cifras(datos.importe), cifras(datos.maquina)].join("|");
}

// Los motivos de aviso (Bizum, devolución, justificante…) dependen de la lavandería: están en su ficha
export function describirAviso(a, motivos) {
  const nombre = motivos.find((m) => m.clave === a.motivo)?.nombre;
  return [nombre || a.motivo, a.maquina && `máquina ${a.maquina}`, a.importe, a.telefono && `tel. ${a.telefono}`]
    .filter(Boolean).join(", ");
}

export function textoAyudaDueno({ textos } = obtenerCliente()) {
  return [
    textos.AYUDA_DUENO_TITULO,
    "",
    "Cuando te llegue un aviso, contesta al cliente escribiendo aquí:",
    "#34612345678 tu mensaje",
    "",
    textos.AYUDA_DUENO_NUMERO,
    "Para que el asistente vuelva a atenderle:",
    "#34612345678 fin",
    "",
    "Si nadie le escribe en 12 horas, el asistente vuelve solo.",
  ].join("\n");
}

// "#612345678 hola" -> { telefono: "34612345678", texto: "hola" }
export function leerComandoDueno(texto) {
  const m = String(texto || "").trim().match(/^#\s*\+?(\d{9,15})\s*([\s\S]*)$/);
  if (!m) return null;
  return { telefono: normalizarTelefono(m[1]), texto: m[2].trim() };
}

function horaActual(ahora, zonaHoraria) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: zonaHoraria, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ahora));
}

function enBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

function bonito(tel) {
  return "+" + tel;
}

function pausaCaducada(pausa, ahora) {
  if (!pausa) return false;
  return ahora - Math.max(pausa.desde || 0, pausa.ultimoDueno || 0) > PAUSA_MAX_MS;
}

// Resumen en texto de lo que mandó el cliente (para la memoria)
export function resumirPendientes(pendientes) {
  return pendientes
    .map((p) => {
      if (p.tipo === "text" || p.tipo === "button" || p.tipo === "interactive") return p.texto;
      if (p.tipo === "image") return "[Foto]" + (p.texto ? " " + p.texto : "");
      if (p.tipo === "audio") return p.transcripcion ? `[Audio] ${p.transcripcion}` : "[Audio]";
      return `[${p.tipo}]`;
    })
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------
//  Avisar al dueño por WhatsApp
// ---------------------------------------------------------------------
export async function avisarDueno({ env, wa, telefono, nombre, motivo, resumen, maquina, importe, telefonoCliente, cliente = obtenerCliente(env) }) {
  const dueno = normalizarTelefono(env.OWNER_PHONE);
  if (!dueno) throw new Error("Falta OWNER_PHONE");
  const titulos = {
    ...Object.fromEntries(cliente.ficha.normas.motivosAviso.map((m) => [m.clave, m.titulo])),
    llamada_perdida: "📞 *Llamada perdida (no contestaste)*",
    otro: "📌 *Aviso*",
  };
  const texto = [
    titulos[motivo] || titulos.otro,
    `👤 ${nombre || "Cliente"} · ${bonito(telefono)}`,
    maquina ? `🧺 Máquina: ${maquina}` : null,
    `📝 ${resumen}`,
    importe ? `💶 Importe: ${importe}` : null,
    telefonoCliente ? `📞 Teléfono indicado: ${telefonoCliente}` : null,
    "",
    "Para contestarle escribe:",
    `#${telefono} tu mensaje`,
    "Para devolverlo al asistente:",
    `#${telefono} fin`,
  ].filter((l) => l !== null).join("\n");
  try {
    await wa.enviarTexto(dueno, texto);
  } catch (e) {
    if (e.code !== ERROR_FUERA_DE_24H) throw e;
    // Han pasado más de 24 h desde tu último mensaje al número del negocio: Meta exige una plantilla aprobada
    const linea = `${(titulos[motivo] || titulos.otro).replace(/[*]/g, "")} - ${nombre || "Cliente"} (${bonito(telefono)})${maquina ? " - máquina " + maquina : ""}: ${resumen}${importe ? " - importe " + importe : ""}${telefonoCliente ? " - teléfono " + telefonoCliente : ""}`
      .replace(/\s+/g, " ").slice(0, 900);
    // La plantilla de aviso es de la cuenta de WhatsApp de cada lavandería: si la ficha no dice otra, la de siempre
    const plantilla = cliente.ficha.plantillaAviso;
    await wa.enviarPlantilla(dueno, plantilla?.nombre || env.OWNER_TEMPLATE || "aviso_lavanda", plantilla?.idioma || env.OWNER_TEMPLATE_LANG || "es", [linea]);
  }
}

// ---------------------------------------------------------------------
//  Procesa los mensajes acumulados de un cliente
//  Devuelve { anadir: [...mensajes para la memoria], pausa: undefined | null | {...} }
// ---------------------------------------------------------------------
export async function procesarPendientes({ estado, pendientes, telefono, nombre, wa, claude, env, transcribir, ahora = Date.now(), cliente = obtenerCliente(env) }) {
  const { ficha, textos } = cliente;
  const HERRAMIENTA_AVISO = textos.HERRAMIENTA_AVISO;
  const resultado = { anadir: [], pausa: undefined };
  let pausa = estado.pausa;
  if (pausaCaducada(pausa, ahora)) { pausa = null; resultado.pausa = null; }

  const resumen = resumirPendientes(pendientes);

  // --- El equipo está atendiendo: reenviar al dueño y no contestar ---
  if (pausa) {
    // Con "coexistencia" el dueño ya ve los mensajes en su app WhatsApp Business: no se le reenvían
    if (ficha.conexion?.modo === "coexistencia") {
      resultado.anadir.push({ role: "user", content: resumen });
      return resultado;
    }
    const dueno = normalizarTelefono(env.OWNER_PHONE);
    for (const p of pendientes) {
      try {
        if (p.tipo === "image" && p.mediaId) {
          const foto = await wa.descargarMedia(p.mediaId);
          const id = await wa.subirMedia(foto.bytes, foto.tipo);
          await wa.enviarImagen(dueno, id, `📷 ${nombre || "Cliente"} (${bonito(telefono)})${p.texto ? ": " + p.texto : ""}`);
        } else if (p.tipo === "audio" && p.mediaId) {
          const audio = await wa.descargarMedia(p.mediaId);
          const id = await wa.subirMedia(audio.bytes, audio.tipo);
          await wa.enviarTexto(dueno, `🎤 Audio de ${nombre || "Cliente"} (${bonito(telefono)}). Responde con: #${telefono} tu mensaje`);
          await wa.enviarAudio(dueno, id);
        } else {
          await wa.enviarTexto(dueno, `💬 ${nombre || "Cliente"} (${bonito(telefono)}):\n${resumirPendientes([p])}\n\nResponde con: #${telefono} tu mensaje`);
        }
      } catch (e) {
        console.error("No se pudo reenviar al dueño:", e.message);
      }
    }
    resultado.anadir.push({ role: "user", content: resumen });
    return resultado;
  }

  // --- Preparar lo que ve Claude ---
  const ultimo = pendientes[pendientes.length - 1];
  wa.marcarLeido(ultimo.id).catch(() => {});

  const bloques = [];
  for (const p of pendientes) {
    if (p.tipo === "image" && p.mediaId) {
      try {
        const foto = await wa.descargarMedia(p.mediaId);
        const tipo = (foto.tipo || "").split(";")[0];
        if (TIPOS_FOTO.includes(tipo) && foto.bytes.byteLength <= FOTO_MAX_BYTES) {
          bloques.push({ type: "image", source: { type: "base64", media_type: tipo, data: enBase64(foto.bytes) } });
          if (p.texto) bloques.push({ type: "text", text: p.texto });
          continue;
        }
      } catch (e) {
        console.error("No se pudo descargar la foto:", e.message);
      }
      bloques.push({ type: "text", text: "[El cliente ha enviado una foto que no se ha podido abrir]" + (p.texto ? " " + p.texto : "") });
    } else if (p.tipo === "audio") {
      let transcripcion = "";
      if (p.mediaId && transcribir) {
        try {
          const audio = await wa.descargarMedia(p.mediaId);
          transcripcion = String((await transcribir(audio.bytes, audio.tipo)) || "").trim();
        } catch (e) {
          console.error("No se pudo transcribir el audio:", e.message);
        }
      }
      p.transcripcion = transcripcion;
      bloques.push({
        type: "text",
        text: transcripcion
          ? `[Audio del cliente, transcrito automáticamente]: ${transcripcion}`
          : "[El cliente ha enviado un audio que no se ha podido transcribir]",
      });
    } else if (p.texto) {
      bloques.push({ type: "text", text: p.texto });
    } else {
      bloques.push({ type: "text", text: `[El cliente ha enviado un mensaje de tipo "${p.tipo}" que no puedes ver]` });
    }
  }

  const avisosPrevios = (estado.avisos || []).filter((a) => ahora - (a.cuando || 0) < AVISO_CADUCA_MS);
  const enviadosAhora = [];
  const mensajes = [
    ...estado.historial,
    { role: "user", content: bloques },
    {
      role: "system",
      content:
        `${textos.HORA_ETIQUETA}: ${horaActual(ahora, ficha.zonaHoraria)}.` +
        (nombre ? ` Nombre del cliente en WhatsApp: ${nombre}.` : "") +
        (avisosPrevios.length
          ? ` Avisos YA enviados al equipo en esta conversación (no los repitas): ${avisosPrevios.map((a) => describirAviso(a, ficha.normas.motivosAviso)).join("; ")}.`
          : " Todavía no se ha enviado ningún aviso al equipo en esta conversación."),
    },
  ];

  // --- Conversación con Claude (con la herramienta de aviso) ---
  let respuesta = "";
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const r = await claude.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: textos.INSTRUCCIONES_WHATSAPP, cache_control: { type: "ephemeral" } }],
      tools: [HERRAMIENTA_AVISO],
      messages: mensajes,
    });

    if (r.stop_reason === "refusal") {
      respuesta = "Lo siento, con eso no puedo ayudarte. Si tienes alguna duda sobre la lavandería, pregúntame 😊";
      break;
    }
    const texto = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const usos = r.content.filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || usos.length === 0) {
      respuesta = texto;
      break;
    }

    // Claude quiere avisar al equipo
    mensajes.push({ role: "assistant", content: r.content });
    const resultados = [];
    for (const uso of usos) {
      let contenido;
      let esError = false;
      if (uso.name !== HERRAMIENTA_AVISO.name) {
        contenido = "Herramienta desconocida.";
        esError = true;
      } else {
        try {
          const datos = typeof uso.input === "string" ? JSON.parse(uso.input) : uso.input;
          const clave = claveAviso(datos);
          if ([...avisosPrevios, ...enviadosAhora].some((a) => a.clave === clave)) {
            contenido = "Este aviso ya se había enviado antes en esta conversación: NO se ha vuelto a enviar. Continúa la conversación con normalidad.";
            resultados.push({ type: "tool_result", tool_use_id: uso.id, content: contenido });
            continue;
          }
          await avisarDueno({
            env, wa, telefono, nombre, cliente,
            motivo: datos.motivo, resumen: datos.resumen, maquina: datos.maquina, importe: datos.importe, telefonoCliente: datos.telefono,
          });
          enviadosAhora.push({
            clave, cuando: ahora, motivo: datos.motivo, maquina: datos.maquina, importe: datos.importe, telefono: datos.telefono,
          });
          contenido = "Aviso enviado al equipo. Continúa la conversación según tus normas (por ejemplo, confirma el teléfono y cierra el caso).";
        } catch (e) {
          console.error("No se pudo avisar al dueño:", e.message);
          console.error("WhatsApp: AVISO NO ENTREGADO al dueño:", JSON.stringify(uso.input));
          contenido = "Aviso registrado. Continúa la conversación con normalidad y cierra el caso como indican tus normas.";
          esError = true;
        }
      }
      resultados.push({ type: "tool_result", tool_use_id: uso.id, content: contenido, ...(esError ? { is_error: true } : {}) });
    }
    mensajes.push({ role: "user", content: resultados });
  }

  if (!respuesta) respuesta = textos.RESPUESTA_ERROR;
  await wa.enviarTexto(telefono, respuesta);

  if (enviadosAhora.length) resultado.avisos = enviadosAhora;
  // el resumen se rehace aquí para incluir la transcripción de los audios
  resultado.anadir.push({ role: "user", content: resumirPendientes(pendientes) || "[mensaje]" }, { role: "assistant", content: respuesta });
  return resultado;
}

// Añade a la memoria y la recorta (empezando siempre por un mensaje del cliente)
export function aplicarResultado(estado, resultado) {
  const nuevo = { ...estado, historial: [...estado.historial, ...resultado.anadir] };
  if (resultado.pausa !== undefined) nuevo.pausa = resultado.pausa;
  nuevo.avisos = [...(estado.avisos || []), ...(resultado.avisos || [])].slice(-20);
  nuevo.historial = nuevo.historial.slice(-HISTORIAL_MAX);
  while (nuevo.historial.length && nuevo.historial[0].role !== "user") nuevo.historial.shift();
  return nuevo;
}

// ---------------------------------------------------------------------
//  El dueño ha contestado él mismo desde la app WhatsApp Business ("coexistencia"):
//  se apunta en la memoria y el asistente se calla con ese cliente (como con "#telefono texto").
//  Vuelve a atender si nadie del equipo escribe en 12 h, o con "#telefono fin".
// ---------------------------------------------------------------------
export function ecoDelDueno({ estado, texto, ahora = Date.now(), cliente = obtenerCliente() }) {
  return {
    anadir: [{ role: "assistant", content: `${cliente.textos.ETIQUETA_EQUIPO} ${texto || "[mensaje]"}` }],
    pausa: { desde: estado.pausa?.desde || ahora, ultimoDueno: ahora, motivo: "app" },
  };
}

// ---------------------------------------------------------------------
//  Mensajes del dueño: "#telefono texto" o "#telefono fin"
// ---------------------------------------------------------------------
export async function comandoDueno({ estado, telefono, texto, wa, env, ahora = Date.now(), cliente = obtenerCliente(env) }) {
  const dueno = normalizarTelefono(env.OWNER_PHONE);
  if (!texto) {
    await wa.enviarTexto(dueno, `Escribe el mensaje después del número. Ejemplo:\n#${telefono} Hola, ya lo hemos revisado`);
    return { anadir: [], pausa: undefined };
  }
  if (/^(fin|bot|asistente)$/i.test(texto)) {
    await wa.enviarTexto(dueno, `✅ El asistente vuelve a atender a ${bonito(telefono)}.`);
    return { anadir: [], pausa: null };
  }
  try {
    await wa.enviarTexto(telefono, texto);
  } catch (e) {
    const motivo = e.code === ERROR_FUERA_DE_24H
      ? "han pasado más de 24 h desde su último mensaje y WhatsApp no deja escribirle. Llámale por teléfono."
      : e.message;
    await wa.enviarTexto(dueno, `❌ No se ha podido enviar a ${bonito(telefono)}: ${motivo}`);
    return { anadir: [], pausa: undefined };
  }
  return {
    anadir: [{ role: "assistant", content: `${cliente.textos.ETIQUETA_EQUIPO} ${texto}` }],
    pausa: { desde: estado.pausa?.desde || ahora, ultimoDueno: ahora, motivo: estado.pausa?.motivo || "equipo" },
  };
}
