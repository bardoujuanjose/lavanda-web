// Lavandería INVENTADA, solo para las pruebas: sirve para comprobar que la plantilla vale para otra lavandería distinta de Lavanda.
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
  conocimiento: {
    ...FICHA_LAVANDA.conocimiento,
    general: "Lavandería de autoservicio en Reus. Abre todos los días {{horario}}. Teléfono: {{telefono}}.",
    fidelizacion: null,
  },
};
