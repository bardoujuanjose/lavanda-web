import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoTwilio } from "../src/twilio.js";

test("lista los números de Twilio y adónde van sus llamadas", async () => {
  let pedido;
  const f = async (url, op) => {
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
