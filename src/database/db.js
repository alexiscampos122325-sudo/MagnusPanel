import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./src/database/database.sqlite", (err) => {
  if (err) {
    console.log("Error DB:", err.message);
  } else {
    console.log("SQLite conectado");
  }
});

export default db;