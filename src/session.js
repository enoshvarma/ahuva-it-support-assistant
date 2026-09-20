// Live device session: SSH (ssh2), Serial COM (serialport), Telnet (net).
// Emits: "data" (string), "closed" (reason), "error" (message).
// One session at a time; calling connect* while connected auto-disconnects first.

const { EventEmitter } = require("events");
const log = require("./logger").child("session");
const { isValidHost, isValidPort, isValidSerialPort, isValidBaudRate, isValidUsername } = require("./validate");

class DeviceSession extends EventEmitter {
  constructor() {
    super();
    this.type = null;
    this.ssh = null;
    this.sshStream = null;
    this.serial = null;
    this.telnet = null;
    this.connected = false;
    this._connectLock = false;
  }

  async connectSSH({ host, port, username, password }) {
    if (!isValidHost(host)) throw new Error(`Invalid host: "${host}"`);
    if (!isValidPort(port || 22)) throw new Error(`Invalid port: "${port}"`);
    if (!isValidUsername(username)) throw new Error("Invalid username.");

    if (this._connectLock) throw new Error("A connection attempt is already in progress.");
    this._connectLock = true;
    try {
      await this.disconnect();
      log.info("SSH connecting", { host, port: port || 22, username });
      return await new Promise((resolve, reject) => {
        const { Client } = require("ssh2");
        const conn = new Client();
        let settled = false;

        const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

        conn.on("ready", () => {
          conn.shell({ term: "vt100", cols: 120, rows: 32 }, (err, stream) => {
            if (err) { conn.end(); return settle(reject, err); }
            this.type = "ssh";
            this.ssh = conn;
            this.sshStream = stream;
            this.connected = true;

            stream.on("data", d => this.emit("data", d.toString("utf8")));
            stream.stderr.on("data", d => this.emit("data", d.toString("utf8")));
            stream.on("close", () => {
              this.connected = false;
              log.info("SSH shell closed");
              this.emit("closed", "SSH shell closed");
            });
            settle(resolve);
          });
        });

        conn.on("error", e => {
          log.warn("SSH error", { message: e.message });
          settle(reject, e);
          if (this.connected) this.emit("error", e.message);
        });

        conn.on("close", () => {
          if (this.connected) {
            this.connected = false;
            log.info("SSH connection closed");
            this.emit("closed", "SSH connection closed");
          }
        });

        conn.connect({
          host,
          port: Number(port) || 22,
          username,
          password,
          readyTimeout: 20000,
          keepaliveInterval: 30000,
          keepaliveCountMax: 3,
          // Broad algorithm support for legacy switches (Cisco Catalyst 2960, etc.)
          algorithms: {
            kex: [
              "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
              "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1",
              "diffie-hellman-group1-sha1",
              "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1"
            ],
            cipher: [
              "aes128-ctr", "aes192-ctr", "aes256-ctr",
              "aes128-gcm@openssh.com", "aes256-gcm@openssh.com",
              "aes128-cbc", "aes256-cbc", "3des-cbc"
            ],
            serverHostKey: [
              "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384",
              "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-dss"
            ],
            hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1", "hmac-md5"]
          }
        });
      });
    } finally {
      this._connectLock = false;
    }
  }

  async connectSerial({ comPort, baudRate }) {
    if (!isValidSerialPort(comPort)) throw new Error(`Invalid serial port: "${comPort}"`);
    if (!isValidBaudRate(baudRate || 9600)) throw new Error(`Invalid baud rate: "${baudRate}"`);

    if (this._connectLock) throw new Error("A connection attempt is already in progress.");
    this._connectLock = true;
    try {
      await this.disconnect();
      log.info("Serial connecting", { comPort, baudRate });
      return await new Promise((resolve, reject) => {
        const { SerialPort } = require("serialport");
        const sp = new SerialPort(
          { path: comPort, baudRate: Number(baudRate) || 9600, dataBits: 8, stopBits: 1, parity: "none" },
          err => {
            if (err) { log.warn("Serial open error", { message: err.message }); return reject(err); }
            this.type = "serial";
            this.serial = sp;
            this.connected = true;
            sp.on("data", d => this.emit("data", d.toString("utf8")));
            sp.on("close", () => {
              this.connected = false;
              log.info("Serial port closed");
              this.emit("closed", "Serial port closed");
            });
            sp.on("error", e => {
              log.warn("Serial error", { message: e.message });
              this.emit("error", e.message);
            });
            sp.write("\r");
            resolve();
          }
        );
      });
    } finally {
      this._connectLock = false;
    }
  }

