import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { firmaValida, extraerMensajes, normalizarTelefono, clienteWhatsApp, ERROR_FUERA_DE_24H } from "../src/whatsapp.js";
import {
  procesarPendientes, aplicarResultado, comandoDueno, leerComandoDueno, estadoInicial, PAUSA_MAX_MS, HISTORIAL_MAX,
} from "../src/asistente-whatsapp.js";

const ENV = { OWNER_PHONE: "600111222", OWNER_TEMPLATE: "aviso_lavanda", OWNER_TEMPLATE_LANG: "es" };
const DUENO = "34600111222";
const CLIENTE = "34612345678";

// --- WhatsApp falso que apunta lo que se envía ---
function waFalso({ fallarTextoA = null, codigo = ERROR_FUERA_DE_24H } = {}) {
  const enviados = [];
  return {
    enviados,
    async enviarTexto(para, texto) {
      if (para === fallarTextoA) { const e = new Error("fuera de 24h"); e.code = codigo; throw e; }
      enviados.push({ tipo: "texto", para, texto });
    },
    async enviarPlantilla(para, nombre, idioma, params) { enviados.push({ tipo: "plantilla", para, nombre, idioma, params }); },
    async enviarImagen(para, id, pie) { enviados.push({ tipo: "imagen", para, id, pie }); },
    async marcarLeido() {},
    async descargarMedia() { return { bytes: new Uint8Array([1, 2, 3]).buffer, tipo: "image/jpeg" }; },
    async subirMedia() { return "media-nueva"; },
  };
}

// --- Claude falso que responde lo que le digamos, en orden ---
function claudeFalso(respuestas) {
  const peticiones = [];
  return {
    peticiones,
    beta: { messages: { create: async (p) => { peticiones.push(structuredClone(p)); return respuestas.shift(); } } },
  };
}
const texto = (t) => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: t }] });

test("normaliza teléfonos y lee comandos del dueño", () => {
  assert.equal(normalizarTelefono("612 345 678"), CLIENTE);
  assert.equal(normalizarTelefono("+34 612345678"), CLIENTE);
  assert.deepEqual(leerComandoDueno("#612345678 Hola, ya está"), { telefono: CLIENTE, texto: "Hola, ya está" });
  assert.deepEqual(leerComandoDueno("#34612345678 fin"), { telefono: CLIENTE, texto: "fin" });
  assert.equal(leerComandoDueno("hola"), null);
});

test("comprueba la firma de Meta", async () => {
  const cuerpo = new TextEncoder().encode('{"hola":"qué tal"}');
  const firma = "sha256=" + createHmac("sha256", "secreto").update(cuerpo).digest("hex");
  assert.equal(await firmaValida("secreto", cuerpo, firma), true);
  assert.equal(await firmaValida("otro", cuerpo, firma), false);
  assert.equal(await firmaValida("secreto", cuerpo, null), false);
  assert.equal(await firmaValida(undefined, cuerpo, firma), false);
});

test("extrae mensajes de texto, fotos y audios del aviso de Meta", () => {
  const payload = { entry: [{ changes: [{ field: "messages", value: {
    contacts: [{ wa_id: CLIENTE, profile: { name: "Ana" } }],
    messages: [
      { id: "m1", from: CLIENTE, type: "text", text: { body: "Hola" } },
      { id: "m2", from: CLIENTE, type: "image", image: { id: "img1", caption: "mira" } },
      { id: "m3", from: CLIENTE, type: "audio", audio: { id: "a1" } },
    ],
    statuses: [{ id: "x", status: "read" }],
  } }] }] };
  const m = extraerMensajes(payload);
  assert.equal(m.length, 3);
  assert.deepEqual(m[0], { id: "m1", de: CLIENTE, nombre: "Ana", tipo: "text", texto: "Hola", mediaId: null });
  assert.equal(m[1].mediaId, "img1");
  assert.equal(m[1].texto, "mira");
  assert.equal(m[2].tipo, "audio");
});

