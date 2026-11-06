// Lavandería INVENTADA, solo para las pruebas: sirve para comprobar que la plantilla vale para otra
// lavandería distinta de Lavanda, con OTRO modo de cobro (tarjeta/app, sin cajero ni Bizum).
import { FICHA_LAVANDA } from "../../src/clientes/lavanda.js";

export const PEPITO = {
  ...FICHA_LAVANDA,
  id: "pepito",
  nombre: "Lavandería Pepito",
  ciudad: "Reus",
  direccionCompleta: "Calle Mayor 5, 43201 Reus (Tarragona)",
  direccionCorta: "Calle Mayor 5, Reus (Tarragona)",
  web: "pepitolava.es",
  telefono: "977 000 111",
  telefonoWhatsapp: "34977000111",
  horario: "de 7:00 a 22:00",
  resenaUrl: "https://g.page/r/PEPITO/review",
  equipoCobro: "del lector de tarjetas",
  ejemploNoExiste: "no existe ninguna máquina expendedora de detergente",
  conocimiento: {
    ...FICHA_LAVANDA.conocimiento,
    general: "Lavandería de autoservicio en Reus. Abre todos los días {{horario}}. Teléfono: {{telefono}}.",
    lavadoras: "1) Mete la ropa y cierra la puerta. 2) Pasa la tarjeta o la app por el lector de la máquina. 3) Elige el programa y pulsa Inicio.",
    secadora: "1) Mete la ropa y cierra la puerta. 2) Paga con tarjeta o app en el lector. 3) Elige la temperatura y pulsa Inicio.",
    pago: "Solo con tarjeta bancaria o con la app de Pepito, en el lector de cada máquina. No se admite efectivo.",
    fidelizacion: null,
  },
  normas: {
    procedimientos: `=== PROBLEMAS CON LAS MÁQUINAS O CON EL COBRO ===
Se paga con tarjeta en el lector de cada máquina. Si el lector cobra y la máquina no arranca, pregunta el número de máquina y la hora aproximada; usa avisar_al_equipo (motivo "devolucion") y di que el importe se devolverá a la misma tarjeta en 5 días laborables. Para cualquier otro problema: "Llama a uno de nuestros agentes al {{telefono}}, {{horario}}."`,
    web: `=== PROBLEMAS ===
Este chat solo informa. Si hay un problema con una máquina o un cobro, dile que llame al {{telefono}}, {{horario}}.`,
    whatsapp: `- CUÁNDO SUGERIR LLAMAR: en cualquier problema que no sea un cobro sin servicio.
- No prometas nada que no esté en este texto.`,
    avisos: `=== AVISOS AL EQUIPO (herramienta avisar_al_equipo) ===
Úsala solo cuando el cliente haya sido cobrado y la máquina no haya funcionado. Una sola vez por caso.`,
    voz: `- Responde con frases cortas. Si hay un cobro sin servicio, usa avisar_al_equipo antes de despedirte.`,
    motivosAviso: [
      { clave: "devolucion", nombre: "devolución", titulo: "💳 *Devolución a la tarjeta*" },
    ],
    herramientaAviso: {
      cuando: "Úsala cuando el cliente haya sido cobrado y la máquina no haya funcionado.",
      importe: "Importe cobrado (por ejemplo \"6 €\"), o cadena vacía si no aplica.",
      telefono: "Teléfono del cliente para avisarle de la devolución, o cadena vacía.",
    },
  },
};
