// Panel /admin y base de datos de lavanderías
import { test } from "node:test";
import assert from "node:assert/strict";
import { atenderAdmin, limpiarFicha } from "../src/admin.js";
import { cifrar, descifrar } from "../src/cifrado.js";
import {
  prepararRegistro, olvidarCache, buscarClientePorWhatsApp, buscarClientePorOrigen, entornoDe, obtenerCliente, idsDeClientes,
} from "../src/clientes/index.js";
import { PEPITO } from "./fixtures/pepito.js";

// Base de datos de mentira (copia los datos al guardar y al leer, como la de verdad)
function registroFalso() {
  const datos = new Map();
  let falla = false;
  const copia = (x) => (x == null ? x : structuredClone(x));
  const stub = {
    listar: async () => { if (falla) throw new Error("caída"); return [...datos.values()].map(copia); },
    leer: async (id) => copia(datos.get("ficha:" + id) ?? null),
    guardar: async (f) => { datos.set("ficha:" + f.id, copia(f)); return true; },
    borrar: async (id) => datos.delete("ficha:" + id),
  };
  return { datos, stub, fallar: (v) => { falla = v; }, idFromName: (n) => n, get: () => stub };
}

const REGISTRO = registroFalso();
const ENV = {
  ADMIN_CLAVE: "clave-del-panel", CLAVE_CIFRADO: "una-clave-de-cifrado-bien-larga", REGISTRO,
  WHATSAPP_PHONE_ID: "111", WHATSAPP_TOKEN: "tokenLavanda", OWNER_PHONE: "600111222",
};
let ipN = 0;
async function panel(accion, datos = {}, { clave = ENV.ADMIN_CLAVE, env = ENV, ip = "1.1.1.1" } = {}) {
  const r = await atenderAdmin(new Request("https://x.dev/admin/api", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Clave": clave, "CF-Connecting-IP": ip },
    body: JSON.stringify({ accion, ...datos }),
  }), env);
  return { estado: r.status, ...(await r.json()) };
}
const { secretos, prefijoMemoria, ...PEPITO_BD } = PEPITO;   // en la base de datos no hay nombres de secretos

// ---------------------------------------------------------------------
test("cifrado: ida y vuelta, distinto cada vez, y con otra clave no se lee", async () => {
  const a = await cifrar("EAAG-token-secreto", ENV.CLAVE_CIFRADO);
  const b = await cifrar("EAAG-token-secreto", ENV.CLAVE_CIFRADO);
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /token-secreto/);
  assert.equal(await descifrar(a, ENV.CLAVE_CIFRADO), "EAAG-token-secreto");
  await assert.rejects(descifrar(a, "otra-clave-distinta-larga"));
  await assert.rejects(cifrar("x", "corta"), /CLAVE_CIFRADO/);
});

test("la página del panel no se deja incrustar, no se indexa y su JavaScript no tiene errores", async () => {
  const r = await atenderAdmin(new Request("https://x.dev/admin"), ENV);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Frame-Options"), "DENY");
  const html = await r.text();
  assert.match(html, /noindex/);
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(js), "el JavaScript de la página tiene un error de sintaxis");
});

test("contraseña: sin configurar, incorrecta y demasiados intentos", async () => {
  assert.equal((await panel("listar", {}, { env: { ...ENV, ADMIN_CLAVE: "" } })).estado, 503);
  assert.equal((await panel("listar", {}, { clave: "mala", ip: "9.9.9.9" })).estado, 401);
  for (let i = 0; i < 9; i++) await panel("listar", {}, { clave: "mala", ip: "9.9.9.9" });
  const r = await panel("listar", {}, { ip: "9.9.9.9" });   // ni con la buena: bloqueado un rato
  assert.equal(r.estado, 429);
  assert.equal((await panel("listar", {}, { ip: "2.2.2.2" })).estado, 200, "otro visitante no se ve afectado");
});

