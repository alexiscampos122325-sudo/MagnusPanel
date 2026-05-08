import { startTelegramBot } from "./telegram/bot.js";
import "dotenv/config";

import express from "express";
import session from "express-session";
import path from "path";
import bcrypt from "bcrypt";
import fs from "fs";
import cron from "node-cron";
import multer from "multer";
import { fileURLToPath } from "url";

import "./database/init.js";
import db from "./database/db.js";

const app = express();
const cronJobs = new Map();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "src/public/uploads");
  },

  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/");
    if (!roles.includes(req.session.user.role)) return res.send("No tienes permiso");
    next();
  };
}

function createLicenseKey(planId, createdBy, callback) {
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  const key = `MAGNUS-${random}`;

  db.run(
    "INSERT INTO license_keys (license_key, plan_id, created_by, status) VALUES (?, ?, ?, ?)",
    [key, planId, createdBy, "active"],
    function (err) {
      callback(err, key);
    }
  );
}

async function sendTelegramMessage(taskId, userId, token, chatId, message) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });

    const data = await response.json();

    db.run(
      "INSERT INTO logs (task_id, user_id, status, message) VALUES (?, ?, ?, ?)",
      [
        taskId,
        userId,
        data.ok ? "SUCCESS" : "ERROR",
        data.ok ? "Mensaje enviado correctamente" : data.description || "Error Telegram",
      ]
    );
  } catch (err) {
    db.run(
      "INSERT INTO logs (task_id, user_id, status, message) VALUES (?, ?, ?, ?)",
      [taskId, userId, "ERROR", err.message]
    );
  }
}

function startTask(task) {
  if (cronJobs.has(task.id)) {
    cronJobs.get(task.id).stop();
    cronJobs.delete(task.id);
  }

  if (!cron.validate(task.cron_time)) return;

  const job = cron.schedule(task.cron_time, async () => {
    await sendTelegramMessage(task.id, task.user_id, task.token, task.chat_id, task.message);
  });

  cronJobs.set(task.id, job);
}

function loadCronTasks() {
  db.all(
    `
    SELECT tasks.*, channels.chat_id, bots.token
    FROM tasks
    LEFT JOIN channels ON tasks.channel_id = channels.id
    LEFT JOIN bots ON tasks.bot_id = bots.id
    WHERE tasks.active = 1
    `,
    [],
    (err, tasks) => {
      if (err || !tasks) return;
      tasks.forEach((task) => startTask(task));
    }
  );
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "MagnusSecret123",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (!user) return res.send("Usuario no encontrado");

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.send("Contraseña incorrecta");

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };

    res.redirect("/dashboard");
  });
});

