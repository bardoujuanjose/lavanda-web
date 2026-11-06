// Dos lavanderías a la vez: cada mensaje, página web y llamada va a SU lavandería, con SUS credenciales.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { atenderWhatsApp } from "../src/webhook.js";
import { atenderChatWeb } from "../src/web.js";
import { atenderVoz, paseLlamada } from "../src/voz.js";
import {
  registrarCliente, quitarCliente, idsDeClientes, obtenerCliente, entornoDe, nombreMemoria,
  buscarClientePorWhatsApp, buscarClientePorOrigen, buscarClientePorVoz,
} from "../src/clientes/index.js";
import { FICHA_LAVANDA } from "../src/clientes/lavanda.js";
import { PEPITO } from "./fixtures/pepito.js";

const ENV_BASE = {
  TWILIO_AUTH_TOKEN: "tok", WHATSAPP_APP_SECRET: "app",
  WHATSAPP_PHONE_ID: "111", WHATSAPP_TOKEN: "tokenLavanda", OWNER_PHONE: "600111222",
  WHATSAPP_PHONE_ID_PEPITO: "999", WHATSAPP_TOKEN_PEPITO: "tokenPepito", OWNER_PHONE_PEPITO: "677888999",
};
const CLIENTE = "34612345678";

// --- utilidades ---
function conversacionesFalsas() {
  const llamadas = [];
  return {
    llamadas,
    idFromName: (nombre) => nombre,
    get: (memoria) => ({
      recibir: async (m, cliente) => llamadas.push({ tipo: "recibir", memoria, de: m.de, cliente }),
      dueno: async (telefono, texto, cliente) => llamadas.push({ tipo: "dueno", memoria, telefono, texto, cliente }),
    }),
  };
}
async function avisoDeMeta(mensajes, env) {
  const porNumero = {};
  for (const m of mensajes) (porNumero[m.numeroId] ||= []).push({ id: m.id, from: m.de, type: "text", text: { body: m.texto } });
  const payload = { entry: [{ changes: Object.entries(porNumero).map(([numero, messages]) => ({
    field: "messages", value: { metadata: { phone_number_id: numero }, messages },
  })) }] };
  const cuerpo = JSON.stringify(payload);
  const firma = "sha256=" + createHmac("sha256", "app").update(cuerpo).digest("hex");
  return atenderWhatsApp(new Request("https://x.dev/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": firma }, body: cuerpo }), env);
}
const firmarTwilio = (url, params) =>
  createHmac("sha1", "tok").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
const llamadaTwilio = (url, params) => new Request(url, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": firmarTwilio(url, params) },
  body: new URLSearchParams(params).toString(),
});

// ---------------------------------------------------------------------
//  A partir de aquí hay DOS lavanderías
// ---------------------------------------------------------------------
registrarCliente({ ...FICHA_LAVANDA, numerosVoz: ["+34977000000"] });   // Lavanda necesita su número de voz al haber dos
registrarCliente(PEPITO);
after(() => { quitarCliente("pepito"); registrarCliente(FICHA_LAVANDA); });

test("WHATSAPP: cada mensaje va a la lavandería del número al que escriben, y la misma persona tiene una memoria en cada una", async () => {
  const conv = conversacionesFalsas();
  const r = await avisoDeMeta([
    { id: "m1", numeroId: "111", de: CLIENTE, texto: "hola Lavanda" },
    { id: "m2", numeroId: "999", de: CLIENTE, texto: "hola Pepito" },
  ], { ...ENV_BASE, CONVERSACIONES: conv });
  assert.equal(r.status, 200);
  assert.deepEqual(conv.llamadas, [
    { tipo: "recibir", memoria: CLIENTE, de: CLIENTE, cliente: "lavanda" },               // Lavanda: el teléfono a secas, como siempre
    { tipo: "recibir", memoria: `pepito:${CLIENTE}`, de: CLIENTE, cliente: "pepito" },    // Pepito: separada
  ]);
});

test("WHATSAPP: un mensaje a un número que no es de ninguna lavandería se ignora (nunca contesta otra)", async () => {
  const conv = conversacionesFalsas();
  await avisoDeMeta([{ id: "m1", numeroId: "555", de: CLIENTE, texto: "hola" }], { ...ENV_BASE, CONVERSACIONES: conv });
  assert.deepEqual(conv.llamadas, []);
});