test("la lista enseña Lavanda como fija, activa y conectada", async () => {
  const r = await panel("listar");
  assert.equal(r.estado, 200);
  assert.deepEqual(r.lavanderias.map((l) => [l.id, l.fija, l.activa, l.conectada]), [["lavanda", true, true, true]]);
  assert.equal(r.cifradoListo, true);
});

test("Lavanda no se puede modificar desde el panel", async () => {
  const r = await panel("guardar", { ficha: { ...PEPITO_BD, id: "lavanda" } });
  assert.equal(r.estado, 409);
  assert.equal((await panel("activar", { id: "lavanda", activa: false })).estado, 409);
  assert.equal((await panel("borrar", { id: "lavanda" })).estado, 404);
});

test("una ficha MAL ESCRITA no se guarda, y se explica por qué", async () => {
  const r = await panel("guardar", { ficha: { ...PEPITO_BD, id: "Pepito Reus", numerosVoz: ["977"], origenesPermitidos: ["pepitolava.es"] }, nueva: true });
  assert.equal(r.estado, 422);
  const t = r.errores.join("\n");
  assert.match(t, /identificador/);
  assert.match(t, /número de voz "977"/);
  assert.match(t, /La web "pepitolava.es"/);
  assert.equal(REGISTRO.datos.size, 0);
});

test("una ficha INCOMPLETA se guarda como borrador, dice qué falta con los nombres del formulario y no se puede activar", async () => {
  const r = await panel("guardar", { ficha: { ...PEPITO_BD, id: "a-medias", nombre: "", conocimiento: { ...PEPITO_BD.conocimiento, precios: "" }, origenesPermitidos: ["https://amedias.es"], numerosVoz: [] }, nueva: true });
  assert.equal(r.estado, 200, JSON.stringify(r));
  assert.equal(r.incompleta.length, 1);
  assert.match(r.incompleta[0], /^Falta rellenar: Nombre · Precios y máquinas\.$/);
  assert.equal(REGISTRO.datos.get("ficha:a-medias").activa, false);
  assert.ok(!idsDeClientes().includes("a-medias"), "a medias no entra en el registro: no atiende a nadie");
  const l = await panel("listar");
  assert.equal(l.lavanderias.find((x) => x.id === "a-medias").invalida, true);
  const a = await panel("activar", { id: "a-medias", activa: true });
  assert.equal(a.estado, 422);
  assert.match(a.errores.join(" "), /incompleta.*Falta rellenar: Nombre/s);
  assert.equal((await panel("borrar", { id: "a-medias" })).estado, 200);
});

test("el panel solo guarda campos conocidos (nada de secretos ni prefijos colados)", () => {
  const f = limpiarFicha({ ...PEPITO, secretos: { token: "WHATSAPP_TOKEN" }, prefijoMemoria: "", conexion: { token: "x" }, activa: true, extra: 1 });
  assert.equal(f.secretos, undefined);
  assert.equal(f.prefijoMemoria, undefined);
  assert.equal(f.conexion, undefined);
  assert.equal(f.activa, undefined);
  assert.equal(f.extra, undefined);
  assert.equal(f.conocimiento.fidelizacion, null);
});

test("alta de una lavandería: se guarda como BORRADOR y no afecta a nada", async () => {
  const r = await panel("guardar", { ficha: PEPITO_BD, nueva: true });
  assert.equal(r.estado, 200, JSON.stringify(r));
  assert.equal(REGISTRO.datos.get("ficha:pepito").activa, false);
  assert.ok(idsDeClientes().includes("pepito"));
  // borrador: no se atiende y Lavanda sigue siendo "la única" (nada cambia en producción)
  assert.equal(buscarClientePorWhatsApp(ENV, "109999999999999").ficha.id, "lavanda");
  assert.equal(buscarClientePorOrigen(ENV, "https://pepitolava.es").ficha.id, "lavanda");
  assert.equal((await panel("guardar", { ficha: PEPITO_BD, nueva: true })).estado, 409, "no se pisa una que ya existe");
});