app.get("/dashboard", requireLogin, (req, res) => {
  const user = req.session.user;

  db.get("SELECT COUNT(*) AS total FROM users", [], (err, usersData) => {
    db.get("SELECT COUNT(*) AS total FROM bots", [], (err, botsData) => {
      db.get("SELECT COUNT(*) AS total FROM channels", [], (err, channelsData) => {
        db.get("SELECT COUNT(*) AS total FROM tasks WHERE active = 1", [], (err, tasksData) => {
          db.get("SELECT COUNT(*) AS total FROM logs WHERE status = 'SUCCESS'", [], (err, successData) => {
            db.get("SELECT COUNT(*) AS total FROM logs WHERE status = 'ERROR'", [], (err, errorData) => {
              let html = fs.readFileSync(path.join(__dirname, "views/dashboard.html"), "utf8");

              html = html.replace("{{USERNAME}}", user.username);
              html = html.replace("{{TOTAL_USERS}}", usersData?.total || 0);
              html = html.replace("{{TOTAL_BOTS}}", botsData?.total || 0);
              html = html.replace("{{TOTAL_CHANNELS}}", channelsData?.total || 0);
              html = html.replace("{{TOTAL_TASKS}}", tasksData?.total || 0);
              html = html.replace("{{TOTAL_SUCCESS}}", successData?.total || 0);
              html = html.replace("{{TOTAL_ERRORS}}", errorData?.total || 0);

              res.send(html);
            });
          });
        });
      });
    });
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/users", requireRole("OWNER", "CO_OWNER"), (req, res) => {
  db.all("SELECT * FROM users ORDER BY id DESC", [], (err, users) => {
    if (err) return res.send("Error cargando usuarios");

    const rows = users.map(user => `
      <tr>
        <td>${user.id}</td>
        <td>${user.username}</td>
        <td><span class="badge">${user.role}</span></td>
        <td>${user.active ? "Activo" : "Inactivo"}</td>
        <td>${user.telegram_id || "-"}</td>
        <td>${user.created_at}</td>
      </tr>
    `).join("");

    const html = fs.readFileSync(path.join(__dirname, "views/users.html"), "utf8");
    res.send(html.replace("{{USERS}}", rows));
  });
});

app.post("/users/create", requireRole("OWNER"), async (req, res) => {
  const { username, password, role } = req.body;

  if (!["USER", "SELLER", "CO_OWNER"].includes(role)) return res.send("Rol inválido");

  const hash = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
    [username, hash, role],
    (err) => {
      if (err) return res.send("Error: usuario ya existe");
      res.redirect("/users");
    }
  );
});

app.get("/bots", requireLogin, (req, res) => {
  const user = req.session.user;

  db.all("SELECT * FROM bots WHERE user_id = ? ORDER BY id DESC", [user.id], (err, bots) => {
    if (err) return res.send("Error cargando bots");

    const rows = bots.map(bot => `
      <tr>
        <td>${bot.id}</td>
        <td>${bot.name}</td>
        <td><span class="badge">@${bot.bot_username}</span></td>
        <td>Conectado ✅</td>
        <td>${bot.created_at || "-"}</td>
        <td>
          <form method="POST" action="/bots/delete" style="display:inline;">
            <input type="hidden" name="bot_id" value="${bot.id}">
            <button type="submit">Eliminar</button>
          </form>
        </td>
      </tr>
    `).join("");

    const html = fs.readFileSync(path.join(__dirname, "views/bots.html"), "utf8");
    res.send(html.replace("{{BOTS}}", rows));
  });
});

app.post("/bots/add", requireLogin, (req, res) => {
  const { name, token } = req.body;
  const user = req.session.user;

  db.get("SELECT * FROM users WHERE id = ?", [user.id], (err, dbUser) => {
    db.get("SELECT COUNT(*) AS total FROM bots WHERE user_id = ?", [user.id], async (err, countData) => {
      if (countData.total >= dbUser.max_bots) {
        return res.send(`Tu plan solo permite ${dbUser.max_bots} bots`);
      }

      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await response.json();

        if (!data.ok) return res.send("Token inválido");

        db.run(
          "INSERT INTO bots (user_id, name, token, bot_username) VALUES (?, ?, ?, ?)",
          [user.id, name, token, data.result.username],
          (err) => {
            if (err) return res.send("Error guardando bot");
            res.redirect("/bots");
          }
        );
      } catch {
        res.send("Error conectando Telegram");
      }
    });
  });
});

app.post("/bots/delete", requireLogin, (req, res) => {
  const { bot_id } = req.body;
  const user = req.session.user;

  db.run("DELETE FROM bots WHERE id = ? AND user_id = ?", [bot_id, user.id], () => {
    res.redirect("/bots");
  });
});

app.get("/channels", requireLogin, (req, res) => {
  const user = req.session.user;

  db.all("SELECT * FROM bots WHERE user_id = ?", [user.id], (err, bots) => {
    const botOptions = bots.map(bot => `
      <option value="${bot.id}">${bot.name} (@${bot.bot_username})</option>
    `).join("");

    db.all(
      `
      SELECT channels.*, bots.name AS bot_name
      FROM channels
      LEFT JOIN bots ON channels.bot_id = bots.id
      WHERE channels.user_id = ?
      ORDER BY channels.id DESC
      `,
      [user.id],
      (err, channels) => {
        const rows = channels.map(channel => `
          <tr>
            <td>${channel.id}</td>
            <td>${channel.name}</td>
            <td>${channel.bot_name}</td>
            <td>${channel.chat_id}</td>
            <td>${channel.created_at}</td>
            <td>
              <form method="POST" action="/channels/delete">
                <input type="hidden" name="channel_id" value="${channel.id}">
                <button type="submit">Eliminar</button>
              </form>
            </td>
          </tr>
        `).join("");

        const html = fs.readFileSync(path.join(__dirname, "views/channels.html"), "utf8");
        res.send(html.replace("{{BOT_OPTIONS}}", botOptions).replace("{{CHANNELS}}", rows));
      }
    );
  });
});

