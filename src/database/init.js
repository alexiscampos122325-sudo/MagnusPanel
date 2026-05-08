import "dotenv/config";
import db from "./db.js";
import bcrypt from "bcrypt";

db.serialize(async () => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'USER',
      telegram_id TEXT,
      active INTEGER DEFAULT 1,
      plan_id INTEGER,
      expires_at DATETIME,
      max_bots INTEGER DEFAULT 0,
      max_channels INTEGER DEFAULT 0,
      max_tasks INTEGER DEFAULT 0,
      seller_key_limit INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      max_bots INTEGER,
      max_channels INTEGER,
      max_tasks INTEGER,
      days INTEGER,
      price REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS license_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE,
      plan_id INTEGER,
      created_by INTEGER,
      used_by INTEGER,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      token TEXT,
      bot_username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      bot_id INTEGER,
      name TEXT,
      chat_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      bot_id INTEGER,
      channel_id INTEGER,
      message TEXT,
      cron_time TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      status TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      plan_id INTEGER,
      amount REAL,
      proof TEXT,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE bots ADD COLUMN bot_username TEXT`, () => {});
  db.run(`ALTER TABLE bots ADD COLUMN created_at DATETIME`, () => {});

  console.log("Tablas creadas");

  const ownerPassword = await bcrypt.hash(
    process.env.OWNER_PASSWORD || "123456",
    10
  );

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [process.env.OWNER_USERNAME || "owner"],
    (err, user) => {
      if (!user) {
        db.run(
          "INSERT INTO users (username, password, role, active) VALUES (?, ?, ?, ?)",
          [
            process.env.OWNER_USERNAME || "owner",
            ownerPassword,
            "OWNER",
            1
          ]
        );

        console.log("OWNER creado");
      }
    }
  );

  const defaultPlans = [
    ["PREMIUM", 1, 5, 10, 7, 5],
    ["VIP", 3, 15, 50, 30, 15],
    ["DIAMANTE", 5, 30, 100, 30, 30],
    ["PLATINUM", 10, 100, 300, 30, 50],
  ];

  defaultPlans.forEach((plan) => {
    db.run(
      `INSERT OR IGNORE INTO plans 
      (name, max_bots, max_channels, max_tasks, days, price)
      VALUES (?, ?, ?, ?, ?, ?)`,
      plan
    );
  });
});