test("vista previa: las instrucciones que tendría, sin guardar nada", async () => {
  const r = await panel("vista", { ficha: { ...PEPITO_BD, id: "otra", nombre: "Lavandería Otra" } });
  assert.equal(r.estado, 200);
  assert.match(r.whatsapp, /Lavandería Otra/);
  assert.match(r.saludo, /Lavandería Otra/);
  assert.equal(REGISTRO.datos.has("ficha:otra"), false);
});

test("aviso si al copiar y pegar quedan datos de otra lavandería", async () => {
  const ficha = { ...PEPITO_BD, conocimiento: { ...PEPITO_BD.conocimiento, general: "Llama al 689 810 213 de Lavanda." } };
  const r = await panel("guardar", { ficha });
  assert.equal(r.estado, 200);
  assert.ok(r.avisos.some((a) => /Lavanda/.test(a) && /689 810 213/.test(a)), JSON.stringify(r.avisos));
  await panel("guardar", { ficha: PEPITO_BD });   // se deja como estaba
});

test("no se puede activar sin su WhatsApp conectado", async () => {
  const r = await panel("activar", { id: "pepito", activa: true });
  assert.equal(r.estado, 409);
  assert.match(r.errores.join(" "), /No tiene conectado su número de WhatsApp/);
});

test("conexión de WhatsApp: el token se guarda cifrado y el panel nunca lo devuelve", async () => {
  assert.equal((await panel("conexion", { id: "pepito", phoneId: "109999999999999", dueno: "677888999", token: "tokenPepito" }, { env: { ...ENV, CLAVE_CIFRADO: "" } })).estado, 422);
  const r = await panel("conexion", { id: "pepito", phoneId: "109999999999999", dueno: "677 888 999", token: "tokenPepito" });
  assert.equal(r.estado, 200, JSON.stringify(r));
  const guardada = REGISTRO.datos.get("ficha:pepito");
  assert.match(guardada.conexion.tokenCifrado, /^v1:/);
  assert.doesNotMatch(JSON.stringify(guardada), /tokenPepito/, "en la base de datos solo está cifrado");
  assert.equal(guardada.conexion.dueno, "34677888999");
  const leida = await panel("leer", { id: "pepito" });
  assert.doesNotMatch(JSON.stringify(leida), /tokenPepito|tokenCifrado|v1:/);
  assert.equal(leida.ficha.conexion.tieneToken, true);
  // cambiar el móvil sin volver a escribir el token lo conserva
  assert.equal((await panel("conexion", { id: "pepito", phoneId: "109999999999999", dueno: "677888998" })).estado, 200);
  assert.equal(REGISTRO.datos.get("ficha:pepito").conexion.tokenCifrado, guardada.conexion.tokenCifrado);
  await panel("conexion", { id: "pepito", phoneId: "109999999999999", dueno: "677888999" });
});

test("ACTIVAR: avisa de lo que afecta a Lavanda y, ya activa, se atiende con SU token", async () => {
  const r = await panel("activar", { id: "pepito", activa: true });
  assert.equal(r.estado, 200, JSON.stringify(r));
  assert.ok(r.avisos.some((a) => /Lavanda no tiene número de voz/.test(a)), JSON.stringify(r.avisos));
  const p = buscarClientePorWhatsApp(ENV, "109999999999999");
  assert.equal(p.ficha.id, "pepito");
  assert.equal(entornoDe(ENV, p).WHATSAPP_TOKEN, "tokenPepito", "el token se descifra en memoria");
  assert.equal(entornoDe(ENV, p).OWNER_PHONE, "34677888999");
  assert.equal(buscarClientePorWhatsApp(ENV, "111").ficha.id, "lavanda");
  assert.equal(buscarClientePorWhatsApp(ENV, "555"), null, "con dos activas, un número desconocido no se atiende");
});

