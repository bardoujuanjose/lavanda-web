// =====================================================================
//  Memoria de cada cliente de WhatsApp (Cloudflare Durable Object)
//  Hay una "Conversacion" por número de teléfono.
// =====================================================================
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { clienteWhatsApp } from "./whatsapp.js";
import { obtenerCliente, entornoDe, prepararRegistro, almacenRegistro, nombreMemoria } from "./clientes/index.js";
import {
  ESPERA_MS, estadoInicial, procesarPendientes, aplicarResultado, comandoDueno, ecoDelDueno, describirAviso, resumirPendientes,
} from "./asistente-whatsapp.js";
import { entradasDe, anadirTranscripcion, lineaIndice, desdeHistorial } from "./transcripciones.js";

// Convierte un audio de WhatsApp en texto con el modelo Whisper de Cloudflare (Workers AI)
async function transcribirAudio(ai, bytes) {
  const datos = new Uint8Array(bytes);
  try {
    let binario = "";
    for (let i = 0; i < datos.length; i += 0x8000) binario += String.fromCharCode(...datos.subarray(i, i + 0x8000));
    const r = await ai.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(binario) });
    if (r?.text) return r.text;
  } catch (e) {
    console.error("Transcripción (turbo) falló:", e?.message || e);
  }
  const r = await ai.run("@cf/openai/whisper", { audio: [...datos] });
  return r?.text || "";
}

