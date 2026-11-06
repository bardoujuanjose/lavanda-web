// =====================================================================
//  PANEL DE LAVANDERÍAS  (/admin)
//
//  Dar de alta, editar, conectar y activar lavanderías sin tocar el código.
//    GET  /admin      página del panel
//    POST /admin/api  acciones (JSON { accion, ... }), con la contraseña en la cabecera X-Clave
//
//  Secretos en Cloudflare: ADMIN_CLAVE (contraseña del panel) y CLAVE_CIFRADO (para cifrar tokens).
//  Lavanda es una ficha FIJA (archivo del código): se ve aquí, pero no se edita desde aquí.
// =====================================================================
import { crearTextos } from "./negocio.js";
import { cifrar } from "./cifrado.js";
import { normalizarTelefono } from "./whatsapp.js";
import { FICHA_LAVANDA } from "./clientes/lavanda.js";
import {
  almacenRegistro, prepararRegistro, olvidarCache, idsDeClientes, obtenerCliente, esFija,
  conexionDe, comprobarActivacion, restosDeOtras,
} from "./clientes/index.js";

const MAX_TEXTO = 30_000;
const MAX_INTENTOS = 10;                  // contraseñas falladas por visitante…
const VENTANA_INTENTOS_MS = 10 * 60_000;  // …cada 10 minutos

const SECCIONES = ["general", "precios", "pago", "lavadoras", "secadora", "permitido", "consejos", "fidelizacion", "olvidada"];
const NORMAS_TEXTO = ["procedimientos", "web", "whatsapp", "avisos", "voz"];
const DATOS = [
  "nombre", "ciudad", "direccionCompleta", "direccionCorta", "web", "telefono", "telefonoWhatsapp",
  "horario", "zonaHoraria", "resenaUrl", "equipoCobro", "ejemploNoExiste",
];

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function claveCorrecta(buena, recibida) {
  const r = String(recibida || "");
  if (!buena || r.length !== buena.length) return false;
  let d = 0;
  for (let i = 0; i < buena.length; i++) d |= buena.charCodeAt(i) ^ r.charCodeAt(i);
  return d === 0;
}

const fallos = new Map();
function bloqueado(ip, ahora) {
  const lista = (fallos.get(ip) || []).filter((t) => ahora - t < VENTANA_INTENTOS_MS);
  fallos.set(ip, lista);
  return lista.length >= MAX_INTENTOS;
}
function anotarFallo(ip, ahora) {
  fallos.set(ip, [...(fallos.get(ip) || []), ahora]);
  if (fallos.size > 5000) fallos.clear();
}

const texto = (v, max = MAX_TEXTO) => (typeof v === "string" ? v.slice(0, max) : "");
const lineas = (v) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);

// Construye una ficha SOLO con los campos conocidos (lo que mande el navegador no se guarda tal cual)
export function limpiarFicha(entrada) {
  const e = entrada || {};
  const ficha = { id: String(e.id || "").trim().toLowerCase() };
  for (const k of DATOS) ficha[k] = texto(e[k], 300).trim();
  ficha.origenesPermitidos = lineas(e.origenesPermitidos);
  ficha.numerosVoz = lineas(e.numerosVoz).map((n) => n.replace(/[^\d+]/g, ""));
  const pl = e.plantillaAviso || {};
  if (texto(pl.nombre, 100).trim()) ficha.plantillaAviso = { nombre: texto(pl.nombre, 100).trim(), idioma: texto(pl.idioma, 10).trim() || "es" };
  ficha.conocimiento = {};
  for (const k of SECCIONES) ficha.conocimiento[k] = texto(e.conocimiento?.[k]).trim() ? texto(e.conocimiento[k]) : null;
  const n = e.normas || {};
  ficha.normas = {};
  for (const k of NORMAS_TEXTO) ficha.normas[k] = texto(n[k]);
  ficha.normas.motivosAviso = (Array.isArray(n.motivosAviso) ? n.motivosAviso : []).slice(0, 10).map((m) => ({
    clave: texto(m?.clave, 40).trim(), nombre: texto(m?.nombre, 60).trim(), titulo: texto(m?.titulo, 120).trim(),
  })).filter((m) => m.clave);
  const h = n.herramientaAviso || {};
  ficha.normas.herramientaAviso = { cuando: texto(h.cuando, 1000).trim(), importe: texto(h.importe, 300).trim(), telefono: texto(h.telefono, 300).trim() };
  return ficha;
}