test("una lavandería activa no se puede editar para que choque con otra", async () => {
  const r = await panel("guardar", { ficha: { ...PEPITO_BD, origenesPermitidos: ["https://lavandavendrell.es"] } });
  assert.equal(r.estado, 409);
  assert.match(r.errores.join(" "), /La web https:\/\/lavandavendrell.es ya es de Lavanda/);
  assert.deepEqual(REGISTRO.datos.get("ficha:pepito").origenesPermitidos, PEPITO_BD.origenesPermitidos);
});

test("no se puede activar otra con el mismo número de WhatsApp", async () => {
  await panel("guardar", { ficha: { ...PEPITO_BD, id: "copia", nombre: "Copia", origenesPermitidos: ["https://copia.es"], numerosVoz: [] }, nueva: true });
  await panel("conexion", { id: "copia", phoneId: "109999999999999", dueno: "611111111", token: "t" });
  const r = await panel("activar", { id: "copia", activa: true });
  assert.equal(r.estado, 409);
  assert.match(r.errores.join(" "), /mismo que el de Lavandería Pepito/);
  assert.equal((await panel("borrar", { id: "copia" })).estado, 200);
});

test("si la base de datos falla, se sigue atendiendo con lo que había", async () => {
  REGISTRO.fallar(true);
  olvidarCache();
  await prepararRegistro(ENV);
  assert.equal(buscarClientePorWhatsApp(ENV, "109999999999999").ficha.id, "pepito");
  REGISTRO.fallar(false);
});

test("una ficha guardada con errores no se atiende, pero se ve en el panel para arreglarla", async () => {
  REGISTRO.datos.set("ficha:rota", { id: "rota", nombre: "Rota", activa: true });
  olvidarCache();
  await prepararRegistro(ENV);
  assert.ok(!idsDeClientes().includes("rota"));
  const l = await panel("listar");
  assert.deepEqual(l.lavanderias.find((x) => x.id === "rota").invalida, true);
  REGISTRO.datos.delete("ficha:rota");
});

test("desactivar y borrar", async () => {
  assert.equal((await panel("borrar", { id: "pepito" })).estado, 409, "activa: no se borra");
  assert.equal((await panel("activar", { id: "pepito", activa: false })).estado, 200);
  assert.equal(buscarClientePorWhatsApp(ENV, "109999999999999").ficha.id, "lavanda", "vuelve a ser la única");
  assert.equal((await panel("borrar", { id: "pepito" })).estado, 200);
  assert.ok(!idsDeClientes().includes("pepito"));
  assert.throws(() => obtenerCliente(ENV, "pepito"));
});

// ---------------------------------------------------------------------
//  Arreglos del 09/11: sesión compartida, ficha nueva vacía, avisos de copia
// ---------------------------------------------------------------------
async function peticionPanel(accion, { clave, cookie, env = ENV, ahora } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "7.7.7.7" };
  if (clave) headers["X-Clave"] = clave;
  if (cookie) headers.Cookie = cookie;
  return atenderAdmin(new Request("https://x.dev/admin/api", { method: "POST", headers, body: JSON.stringify({ accion }) }), env, ahora);
}