app.post("/channels/add", requireLogin, (req, res) => {
  const { bot_id, chat_id } = req.body;
  const user = req.session.user;

  db.get("SELECT * FROM users WHERE id = ?", [user.id], (err, dbUser) => {
    db.get("SELECT COUNT(*) AS total FROM channels WHERE user_id = ?", [user.id], (err, countData) => {
      if (countData.total >= dbUser.max_channels) {
        return res.send(`Tu plan solo permite ${dbUser.max_channels} canales`);
      }

      db.get("SELECT * FROM bots WHERE id = ? AND user_id = ?", [bot_id, user.id], async (err, bot) => {
        if (!bot) return res.send("Bot no encontrado");

        try {
          const response = await fetch(`https://api.telegram.org/bot${bot.token}/getChat?chat_id=${chat_id}`);
          const data = await response.json();

          if (!data.ok) return res.send("El bot no tiene acceso al canal o canal inválido");

          db.run(
            "INSERT INTO channels (user_id, bot_id, name, chat_id) VALUES (?, ?, ?, ?)",
            [user.id, bot.id, data.result.title || chat_id, chat_id],
            (err) => {
              if (err) return res.send("Error guardando canal");
              res.redirect("/channels");
            }
          );
        } catch {
          res.send("Error conectando Telegram");
        }
      });
    });
  });
});

app.post("/channels/delete", requireLogin, (req, res) => {
  const { channel_id } = req.body;
  const user = req.session.user;

  db.run("DELETE FROM channels WHERE id = ? AND user_id = ?", [channel_id, user.id], () => {
    res.redirect("/channels");
  });
});

app.get("/tasks", requireLogin, (req, res) => {
  const user = req.session.user;

  db.all(
    `
    SELECT channels.*, bots.name AS bot_name
    FROM channels
    LEFT JOIN bots ON channels.bot_id = bots.id
    WHERE channels.user_id = ?
    `,
    [user.id],
    (err, channels) => {
      const channelOptions = channels.map(channel => `
        <option value="${channel.id}">${channel.name} (${channel.bot_name})</option>
      `).join("");

      db.all(
        `
        SELECT tasks.*, channels.name AS channel_name
        FROM tasks
        LEFT JOIN channels ON tasks.channel_id = channels.id
        WHERE tasks.user_id = ?
        ORDER BY tasks.id DESC
        `,
        [user.id],
        (err, tasks) => {
          const rows = tasks.map(task => `
            <tr>
              <td>${task.id}</td>
              <td>${task.channel_name}</td>
              <td>${task.message}</td>
              <td>${task.cron_time}</td>
              <td><span class="badge ${task.active ? "" : "off"}">${task.active ? "ACTIVA" : "PAUSADA"}</span></td>
              <td>
                <form method="POST" action="/tasks/toggle" style="display:inline;">
                  <input type="hidden" name="task_id" value="${task.id}">
                  <button type="submit">${task.active ? "Pausar" : "Activar"}</button>
                </form>
                <form method="POST" action="/tasks/delete" style="display:inline;">
                  <input type="hidden" name="task_id" value="${task.id}">
                  <button type="submit">Eliminar</button>
                </form>
              </td>
            </tr>
          `).join("");

          const html = fs.readFileSync(path.join(__dirname, "views/tasks.html"), "utf8");
          res.send(html.replace("{{CHANNEL_OPTIONS}}", channelOptions).replace("{{TASKS}}", rows));
        }
      );
    }
  );
});

app.post("/tasks/create", requireLogin, (req, res) => {
  const { channel_id, message, cron_time } = req.body;
  const user = req.session.user;

  if (!cron.validate(cron_time)) return res.send("Cron inválido");

  db.get("SELECT * FROM users WHERE id = ?", [user.id], (err, dbUser) => {
    db.get("SELECT COUNT(*) AS total FROM tasks WHERE user_id = ?", [user.id], (err, countData) => {
      if (countData.total >= dbUser.max_tasks) {
        return res.send(`Tu plan solo permite ${dbUser.max_tasks} tareas`);
      }

      db.get(
        `
        SELECT channels.*, bots.id AS bot_id, bots.token
        FROM channels
        LEFT JOIN bots ON channels.bot_id = bots.id
        WHERE channels.id = ? AND channels.user_id = ?
        `,
        [channel_id, user.id],
        (err, channel) => {
          if (!channel) return res.send("Canal no encontrado");

          db.run(
            "INSERT INTO tasks (user_id, bot_id, channel_id, message, cron_time, active) VALUES (?, ?, ?, ?, ?, ?)",
            [user.id, channel.bot_id, channel.id, message, cron_time, 1],
            function (err) {
              if (err) return res.send("Error creando tarea");

              startTask({
                id: this.lastID,
                user_id: user.id,
                token: channel.token,
                chat_id: channel.chat_id,
                message,
                cron_time,
              });

              res.redirect("/tasks");
            }
          );
        }
      );
    });
  });
});