  async connectTelnet({ host, port }) {
    if (!isValidHost(host)) throw new Error(`Invalid host: "${host}"`);
    if (!isValidPort(port || 23)) throw new Error(`Invalid port: "${port}"`);

    if (this._connectLock) throw new Error("A connection attempt is already in progress.");
    this._connectLock = true;
    try {
      await this.disconnect();
      log.info("Telnet connecting", { host, port: port || 23 });
      return await new Promise((resolve, reject) => {
        const net = require("net");
        const sock = net.createConnection({ host, port: Number(port) || 23 }, () => {
          this.type = "telnet";
          this.telnet = sock;
          this.connected = true;
          resolve();
        });

        sock.setTimeout(20000, () => {
          if (!this.connected) {
            sock.destroy();
            reject(new Error("Telnet connection timed out after 20s."));
          }
        });

        // Minimal Telnet option negotiation per RFC 854:
        // Refuse all options (DO→WONT, WILL→DONT), strip IAC sequences, pass data through.
        let iac = null;
        let cmd = 0;
        sock.on("data", buf => {
          const out = [];
          for (let i = 0; i < buf.length; i++) {
            const b = buf[i];
            if (iac === null) {
              if (b === 255) iac = "cmd";
              else out.push(b);
            } else if (iac === "cmd") {
              if (b === 255) { out.push(255); iac = null; }
              else if (b === 250) { iac = "sb"; }
              else if (b >= 251 && b <= 254) { cmd = b; iac = "opt"; }
              else { iac = null; }
            } else if (iac === "opt") {
              const resp = cmd === 253 ? 252 : cmd === 251 ? 254 : null;
              if (resp) sock.write(Buffer.from([255, resp, b]));
              iac = null;
            } else if (iac === "sb") {
              if (b === 255) iac = "sb-iac";
            } else if (iac === "sb-iac") {
              iac = b === 240 ? null : "sb";
            }
          }
          if (out.length) this.emit("data", Buffer.from(out).toString("utf8"));
        });

        sock.on("close", () => {
          if (this.connected) {
            this.connected = false;
            log.info("Telnet connection closed");
            this.emit("closed", "Telnet connection closed");
          }
        });
        sock.on("error", e => {
          log.warn("Telnet error", { message: e.message });
          if (!this.connected) reject(e);
          else this.emit("error", e.message);
        });
      });
    } finally {
      this._connectLock = false;
    }
  }

  write(data) {
    if (!this.connected) throw new Error("Not connected to any device.");
    if (this.type === "ssh") this.sshStream.write(data);
    else if (this.type === "serial") this.serial.write(data);
    else if (this.type === "telnet") this.telnet.write(data);
  }

  sendCommand(cmd) {
    this.write(String(cmd).replace(/[\r\n]+$/, "") + "\r");
  }

  async disconnect() {
    if (!this.ssh && !this.serial && !this.telnet) return;
    const prevType = this.type;
    this.connected = false;
    log.info("Disconnecting", { type: prevType });

    await Promise.allSettled([
      new Promise(res => {
        try { if (this.sshStream) this.sshStream.end("exit\r"); } catch { }
        try { if (this.ssh) { this.ssh.once("close", res); this.ssh.end(); } else res(); } catch { res(); }
      }),
      new Promise(res => {
        try {
          if (this.serial && this.serial.isOpen) {
            this.serial.close(() => res());
          } else res();
        } catch { res(); }
      }),
      new Promise(res => {
        try { if (this.telnet) { this.telnet.destroy(); } } catch { }
        res();
      })
    ]);

    this.ssh = null; this.sshStream = null;
    this.serial = null; this.telnet = null;
    this.type = null;
  }
}

async function listSerialPorts() {
  try {
    const { SerialPort } = require("serialport");
    const ports = await SerialPort.list();
    return ports.map(p => ({ path: p.path, friendly: p.friendlyName || p.manufacturer || "" }));
  } catch (e) {
    log.warn("Could not list serial ports", { message: e.message });
    return [];
  }
}

module.exports = { DeviceSession, listSerialPorts };
