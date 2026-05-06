const { AudioPlayerStatus } = require('@jubbio/voice');
const { resolveTrack, joinChannel, getSession, deleteSession, advanceQueue } = require('./audio');

const PREFIX = process.env.BOT_PREFIX || '!';

async function handleMessage(client, msg) {
  const content = msg.content || '';
  if (!content.startsWith(PREFIX)) return;

  const [rawCommand, ...argParts] = content.slice(PREFIX.length).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const args = argParts.join(' ');
  const { channelId, guildId } = msg;

  const send = (text) => client.rest.createMessage(guildId, channelId, { content: text }).catch(() => {});

  console.log(`[Command] ${command} | guild=${guildId} channel=${channelId} | args="${args}"`);

  switch (command) {

    case 'play': {
      if (!args) return send(`Usage: ${PREFIX}play <YouTube URL or search query>`);

      // Resolve the guild and the author's voice channel
      const guild = client.guilds.get(guildId);
      if (!guild) return send('Could not find this server in cache. Try again in a moment.');

      let member;
      try {
        member = await guild.fetchMember(msg.author.id);
      } catch {
        return send('Could not fetch your member info. Please try again.');
      }

      const voiceChannelId = member.voice?.channelId;
      if (!voiceChannelId) return send('You must be in a voice channel to play music.');

      let track;
      try {
        track = await resolveTrack(args);
      } catch (err) {
        return send(`Could not find track: ${err.message}`);
      }

      track.requestedBy = msg.author?.username || 'unknown';

      let session;
      try {
        session = await joinChannel(guild, voiceChannelId, send);
      } catch (err) {
        return send(`Could not join voice channel: ${err.message}`);
      }

      session.queue.push(track);

      const isIdle = session.player.state.status === AudioPlayerStatus.Idle;
      if (isIdle) {
        await advanceQueue(guildId);
      } else {
        await send(`Added to queue: **${track.title}** (${track.duration}) — position #${session.queue.length}`);
      }
      break;
    }

    case 'skip': {
      const session = getSession(guildId);
      if (!session || session.player.state.status === AudioPlayerStatus.Idle) {
        return send('Nothing is playing right now.');
      }
      session.player.stop();
      await send('Skipped.');
      break;
    }

    case 'stop': {
      const session = getSession(guildId);
      if (!session) return send('Nothing is playing right now.');
      session.queue = [];
      deleteSession(guildId);
      await send('Stopped playback and left the voice channel.');
      break;
    }

    case 'pause': {
      const session = getSession(guildId);
      if (!session || session.player.state.status !== AudioPlayerStatus.Playing) {
        return send('Nothing is playing right now.');
      }
      session.player.pause();
      await send('Paused.');
      break;
    }

    case 'resume': {
      const session = getSession(guildId);
      if (!session || session.player.state.status !== AudioPlayerStatus.Paused) {
        return send('Nothing is paused right now.');
      }
      session.player.unpause();
      await send('Resumed.');
      break;
    }

    case 'queue': {
      const session = getSession(guildId);
      if (!session || (!session.current && !session.queue.length)) {
        return send('The queue is empty.');
      }
      const lines = [];
      if (session.current) {
        lines.push(`▶ **${session.current.title}** (${session.current.duration}) — now playing`);
      }
      session.queue.forEach((t, i) => {
        lines.push(`${i + 1}. **${t.title}** (${t.duration})${t.requestedBy ? ` — ${t.requestedBy}` : ''}`);
      });
      await send(lines.join('\n'));
      break;
    }

    case 'nowplaying': {
      const session = getSession(guildId);
      if (!session?.current) return send('Nothing is playing right now.');
      const t = session.current;
      await send(`Now playing: **${t.title}** (${t.duration})${t.requestedBy ? ` — requested by ${t.requestedBy}` : ''}`);
      break;
    }

    default:
      break;
  }
}

module.exports = { handleMessage };
