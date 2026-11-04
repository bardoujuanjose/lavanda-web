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
  return { ok: true, faltan: [], numeros };
}
