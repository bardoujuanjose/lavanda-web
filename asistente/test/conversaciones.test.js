// Página de conversaciones (/admin/conversaciones) y registro de transcripciones
import { test } from "node:test";
import assert from "node:assert/strict";
import { atenderAdmin } from "../src/admin.js";
import { olvidarCache } from "../src/clientes/index.js";
import {
  entradasDe, anadirTranscripcion, lineaIndice, desdeHistorial, TRANSCRIPCION_MAX, RETENCION_MS,
} from "../src/transcripciones.js";

const EQUIPO = "[Mensaje del equipo de Lavanda]";

test("cada mensaje se apunta con quién lo dijo: cliente, asistente, equipo y avisos", () => {
  const e = entradasDe({
    anadir: [
      { role: "user", content: "La lavadora 3 no centrifuga" },
      { role: "assistant", content: "Vaya, lo siento. ¿Me dices tu teléfono?" },
      { role: "assistant", content: EQUIPO + " Ya lo miro yo, Juanjo" },
    ],
    avisos: [{ motivo: "devolucion", cuando: 5, maquina: "3" }],
  }, { ahora: 1000, etiquetaEquipo: EQUIPO, describirAviso: (a) => "Aviso: " + a.motivo });
  assert.deepEqual(e, [
    { cuando: 1000, quien: "cliente", texto: "La lavadora 3 no centrifuga" },
    { cuando: 1000, quien: "asistente", texto: "Vaya, lo siento. ¿Me dices tu teléfono?" },
    { cuando: 1000, quien: "equipo", texto: "Ya lo miro yo, Juanjo" },
    { cuando: 5, quien: "aviso", texto: "Aviso: devolucion" },
  ]);
});

test("el registro se recorta: como mucho TRANSCRIPCION_MAX mensajes y nada de hace más de un año", () => {
  const ahora = RETENCION_MS * 3;
  const viejos = [{ cuando: ahora - RETENCION_MS - 1, quien: "cliente", texto: "viejo" }];
  const muchos = Array.from({ length: TRANSCRIPCION_MAX + 10 }, (_, i) => ({ cuando: ahora, quien: "cliente", texto: "m" + i }));
  const r = anadirTranscripcion(viejos, muchos, ahora);
  assert.equal(r.length, TRANSCRIPCION_MAX);
  assert.equal(r[0].texto, "m10");
  assert.ok(!r.some((x) => x.texto === "viejo"));
  // textos larguísimos se recortan
  const largo = entradasDe({ anadir: [{ role: "user", content: "x".repeat(10_000) }] });
  assert.ok(largo[0].texto.length <= 4000);
});

test("la línea del índice resume el último mensaje (no un aviso) y si la atiende el equipo", () => {
  const l = lineaIndice({
    memoria: "34612345678", cliente: "lavanda", telefono: "34612345678", nombre: "Ana",
    transcripcion: [
      { cuando: 1, quien: "cliente", texto: "hola\n¿abrís mañana?" },
      { cuando: 2, quien: "asistente", texto: "Sí, de 8:00 a 21:00" },
      { cuando: 3, quien: "aviso", texto: "Aviso" },
    ],
    pausa: { desde: 1 },
  });
  assert.deepEqual(l, {
    memoria: "34612345678", cliente: "lavanda", telefono: "34612345678", nombre: "Ana",
    ultimo: 2, quien: "asistente", resumen: "Sí, de 8:00 a 21:00", mensajes: 3, avisos: 1, equipo: true,
  });
});

test("conversaciones de antes del registro: se enseña la memoria sin fecha", () => {
  const e = desdeHistorial([{ role: "user", content: "hola" }, { role: "assistant", content: EQUIPO + " dime" }], EQUIPO);
  assert.deepEqual(e, [{ cuando: 0, quien: "cliente", texto: "hola" }, { cuando: 0, quien: "equipo", texto: "dime" }]);
});

