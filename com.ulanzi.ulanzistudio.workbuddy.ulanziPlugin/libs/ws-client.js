"use strict";

/**
 * Minimal RFC 6455 WebSocket client for Node.js (zero dependencies).
 *
 * Scope: plaintext ws:// connections to a local Ulanzi Studio host.
 * Supports: handshake, masked text frames, fragmented messages,
 * ping/pong and close handling. Enough for the plugin protocol,
 * not a general-purpose WebSocket implementation.
 */

const http = require("http");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

class WebSocketClient extends EventEmitter {
  constructor(url) {
    super();
    const parsed = new URL(url);
    this.host = parsed.hostname || "127.0.0.1";
    this.port = Number(parsed.port || 80);
    this.path = (parsed.pathname || "/") + (parsed.search || "");
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.connected = false;
    this.closedByUs = false;
  }

  connect() {
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      host: this.host,
      port: this.port,
      path: this.path,
      headers: {
        Host: `${this.host}:${this.port}`,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      },
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error("WebSocket handshake timeout"));
    });

    req.on("upgrade", (res, socket, head) => {
      const expected = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      if (res.headers["sec-websocket-accept"] !== expected) {
        socket.destroy();
        this.emit("error", new Error("Invalid Sec-WebSocket-Accept header"));
        return;
      }
      this.socket = socket;
      this.connected = true;
      // Clear the handshake timeout registered on `req`. After the upgrade the
      // underlying socket belongs to this WebSocket; if the 5s timer survived it
      // would destroy the live connection at +5s. (Observed: live WS killed 5s
      // after a successful handshake.)
      req.setTimeout(0);
      socket.setNoDelay(true);
      socket.on("data", (chunk) => this._onData(chunk));
      socket.on("close", () => this._onClose());
      socket.on("error", (err) => this.emit("error", err));
      this.emit("open");
      // Frames may arrive in the same TCP segment as the 101 response;
      // Node http surfaces those bytes as `head`, so parse them too.
      if (head && head.length) {
        this._onData(head);
      }
    });

    req.on("error", (err) => this.emit("error", err));
    req.end();
    return this;
  }

  _onClose() {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected || !this.closedByUs) {
      this.emit("close", this.closedByUs ? 1000 : 1006);
    }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  _readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        this.close(1009, "Frame too large");
        return null;
      }
      len = Number(big);
      offset = 10;
    }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + len) return null;
    let payload = buf.subarray(offset, offset + len);
    if (maskKey) {
      const unmasked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) {
        unmasked[i] = payload[i] ^ maskKey[i & 3];
      }
      payload = unmasked;
    }
    this.buffer = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;
    switch (opcode) {
      case OP_TEXT:
      case OP_CONT: {
        const base = opcode === OP_TEXT ? opcode : this.fragmentOpcode;
        this.fragments.push(payload);
        this.fragmentOpcode = base;
        if (fin) {
          const message = Buffer.concat(this.fragments).toString("utf8");
          this.fragments = [];
          this.fragmentOpcode = 0;
          this.emit("message", message);
        }
        break;
      }
      case OP_PING:
        this._sendFrame(OP_PONG, payload);
        break;
      case OP_PONG:
        break;
      case OP_CLOSE:
        this.close(1000);
        break;
      default:
        break;
    }
  }

  _sendFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) {
      masked[i] = payload[i] ^ maskKey[i & 3];
    }
    try {
      this.socket.write(Buffer.concat([header, maskKey, masked]));
      return true;
    } catch (err) {
      this.emit("error", err);
      return false;
    }
  }

  send(text) {
    if (!this.connected) return false;
    return this._sendFrame(OP_TEXT, Buffer.from(String(text), "utf8"));
  }

  sendJson(obj) {
    return this.send(JSON.stringify(obj));
  }

  close(code = 1000, reason = "") {
    if (!this.socket || this.socket.destroyed) return;
    this.closedByUs = true;
    const reasonBuf = Buffer.from(reason, "utf8");
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this._sendFrame(OP_CLOSE, payload);
    setTimeout(() => {
      if (this.socket && !this.socket.destroyed) this.socket.destroy();
    }, 500).unref();
  }
}

module.exports = { WebSocketClient };
