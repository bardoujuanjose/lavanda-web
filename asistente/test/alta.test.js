// Alta de WhatsApp por el dueño (registro integrado de Meta) y mensajes del dueño desde la app
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { atenderAlta, crearInvitacion, leerInvitacion, comprobarConexion } from "../src/alta.js";
import { atenderAdmin } from "../src/admin.js";
import { atenderWhatsApp } from "../src/webhook.js";
import { extraerEcos } from "../src/whatsapp.js";
import { ecoDelDueno, procesarPendientes, estadoInicial } from "../src/asistente-whatsapp.js";
import { descifrar } from "../src/cifrado.js";
import { crearTextos } from "../src/negocio.js";
import { PEPITO } from "./fixtures/pepito.js";

const { secretos, prefijoMemoria, ...PEPITO_BD } = PEPITO;
const WABA = "524126980791429", PHONE = "106540352242922";

function registroFalso() {
  const datos = new Map();
  const copia = (x) => (x == null ? x : structuredClone(x));
  const stub = {
    listar: async () => [...datos.values()].map(copia),
    leer: async (id) => copia(datos.get(id) ?? null),
    guardar: async (f) => { datos.set(f.id, copia(f)); return true; },
    borrar: async (id) => datos.delete(id),
  };
  return { datos, idFromName: (n) => n, get: () => stub };
}
function entorno() {
  const REGISTRO = registroFalso();
  REGISTRO.datos.set("pepito", { ...structuredClone(PEPITO_BD), activa: false, conexion: { dueno: "34677888999" } });
  return {
    REGISTRO, CLAVE_CIFRADO: "una-clave-de-cifrado-bien-larga", META_APP_ID: "21202248997039", META_CONFIG_ID: "cfg123",
    WHATSAPP_APP_SECRET: "secreto-de-la-app", GRAPH_VERSION: "v27.0", ADMIN_CLAVE: "clave",
    WHATSAPP_PHONE_ID: "111", WHATSAPP_TOKEN: "tokenLavanda", OWNER_PHONE: "600111222",
  };
}

// Meta de mentira: responde según la dirección y apunta cada llamada
function metaFalsa({ numeros = [{ id: PHONE, display_phone_number: "+34 977 000 111", verified_name: "Lavandería Pepito" }], falla = {} } = {}) {
  const llamadas = [];
  const fetchImpl = async (url, op = {}) => {
    const u = new URL(url);
    const llamada = { metodo: op.method || "GET", ruta: u.pathname, query: Object.fromEntries(u.searchParams), auth: op.headers?.Authorization, cuerpo: op.body ? JSON.parse(op.body) : null };
    llamadas.push(llamada);
    const clave = Object.keys(falla).find((k) => u.pathname.endsWith(k));
    if (clave) return new Response(JSON.stringify({ error: { message: falla[clave], code: 100 } }), { status: 400 });
    if (u.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: "tokNuevo", token_type: "bearer" });
    if (u.pathname.endsWith(`/${WABA}/phone_numbers`)) return Response.json({ data: numeros });
    return Response.json({ success: true });
  };
  return { llamadas, fetchImpl };
}

async function completar(env, datos, meta, invitacion) {
  const inv = invitacion || await crearInvitacion(env, "pepito");
  const r = await atenderAlta(new Request(`https://x.dev/alta/${inv}/completar`, { method: "POST", body: JSON.stringify(datos) }), env, meta.fetchImpl);
  return { estado: r.status, cuerpo: await r.json() };
}
const CODE = "AQBhlXsctMxJYbwbrpybxlo9tLPGy-QAmjBJA03jxLos43wx";

// ---------------------------------------------------------------------
test("invitaciones: firmadas, para UNA lavandería y con caducidad", async () => {
  const env = entorno();
  const inv = await crearInvitacion(env, "pepito", Date.now());
  assert.equal(await leerInvitacion(env, inv), "pepito");
  assert.equal(await leerInvitacion(env, inv.replace("pepito", "lavanda")), null, "cambiar la lavandería invalida la firma");
  assert.equal(await leerInvitacion(env, inv, Date.now() + 8 * 86400_000), null, "caducada a los 7 días");
  assert.equal(await leerInvitacion({ ...env, CLAVE_CIFRADO: "otra-clave-distinta-larga" }, inv), null);
  assert.equal(await leerInvitacion(env, "basura"), null);
});

