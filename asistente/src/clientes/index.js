// =====================================================================
//  REGISTRO DE LAVANDERÍAS
//
//  Todo el código (web, WhatsApp, voz) pasa por aquí para saber de QUÉ lavandería
//  es cada petición. Cada canal la reconoce de una forma:
//    · WhatsApp → por el número al que han escrito   (buscarClientePorWhatsApp)
//    · Web      → por la página desde la que escriben (buscarClientePorOrigen)
//    · Voz      → por el número de Twilio al que llaman (buscarClientePorVoz)
//
//  Regla de seguridad: con VARIAS lavanderías, una petición que no reconocemos
//  NO se atiende (nunca se contesta con los datos de otra lavandería). Con UNA
//  sola, se atiende con ella como hasta ahora, para no cortar nada por un fallo
//  de configuración.
//
//  Hoy las fichas son archivos; más adelante se cargarán de una base de datos
//  (registrarCliente ya permite añadirlas sin tocar este archivo).
// =====================================================================
import { crearTextos } from "../negocio.js";
import { FICHA_LAVANDA } from "./lavanda.js";

const POR_DEFECTO = FICHA_LAVANDA.id;
const FICHAS = { [FICHA_LAVANDA.id]: FICHA_LAVANDA };
const montados = new Map();

// Para dar de alta otra lavandería: crear su ficha y registrarla aquí (o con registrarCliente).
export function registrarCliente(ficha) {
  crearTextos(ficha);            // la valida: si falta algo, falla ahora y no con un cliente delante
  FICHAS[ficha.id] = ficha;
  montados.delete(ficha.id);
}
export function quitarCliente(id) {
  if (id === POR_DEFECTO) throw new Error("No se puede quitar la lavandería por defecto");
  delete FICHAS[id];
  montados.delete(id);
}
export const idsDeClientes = () => Object.keys(FICHAS);

export function obtenerCliente(env = {}, id = env?.CLIENTE || POR_DEFECTO) {
  const ficha = FICHAS[id];
  if (!ficha) throw new Error(`No existe la lavandería "${id}"`);
  if (!montados.has(id)) montados.set(id, { ficha, textos: crearTextos(ficha) });
  return montados.get(id);
}

const unica = () => (idsDeClientes().length === 1 ? obtenerCliente({}, idsDeClientes()[0]) : null);
const todas = (env) => idsDeClientes().map((id) => obtenerCliente(env, id));

// Los datos privados de cada lavandería están en secretos con el nombre que dice su ficha.
// entornoDe() devuelve el entorno "visto por esa lavandería": así el resto del código sigue
// leyendo env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_ID y env.OWNER_PHONE sin saber de cuál es.
export function entornoDe(env, cliente) {
  const s = cliente.ficha.secretos;
  return { ...env, WHATSAPP_PHONE_ID: env[s.phoneId], WHATSAPP_TOKEN: env[s.token], OWNER_PHONE: env[s.dueno] };
}

// WhatsApp: el aviso de Meta trae el identificador del número al que han escrito
export function buscarClientePorWhatsApp(env, numeroId) {
  if (numeroId) {
    const c = todas(env).find((x) => env[x.ficha.secretos.phoneId] === String(numeroId));
    if (c) return c;
  }
  return unica();
}

// Web: la página desde la que escriben (cabecera Origin)
export function buscarClientePorOrigen(env, origen) {
  const c = todas(env).find((x) => x.ficha.origenesPermitidos.includes(origen));
  if (c) return c;
  return unica();   // con una sola lavandería (y pruebas en local) sirve esa; con varias, un origen desconocido no se atiende
}

// Voz: el número de Twilio al que llaman (campo To de Twilio)
export function buscarClientePorVoz(env, numeroLlamado) {
  const n = String(numeroLlamado || "").replace(/[^\d+]/g, "");
  if (n) {
    const c = todas(env).find((x) => x.ficha.numerosVoz.some((v) => v.replace(/[^\d+]/g, "") === n));
    if (c) return c;
  }
  return unica();
}

// Nombre con el que se guarda la memoria de un cliente de WhatsApp de esa lavandería
export function nombreMemoria(cliente, telefono) {
  const prefijo = cliente.ficha.prefijoMemoria ?? `${cliente.ficha.id}:`;
  return prefijo + telefono;
}
