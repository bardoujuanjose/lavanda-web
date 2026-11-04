// =====================================================================
//  Chat de PRUEBAS del asistente de WhatsApp
//  /prueba          -> página para probar (protegida con contraseña)
//  /prueba/mensaje  -> usa el mismo "cerebro" que WhatsApp, pero no
//                      envía nada: devuelve lo que se habría enviado.
//  Contraseña: secreto PRUEBA_CLAVE en Cloudflare.
// =====================================================================
import Anthropic from "@anthropic-ai/sdk";
import { procesarPendientes, aplicarResultado, RESPUESTA_ERROR } from "./asistente-whatsapp.js";
import { normalizarTelefono } from "./whatsapp.js";

const CLIENTE = "34600000001";
const MAX_FOTO_BASE64 = 6_000_000;

function claveCorrecta(env, recibida) {
  const buena = env.PRUEBA_CLAVE || "";
  const r = String(recibida || "");
  if (!buena || r.length !== buena.length) return false;
  let d = 0;
  for (let i = 0; i < buena.length; i++) d |= buena.charCodeAt(i) ^ r.charCodeAt(i);
  return d === 0;
}

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function base64ABytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// WhatsApp "de mentira": guarda lo que se enviaría en vez de enviarlo
function whatsappDePrueba(dueno, fotos) {
  const salida = { respuestas: [], avisos: [] };
  const wa = {
    async enviarTexto(para, texto) { (para === CLIENTE ? salida.respuestas : salida.avisos).push(texto); },
    async enviarPlantilla(para, nombre, idioma, parametros) { salida.avisos.push(`(plantilla ${nombre}) ${parametros[0]}`); },
    async enviarImagen(para, id, pie) { salida.avisos.push(`[Foto reenviada] ${pie}`); },
    async marcarLeido() {},
    async descargarMedia(id) { return fotos[id]; },
    async subirMedia() { return "foto-prueba"; },
  };
  return { wa, salida };
}

// Historial que manda la página: solo texto, empezando por el cliente
function limpiarHistorial(h) {
  if (!Array.isArray(h)) return [];
  const limpio = h
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 4000)
    .slice(-40)
    .map((m) => ({ role: m.role, content: m.content }));
  while (limpio.length && limpio[0].role !== "user") limpio.shift();
  return limpio;
}

