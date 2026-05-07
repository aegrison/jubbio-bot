const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} = require('@jubbio/voice');
const ytSearch = require('yt-search');
const ytdl = require('@distube/ytdl-core');

// guildId → { connection, player, queue, current, textChannelSend }
const sessions = new Map();

function getSession(guildId) {
  return sessions.get(guildId) || null;
}

function deleteSession(guildId) {
  const s = sessions.get(guildId);
  if (s) {
    try { s.player.stop(true); } catch {}
    try { s.connection.destroy(); } catch {}
    sessions.delete(guildId);
  }
}

function videoToTrack(v) {
  return {
    title: v.title,
    url: v.url,
    duration: v.timestamp || 'unknown',
    thumbnail: v.thumbnail || null,
  };
}

async function resolveTrack(query) {
  const isUrl = /^https?:\/\//i.test(query);

  if (isUrl) {
    return { title: query, url: query, duration: 'unknown', thumbnail: null };
  }

  const [topicResults, officialResults, rawResults] = await Promise.all([
    ytSearch(`${query} - Topic`).then(r => r.videos || []),
    ytSearch(`${query} official audio`).then(r => r.videos || []),
    ytSearch(query).then(r => r.videos || []),
  ]);

  const topicVideo = topicResults.find(v => v.author?.name?.endsWith('- Topic'));
  if (topicVideo) return videoToTrack(topicVideo);

  const officialVideo = officialResults.find(v => {
    const t = v.title.toLowerCase();
    return t.includes('official') || t.includes('lyrics') || t.includes('audio');
  }) || officialResults[0];
  if (officialVideo) return videoToTrack(officialVideo);

  const fallback = rawResults[0];
  if (!fallback) throw new Error('No results found for that query.');
  return videoToTrack(fallback);
}

function waitForReady(connection, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    if (connection.state.status === VoiceConnectionStatus.Ready) return resolve();

    const timer = setTimeout(() => {
      connection.off('stateChange', onStateChange);
      reject(new Error('Voice connection timed out.'));
    }, timeoutMs);

    function onStateChange(oldState, newState) {
      if (newState.status === VoiceConnectionStatus.Ready) {
        clearTimeout(timer);
        connection.off('stateChange', onStateChange);
        resolve();
      } else if (newState.status === VoiceConnectionStatus.Disconnected) {
          connection.rejoin(); // Otomatik tekrar bağlanma denemesi
      }
    }
    connection.on('stateChange', onStateChange);
  });
}

async function joinChannel(guild, voiceChannelId, textChannelSend) {
  let session = getSession(guild.id);
  if (session) {
    session.textChannelSend = textChannelSend;
    return session;
  }

  const adapterCreator = guild.voiceAdapterCreator;
  if (!adapterCreator) throw new Error('Voice adapter not ready.');

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId: guild.id,
    adapterCreator,
  });

  try {
    await waitForReady(connection);
  } catch (err) {
    connection.destroy();
    throw new Error(`Could not connect: ${err.message}`);
  }

  const player = createAudioPlayer();
  connection.subscribe(player);

  session = { connection, player, queue: [], current: null, textChannelSend, guildId: guild.id };
  sessions.set(guild.id, session);

  connection.on('stateChange', (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      setTimeout(() => {
          if(connection.state.status === VoiceConnectionStatus.Disconnected) deleteSession(guild.id);
      }, 5000);
    }
  });

  player.on('error', (err) => {
    console.error('[Player Error]', err.message);
    advanceQueue(guild.id);
  });

  player.on('stateChange', (oldState, newState) => {
    if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
      advanceQueue(guild.id);
    }
  });

  return session;
}

async function advanceQueue(guildId) {
  const session = getSession(guildId);
  if (!session) return;

  if (!session.queue.length) {
    session.current = null;
    session.textChannelSend('Sıra bitti.').catch(() => {});
    return;
  }

  const track = session.queue.shift();
  session.current = track;

  try {
    // YouTube'dan sesi çekiyoruz
    const stream = ytdl(track.url, {
      filter: 'audioonly',
      highWaterMark: 1 << 25,
      quality: 'highestaudio',
    });

    const resource = createAudioResource(stream);
    session.player.play(resource);

    session.textChannelSend(`Şu an çalıyor: **${track.title}**`).catch(() => {});
  } catch (err) {
    console.error(`[Audio Error]`, err.message);
    session.textChannelSend(`Hata: ${track.title} çalınamadı.`).catch(() => {});
    advanceQueue(guildId);
  }
}

module.exports = { resolveTrack, joinChannel, getSession, deleteSession, advanceQueue };