export class Conversacion extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.procesando = false;
  }

  async leerEstado() {
    return (await this.ctx.storage.get("estado")) || estadoInicial();
  }

  async guardarResultado(resultado, cliente) {
    // Se relee justo antes de guardar para no pisar cambios hechos mientras tanto
    const estado = aplicarResultado(await this.leerEstado(), resultado);
    await this.ctx.storage.put("estado", estado);
    await this.apuntar(entradasDe(resultado, {
      etiquetaEquipo: cliente.textos.ETIQUETA_EQUIPO,
      describirAviso: (a) => "Aviso al dueño: " + describirAviso(a, cliente.ficha.normas.motivosAviso),
    }), cliente, estado.pausa);
  }

  // Registro con fecha y hora para la página de conversaciones. Si falla, el asistente sigue igual.
  async apuntar(entradas, cliente, pausa) {
    if (!entradas.length) return;
    try {
      const transcripcion = anadirTranscripcion(await this.ctx.storage.get("transcripcion"), entradas);
      await this.ctx.storage.put("transcripcion", transcripcion);
      const telefono = await this.ctx.storage.get("telefono");
      const almacen = almacenRegistro(this.env);
      if (almacen && telefono) {
        await almacen.apuntarConversacion(lineaIndice({
          memoria: nombreMemoria(cliente, telefono), cliente: cliente.ficha.id, telefono,
          nombre: await this.ctx.storage.get("nombre"), transcripcion, pausa,
        }));
      }
    } catch (e) {
      console.error("Conversaciones: no se pudo guardar la transcripción:", e?.message || e);
    }
  }

  // Para la página de conversaciones (solo lectura)
  async leerConversacion() {
    const estado = await this.leerEstado();
    const clienteId = (await this.ctx.storage.get("cliente")) || undefined;
    let transcripcion = (await this.ctx.storage.get("transcripcion")) || [];
    let antigua = false;
    if (!transcripcion.length && estado.historial.length) {
      // Conversación de antes del registro: se enseña la memoria, sin fechas
      let etiqueta = "";
      try { etiqueta = obtenerCliente(this.env, clienteId).textos.ETIQUETA_EQUIPO; } catch {}
      transcripcion = desdeHistorial(estado.historial, etiqueta);
      antigua = true;
    }
    return {
      telefono: (await this.ctx.storage.get("telefono")) || "",
      nombre: (await this.ctx.storage.get("nombre")) || "",
      cliente: clienteId || "",
      equipo: Boolean(estado.pausa),
      antigua,
      transcripcion,
    };
  }

  // Llega un mensaje del cliente: se guarda y se espera unos segundos por si manda más
  async recibir(mensaje, clienteId) {
    const vistos = (await this.ctx.storage.get("vistos")) || [];
    if (vistos.includes(mensaje.id)) return; // Meta a veces repite el aviso
    vistos.push(mensaje.id);
    const pendientes = (await this.ctx.storage.get("pendientes")) || [];
    pendientes.push(mensaje);
    await this.ctx.storage.put({
      vistos: vistos.slice(-100),
      pendientes,
      telefono: mensaje.de,
      ...(clienteId ? { cliente: clienteId } : {}),   // de qué lavandería es (sin este dato: Lavanda, como antes)
      ...(mensaje.nombre ? { nombre: mensaje.nombre } : {}),
    });
    await this.ctx.storage.setAlarm(Date.now() + ESPERA_MS);
  }

  // Pasados unos segundos sin mensajes nuevos, se contesta
  async alarm() {
    if (this.procesando) {
      await this.ctx.storage.setAlarm(Date.now() + ESPERA_MS);
      return;
    }
    const pendientes = (await this.ctx.storage.get("pendientes")) || [];
    if (!pendientes.length) return;
    await this.ctx.storage.put("pendientes", []);
    const telefono = await this.ctx.storage.get("telefono");
    const nombre = (await this.ctx.storage.get("nombre")) || "";
    await prepararRegistro(this.env);   // por si es una lavandería dada de alta en el panel
    const cliente = obtenerCliente(this.env, (await this.ctx.storage.get("cliente")) || undefined);
    const env = entornoDe(this.env, cliente);   // el token, el número y el dueño de ESA lavandería
    const wa = clienteWhatsApp(env);
    this.procesando = true;
    try {
      const claude = new Anthropic({
        apiKey: this.env.ANTHROPIC_API_KEY,
        ...(this.env.ANTHROPIC_BASE_URL ? { baseURL: this.env.ANTHROPIC_BASE_URL } : {}),
        maxRetries: 1,
        timeout: 60_000,
      });
      const resultado = await procesarPendientes({
        estado: await this.leerEstado(), pendientes, telefono, nombre, wa, claude, env, cliente,
        transcribir: this.env.AI ? (bytes) => transcribirAudio(this.env.AI, bytes) : undefined,
      });
      await this.guardarResultado(resultado, cliente);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) console.error("WhatsApp: clave de Claude no válida");
      else if (e instanceof Anthropic.RateLimitError) console.error("WhatsApp: límite de uso de Claude alcanzado");
      else if (e instanceof Anthropic.APIError) console.error(`WhatsApp: error de Claude ${e.status}:`, e.message);
      else console.error("WhatsApp: error inesperado:", e?.message || e);
      await wa.enviarTexto(telefono, cliente.textos.RESPUESTA_ERROR).catch(() => {});
      // En el registro queda lo que escribió el cliente y que el asistente falló
      const ahora = Date.now();
      await this.apuntar([
        { cuando: ahora, quien: "cliente", texto: resumirPendientes(pendientes) || "[mensaje]" },
        { cuando: ahora, quien: "error", texto: "El asistente tuvo un error y contestó: " + cliente.textos.RESPUESTA_ERROR },
      ], cliente, (await this.leerEstado()).pausa);
    } finally {
      this.procesando = false;
    }
  }

  // Pequeño almacén de configuración (se usa una instancia aparte llamada "__config__")
  async leerConfig(clave) {
    return (await this.ctx.storage.get("config:" + clave)) ?? null;
  }
  async guardarConfig(clave, valor) {
    await this.ctx.storage.put("config:" + clave, valor);
  }

  // El dueño ha contestado desde la app WhatsApp Business: el asistente se calla con este cliente
  async eco(texto, clienteId, telefono) {
    await prepararRegistro(this.env);
    const cliente = obtenerCliente(this.env, clienteId);
    await this.recordarCliente(telefono, clienteId);
    await this.guardarResultado(ecoDelDueno({ estado: await this.leerEstado(), texto, cliente }), cliente);
  }

  // El dueño escribe "#telefono texto" o "#telefono fin"
  async dueno(telefono, texto, clienteId) {
    await prepararRegistro(this.env);
    const cliente = obtenerCliente(this.env, clienteId);
    const env = entornoDe(this.env, cliente);
    await this.recordarCliente(telefono, clienteId);
    const resultado = await comandoDueno({
      estado: await this.leerEstado(), telefono, texto, wa: clienteWhatsApp(env), env, cliente,
    });
    await this.guardarResultado(resultado, cliente);
  }

  // Si el equipo escribe antes que el cliente, la conversación aún no sabe de quién es
  async recordarCliente(telefono, clienteId) {
    if (telefono && !(await this.ctx.storage.get("telefono"))) await this.ctx.storage.put("telefono", telefono);
    if (clienteId && !(await this.ctx.storage.get("cliente"))) await this.ctx.storage.put("cliente", clienteId);
  }
}
