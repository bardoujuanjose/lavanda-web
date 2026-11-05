// Genera las imágenes 1080x1350 de Instagram (@lavandavendrell).
// Uso:  cd instagram && node generar.js     (requiere playwright)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, f)).toString('base64');
const MARCA = b64('marca.png');
const EMBLEMA = b64('emblema.png');
const font = (f) => 'file://' + path.join(__dirname, 'fuentes', f);

const CSS = `
@font-face{font-family:Nunito;font-weight:400;src:url(${font('Nunito-400.ttf')})}
@font-face{font-family:Nunito;font-weight:600;src:url(${font('Nunito-600.ttf')})}
@font-face{font-family:Nunito;font-weight:800;src:url(${font('Nunito-800.ttf')})}
@font-face{font-family:Zilla;font-weight:500;src:url(${font('Zilla-500.ttf')})}
@font-face{font-family:Zilla;font-weight:700;src:url(${font('Zilla-700.ttf')})}
:root{--indigo:#33287e;--morado:#6b1f8f;--magenta:#d6087f;--verde:#8dc63f;--tinta:#2a1b45;--suave:#5f5272;--crema:#fff6fb;--lila:#f3e8f8;--borde:#eadcf2;
--grad:linear-gradient(120deg,#33287e 0%,#6b1f8f 45%,#d6087f 100%)}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1350px;font-family:Nunito,sans-serif;color:var(--tinta);background:var(--crema);position:relative;overflow:hidden}
.t{font-family:Zilla,Georgia,serif;font-weight:700;line-height:1.05}
.kicker{font-weight:800;letter-spacing:.18em;text-transform:uppercase;font-size:30px;color:var(--magenta)}
.fondo-grad{background:var(--grad);color:#fff}
.fondo-lila{background:var(--lila)}
.pad{position:absolute;inset:0;padding:90px 90px 150px;display:flex;flex-direction:column}
.pie{position:absolute;left:0;right:0;bottom:0;height:110px;display:flex;align-items:center;justify-content:space-between;padding:0 90px;font-weight:800;font-size:28px;letter-spacing:.02em}
.pie img{height:62px}
.fondo-grad .pie{color:#fff}.fondo-grad .pie img{filter:brightness(0) invert(1)}
.burbuja{position:absolute;border-radius:50%;background:rgba(141,198,63,.9)}
.burbuja.b{background:rgba(255,255,255,.18)}
.maq{background:#fff;border:3px solid var(--borde);border-radius:36px;padding:34px 20px 30px;text-align:center;box-shadow:0 14px 30px rgba(83,33,125,.12);flex:1}
.maq .talla{display:inline-block;background:var(--grad);color:#fff;font-family:Zilla;font-weight:700;font-size:44px;border-radius:16px;padding:2px 26px}
.maq .puerta{width:200px;height:200px;border-radius:50%;margin:26px auto 18px;border:14px solid #c9a3e8;background:radial-gradient(circle at 35% 30%,#fff 0,#e9dcf6 40%,#b9a3de 100%);display:flex;align-items:center;justify-content:center;font-family:Zilla;font-weight:700;font-size:62px;color:var(--indigo)}
.maq .puerta small{font-size:26px;margin-left:4px}
.maq .n{font-weight:800;font-size:30px;color:var(--suave)}
.maq .p{font-family:Zilla;font-weight:700;font-size:84px;color:var(--magenta);line-height:1.1}
.maq .nota{font-size:24px;color:var(--suave);font-weight:600}
.fila{display:flex;gap:24px}
.chip{display:inline-block;background:#fff;border:3px solid var(--borde);border-radius:999px;padding:12px 28px;font-weight:800;font-size:30px;color:var(--indigo)}
.paso{display:flex;gap:26px;align-items:center;background:#fff;border:3px solid var(--borde);border-radius:30px;padding:26px 32px;box-shadow:0 10px 24px rgba(83,33,125,.1)}
.paso .num{flex:none;width:76px;height:76px;border-radius:50%;background:var(--grad);color:#fff;font-family:Zilla;font-weight:700;font-size:44px;display:flex;align-items:center;justify-content:center}
.paso b{display:block;font-size:34px;font-weight:800;color:var(--indigo)}
.paso span{font-size:27px;color:var(--suave);font-weight:600}
`;

const pie = (extra = 'lavandavendrell.es') =>
  `<div class="pie"><img src="${MARCA}" alt=""><span>${extra}</span></div>`;

