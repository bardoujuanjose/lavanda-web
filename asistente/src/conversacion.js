// =====================================================================
//  Memoria de cada cliente de WhatsApp (Cloudflare Durable Object)
//  Hay una "Conversacion" por número de teléfono.
// =====================================================================
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { clienteWhatsApp } from "./whatsapp.js";
import {
  ESPERA_MS, RESPUESTA_ERROR, estadoInicial, procesarPendientes, aplicarResultado, comandoDueno,
} from "./asistente-whatsapp.js";

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

  async guardarResultado(resultado) {
    // Se relee justo antes de guardar para no pisar cambios hechos mientras tanto
    const estado = await this.leerEstado();
    await this.ctx.storage.put("estado", aplicarResultado(estado, resultado));
  }

  // Llega un mensaje del cliente: se guarda y se espera unos segundos por si manda más
  async recibir(mensaje) {
    const vistos = (await this.ctx.storage.get("vistos")) || [];
    if (vistos.includes(mensaje.id)) return; // Meta a veces repite el aviso
    vistos.push(mensaje.id);
    const pendientes = (await this.ctx.storage.get("pendientes")) || [];
    pendientes.push(mensaje);
    await this.ctx.storage.put({
      vistos: vistos.slice(-100),
      pendientes,
      telefono: mensaje.de,
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
    const wa = clienteWhatsApp(this.env);
    this.procesando = true;
    try {
      const claude = new Anthropic({
        apiKey: this.env.ANTHROPIC_API_KEY,
        ...(this.env.ANTHROPIC_BASE_URL ? { baseURL: this.env.ANTHROPIC_BASE_URL } : {}),
        maxRetries: 1,
        timeout: 60_000,
      });
      const resultado = await procesarPendientes({
        estado: await this.leerEstado(), pendientes, telefono, nombre, wa, claude, env: this.env,
        transcribir: this.env.AI ? (bytes) => transcribirAudio(this.env.AI, bytes) : undefined,
      });
      await this.guardarResultado(resultado);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) console.error("WhatsApp: clave de Claude no válida");
      else if (e instanceof Anthropic.RateLimitError) console.error("WhatsApp: límite de uso de Claude alcanzado");
      else if (e instanceof Anthropic.APIError) console.error(`WhatsApp: error de Claude ${e.status}:`, e.message);
      else console.error("WhatsApp: error inesperado:", e?.message || e);
      await wa.enviarTexto(telefono, RESPUESTA_ERROR).catch(() => {});
    } finally {
      this.procesando = false;
    }
  }

  // El dueño escribe "#telefono texto" o "#telefono fin"
  async dueno(telefono, texto) {
    const resultado = await comandoDueno({
      estado: await this.leerEstado(), telefono, texto, wa: clienteWhatsApp(this.env), env: this.env,
    });
    await this.guardarResultado(resultado);
  }
}
