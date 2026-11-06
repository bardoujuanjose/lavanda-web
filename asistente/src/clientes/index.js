// =====================================================================
//  REGISTRO DE LAVANDERÍAS
//
//  obtenerCliente(env) devuelve { ficha, textos } de la lavandería que toca
//  atender. Todo el código (web, WhatsApp, voz) pasa por aquí, así que es el
//  ÚNICO sitio que habrá que cambiar para atender a varias lavanderías:
//  hoy solo hay una (Lavanda); más adelante la ficha se elegirá según el
//  número al que llaman, el número de WhatsApp o la web desde la que escriben.
// =====================================================================
import { crearTextos } from "../negocio.js";
import { FICHA_LAVANDA } from "./lavanda.js";

// Para dar de alta otra lavandería: crear su ficha y añadirla aquí.
const FICHAS = {
  [FICHA_LAVANDA.id]: FICHA_LAVANDA,
};
const POR_DEFECTO = FICHA_LAVANDA.id;

const montados = new Map();

export function obtenerCliente(env = {}, id = env?.CLIENTE || POR_DEFECTO) {
  const ficha = FICHAS[id];
  if (!ficha) throw new Error(`No existe la lavandería "${id}"`);
  if (!montados.has(id)) montados.set(id, { ficha, textos: crearTextos(ficha) });
  return montados.get(id);
}

export const idsDeClientes = () => Object.keys(FICHAS);
