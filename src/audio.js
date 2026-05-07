const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} = require('@jubbio/voice');
const ytSearch = require('yt-search');
const ytdl = require('@distube/ytdl-core');

// Ortam değişkenlerini kodun içine gömüyoruz (Render'da ekleyemediğimiz için)
process.env.YTDL_NO_UPDATE = '1'; 

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
  if (isUrl) return { title: "YouTube Video", url: query, duration: 'unknown', thumbnail: null };

  const r = await ytSearch(query);
  const video = r.videos[0];
  if (!video) throw new Error('Şarkı bulunamadı.');
  return videoToTrack(video);
}

function waitForReady(connection, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    if (connection.state.status === VoiceConnectionStatus.Ready) return resolve();
    const timer = setTimeout(() => reject(new Error('Bağlantı zaman aşımı.')), timeoutMs);
    
    connection.once(VoiceConnectionStatus.Ready, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function joinChannel(guild, voiceChannelId, textChannelSend) {
  let session = getSession(guild.id);
  if (session) return session;

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  try {
    await waitForReady(connection);
  } catch (err) {
    connection.destroy();
    throw err;
  }

  const player = createAudioPlayer();
  connection.subscribe(player);

  session = { connection, player, queue: [], current: null, textChannelSend, guildId: guild.id };
  sessions.set(guild.id, session);

  player.on('error', err => {
    console.error('[Hata]', err.message);
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
  if (!session || !session.queue.length) {
    if (session) session.textChannelSend('Sıra bitti.').catch(() => {});
    return;
  }

  const track = session.queue.shift();
  session.current = track;

  try {
    // İşte YouTube engelini aşan asıl kısım burası:
    const stream = ytdl(track.url, {
      filter: 'audioonly',
      highWaterMark: 1 << 25,
      quality: 'highestaudio',
      dlChunkSize: 0,
    });

    const resource = createAudioResource(stream);
    session.player.play(resource);
    session.textChannelSend(`🎶 Şu an çalıyor: **${track.title}**`).catch(() => {});
  } catch (err) {
    session.textChannelSend(`Hata oluştu: ${err.message}`).catch(() => {});
    advanceQueue(guildId);
  }
}

module.exports = { resolveTrack, joinChannel, getSession, deleteSession, advanceQueue };
