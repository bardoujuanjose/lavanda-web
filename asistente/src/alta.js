// =====================================================================
//  ALTA DE WHATSAPP POR EL DUEÑO ("registro integrado" de Meta, Embedded Signup v4)
//
//    GET  /alta/<invitación>            página con el botón "Conectar WhatsApp"
//    POST /alta/<invitación>/completar  el navegador manda el código de Meta; el servidor
//                                       termina el alta y guarda el token cifrado
//
//  La invitación la genera el panel (/admin) para UNA lavandería y caduca a los 7 días.
//  El dueño entra con SU cuenta de Facebook: así su número queda conectado a nuestra app.
//
//  Dos formas de conectar (documentación de Meta, octubre de 2026):
//    · Número nuevo (o sin la app WhatsApp Business): Meta devuelve el evento FINISH y hay que
//      REGISTRAR el número con un PIN de 6 cifras.
//    · Número que ya usa la app WhatsApp Business ("coexistencia"): evento
//      FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING. No se registra (ya lo está), pero hay que
//      sincronizar contactos e historial en las 24 h siguientes o Meta lo desconecta.
//
//  Configuración (wrangler.toml → [vars]): META_APP_ID y META_CONFIG_ID (de la app de Meta).
//  Secretos: WHATSAPP_APP_SECRET (el de siempre) y CLAVE_CIFRADO.
// =====================================================================
import { cifrar } from "./cifrado.js";
import { almacenRegistro, esFija, olvidarCache, prepararRegistro } from "./clientes/index.js";

const DIAS_INVITACION = 7;
const EVENTOS = ["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"];
const enc = new TextEncoder();

const graph = (env) => `${env.GRAPH_BASE || "https://graph.facebook.com"}/${env.GRAPH_VERSION || "v23.0"}`;

// ---------------------------------------------------------------------
//  Invitaciones firmadas:  <id>.<caduca (segundos)>.<firma>
// ---------------------------------------------------------------------
async function firma(env, id, caduca) {
  if (!env.CLAVE_CIFRADO || String(env.CLAVE_CIFRADO).length < 16) throw new Error("Falta el secreto CLAVE_CIFRADO");
  const k = await crypto.subtle.importKey("raw", enc.encode("alta:" + env.CLAVE_CIFRADO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const f = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`${id}.${caduca}`)));
  return Array.from(f.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function crearInvitacion(env, id, ahora = Date.now()) {
  const caduca = Math.floor(ahora / 1000) + DIAS_INVITACION * 86400;
  return `${id}.${caduca}.${await firma(env, id, caduca)}`;
}

export async function leerInvitacion(env, invitacion, ahora = Date.now()) {
  const m = /^([a-z0-9][a-z0-9-]{1,29})\.(\d{9,11})\.([0-9a-f]{32})$/.exec(String(invitacion || ""));
  if (!m) return null;
  const [, id, caduca, recibida] = m;
  if (Number(caduca) * 1000 < ahora) return null;
  let buena;
  try { buena = await firma(env, id, caduca); } catch { return null; }
  let d = 0;
  for (let i = 0; i < buena.length; i++) d |= buena.charCodeAt(i) ^ recibida.charCodeAt(i);
  return d === 0 ? id : null;
}

// ---------------------------------------------------------------------
//  Llamadas a Meta (servidor a servidor)
// ---------------------------------------------------------------------
async function meta(fetchImpl, url, opciones = {}) {
  const r = await fetchImpl(url, opciones);
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || datos.error) {
    const e = new Error(datos?.error?.message || `Meta respondió ${r.status}`);
    e.code = datos?.error?.code;
    throw e;
  }
  return datos;
}
const conToken = (token, extra = {}) => ({ ...extra, headers: { Authorization: `Bearer ${token}`, ...(extra.headers || {}) } });
const pin6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

