// TEST HARNESS ONLY — minimal `pg` Client stand-in dispatching to the shared synthetic cluster
// (globalThis.__LAI03B_SYNTH_CLUSTER__) by application_name prefix: the reader's own factory for a
// "lai03b-reader:" connection, the attester's observer factory for everything else. No network.
import { EventEmitter } from "node:events";
import { APPLICATION_NAME_PREFIX } from "../../../private-reader-production-integration-offline-01/reader-session.mjs";
export class Client extends EventEmitter {
  constructor(cfg) { super(); this._app = cfg && cfg.application_name; this._hasUrl = !!(cfg && typeof cfg.connectionString === "string" && cfg.connectionString.length > 0); }
  async connect() {
    const c = globalThis.__LAI03B_SYNTH_CLUSTER__;
    if (!c || !this._hasUrl) throw new Error("connect failed");
    const isReader = typeof this._app === "string" && this._app.startsWith(APPLICATION_NAME_PREFIX);
    this._p = isReader ? await c.readerFactory.open({ applicationName: this._app }) : await c.observerFactory.open();
    if (typeof this._p.onDead === "function") this._p.onDead(() => this.emit("end"));
  }
  async query(sql, params) { if (!this._p) throw new Error("not connected"); return this._p.query(sql, params); }
  async end() { if (this._p) await this._p.close(); }
}
export default { Client };
