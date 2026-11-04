import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoConexion, conectarApp, activarMensajes } from "../src/conexion.js";

const ENV = { WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_ID: "PH1", WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "v", OWNER_PHONE: "600" };

function metaFalso() {
  const suscritas = [{ whatsapp_business_api_data: { id: "BOT", name: "Botpress" } }];
  const llamadas = [];
  const f = async (url, op = {}) => {
    llamadas.push({ url, metodo: op.method || "GET" });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.includes("/debug_token")) return ok({ data: { is_valid: true, app_id: "MIA", granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["W1", "W2"] }] } });
    if (url.endsWith("/PH1?fields=display_phone_number,verified_name,quality_rating,platform_type")) return ok({ display_phone_number: "+34 689 81 02 13", verified_name: "Lavanda Laundry", quality_rating: "GREEN" });
    if (url.includes("/W1/phone_numbers")) return ok({ data: [{ id: "OTRO" }] });
    if (url.includes("/W2/phone_numbers")) return ok({ data: [{ id: "PH1" }] });
    if (url.endsWith("/W2/subscribed_apps") && op.method === "POST") { suscritas.push({ whatsapp_business_api_data: { id: "MIA", name: "Lavanda Asistente" } }); return ok({ success: true }); }
    if (url.endsWith("/W2/subscribed_apps")) return ok({ data: suscritas });
    return new Response(JSON.stringify({ error: { message: "no" } }), { status: 404 });
  };
  return { f, llamadas };
}

test("detecta que la app no está conectada y la conecta a la cuenta correcta", async () => {
  const m = metaFalso();
  const e = await estadoConexion(ENV, m.f);
  assert.equal(e.waba, "W2");
  assert.equal(e.miAppConectada, false);
  assert.deepEqual(e.apps.map((a) => a.nombre), ["Botpress"]);
  const e2 = await conectarApp(ENV, m.f);
  assert.ok(m.llamadas.some((l) => l.url.endsWith("/W2/subscribed_apps") && l.metodo === "POST"));
  assert.equal(e2.miAppConectada, true);
});

test("avisa si faltan secretos", async () => {
  const e = await estadoConexion({ WHATSAPP_PHONE_ID: "PH1" });
  assert.equal(e.ok, false);
  assert.ok(e.faltan.includes("WHATSAPP_TOKEN"));
});

test("si el token no indica la cuenta, se puede indicar a mano", async () => {
  const m = metaFalso();
  const sinCuentas = async (url, op) => url.includes("/debug_token")
    ? new Response(JSON.stringify({ data: { is_valid: true, app_id: "MIA", granular_scopes: [] } }), { status: 200 })
    : m.f(url, op);
  const e = await estadoConexion(ENV, sinCuentas);
  assert.equal(e.waba, null);
  assert.equal(e.pedirWaba, true);
  const e2 = await estadoConexion(ENV, sinCuentas, "W2");
  assert.equal(e2.waba, "W2");
  const e3 = await conectarApp(ENV, sinCuentas, "W2");
  assert.equal(e3.miAppConectada, true);
});

test("activa el campo messages del webhook con el token de la app", async () => {
  const m = metaFalso();
  let suscripcion = { object: "whatsapp_business_account", callback_url: "https://x/whatsapp", active: true, fields: [] };
  let peticion;
  const f = async (url, op = {}) => {
    if (url.includes("/MIA/subscriptions")) {
      assert.equal(op.headers.Authorization, "Bearer MIA|s");
      if (op.method === "POST") { peticion = Object.fromEntries(op.body); suscripcion.fields = [{ name: "messages", version: "v23.0" }]; return new Response('{"success":true}', { status: 200 }); }
      return new Response(JSON.stringify({ data: [suscripcion] }), { status: 200 });
    }
    return m.f(url, op);
  };
  const antes = await estadoConexion(ENV, f, "W2");
  assert.deepEqual(antes.webhook.campos, []);
  const w = await activarMensajes(ENV, "https://x/whatsapp", f);
  assert.equal(peticion.fields, "messages");
  assert.equal(peticion.verify_token, "v");
  assert.deepEqual(w.campos, ["messages"]);
});
