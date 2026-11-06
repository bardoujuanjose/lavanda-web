// =====================================================================
//  REGISTRO DE LAVANDERÍAS
//
//  Todo el código (web, WhatsApp, voz) pasa por aquí para saber de QUÉ lavandería
//  es cada petición. Cada canal la reconoce de una forma:
//    · WhatsApp → por el número al que han escrito   (buscarClientePorWhatsApp)
//    · Web      → por la página desde la que escriben (buscarClientePorOrigen)
//    · Voz      → por el número de Twilio al que llaman (buscarClientePorVoz)
//
//  De dónde salen las fichas:
//    · FIJAS: archivos del código (Lavanda, src/clientes/lavanda.js). No se tocan desde el panel.
//    · De la BASE DE DATOS: las que se dan de alta en el panel /admin. Se recargan cada 30 s
//      (prepararRegistro). Una ficha guardada que no sea válida no se atiende (y se anota el error).
//
//  Solo se atienden las lavanderías ACTIVAS. Una nueva nace desactivada (borrador): mientras
//  tanto no afecta a nada.
//
//  Regla de seguridad: con VARIAS lavanderías activas, una petición que no reconocemos NO se
//  atiende (nunca se contesta con los datos de otra lavandería). Con UNA sola, se atiende con
//  ella como hasta ahora, para no cortar nada por un fallo de configuración.
// =====================================================================
import { crearTextos } from "../negocio.js";
import { descifrar } from "../cifrado.js";
import { FICHA_LAVANDA } from "./lavanda.js";

const POR_DEFECTO = FICHA_LAVANDA.id;
const FICHAS_FIJAS = { [FICHA_LAVANDA.id]: FICHA_LAVANDA };
let FICHAS_BD = {};
const montados = new Map();
const CADUCA_MS = 30_000;
let cargadoEn = 0;

// Primero las fijas (Lavanda); si una de la base de datos tuviera el mismo id, manda la fija
const fichas = () => {
  const todas = { ...FICHAS_FIJAS };
  for (const [id, f] of Object.entries(FICHAS_BD)) if (!Object.hasOwn(todas, id)) todas[id] = f;
  return todas;
};
const estaActiva = (f) => f.activa !== false;

// Para fichas fijas (y para las pruebas)
export function registrarCliente(ficha) {
  crearTextos(ficha);            // la valida: si falta algo, falla ahora y no con un cliente delante
  FICHAS_FIJAS[ficha.id] = ficha;
  montados.delete(ficha.id);
}
export function quitarCliente(id) {
  if (id === POR_DEFECTO) throw new Error("No se puede quitar la lavandería por defecto");
  delete FICHAS_FIJAS[id];
  montados.delete(id);
}
export const idsDeClientes = () => Object.keys(fichas());
export const esFija = (id) => Object.hasOwn(FICHAS_FIJAS, id);

export function obtenerCliente(env = {}, id = env?.CLIENTE || POR_DEFECTO) {
  const ficha = fichas()[id];
  if (!ficha) throw new Error(`No existe la lavandería "${id}"`);
  if (!montados.has(id)) montados.set(id, { ficha, textos: crearTextos(ficha) });
  return montados.get(id);
}

const activas = (env) => idsDeClientes().map((id) => obtenerCliente(env, id)).filter((c) => estaActiva(c.ficha));
const unica = (env) => { const a = activas(env); return a.length === 1 ? a[0] : null; };

// ---------------------------------------------------------------------
//  Base de datos
// ---------------------------------------------------------------------
export function almacenRegistro(env) {
  if (!env?.REGISTRO) return null;
  return env.REGISTRO.get(env.REGISTRO.idFromName("principal"));
}

// Carga las fichas de la base de datos (con caché de 30 s). Si la base de datos falla, se sigue
// con las que ya había: nunca se deja de atender a Lavanda por esto.
export async function prepararRegistro(env, { forzar = false, ahora = Date.now() } = {}) {
  const almacen = almacenRegistro(env);
  if (!almacen) return;
  if (!forzar && cargadoEn && ahora - cargadoEn < CADUCA_MS) return;
  let lista;
  try {
    lista = await almacen.listar();
  } catch (e) {
    console.error("Registro: no se pudo leer la base de datos:", e?.message || e);
    return;
  }
  const nuevas = {};
  for (const guardada of lista || []) {
    if (!guardada?.id || esFija(guardada.id)) continue;
    try {
      const ficha = await abrirFicha(guardada, env);
      crearTextos(ficha);
      nuevas[ficha.id] = ficha;
    } catch (e) {
      console.error(`Registro: la ficha "${guardada.id}" no es válida y no se atiende: ${e.message}`);
    }
  }
  FICHAS_BD = nuevas;
  for (const id of [...montados.keys()]) if (!esFija(id)) montados.delete(id);
  cargadoEn = ahora;
}
export function olvidarCache() { cargadoEn = 0; }

// Descifra en memoria el token guardado (en la base de datos solo está cifrado)
async function abrirFicha(guardada, env) {
  const ficha = structuredClone(guardada);
  if (ficha.conexion?.tokenCifrado) {
    try {
      ficha.conexion.token = await descifrar(ficha.conexion.tokenCifrado, env.CLAVE_CIFRADO);
    } catch (e) {
      console.error(`Registro: no se pudo descifrar el token de "${ficha.id}" (¿ha cambiado CLAVE_CIFRADO?): ${e.message}`);
      ficha.conexion.token = "";
    }
  }
  return ficha;
}