test("la página de alta: enlace malo, falta configurar Meta, y la buena (sin errores de JavaScript)", async () => {
  const env = entorno();
  const pagina = async (inv, e = env) => atenderAlta(new Request(`https://x.dev/alta/${inv}`), e);
  assert.equal((await pagina("pepito.123.abc")).status, 404);
  const inv = await crearInvitacion(env, "pepito");
  assert.equal((await pagina(inv, { ...env, META_CONFIG_ID: "" })).status, 503);
  env.REGISTRO.datos.get("pepito").nombre = 'Pepito <script>alert(1)</script>';
  const r = await pagina(inv);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Referrer-Policy"), "strict-origin", "la invitación no se filtra a Facebook");
  const html = await r.text();
  assert.doesNotMatch(html, /<script>alert/, "el nombre se escapa");
  assert.match(html, /"appId":"21202248997039"/);
  assert.match(html, /"configId":"cfg123"/);
  assert.match(html, /connect\.facebook\.net\/es_ES\/sdk\.js/);
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  assert.doesNotThrow(() => new Function(js), "error de sintaxis en la página");
  assert.match(js, /featureType = "whatsapp_business_app_onboarding"/);
  assert.match(js, /response_type: "code"/);
});

test("ALTA con número nuevo: canjea el código, comprueba el número, suscribe, registra con PIN y lo guarda cifrado", async () => {
  const env = entorno();
  const meta = metaFalsa();
  const r = await completar(env, { code: CODE, evento: "FINISH", wabaId: WABA, phoneId: PHONE }, meta);
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.deepEqual(r.cuerpo, { ok: true, numero: "+34 977 000 111", coexistencia: false, pendientes: [] });
  assert.deepEqual(meta.llamadas.map((l) => `${l.metodo} ${l.ruta}`), [
    "GET /v27.0/oauth/access_token",
    `GET /v27.0/${WABA}/phone_numbers`,
    `POST /v27.0/${WABA}/subscribed_apps`,
    `POST /v27.0/${PHONE}/register`,
  ]);
  assert.deepEqual(meta.llamadas[0].query, { client_id: "21202248997039", client_secret: "secreto-de-la-app", code: CODE });
  assert.ok(meta.llamadas.slice(1).every((l) => l.auth === "Bearer tokNuevo"), "el resto, con el token de la lavandería");
  const pin = meta.llamadas[3].cuerpo.pin;
  assert.match(pin, /^\d{6}$/);
  assert.equal(meta.llamadas[3].cuerpo.messaging_product, "whatsapp");

  const c = env.REGISTRO.datos.get("pepito").conexion;
  assert.equal(c.phoneId, PHONE); assert.equal(c.wabaId, WABA); assert.equal(c.modo, "cloud");
  assert.equal(c.dueno, "34677888999", "el móvil del dueño puesto en el panel se conserva");
  assert.equal(await descifrar(c.tokenCifrado, env.CLAVE_CIFRADO), "tokNuevo");
  assert.equal(await descifrar(c.pinCifrado, env.CLAVE_CIFRADO), pin);
  assert.doesNotMatch(JSON.stringify(env.REGISTRO.datos.get("pepito")), /tokNuevo/);
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /tokNuevo/, "el token nunca vuelve al navegador");
});

