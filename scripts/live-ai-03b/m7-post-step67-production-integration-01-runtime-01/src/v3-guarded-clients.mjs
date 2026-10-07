const IDRE = /^[A-Za-z0-9._:-]{8,128}$/;
function refused(code){ const e = new Error('guarded_client_refused'); e.code = code; return e; }

export function makeGuardedExecutorClientV3(session, activateSql, { testBoundary=false }={}) {
  if (!session?.physical || typeof session.physical.query !== 'function') throw new Error('guarded_executor_session_absent');
  if (typeof activateSql !== 'string' || !activateSql.includes('live_ai_03b_trusted_v3.activate_catalog_v3')) throw new Error('guarded_executor_sql_identity_invalid');
  const physical = session.physical; let used = false;
  const client = {
    async query(sql, params) {
      if (typeof physical.isDead === 'function' && physical.isDead()) throw refused('EXECUTOR_CONNECTION_DEAD');
      if (sql !== activateSql) throw refused('EXECUTOR_SQL_NOT_ADMITTED');
      if (!Array.isArray(params) || params.length !== 2 || typeof params[0] !== 'string' || typeof params[1] !== 'string' || !IDRE.test(params[1])) throw refused('EXECUTOR_PARAMS_NOT_ADMITTED');
      if (used) throw refused('EXECUTOR_ACTIVATION_ALREADY_ISSUED');
      used = true;
      return physical.query(sql, params);
    }
  };
  if (testBoundary) client.__testFixture = true;
  return Object.freeze(client);
}

export function makeGuardedReaderClientV3(session, queries, { testBoundary=false }={}) {
  if (!session?.physical || typeof session.physical.query !== 'function') throw new Error('guarded_reader_session_absent');
  const q = queries && typeof queries === 'object' ? queries : null;
  const keys = ['catalogEntries','catalogVersions','controls','ledger','policy'];
  if (!q || Object.keys(q).sort().join(',') !== keys.join(',')) throw new Error('guarded_reader_registry_shape_invalid');
  const allowed = new Set(Object.values(q));
  if (allowed.size !== 5 || [...allowed].some(x => typeof x !== 'string' || !x.startsWith('SELECT '))) throw new Error('guarded_reader_registry_invalid');
  const physical = session.physical;
  const client = {
    async query(sql, params) {
      if (typeof physical.isDead === 'function' && physical.isDead()) throw refused('READER_CONNECTION_DEAD');
      if (!allowed.has(sql)) throw refused('READER_SQL_NOT_ADMITTED');
      const p = params === undefined ? [] : params;
      if (!Array.isArray(p)) throw refused('READER_PARAMS_NOT_ADMITTED');
      if (sql === q.ledger) {
        if (p.length !== 2 || !p.every(x => typeof x === 'string' && IDRE.test(x))) throw refused('READER_PARAMS_NOT_ADMITTED');
      } else if (p.length !== 0) throw refused('READER_PARAMS_NOT_ADMITTED');
      return physical.query(sql, p);
    },
    statementTimeoutMs: session.effectiveStatementTimeoutMs,
  };
  if (testBoundary) client.__testFixture = true;
  return Object.freeze(client);
}
