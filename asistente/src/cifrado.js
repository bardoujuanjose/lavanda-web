// =====================================================================
//  Cifrado de los datos privados que se guardan en la base de datos
//  (por ejemplo, el token de WhatsApp de cada lavandería).
//
//  AES-GCM de 256 bits. La clave sale del secreto CLAVE_CIFRADO de Cloudflare:
//  sin él no se puede guardar ni leer ningún token. Si se cambia CLAVE_CIFRADO,
//  los tokens guardados dejan de poder leerse (hay que volver a conectarlos).
// =====================================================================
const enc = new TextEncoder();
const dec = new TextDecoder();

async function claveDe(secreto) {
  if (!secreto || String(secreto).length < 16) throw new Error("Falta el secreto CLAVE_CIFRADO (mínimo 16 caracteres)");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(String(secreto)));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const aBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const deBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Devuelve "v1:<iv>:<datos>" (todo en base64). Cada vez sale distinto aunque el texto sea el mismo.
export async function cifrar(texto, secreto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveDe(secreto), enc.encode(String(texto))));
  return `v1:${aBase64(iv)}:${aBase64(datos)}`;
}

export async function descifrar(cifrado, secreto) {
  const [version, iv, datos] = String(cifrado || "").split(":");
  if (version !== "v1" || !iv || !datos) throw new Error("Dato cifrado con un formato desconocido");
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deBase64(iv) }, await claveDe(secreto), deBase64(datos));
  return dec.decode(claro);
}
