import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { firmaTwilioValida, paseLlamada, crearSesion, atenderVoz, saludoConAviso } from "../src/voz.js";

const ENV = { TWILIO_AUTH_TOKEN: "tok", OWNER_PHONE: "600111222" };

function firmar(url, params) {
  const base = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", "tok").update(base).digest("base64");
}
function peticion(url, params) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": firmar(url, params) },
    body: new URLSearchParams(params).toString(),
  });
}

test("comprueba la firma de Twilio", async () => {
  const p = { CallSid: "CA1", From: "+34612345678" };
  assert.equal(await firmaTwilioValida("tok", "https://x/voz", p, firmar("https://x/voz", p)), true);
  assert.equal(await firmaTwilioValida("otro", "https://x/voz", p, firmar("https://x/voz", p)), false);
});

test("una llamada nueva conecta con el asistente (voz de mujer, español)", async () => {
  const r = await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA1", From: "+34612345678" }), ENV);
  const t = await r.text();
  // la lavandería (k) viaja en la conexión en directo y en la dirección a la que Twilio vuelve al terminar
  assert.match(t, /<Connect action="https:\/\/x.dev\/voz\/fin\?k=lavanda">/);
  assert.match(t, /<ConversationRelay url="wss:\/\/x.dev\/voz\/ws\?c=CA1&amp;k=lavanda&amp;t=[0-9a-f]{32}"/);
  assert.match(t, /language="es-ES"/);
  assert.match(t, /voice="Lucia-Neural"/);
  assert.match(t, /welcomeGreeting="¡Hola!… Soy el asistente virtual de Lavanda/);
  assert.match(t, /welcomeGreetingInterruptible="none"/);
  const mala = new Request("https://x.dev/voz", { method: "POST", headers: { "X-Twilio-Signature": "x" }, body: "CallSid=CA1" });
  assert.equal((await atenderVoz(mala, ENV)).status, 403);
});

test("aviso de pruebas: se añade al saludo, justo antes de la pregunta final, y sin aviso queda igual", async () => {
  const saludo = "¡Hola!… Soy el asistente virtual de Lavanda. ¿En qué puedo ayudarte?";
  assert.equal(saludoConAviso(saludo, ""), saludo);
  assert.equal(saludoConAviso(saludo, undefined), saludo);
  assert.equal(
    saludoConAviso(saludo, "Estoy en pruebas, así que disculpa si algo no sale bien."),
    "¡Hola!… Soy el asistente virtual de Lavanda. Estoy en pruebas, así que disculpa si algo no sale bien. ¿En qué puedo ayudarte?",
  );
  const r = await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA1", From: "+34612345678" }), { ...ENV, VOZ_AVISO_PRUEBAS: "Estoy en pruebas." });
  assert.match(await r.text(), /welcomeGreeting="¡Hola!… Soy el asistente virtual de Lavanda\. Estoy en pruebas\. ¿En qué puedo ayudarte\?"/);
});

test("al pasar la llamada suena en el móvil del dueño, y si no contesta se le avisa", async () => {
  const r = await atenderVoz(peticion("https://x.dev/voz/fin", { CallSid: "CA1", From: "+34612345678", To: "+34977000000", HandoffData: JSON.stringify({ accion: "pasar", resumen: "Puerta 3 no abre" }) }), ENV);
  const t = await r.text();
  assert.match(t, /<Play>https:\/\/x.dev\/audio\/pasar.mp3<\/Play>/);
  assert.match(t, /<Dial timeout="25" callerId="\+34612345678"/);
  assert.match(t, /<Number>\+34600111222<\/Number>/);
  const sin = await (await atenderVoz(peticion("https://x.dev/voz/fin", { CallSid: "CA1", From: "+34612345678" }), ENV)).text();
  assert.match(sin, /<Hangup\/>/);
  const tareas = [];
  const r2 = await atenderVoz(peticion("https://x.dev/voz/tras-dial?r=Puerta", { DialCallStatus: "no-answer", From: "+34612345678" }), { ...ENV, WHATSAPP_TOKEN: "" }, { waitUntil: (p) => tareas.push(p) });
  assert.match(await r2.text(), /<Play>https:\/\/x.dev\/audio\/no-contesta.mp3<\/Play>/);
  assert.equal(tareas.length, 1);
});

test("el WebSocket exige el pase de la llamada", async () => {
  const pase = await paseLlamada(ENV, "CA1");
  const mal = new Request("https://x.dev/voz/ws?c=CA1&t=000", { headers: { Upgrade: "websocket" } });
  assert.equal((await atenderVoz(mal, ENV)).status, 403);
  assert.equal(pase.length, 32);
});

// --- Conversación ---
function streamFalso(respuesta) {
  const oyentes = {};
  return {
    on(ev, cb) { oyentes[ev] = cb; return this; },
    abort() { this.abortado = true; },
    async finalMessage() {
      for (const b of respuesta.content) if (b.type === "text") for (const trozo of b.text.match(/.{1,5}/g)) oyentes.text?.(trozo);
      return respuesta;
    },
  };
}
function claudeFalso(respuestas) {
  const peticiones = [];
  const precargas = [];
  return { peticiones, precargas, beta: { messages: {
    stream: (p) => { peticiones.push(structuredClone(p)); return streamFalso(respuestas.shift()); },
    create: async (p) => { precargas.push(structuredClone(p)); return { content: [], stop_reason: "max_tokens", usage: { cache_creation_input_tokens: 7000 } }; },
  } } };
}
const texto = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

test("responde por voz en trozos y recuerda la conversación", async () => {
  const enviados = [];
  const claude = claudeFalso([texto("La lavadora M cuesta seis euros."), texto("De nada, hasta pronto.")]);
  const s = crearSesion({ env: ENV, claude, wa: {}, enviar: (o) => enviados.push(o) });
  await s.recibir(JSON.stringify({ type: "setup", from: "+34612345678", callSid: "CA1" }));
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "¿Cuánto cuesta la lavadora pequeña?", last: true }));
  const dicho = enviados.filter((e) => e.type === "text").map((e) => e.token).join("");
  assert.equal(dicho, "La lavadora M cuesta seis euros.");
  assert.equal(enviados.at(-1).last, true);
  assert.match(claude.peticiones[0].messages.at(-1).content, /acaba en 6 7 8/);
  assert.match(claude.peticiones[0].system[0].text, /LLAMADA DE TELÉFONO/);
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "Gracias", last: true }));
  assert.deepEqual(claude.peticiones[1].messages.slice(0, 3).map((m) => m.role), ["user", "assistant", "user"]);
});