export async function atenderPrueba(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/prueba" && request.method === "GET") {
    return new Response(PAGINA, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (pathname !== "/prueba/mensaje" || request.method !== "POST") return json({ error: "No encontrado" }, 404);

  if (!env.PRUEBA_CLAVE) return json({ error: "Falta configurar el secreto PRUEBA_CLAVE en Cloudflare." }, 503);
  if (!claveCorrecta(env, request.headers.get("X-Clave"))) return json({ error: "Contraseña incorrecta." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Petición no válida." }, 400); }
  const texto = String(body.texto || "").slice(0, 2000);
  const foto = body.foto;
  if (!texto && !foto) return json({ error: "Escribe algo o adjunta una foto." }, 400);
  if (foto && (typeof foto.datos !== "string" || foto.datos.length > MAX_FOTO_BASE64)) return json({ error: "La foto es demasiado grande." }, 400);

  const dueno = normalizarTelefono(env.OWNER_PHONE) || "34600000000";
  const fotos = {};
  const pendientes = [];
  if (foto) {
    fotos.foto1 = { bytes: base64ABytes(foto.datos), tipo: foto.tipo || "image/jpeg" };
    pendientes.push({ id: "p1", tipo: "image", mediaId: "foto1", texto });
  } else {
    pendientes.push({ id: "p1", tipo: "text", texto });
  }

  const avisos = Array.isArray(body.avisosEnviados)
    ? body.avisosEnviados.filter((a) => a && typeof a.clave === "string").slice(-20)
    : [];
  const estado = {
    historial: limpiarHistorial(body.historial),
    pausa: body.pausa ? { desde: Date.now(), ultimoDueno: null } : null,
    avisos,
  };
  const { wa, salida } = whatsappDePrueba(dueno, fotos);
  const claude = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 1,
    timeout: 60_000,
  });

  try {
    const resultado = await procesarPendientes({
      estado, pendientes, telefono: CLIENTE, nombre: String(body.nombre || "").slice(0, 60), wa, claude, env: { ...env, OWNER_PHONE: dueno },
    });
    const nuevo = aplicarResultado(estado, resultado);
    return json({ respuestas: salida.respuestas, avisos: salida.avisos, historial: nuevo.historial, pausa: Boolean(nuevo.pausa), avisosEnviados: nuevo.avisos });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error("Prueba: clave de Claude no válida");
    else if (e instanceof Anthropic.APIError) console.error(`Prueba: error de Claude ${e.status}:`, e.message);
    else console.error("Prueba: error inesperado:", e?.message || e);
    return json({ respuestas: [RESPUESTA_ERROR], avisos: [], historial: estado.historial, pausa: Boolean(estado.pausa), error: "Error al hablar con Claude (mira Observability)." }, 502);
  }
}

// ---------------------------------------------------------------------
//  Página del chat de pruebas
// ---------------------------------------------------------------------
const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Prueba asistente WhatsApp · Lavanda</title>
<style>
  :root { --verde:#075e54; --verde2:#25d366; --fondo:#efeae2; --mio:#d9fdd3; --suyo:#fff; --aviso:#fff4c2; --tinta:#111b21; --gris:#667781; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--fondo); color: var(--tinta); display: flex; flex-direction: column; }
  header { background: var(--verde); color: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  header .t { flex: 1; } header b { display: block; font-size: 1.05rem; } header small { opacity: .85; }
  header button { background: rgba(255,255,255,.15); color: #fff; border: 0; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: .85rem; cursor: pointer; }
  #log { flex: 1; overflow-y: auto; padding: 14px 10px; display: flex; flex-direction: column; gap: 8px; }
  .m { max-width: 82%; padding: 8px 11px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 1px 1px rgba(0,0,0,.08); line-height: 1.4; }
  .yo { align-self: flex-end; background: var(--mio); }
  .bot { align-self: flex-start; background: var(--suyo); }
  .m img { display: block; max-width: 220px; border-radius: 6px; margin-bottom: 4px; }
  .aviso { align-self: center; width: min(92%, 520px); background: var(--aviso); border: 1px solid #e8d27a; border-radius: 10px; padding: 10px 12px; font-size: .92rem; white-space: pre-wrap; }
  .aviso b { display: block; margin-bottom: 4px; }
  .info { align-self: center; background: #e1f2fb; color: #33515e; border-radius: 8px; padding: 6px 10px; font-size: .82rem; text-align: center; max-width: 92%; }
  .escribiendo { align-self: flex-start; color: var(--gris); font-size: .9rem; font-style: italic; }
  #pausa { display: none; background: #fde2e1; color: #7a1d1a; padding: 8px 12px; font-size: .9rem; align-items: center; gap: 10px; }
  #pausa.on { display: flex; } #pausa span { flex: 1; }
  #pausa button { border: 0; background: #7a1d1a; color: #fff; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: .85rem; cursor: pointer; }
  form { display: flex; gap: 8px; padding: 8px; background: #f0f2f5; align-items: flex-end; }
  textarea { flex: 1; resize: none; border: 0; border-radius: 20px; padding: 11px 14px; font: inherit; font-size: 1rem; max-height: 120px; }
  .redondo { width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--verde); color: #fff; font-size: 1.2rem; cursor: pointer; flex-shrink: 0; }
  .clip { background: #fff; color: var(--gris); }
  #fotoInfo { font-size: .8rem; color: var(--gris); padding: 0 12px 4px; background: #f0f2f5; display: none; }
  #login { position: fixed; inset: 0; background: var(--verde); color: #fff; display: flex; align-items: center; justify-content: center; padding: 20px; }
  #login form { background: #fff; color: var(--tinta); flex-direction: column; align-items: stretch; border-radius: 14px; padding: 20px; width: min(360px, 100%); gap: 10px; }
  #login input { padding: 12px; font-size: 1rem; border: 1px solid #ccd; border-radius: 8px; }
  #login button { padding: 12px; font-size: 1rem; border: 0; border-radius: 8px; background: var(--verde); color: #fff; cursor: pointer; }
  #login p { margin: 0; font-size: .9rem; color: var(--gris); }
  #loginError { color: #b3261e !important; }
</style>
</head>
<body>
<header>
  <div class="t"><b>Lavanda · prueba del asistente</b><small>Escribe como si fueras un cliente</small></div>
  <button id="nuevo" type="button">Empezar de cero</button>
</header>
<div id="pausa"><span>⏸️ El equipo está atendiendo: el asistente no contesta y te reenvía los mensajes.</span><button id="fin" type="button">Devolver al asistente</button></div>
<div id="log" role="log" aria-live="polite"></div>
<div id="fotoInfo"></div>
<form id="f">
  <label class="redondo clip" for="foto" title="Adjuntar foto" style="display:grid;place-items:center">📎</label>
  <input id="foto" type="file" accept="image/*" hidden>
  <textarea id="t" rows="1" placeholder="Escribe un mensaje" aria-label="Mensaje"></textarea>
  <button class="redondo" aria-label="Enviar">➤</button>
</form>
<div id="login"><form id="lf">
  <b>Chat de pruebas del asistente de WhatsApp</b>
  <p>Nada de lo que escribas aquí se envía por WhatsApp. Cada respuesta gasta aprox. 1 céntimo de tu saldo de Claude.</p>
  <input id="clave" type="password" placeholder="Contraseña de pruebas" autocomplete="current-password" required>
  <input id="nombre" type="text" placeholder="Nombre del cliente (opcional, p. ej. Ana)">
  <p id="loginError"></p>
  <button>Entrar</button>
</form></div>
<script>
(function () {
  var clave = "", nombre = "", historial = [], avisosEnviados = [], pausa = false, foto = null, ocupado = false;
  var log = document.getElementById("log"), t = document.getElementById("t");
  function añadir(clase, texto, img) {
    var d = document.createElement("div"); d.className = clase;
    if (img) { var i = document.createElement("img"); i.src = img; d.appendChild(i); }
    if (texto) conNegritas(d, texto);
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  // Como WhatsApp: *texto* se ve en negrita
  function conNegritas(destino, texto) {
    var partes = texto.split(/\*([^*\n]+)\*/);
    partes.forEach(function (p, i) {
      if (i % 2) { var b = document.createElement("b"); b.textContent = p; destino.appendChild(b); }
      else if (p) destino.appendChild(document.createTextNode(p));
    });
  }
  function aviso(texto) {
    var d = document.createElement("div"); d.className = "aviso";
    var b = document.createElement("b"); b.textContent = "📲 Aviso que te llegaría a tu móvil:"; d.appendChild(b);
    conNegritas(d, texto); log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function verPausa() { document.getElementById("pausa").classList.toggle("on", pausa); }
  function inicio() {
    log.innerHTML = ""; historial = []; avisosEnviados = []; pausa = false; verPausa();
    añadir("info", "Conversación nueva. Prueba preguntas normales, una incidencia (\\"la 3 se ha quedado con mi dinero\\"), una foto, una queja…");
  }
  document.getElementById("lf").addEventListener("submit", function (e) {
    e.preventDefault(); clave = document.getElementById("clave").value; nombre = document.getElementById("nombre").value.trim();
    document.getElementById("login").style.display = "none"; inicio(); t.focus();
  });
  document.getElementById("nuevo").onclick = inicio;
  document.getElementById("fin").onclick = function () { pausa = false; verPausa(); añadir("info", "✅ El asistente vuelve a atender (como escribir #teléfono fin)."); };

  document.getElementById("foto").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      var max = 1280, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      var dataUrl = c.toDataURL("image/jpeg", 0.85);
      foto = { tipo: "image/jpeg", datos: dataUrl.split(",")[1], vista: dataUrl };
      var fi = document.getElementById("fotoInfo"); fi.style.display = "block"; fi.textContent = "📷 Foto lista para enviar (puedes añadir un texto)";
      URL.revokeObjectURL(url);
    };
    img.src = url; this.value = "";
  });

  document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); enviar(); });
  t.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } });

  function enviar() {
    var texto = t.value.trim(); if ((!texto && !foto) || ocupado) return;
    ocupado = true; t.value = "";
    añadir("m yo", texto, foto && foto.vista);
    var f = foto; foto = null; document.getElementById("fotoInfo").style.display = "none";
    var esp = añadir("escribiendo", pausa ? "(reenviando a tu móvil…)" : "escribiendo…");
    fetch("/prueba/mensaje", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Clave": clave },
      body: JSON.stringify({ texto: texto, foto: f && { tipo: f.tipo, datos: f.datos }, historial: historial, avisosEnviados: avisosEnviados, pausa: pausa, nombre: nombre })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (x) {
        esp.remove();
        if (x.status === 401 || x.status === 503) { añadir("info", "⚠️ " + x.d.error); document.getElementById("login").style.display = "flex"; document.getElementById("loginError").textContent = x.d.error; return; }
        (x.d.avisos || []).forEach(aviso);
        (x.d.respuestas || []).forEach(function (r) { añadir("m bot", r); });
        if (pausa && !(x.d.respuestas || []).length) añadir("info", "El asistente no contesta: el equipo está atendiendo.");
        if (x.d.error) añadir("info", "⚠️ " + x.d.error);
        if (x.d.historial) historial = x.d.historial;
        if (x.d.avisosEnviados) avisosEnviados = x.d.avisosEnviados;
        var antes = pausa; pausa = Boolean(x.d.pausa); verPausa();
        if (pausa && !antes) añadir("info", "⏸️ Ahora el asistente queda en pausa con este cliente hasta que el equipo lo devuelva.");
      })
      .catch(function () { esp.remove(); añadir("info", "⚠️ No se ha podido conectar con el servidor."); })
      .then(function () { ocupado = false; t.focus(); });
  }
})();
</script>
</body>
</html>`;
