// ===== Keep-Alive Web Server =====
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Music Bot is alive!');
}).listen(PORT, () => {
  console.log(`✅ Keep-alive server on port ${PORT}`);
});
// ===== Keep-Alive ပြီး =====

require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const lavalink = new LavalinkManager({
  nodes: [{
    host: process.env.LAVALINK_HOST,
    port: parseInt(process.env.LAVALINK_PORT),
    authorization: process.env.LAVALINK_PASSWORD,
    id: 'main-node',
  }],
  sendToShard: (guildId, payload) =>
    client.guilds.cache.get(guildId)?.shard?.send(payload),
  client: { id: process.env.CLIENT_ID, username: 'MusicBot' },
});

const deleteTimers = new Map();

client.on('ready', async () => {
  console.log(`✅ ${client.user.tag} online`);
  lavalink.init({ id: client.user.id, username: client.user.username });

  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song (auto delete after 30s)')
      .addStringOption(o =>
        o.setName('query').setDescription('Song name or URL').setRequired(true)
      ),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Commands registered');
});

client.on('raw', (d) => lavalink.sendRawData(d));

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName === 'play') {
    const vc = i.member.voice.channel;
    if (!vc) return i.reply({ content: '❌ Join VC first', ephemeral: true });
    await i.deferReply();
    const query = i.options.getString('query');
    let player = lavalink.getPlayer(i.guild.id);
    if (!player) {
      player = lavalink.createPlayer({
        guildId: i.guild.id,
        voiceChannelId: vc.id,
        textChannelId: i.channel.id,
        selfDeaf: true,
      });
      await player.connect();
    }
    const res = await player.search({ query }, i.user);
    if (!res.tracks.length) return i.editReply('❌ Not found');
    const track = res.tracks[0];
    player.queue.add(track);
    if (!player.playing && !player.paused) await player.play();
    await i.editReply(`▶️ Playing: **${track.info.title}**\n⏱️ Auto delete after 30s`);
    startDeleteTimer(i.guild.id, player, i.channel);
  }
});

function startDeleteTimer(guildId, player, textChannel) {
  if (deleteTimers.has(guildId)) clearTimeout(deleteTimers.get(guildId));
  const timer = setTimeout(async () => {
    try {
      const current = player.queue.current;
      if (!current) return;
      await player.skip();
      player.queue.clear();
      await textChannel.send(`🗑️ **${current.info.title}** deleted after 30s`);
      setTimeout(() => player.destroy(), 2000);
    } catch (err) { console.error(err); }
    finally { deleteTimers.delete(guildId); }
  }, 30000);
  deleteTimers.set(guildId, timer);
}

lavalink.on('trackStart', (player) => {
  const tc = client.channels.cache.get(player.textChannelId);
  if (tc) startDeleteTimer(player.guildId, player, tc);
});

client.login(process.env.DISCORD_TOKEN);
