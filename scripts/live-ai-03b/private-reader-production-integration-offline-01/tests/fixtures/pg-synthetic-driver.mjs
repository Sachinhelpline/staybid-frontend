// TEST HARNESS ONLY — minimal stand-in for the `pg` Client surface the production factory uses
// (constructor config, connect, query, end, 'end' event). Backed by the synthetic PostgreSQL model on
// globalThis.__LAI03B_SYNTH_PG__. No network. The connection string is only checked for presence and is
// never stored or echoed.
import { EventEmitter } from "node:events";
export class Client extends EventEmitter {
  constructor(cfg) { super(); this._app = cfg && cfg.application_name; this._hasUrl = !!(cfg && typeof cfg.connectionString === "string" && cfg.connectionString.length > 0); }
  async connect() {
    const db = globalThis.__LAI03B_SYNTH_PG__;
    if (!db || !this._hasUrl) throw new Error("connect failed");
    db.driverConnects = (db.driverConnects || 0) + 1;
    this._p = await db.factory.open({ applicationName: this._app });
    this._p.onDead(() => { this.emit("end"); });
  }
  async query(sql, params) { if (!this._p) throw new Error("not connected"); return this._p.query(sql, params); }
  async end() { if (this._p) await this._p.close(); }
}
export default { Client };