test("WHATSAPP: cada dueño manda en SU número; el dueño de una lavandería es un cliente más en la otra", async () => {
  const conv = conversacionesFalsas();
  await avisoDeMeta([
    { id: "d1", numeroId: "999", de: "34677888999", texto: `#${CLIENTE} Ya lo hemos revisado` },   // dueño de Pepito, en el número de Pepito
    { id: "d3", numeroId: "999", de: "34600111222", texto: `#${CLIENTE} intento` },                // dueño de Lavanda, escribiendo al número de Pepito
    { id: "d2", numeroId: "111", de: "34677888999", texto: "hola" },                               // dueño de Pepito, escribiendo al número de Lavanda
  ], { ...ENV_BASE, CONVERSACIONES: conv });
  const porMemoria = (a, b) => a.memoria.localeCompare(b.memoria);   // el orden de llegada no importa
  assert.deepEqual([...conv.llamadas].sort(porMemoria), [
    // su comando funciona, y en la memoria de Pepito
    { tipo: "dueno", memoria: `pepito:${CLIENTE}`, telefono: CLIENTE, texto: "Ya lo hemos revisado", cliente: "pepito" },
    // en la otra lavandería no son dueños: son clientes normales (sus "#…" no mandan nada)
    { tipo: "recibir", memoria: "pepito:34600111222", de: "34600111222", cliente: "pepito" },
    { tipo: "recibir", memoria: "34677888999", de: "34677888999", cliente: "lavanda" },
  ].sort(porMemoria));
});

test("WHATSAPP: la ayuda del dueño sale con el token, el número y el nombre de SU lavandería", async () => {
  const peticiones = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, op) => { peticiones.push({ url: String(url), auth: op.headers.Authorization, cuerpo: JSON.parse(op.body) }); return new Response("{}", { status: 200 }); };
  try {
    await avisoDeMeta([{ id: "a1", numeroId: "999", de: "34677888999", texto: "ayuda" }], { ...ENV_BASE, CONVERSACIONES: conversacionesFalsas() });
    await avisoDeMeta([{ id: "a2", numeroId: "111", de: "34600111222", texto: "ayuda" }], { ...ENV_BASE, CONVERSACIONES: conversacionesFalsas() });
  } finally { globalThis.fetch = fetchOriginal; }
  assert.equal(peticiones.length, 2);
  assert.match(peticiones[0].url, /\/999\/messages$/);
  assert.equal(peticiones[0].auth, "Bearer tokenPepito");
  assert.equal(peticiones[0].cuerpo.to, "34677888999");
  assert.match(peticiones[0].cuerpo.text.body, /Asistente de Lavandería Pepito/);
  assert.match(peticiones[1].url, /\/111\/messages$/);
  assert.equal(peticiones[1].auth, "Bearer tokenLavanda");
  assert.match(peticiones[1].cuerpo.text.body, /Asistente de Lavanda: cómo usarlo/);
});

test("el entorno de cada lavandería trae SUS secretos, y la memoria sus nombres", () => {
  const l = obtenerCliente({}, "lavanda"), p = obtenerCliente({}, "pepito");
  assert.deepEqual(
    [entornoDe(ENV_BASE, l).WHATSAPP_PHONE_ID, entornoDe(ENV_BASE, l).WHATSAPP_TOKEN, entornoDe(ENV_BASE, l).OWNER_PHONE],
    ["111", "tokenLavanda", "600111222"]);
  assert.deepEqual(
    [entornoDe(ENV_BASE, p).WHATSAPP_PHONE_ID, entornoDe(ENV_BASE, p).WHATSAPP_TOKEN, entornoDe(ENV_BASE, p).OWNER_PHONE],
    ["999", "tokenPepito", "677888999"]);
  assert.equal(entornoDe(ENV_BASE, p).TWILIO_AUTH_TOKEN, "tok", "lo demás del entorno se conserva");
  assert.equal(nombreMemoria(l, CLIENTE), CLIENTE);
  assert.equal(nombreMemoria(p, CLIENTE), `pepito:${CLIENTE}`);
  assert.equal(buscarClientePorWhatsApp(ENV_BASE, "999").ficha.id, "pepito");
  assert.equal(buscarClientePorWhatsApp(ENV_BASE, "000"), null);
  assert.equal(buscarClientePorWhatsApp(ENV_BASE, ""), null);
});