test("responde una pregunta normal y la recuerda", async () => {
  const wa = waFalso();
  const claude = claudeFalso([texto("La lavadora M cuesta 6 € 😊")]);
  const r = await procesarPendientes({
    estado: estadoInicial(), pendientes: [{ id: "1", tipo: "text", texto: "¿Cuánto cuesta lavar?" }],
    telefono: CLIENTE, nombre: "Ana", wa, claude, env: ENV,
  });
  assert.deepEqual(wa.enviados, [{ tipo: "texto", para: CLIENTE, texto: "La lavadora M cuesta 6 € 😊" }]);
  const p = claude.peticiones[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.equal(p.tools[0].name, "avisar_al_equipo");
  assert.match(p.system[0].text, /WhatsApp/);
  assert.equal(p.messages.at(-1).role, "system");
  assert.match(p.messages.at(-1).content, /Ana/);
  const estado = aplicarResultado(estadoInicial(), r);
  assert.deepEqual(estado.historial.map((m) => m.role), ["user", "assistant"]);
  assert.equal(estado.pausa, null);
});

test("junta varios mensajes seguidos en una sola respuesta", async () => {
  const wa = waFalso();
  const claude = claudeFalso([texto("¡Hola! Abrimos de 8 a 21 h.")]);
  await procesarPendientes({
    estado: estadoInicial(),
    pendientes: [{ id: "1", tipo: "text", texto: "Hola" }, { id: "2", tipo: "text", texto: "¿a qué hora abrís?" }],
    telefono: CLIENTE, nombre: "", wa, claude, env: ENV,
  });
  assert.equal(claude.peticiones.length, 1);
  assert.equal(claude.peticiones[0].messages.at(-2).content.length, 2);
  assert.equal(wa.enviados.length, 1);
});

test("incidencia: avisa al dueño, contesta al cliente y se pone en pausa", async () => {
  const wa = waFalso();
  const claude = claudeFalso([
    { stop_reason: "tool_use", content: [
      { type: "thinking", thinking: "" },
      { type: "tool_use", id: "t1", name: "avisar_al_equipo", input: { motivo: "incidencia", resumen: "Se ha quedado con 6 € a las 18:30", maquina: "3", bizum: "612345678" } },
    ] },
    texto("Ya he avisado al equipo. Una persona te escribirá por aquí en cuanto pueda 🙏"),
  ]);
  const r = await procesarPendientes({
    estado: estadoInicial(), pendientes: [{ id: "1", tipo: "text", texto: "la 3 se ha quedado con el dinero a las 18:30" }],
    telefono: CLIENTE, nombre: "Ana", wa, claude, env: ENV, ahora: 1000,
  });
  const aviso = wa.enviados.find((e) => e.para === DUENO);
  assert.match(aviso.texto, /Incidencia/);
  assert.match(aviso.texto, /Ana/);
  assert.match(aviso.texto, /Máquina: 3/);
  assert.match(aviso.texto, /#34612345678 tu mensaje/);
  assert.match(aviso.texto, /Bizum: 612345678/);
  assert.ok(wa.enviados.find((e) => e.para === CLIENTE && /avisado al equipo/.test(e.texto)));
  // segunda llamada a Claude: lleva la respuesta de la herramienta
  const ultimo = claude.peticiones[1].messages.at(-1);
  assert.equal(ultimo.content[0].type, "tool_result");
  assert.equal(ultimo.content[0].tool_use_id, "t1");
  assert.deepEqual(r.pausa, { desde: 1000, ultimoDueno: null, motivo: "incidencia" });
});

test("si pasaron más de 24 h, el aviso al dueño va por plantilla", async () => {
  const wa = waFalso({ fallarTextoA: DUENO });
  const claude = claudeFalso([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "avisar_al_equipo", input: { motivo: "hablar_con_persona", resumen: "Quiere\nhablar   con alguien", maquina: "" } }] },
    texto("Te paso con el equipo."),
  ]);
  await procesarPendientes({ estado: estadoInicial(), pendientes: [{ id: "1", tipo: "text", texto: "quiero hablar con una persona" }], telefono: CLIENTE, nombre: "Ana", wa, claude, env: ENV });
  const p = wa.enviados.find((e) => e.tipo === "plantilla");
  assert.equal(p.nombre, "aviso_lavanda");
  assert.equal(p.idioma, "es");
  assert.doesNotMatch(p.params[0], /\n/);
  assert.match(p.params[0], /Quiere hablar con alguien/);
});

test("si no se puede avisar al dueño, no se pone en pausa", async () => {
  const wa = waFalso({ fallarTextoA: DUENO, codigo: 100 });
  const claude = claudeFalso([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "avisar_al_equipo", input: { motivo: "incidencia", resumen: "x", maquina: "" } }] },
    texto("Perdona, llámanos al 689 81 02 13."),
  ]);
  const r = await procesarPendientes({ estado: estadoInicial(), pendientes: [{ id: "1", tipo: "text", texto: "no arranca" }], telefono: CLIENTE, nombre: "", wa, claude, env: ENV });
  assert.equal(r.pausa, undefined);
  assert.equal(claude.peticiones[1].messages.at(-1).content[0].is_error, true);
});

test("en pausa: no contesta y reenvía al dueño textos y fotos", async () => {
  const wa = waFalso();
  const claude = claudeFalso([]);
  const estado = { historial: [], pausa: { desde: 1000, ultimoDueno: null } };
  const r = await procesarPendientes({
    estado, pendientes: [{ id: "1", tipo: "text", texto: "¿Hay novedades?" }, { id: "2", tipo: "image", mediaId: "img", texto: "" }],
    telefono: CLIENTE, nombre: "Ana", wa, claude, env: ENV, ahora: 2000,
  });
  assert.equal(claude.peticiones.length, 0);
  assert.ok(wa.enviados.every((e) => e.para === DUENO));
  assert.match(wa.enviados[0].texto, /¿Hay novedades\?/);
  assert.equal(wa.enviados[1].tipo, "imagen");
  assert.equal(r.pausa, undefined);
});