app.post("/tasks/toggle", requireLogin, (req, res) => {
  const { task_id } = req.body;
  const user = req.session.user;

  db.get("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [task_id, user.id], (err, task) => {
    if (!task) return res.send("Tarea no encontrada");

    const newStatus = task.active ? 0 : 1;

    db.run("UPDATE tasks SET active = ? WHERE id = ?", [newStatus, task.id], () => {
      if (cronJobs.has(task.id)) {
        cronJobs.get(task.id).stop();
        cronJobs.delete(task.id);
      }

      if (newStatus === 1) {
        db.get(
          `
          SELECT tasks.*, channels.chat_id, bots.token
          FROM tasks
          LEFT JOIN channels ON tasks.channel_id = channels.id
          LEFT JOIN bots ON tasks.bot_id = bots.id
          WHERE tasks.id = ?
          `,
          [task.id],
          (err, fullTask) => {
            if (fullTask) startTask(fullTask);
            res.redirect("/tasks");
          }
        );
      } else {
        res.redirect("/tasks");
      }
    });
  });
});

app.post("/tasks/delete", requireLogin, (req, res) => {
  const { task_id } = req.body;
  const user = req.session.user;

  if (cronJobs.has(Number(task_id))) {
    cronJobs.get(Number(task_id)).stop();
    cronJobs.delete(Number(task_id));
  }

  db.run("DELETE FROM tasks WHERE id = ? AND user_id = ?", [task_id, user.id], () => {
    res.redirect("/tasks");
  });
});

app.get("/logs", requireLogin, (req, res) => {
  const user = req.session.user;

  db.all(
    `
    SELECT logs.*, tasks.id AS task_number
    FROM logs
    LEFT JOIN tasks ON logs.task_id = tasks.id
    WHERE logs.user_id = ?
    ORDER BY logs.id DESC
    LIMIT 200
    `,
    [user.id],
    (err, logs) => {
      if (err) return res.send("Error cargando logs");

      const rows = logs.map(log => `
        <tr>
          <td>${log.id}</td>
          <td>#${log.task_number || "-"}</td>
          <td class="${log.status === "SUCCESS" ? "ok" : "error"}">${log.status}</td>
          <td>${log.message}</td>
          <td>${log.created_at}</td>
        </tr>
      `).join("");

      const html = fs.readFileSync(path.join(__dirname, "views/logs.html"), "utf8");
      res.send(html.replace("{{LOGS}}", rows));
    }
  );
});

app.get("/keys", requireRole("OWNER", "CO_OWNER", "SELLER"), (req, res) => {
  const user = req.session.user;

  db.all("SELECT * FROM plans ORDER BY id ASC", [], (err, plans) => {
    if (err) return res.send("Error cargando planes");

    const planOptions = plans.map(plan => `
      <option value="${plan.id}">${plan.name}</option>
    `).join("");

    let query = `
      SELECT license_keys.*, plans.name AS plan_name,
      creator.username AS creator_name,
      useduser.username AS used_name
      FROM license_keys
      LEFT JOIN plans ON license_keys.plan_id = plans.id
      LEFT JOIN users AS creator ON license_keys.created_by = creator.id
      LEFT JOIN users AS useduser ON license_keys.used_by = useduser.id
    `;

    const params = [];

    if (user.role === "SELLER") {
      query += " WHERE license_keys.created_by = ?";
      params.push(user.id);
    }

    query += " ORDER BY license_keys.id DESC";

    db.all(query, params, (err, keys) => {
      if (err) return res.send("Error cargando keys");

      const rows = keys.map(key => `
        <tr>
          <td>${key.id}</td>
          <td>${key.license_key}</td>
          <td>${key.plan_name}</td>
          <td><span class="badge ${key.status}">${key.status}</span></td>
          <td>${key.creator_name || "-"}</td>
          <td>${key.used_name || "-"}</td>
          <td>${key.created_at}</td>
          <td>
            ${
              key.status === "active"
                ? `<form method="POST" action="/keys/revoke" style="display:inline;">
                    <input type="hidden" name="key_id" value="${key.id}">
                    <button type="submit">Revocar</button>
                  </form>`
                : "-"
            }
          </td>
        </tr>
      `).join("");

      const html = fs.readFileSync(path.join(__dirname, "views/keys.html"), "utf8");

      res.send(
        html
          .replace("{{PLAN_OPTIONS}}", planOptions)
          .replace("{{KEYS}}", rows)
      );
    });
  });
});