test("pasar_llamada termina la sesión con los datos para pasarla", async () => {
  const enviados = [];
  const claude = claudeFalso([{ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "pasar_llamada", input: { resumen: "La puerta de la 3 no abre" } }] }]);
  const s = crearSesion({ env: ENV, claude, wa: {}, enviar: (o) => enviados.push(o) });
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "no se abre la puerta de la 3", last: true }));
  const fin = enviados.find((e) => e.type === "end");
  assert.deepEqual(JSON.parse(fin.handoffData), { accion: "pasar", resumen: "La puerta de la 3 no abre" });
});

test("el aviso de Bizum se envía una sola vez por llamada", async () => {
  const enviadosWa = [];
  const wa = { enviarTexto: async (para, t) => enviadosWa.push({ para, t }) };
  const usar = () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + Math.random(), name: "avisar_al_equipo", input: { motivo: "bizum", resumen: "Cambio", maquina: "3", importe: "12 €", telefono: "612345678" } }] });
  const claude = claudeFalso([usar(), texto("Anotado."), usar(), texto("De nada.")]);
  const s = crearSesion({ env: ENV, claude, wa, enviar: () => {} });
  await s.recibir(JSON.stringify({ type: "setup", from: "+34612345678" }));
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "sí, a este número", last: true }));
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "gracias", last: true }));
  assert.equal(enviadosWa.length, 1);
  assert.match(enviadosWa[0].t, /Bizum pendiente/);
  assert.match(enviadosWa[0].t, /Llamada/);
});