test("la pausa caduca a las 12 h sin noticias del equipo", async () => {
  const wa = waFalso();
  const claude = claudeFalso([texto("¡Hola de nuevo!")]);
  const r = await procesarPendientes({
    estado: { historial: [], pausa: { desde: 0, ultimoDueno: null } }, pendientes: [{ id: "1", tipo: "text", texto: "hola" }],
    telefono: CLIENTE, nombre: "", wa, claude, env: ENV, ahora: PAUSA_MAX_MS + 1,
  });
  assert.equal(r.pausa, null);
  assert.equal(wa.enviados[0].para, CLIENTE);
});

test("fotos y audios llegan a Claude correctamente", async () => {
  const wa = waFalso();
  const claude = claudeFalso([texto("Veo el error E3 en la pantalla.")]);
  await procesarPendientes({
    estado: estadoInicial(),
    pendientes: [{ id: "1", tipo: "image", mediaId: "img", texto: "¿qué es esto?" }, { id: "2", tipo: "audio", texto: "" }],
    telefono: CLIENTE, nombre: "", wa, claude, env: ENV,
  });
  const bloques = claude.peticiones[0].messages.at(-2).content;
  assert.equal(bloques[0].type, "image");
  assert.equal(bloques[0].source.media_type, "image/jpeg");
  assert.equal(bloques[0].source.data, "AQID");
  assert.equal(bloques[1].text, "¿qué es esto?");
  assert.match(bloques[2].text, /audio/);
});

test("comandos del dueño: responder al cliente y devolver al asistente", async () => {
  const wa = waFalso();
  const estado = { historial: [], pausa: { desde: 1000, ultimoDueno: null, motivo: "incidencia" } };
  const r1 = await comandoDueno({ estado, telefono: CLIENTE, texto: "Hola Ana, mañana te devolvemos los 6 €", wa, env: ENV, ahora: 5000 });
  assert.deepEqual(wa.enviados[0], { tipo: "texto", para: CLIENTE, texto: "Hola Ana, mañana te devolvemos los 6 €" });
  assert.equal(r1.pausa.ultimoDueno, 5000);
  assert.match(r1.anadir[0].content, /equipo de Lavanda/);

  const r2 = await comandoDueno({ estado: aplicarResultado(estado, r1), telefono: CLIENTE, texto: "fin", wa, env: ENV });
  assert.equal(r2.pausa, null);
  assert.match(wa.enviados.at(-1).texto, /vuelve a atender/);
});

test("si el cliente escribió hace más de 24 h, se avisa al dueño", async () => {
  const wa = waFalso({ fallarTextoA: CLIENTE });
  const r = await comandoDueno({ estado: estadoInicial(), telefono: CLIENTE, texto: "Hola", wa, env: ENV });
  assert.equal(r.pausa, undefined);
  assert.match(wa.enviados[0].texto, /más de 24 h/);
});

test("la memoria se recorta y siempre empieza por el cliente", () => {
  let estado = estadoInicial();
  for (let i = 0; i < 40; i++) {
    estado = aplicarResultado(estado, { anadir: [{ role: "user", content: "p" + i }, { role: "assistant", content: "r" + i }], pausa: undefined });
  }
  assert.ok(estado.historial.length <= HISTORIAL_MAX);
  assert.equal(estado.historial[0].role, "user");
});

test("el cliente de WhatsApp construye bien las llamadas a Meta", async () => {
  const llamadas = [];
  const fetchFalso = async (url, op) => { llamadas.push({ url, op }); return new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 }); };
  const wa = clienteWhatsApp({ WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_ID: "123", GRAPH_VERSION: "v23.0" }, fetchFalso);
  await wa.enviarTexto(CLIENTE, "Hola");
  assert.equal(llamadas[0].url, "https://graph.facebook.com/v23.0/123/messages");
  assert.equal(llamadas[0].op.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(llamadas[0].op.body), {
    messaging_product: "whatsapp", recipient_type: "individual", to: CLIENTE, type: "text", text: { preview_url: false, body: "Hola" },
  });
  const fetchError = async () => new Response(JSON.stringify({ error: { message: "Re-engagement", code: 131047 } }), { status: 400 });
  await assert.rejects(clienteWhatsApp({ WHATSAPP_PHONE_ID: "1" }, fetchError).enviarTexto(CLIENTE, "x"), (e) => e.code === 131047);
});