app.post("/keys/create", requireRole("OWNER", "CO_OWNER", "SELLER"), (req, res) => {
  const { plan_id } = req.body;
  const user = req.session.user;

  function createKey() {
    createLicenseKey(plan_id, user.id, (err) => {
      if (err) return res.send("Error creando key");
      res.redirect("/keys");
    });
  }

  if (user.role === "SELLER") {
    db.get("SELECT COUNT(*) AS total FROM license_keys WHERE created_by = ?", [user.id], (err, result) => {
      if (err) return res.send("Error validando límite seller");
      if (result.total >= 10) return res.send("Tu límite de seller es 10 keys.");
      createKey();
    });
  } else {
    createKey();
  }
});

app.post("/keys/revoke", requireRole("OWNER", "CO_OWNER", "SELLER"), (req, res) => {
  const { key_id } = req.body;
  const user = req.session.user;

  let query = "UPDATE license_keys SET status = 'revoked' WHERE id = ? AND status = 'active'";
  const params = [key_id];

  if (user.role === "SELLER") {
    query += " AND created_by = ?";
    params.push(user.id);
  }

  db.run(query, params, () => res.redirect("/keys"));
});

app.get("/activate", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "views/activate.html"));
});

app.post("/activate", requireLogin, (req, res) => {
  const { license_key } = req.body;
  const user = req.session.user;

  db.get(
    `
    SELECT license_keys.*, plans.name, plans.max_bots, plans.max_channels,
    plans.max_tasks, plans.days
    FROM license_keys
    LEFT JOIN plans ON license_keys.plan_id = plans.id
    WHERE license_key = ?
    `,
    [license_key],
    (err, key) => {
      if (!key) return res.send("Key no encontrada");
      if (key.status !== "active") return res.send("Key inválida");

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + key.days);

      db.run(
        `
        UPDATE users
        SET plan_id = ?, expires_at = ?, max_bots = ?, max_channels = ?, max_tasks = ?
        WHERE id = ?
        `,
        [key.plan_id, expiresAt.toISOString(), key.max_bots, key.max_channels, key.max_tasks, user.id],
        (err) => {
          if (err) return res.send("Error activando membresía");

          db.run(
            "UPDATE license_keys SET status = 'used', used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?",
            [user.id, key.id]
          );

          res.send(`
            <h1>Membresía activada ✅</h1>
            <p>Plan: ${key.name}</p>
            <p>Expira: ${expiresAt.toDateString()}</p>
            <a href="/dashboard">Volver</a>
          `);
        }
      );
    }
  );
});