test("si el cliente interrumpe, se corta la respuesta", async () => {
  const enviados = [];
  let liberar;
  const lento = { on(ev, cb) { this.cb = cb; return this; }, abort() { this.abortado = true; liberar(); }, finalMessage() { this.cb("Hola, la lav"); return new Promise((r) => { liberar = () => r(texto("Hola, la lavadora...")); }); } };
  const claude = { beta: { messages: { stream: () => lento } } };
  const s = crearSesion({ env: ENV, claude, wa: {}, enviar: (o) => enviados.push(o) });
  const p = s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "precio", last: true }));
  await new Promise((r) => setTimeout(r, 5));
  await s.recibir(JSON.stringify({ type: "interrupt", utteranceUntilInterrupt: "Hola, la" }));
  await p;
  assert.equal(lento.abortado, true);
  assert.ok(!enviados.some((e) => e.last === true));
  assert.match(s.historial.at(-1).content, /Hola, la \[interrumpido\]/);
});

test("en la prueba desde el navegador no intenta pasar la llamada", async () => {
  const r = await atenderVoz(peticion("https://x.dev/voz/fin", { CallSid: "CA1", From: "client:prueba-lavanda", HandoffData: JSON.stringify({ accion: "pasar", resumen: "x" }) }), ENV);
  const t = await r.text();
  assert.match(t, /Aquí te pasaría con un compañero/);
  assert.doesNotMatch(t, /<Dial/);
});

test("la memoria entre turnos es solo texto y nunca se modifica lo ya enviado", async () => {
  const claude = claudeFalso([
    { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "Te corresponden cuatro euros. ¿Cuál es tu teléfono?" }] },
    { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "y" }, { type: "tool_use", id: "t1", name: "avisar_al_equipo", input: { motivo: "bizum", resumen: "c", maquina: "1", importe: "4 €", telefono: "611111111" } }] },
    texto("Gracias, anotado."),
  ]);
  const wa = { enviarTexto: async () => {} };
  const s = crearSesion({ env: ENV, claude, wa, enviar: () => {} });
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "he puesto 10 euros en la 1 y no me ha dado cambio", last: true }));
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "611111111", last: true }));
  // 2ª petición: el turno anterior del asistente va como texto, sin bloques de razonamiento
  const p2 = claude.peticiones[1].messages;
  assert.equal(typeof p2[1].content, "string");
  assert.deepEqual(p2.map((m) => m.role), ["user", "assistant", "user", "system"]);
  // 3ª petición (tras la herramienta): lo enviado en la 2ª se mantiene igual y solo se añade al final
  const p3 = claude.peticiones[2].messages;
  assert.deepEqual(p3.slice(0, p2.length), p2);
  assert.deepEqual(p3.slice(p2.length).map((m) => m.role), ["assistant", "user"]);
  assert.deepEqual(s.historial.map((m) => typeof m.content), ["string", "string", "string", "string"]);
});

test("las llamadas usan Sonnet 5.5 sin razonamiento previo", async () => {
  const claude = claudeFalso([texto("Seis euros.")]);
  const s = crearSesion({ env: ENV, claude, wa: {}, enviar: () => {} });
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "precio", last: true }));
  const p = claude.peticiones[0];
  assert.equal(p.model, "claude-sonnet-5-5");
  assert.deepEqual(p.thinking, { type: "between_tools" });
  assert.equal(p.output_config.effort, "low");
  assert.equal(p.fallbacks, "default");
});

