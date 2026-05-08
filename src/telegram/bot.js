import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

const bot = new Telegraf(process.env.MAIN_BOT_TOKEN);

const START_GIF = "https://media1.tenor.com/m/oG7Qvh2hQb4AAAAd/saitama-onepunchman.gif";
const ACCOUNT_GIF = "https://media1.tenor.com/m/H2J10vo_l5sAAAAC/saitama-vs-garou-c%C3%B3smico.gif";

function mainMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.url("𝗕𝘂𝘆", "https://t.me/Danexmx7"),
      Markup.button.callback("𝗔𝗰𝗰𝗼𝘂𝗻𝘁", "account")
    ]
  ]);
}

function backMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("𝗕𝗮𝗰𝗸", "back")
    ]
  ]);
}

function startCaption(ctx) {
  return `<b><a href="https://t.me/MagnusPanelBot">𝖬𝖺𝗀𝗇𝗎𝗌𝖯𝖺𝗇𝖾𝗅</a> | 𝖯𝖺𝗇𝖾𝗅 𝖽𝖾 𝖼𝗈𝗆𝖺𝗇𝖽𝗈𝗌</b>
━━━━━━━━━━━━━
↯ <a href="https://t.me/MagnusPanelBot">»</a> 𝖡𝗂𝖾𝗇𝗏𝖾𝗇𝗂𝖽𝗈 @${ctx.from.username || ctx.from.first_name} 𝖺𝗅 𝗉𝖺𝗇𝖾𝗅 𝗉𝗋𝖾𝗆𝗂𝗎𝗆.
↯ <a href="https://t.me/MagnusPanelBot">»</a> 𝖠𝗊𝗎𝗂 𝗉𝗈𝖽𝗋𝖺𝗌 𝗁𝖺𝖼𝖾𝗋 𝗌𝗉𝖺𝗆 𝖾𝗇 𝗍𝗎𝗌 𝖼𝖺𝗇𝖺𝗅𝖾𝗌!
━━━━━━━━━━━━━
🌓 <b>𝖧𝗈𝗋𝖺 𝖺𝖼𝗍𝗎𝖺𝗅:</b>
${new Date()
  .toLocaleString("sv-SE", {
    timeZone: "America/Guayaquil"
  })
  .replace(/0/g, "𝟢")
  .replace(/1/g, "𝟣")
  .replace(/2/g, "𝟤")
  .replace(/3/g, "𝟥")
  .replace(/4/g, "𝟦")
  .replace(/5/g, "𝟧")
  .replace(/6/g, "𝟨")
  .replace(/7/g, "𝟩")
  .replace(/8/g, "𝟪")
  .replace(/9/g, "𝟫")}`;
}

function accountCaption(ctx) {
  return `<b><a href="https://t.me/MagnusPanelBot">𝖬𝖺𝗀𝗇𝗎𝗌𝖯𝖺𝗇𝖾𝗅</a> | 𝖴𝗌𝖾𝗋 𝗉𝗋𝗈𝖿𝗂𝗅𝖾</b>
━━━━━━━━━━━━━

↯ <a href="https://t.me/MagnusPanelBot">»</a> User Info: @${ctx.from.username || "sin_username"}
↯ <a href="https://t.me/MagnusPanelBot">»</a> ID: <code>${ctx.from.id}</code>
↯ <a href="https://t.me/MagnusPanelBot">»</a> Panel: <code>http://localhost:3000</code>

━━━━━━━━━━━━━

`;
}

bot.start(async (ctx) => {
  await ctx.replyWithAnimation(START_GIF, {
    caption: startCaption(ctx),
    parse_mode: "HTML",
    ...mainMenu()
  });
});

bot.command("id", (ctx) => {
  ctx.reply(`🆔 Tu Telegram ID:\n${ctx.from.id}`);
});
bot.command("claim", (ctx) => {
  const key = ctx.message.text.split(" ")[1];

  if (!key) {
    return ctx.reply("❌ Uso correcto:\n/claim TU_KEY");
  }

  ctx.reply(`✅ Key recibida:\n${key}`);
});

bot.hears(/^\.claim\s+(.+)/i, (ctx) => {
  const key = ctx.match[1];

  ctx.reply(`✅ Key recibida:\n${key}`);
});

bot.action("account", async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.editMessageMedia(
    {
      type: "animation",
      media: ACCOUNT_GIF,
      caption: accountCaption(ctx),
      parse_mode: "HTML"
    },
    {
      reply_markup: backMenu().reply_markup
    }
  );
});

bot.action("back", async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.editMessageMedia(
    {
      type: "animation",
      media: START_GIF,
      caption: startCaption(ctx),
      parse_mode: "HTML"
    },
    {
      reply_markup: mainMenu().reply_markup
    }
  );
});

export function startTelegramBot() {
  bot.launch()
    .then(() => {
      console.log("Bot principal Telegram iniciado");
    })
    .catch((err) => {
      console.log("No se pudo iniciar Telegram Bot:", err.message);
    });
}