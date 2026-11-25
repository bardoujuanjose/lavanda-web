/* =====================================================================
   Chat del asistente de Lavanda
   Se activa cuando la etiqueta <script> tiene la dirección del
   servidor en data-endpoint. Si está vacía, no se muestra nada.
   ===================================================================== */
(function () {
  "use strict";
  var script = document.currentScript;
  var ENDPOINT = script && script.getAttribute("data-endpoint");
  if (!ENDPOINT) return;

  var WHATSAPP = "34689810213";
  var MAX_HISTORIAL = 19;          // el servidor admite 20 mensajes como máximo
  var CLAVE = "lavanda-chat";
  var SALUDO = "¡Hola! Soy el asistente de Lavanda 💜 Pregúntame por precios, horario o cómo funcionan las máquinas. Si tienes algún problema, te paso con el equipo por WhatsApp.";
  var SUGERENCIAS = ["¿Cuánto cuesta lavar?", "¿Cómo funciona?", "¿Qué no puedo lavar?", "Tengo un problema con una máquina"];

  var historial = cargar();
  var enviando = false;

  // ---------- Construcción de la interfaz ----------
  document.documentElement.classList.add("has-chat");

  var lanzador = el("button", { class: "lc-launcher", type: "button", "aria-label": "Abrir el asistente de Lavanda", "aria-expanded": "false" });
  lanzador.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>';
  var globo = el("span", { class: "lc-teaser", "aria-hidden": "true" }, "¿Dudas? Pregúntame");

  var panel = el("section", { class: "lc-panel", role: "dialog", "aria-modal": "false", "aria-label": "Asistente de Lavanda", hidden: "" });
  panel.innerHTML =
    '<header class="lc-head">' +
      '<img src="favicon.png" alt="" width="40" height="40">' +
      '<div><p class="lc-title">Asistente Lavanda</p><p class="lc-sub"><span class="lc-dot"></span>Responde al momento</p></div>' +
      '<button type="button" class="lc-close" aria-label="Cerrar el chat">✕</button>' +
    '</header>' +
    '<div class="lc-log" role="log" aria-live="polite"></div>' +
    '<div class="lc-chips"></div>' +
    '<form class="lc-form">' +
      '<label class="lc-sr" for="lc-input">Escribe tu pregunta</label>' +
      '<textarea id="lc-input" rows="1" maxlength="1000" placeholder="Escribe tu pregunta…" autocomplete="off"></textarea>' +
      '<button type="submit" class="lc-send" aria-label="Enviar"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg></button>' +
    '</form>' +
    '<p class="lc-legal">Respuestas generadas con IA. Para incidencias te pasamos con una persona.</p>';

  document.body.appendChild(panel);
  document.body.appendChild(globo);
  document.body.appendChild(lanzador);

  var log = panel.querySelector(".lc-log");
  var chips = panel.querySelector(".lc-chips");
  var form = panel.querySelector(".lc-form");
  var input = panel.querySelector("textarea");
  var cerrar = panel.querySelector(".lc-close");

  pintarTodo();

  // Botones de la web que abren el chat (data-open-chat)
  var abridores = document.querySelectorAll("[data-open-chat]");
  for (var i = 0; i < abridores.length; i++) {
    abridores[i].hidden = false;
    abridores[i].addEventListener("click", function (e) { e.preventDefault(); abrir(); });
  }

  lanzador.addEventListener("click", function () { panel.hidden ? abrir() : cerrarPanel(); });
  cerrar.addEventListener("click", cerrarPanel);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) cerrarPanel(); });
  form.addEventListener("submit", function (e) { e.preventDefault(); enviar(input.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(input.value); }
  });
  input.addEventListener("input", autoAltura);

  // Como el botón flotante de WhatsApp: la burbuja aparece cuando ya no se ve el botón grande de la portada
  var portada = document.querySelector(".hero .btn-wa");
  if (portada && "IntersectionObserver" in window) {
    new IntersectionObserver(function (e) {
      var tapado = e[0].isIntersecting;
      lanzador.classList.toggle("is-hidden", tapado);
      globo.classList.toggle("is-hidden", tapado);
    }).observe(portada);
  }

  setTimeout(function () { if (panel.hidden && !historial.length) globo.classList.add("is-visible"); }, 2500);

  // ---------- Acciones ----------
  function abrir() {
    panel.hidden = false;
    document.documentElement.classList.add("chat-open");
    lanzador.setAttribute("aria-expanded", "true");
    globo.classList.remove("is-visible");
    bajar();
    setTimeout(function () { input.focus(); }, 50);
  }
  function cerrarPanel() {
    panel.hidden = true;
    document.documentElement.classList.remove("chat-open");
    lanzador.setAttribute("aria-expanded", "false");
    lanzador.focus();
  }

  function enviar(texto) {
    texto = (texto || "").trim();
    if (!texto || enviando) return;
    texto = texto.slice(0, 1000);
    input.value = "";
    autoAltura();
    historial.push({ role: "user", content: texto });
    pintarTodo();
    pedirRespuesta();
  }

  function pedirRespuesta() {
    enviando = true;
    form.classList.add("is-busy");
    var escribiendo = el("div", { class: "lc-msg lc-bot lc-typing", "aria-label": "Escribiendo" });
    escribiendo.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(escribiendo);
    bajar();

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: recortar(historial) }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        var texto = data && data.reply;
        if (!texto) throw new Error("sin respuesta");
        historial.push({ role: "assistant", content: texto, whatsapp: data.whatsapp || null });
      })
      .catch(function () {
        historial.push({ role: "assistant", content: "Perdona, ahora mismo no puedo responder. Escríbenos por WhatsApp y te ayudamos.", whatsapp: "Hola, tengo una consulta.", local: true });
      })
      .then(function () {
        enviando = false;
        form.classList.remove("is-busy");
        guardar();
        pintarTodo();
        input.focus();
      });
  }

  // El servidor solo necesita los últimos mensajes, empezando por uno del cliente
  function recortar(h) {
    var limpio = h.filter(function (m) { return !m.local; }).map(function (m) { return { role: m.role, content: m.content }; });
    // quita mensajes seguidos del mismo autor (por si falló una respuesta)
    var r = [];
    limpio.forEach(function (m) {
      if (r.length && r[r.length - 1].role === m.role) r[r.length - 1] = m; else r.push(m);
    });
    r = r.slice(-MAX_HISTORIAL);
    while (r.length && r[0].role !== "user") r.shift();
    return r;
  }

  // ---------- Pintado ----------
  function pintarTodo() {
    log.innerHTML = "";
    log.appendChild(burbuja({ role: "assistant", content: SALUDO }));
    historial.forEach(function (m) { log.appendChild(burbuja(m)); });
    chips.innerHTML = "";
    chips.hidden = historial.length > 0;
    SUGERENCIAS.forEach(function (s) {
      var b = el("button", { type: "button", class: "lc-chip" }, s);
      b.addEventListener("click", function () { enviar(s); });
      chips.appendChild(b);
    });
    bajar();
  }

  function burbuja(m) {
    var d = el("div", { class: "lc-msg " + (m.role === "user" ? "lc-user" : "lc-bot") });
    var p = el("p");
    p.textContent = m.content;            // texto plano: nunca se interpreta HTML
    d.appendChild(p);
    if (m.whatsapp) {
      var a = el("a", {
        class: "lc-wa",
        href: "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(m.whatsapp),
        target: "_blank", rel: "noopener",
      });
      a.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><use href="#i-wa"/></svg>';
      a.appendChild(document.createTextNode("Continuar por WhatsApp"));
      d.appendChild(a);
    }
    return d;
  }

  function bajar() { log.scrollTop = log.scrollHeight; }
  function autoAltura() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }

  // ---------- Memoria de la conversación (solo en esta pestaña) ----------
  function cargar() {
    try { var h = JSON.parse(sessionStorage.getItem(CLAVE)); return Array.isArray(h) ? h : []; } catch (e) { return []; }
  }
  function guardar() {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(historial.slice(-40))); } catch (e) { /* sin memoria, no pasa nada */ }
  }

  function el(tag, attrs, texto) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (texto) n.textContent = texto;
    return n;
  }
})();