test("SESIÓN: al entrar se da una cookie protegida que sirve en cualquier pestaña sin volver a dar la contraseña", async () => {
  const r = await peticionPanel("listar", { clave: ENV.ADMIN_CLAVE });
  assert.equal(r.status, 200);
  const c = r.headers.get("Set-Cookie");
  assert.match(c, /^lavanda_admin=v1\.\d+\.[0-9a-f]{32}; Path=\/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  const cookie = c.split(";")[0];
  assert.equal((await peticionPanel("listar", { cookie })).status, 200, "otra pestaña, solo con la cookie");
  assert.equal((await peticionPanel("listar", { cookie: "otra=1; " + cookie })).status, 200, "entre otras cookies");
  const sin = await peticionPanel("listar", {});
  assert.equal(sin.status, 401);
  assert.equal((await sin.json()).sinSesion, true);
});

test("SESIÓN: no valen cookies manipuladas, caducadas ni de una contraseña anterior", async () => {
  const cookie = (await peticionPanel("listar", { clave: ENV.ADMIN_CLAVE })).headers.get("Set-Cookie").split(";")[0];
  const [, version, caduca, firma] = /^lavanda_admin=(v1)\.(\d+)\.([0-9a-f]+)$/.exec(cookie);
  const otraCaducidad = `lavanda_admin=${version}.${Number(caduca) + 99999}.${firma}`;
  assert.equal((await peticionPanel("listar", { cookie: otraCaducidad })).status, 401, "alargar la caducidad invalida la firma");
  assert.equal((await peticionPanel("listar", { cookie, ahora: Date.now() + 13 * 3600_000 })).status, 401, "caduca a las 12 h");
  assert.equal((await peticionPanel("listar", { cookie, env: { ...ENV, ADMIN_CLAVE: "otra-contraseña" } })).status, 401, "cambiar la contraseña cierra las sesiones");
  // pedir sin sesión no cuenta como intento fallido (no bloquea a nadie)
  for (let i = 0; i < 12; i++) await peticionPanel("listar", {});
  assert.equal((await peticionPanel("listar", { clave: ENV.ADMIN_CLAVE })).status, 200);
});

test("SESIÓN: salir borra la cookie", async () => {
  const r = await atenderAdmin(new Request("https://x.dev/admin/salir", { method: "POST" }), ENV);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Set-Cookie"), /^lavanda_admin=; .*Max-Age=0$/);
});

test("las páginas del panel no guardan la contraseña en el navegador, y la de conversaciones no tiene errores de JavaScript", async () => {
  for (const ruta of ["/admin", "/admin/conversaciones"]) {
    const html = await (await atenderAdmin(new Request("https://x.dev" + ruta), ENV)).text();
    assert.doesNotMatch(html, /sessionStorage|localStorage/, ruta);
    const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
    assert.doesNotThrow(() => new Function(js), `error de sintaxis en ${ruta}`);
  }
});

test("FICHA NUEVA: empieza vacía, y los ejemplos de Lavanda se piden aparte", async () => {
  const p = await panel("plantilla");
  assert.ok(Object.values(p.ficha.conocimiento).every((v) => v === null), "sin secciones copiadas");
  assert.ok(["procedimientos", "web", "whatsapp", "avisos", "voz"].every((k) => p.ficha.normas[k] === ""), "sin normas copiadas");
  assert.deepEqual(p.ficha.normas.motivosAviso, []);
  assert.equal(p.ficha.equipoCobro, "");
  const e = await panel("ejemplos");
  assert.equal(e.de, "Lavanda");
  assert.match(e.ejemplos["normas.procedimientos"], /Bizum/);
  assert.match(e.ejemplos["normas.motivosAviso"], /^bizum \| Bizum \| /);
  assert.equal(e.ejemplos.equipoCobro, "del cajero");
});

test("aviso si una sección es IGUAL que la de otra lavandería (ejemplo copiado sin cambiar)", async () => {
  const { FICHA_LAVANDA } = await import("../src/clientes/lavanda.js");
  const ficha = { ...PEPITO_BD, id: "copiona", origenesPermitidos: ["https://copiona.es"], numerosVoz: [], normas: { ...PEPITO_BD.normas, procedimientos: FICHA_LAVANDA.normas.procedimientos } };
  const r = await panel("guardar", { ficha, nueva: true });
  assert.equal(r.estado, 200);
  assert.ok(r.avisos.some((a) => a === '"Problemas con máquinas, dinero y devoluciones" es igual que la de Lavanda: revisa que valga para esta lavandería.'), JSON.stringify(r.avisos));
  assert.equal((await panel("borrar", { id: "copiona" })).estado, 200);
});

test("la vista previa explica lo que falta con los nombres del formulario", async () => {
  const r = await panel("vista", { ficha: { ...PEPITO_BD, conocimiento: { ...PEPITO_BD.conocimiento, pago: "" } } });
  assert.equal(r.estado, 422);
  assert.deepEqual(r.errores, ["Falta rellenar: Forma de pago."]);
});