const bubbles = `
<div class="burbuja" style="width:70px;height:70px;right:90px;top:80px"></div>
<div class="burbuja" style="width:36px;height:36px;right:190px;top:150px"></div>
<div class="burbuja" style="width:24px;height:24px;right:60px;top:200px"></div>`;
const bubblesB = `
<div class="burbuja b" style="width:260px;height:260px;right:-60px;top:-60px"></div>
<div class="burbuja b" style="width:120px;height:120px;left:-30px;bottom:240px"></div>
<div class="burbuja" style="width:46px;height:46px;right:120px;top:300px"></div>
<div class="burbuja" style="width:28px;height:28px;right:220px;top:380px"></div>`;

const maquina = (talla, num, unidad, nombre, precio, nota) => `
<div class="maq"><div class="talla">${talla}</div>
<div class="puerta"><span>${num}<small>${unidad}</small></span></div>
<div class="n">${nombre}</div><div class="p">${precio}</div><div class="nota">${nota}</div></div>`;

// Botellas (copiadas de la ilustración de index.html)
const BOTELLAS = `
<svg viewBox="0 0 140 80" width="900" height="514">
 <g><path d="M38 34q12 0 12 13q0 11-8 13" fill="none" stroke="#6b1f8f" stroke-width="5" stroke-linecap="round"/>
 <rect x="15" y="20" width="16" height="14" rx="4" fill="#6b1f8f"/><rect x="12" y="12" width="22" height="10" rx="4" fill="#d6087f"/>
 <rect x="4" y="30" width="42" height="46" rx="12" fill="#6b1f8f"/><rect x="10" y="42" width="30" height="26" rx="8" fill="#fff"/>
 <circle cx="19" cy="52" r="2.6" fill="#2a1b45"/><circle cx="31" cy="52" r="2.6" fill="#2a1b45"/>
 <circle cx="20" cy="51" r=".9" fill="#fff"/><circle cx="32" cy="51" r=".9" fill="#fff"/>
 <path d="M21 58q4 5 8 0" fill="none" stroke="#2a1b45" stroke-width="2" stroke-linecap="round"/>
 <ellipse cx="14.5" cy="58" rx="2.6" ry="1.8" fill="#ff9ccf"/><ellipse cx="35.5" cy="58" rx="2.6" ry="1.8" fill="#ff9ccf"/></g>
 <g><rect x="66" y="24" width="14" height="12" rx="4" fill="#c9a3e8"/><rect x="63" y="15" width="20" height="10" rx="4" fill="#8dc63f"/>
 <rect x="56" y="34" width="34" height="42" rx="14" fill="#c9a3e8"/>
 <path d="M64 50q3-3.5 6 0" fill="none" stroke="#2a1b45" stroke-width="2" stroke-linecap="round"/>
 <circle cx="80" cy="49" r="2.6" fill="#2a1b45"/><circle cx="81" cy="48" r=".9" fill="#fff"/>
 <path d="M66 56q7 7 14 0" fill="#fff" stroke="#2a1b45" stroke-width="2" stroke-linecap="round"/>
 <ellipse cx="61" cy="56" rx="2.4" ry="1.7" fill="#ff9ccf"/><ellipse cx="85" cy="56" rx="2.4" ry="1.7" fill="#ff9ccf"/>
 <path d="M73 69.5l-3.6-3.4a2.2 2.2 0 0 1 3.6-2.6a2.2 2.2 0 0 1 3.6 2.6z" fill="#d6087f"/></g>
 <g><path d="M104 22h14l6 5h4v4h-6l-4-3h-14z" fill="#3fa34d"/><rect x="108" y="16" width="9" height="7" rx="2" fill="#3fa34d"/>
 <path d="M105 28h14v8l4 6v28a6 6 0 0 1-6 6h-12a6 6 0 0 1-6-6V42l6-6z" fill="#b8e08a"/>
 <rect x="101" y="46" width="22" height="20" rx="5" fill="#fff"/>
 <path d="M105 54q2.5-3 5 0M114 54q2.5-3 5 0" fill="none" stroke="#2a1b45" stroke-width="2" stroke-linecap="round"/>
 <path d="M108 59q4 4 8 0" fill="none" stroke="#2a1b45" stroke-width="2" stroke-linecap="round"/>
 <ellipse cx="104.5" cy="59" rx="2" ry="1.4" fill="#ff9ccf"/><ellipse cx="119.5" cy="59" rx="2" ry="1.4" fill="#ff9ccf"/></g>
 <circle cx="50" cy="14" r="5" fill="#8dc63f"/><circle cx="92" cy="12" r="3.5" fill="#d6087f"/><circle cx="5" cy="18" r="3" fill="#c9a3e8"/>
</svg>`;