test("WEB: cada página usa su lavandería; una página desconocida no se atiende", async () => {
  assert.equal(buscarClientePorOrigen({}, "https://pepitolava.es").ficha.id, "pepito");
  assert.equal(buscarClientePorOrigen({}, "https://lavandavendrell.es").ficha.id, "lavanda");
  assert.equal(buscarClientePorOrigen({}, "https://otra.es"), null);

  const llamar = (origen) => atenderChatWeb(new Request("https://x.dev/chat", {
    method: "OPTIONS", headers: { Origin: origen },
  }), {});
  const pepito = await llamar("https://pepitolava.es");
  assert.equal(pepito.status, 204);
  assert.equal(pepito.headers.get("Access-Control-Allow-Origin"), "https://pepitolava.es");
  const lavanda = await llamar("https://lavandavendrell.es");
  assert.equal(lavanda.headers.get("Access-Control-Allow-Origin"), "https://lavandavendrell.es");
  const desconocida = await llamar("https://otra.es");
  assert.equal(desconocida.status, 403);
  assert.equal(desconocida.headers.get("Access-Control-Allow-Origin"), null);
});

test("VOZ: la llamada va a la lavandería del número al que llaman, con su saludo y su dirección de vuelta", async () => {
  const pepito = await (await atenderVoz(llamadaTwilio("https://x.dev/voz", { CallSid: "CA1", From: "+34612345678", To: "+34977000111" }), ENV_BASE)).text();
  assert.match(pepito, /welcomeGreeting="¡Hola!… Soy el asistente virtual de Lavandería Pepito/);
  assert.match(pepito, /voz\/fin\?k=pepito"/);
  assert.match(pepito, /voz\/ws\?c=CA1&amp;k=pepito&amp;t=/);
  const lavanda = await (await atenderVoz(llamadaTwilio("https://x.dev/voz", { CallSid: "CA2", From: "+34612345678", To: "+34 977 000 000" }), ENV_BASE)).text();
  assert.match(lavanda, /asistente virtual de Lavanda\./);
  assert.match(lavanda, /voz\/fin\?k=lavanda"/);
});

test("VOZ: una llamada a un número desconocido no se atiende con los datos de otra lavandería", async () => {
  const t = await (await atenderVoz(llamadaTwilio("https://x.dev/voz", { CallSid: "CA3", From: "+34612345678", To: "+34900000000" }), ENV_BASE)).text();
  assert.match(t, /Este número no está disponible/);
  assert.match(t, /<Hangup\/>/);
  assert.doesNotMatch(t, /ConversationRelay|Lavanda|Pepito/);
});

test("VOZ: al pasar la llamada suena en el móvil del dueño de ESA lavandería", async () => {
  const pasar = JSON.stringify({ accion: "pasar", resumen: "Puerta" });
  const dePepito = await (await atenderVoz(llamadaTwilio("https://x.dev/voz/fin?k=pepito", { CallSid: "CA1", From: "+34612345678", HandoffData: pasar }), ENV_BASE)).text();
  assert.match(dePepito, /<Number>\+34677888999<\/Number>/);
  assert.doesNotMatch(dePepito, /600111222/);
  const deLavanda = await (await atenderVoz(llamadaTwilio("https://x.dev/voz/fin?k=lavanda", { CallSid: "CA1", From: "+34612345678", HandoffData: pasar }), ENV_BASE)).text();
  assert.match(deLavanda, /<Number>\+34600111222<\/Number>/);
  // y al volver "nadie contesta" también conserva la lavandería
  assert.match(dePepito, /tras-dial\?k=pepito&amp;r=Puerta/);
});

test("VOZ: la conexión en directo no se puede redirigir a otra lavandería", async () => {
  const ws = (k, pase) => atenderVoz(new Request(`https://x.dev/voz/ws?c=CA1&k=${k}&t=${pase}`, { headers: { Upgrade: "websocket" } }), ENV_BASE);
  const paseLavanda = await paseLlamada(ENV_BASE, "CA1", "", "lavanda");
  assert.equal((await ws("pepito", paseLavanda)).status, 403, "pase de Lavanda con la marca de Pepito");
  assert.equal((await ws("lavanda", "0".repeat(32))).status, 403);
  const paseInventada = await paseLlamada(ENV_BASE, "CA1", "", "inventada");
  assert.equal((await ws("inventada", paseInventada)).status, 403, "lavandería que no existe");
});
