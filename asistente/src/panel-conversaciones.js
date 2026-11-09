// =====================================================================
//  PÁGINA DE CONVERSACIONES DE WHATSAPP  (/admin/conversaciones)
//
//  Solo lectura. Usa la misma contraseña que el panel (ADMIN_CLAVE) y sus acciones
//  "conversaciones" y "conversacion" de /admin/api.
//  Los mensajes de los clientes se pintan siempre como texto (textContent), nunca como HTML.
//  (sin plantillas `${}` ni comillas invertidas dentro del JavaScript de la página)
// =====================================================================

export const PAGINA_CONVERSACIONES = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Conversaciones</title>
<style>
  :root { --verde:#075e54; --verde2:#128c7e; --fondo:#f4f5f7; --tarjeta:#fff; --tinta:#111b21; --gris:#667781; --borde:#d9dde3; --rojo:#b3261e; --ambar:#8a5a00; --ok:#1b7a33;
          --chat:#efeae2; --burbuja-c:#fff; --burbuja-a:#d9fdd3; --burbuja-e:#dbeafe; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--fondo); color: var(--tinta); line-height: 1.4; display: flex; flex-direction: column; }
  header { background: var(--verde); color: #fff; padding: 10px 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  header b { flex: 1; font-size: 1.05rem; min-width: 140px; }
  button, select, input { font: inherit; }
  button { border-radius: 8px; border: 1px solid var(--borde); background: #fff; color: var(--tinta); padding: 7px 12px; cursor: pointer; }
  button.prim { background: var(--verde); color: #fff; border-color: var(--verde); }
  header button { background: rgba(255,255,255,.15); color: #fff; border: 0; }
  input, select { border: 1px solid var(--borde); border-radius: 8px; padding: 8px 10px; background: #fff; width: 100%; }
  #app { flex: 1; display: flex; min-height: 0; }
  #lado { width: 360px; max-width: 100%; border-right: 1px solid var(--borde); background: var(--tarjeta); display: flex; flex-direction: column; min-height: 0; }
  #filtros { padding: 10px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--borde); }
  #lista { flex: 1; overflow-y: auto; }
  .conv { padding: 10px 12px; border-bottom: 1px solid #eef0f3; cursor: pointer; display: block; width: 100%; text-align: left; border-radius: 0; border-left: 0; border-right: 0; border-top: 0; background: #fff; }
  .conv:hover { background: #f5f6f6; } .conv.sel { background: #e9edef; }
  .conv .arriba { display: flex; gap: 8px; align-items: baseline; }
  .conv .nom { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conv .hora { font-size: .75rem; color: var(--gris); white-space: nowrap; }
  .conv .res { font-size: .85rem; color: var(--gris); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .chip { display: inline-block; font-size: .72rem; border-radius: 999px; padding: 1px 8px; margin: 4px 4px 0 0; background: #eef0f3; color: #3b4a54; }
  .chip.amb { background: #fff1d6; color: var(--ambar); } .chip.mal { background: #fde2e1; color: var(--rojo); } .chip.az { background: #dbeafe; color: #1e3a8a; }
  #detalle { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--chat); }
  #cab { background: var(--tarjeta); border-bottom: 1px solid var(--borde); padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  #cab .t { flex: 1; min-width: 0; } #cab small { color: var(--gris); display: block; }
  #volver { display: none; }
  #chat { flex: 1; overflow-y: auto; padding: 14px; }
  .dia { text-align: center; margin: 10px 0; } .dia span { background: #fff; color: var(--gris); font-size: .75rem; padding: 3px 10px; border-radius: 8px; box-shadow: 0 1px 1px rgba(0,0,0,.06); }
  .msg { max-width: min(560px, 85%); padding: 7px 10px 5px; border-radius: 10px; margin: 4px 0; box-shadow: 0 1px 1px rgba(0,0,0,.08); white-space: pre-wrap; overflow-wrap: anywhere; font-size: .92rem; }
  .msg .quien { font-size: .72rem; font-weight: 700; margin-bottom: 2px; }
  .msg .h { font-size: .68rem; color: var(--gris); text-align: right; margin-top: 2px; }
  .msg.cliente { background: var(--burbuja-c); margin-right: auto; } .msg.cliente .quien { color: var(--verde2); }
  .msg.asistente { background: var(--burbuja-a); margin-left: auto; } .msg.asistente .quien { color: var(--verde); }
  .msg.equipo { background: var(--burbuja-e); margin-left: auto; } .msg.equipo .quien { color: #1e3a8a; }
  .msg.aviso, .msg.error { margin: 8px auto; text-align: center; font-size: .82rem; }
  .msg.aviso { background: #fff1d6; color: #5c3d00; } .msg.error { background: #fde2e1; color: #7a1d1a; }
  .vacio { color: var(--gris); text-align: center; padding: 30px 16px; font-size: .92rem; }
  .nota { background: #fff1d6; color: #5c3d00; border-radius: 8px; padding: 8px 10px; font-size: .82rem; margin-bottom: 10px; }
  #login { position: fixed; inset: 0; background: var(--verde); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 9; }
  #login form { background: #fff; border-radius: 14px; padding: 20px; width: min(360px, 100%); display: flex; flex-direction: column; gap: 10px; }
  .error { color: var(--rojo); font-size: .88rem; }
  [hidden] { display: none !important; }
  @media (max-width: 720px) {
    #lado { width: 100%; border-right: 0; }
    #app.abierta #lado { display: none; }
    #app:not(.abierta) #detalle { display: none; }
    #volver { display: inline-block; }
    header .largo { display: none; }
    header b { min-width: 0; }
    header button { padding: 6px 9px; }
  }
</style>
</head>
<body>
<div id="login">
  <form id="fLogin">
    <b>Conversaciones de WhatsApp</b>
    <input id="clave" type="password" placeholder="Contraseña del panel" autocomplete="current-password" required>
    <button class="prim" type="submit">Entrar</button>
    <div id="loginError" class="error"></div>
  </form>
</div>
<header>
  <b>Conversaciones<span class="largo"> de WhatsApp</span></b>
  <button id="bRecargar" type="button">Actualizar</button>
  <button type="button" onclick="location.href='/admin'">Panel</button>
  <button id="bSalir" type="button">Salir</button>
</header>
<div id="app">
  <aside id="lado">
    <div id="filtros">
      <input id="buscar" type="search" placeholder="Buscar nombre, teléfono o texto">
      <select id="lav" hidden></select>
      <form id="fTel" style="display:flex;gap:6px">
        <input id="tel" inputmode="tel" placeholder="Abrir por teléfono (también antiguas)">
        <button type="submit">Abrir</button>
      </form>
      <div id="listaError" class="error"></div>
    </div>
    <div id="lista"></div>
  </aside>
  <section id="detalle">
    <div id="cab" hidden>
      <button id="volver" type="button">←</button>
      <div class="t"><b id="cabNombre"></b><small id="cabInfo"></small></div>
    </div>
    <div id="chat"><div class="vacio">Elige una conversación de la lista.</div></div>
  </section>
</div>
<script>
(function () {
  var clave = "";   // solo al entrar; después vale la sesión del panel (cookie), compartida con todas las pestañas
  var todas = [], lavanderias = [], abierta = null;
  function $(id) { return document.getElementById(id); }
  function el(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }
  var ZONA = "Europe/Madrid";
  function fmt(ms, opciones) { return new Intl.DateTimeFormat("es-ES", Object.assign({ timeZone: ZONA }, opciones)).format(new Date(ms)); }
  function diaDe(ms) { return fmt(ms, { year: "numeric", month: "2-digit", day: "2-digit" }); }
  function hora(ms) { return fmt(ms, { hour: "2-digit", minute: "2-digit" }); }
  function cuandoCorto(ms) {
    if (!ms) return "";
    if (diaDe(ms) === diaDe(Date.now())) return hora(ms);
    return fmt(ms, { day: "numeric", month: "short" });
  }
  function diaLargo(ms) {
    var hoy = diaDe(Date.now()), ayer = diaDe(Date.now() - 86400000), d = diaDe(ms);
    if (d === hoy) return "Hoy";
    if (d === ayer) return "Ayer";
    return fmt(ms, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function bonito(tel) { return tel ? "+" + tel : ""; }

  function api(accion, datos) {
    var cuerpo = JSON.stringify(Object.assign({ accion: accion }, datos || {}));
    var cab = { "Content-Type": "application/json" };
    if (clave) cab["X-Clave"] = clave;
    return fetch("/admin/api", { method: "POST", headers: cab, body: cuerpo, credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._estado = r.status; return j; }); })
      .then(function (j) { if (j._estado === 401) { pedirClave(j.sinSesion ? "" : "Contraseña incorrecta."); } return j; });
  }
  function pedirClave(motivo) {
    clave = "";
    $("login").hidden = false; $("loginError").textContent = motivo || "";
  }

  function cargar() {
    $("listaError").textContent = "";
    return api("conversaciones").then(function (j) {
      if (j._estado === 401) return;
      if (j._estado !== 200) { $("listaError").textContent = j.error || "No se pudo cargar la lista."; return; }
      $("login").hidden = true;
      clave = "";   // a partir de aquí, la sesión
      todas = j.conversaciones || [];
      lavanderias = j.lavanderias || [];
      var sel = $("lav"), antes = sel.value;
      sel.textContent = "";
      sel.appendChild(new Option("Todas las lavanderías", ""));
      lavanderias.forEach(function (l) { sel.appendChild(new Option(l.nombre, l.id)); });
      sel.value = antes;
      sel.hidden = lavanderias.length < 2;
      pintarLista();
      if (abierta) abrir(abierta.cliente, abierta.telefono, true);
    });
  }

  function pintarLista() {
    var q = $("buscar").value.trim().toLowerCase(), lav = $("lav").value;
    var cont = $("lista"); cont.textContent = "";
    var vistas = todas.filter(function (c) {
      if (lav && c.cliente !== lav) return false;
      if (!q) return true;
      return [c.nombre, c.telefono, c.resumen].join(" ").toLowerCase().indexOf(q.replace(/^\\+/, "")) !== -1;
    });
    if (!vistas.length) {
      cont.appendChild(el("div", "vacio", todas.length ? "No hay conversaciones con esa búsqueda." :
        "Todavía no hay conversaciones guardadas. Aparecerán aquí a partir del próximo mensaje de cada cliente. Las anteriores se pueden abrir por teléfono."));
      return;
    }
    vistas.forEach(function (c) {
      var b = el("button", "conv");
      b.type = "button";
      if (abierta && abierta.cliente === c.cliente && abierta.telefono === c.telefono) b.className += " sel";
      var arriba = el("div", "arriba");
      arriba.appendChild(el("span", "nom", c.nombre || bonito(c.telefono)));
      arriba.appendChild(el("span", "hora", cuandoCorto(c.ultimo)));
      b.appendChild(arriba);
      var pre = c.quien === "asistente" ? "Asistente: " : c.quien === "equipo" ? "Equipo: " : c.quien === "error" ? "Error: " : "";
      b.appendChild(el("div", "res", pre + (c.resumen || "")));
      var chips = el("div");
      if (c.nombre) chips.appendChild(el("span", "chip", bonito(c.telefono)));
      if (c.equipo) chips.appendChild(el("span", "chip az", "La atiende el equipo"));
      if (c.avisos) chips.appendChild(el("span", "chip amb", c.avisos === 1 ? "1 aviso" : c.avisos + " avisos"));
      if (c.quien === "error") chips.appendChild(el("span", "chip mal", "Error"));
      if (lavanderias.length > 1) chips.appendChild(el("span", "chip", c.lavanderia));
      b.appendChild(chips);
      b.addEventListener("click", function () { abrir(c.cliente, c.telefono); });
      cont.appendChild(b);
    });
  }

  function abrir(cliente, telefono, quieto) {
    abierta = { cliente: cliente, telefono: telefono };
    $("app").className = "abierta";
    if (!quieto) { $("chat").textContent = ""; $("chat").appendChild(el("div", "vacio", "Cargando…")); }
    pintarLista();
    api("conversacion", { cliente: cliente, telefono: telefono }).then(function (j) {
      if (j._estado === 401) return;
      var chat = $("chat");
      if (j._estado !== 200) { chat.textContent = ""; chat.appendChild(el("div", "vacio", j.error || "No se pudo abrir.")); $("cab").hidden = true; return; }
      abierta.telefono = j.conversacion.telefono;
      pintarConversacion(j.conversacion);
      pintarLista();
    });
  }

  function pintarConversacion(c) {
    var lav = lavanderias.filter(function (l) { return l.id === c.cliente; })[0];
    $("cab").hidden = false;
    $("cabNombre").textContent = c.nombre || bonito(c.telefono);
    var info = [c.nombre ? bonito(c.telefono) : "", c.transcripcion.length + " mensajes", c.equipo ? "la atiende el equipo" : "la atiende el asistente"];
    if (lavanderias.length > 1 && lav) info.push(lav.nombre);
    $("cabInfo").textContent = info.filter(Boolean).join(" · ");
    var chat = $("chat"); chat.textContent = "";
    if (c.antigua) chat.appendChild(el("div", "nota", "Conversación anterior al registro: se ven solo los últimos mensajes que recuerda el asistente, sin fecha ni hora."));
    var ultimoDia = "";
    var nombres = { cliente: c.nombre || "Cliente", asistente: "Asistente", equipo: "Equipo" };
    c.transcripcion.forEach(function (m) {
      if (m.cuando) {
        var d = diaDe(m.cuando);
        if (d !== ultimoDia) { ultimoDia = d; var s = el("div", "dia"); s.appendChild(el("span", null, diaLargo(m.cuando))); chat.appendChild(s); }
      }
      var b = el("div", "msg " + m.quien);
      if (nombres[m.quien]) b.appendChild(el("div", "quien", nombres[m.quien]));
      b.appendChild(el("div", null, m.texto));
      if (m.cuando) b.appendChild(el("div", "h", hora(m.cuando)));
      chat.appendChild(b);
    });
    chat.scrollTop = chat.scrollHeight;
  }

  $("fLogin").addEventListener("submit", function (ev) {
    ev.preventDefault();
    clave = $("clave").value;
    $("loginError").textContent = "";
    cargar();
  });
  $("bSalir").addEventListener("click", function () {
    fetch("/admin/salir", { method: "POST", credentials: "same-origin" }).then(function () { pedirClave(""); }, function () { pedirClave(""); });
  });
  $("bRecargar").addEventListener("click", cargar);
  $("buscar").addEventListener("input", pintarLista);
  $("lav").addEventListener("change", pintarLista);
  $("volver").addEventListener("click", function () { $("app").className = ""; abierta = null; pintarLista(); });
  $("fTel").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = $("tel").value.replace(/\\D/g, "");
    if (!t) return;
    var lav = $("lav").value || (lavanderias[0] && lavanderias[0].id) || "lavanda";
    abrir(lav, t);
  });
  cargar();   // con una sesión abierta (en esta u otra pestaña) entra directamente; si no, pide la contraseña
})();
</script>
</body>
</html>`;
