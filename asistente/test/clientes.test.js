import { test } from "node:test";
import assert from "node:assert/strict";
import { crearTextos } from "../src/negocio.js";
import { obtenerCliente, idsDeClientes } from "../src/clientes/index.js";
import { preguntarAClaude } from "../src/web.js";
import { procesarPendientes, textoAyudaDueno, comandoDueno } from "../src/asistente-whatsapp.js";
import { crearSesion } from "../src/voz.js";
import { PEPITO } from "./fixtures/pepito.js";

const clientePepito = { ficha: PEPITO, textos: crearTextos(PEPITO) };
const OTRA_LAVANDERIA = /689 810 213|El Vendrell|lavandavendrell|Baix Penedès|Lavanda\b/;

test("el registro devuelve Lavanda por defecto y da error si la lavandería no existe", () => {
  assert.deepEqual(idsDeClientes(), ["lavanda"]);
  assert.equal(obtenerCliente({}).ficha.id, "lavanda");
  assert.equal(obtenerCliente({}), obtenerCliente({}), "se monta una sola vez");
  assert.throws(() => obtenerCliente({}, "no-existe"), /No existe la lavandería/);
});

test("WEB: Claude recibe las instrucciones, la hora y la zona de la lavandería que toca", async () => {
  let peticion;
  const claude = { beta: { messages: { create: async (p) => { peticion = p; return { stop_reason: "end_turn", content: [{ type: "text", text: "Hola" }] }; } } } };
  await preguntarAClaude(claude, [{ role: "user", content: "hola" }], clientePepito);
  assert.match(peticion.system[0].text, /Lavandería Pepito/);
  assert.doesNotMatch(peticion.system[0].text, OTRA_LAVANDERIA);
  assert.match(peticion.messages.at(-1).content, /^Hora actual en Reus: /);
});

test("WHATSAPP: instrucciones, herramienta de aviso, hora y frase de error de la lavandería que toca", async () => {
  const peticiones = [];
  const enviados = [];
  const claude = { beta: { messages: { create: async (p) => { peticiones.push(p); return { stop_reason: "end_turn", content: [] }; } } } };
  const wa = { marcarLeido: async () => {}, enviarTexto: async (para, t) => enviados.push({ para, t }) };
  const r = await procesarPendientes({
    estado: { historial: [], pausa: null, avisos: [] },
    pendientes: [{ id: "m1", tipo: "text", texto: "hola" }],
    telefono: "34611111111", nombre: "Ana", wa, claude, env: {}, cliente: clientePepito,
  });
  assert.match(peticiones[0].system[0].text, /Lavandería Pepito/);
  assert.doesNotMatch(peticiones[0].system[0].text, OTRA_LAVANDERIA);
  assert.match(peticiones[0].tools[0].description, /equipo de Lavandería Pepito/);
  assert.match(peticiones[0].messages.at(-1).content, /^Hora actual en Reus: /);
  // Claude no contesta nada: se usa la frase de error de ESA lavandería
  assert.match(enviados[0].t, /977 000 111, de 7:00 a 22:00/);
  assert.doesNotMatch(enviados[0].t, /689/);
  assert.equal(r.anadir.at(-1).content, enviados[0].t);
});

test("WHATSAPP: la ayuda y los mensajes del equipo llevan el nombre de la lavandería", async () => {
  const ayuda = textoAyudaDueno(clientePepito);
  assert.match(ayuda, /Asistente de Lavandería Pepito/);
  assert.match(ayuda, /número de Lavandería Pepito/);
  assert.doesNotMatch(ayuda, /Lavanda\b/);
  assert.match(textoAyudaDueno(), /Asistente de Lavanda: cómo usarlo/);   // sin ficha: Lavanda, como siempre

  const wa = { enviarTexto: async () => {} };
  const r = await comandoDueno({ estado: {}, telefono: "34611111111", texto: "Ya lo hemos revisado", wa, env: { OWNER_PHONE: "34600000000" }, cliente: clientePepito });
  assert.equal(r.anadir[0].content, "[Mensaje del equipo de Lavandería Pepito] Ya lo hemos revisado");
});

test("VOZ: la llamada usa las instrucciones, el saludo y las herramientas de la lavandería que toca", async () => {
  const precargas = [];
  const claude = { beta: { messages: { create: async (p) => { precargas.push(p); return { content: [], stop_reason: "max_tokens", usage: {} }; } } } };
  const s = crearSesion({ env: {}, claude, wa: {}, enviar: () => {}, cliente: clientePepito });
  await s.recibir(JSON.stringify({ type: "setup", from: "+34612345678" }));
  await new Promise((r) => setTimeout(r, 5));
  const texto = precargas[0].system[0].text;
  assert.match(texto, /Lavandería Pepito/);
  assert.match(texto, /Soy el asistente virtual de Lavandería Pepito/);
  assert.doesNotMatch(texto, OTRA_LAVANDERIA);
  assert.match(precargas[0].tools.find((t) => t.name === "pasar_llamada").description, /equipo de Lavandería Pepito/);
});