// ---------------------------------------------------------------------
//  Conexión de cada lavandería (número de WhatsApp, token, móvil del dueño)
//    · Fichas fijas: en secretos de Cloudflare, con los nombres de ficha.secretos.
//    · Fichas de la base de datos: en ficha.conexion (el token, cifrado).
// ---------------------------------------------------------------------
export function conexionDe(env, cliente) {
  const f = cliente.ficha;
  if (f.conexion) return { phoneId: f.conexion.phoneId || "", token: f.conexion.token || "", dueno: f.conexion.dueno || "" };
  const s = f.secretos || {};
  return { phoneId: env[s.phoneId] || "", token: env[s.token] || "", dueno: env[s.dueno] || "" };
}

// El entorno "visto por esa lavandería": el resto del código sigue leyendo env.WHATSAPP_TOKEN,
// env.WHATSAPP_PHONE_ID y env.OWNER_PHONE sin saber de cuál es.
export function entornoDe(env, cliente) {
  const c = conexionDe(env, cliente);
  return { ...env, WHATSAPP_PHONE_ID: c.phoneId, WHATSAPP_TOKEN: c.token, OWNER_PHONE: c.dueno };
}

// ---------------------------------------------------------------------
//  ¿De qué lavandería es?
// ---------------------------------------------------------------------
// WhatsApp: el aviso de Meta trae el identificador del número al que han escrito
export function buscarClientePorWhatsApp(env, numeroId) {
  if (numeroId) {
    const c = activas(env).find((x) => conexionDe(env, x).phoneId === String(numeroId));
    if (c) return c;
  }
  return unica(env);
}

// Web: la página desde la que escriben (cabecera Origin)
export function buscarClientePorOrigen(env, origen) {
  const c = activas(env).find((x) => x.ficha.origenesPermitidos.includes(origen));
  if (c) return c;
  return unica(env);   // con una sola lavandería (y pruebas en local) sirve esa; con varias, un origen desconocido no se atiende
}

// Voz: el número de Twilio al que llaman (campo To de Twilio)
const soloCifras = (n) => String(n || "").replace(/[^\d+]/g, "");
export function buscarClientePorVoz(env, numeroLlamado) {
  const n = soloCifras(numeroLlamado);
  if (n) {
    const c = activas(env).find((x) => x.ficha.numerosVoz.some((v) => soloCifras(v) === n));
    if (c) return c;
  }
  return unica(env);
}

// Nombre con el que se guarda la memoria de un cliente de WhatsApp de esa lavandería
export function nombreMemoria(cliente, telefono) {
  const prefijo = cliente.ficha.prefijoMemoria ?? `${cliente.ficha.id}:`;
  return prefijo + telefono;
}

// ---------------------------------------------------------------------
//  Comprobaciones antes de activar una lavandería (las usa el panel)
//  errores: impiden activarla · avisos: se puede, pero conviene saberlo
// ---------------------------------------------------------------------
export function comprobarActivacion(env, cliente) {
  const errores = [];
  const avisos = [];
  const f = cliente.ficha;
  const c = conexionDe(env, cliente);
  if (!c.phoneId) errores.push("No tiene conectado su número de WhatsApp.");
  if (!c.token) errores.push("No tiene token de WhatsApp (o no se puede descifrar).");
  if (!c.dueno) errores.push("Falta el móvil del dueño (para los avisos).");
  if (!f.numerosVoz.length) avisos.push("No tiene número de voz: solo atenderá por WhatsApp y web.");

  const otras = activas(env).filter((x) => x.ficha.id !== f.id);
  for (const o of otras) {
    const oc = conexionDe(env, o);
    if (c.phoneId && oc.phoneId === c.phoneId) errores.push(`Su número de WhatsApp es el mismo que el de ${o.ficha.nombre}.`);
    for (const n of f.numerosVoz) if (o.ficha.numerosVoz.some((v) => soloCifras(v) === soloCifras(n))) errores.push(`El número de voz ${n} ya es de ${o.ficha.nombre}.`);
    for (const w of f.origenesPermitidos) if (o.ficha.origenesPermitidos.includes(w)) errores.push(`La web ${w} ya es de ${o.ficha.nombre}.`);
    // Al dejar de haber una sola, las demás tienen que estar bien identificadas
    if (!oc.phoneId) errores.push(`${o.ficha.nombre} no tiene su número de WhatsApp configurado: con dos lavanderías activas sus mensajes se ignorarían.`);
    if (!o.ficha.numerosVoz.length) avisos.push(`${o.ficha.nombre} no tiene número de voz en su ficha: con dos lavanderías activas sus llamadas se rechazarán.`);
  }
  avisos.push(...restosDeOtras(f).map((r) => `Parece que quedan datos de ${r.de}: "${r.texto}".`));
  return { errores, avisos };
}

// Busca en los textos de una ficha datos de OTRA lavandería (típico al copiar y pegar)
export function restosDeOtras(ficha) {
  const textos = JSON.stringify({ c: ficha.conocimiento, n: ficha.normas });
  const encontrados = [];
  for (const id of idsDeClientes()) {
    if (id === ficha.id) continue;
    const o = fichas()[id];
    for (const dato of [o.telefono, o.direccionCorta, o.web, o.ciudad]) {
      if (dato && dato !== ficha[datoClave(o, dato)] && textos.includes(dato)) encontrados.push({ de: o.nombre, texto: dato });
    }
    if (o.nombre && new RegExp(`\\b${o.nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(textos) && o.nombre !== ficha.nombre) {
      encontrados.push({ de: o.nombre, texto: o.nombre });
    }
  }
  return encontrados;
}
// (si la ficha nueva está en la misma ciudad que otra, la ciudad no cuenta como resto)
function datoClave(o, dato) {
  return Object.keys(o).find((k) => o[k] === dato);
}