test("ALTA con la app WhatsApp Business (coexistencia): no registra, sincroniza contactos e historial", async () => {
  const env = entorno();
  const meta = metaFalsa();
  // en este evento Meta solo garantiza waba_id: el número se averigua preguntando a Meta
  const r = await completar(env, { code: CODE, evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", wabaId: WABA }, meta);
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.coexistencia, true);
  assert.ok(!meta.llamadas.some((l) => l.ruta.endsWith("/register")), "no se registra: ya lo está");
  assert.deepEqual(meta.llamadas.filter((l) => l.ruta.endsWith("/smb_app_data")).map((l) => [l.ruta, l.cuerpo.sync_type]), [
    [`/v27.0/${PHONE}/smb_app_data`, "smb_app_state_sync"],
    [`/v27.0/${PHONE}/smb_app_data`, "history"],
  ]);
  const c = env.REGISTRO.datos.get("pepito").conexion;
  assert.equal(c.modo, "coexistencia");
  assert.equal(c.phoneId, PHONE);
  assert.equal(c.pinCifrado, undefined);
});

test("no se puede colar un número que no es de esa cuenta de Meta", async () => {
  const env = entorno();
  const meta = metaFalsa();
  const r = await completar(env, { code: CODE, evento: "FINISH", wabaId: WABA, phoneId: "999999999999999" }, meta);
  assert.equal(r.estado, 422);
  assert.deepEqual(env.REGISTRO.datos.get("pepito").conexion, { dueno: "34677888999" }, "no se guarda nada");
  assert.ok(!meta.llamadas.some((l) => l.metodo === "POST"), "ni se toca nada en Meta");
  // y si la cuenta tiene varios números y no se dice cuál, tampoco se adivina
  const varios = metaFalsa({ numeros: [{ id: PHONE }, { id: "106540352242923" }] });
  assert.equal((await completar(env, { code: CODE, evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", wabaId: WABA }, varios)).estado, 422);
});

test("si Meta no acepta el código, no se guarda nada y se explica", async () => {
  const env = entorno();
  const meta = metaFalsa({ falla: { "/oauth/access_token": "This authorization code has expired" } });
  const r = await completar(env, { code: CODE, evento: "FINISH", wabaId: WABA, phoneId: PHONE }, meta);
  assert.equal(r.estado, 502);
  assert.match(r.cuerpo.error, /30 segundos/);
  assert.equal(meta.llamadas.length, 1);
  assert.deepEqual(env.REGISTRO.datos.get("pepito").conexion, { dueno: "34677888999" });
});

test("si falla un paso después de canjear el código, se guarda el token y se dice qué falta", async () => {
  const env = entorno();
  const meta = metaFalsa({ falla: { "/register": "Two-step verification PIN mismatch" } });
  const r = await completar(env, { code: CODE, evento: "FINISH", wabaId: WABA, phoneId: PHONE }, meta);
  assert.equal(r.estado, 207);
  assert.deepEqual(r.cuerpo.pendientes, ["registrar el número"]);
  assert.match(r.cuerpo.aviso, /registrar el número/);
  assert.deepEqual(env.REGISTRO.datos.get("pepito").conexion.pendientes, ["registrar el número"]);
  assert.match(env.REGISTRO.datos.get("pepito").conexion.tokenCifrado, /^v1:/);
});

test("peticiones que no se aceptan: alta sin terminar, sin código, enlace caducado, lavandería fija", async () => {
  const env = entorno();
  const meta = metaFalsa();
  assert.equal((await completar(env, { code: CODE, evento: "CANCEL", wabaId: WABA }, meta)).estado, 400);
  assert.equal((await completar(env, { code: "x", evento: "FINISH", wabaId: WABA }, meta)).estado, 400);
  assert.equal((await completar(env, { code: CODE, evento: "FINISH", wabaId: "abc" }, meta)).estado, 400);
  const caducada = await crearInvitacion(env, "pepito", Date.now() - 8 * 86400_000);
  assert.equal((await completar(env, { code: CODE, evento: "FINISH", wabaId: WABA }, meta, caducada)).estado, 403);
  const deLavanda = await crearInvitacion(env, "lavanda");
  assert.equal((await completar(env, { code: CODE, evento: "FINISH", wabaId: WABA }, meta, deLavanda)).estado, 409);
  assert.equal(meta.llamadas.length, 0, "ninguna llegó a Meta");
});

test("comprobar la conexión: funciona / token caducado", async () => {
  const env = entorno();
  const bien = async () => Response.json({ display_phone_number: "+34 977 000 111", verified_name: "Pepito", platform_type: "CLOUD_API", is_on_biz_app: true, quality_rating: "GREEN" });
  assert.deepEqual(await comprobarConexion(env, { phoneId: PHONE, token: "t" }, bien),
    { ok: true, numero: "+34 977 000 111", nombre: "Pepito", plataforma: "CLOUD_API", conApp: true, calidad: "GREEN" });
  const mal = async () => new Response(JSON.stringify({ error: { message: "Error validating access token: Session has expired", code: 190 } }), { status: 401 });
  const r = await comprobarConexion(env, { phoneId: PHONE, token: "t" }, mal);
  assert.equal(r.ok, false);
  assert.match(r.error, /expired/);
  assert.equal((await comprobarConexion(env, {})).ok, false);
});

test("el panel genera el enlace de alta para esa lavandería", async () => {
  const env = entorno();
  const r = await atenderAdmin(new Request("https://lavanda-asistente.x.dev/admin/api", {
    method: "POST", headers: { "X-Clave": "clave" }, body: JSON.stringify({ accion: "invitacion", id: "pepito" }),
  }), env);
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  const m = /^https:\/\/lavanda-asistente\.x\.dev\/alta\/(.+)$/.exec(j.enlace);
  assert.ok(m, j.enlace);
  assert.equal(await leerInvitacion(env, m[1]), "pepito");
});

// ---------------------------------------------------------------------
//  El dueño contesta desde la app WhatsApp Business
// ---------------------------------------------------------------------
const ECO = {
  object: "whatsapp_business_account",
  entry: [{ id: WABA, changes: [{ field: "smb_message_echoes", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "34977000111", phone_number_id: "111" },
    contacts: [{ wa_id: "34612345678", user_id: "BSUID1" }],
    message_echoes: [{ from: "34977000111", to: "34612345678", to_user_id: "BSUID1", id: "wamid.X", timestamp: "1738796547", type: "text", text: { body: "Hola, soy Carmen, ya te lo miro" } }],
  } }] }],
};

test("se leen los mensajes que el dueño manda desde la app (formato de Meta)", () => {
  assert.deepEqual(extraerEcos(ECO), [{ id: "wamid.X", numeroId: "111", para: "34612345678", tipo: "text", texto: "Hola, soy Carmen, ya te lo miro" }]);
  assert.deepEqual(extraerEcos({ entry: [{ changes: [{ field: "messages", value: {} }] }] }), []);
});

test("cuando el dueño contesta desde la app, el asistente se calla con ESE cliente", async () => {
  const llamadas = [];
  const CONVERSACIONES = { idFromName: (n) => n, get: (memoria) => ({
    eco: async (texto, cliente) => llamadas.push({ memoria, texto, cliente }),
    recibir: async () => llamadas.push("recibir"),
  }) };
  const cuerpo = JSON.stringify(ECO);
  const firma = "sha256=" + createHmac("sha256", "app").update(cuerpo).digest("hex");
  const r = await atenderWhatsApp(new Request("https://x.dev/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": firma }, body: cuerpo }),
    { WHATSAPP_APP_SECRET: "app", WHATSAPP_PHONE_ID: "111", CONVERSACIONES });
  assert.equal(r.status, 200);
  assert.deepEqual(llamadas, [{ memoria: "34612345678", texto: "Hola, soy Carmen, ya te lo miro", cliente: "lavanda" }], "no se trata como un mensaje de cliente");

  const res = ecoDelDueno({ estado: estadoInicial(), texto: "ya te lo miro", ahora: 1000 });
  assert.deepEqual(res.pausa, { desde: 1000, ultimoDueno: 1000, motivo: "app" });
  assert.equal(res.anadir[0].content, "[Mensaje del equipo de Lavanda] ya te lo miro");
});

test("con coexistencia y el asistente callado, no se reenvían al dueño mensajes que ya ve en su app", async () => {
  const ficha = { ...PEPITO_BD, conexion: { modo: "coexistencia" } };
  const usados = [];
  const wa = new Proxy({}, { get: (_, nombre) => async () => usados.push(nombre) });
  const claude = { beta: { messages: { create: async () => { usados.push("claude"); return {}; } } } };
  const r = await procesarPendientes({
    estado: { historial: [], pausa: { desde: Date.now(), ultimoDueno: Date.now() }, avisos: [] },
    pendientes: [{ id: "m1", tipo: "text", texto: "¿sigues ahí?" }],
    telefono: "34612345678", nombre: "Ana", wa, claude, env: { OWNER_PHONE: "677888999" },
    cliente: { ficha, textos: crearTextos(ficha) },
  });
  assert.deepEqual(usados, [], "ni WhatsApp ni Claude");
  assert.deepEqual(r.anadir, [{ role: "user", content: "¿sigues ahí?" }], "pero queda en la memoria");
});
