// Conversación nueva: si el cliente solo saluda o han pasado más de 6 h, Claude no ve lo anterior.
// Reproduce el fallo del 09/11/2026: tras "Hola" y "Nada, gracias todo bien", el asistente sacó
// el Bizum y "la hora" de una conversación anterior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarPendientes, aplicarResultado, estadoInicial, esSoloSaludo, CONVERSACION_NUEVA_MS } from "../src/asistente-whatsapp.js";

const ENV = { OWNER_PHONE: "600111222" };
const CLIENTE = "34612345678";
const HORA = 3_600_000;
const T0 = Date.UTC(2026, 10, 9, 15, 0);   // 16:00 en España

function claudeFalso(respuestas) {
  const peticiones = [];
  return { peticiones, beta: { messages: { create: async (p) => { peticiones.push(structuredClone(p)); return { stop_reason: "end_turn", content: [{ type: "text", text: respuestas.shift() }] }; } } } };
}
const wa = { enviarTexto: async () => {}, marcarLeido: async () => {} };
const lo_que_ve_claude = (peticion) => JSON.stringify(peticion.messages.filter((m) => m.role !== "system"));

async function turno(estado, texto, ahora, claude) {
  const r = await procesarPendientes({ estado, pendientes: [{ id: "m" + ahora, tipo: "text", texto }], telefono: CLIENTE, nombre: "Juanjo", wa, claude, env: ENV, ahora });
  return aplicarResultado(estado, r);
}

// Una conversación anterior sobre un Bizum
async function conversacionDelBizum() {
  const claude = claudeFalso(["¿Cuánto metiste?", "Te haremos un Bizum de 2 €. Son las 14:00."]);
  let e = await turno(estadoInicial(), "no me ha dado el cambio en la 3", T0, claude);
  e = await turno(e, "10 euros", T0 + 60_000, claude);
  return e;
}

test("se reconocen los saludos solos (y solo ellos)", () => {
  for (const t of ["Hola", "hola", "¡Buenas tardes!", "Buenas", "buenos días", "hola 👋", "Holaaa!!", "Bon dia", "Bona tarda"]) assert.equal(esSoloSaludo(t), true, t);
  for (const t of ["hola, la 3 no arranca", "Nada, gracias todo bien", "buenas, ¿abrís mañana?", "gracias", "10 euros", ""]) assert.equal(esSoloSaludo(t), false, t);
});

test("EL FALLO DEL 09/11: tras un «Hola», el asistente ya no ve la conversación anterior (ni en el siguiente mensaje)", async () => {
  let e = await conversacionDelBizum();
  const claude = claudeFalso(["¡Hola, Juanjo! 👋 ¿En qué te puedo ayudar?", "De nada. Un saludo 👋"]);
  e = await turno(e, "Hola", T0 + 2 * HORA, claude);                       // 2 h después: menos de 6 h, pero es un saludo
  e = await turno(e, "Nada, gracias todo bien", T0 + 2 * HORA + 10_000, claude);
  assert.doesNotMatch(lo_que_ve_claude(claude.peticiones[0]), /Bizum|cambio|10 euros/, "al saludar");
  assert.doesNotMatch(lo_que_ve_claude(claude.peticiones[1]), /Bizum|cambio|10 euros/, "en el mensaje siguiente");
  assert.match(lo_que_ve_claude(claude.peticiones[1]), /Hola/, "pero sí ve el saludo de esta conversación");
  assert.deepEqual(e.historial.map((m) => m.content), ["Hola", "¡Hola, Juanjo! 👋 ¿En qué te puedo ayudar?", "Nada, gracias todo bien", "De nada. Un saludo 👋"]);
});

test("dentro de la misma conversación (menos de 6 h y sin saludo) sí recuerda lo anterior", async () => {
  let e = await conversacionDelBizum();
  const claude = claudeFalso(["Es el 612 345 678, ¿verdad?"]);
  e = await turno(e, "mi teléfono es el 612345678", T0 + 3 * HORA, claude);
  assert.match(lo_que_ve_claude(claude.peticiones[0]), /no me ha dado el cambio en la 3/);
});

test("pasadas más de 6 h, conversación nueva aunque no salude", async () => {
  let e = await conversacionDelBizum();
  const claude = claudeFalso(["La lavadora L cuesta 8 €."]);
  e = await turno(e, "¿cuánto cuesta la lavadora grande?", T0 + 60_000 + CONVERSACION_NUEVA_MS + 1, claude);
  assert.doesNotMatch(lo_que_ve_claude(claude.peticiones[0]), /Bizum|cambio/);
  assert.equal(e.historial.length, 2);
});

test("memorias de antes del arreglo (sin la hora del último mensaje): se empieza de cero y se apunta la hora", async () => {
  const vieja = { historial: [{ role: "user", content: "lo del Bizum" }, { role: "assistant", content: "Te haremos un Bizum" }], pausa: null, avisos: [] };
  const claude = claudeFalso(["La lavadora L cuesta 8 €."]);
  const e = await turno(vieja, "¿cuánto cuesta la grande?", T0, claude);
  assert.doesNotMatch(lo_que_ve_claude(claude.peticiones[0]), /Bizum/);
  assert.equal(e.ultimo, T0);
});

test("los avisos al dueño de los últimos días se siguen recordando aunque la conversación sea nueva (no se repite un Bizum)", async () => {
  const e = { ...estadoInicial(), ultimo: T0, avisos: [{ clave: "bizum|612345678|2|3", cuando: T0, motivo: "bizum", maquina: "3", importe: "2 €", telefono: "612345678" }] };
  const claude = claudeFalso(["¡Hola!"]);
  await turno(e, "Hola", T0 + HORA, claude);
  const nota = claude.peticiones[0].messages.at(-1).content;
  assert.match(nota, /Avisos YA enviados/);
  assert.match(nota, /Bizum/);
});