// Termina el alta. Devuelve { estado, cuerpo } (estado HTTP y JSON para la página).
export async function completarAlta(env, id, datos, fetchImpl = fetch) {
  const almacen = almacenRegistro(env);
  if (!almacen) return { estado: 503, cuerpo: { error: "Falta la base de datos en el servidor." } };
  if (esFija(id)) return { estado: 409, cuerpo: { error: "Esta lavandería se configura en el código." } };
  const ficha = await almacen.leer(id);
  if (!ficha) return { estado: 404, cuerpo: { error: "Esta lavandería ya no existe." } };
  if (!env.META_APP_ID || !env.WHATSAPP_APP_SECRET) return { estado: 503, cuerpo: { error: "Falta configurar la app de Meta en el servidor." } };

  const code = String(datos.code || "");
  const evento = String(datos.evento || "");
  const wabaId = String(datos.wabaId || "");
  const phoneIdPedido = String(datos.phoneId || "");
  if (!/^[A-Za-z0-9_\-]{20,2000}$/.test(code)) return { estado: 400, cuerpo: { error: "Falta el código de Meta. Vuelve a intentarlo." } };
  if (!EVENTOS.includes(evento)) return { estado: 400, cuerpo: { error: "El alta no se completó en Meta (no llegó a terminarse). Vuelve a intentarlo." } };
  if (!/^\d{6,25}$/.test(wabaId) || (phoneIdPedido && !/^\d{6,25}$/.test(phoneIdPedido))) return { estado: 400, cuerpo: { error: "Meta no devolvió los datos de la cuenta. Vuelve a intentarlo." } };
  const coexistencia = evento === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
  const base = graph(env);

  // 1) Canjear el código (caduca en 30 s) por el token de esta lavandería
  let token;
  try {
    const q = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.WHATSAPP_APP_SECRET, code });
    token = (await meta(fetchImpl, `${base}/oauth/access_token?${q}`)).access_token;
    if (!token) throw new Error("Meta no devolvió el token");
  } catch (e) {
    console.error(`Alta ${id}: no se pudo canjear el código:`, e.message);
    return { estado: 502, cuerpo: { error: "Meta no aceptó el alta (el código caduca en 30 segundos). Vuelve a pulsar el botón." } };
  }

  // 2) Comprobar con Meta qué números tiene esa cuenta (no nos fiamos de lo que manda el navegador)
  let numeros;
  try {
    numeros = (await meta(fetchImpl, `${base}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, conToken(token))).data || [];
  } catch (e) {
    console.error(`Alta ${id}: no se pudieron leer los números de la cuenta:`, e.message);
    return { estado: 502, cuerpo: { error: "No se pudo comprobar el número en Meta. Vuelve a intentarlo." } };
  }
  let numero = phoneIdPedido ? numeros.find((n) => String(n.id) === phoneIdPedido) : numeros.length === 1 ? numeros[0] : null;
  if (!numero) {
    return { estado: 422, cuerpo: { error: phoneIdPedido ? "Ese número no pertenece a la cuenta conectada." : "La cuenta tiene varios números: vuelve a hacerlo eligiendo uno solo." } };
  }
  const phoneId = String(numero.id);

  // 3) Que los mensajes de esa cuenta lleguen a nuestro servidor; 4) registrar o sincronizar
  const pendientes = [];
  const paso = async (nombre, fn) => {
    try { await fn(); } catch (e) { console.error(`Alta ${id}: falló "${nombre}":`, e.message); pendientes.push(nombre); }
  };
  await paso("recibir mensajes", () => meta(fetchImpl, `${base}/${wabaId}/subscribed_apps`, conToken(token, { method: "POST" })));
  let pin = null;
  if (!coexistencia) {
    pin = pin6();
    await paso("registrar el número", () => meta(fetchImpl, `${base}/${phoneId}/register`, conToken(token, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    })));
  } else {
    for (const sync_type of ["smb_app_state_sync", "history"]) {
      await paso(sync_type === "history" ? "sincronizar el historial" : "sincronizar los contactos", () => meta(fetchImpl, `${base}/${phoneId}/smb_app_data`, conToken(token, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", sync_type }),
      })));
    }
  }

  // 5) Guardar (token y PIN cifrados). Se guarda aunque falle algún paso, para poder reintentarlo.
  const conexion = {
    ...(ficha.conexion || {}),
    phoneId, wabaId, modo: coexistencia ? "coexistencia" : "cloud",
    numero: numero.display_phone_number || "", nombreVerificado: numero.verified_name || "",
    tokenCifrado: await cifrar(token, env.CLAVE_CIFRADO),
    ...(pin ? { pinCifrado: await cifrar(pin, env.CLAVE_CIFRADO) } : {}),
    pendientes, conectadaEn: new Date().toISOString(),
  };
  await almacen.guardar({ ...ficha, conexion });
  olvidarCache();
  await prepararRegistro(env, { forzar: true });

  return {
    estado: pendientes.length ? 207 : 200,
    cuerpo: {
      ok: true, numero: conexion.numero, coexistencia, pendientes,
      ...(pendientes.length ? { aviso: `Conectado, pero falta: ${pendientes.join(", ")}. Avisa a quien te mandó el enlace.` } : {}),
    },
  };
}

// Comprobar que el token guardado sigue funcionando (lo usa el panel)
export async function comprobarConexion(env, conexion, fetchImpl = fetch) {
  if (!conexion?.phoneId || !conexion?.token) return { ok: false, error: "No está conectada." };
  try {
    const d = await meta(fetchImpl, `${graph(env)}/${conexion.phoneId}?fields=display_phone_number,verified_name,platform_type,is_on_biz_app,quality_rating`, conToken(conexion.token));
    return { ok: true, numero: d.display_phone_number, nombre: d.verified_name, plataforma: d.platform_type, conApp: d.is_on_biz_app === true, calidad: d.quality_rating };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------
//  Entrada HTTP
// ---------------------------------------------------------------------
const html = (cuerpo, estado = 200) => new Response(cuerpo, {
  status: estado,
  headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
    // el enlace lleva la invitación: a Facebook solo le llega el dominio, no la dirección completa
    "Referrer-Policy": "strict-origin",
  },
});
const json = (datos, estado = 200) => new Response(JSON.stringify(datos), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function atenderAlta(request, env, fetchImpl = fetch) {
  const m = /^\/alta\/([^/]+)(\/completar)?$/.exec(new URL(request.url).pathname);
  if (!m) return html(paginaMensaje("Enlace no válido", "Pide un enlace nuevo a quien te lo envió."), 404);
  const id = await leerInvitacion(env, decodeURIComponent(m[1]));

  if (m[2]) {
    if (request.method !== "POST") return json({ error: "Usa POST" }, 405);
    if (!id) return json({ error: "El enlace ha caducado. Pide uno nuevo." }, 403);
    let datos;
    try { datos = await request.json(); } catch { return json({ error: "Petición no válida." }, 400); }
    const r = await completarAlta(env, id, datos || {}, fetchImpl);
    return json(r.cuerpo, r.estado);
  }

  if (request.method !== "GET") return json({ error: "Usa GET" }, 405);
  if (!id) return html(paginaMensaje("Enlace caducado o no válido", "Pide un enlace nuevo a quien te lo envió."), 404);
  const almacen = almacenRegistro(env);
  const ficha = almacen && !esFija(id) ? await almacen.leer(id) : null;
  if (!ficha) return html(paginaMensaje("Enlace no válido", "Esta lavandería ya no existe."), 404);
  if (!env.META_APP_ID || !env.META_CONFIG_ID) return html(paginaMensaje("Todavía no está listo", "Falta configurar la app de Meta en el servidor. Avisa a quien te mandó el enlace."), 503);
  return html(paginaAlta({ nombre: ficha.nombre, appId: env.META_APP_ID, configId: env.META_CONFIG_ID, version: env.GRAPH_VERSION || "v23.0", conectada: Boolean(ficha.conexion?.tokenCifrado) }));
}

// ---------------------------------------------------------------------
//  Páginas
// ---------------------------------------------------------------------
const ESTILO = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<style>
  :root { --verde:#075e54; --tinta:#111b21; --gris:#667781; --borde:#d9dde3; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #f4f5f7; color: var(--tinta); line-height: 1.5; }
  header { background: var(--verde); color: #fff; padding: 14px 16px; font-weight: 700; }
  main { max-width: 560px; margin: 0 auto; padding: 16px; }
  .tarjeta { background: #fff; border: 1px solid var(--borde); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  ol { padding-left: 20px; margin: 8px 0; } li { margin-bottom: 6px; }
  .op { display: block; width: 100%; text-align: left; border: 1px solid var(--borde); background: #fff; border-radius: 10px; padding: 12px 14px; margin-top: 10px; font: inherit; cursor: pointer; }
  .op b { display: block; } .op small { color: var(--gris); }
  .op.prim { border-color: #1877f2; box-shadow: 0 0 0 1px #1877f2 inset; }
  .op:disabled { opacity: .5; cursor: default; }
  #estado { margin-top: 12px; padding: 10px 12px; border-radius: 8px; display: none; }
  #estado.info { display: block; background: #e1f2fb; color: #1d4a5c; }
  #estado.bien { display: block; background: #e3f4e7; color: #14532d; }
  #estado.mal { display: block; background: #fde2e1; color: #7a1d1a; }
  small.nota { color: var(--gris); display: block; margin-top: 10px; }
</style>`;

function paginaMensaje(titulo, texto) {
  return `<!doctype html><html lang="es"><head>${ESTILO}<title>${escapar(titulo)}</title></head>
<body><header>Conectar WhatsApp</header><main><div class="tarjeta"><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></div></main></body></html>`;
}

// Sigue el código oficial de Meta (Embedded Signup v4). Sin plantillas `${}` dentro del JavaScript de la página:
// los valores van en un JSON aparte.
function paginaAlta({ nombre, appId, configId, version, conectada }) {
  const config = JSON.stringify({ appId, configId, version }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="es"><head>${ESTILO}<title>Conectar WhatsApp · ${escapar(nombre)}</title></head>
<body><header>Conectar WhatsApp</header><main>
<div class="tarjeta">
  <h1>${escapar(nombre)}</h1>
  <p>Conecta el número de WhatsApp de tu lavandería para que el asistente atienda a tus clientes.</p>
  ${conectada ? "<p><b>Ya hay un número conectado.</b> Si lo haces otra vez, se sustituye.</p>" : ""}
  <ol>
    <li>Elige tu caso. Se abrirá una ventana de Facebook: entra con <b>tu</b> cuenta.</li>
    <li>Sigue los pasos de Meta hasta el final y pulsa <b>Finalizar</b>.</li>
    <li>No cierres esta página hasta que veas el mensaje de que está conectado.</li>
  </ol>
  <button class="op prim" id="bApp" type="button" disabled><b>Mi número ya usa la app WhatsApp Business</b>
    <small>Seguirás pudiendo usar la app en tu móvil. Ten la app abierta durante el proceso: Meta te pedirá confirmarlo en ella.</small></button>
  <button class="op" id="bNuevo" type="button" disabled><b>Es un número nuevo o no usa la app WhatsApp Business</b>
    <small>El número quedará dedicado al asistente (no se podrá usar en la app WhatsApp a la vez).</small></button>
  <div id="estado" class="info">Cargando…</div>
  <small class="nota">Necesitas la app WhatsApp Business 2.24.17 o posterior si eliges la primera opción. Después, añade un método de pago en WhatsApp Manager (business.facebook.com/wa/manage) si Meta te lo pide.</small>
</div>
</main>
<script id="config" type="application/json">${config}</script>
<script>
(function () {
  var CONFIG = JSON.parse(document.getElementById("config").textContent);
  var sesion = null, enviando = false, explicado = false;
  function $(id) { return document.getElementById(id); }
  function estado(texto, tipo) { var e = $("estado"); e.textContent = texto; e.className = tipo; }
  function botones(activos) { $("bApp").disabled = !activos; $("bNuevo").disabled = !activos; }

  window.fbAsyncInit = function () {
    FB.init({ appId: CONFIG.appId, autoLogAppEvents: true, xfbml: true, version: CONFIG.version });
    botones(true); estado("Elige tu caso para empezar.", "info");
  };

  // Datos de la sesión que manda Meta (solo se aceptan mensajes de facebook.com)
  window.addEventListener("message", function (ev) {
    var h = "";
    try { h = new URL(ev.origin).hostname; } catch (e) { return; }
    if (h !== "facebook.com" && !/\\.facebook\\.com$/.test(h)) return;
    var d;
    try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (!d || d.type !== "WA_EMBEDDED_SIGNUP") return;
    if (d.event === "CANCEL") { explicado = true; estado("Has salido antes de terminar (paso: " + ((d.data && d.data.current_step) || "?") + "). Puedes volver a intentarlo.", "mal"); botones(true); return; }
    if (d.event === "ERROR") { explicado = true; estado("Meta ha dado un error: " + ((d.data && d.data.error_message) || "") + ". Puedes volver a intentarlo.", "mal"); botones(true); return; }
    sesion = { evento: d.event, wabaId: d.data && d.data.waba_id, phoneId: d.data && d.data.phone_number_id };
  });

  function enviar(code, intentos) {
    // el código caduca en 30 s: se espera como mucho 3 s a que lleguen los datos de la sesión
    if (!sesion && intentos < 30) { setTimeout(function () { enviar(code, intentos + 1); }, 100); return; }
    if (!sesion) { estado("Meta no devolvió los datos de la cuenta. Vuelve a intentarlo.", "mal"); botones(true); enviando = false; return; }
    estado("Terminando la conexión… no cierres esta página.", "info");
    fetch(location.pathname + "/completar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, evento: sesion.evento, wabaId: sesion.wabaId, phoneId: sesion.phoneId })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        enviando = false;
        if (!r.ok) { estado(r.j.error || "No se pudo terminar. Vuelve a intentarlo.", "mal"); botones(true); return; }
        var t = "¡Conectado" + (r.j.numero ? " el " + r.j.numero : "") + "! Ya puedes cerrar esta página.";
        if (r.j.coexistencia) t += " Deja la app WhatsApp Business abierta unos minutos mientras se sincroniza.";
        if (r.j.aviso) t += " " + r.j.aviso;
        estado(t, "bien");
      })
      .catch(function () { enviando = false; estado("Se ha cortado la conexión. Vuelve a intentarlo.", "mal"); botones(true); });
  }

  function empezar(conApp) {
    if (enviando || typeof FB === "undefined") return;
    sesion = null; explicado = false; botones(false); estado("Sigue los pasos en la ventana de Facebook…", "info");
    var extras = { setup: {} };
    if (conApp) { extras.featureType = "whatsapp_business_app_onboarding"; extras.sessionInfoVersion = "3"; }
    FB.login(function (resp) {
      if (resp && resp.authResponse && resp.authResponse.code) { enviando = true; enviar(resp.authResponse.code, 0); }
      else { if (!explicado) estado("No se completó el alta. Puedes volver a intentarlo.", "mal"); botones(true); }
    }, { config_id: CONFIG.configId, response_type: "code", override_default_response_type: true, extras: extras });
  }
  $("bApp").addEventListener("click", function () { empezar(true); });
  $("bNuevo").addEventListener("click", function () { empezar(false); });
})();
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/es_ES/sdk.js"></script>
</body></html>`;
}
