// =====================================================================
//  Base de datos de las lavanderías (Cloudflare Durable Object)
//
//  Hay UNA sola instancia ("principal") con las fichas de las lavanderías
//  dadas de alta desde el panel (/admin). Lavanda no está aquí: su ficha es
//  el archivo src/clientes/lavanda.js.
//
//  Solo guarda y devuelve: la validación y el cifrado se hacen fuera
//  (clientes/index.js y admin.js), donde se pueden probar.
// =====================================================================
import { DurableObject } from "cloudflare:workers";

export class Registro extends DurableObject {
  async listar() {
    const todo = await this.ctx.storage.list({ prefix: "ficha:" });
    return [...todo.values()];
  }
  async leer(id) {
    return (await this.ctx.storage.get("ficha:" + id)) ?? null;
  }
  async guardar(ficha) {
    await this.ctx.storage.put("ficha:" + ficha.id, ficha);
    return true;
  }
  async borrar(id) {
    return this.ctx.storage.delete("ficha:" + id);
  }
}

// El acceso a la instancia única está en clientes/index.js (almacenRegistro).
