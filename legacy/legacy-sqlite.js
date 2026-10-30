"use strict";
// The little of node:sqlite's DatabaseSync that import.js uses, on sql.js (SQLite compiled to JavaScript):
// Drift Legacy's Node 16 has no built-in SQLite. Wait for `ready` before opening a database.
const fs = require("fs");

let SQL = null;
const ready = require("./sql-asm.js")().then(s => { SQL = s; });

class DatabaseSync {
  constructor(file) {
    if (!SQL) throw new Error("SQLite isn't loaded yet");
    this.db = new SQL.Database(fs.readFileSync(file));
  }
  prepare(sql) {
    const db = this.db;
    return {
      all() { const st = db.prepare(sql), rows = []; try { while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); } return rows; },
      get() { const st = db.prepare(sql); try { return st.step() ? st.getAsObject() : undefined; } finally { st.free(); } },
    };
  }
  close() { this.db.close(); }
}

module.exports = { DatabaseSync, ready };
