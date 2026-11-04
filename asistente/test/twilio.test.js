import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoTwilio } from "../src/twilio.js";

test("lista los números de Twilio y adónde van sus llamadas", async () => {
  let pedido;
  const f = async (url, op) => {
    if (!url.includes("IncomingPhoneNumbers")) return new Response("{}", { status: 404 });
    pedido = { url, auth: op.headers.Authorization };
    return new Response(JSON.stringify({ incoming_phone_numbers: [
      { phone_number: "+34930000000", friendly_name: "Lavanda", voice_url: "https://ejemplo/voz", voice_method: "POST", status: "in-use", capabilities: { voice: true, sms: false } },
    ] }), { status: 200 });
  };
  const r = await estadoTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" }, f);
  assert.match(pedido.url, /Accounts\/AC1\/IncomingPhoneNumbers\.json/);
  assert.equal(pedido.auth, "Basic " + btoa("AC1:tok"));
  assert.equal(r.numeros[0].numero, "+34930000000");
  assert.equal(r.numeros[0].voz, "https://ejemplo/voz");
  assert.deepEqual(r.numeros[0].capacidades, ["voice"]);
});

test("avisa si faltan las claves o son incorrectas", async () => {
  assert.deepEqual((await estadoTwilio({})).faltan, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
  const mal = async () => new Response(JSON.stringify({ message: "Authenticate" }), { status: 401 });
  const r = await estadoTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "x" }, mal);
  assert.equal(r.ok, false);
  assert.equal(r.error, "Authenticate");
});

test("muestra precios, tipo de cuenta y requisitos", async () => {
  const f = async (url) => {
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.includes("IncomingPhoneNumbers")) return ok({ incoming_phone_numbers: [] });
    if (url.endsWith("/Accounts/AC1.json")) return ok({ type: "Trial" });
    if (url.includes("/v1/PhoneNumbers/Countries/ES")) return ok({ price_unit: "USD", phone_number_prices: [{ number_type: "local", current_price: "1.15" }] });
    if (url.includes("/v1/Voice/Countries/ES")) return ok({ price_unit: "USD", inbound_call_prices: [{ number_type: "local", current_price: "0.01" }] });
    if (url.includes("Regulations")) return ok({ results: [{ friendly_name: "Spain local business", requirements: { end_user: [{ name: "Business information" }], supporting_document: [[{ name: "Proof of address" }]] } }] });
    return new Response("{}", { status: 404 });
  };
  const r = await estadoTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }, f);
  assert.equal(r.tipoCuenta, "Trial");
  assert.deepEqual(r.preciosNumero.lista, [{ tipo: "local", precio: "1.15" }]);
  assert.deepEqual(r.preciosLlamada.lista, [{ tipo: "local", precio: "0.01" }]);
  assert.deepEqual(r.requisitos[0].documentos, ["Proof of address"]);
});

import { tokenNavegador, prepararLlamadaNavegador } from "../src/twilio.js";
import { createHmac } from "node:crypto";

test("el pase del navegador es un JWT de Twilio bien firmado", async () => {
  const t = await tokenNavegador("SK1", "secreto", "AC1", "AP1", 1000);
  const [c, d, f] = t.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.equal(dec(c).cty, "twilio-fpa;v=1");
  assert.equal(dec(d).iss, "SK1");
  assert.equal(dec(d).sub, "AC1");
  assert.equal(dec(d).exp, 4600);
  assert.equal(dec(d).grants.voice.outgoing.application_sid, "AP1");
  assert.equal(f, createHmac("sha256", "secreto").update(`${c}.${d}`).digest("base64url"));
});

test("crea la app y la clave una sola vez y las reutiliza", async () => {
  const guardado = {};
  const almacen = { leer: async (k) => guardado[k] ?? null, guardar: async (k, v) => { guardado[k] = v; } };
  const llamadas = [];
  const f = async (url, op) => {
    llamadas.push(`${op.method} ${url.split("/AC1/")[1]}`);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.includes("Applications.json?")) return ok({ applications: [] });
    if (url.endsWith("Applications.json")) return ok({ sid: "AP9" });
    if (url.endsWith("Keys.json")) return ok({ sid: "SK9", secret: "sec" });
    return ok({});
  };
  const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" };
  await prepararLlamadaNavegador(env, almacen, "https://x/voz", f);
  assert.equal(guardado.twilioAppSid, "AP9");
  assert.deepEqual(guardado.twilioApiKey, { sid: "SK9", secret: "sec" });
  const antes = llamadas.length;
  await prepararLlamadaNavegador(env, almacen, "https://x/voz", f);
  assert.deepEqual(llamadas.slice(antes), ["POST Applications/AP9.json"]);
});