const slides = [
  // 1 · Presentación
  { id: '01-presentacion', html: `
<body class="fondo-grad">${bubblesB}
<div class="pad" style="align-items:center;text-align:center;justify-content:center;padding-bottom:200px">
  <img src="${EMBLEMA}" style="width:330px;background:#fff;border-radius:50%;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.25)">
  <p class="kicker" style="color:#d9f3a6;margin-top:60px">Ya estamos en Instagram</p>
  <h1 class="t" style="font-size:132px;margin-top:20px">Hola,<br>somos Lavanda</h1>
  <p style="font-size:42px;font-weight:600;margin-top:36px;line-height:1.3">Tu lavandería autoservicio<br>en El Vendrell</p>
</div>
<div class="pie"><span>Avda. Baix Penedès 33</span><span>8:00 – 21:00</span></div></body>` },

  // 2 · Precios
  { id: '02-precios', html: `
<body>${bubbles}
<div class="pad">
  <p class="kicker">Máquinas y precios</p>
  <h1 class="t" style="font-size:104px;color:var(--indigo);margin:14px 0 50px">Elige tu máquina</h1>
  <div class="fila" style="margin-bottom:44px">
    ${maquina('M', 14, 'kg', 'Lavadora', '6 €', 'Máquinas 1 y 2')}
    ${maquina('L', 16, 'kg', 'Lavadora', '8 €', 'Máquinas 3 y 4')}
    ${maquina('XL', 20, 'min', 'Secadora', '4 €', 'Máquinas 5 y 6')}
  </div>
  <div style="background:var(--grad);color:#fff;border-radius:30px;padding:34px 40px;text-align:center;font-size:38px;font-weight:800;line-height:1.3">Detergente, suavizante y desinfectante incluidos</div>
  <p style="font-size:32px;font-weight:800;text-align:center;color:var(--suave);margin-top:auto">Pago solo en efectivo, en el cajero</p>
</div>${pie()}</body>` },

  // 3 · Todo incluido
  { id: '03-todo-incluido', html: `
<body class="fondo-lila">
<div class="pad" style="align-items:center;text-align:center">
  <p class="kicker">Todo incluido</p>
  <h1 class="t" style="font-size:112px;color:var(--indigo);margin:14px 0 20px">No traigas<br>nada</h1>
  <div style="margin:10px 0">${BOTELLAS}</div>
  <p style="font-size:42px;font-weight:800;color:var(--indigo);line-height:1.25">Detergente, suavizante<br>y desinfectante incluidos<br>en todos los lavados</p>
</div>${pie()}</body>` },

  // 4 · Edredones
  { id: '04-edredones', html: `
<body class="fondo-grad">${bubblesB}
<div class="pad">
  <p class="kicker" style="color:#d9f3a6">Edredones y mantas</p>
  <h1 class="t" style="font-size:116px;margin:14px 0 50px">Se acabó lavar el edredón a mano</h1>
  <div style="display:flex;flex-direction:column;gap:26px">
    <div class="paso"><div class="num">M</div><div><b>Cama individual</b><span>Lavadora M · 6 € · programa 1</span></div></div>
    <div class="paso"><div class="num">L</div><div><b>Cama de matrimonio</b><span>Lavadora L · 8 € · programa 1</span></div></div>
    <div class="paso"><div class="num">☀</div><div><b>Y a la secadora XL</b><span>4 € cada 20 minutos</span></div></div>
  </div>
  <p style="font-size:30px;font-weight:600;margin-top:36px;opacity:.95">Mantas: programa 2. Salen listas y con olor a limpio.</p>
</div>${pie()}</body>` },

  // 5 · ¿Llueve?
  { id: '05-llueve', html: `
<body class="fondo-grad" style="background:linear-gradient(180deg,#33287e 0%,#6b1f8f 100%)">
<svg style="position:absolute;inset:0" width="1080" height="1350">
 ${Array.from({ length: 34 }, (_, i) => { const x = (i * 97) % 1080, y = (i * 211) % 700; return `<line x1="${x}" y1="${y}" x2="${x - 22}" y2="${y + 70}" stroke="rgba(255,255,255,.22)" stroke-width="5" stroke-linecap="round"/>`; }).join('')}
 <g fill="rgba(255,255,255,.95)"><ellipse cx="300" cy="170" rx="170" ry="80"/><ellipse cx="450" cy="130" rx="130" ry="90"/><ellipse cx="190" cy="200" rx="120" ry="60"/><ellipse cx="560" cy="190" rx="120" ry="60"/></g>
</svg>
<div class="pad" style="justify-content:flex-end;padding-bottom:200px">
  <p class="kicker" style="color:#d9f3a6">Secadoras XL</p>
  <h1 class="t" style="font-size:150px;margin:16px 0 30px">¿Llueve?</h1>
  <p style="font-size:56px;font-weight:800;line-height:1.2;margin-bottom:34px">La ropa se seca en la lavandería.</p>
  <p style="font-size:38px;font-weight:600;line-height:1.35">4 € cada 20 minutos.<br>Abierto todos los días de 8:00 a 21:00, llueva o no.</p>
</div>${pie()}</body>` },

  // 6 · Fidelización
  { id: '06-tarjeta', html: `
<body class="fondo-lila">
<div class="pad" style="align-items:center;text-align:center">
  <p class="kicker">Tarjeta de fidelización</p>
  <h1 class="t" style="font-size:110px;color:var(--indigo);margin:14px 0 60px">10 % menos en cada lavado</h1>
  <div style="position:relative;width:640px;height:410px;border-radius:34px;background:var(--grad);color:#fff;box-shadow:0 30px 60px rgba(83,33,125,.35);transform:rotate(-5deg);margin-bottom:70px">
    <span class="t" style="position:absolute;left:44px;top:38px;font-size:50px;letter-spacing:.08em">LAVANDA</span>
    <span style="position:absolute;left:44px;top:150px;width:100px;height:76px;border-radius:14px;background:#f3d36b"></span>
    <span class="t" style="position:absolute;right:44px;bottom:30px;font-size:120px">-10%</span>
  </div>
  <p style="font-size:38px;font-weight:800;color:var(--indigo);line-height:1.3">Cuesta 20 € y viene con 17 € de saldo.<br>Se recarga en el cajero con efectivo.</p>
  <p style="font-size:30px;font-weight:600;color:var(--suave);margin-top:26px">Pídela llamando al 689 810 213, de 8:00 a 21:00</p>
</div>${pie()}</body>` },

  // 7 · Asistente WhatsApp
  { id: '07-whatsapp', html: `
<body>${bubbles}
<div class="pad">
  <p class="kicker">Asistente de WhatsApp</p>
  <h1 class="t" style="font-size:104px;color:var(--indigo);margin:14px 0 46px">Pregúntanos lo que quieras</h1>
  <div style="display:flex;flex-direction:column;gap:22px;font-size:34px;font-weight:600">
    <div style="align-self:flex-start;background:#fff;border:3px solid var(--borde);border-radius:30px 30px 30px 6px;padding:24px 32px;max-width:700px">¿Cuánto cuesta lavar un edredón de matrimonio?</div>
    <div style="align-self:flex-end;background:#d9fdd3;border-radius:30px 30px 6px 30px;padding:24px 32px;max-width:760px">Lavadora L, 8 €, programa 1. Detergente y suavizante incluidos 😊</div>
    <div style="align-self:flex-start;background:#fff;border:3px solid var(--borde);border-radius:30px 30px 30px 6px;padding:24px 32px;max-width:700px">¿Y a qué hora abrís?</div>
    <div style="align-self:flex-end;background:#d9fdd3;border-radius:30px 30px 6px 30px;padding:24px 32px;max-width:760px">Todos los días de 8:00 a 21:00 💜</div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:center;gap:22px;justify-content:center;background:#25a244;color:#fff;border-radius:999px;padding:26px 40px;font-size:42px;font-weight:800">Escríbenos al 689 81 02 13</div>
</div>${pie()}</body>` },

  // 8 · Consejos
  { id: '08-consejos', html: `
<body class="fondo-grad">${bubblesB}
<div class="pad">
  <p class="kicker" style="color:#d9f3a6">Consejos de lavado</p>
  <h1 class="t" style="font-size:112px;margin:14px 0 44px">5 trucos para lavar mejor</h1>
  <div style="display:flex;flex-direction:column;gap:20px">
    <div class="paso"><div class="num">1</div><div><b>Separa blanco y color</b></div></div>
    <div class="paso"><div class="num">2</div><div><b>Vacía los bolsillos</b></div></div>
    <div class="paso"><div class="num">3</div><div><b>Cierra las cremalleras</b></div></div>
    <div class="paso"><div class="num">4</div><div><b>No mezcles toallas con prendas delicadas</b></div></div>
    <div class="paso"><div class="num">5</div><div><b>No llenes el tambor del todo</b><span>Así centrifuga mejor</span></div></div>
  </div>
</div>${pie()}</body>` },
];

(async () => {
  const out = path.join(__dirname, 'imagenes');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  for (const s of slides) {
    const html = `<!doctype html><html lang="es"><meta charset="utf-8"><style>${CSS}</style>${s.html}</html>`;
    const tmp = path.join(__dirname, '.tmp.html');
    fs.writeFileSync(tmp, html);
    await page.goto('file://' + tmp);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, s.id + '.png') });
    console.log('ok', s.id);
  }
  fs.unlinkSync(path.join(__dirname, '.tmp.html'));
  await browser.close();
})();
