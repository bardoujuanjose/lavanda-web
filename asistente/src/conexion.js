// =====================================================================
//  Comprobar y conectar la cuenta de WhatsApp con la app de Meta
//  (usado desde el chat de pruebas, con la contraseña PRUEBA_CLAVE)
// =====================================================================

function base(env) {
  return `${env.GRAPH_BASE || "https://graph.facebook.com"}/${env.GRAPH_VERSION || "v23.0"}`;
}

async function graph(env, ruta, opciones = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`${base(env)}/${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, ...(opciones.headers || {}) },
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos?.error?.message || `Meta respondió ${r.status}`);
  return datos;
}

// Cuentas de WhatsApp (WABA) a las que da acceso el token
async function cuentasDelToken(env, fetchImpl) {
  const info = await graph(env, `debug_token?input_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}`, {}, fetchImpl);
  const ids = new Set();
  for (const s of info?.data?.granular_scopes || []) {
    if (s.scope === "whatsapp_business_management" || s.scope === "whatsapp_business_messaging") {
      for (const id of s.target_ids || []) ids.add(String(id));
    }
  }
  return { ids: [...ids], appId: info?.data?.app_id ? String(info.data.app_id) : null, valido: Boolean(info?.data?.is_valid) };
}

// Busca la cuenta de WhatsApp que contiene nuestro número
async function cuentaDelNumero(env, fetchImpl) {
  const { ids, appId, valido } = await cuentasDelToken(env, fetchImpl);
  for (const id of ids) {
    const numeros = await graph(env, `${id}/phone_numbers?fields=id,display_phone_number`, {}, fetchImpl).catch(() => ({ data: [] }));
    if ((numeros.data || []).some((n) => String(n.id) === String(env.WHATSAPP_PHONE_ID))) return { waba: id, appId, valido, cuentas: ids };
  }
  return { waba: null, appId, valido, cuentas: ids };
}

export async function estadoConexion(env, fetchImpl = fetch) {
  const faltan = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "OWNER_PHONE"].filter((k) => !env[k]);
  if (faltan.includes("WHATSAPP_TOKEN") || faltan.includes("WHATSAPP_PHONE_ID")) return { ok: false, faltan };

  const res = { ok: true, faltan };
  try {
    res.numero = await graph(env, `${env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating,platform_type`, {}, fetchImpl);
  } catch (e) {
    return { ok: false, faltan, error: "No se puede leer el número con el token: " + e.message };
  }
  try {
    const c = await cuentaDelNumero(env, fetchImpl);
    res.waba = c.waba;
    res.appId = c.appId;
    if (c.waba) {
      const subs = await graph(env, `${c.waba}/subscribed_apps`, {}, fetchImpl);
      res.apps = (subs.data || []).map((a) => ({
        id: String(a.whatsapp_business_api_data?.id || a.id || ""),
        nombre: a.whatsapp_business_api_data?.name || a.name || "(sin nombre)",
      }));
      res.miAppConectada = Boolean(c.appId && res.apps.some((a) => a.id === c.appId));
    } else {
      res.error = "El token no da acceso a la cuenta de WhatsApp de este número (revisa 'Asignar activos' del usuario del sistema).";
    }
  } catch (e) {
    res.error = "No se pudo comprobar la cuenta de WhatsApp: " + e.message;
  }
  return res;
}

export async function conectarApp(env, fetchImpl = fetch) {
  const c = await cuentaDelNumero(env, fetchImpl);
  if (!c.waba) throw new Error("El token no da acceso a la cuenta de WhatsApp de este número.");
  await graph(env, `${c.waba}/subscribed_apps`, { method: "POST" }, fetchImpl);
  return estadoConexion(env, fetchImpl);
}