// Comprobaciones que no cubre la plantilla
function erroresDeFormato(ficha) {
  const errores = [];
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(ficha.id)) errores.push("El identificador debe tener de 2 a 30 letras minúsculas, números o guiones (por ejemplo: pepito-reus).");
  for (const m of ficha.normas.motivosAviso) if (!/^[a-z_]{2,40}$/.test(m.clave)) errores.push(`El motivo de aviso "${m.clave}" solo puede llevar letras minúsculas y guiones bajos.`);
  for (const o of ficha.origenesPermitidos) if (!/^https?:\/\/[^/\s]+$/.test(o)) errores.push(`La web "${o}" debe ser como https://ejemplo.es (sin nada detrás).`);
  for (const v of ficha.numerosVoz) if (!/^\+\d{8,15}$/.test(v)) errores.push(`El número de voz "${v}" debe ser como +34977000111.`);
  if (ficha.telefonoWhatsapp && !/^\d{8,15}$/.test(ficha.telefonoWhatsapp)) errores.push("El teléfono para enlaces de WhatsApp va solo con cifras y prefijo (por ejemplo 34977000111).");
  try { new Intl.DateTimeFormat("es-ES", { timeZone: ficha.zonaHoraria || "x" }); } catch { errores.push("La zona horaria no es válida (normalmente Europe/Madrid)."); }
  return errores;
}

// ¿Se pueden montar los asistentes con esta ficha?
function validar(ficha) {
  const errores = erroresDeFormato(ficha);
  try { crearTextos(ficha); } catch (e) { errores.push(e.message); }
  return errores;
}

// Lo que el panel puede ver de una ficha guardada: nunca el token
function paraElPanel(guardada) {
  const { conexion, ...resto } = guardada;
  return {
    ...resto,
    conexion: conexion ? { phoneId: conexion.phoneId || "", dueno: conexion.dueno || "", tieneToken: Boolean(conexion.tokenCifrado), wabaId: conexion.wabaId || "" } : null,
  };
}

// Ficha nueva: datos vacíos y, como punto de partida, las secciones y normas de Lavanda
// (con sus huecos {{telefono}}, {{horario}}… que se rellenarán con los datos de la nueva)
function plantillaNueva() {
  return {
    id: "", nombre: "", ciudad: "", direccionCompleta: "", direccionCorta: "", web: "", telefono: "", telefonoWhatsapp: "",
    horario: "", zonaHoraria: "Europe/Madrid", resenaUrl: "", equipoCobro: FICHA_LAVANDA.equipoCobro, ejemploNoExiste: FICHA_LAVANDA.ejemploNoExiste,
    origenesPermitidos: [], numerosVoz: [],
    conocimiento: structuredClone(FICHA_LAVANDA.conocimiento),
    normas: structuredClone(FICHA_LAVANDA.normas),
    activa: false, conexion: null,
  };
}

