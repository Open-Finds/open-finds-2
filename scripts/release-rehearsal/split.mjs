// Split a SQL script into statements the way psql -f sees them (autocommit per statement).
export function splitSql(sql) {
  const out = []; let cur = ''; let i = 0; const n = sql.length;
  while (i < n) {
    const ch = sql[i], two = sql.slice(i, i + 2);
    if (two === '--') { const e = sql.indexOf('\n', i); const j = e < 0 ? n : e; cur += sql.slice(i, j); i = j; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; cur += sql.slice(i, j); i = j; continue; }
    if (ch === "'") { let j = i + 1; while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; } cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (ch === '"') { const e = sql.indexOf('"', i + 1); const j = e < 0 ? n : e + 1; cur += sql.slice(i, j); i = j; continue; }
    if (ch === '$') { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const e = sql.indexOf(tag, i + tag.length); const j = e < 0 ? n : e + tag.length; cur += sql.slice(i, j); i = j; continue; } }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(s => s.replace(/--[^\n]*/g, '').trim());
}
