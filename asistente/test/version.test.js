// Hora de la versión publicada en /prueba
import { test } from "node:test";
import assert from "node:assert/strict";
import { versionPublicada, atenderPrueba } from "../src/prueba.js";

test("la hora de publicación se enseña en hora de Madrid (hoy, ayer o fecha) y sin el dato no falla", async () => {
  const ahora = Date.parse("2026-11-09T12:00:00Z");
  assert.equal(versionPublicada({ CF_VERSION_METADATA: { timestamp: "2026-11-09T10:23:00Z" } }, ahora), "hoy 11:23");
  assert.equal(versionPublicada({ CF_VERSION_METADATA: { timestamp: "2026-11-08T20:05:00Z" } }, ahora), "ayer 21:05");
  assert.match(versionPublicada({ CF_VERSION_METADATA: { timestamp: "2026-11-01T08:00:00Z" } }, ahora), /^1 nov\.? 09:00$/);
  assert.equal(versionPublicada({}, ahora), "desconocida");

  const r = await atenderPrueba(new Request("https://x.dev/prueba"), { CF_VERSION_METADATA: { timestamp: new Date().toISOString() } });
  const html = await r.text();
  assert.match(html, /Versión publicada: hoy \d\d:\d\d/);
  assert.doesNotMatch(html, /__PUBLICADO__/);
});