// ---------------------------------------------------------------------
//  Acciones
// ---------------------------------------------------------------------
async function accion(datos, env) {
  const almacen = almacenRegistro(env);
  if (!almacen) return json({ error: "Falta la base de datos (REGISTRO) en la configuración del servidor." }, 503);
  await prepararRegistro(env, { forzar: true });

  const leerGuardada = async (id) => {
    if (esFija(id)) return null;
    return almacen.leer(String(id || ""));
  };
  const recargar = async () => { olvidarCache(); await prepararRegistro(env, { forzar: true }); };

  switch (datos.accion) {
    case "listar": {
      const lista = idsDeClientes().map((id) => {
        const c = obtenerCliente(env, id);
        const con = conexionDe(env, c);
        return {
          id, nombre: c.ficha.nombre, ciudad: c.ficha.ciudad, fija: esFija(id), activa: c.ficha.activa !== false,
          conectada: Boolean(con.phoneId && con.token && con.dueno), numerosVoz: c.ficha.numerosVoz, webs: c.ficha.origenesPermitidos,
        };
      });
      // Las guardadas que no son válidas no están en el registro: se enseñan para poder arreglarlas
      for (const g of await almacen.listar()) {
        if (!lista.some((x) => x.id === g.id)) lista.push({ id: g.id, nombre: g.nombre || g.id, ciudad: g.ciudad || "", fija: false, activa: false, conectada: false, invalida: true, numerosVoz: [], webs: [] });
      }
      return json({ lavanderias: lista, cifradoListo: Boolean(env.CLAVE_CIFRADO && String(env.CLAVE_CIFRADO).length >= 16) });
    }

    case "plantilla":
      return json({ ficha: plantillaNueva() });

    case "leer": {
      if (esFija(datos.id)) {
        const { secretos, prefijoMemoria, ...ficha } = obtenerCliente(env, datos.id).ficha;
        return json({ ficha: { ...ficha, activa: true }, fija: true });
      }
      const g = await leerGuardada(datos.id);
      if (!g) return json({ error: "No existe esa lavandería." }, 404);
      return json({ ficha: paraElPanel(g), fija: false });
    }

    case "vista": {
      const ficha = limpiarFicha(datos.ficha);
      if (!ficha.id) ficha.id = "vista-previa";
      const errores = validar(ficha);
      if (errores.length) return json({ errores }, 422);
      const t = crearTextos(ficha);
      return json({ whatsapp: t.INSTRUCCIONES_WHATSAPP, web: t.INSTRUCCIONES_WEB, voz: t.INSTRUCCIONES_VOZ, saludo: t.SALUDO_VOZ });
    }

    case "guardar": {
      const ficha = limpiarFicha(datos.ficha);
      if (esFija(ficha.id)) return json({ errores: [`"${ficha.id}" es una lavandería fija: se edita en el código.`] }, 409);
      const errores = validar(ficha);
      if (errores.length) return json({ errores }, 422);
      const anterior = await leerGuardada(ficha.id);
      if (datos.nueva && anterior) return json({ errores: [`Ya existe una lavandería con el identificador "${ficha.id}".`] }, 409);
      // La conexión y el estado no se cambian al guardar los datos: tienen sus propias acciones
      const guardar = { ...ficha, activa: anterior?.activa === true, conexion: anterior?.conexion || null, actualizada: new Date().toISOString() };
      // Si ya está activa, el cambio se aplica al momento: no puede dejarla en conflicto con otra lavandería
      if (guardar.activa) {
        const con = guardar.conexion ? { ...guardar.conexion, token: guardar.conexion.tokenCifrado ? "(cifrado)" : "" } : null;
        const { errores: conflictos } = comprobarActivacion(env, { ficha: { ...guardar, conexion: con } });
        if (conflictos.length) return json({ errores: ["Está activa y este cambio la dejaría mal configurada:", ...conflictos] }, 409);
      }
      await almacen.guardar(guardar);
      await recargar();
      return json({ ok: true, avisos: restosDeOtras(ficha).map((r) => `Parece que quedan datos de ${r.de}: "${r.texto}".`) });
    }

    case "conexion": {
      const g = await leerGuardada(datos.id);
      if (!g) return json({ error: "No existe esa lavandería (o es fija)." }, 404);
      const phoneId = String(datos.phoneId || "").trim();
      const dueno = normalizarTelefono(datos.dueno);
      const token = String(datos.token || "").trim();
      const errores = [];
      if (!/^\d{6,25}$/.test(phoneId)) errores.push("El identificador del número de WhatsApp va solo con cifras (lo da Meta).");
      if (!/^\d{11,15}$/.test(dueno)) errores.push("El móvil del dueño no es válido.");
      if (!token && !g.conexion?.tokenCifrado) errores.push("Falta el token de WhatsApp.");
      if (token && !(env.CLAVE_CIFRADO && String(env.CLAVE_CIFRADO).length >= 16)) errores.push("Falta el secreto CLAVE_CIFRADO en Cloudflare: sin él no se pueden guardar tokens.");
      if (errores.length) return json({ errores }, 422);
      const conexion = {
        phoneId, dueno,
        wabaId: String(datos.wabaId || g.conexion?.wabaId || "").replace(/\D/g, ""),
        tokenCifrado: token ? await cifrar(token, env.CLAVE_CIFRADO) : g.conexion.tokenCifrado,
        actualizada: new Date().toISOString(),
      };
      await almacen.guardar({ ...g, conexion });
      await recargar();
      return json({ ok: true });
    }

    case "activar": {
      if (esFija(datos.id)) return json({ errores: ["Las lavanderías fijas siempre están activas."] }, 409);
      const g = await leerGuardada(datos.id);
      if (!g) return json({ error: "No existe esa lavandería." }, 404);
      if (!datos.activa) {
        await almacen.guardar({ ...g, activa: false });
        await recargar();
        return json({ ok: true });
      }
      if (!idsDeClientes().includes(g.id)) return json({ errores: ["La ficha tiene errores: ábrela y guárdala de nuevo."] }, 422);
      const { errores, avisos } = comprobarActivacion(env, obtenerCliente(env, g.id));
      if (errores.length) return json({ errores, avisos }, 409);
      await almacen.guardar({ ...g, activa: true });
      await recargar();
      return json({ ok: true, avisos });
    }

    case "borrar": {
      const g = await leerGuardada(datos.id);
      if (!g) return json({ error: "No existe esa lavandería (o es fija)." }, 404);
      if (g.activa) return json({ errores: ["Desactívala antes de borrarla."] }, 409);
      await almacen.borrar(g.id);
      await recargar();
      return json({ ok: true });
    }

    default:
      return json({ error: "Acción desconocida." }, 400);
  }
}

