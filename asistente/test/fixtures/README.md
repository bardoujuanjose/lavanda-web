`lavanda-textos.json` es una copia exacta de lo que los asistentes de Lavanda tenían escrito
ANTES de convertir los textos en plantilla. La prueba `negocio.test.js` comprueba que la plantilla
con la ficha de Lavanda sigue dando lo mismo.

Si cambias A PROPÓSITO las normas o los datos de Lavanda, la prueba fallará: es lo esperado.
Regenera la copia con:

    cd asistente && node --input-type=module -e '
    import { crearTextos } from "./src/negocio.js";
    import { FICHA_LAVANDA } from "./src/clientes/lavanda.js";
    import { writeFileSync } from "node:fs";
    const t = crearTextos(FICHA_LAVANDA);
    const claves = ["INSTRUCCIONES_WEB","INSTRUCCIONES_WHATSAPP","INSTRUCCIONES_VOZ","SALUDO_VOZ","HERRAMIENTA_AVISO","HERRAMIENTA_PASAR_LLAMADA","TELEFONO_WHATSAPP"];
    writeFileSync("test/fixtures/lavanda-textos.json", JSON.stringify(Object.fromEntries(claves.map(k=>[k,t[k]])), null, 2) + "\n");'
