require('dotenv').config();

const { Client, GatewayIntentBits } = require('@jubbio/core');
const { handleMessage } = require('./commands');

// ── Global crash guards ────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught exception — keeping process alive:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled promise rejection — keeping process alive:', reason);
});
// ──────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.on('ready', () => {
  console.log(`[Jubbio] Logged in as ${client.user.username}`);
  console.log(`[Jubbio] Bot is online and listening for commands (prefix: ${process.env.BOT_PREFIX || '!'})`);
});

client.on('messageCreate', async (msg) => {
  console.log(`[Jubbio] messageCreate — channel=${msg.channelId} author=${msg.author?.username} content="${msg.content}"`);
  handleMessage(client, msg).catch((err) => {
    console.error('[Jubbio] Error in handleMessage:', err.message);
  });
});

client.on('error', (err) => {
  console.error('[Jubbio] Client error (non-fatal):', err.message);
});

client.on('disconnect', ({ code, reason }) => {
  console.warn(`[Jubbio] Disconnected (code=${code}): ${reason} — reconnecting automatically…`);
});

client.login(process.env.JUBBIO_TOKEN);
