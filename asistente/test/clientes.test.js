import { test } from "node:test";
import assert from "node:assert/strict";
import { crearTextos } from "../src/negocio.js";
import { obtenerCliente, idsDeClientes } from "../src/clientes/index.js";
import { preguntarAClaude } from "../src/web.js";
import { procesarPendientes, textoAyudaDueno, comandoDueno, avisarDueno } from "../src/asistente-whatsapp.js";
import { ERROR_FUERA_DE_24H } from "../src/whatsapp.js";
import { crearSesion } from "../src/voz.js";
import { PEPITO } from "./fixtures/pepito.js";
import { atenderWhatsApp } from "../src/webhook.js";
import { atenderChatWeb } from "../src/web.js";
import { buscarClientePorVoz, buscarClientePorOrigen } from "../src/clientes/index.js";
import { createHmac } from "node:crypto";

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

test("con UNA sola lavandería (como hoy en producción) se atiende aunque el número no coincida: no se corta nada por un fallo de configuración", async () => {
  assert.deepEqual(idsDeClientes(), ["lavanda"]);
  const llamadas = [];
  const CONVERSACIONES = {
    idFromName: (n) => n,
    get: (memoria) => ({ recibir: async (m, cliente) => llamadas.push({ memoria, de: m.de, cliente }) }),
  };
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "numero-que-no-conozco" },
    messages: [{ id: "m1", from: "34612345678", type: "text", text: { body: "hola" } }],
  } }] }] });
  const firma = "sha256=" + createHmac("sha256", "app").update(cuerpo).digest("hex");
  await atenderWhatsApp(new Request("https://x.dev/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": firma }, body: cuerpo }),
    { WHATSAPP_APP_SECRET: "app", CONVERSACIONES });
  // la memoria de Lavanda sigue siendo el teléfono a secas: no se pierden las conversaciones que ya existen
  assert.deepEqual(llamadas, [{ memoria: "34612345678", de: "34612345678", cliente: "lavanda" }]);

  assert.equal(buscarClientePorVoz({}, "+34999999999").ficha.id, "lavanda");
  assert.equal(buscarClientePorOrigen({}, "https://cualquiera.es").ficha.id, "lavanda");
  const web = await atenderChatWeb(new Request("https://x.dev/chat", { method: "OPTIONS", headers: { Origin: "https://lavandavendrell.es" } }), {});
  assert.equal(web.status, 204);
});

test("AVISOS AL DUEÑO: fuera de las 24 h se usa la plantilla de SU cuenta de WhatsApp, y los motivos de SU ficha", async () => {
  const llamadas = [];
  const wa = {
    enviarTexto: async () => { const e = new Error("fuera de 24 h"); e.code = ERROR_FUERA_DE_24H; throw e; },
    enviarPlantilla: async (para, nombre, idioma, parametros) => llamadas.push({ para, nombre, idioma, linea: parametros[0] }),
  };
  const datos = { telefono: "34611111111", nombre: "Ana", resumen: "Cobrada y no arranca", maquina: "2", importe: "6 €", telefonoCliente: "" };
  await avisarDueno({ ...datos, motivo: "devolucion", env: { OWNER_PHONE: "677888999" }, wa, cliente: clientePepito });
  await avisarDueno({ ...datos, motivo: "bizum", env: { OWNER_PHONE: "600111222", OWNER_TEMPLATE: "aviso_lavanda" }, wa });   // Lavanda, como siempre
  assert.deepEqual(llamadas.map((l) => [l.para, l.nombre, l.idioma]), [["34677888999", "aviso_pepito", "es"], ["34600111222", "aviso_lavanda", "es"]]);
  assert.match(llamadas[0].linea, /Devolución a la tarjeta/);
  assert.match(llamadas[1].linea, /Bizum pendiente de verificar/);
});
