/**
 * Jubbio SDK shim — mirrors the Client + GatewayIntentBits API shown in Jubbio's docs.
 * Replace this file's exports with `require('<jubbio-package-name>')` once the
 * real npm package name is known. Every other file will keep working unchanged.
 */
const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');

const JUBBIO_WS_URL = process.env.JUBBIO_WS_URL || 'wss://gateway.jubbio.com/v1';
const JUBBIO_API_URL = process.env.JUBBIO_API_URL || 'https://api.jubbio.com/bot';

const GatewayIntentBits = {
  Guilds: 1 << 0,
  GuildMessages: 1 << 9,
  MessageContent: 1 << 15,
};

class Client extends EventEmitter {
  constructor({ intents = [] } = {}) {
    super();
    this.intents = intents;
    this.user = null;
    this.ws = null;
    this.heartbeatInterval = null;
    this.http = null;
  }

  async login(token) {
    this.token = token;

    this.http = axios.create({
      baseURL: JUBBIO_API_URL,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
    });

    this._connect();
  }

  _connect() {
    this.ws = new WebSocket(JUBBIO_WS_URL, {
      headers: {
        Authorization: `Bot ${this.token}`,
      },
    });

    this.ws.on('open', () => {
      this._identify();
    });

    this.ws.on('message', (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        payload = { raw: data.toString() };
      }

      this._handlePayload(payload);
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });

    this.ws.on('close', (code, reason) => {
      this._stopHeartbeat();
      this.emit('disconnect', { code, reason: reason.toString() });
      setTimeout(() => this._connect(), 5000);
    });
  }

  _identify() {
    this._send({
      op: 'IDENTIFY',
      d: {
        token: this.token,
        intents: this.intents.reduce((acc, bit) => acc | bit, 0),
        properties: { bot: true },
      },
    });
  }

  _handlePayload(payload) {
    const op = payload.op || payload.type;

    if (op === 'HELLO' && payload.heartbeat_interval) {
      this._startHeartbeat(payload.heartbeat_interval);
    }

    if (op === 'READY' || op === 'ready') {
      this.user = payload.d?.user || payload.user || { username: 'JubbioBot' };
      this.emit('ready');
      return;
    }

    if (op === 'MESSAGE_CREATE' || op === 'messageCreate') {
      this.emit('messageCreate', payload.d || payload);
      return;
    }

    if (op === 'INTERACTION_CREATE' || op === 'interactionCreate') {
      this.emit('interactionCreate', payload.d || payload);
      return;
    }

    this.emit('raw', payload);
  }

  _startHeartbeat(intervalMs) {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this._send({ op: 'HEARTBEAT' });
    }, intervalMs);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async rest(method, path, body) {
    const res = await this.http.request({
      method,
      url: path,
      data: body,
    });
    return res.data;
  }
}

module.exports = { Client, GatewayIntentBits };