test("al empezar la llamada precarga las normas con los mismos ajustes que las respuestas", async () => {
  const claude = claudeFalso([texto("Seis euros.")]);
  const s = crearSesion({ env: ENV, claude, wa: {}, enviar: () => {} });
  await s.recibir(JSON.stringify({ type: "setup", from: "+34612345678" }));
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "precio", last: true }));
  const pre = claude.precargas[0];
  const real = claude.peticiones[0];
  assert.equal(pre.max_tokens, 0);
  assert.equal(pre.stream, undefined);
  for (const k of ["model", "thinking", "output_config", "system", "tools"]) assert.deepEqual(pre[k], real[k], k);
});

test("la llamada de prueba puede simular el número del cliente", async () => {
  const r = await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA9", From: "client:prueba-lavanda", TelefonoPrueba: "612 345 678" }), ENV);
  const t = await r.text();
  assert.match(t, /c=CA9&amp;k=lavanda&amp;n=34612345678&amp;t=/);
  // un número cambiado a mano invalida el pase
  const pase = await paseLlamada(ENV, "CA9", "34612345678");
  assert.notEqual(pase, await paseLlamada(ENV, "CA9", "34699999999"));
  // y también cambiar la lavandería a mano
  assert.notEqual(await paseLlamada(ENV, "CA9", "34612345678", "pepito"), await paseLlamada(ENV, "CA9", "34612345678", "lavanda"));
  // la sesión usa ese número como si fuera el del llamante
  const claude = claudeFalso([texto("Vale.")]);
  const s = crearSesion({ env: ENV, claude, wa: {}, enviar: () => {}, numeroPrueba: "34612345678" });
  await s.recibir(JSON.stringify({ type: "setup", from: "client:prueba-lavanda" }));
  await s.recibir(JSON.stringify({ type: "prompt", voicePrompt: "hola", last: true }));
  assert.match(claude.peticiones[0].messages.at(-1).content, /llama desde el \+34612345678/);
});

test("en las llamadas de prueba se puede elegir otra voz, solo de la lista", async () => {
  const t = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA7", From: "client:prueba-lavanda", VozPrueba: "Google|es-ES-Chirp3-HD-Aoede" }), ENV)).text();
  assert.match(t, /ttsProvider="Google"/);
  assert.match(t, /voice="es-ES-Chirp3-HD-Aoede"/);
  const t2 = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA8", From: "client:prueba-lavanda", VozPrueba: "ElevenLabs|" }), ENV)).text();
  assert.match(t2, /ttsProvider="ElevenLabs"/);
  assert.doesNotMatch(t2, /voice=/);
  const t3 = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA6", From: "+34612345678", VozPrueba: "Google|es-ES-Chirp3-HD-Aoede" }), ENV)).text();
  assert.match(t3, /ttsProvider="Amazon"/);
});

test("se puede probar cualquier voz de ElevenLabs por su ID", async () => {
  const t = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA5", From: "client:prueba-lavanda", VozPrueba: "ElevenLabs|AbCdEfGhIjKlMnOpQrSt" }), ENV)).text();
  assert.match(t, /ttsProvider="ElevenLabs"/);
  assert.match(t, /voice="AbCdEfGhIjKlMnOpQrSt"/);
  const malo = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CA4", From: "client:prueba-lavanda", VozPrueba: "ElevenLabs|<script>" }), ENV)).text();
  assert.match(malo, /ttsProvider="Amazon"/);
});

test("en las pruebas se puede ajustar la velocidad de la voz de ElevenLabs", async () => {
  const env = { ...ENV, VOZ_TTS_PROVIDER: "ElevenLabs", VOZ_VOZ: "2BJPFS2QZRUEpfkbclGy" };
  const t = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CB1", From: "client:prueba-lavanda", VelocidadPrueba: "0.9" }), env)).text();
  assert.match(t, /voice="2BJPFS2QZRUEpfkbclGy-flash_v2_5-0.9_0.5_0.75"/);
  const t2 = await (await atenderVoz(peticion("https://x.dev/voz", { CallSid: "CB2", From: "client:prueba-lavanda", VelocidadPrueba: "3" }), env)).text();
  assert.match(t2, /voice="2BJPFS2QZRUEpfkbclGy"/);
});
