import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crearTextos, rellenar, validarFicha } from "../src/negocio.js";
import * as negocio from "../src/negocio.js";
import { FICHA_LAVANDA } from "../src/clientes/lavanda.js";
import { PEPITO } from "./fixtures/pepito.js";

// Copia exacta de los textos que Lavanda usaba ANTES de convertirlos en plantilla.
// Si cambias a propósito las normas de Lavanda, regenera este archivo (ver test/fixtures/README.md).
const ANTES = JSON.parse(readFileSync(new URL("./fixtures/lavanda-textos.json", import.meta.url), "utf8"));

test("la plantilla con la ficha de Lavanda da EXACTAMENTE los mismos textos de siempre", () => {
  const t = crearTextos(FICHA_LAVANDA);
  for (const clave of Object.keys(ANTES)) {
    assert.deepEqual(t[clave], ANTES[clave], `${clave} ha cambiado`);
  }
});

test("los nombres antiguos que importan web, WhatsApp y voz siguen funcionando", () => {
  for (const clave of Object.keys(ANTES)) assert.deepEqual(negocio[clave], ANTES[clave], clave);
  assert.equal(negocio.INSTRUCCIONES, ANTES.INSTRUCCIONES_WEB);
});

test("las frases sueltas son las mismas que estaban escritas a mano", () => {
  const t = crearTextos(FICHA_LAVANDA);
  assert.equal(t.RESPUESTA_ERROR, "Perdona, he tenido un problema técnico. Llama a uno de nuestros agentes al 689 810 213, de 8:00 a 21:00.");
  assert.equal(t.NO_CONTESTA_VOZ, "Ahora mismo no podemos atenderte. Escríbenos por WhatsApp a este mismo número, el 689 810 213, y te ayudamos. Gracias por llamar a Lavanda.");
  assert.equal(t.HORA_ETIQUETA, "Hora actual en El Vendrell");
  assert.equal(t.ETIQUETA_EQUIPO, "[Mensaje del equipo de Lavanda]");
});

test("otra lavandería: sus datos aparecen en WhatsApp, web y voz, y no queda nada de Lavanda", () => {
  const t = crearTextos(PEPITO);
  for (const clave of ["INSTRUCCIONES_WEB", "INSTRUCCIONES_WHATSAPP", "INSTRUCCIONES_VOZ"]) {
    const texto = t[clave];
    assert.match(texto, /Lavandería Pepito/, clave);
    assert.match(texto, /977 000 111/, clave);
    assert.match(texto, /Calle Mayor 5, Reus/, clave);
    assert.doesNotMatch(texto, /689 810 213|El Vendrell|lavandavendrell|Baix Penedès/, `${clave} conserva datos de Lavanda`);
    // otro modo de cobro: nada del cajero de efectivo ni del Bizum de Lavanda
    assert.doesNotMatch(texto, /Bizum|luz amarilla|cajero/i, `${clave} conserva normas de cobro de Lavanda`);
    assert.doesNotMatch(texto, /\{\{/, `${clave} tiene un hueco sin rellenar`);
  }
  assert.match(t.INSTRUCCIONES_WHATSAPP, /https:\/\/g\.page\/r\/PEPITO\/review/);
  assert.match(t.SALUDO_VOZ, /asistente virtual de Lavandería Pepito/);
  assert.match(t.HERRAMIENTA_AVISO.description, /equipo de Lavandería Pepito/);
  assert.doesNotMatch(JSON.stringify(t.HERRAMIENTA_AVISO), /Bizum/);
});

test("los motivos de aviso salen de la ficha: cada lavandería tiene los suyos", () => {
  const enumDe = (t) => t.HERRAMIENTA_AVISO.input_schema.properties.motivo.enum;
  assert.deepEqual(enumDe(crearTextos(PEPITO)), ["devolucion"]);
  assert.deepEqual(enumDe(crearTextos(FICHA_LAVANDA)), ["bizum", "servicio_personalizado", "justificante_factura"]);
});

test("una sección que no aplica (null) desaparece sin dejar el título", () => {
  const t = crearTextos(PEPITO);
  assert.doesNotMatch(t.INSTRUCCIONES_WHATSAPP, /TARJETA DE FIDELIZACIÓN/);
  assert.match(crearTextos(FICHA_LAVANDA).INSTRUCCIONES_WHATSAPP, /TARJETA DE FIDELIZACIÓN/);
});

test("una ficha incompleta da un error claro en vez de un asistente a medias", () => {
  const { telefono, ...sinTelefono } = FICHA_LAVANDA;
  assert.throws(() => crearTextos(sinTelefono), /faltan telefono/);
  assert.throws(() => validarFicha({ ...FICHA_LAVANDA, conocimiento: { general: "x" } }), /conocimiento\.precios/);
  const { procedimientos, ...sinProcedimientos } = FICHA_LAVANDA.normas;
  assert.throws(() => crearTextos({ ...FICHA_LAVANDA, normas: sinProcedimientos }), /normas\.procedimientos/);
  assert.throws(() => crearTextos({ ...FICHA_LAVANDA, normas: { ...FICHA_LAVANDA.normas, motivosAviso: [] } }), /normas\.motivosAviso/);
});

test("un hueco con un dato que no existe da error", () => {
  assert.throws(() => rellenar("Hola {{inventado}}", FICHA_LAVANDA), /Falta el dato "inventado"/);
  assert.equal(rellenar("Llama al {{telefono}}", FICHA_LAVANDA), "Llama al 689 810 213");
});

test("las normas de voz solo son obligatorias si la lavandería tiene número de voz", () => {
  const sinVoz = { ...PEPITO, numerosVoz: [], normas: { ...PEPITO.normas, voz: "" } };
  assert.doesNotThrow(() => crearTextos(sinVoz));
  assert.throws(() => crearTextos({ ...sinVoz, numerosVoz: ["+34977000111"] }), /normas\.voz/);
});

test("aparato de pago y ejemplo de lo que no debe inventar son opcionales, y sin ellos las frases quedan bien", () => {
  const t = crearTextos({ ...PEPITO, equipoCobro: "", ejemploNoExiste: "" });
  assert.match(t.INSTRUCCIONES_WHATSAPP, /\(pantalla de una máquina, etiqueta de ropa/);
  assert.match(t.INSTRUCCIONES_WHATSAPP, /No inventes máquinas, servicios, soluciones ni datos\. /);
  assert.doesNotMatch(t.INSTRUCCIONES_WHATSAPP + t.INSTRUCCIONES_VOZ + t.INSTRUCCIONES_WEB, /por ejemplo, \)|máquina o ,|\{\{/);
  const con = crearTextos(PEPITO);
  assert.match(con.INSTRUCCIONES_WHATSAPP, /pantalla de una máquina o del lector de tarjetas,/);
});