// ---------------------------------------------------------------------
//  Panel: acciones "conversaciones" y "conversacion"
// ---------------------------------------------------------------------
function entorno() {
  const indice = [
    { memoria: "34600000001", cliente: "lavanda", telefono: "34600000001", nombre: "Viejo", ultimo: 100 },
    { memoria: "34600000002", cliente: "lavanda", telefono: "34600000002", nombre: "Nuevo", ultimo: 200 },
  ];
  const memorias = {
    "34612345678": { telefono: "34612345678", nombre: "Ana", cliente: "lavanda", equipo: false, antigua: false,
      transcripcion: [{ cuando: 1, quien: "cliente", texto: "<script>hola</script>" }] },
  };
  const pedidas = [];
  const registro = {
    listar: async () => [], leer: async () => null,
    listarConversaciones: async () => structuredClone(indice),
  };
  return {
    pedidas,
    env: {
      ADMIN_CLAVE: "clave-del-panel", WHATSAPP_PHONE_ID: "111", WHATSAPP_TOKEN: "t", OWNER_PHONE: "600111222",
      REGISTRO: { idFromName: (n) => n, get: () => registro },
      CONVERSACIONES: { idFromName: (n) => n, get: (memoria) => ({
        leerConversacion: async () => { pedidas.push(memoria); return memorias[memoria] || { telefono: "", nombre: "", cliente: "", equipo: false, antigua: false, transcripcion: [] }; },
      }) },
    },
  };
}
async function panel(env, accion, datos = {}, clave = "clave-del-panel") {
  olvidarCache();
  const r = await atenderAdmin(new Request("https://x.dev/admin/api", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Clave": clave, "CF-Connecting-IP": "5.5.5.5" },
    body: JSON.stringify({ accion, ...datos }),
  }), env);
  return { estado: r.status, ...(await r.json()) };
}

test("la lista sale ordenada, la más reciente primero, con el nombre de la lavandería", async () => {
  const { env } = entorno();
  const r = await panel(env, "conversaciones");
  assert.equal(r.estado, 200);
  assert.deepEqual(r.conversaciones.map((c) => c.nombre), ["Nuevo", "Viejo"]);
  assert.equal(r.conversaciones[0].lavanderia, "Lavanda");
});

test("abrir una conversación: con el teléfono escrito de cualquier forma, y sin contraseña no", async () => {
  const { env, pedidas } = entorno();
  const r = await panel(env, "conversacion", { cliente: "lavanda", telefono: "612 34 56 78" });
  assert.equal(r.estado, 200);
  assert.deepEqual(pedidas, ["34612345678"], "Lavanda guarda la memoria con el teléfono tal cual (sin prefijo)");
  assert.equal(r.conversacion.transcripcion[0].texto, "<script>hola</script>", "el texto llega tal cual; la página lo pinta como texto");

  assert.equal((await panel(env, "conversacion", { cliente: "lavanda", telefono: "34699999999" })).estado, 404);
  assert.equal((await panel(env, "conversacion", { cliente: "lavanda", telefono: "abc" })).estado, 422);
  assert.equal((await panel(env, "conversacion", { cliente: "no-existe", telefono: "612345678" })).estado, 404);
  assert.equal((await panel(env, "conversaciones", {}, "mala")).estado, 401);
});

test("la página de conversaciones no se incrusta, no se indexa, no pinta HTML de los clientes y su JavaScript no tiene errores", async () => {
  const { env } = entorno();
  const r = await atenderAdmin(new Request("https://x.dev/admin/conversaciones"), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Frame-Options"), "DENY");
  const html = await r.text();
  assert.match(html, /noindex/);
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(js), "el JavaScript de la página tiene un error de sintaxis");
  assert.doesNotMatch(js, /innerHTML/, "los mensajes de los clientes nunca se pintan como HTML");
  assert.match(js, /replace\(\/\\D\/g/, "las barras de las expresiones regulares llegan bien a la página");
});
