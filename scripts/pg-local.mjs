// A tiny PostgreSQL client for local development and tests.
// It speaks the simple query protocol over a Unix socket with trust authentication,
// and returns rows typed the way the Neon driver returns them.
import net from 'node:net';

const literal = v => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object') v = JSON.stringify(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
};
const substitute = (text, params) => text.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));

function convert(v, oid) {
  if (v === null) return null;
  switch (oid) {
    case 16: return v === 't';
    case 21: case 23: case 26: case 700: case 701: return Number(v);
    case 114: case 3802: return JSON.parse(v);
    default: return v; // text, uuid, int8 and numeric stay strings, as with Neon
  }
}

function parseError(b) {
  const f = {};
  let off = 0;
  while (off < b.length && b[off] !== 0) {
    const t = String.fromCharCode(b[off]);
    const end = b.indexOf(0, off + 1);
    f[t] = b.toString('utf8', off + 1, end);
    off = end + 1;
  }
  const e = new Error(f.M || 'database error');
  e.code = f.C;
  e.detail = f.D;
  return e;
}

export function localPg({ socketDir, port = 5432, user = 'postgres', database = 'postgres' }) {
  let conn = null;
  let queue = Promise.resolve();

  const connect = () => new Promise((resolve, reject) => {
    const sock = net.createConnection({ path: `${socketDir}/.s.PGSQL.${port}` });
    const st = { sock, onMessage: null };
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 5) {
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) break;
        const type = String.fromCharCode(buf[0]);
        const body = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);
        if (st.onMessage) st.onMessage(type, body);
      }
    });
    sock.on('error', reject);
    st.onMessage = (type, body) => {
      if (type === 'R' && body.readInt32BE(0) !== 0) reject(new Error('Only trust authentication is supported'));
      else if (type === 'E') reject(parseError(body));
      else if (type === 'Z') { st.onMessage = null; resolve(st); }
    };
    sock.on('connect', () => {
      const params = Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`);
      const head = Buffer.alloc(8);
      head.writeInt32BE(8 + params.length, 0);
      head.writeInt32BE(196608, 4);
      sock.write(Buffer.concat([head, params]));
    });
  });

  const run = sql => new Promise((resolve, reject) => {
    let fields = [];
    const rows = [];
    let error = null;
    conn.onMessage = (type, b) => {
      if (type === 'T') {
        fields = [];
        let off = 2;
        for (let i = 0, n = b.readInt16BE(0); i < n; i++) {
          const end = b.indexOf(0, off);
          fields.push({ name: b.toString('utf8', off, end), oid: b.readInt32BE(end + 1 + 6) });
          off = end + 1 + 18;
        }
      } else if (type === 'D') {
        const row = {};
        let off = 2;
        for (let i = 0, n = b.readInt16BE(0); i < n; i++) {
          const len = b.readInt32BE(off);
          off += 4;
          let v = null;
          if (len >= 0) { v = b.toString('utf8', off, off + len); off += len; }
          row[fields[i].name] = convert(v, fields[i].oid);
        }
        rows.push(row);
      } else if (type === 'E') {
        error = parseError(b);
      } else if (type === 'Z') {
        conn.onMessage = null;
        if (error) reject(error); else resolve(rows);
      }
    };
    const body = Buffer.from(sql + '\0');
    const head = Buffer.alloc(5);
    head.write('Q', 0);
    head.writeInt32BE(4 + body.length, 1);
    conn.sock.write(Buffer.concat([head, body]));
  });

  return function query(text, params = []) {
    const job = queue.then(async () => {
      if (!conn) conn = await connect();
      return run(substitute(text, params));
    });
    queue = job.catch(() => {});
    return job;
  };
}