app.get("/payments", requireLogin, (req, res) => {
  const user = req.session.user;

  db.all("SELECT * FROM plans ORDER BY id ASC", [], (err, plans) => {
    const planOptions = plans.map(plan => `
      <option value="${plan.id}">${plan.name} - $${plan.price}</option>
    `).join("");

    let query = `
      SELECT payments.*, users.username, plans.name AS plan_name
      FROM payments
      LEFT JOIN users ON payments.user_id = users.id
      LEFT JOIN plans ON payments.plan_id = plans.id
    `;

    const params = [];

    if (!["OWNER", "CO_OWNER"].includes(user.role)) {
      query += " WHERE payments.user_id = ?";
      params.push(user.id);
    }

    query += " ORDER BY payments.id DESC";

    db.all(query, params, (err, payments) => {
      if (err) return res.send("Error cargando pagos");

      const rows = payments.map(payment => `
        <tr>
          <td>${payment.id}</td>
          <td>${payment.username || "-"}</td>
          <td>${payment.plan_name || "-"}</td>
          <td>$${payment.amount || 0}</td>
          <td>
            <a href="${payment.proof}" target="_blank" style="color:#60a5fa;">
              Ver comprobante
            </a>
          </td>
          <td><span class="badge ${payment.status.toLowerCase()}">${payment.status}</span></td>
          <td>${payment.created_at}</td>
          <td>
            ${
              ["OWNER", "CO_OWNER"].includes(user.role) && payment.status === "PENDING"
                ? `
                  <form method="POST" action="/payments/approve" style="display:inline;">
                    <input type="hidden" name="payment_id" value="${payment.id}">
                    <button type="submit">Aprobar</button>
                  </form>
                  <form method="POST" action="/payments/reject" style="display:inline;">
                    <input type="hidden" name="payment_id" value="${payment.id}">
                    <button type="submit">Rechazar</button>
                  </form>
                `
                : "-"
            }
          </td>
        </tr>
      `).join("");

      const html = fs.readFileSync(path.join(__dirname, "views/payments.html"), "utf8");

      res.send(
        html
          .replace("{{PLAN_OPTIONS}}", planOptions)
          .replace("{{PAYMENTS}}", rows)
      );
    });
  });
});

app.post("/payments/create", requireLogin, upload.single("proof"), (req, res) => {
  const { plan_id } = req.body;
  const user = req.session.user;

  if (!req.file) return res.send("Debes subir una imagen");

  const proofPath = "/uploads/" + req.file.filename;

  db.get("SELECT * FROM plans WHERE id = ?", [plan_id], (err, plan) => {
    if (!plan) return res.send("Plan no encontrado");

    db.run(
      "INSERT INTO payments (user_id, plan_id, amount, proof, status) VALUES (?, ?, ?, ?, ?)",
      [user.id, plan.id, plan.price, proofPath, "PENDING"],
      (err) => {
        if (err) return res.send("Error creando pago");
        res.redirect("/payments");
      }
    );
  });
});

app.post("/payments/approve", requireRole("OWNER", "CO_OWNER"), (req, res) => {
  const { payment_id } = req.body;
  const staff = req.session.user;

  db.get(
    `
    SELECT payments.*, plans.id AS plan_id
    FROM payments
    LEFT JOIN plans ON payments.plan_id = plans.id
    WHERE payments.id = ? AND payments.status = 'PENDING'
    `,
    [payment_id],
    (err, payment) => {
      if (!payment) return res.send("Pago no encontrado o ya procesado");

      db.run("UPDATE payments SET status = 'APPROVED' WHERE id = ?", [payment.id], (err) => {
        if (err) return res.send("Error aprobando pago");

        createLicenseKey(payment.plan_id, staff.id, (err, key) => {
          if (err) return res.send("Pago aprobado, pero error creando key");

          res.send(`
            <h1>Pago aprobado ✅</h1>
            <p>Key generada:</p>
            <h2>${key}</h2>
            <a href="/payments">Volver</a>
          `);
        });
      });
    }
  );
});

app.post("/payments/reject", requireRole("OWNER", "CO_OWNER"), (req, res) => {
  const { payment_id } = req.body;

  db.run(
    "UPDATE payments SET status = 'REJECTED' WHERE id = ? AND status = 'PENDING'",
    [payment_id],
    () => res.redirect("/payments")
  );
});

app.get("/plans", requireLogin, (req, res) => {
  db.all("SELECT * FROM plans ORDER BY id ASC", [], (err, plans) => {
    const rows = plans.map(plan => `
      <tr>
        <td>${plan.id}</td>
        <td><span class="badge">${plan.name}</span></td>
        <td>${plan.max_bots}</td>
        <td>${plan.max_channels}</td>
        <td>${plan.max_tasks}</td>
        <td>${plan.days}</td>
        <td>$${plan.price}</td>
      </tr>
    `).join("");

    const html = fs.readFileSync(path.join(__dirname, "views/plans.html"), "utf8");
    res.send(html.replace("{{PLANS}}", rows));
  });
});

app.get("/settings", requireLogin, (req, res) => {
  res.send("<h1>Configuración</h1>");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`Servidor iniciado en puerto ${PORT}`);

  startTelegramBot();

  
});