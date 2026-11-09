// =====================================================================
//  Transcripciones de WhatsApp (para la página privada /admin/conversaciones)
//
//  Cada cliente guarda, además de su memoria (los últimos 30 mensajes que ve Claude),
//  un registro con fecha y hora de todo lo que se ha dicho: cliente, asistente, equipo
//  y avisos al dueño. Y en la base de datos de lavanderías (Registro) hay un índice
//  con una línea por conversación, para poder listarlas.
//
//  Sin dependencias de Cloudflare, para poder probarlo fácilmente.
// =====================================================================

export const TRANSCRIPCION_MAX = 400;                       // mensajes guardados por cliente (los más antiguos se borran)
export const RETENCION_MS = 365 * 24 * 60 * 60 * 1000;      // y nunca más de un año
const TEXTO_MAX = 4000;
const RESUMEN_MAX = 120;

const recortar = (t, max) => {
  const s = String(t ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

// Convierte lo que se ha añadido a la memoria (resultado.anadir) en líneas del registro
//   { cuando, quien: "cliente" | "asistente" | "equipo" | "aviso" | "error", texto }
export function entradasDe(resultado, { ahora = Date.now(), etiquetaEquipo = "", describirAviso = (a) => a.motivo } = {}) {
  const entradas = [];
  for (const m of resultado?.anadir || []) {
    const texto = typeof m.content === "string" ? m.content : "[mensaje]";
    if (m.role === "user") entradas.push({ cuando: ahora, quien: "cliente", texto });
    else if (etiquetaEquipo && texto.startsWith(etiquetaEquipo)) {
      entradas.push({ cuando: ahora, quien: "equipo", texto: texto.slice(etiquetaEquipo.length).trim() });
    } else entradas.push({ cuando: ahora, quien: "asistente", texto });
  }
  for (const a of resultado?.avisos || []) entradas.push({ cuando: a.cuando || ahora, quien: "aviso", texto: describirAviso(a) });
  return entradas.map((e) => ({ ...e, texto: recortar(e.texto, TEXTO_MAX) }));
}

// Añade al registro y lo recorta (máximo de mensajes y antigüedad)
export function anadirTranscripcion(anterior, entradas, ahora = Date.now()) {
  return [...(anterior || []), ...entradas]
    .filter((e) => ahora - (e.cuando || 0) < RETENCION_MS)
    .slice(-TRANSCRIPCION_MAX);
}

// La línea del índice de una conversación
export function lineaIndice({ memoria, cliente, telefono, nombre, transcripcion, pausa }) {
  const ultima = [...(transcripcion || [])].reverse().find((e) => e.quien !== "aviso") || transcripcion?.at(-1);
  return {
    memoria,
    cliente,
    telefono: telefono || "",
    nombre: nombre || "",
    ultimo: ultima?.cuando || 0,
    quien: ultima?.quien || "",
    resumen: recortar(String(ultima?.texto || "").replace(/\s+/g, " "), RESUMEN_MAX),
    mensajes: transcripcion?.length || 0,
    avisos: (transcripcion || []).filter((e) => e.quien === "aviso").length,
    equipo: Boolean(pausa),
  };
}

// Conversaciones anteriores a este registro: solo existe la memoria (sin fecha ni hora)
export function desdeHistorial(historial, etiquetaEquipo = "") {
  return entradasDe({ anadir: historial || [] }, { ahora: 0, etiquetaEquipo });
}