// ---------------------------------------------------------------------
//  Entrada
// ---------------------------------------------------------------------
export async function atenderAdmin(request, env, ahora = Date.now()) {
  const { pathname } = new URL(request.url);
  if (pathname === "/admin" && request.method === "GET") {
    return new Response(PAGINA, {
      headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (pathname !== "/admin/api" || request.method !== "POST") return json({ error: "No encontrado" }, 404);
  if (!env.ADMIN_CLAVE) return json({ error: "Falta configurar el secreto ADMIN_CLAVE en Cloudflare." }, 503);

  const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
  if (bloqueado(ip, ahora)) return json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
  if (!claveCorrecta(env.ADMIN_CLAVE, request.headers.get("X-Clave"))) {
    anotarFallo(ip, ahora);
    return json({ error: "Contraseña incorrecta." }, 401);
  }
  let datos;
  try { datos = await request.json(); } catch { return json({ error: "Petición no válida." }, 400); }
  try {
    return await accion(datos || {}, env);
  } catch (e) {
    console.error("Panel: error:", e?.message || e);
    return json({ error: "Error del servidor: " + (e?.message || e) }, 500);
  }
}

// ---------------------------------------------------------------------
//  Página del panel (sin plantillas `${}` dentro del JavaScript de la página)
// ---------------------------------------------------------------------
const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Panel de lavanderías</title>
<style>
  :root { --verde:#075e54; --verde2:#128c7e; --fondo:#f4f5f7; --tarjeta:#fff; --tinta:#111b21; --gris:#667781; --borde:#d9dde3; --rojo:#b3261e; --ambar:#8a5a00; --ok:#1b7a33; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--fondo); color: var(--tinta); line-height: 1.45; }
  header { background: var(--verde); color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 3; }
  header b { flex: 1; font-size: 1.05rem; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  button { font: inherit; border-radius: 8px; border: 1px solid var(--borde); background: #fff; color: var(--tinta); padding: 8px 12px; cursor: pointer; }
  button.prim { background: var(--verde); color: #fff; border-color: var(--verde); }
  button.peligro { color: var(--rojo); border-color: #e7b4b0; }
  button:disabled { opacity: .5; cursor: default; }
  header button { background: rgba(255,255,255,.15); color: #fff; border: 0; }
  .tarjeta { background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
  .fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .fila .t { flex: 1; min-width: 180px; }
  .fila small { color: var(--gris); display: block; }
  .chip { display: inline-block; font-size: .78rem; border-radius: 999px; padding: 2px 9px; margin-right: 4px; background: #eef0f3; color: #3b4a54; }
  .chip.ok { background: #e3f4e7; color: var(--ok); } .chip.mal { background: #fde2e1; color: var(--rojo); } .chip.amb { background: #fff1d6; color: var(--ambar); }
  h2 { font-size: 1.05rem; margin: 22px 0 8px; }
  h2:first-child { margin-top: 0; }
  label { display: block; font-size: .88rem; font-weight: 600; margin: 10px 0 4px; }
  label small { font-weight: 400; color: var(--gris); }
  input, textarea { width: 100%; font: inherit; font-size: .95rem; border: 1px solid var(--borde); border-radius: 8px; padding: 9px 10px; background: #fff; }
  textarea { min-height: 90px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; }
  textarea.grande { min-height: 260px; }
  input:disabled, textarea:disabled { background: #f3f4f6; color: #444; }
  .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0 14px; }
  .mensajes { margin: 10px 0; }
  .mensajes div { border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; font-size: .9rem; }
  .mensajes .error { background: #fde2e1; color: #7a1d1a; } .mensajes .aviso { background: #fff1d6; color: #5c3d00; } .mensajes .bien { background: #e3f4e7; color: #14532d; }
  .barra { position: sticky; bottom: 0; background: var(--fondo); padding: 10px 0; display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--borde); }
  #login { position: fixed; inset: 0; background: var(--verde); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 9; }
  #login form { background: #fff; border-radius: 14px; padding: 20px; width: min(360px, 100%); display: flex; flex-direction: column; gap: 10px; }
  #vista { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 8; }
  #vista[hidden], #login[hidden], [hidden] { display: none !important; }
  #vista .caja { background: #fff; border-radius: 12px; width: min(900px, 100%); max-height: 90vh; display: flex; flex-direction: column; }
  #vista pre { margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; font-size: .82rem; flex: 1; }
  #vista .fila { padding: 10px 14px; border-bottom: 1px solid var(--borde); }
  .ayuda { color: var(--gris); font-size: .88rem; margin: 4px 0 10px; }
</style>
</head>
<body>
<div id="login"><form id="fLogin">
  <b>Panel de lavanderías</b>
  <input id="clave" type="password" placeholder="Contraseña" autocomplete="current-password" required>
  <button class="prim">Entrar</button>
  <span id="loginError" style="color:#b3261e;font-size:.9rem"></span>
</form></div>

<header><b>Panel de lavanderías</b><button id="bSalir" type="button">Salir</button></header>
<main>
  <section id="vLista">
    <div class="fila" style="margin-bottom:12px"><div class="t"><small>Lavanda es fija (se edita en el código). Las demás se gestionan aquí.</small></div>
      <button class="prim" id="bNueva" type="button">+ Nueva lavandería</button></div>
    <div id="avisoCifrado" class="mensajes"></div>
    <div id="lista"></div>
  </section>

  <section id="vEditor" hidden>
    <div class="fila"><button id="bVolver" type="button">← Volver</button><div class="t"><b id="tituloEditor"></b></div></div>
    <div id="msgEditor" class="mensajes"></div>
    <form id="fFicha"></form>
    <div class="tarjeta" id="tarjetaConexion">
      <h2>Conexión de WhatsApp</h2>
      <p class="ayuda">El número de WhatsApp de esta lavandería. El token se guarda cifrado y no se vuelve a mostrar.</p>
      <div class="rejilla">
        <div><label>Identificador del número (Meta) <small>phone_number_id</small></label><input id="cPhone" inputmode="numeric"></div>
        <div><label>Móvil del dueño <small>recibe los avisos</small></label><input id="cDueno" inputmode="tel"></div>
        <div><label>Token de WhatsApp <small id="cTokenInfo"></small></label><input id="cToken" type="password" autocomplete="off"></div>
      </div>
      <div class="fila" style="margin-top:10px"><button id="bConexion" type="button">Guardar conexión</button><span id="cEstado" class="chip"></span></div>
    </div>
    <div class="barra">
      <button class="prim" id="bGuardar" type="button">Guardar</button>
      <button id="bVista" type="button">Vista previa de las instrucciones</button>
    </div>
  </section>
</main>

<div id="vista" hidden><div class="caja">
  <div class="fila"><div class="t"><b>Vista previa</b></div>
    <button type="button" data-v="whatsapp">WhatsApp</button><button type="button" data-v="voz">Voz</button><button type="button" data-v="web">Web</button>
    <button type="button" id="bCerrarVista">Cerrar</button></div>
  <pre id="vistaTexto"></pre>
</div></div>

<script>
(function () {
  var clave = "";
  try { clave = sessionStorage.getItem("adminClave") || ""; } catch (e) {}
  var actual = null;     // ficha que se edita
  var esNueva = false, esFija = false, vistaDatos = null;

  var CAMPOS = [
    ["Datos de la lavandería", [
      ["id", "Identificador", "Corto, sin espacios: pepito-reus. No se puede cambiar después."],
      ["nombre", "Nombre", "Como se presenta el asistente: Lavandería Pepito"],
      ["ciudad", "Ciudad", ""],
      ["direccionCompleta", "Dirección completa", "Con código postal"],
      ["direccionCorta", "Dirección corta", "Sin código postal"],
      ["web", "Web", "Sin https:// (pepitolava.es)"],
      ["telefono", "Teléfono de atención", "Como se dice: 977 000 111"],
      ["telefonoWhatsapp", "Teléfono para enlaces", "Solo cifras con prefijo: 34977000111"],
      ["horario", "Horario", "Como frase: de 8:00 a 21:00"],
      ["zonaHoraria", "Zona horaria", "Normalmente Europe/Madrid"],
      ["resenaUrl", "Enlace de reseñas de Google", ""],
      ["equipoCobro", "Con qué se paga", "Frase corta: del cajero / del lector de tarjetas"],
      ["ejemploNoExiste", "Algo que el asistente no debe inventar", "no existe ninguna máquina de cambio"]
    ]],
    ["Conexiones", [
      ["origenesPermitidos", "Webs donde va el chat", "Una por línea: https://pepitolava.es", "lista"],
      ["numerosVoz", "Números de voz (Twilio)", "Uno por línea: +34977000111", "lista"],
      ["plantillaAviso.nombre", "Plantilla de aviso al dueño (Meta)", "Nombre de la plantilla aprobada en SU cuenta de WhatsApp"],
      ["plantillaAviso.idioma", "Idioma de la plantilla", "es"]
    ]],
    ["Lo que sabe el asistente", [
      ["conocimiento.general", "Información general", "Obligatoria", "texto"],
      ["conocimiento.precios", "Precios y máquinas", "Obligatoria", "texto"],
      ["conocimiento.pago", "Forma de pago", "Obligatoria", "texto"],
      ["conocimiento.lavadoras", "Cómo usar las lavadoras", "Vacía si no aplica", "texto"],
      ["conocimiento.secadora", "Cómo usar la secadora", "", "texto"],
      ["conocimiento.permitido", "Qué se puede lavar", "", "texto"],
      ["conocimiento.consejos", "Consejos y servicios", "", "texto"],
      ["conocimiento.fidelizacion", "Tarjeta de fidelización", "", "texto"],
      ["conocimiento.olvidada", "Ropa olvidada", "", "texto"]
    ]],
    ["Normas: cómo resuelve los problemas", [
      ["normas.procedimientos", "Problemas con máquinas, dinero y devoluciones", "Lo más importante: depende de cómo cobra esta lavandería", "grande"],
      ["normas.web", "Chat de la web: qué hace ante un problema", "", "texto"],
      ["normas.whatsapp", "WhatsApp: cuándo sugerir llamar y qué no prometer", "", "texto"],
      ["normas.avisos", "WhatsApp: cuándo avisar al equipo", "", "texto"],
      ["normas.voz", "Voz: adaptaciones al teléfono", "", "grande"],
      ["normas.motivosAviso", "Motivos de aviso al dueño", "Uno por línea: clave | nombre | título del mensaje", "motivos"],
      ["normas.herramientaAviso.cuando", "Cuándo se avisa (para la herramienta)", "", "texto"],
      ["normas.herramientaAviso.importe", "Qué es el importe", ""],
      ["normas.herramientaAviso.telefono", "Qué es el teléfono", ""]
    ]]
  ];

  function $(id) { return document.getElementById(id); }
  function el(tag, props, hijos) {
    var e = document.createElement(tag);
    for (var k in (props || {})) { if (k === "texto") e.textContent = props[k]; else e.setAttribute(k, props[k]); }
    (hijos || []).forEach(function (h) { if (h) e.appendChild(h); });
    return e;
  }
  function mensajes(caja, lista, tipo) {
    (lista || []).forEach(function (m) { caja.appendChild(el("div", { "class": tipo, texto: m })); });
  }
  function leer(obj, ruta) { return ruta.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); }
  function poner(obj, ruta, valor) {
    var p = ruta.split("."), o = obj;
    for (var i = 0; i < p.length - 1; i++) { o[p[i]] = o[p[i]] || {}; o = o[p[i]]; }
    o[p[p.length - 1]] = valor;
  }

  function api(accion, datos) {
    var cuerpo = JSON.stringify(Object.assign({ accion: accion }, datos || {}));
    return fetch("/admin/api", { method: "POST", headers: { "Content-Type": "application/json", "X-Clave": clave }, body: cuerpo })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._estado = r.status; return j; }); })
      .then(function (j) { if (j._estado === 401) { salir("Contraseña incorrecta."); } return j; });
  }

  function salir(motivo) {
    clave = ""; try { sessionStorage.removeItem("adminClave"); } catch (e) {}
    $("login").hidden = false; $("loginError").textContent = motivo || "";
  }

  $("fLogin").addEventListener("submit", function (ev) {
    ev.preventDefault();
    clave = $("clave").value;
    api("listar").then(function (j) {
      if (j._estado === 200) { try { sessionStorage.setItem("adminClave", clave); } catch (e) {} $("login").hidden = true; pintarLista(j); }
      else if (j._estado !== 401) { $("loginError").textContent = j.error || "No se pudo entrar."; }
    });
  });
  $("bSalir").addEventListener("click", function () { salir(""); });

  // ---------- Lista ----------
  function cargarLista() { api("listar").then(function (j) { if (j._estado === 200) pintarLista(j); }); }
  function pintarLista(j) {
    $("vEditor").hidden = true; $("vLista").hidden = false;
    var caja = $("lista"); caja.textContent = "";
    $("avisoCifrado").textContent = "";
    if (!j.cifradoListo) mensajes($("avisoCifrado"), ["Falta el secreto CLAVE_CIFRADO en Cloudflare: sin él no se pueden guardar tokens de WhatsApp."], "aviso");
    (j.lavanderias || []).forEach(function (l) {
      var chips = el("div", {}, [
        el("span", { "class": "chip " + (l.activa ? "ok" : "amb"), texto: l.activa ? "Activa" : "Borrador" }),
        l.fija ? el("span", { "class": "chip", texto: "Fija" }) : null,
        el("span", { "class": "chip " + (l.conectada ? "ok" : "mal"), texto: l.conectada ? "WhatsApp conectado" : "WhatsApp sin conectar" }),
        el("span", { "class": "chip", texto: l.numerosVoz.length ? "Voz: " + l.numerosVoz.join(", ") : "Sin voz" }),
        l.invalida ? el("span", { "class": "chip mal", texto: "Ficha con errores" }) : null
      ]);
      var acciones = el("div", { "class": "fila" });
      acciones.appendChild(boton(l.fija ? "Ver" : "Editar", function () { abrir(l.id); }));
      if (!l.fija) {
        acciones.appendChild(boton(l.activa ? "Desactivar" : "Activar", function () { activar(l, !l.activa); }, l.activa ? "" : "prim"));
        if (!l.activa) acciones.appendChild(boton("Borrar", function () { borrar(l); }, "peligro"));
      }
      var msg = el("div", { "class": "mensajes" });
      caja.appendChild(el("div", { "class": "tarjeta" }, [
        el("div", { "class": "fila" }, [el("div", { "class": "t" }, [el("b", { texto: l.nombre }), el("small", { texto: (l.ciudad || "") + " · " + l.id })]), acciones]),
        chips, msg
      ]));
      l._msg = msg;
    });
  }
  function boton(texto, fn, clase) { var b = el("button", { type: "button", "class": clase || "", texto: texto }); b.addEventListener("click", fn); return b; }

  function activar(l, activa) {
    api("activar", { id: l.id, activa: activa }).then(function (j) {
      if (j._estado === 200) { cargarLista(); if (j.avisos && j.avisos.length) setTimeout(function () { alert("Activada. Ten en cuenta:\\n\\n- " + j.avisos.join("\\n- ")); }, 50); return; }
      l._msg.textContent = "";
      mensajes(l._msg, j.errores || [j.error], "error"); mensajes(l._msg, j.avisos, "aviso");
    });
  }
  function borrar(l) {
    if (!confirm("¿Borrar " + l.nombre + "? No se puede deshacer.")) return;
    api("borrar", { id: l.id }).then(function (j) { if (j._estado === 200) cargarLista(); else { l._msg.textContent = ""; mensajes(l._msg, j.errores || [j.error], "error"); } });
  }

  // ---------- Editor ----------
  $("bNueva").addEventListener("click", function () {
    api("plantilla").then(function (j) { esNueva = true; esFija = false; editar(j.ficha); });
  });
  $("bVolver").addEventListener("click", cargarLista);
  // (bien/avisos: mensajes que se enseñan después de abrirla, por ejemplo "Guardado.")
  function abrir(id, bien, avisos) {
    api("leer", { id: id }).then(function (j) {
      if (j._estado !== 200) { alert(j.error || "No se pudo abrir."); return; }
      esNueva = false; esFija = j.fija; editar(j.ficha);
      mensajes($("msgEditor"), bien, "bien"); mensajes($("msgEditor"), avisos, "aviso");
    });
  }

  function editar(ficha) {
    actual = ficha;
    $("vLista").hidden = true; $("vEditor").hidden = false; $("msgEditor").textContent = "";
    $("tituloEditor").textContent = esNueva ? "Nueva lavandería" : (ficha.nombre + (esFija ? " (fija: solo lectura)" : ""));
    if (esNueva) mensajes($("msgEditor"), ["Las secciones y normas vienen copiadas de Lavanda como punto de partida: cámbialas por las de esta lavandería (sobre todo cómo cobra y cómo devuelve el dinero). Los huecos como {{telefono}} se rellenan solos con sus datos."], "aviso");
    var f = $("fFicha"); f.textContent = "";
    CAMPOS.forEach(function (grupo) {
      var t = el("div", { "class": "tarjeta" }, [el("h2", { texto: grupo[0] })]);
      var rejilla = el("div", { "class": grupo[1][0][3] ? "" : "rejilla" });
      grupo[1].forEach(function (c) {
        var ruta = c[0], tipo = c[3] || "linea", valor = leer(ficha, ruta), campo;
        if (tipo === "linea") campo = el("input", { "data-ruta": ruta });
        else campo = el("textarea", { "data-ruta": ruta, "data-tipo": tipo, "class": tipo === "grande" ? "grande" : "" });
        if (tipo === "lista") campo.value = (valor || []).join("\\n");
        else if (tipo === "motivos") campo.value = (valor || []).map(function (m) { return [m.clave, m.nombre, m.titulo].join(" | "); }).join("\\n");
        else campo.value = valor == null ? "" : valor;
        if (esFija || (ruta === "id" && !esNueva)) campo.disabled = true;
        rejilla.appendChild(el("div", {}, [el("label", {}, [document.createTextNode(c[1] + " "), c[2] ? el("small", { texto: c[2] }) : null]), campo]));
      });
      t.appendChild(rejilla); f.appendChild(t);
    });
    $("bGuardar").hidden = esFija;
    $("tarjetaConexion").hidden = esFija || esNueva;
    var con = ficha.conexion || {};
    $("cPhone").value = con.phoneId || ""; $("cDueno").value = con.dueno || ""; $("cToken").value = "";
    $("cTokenInfo").textContent = con.tieneToken ? "(guardado; déjalo vacío para mantenerlo)" : "(todavía no hay)";
    $("cEstado").textContent = con.tieneToken && con.phoneId ? "Conectado" : "Sin conectar";
    $("cEstado").className = "chip " + (con.tieneToken && con.phoneId ? "ok" : "mal");
    window.scrollTo(0, 0);
  }

  function leerFormulario() {
    var ficha = {};
    document.querySelectorAll("#fFicha [data-ruta]").forEach(function (c) {
      var tipo = c.getAttribute("data-tipo"), v = c.value;
      if (tipo === "lista") v = v.split("\\n").map(function (x) { return x.trim(); }).filter(Boolean);
      if (tipo === "motivos") v = v.split("\\n").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
        var p = x.split("|").map(function (y) { return y.trim(); }); return { clave: p[0] || "", nombre: p[1] || "", titulo: p[2] || "" };
      });
      poner(ficha, c.getAttribute("data-ruta"), v);
    });
    return ficha;
  }

  $("bGuardar").addEventListener("click", function () {
    var b = this; b.disabled = true;
    var ficha = leerFormulario();
    api("guardar", { ficha: ficha, nueva: esNueva }).then(function (j) {
      b.disabled = false; $("msgEditor").textContent = "";
      if (j._estado !== 200) { mensajes($("msgEditor"), j.errores || [j.error], "error"); window.scrollTo(0, 0); return; }
      if (esNueva) { esNueva = false; abrir(ficha.id, ["Guardada como borrador. Ahora conecta su WhatsApp (abajo) y, desde la lista, actívala."], j.avisos); return; }
      mensajes($("msgEditor"), ["Guardado."], "bien"); mensajes($("msgEditor"), j.avisos, "aviso");
      window.scrollTo(0, 0);
    });
  });

  $("bConexion").addEventListener("click", function () {
    var b = this; b.disabled = true;
    api("conexion", { id: actual.id, phoneId: $("cPhone").value, dueno: $("cDueno").value, token: $("cToken").value }).then(function (j) {
      b.disabled = false; $("msgEditor").textContent = "";
      if (j._estado !== 200) { mensajes($("msgEditor"), j.errores || [j.error], "error"); window.scrollTo(0, 0); return; }
      abrir(actual.id, ["Conexión guardada."]);
    });
  });

  // ---------- Vista previa ----------
  $("bVista").addEventListener("click", function () {
    api("vista", { ficha: leerFormulario() }).then(function (j) {
      $("msgEditor").textContent = "";
      if (j._estado !== 200) { mensajes($("msgEditor"), j.errores || [j.error], "error"); window.scrollTo(0, 0); return; }
      vistaDatos = j; mostrarVista("whatsapp"); $("vista").hidden = false;
    });
  });
  function mostrarVista(cual) { $("vistaTexto").textContent = cual === "voz" ? "Saludo: " + vistaDatos.saludo + "\\n\\n" + vistaDatos.voz : vistaDatos[cual]; }
  document.querySelectorAll("#vista [data-v]").forEach(function (b) { b.addEventListener("click", function () { mostrarVista(b.getAttribute("data-v")); }); });
  $("bCerrarVista").addEventListener("click", function () { $("vista").hidden = true; });

  if (clave) { api("listar").then(function (j) { if (j._estado === 200) { $("login").hidden = true; pintarLista(j); } }); }
})();
</script>
</body>
</html>`;
