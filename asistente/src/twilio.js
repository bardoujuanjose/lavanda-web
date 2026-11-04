// =====================================================================
//  Twilio: consultar los números de la cuenta y su configuración de voz
//  Secretos en Cloudflare: TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN
// =====================================================================

function auth(env) {
  return "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
}

export async function estadoTwilio(env, fetchImpl = fetch) {
  const faltan = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"].filter((k) => !env[k]);
  if (faltan.length) return { ok: false, faltan };

  const base = env.TWILIO_BASE || "https://api.twilio.com";
  const r = await fetchImpl(`${base}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=50`, {
    headers: { Authorization: auth(env) },
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, faltan: [], error: datos?.message || `Twilio respondió ${r.status} (revisa el Account SID y el Auth Token)` };
  }
  const numeros = (datos.incoming_phone_numbers || []).map((n) => ({
    numero: n.phone_number,
    nombre: n.friendly_name,
    voz: n.voice_application_sid ? `App de Twilio ${n.voice_application_sid}` : n.voice_url || "(sin configurar)",
    metodoVoz: n.voice_url ? n.voice_method : null,
    fallo: n.voice_fallback_url || null,
    estado: n.status,
    capacidades: Object.entries(n.capabilities || {}).filter(([, v]) => v).map(([k]) => k),
  }));
  const res = { ok: true, faltan: [], numeros };
  const h = { headers: { Authorization: auth(env) } };
  const leer = async (url) => {
    const x = await fetchImpl(url, h);
    const d = await x.json().catch(() => ({}));
    if (!x.ok) throw new Error(d?.message || `Twilio respondió ${x.status}`);
    return d;
  };
  const pricing = env.TWILIO_PRICING_BASE || "https://pricing.twilio.com";
  const numbers = env.TWILIO_NUMBERS_BASE || "https://numbers.twilio.com";

  // Tipo de cuenta (de prueba o normal)
  try {
    const cuenta = await leer(`${base}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`);
    res.tipoCuenta = cuenta.type; // "Trial" o "Full"
  } catch (e) { res.errorCuenta = e.message; }

  // Precio mensual de los números españoles
  try {
    const d = await leer(`${pricing}/v1/PhoneNumbers/Countries/ES`);
    res.preciosNumero = { moneda: d.price_unit, lista: (d.phone_number_prices || []).map((p) => ({ tipo: p.number_type, precio: p.current_price })) };
  } catch (e) { res.errorPreciosNumero = e.message; }

  // Precio por minuto de las llamadas recibidas
  try {
    const d = await leer(`${pricing}/v1/Voice/Countries/ES`);
    res.preciosLlamada = { moneda: d.price_unit, lista: (d.inbound_call_prices || []).map((p) => ({ tipo: p.number_type, precio: p.current_price })) };
  } catch (e) { res.errorPreciosLlamada = e.message; }

  // Documentación exigida para un número español de empresa
  res.requisitos = [];
  for (const tipo of ["local", "mobile", "national"]) {
    try {
      const d = await leer(`${numbers}/v2/RegulatoryCompliance/Regulations?IsoCountry=ES&NumberType=${tipo}&EndUserType=business&PageSize=5`);
      for (const r of d.results || []) {
        const docs = (r.requirements?.supporting_document || []).flat().map((x) => x.name || x.friendly_name || (x.accepted_documents || []).map((a) => a.name).join(" / ")).filter(Boolean);
        const datos = (r.requirements?.end_user || []).map((x) => x.name).filter(Boolean);
        res.requisitos.push({ tipo, nombre: r.friendly_name, datos, documentos: docs });
      }
    } catch (e) { res.requisitos.push({ tipo, error: e.message }); }
  }
  return res;
}
