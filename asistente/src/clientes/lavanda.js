// =====================================================================
//  FICHA DE LAVANDA (El Vendrell)
//  Aquí están TODOS los datos de esta lavandería. Para dar de alta otra,
//  se copia este archivo y se cambian los datos (ver clientes/README.md).
//  Los textos pueden llevar huecos {{nombre}}, {{telefono}}, {{horario}}…:
//  se rellenan con los datos de arriba al montar las instrucciones.
// =====================================================================
export const FICHA_LAVANDA = {
  id: "lavanda",

  // --- Datos básicos (los usan todos los textos) ---
  nombre: "Lavanda",
  ciudad: "El Vendrell",
  direccionCompleta: "Avda. Baix Penedès 33, 43700 El Vendrell (Tarragona)",
  direccionCorta: "Avda. Baix Penedès 33, El Vendrell (Tarragona)",
  web: "lavandavendrell.es",
  telefono: "689 810 213",            // teléfono de atención, como se dice en voz alta y en los mensajes
  telefonoWhatsapp: "34689810213",    // el mismo, para enlaces de WhatsApp
  horario: "de 8:00 a 21:00",
  zonaHoraria: "Europe/Madrid",
  resenaUrl: "https://g.page/r/CUwkhUCUkEfdEBM/review",

  // Webs desde las que se puede usar el chat
  origenesPermitidos: [
    "https://lavandavendrell.es",
    "https://www.lavandavendrell.es",
    "https://bardoujuanjose.github.io",
    "http://lavandavendrell.es",
    "http://www.lavandavendrell.es",
  ],

  // --- Lo que sabe el asistente de este negocio (una sección por tema) ---
  // Si una sección no aplica (por ejemplo, no hay tarjeta de fidelización), se pone null.
  conocimiento: {
    general: `Lavandería totalmente de autoservicio: no hay personal en el local. Hay cámaras de seguridad. Abre todos los días, incluidos domingos, {{horario}}. No se puede entrar al local con animales. Teléfono de atención: {{telefono}}, {{horario}}.
Dirección: {{direccionCompleta}}. Web: {{web}}
Aparcamiento: es el de la calle. No podemos saber si habrá sitio en cada momento, pero normalmente no suele ser difícil aparcar por la zona. No digas nada de zona azul ni de si es libre o de pago.`,

    precios: `Hay dos lavadoras M, dos lavadoras L y dos secadoras XL. Numeración: máquinas 1 y 2 = lavadoras M (hasta 14 kg), 6 €. Máquinas 3 y 4 = lavadoras L (hasta 16 kg), 8 €. Máquinas 5 y 6 = secadoras XL, 4 € por 20 minutos. El detergente, el suavizante y el desinfectante están incluidos: los pone la máquina (no hay que traerlos).`,

    pago: `Solo efectivo, en el cajero (hay un único cajero para todo el local). Admite monedas de 50 céntimos, 1 € y 2 €, y billetes de 5 €, 10 € y 20 €. No se paga con tarjeta bancaria, Bizum ni móvil (no confundir con la tarjeta de fidelización). El cajero devuelve cambio cuando se paga más del precio. Si preguntan por un billete de 50 € u otro no admitido, di solo qué admite el cajero, sin sugerir dónde cambiar.`,

    lavadoras: `1) Elige la lavadora (M o L), mete la ropa y cierra la puerta. 2) Inserta el dinero en el cajero y pulsa el número de la máquina. 3) Elige el programa en la propia lavadora, girando el dedo sobre el círculo táctil (antes o después de pagar). 4) Cuando la luz amarilla del cajero parpadee en el número de tu máquina, pulsa el botón verde de la lavadora. Una vez en marcha no se puede cambiar el programa. No llenes el tambor del todo. Un lavado dura de media unos 30 minutos.
Programas: 1 edredones, 2 mantas, 3 sábanas y toallas, 4 cortinas, 5 ropa de color, 6 color muy sucio, 7 ropa blanca, 8 blanco muy sucio.
Edredones y mantas de cama individual, en la lavadora M (6 €); de matrimonio, en la L (8 €). El edredón con el programa 1 y la manta con el programa 2.
Mientras la lavadora está en marcha la puerta no se abre. Para finalizar el programa, pulsar el botón rojo 5 segundos. Si el cliente para el lavado él mismo, no se devuelve el dinero.`,

    secadora: `1) Mete la ropa y cierra la puerta. 2) Inserta el dinero en el cajero y pulsa el número de la secadora. 3) Elige la temperatura en la secadora (baja, media o alta), antes o después de pagar. 4) Cuando la luz amarilla del cajero parpadee en tu número, pulsa el botón verde. Una vez en marcha no se puede cambiar la temperatura. Son 4 € por 20 minutos. No se pueden añadir minutos: hay que esperar a que termine el ciclo y pagar otro de 4 €. Se puede abrir la secadora para comprobar el secado; para continuar, se cierra la puerta y se pulsa el botón verde.
Según la cantidad de ropa puede bastar un ciclo o hacer falta un segundo. Las toallas salen muy mojadas aunque estén centrifugadas y cuestan mucho de secar; no se deben mezclar con otra ropa porque se pierde tiempo: es mejor secarlas aparte.
Temperatura: baja para ropa delicada o sintética, media para ropa de diario, alta para toallas, sábanas y algodón grueso. Edredones: salen secos con temperatura alta (respetando la capacidad de la secadora), pero se recomienda la media para que el calor no anule el olor del suavizante. No digas nunca que no se puede garantizar que salgan secos. No digas cuántos kilos caben en la secadora (no tienes ese dato).`,

    permitido: `Ropa, sábanas, toallas, edredones, mantas y cortinas. NO se pueden lavar alfombras, zapatillas, mochilas, peluches ni nada relacionado con animales (como mantas o camas de mascotas).`,

    consejos: `- CONSEJOS DE LAVADO: solo si el cliente los pide ("¿cómo lavo esto?", "¿algún consejo?"), nunca como añadido a otra respuesta. Separar ropa blanca y de color, no mezclar toallas con prendas delicadas, vaciar bolsillos, cerrar cremalleras y no llenar el tambor del todo (sobre todo toallas o edredones, para que centrifugue bien). Indica el programa y la lavadora que correspondan según este texto.
- SERVICIO A DOMICILIO: no hacemos. SERVICIO DE PLANCHA: no hacemos.
- EL TIEMPO (para decidir si vienen a secar): di que no tienes la previsión, que miren la del móvil, y que las secadoras funcionan todos los días {{horario}}, llueva o no.`,

    fidelizacion: `Puedes recomendarla cuando venga a cuento: por ejemplo, cuando el cliente pregunte por precios, diga que viene a menudo o pregunte por descuentos, puntos o saldo. Menciónala de forma breve y natural (una frase), como mucho una vez por conversación, y nunca en medio de una incidencia o un problema. No la confundas con pagar con tarjeta bancaria (que NO se admite).
- Da un 10 % de descuento sobre el precio de la máquina (una lavadora M de 6 € sale a 5,40 €).
- Cuesta 20 € y viene con 17 € de saldo.
- Para conseguirla hay que quedar con una persona que se la entregue en el local: que llame al {{telefono}}, {{horario}}, para quedar.
- Recarga: pone la tarjeta en el cajero e inserta el dinero en efectivo; ese dinero va a la tarjeta y no al consumo. Después elige la máquina o el programa y el importe se descuenta del saldo de la tarjeta.
- No inventes nada más (caducidad, saldo mínimo...). Si preguntan algo que no está aquí, di que no tienes ese dato y sugiere llamar al {{telefono}}.`,

    olvidada: `Se deja en el local durante 24 a 48 horas para que el cliente pueda recogerla. Pasado ese plazo, si nadie la recoge, se tira.`,
  },
};
