package com.ahuva.itsupport.core;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** SSH / Telnet transport mirroring src/session.js. No Android dependencies so it runs in JVM tests. */
public class DeviceConnection {

    public interface Listener {
        void onData(String text);
        void onClosed(String reason);
        void onError(String message);
    }

    // Same algorithm lists as the desktop app so legacy switches (Catalyst 2960 etc.) negotiate.
    static final String KEX = "ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,"
        + "diffie-hellman-group14-sha256,diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,"
        + "diffie-hellman-group-exchange-sha256,diffie-hellman-group-exchange-sha1";
    static final String CIPHERS = "aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com,"
        + "aes128-cbc,aes256-cbc,3des-cbc";
    static final String HOST_KEYS = "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,rsa-sha2-512,rsa-sha2-256,ssh-rsa,ssh-dss";
    static final String MACS = "hmac-sha2-256,hmac-sha2-512,hmac-sha1,hmac-md5";

    private final Listener listener;
    private volatile String type;
    private volatile boolean connected;
    private Session ssh;
    private ChannelShell shell;
    private Socket telnet;
    private OutputStream out;
    private Thread reader;

    public DeviceConnection(Listener listener) {
        this.listener = listener;
    }

    public boolean isConnected() { return connected; }
    public String getType() { return type; }

    public synchronized void connectSSH(String host, int port, String username, String password) throws Exception {
        disconnect();
        JSch jsch = new JSch();
        Session s = jsch.getSession(username, host, port);
        s.setPassword(password == null ? "" : password);
        java.util.Properties cfg = new java.util.Properties();
        cfg.put("StrictHostKeyChecking", "no");
        cfg.put("PreferredAuthentications", "password,keyboard-interactive");
        cfg.put("kex", KEX);
        cfg.put("server_host_key", HOST_KEYS);
        cfg.put("cipher.s2c", CIPHERS);
        cfg.put("cipher.c2s", CIPHERS);
        cfg.put("mac.s2c", MACS);
        cfg.put("mac.c2s", MACS);
        s.setConfig(cfg);
        s.setUserInfo(new PasswordUserInfo(password));
        s.setServerAliveInterval(30000);
        s.setServerAliveCountMax(3);
        s.connect(20000);

        ChannelShell ch = (ChannelShell) s.openChannel("shell");
        ch.setPtyType("vt100", 120, 32, 0, 0);
        InputStream in = ch.getInputStream();
        OutputStream o = ch.getOutputStream();
        try {
            ch.connect(15000);
        } catch (Exception e) {
            s.disconnect();
            throw e;
        }
        ssh = s;
        shell = ch;
        out = o;
        type = "ssh";
        connected = true;
        startReader(in, false, "SSH shell closed");
    }

    public synchronized void connectTelnet(String host, int port) throws Exception {
        disconnect();
        Socket sock = new Socket();
        try {
            sock.connect(new InetSocketAddress(host, port), 20000);
        } catch (java.net.SocketTimeoutException e) {
            try { sock.close(); } catch (IOException ignored) {}
            throw new IOException("Telnet connection timed out after 20s.");
        }
        sock.setKeepAlive(true);
        sock.setTcpNoDelay(true);
        telnet = sock;
        out = sock.getOutputStream();
        type = "telnet";
        connected = true;
        startReader(sock.getInputStream(), true, "Telnet connection closed");
    }

    private void startReader(final InputStream in, final boolean isTelnet, final String closeReason) {
        final Utf8Stream decoder = new Utf8Stream();
        final TelnetFilter filter = isTelnet ? new TelnetFilter() : null;
        final OutputStream replyTo = out;
        reader = new Thread(() -> {
            byte[] buf = new byte[8192];
            try {
                int n;
                while ((n = in.read(buf)) != -1) {
                    byte[] payload = buf;
                    int len = n;
                    if (filter != null) {
                        TelnetFilter.Result r = filter.process(buf, n);
                        if (r.reply.length > 0) {
                            synchronized (DeviceConnection.this) {
                                replyTo.write(r.reply);
                                replyTo.flush();
                            }
                        }
                        payload = r.data;
                        len = r.data.length;
                    }
                    if (len > 0) {
                        String text = decoder.decode(payload, len);
                        if (!text.isEmpty()) listener.onData(text);
                    }
                }
            } catch (IOException e) {
                if (connected) listener.onError(e.getMessage() == null ? e.toString() : e.getMessage());
            }
            if (connected) {
                connected = false;
                listener.onClosed(closeReason);
            }
        }, "ahuva-session-reader");
        reader.setDaemon(true);
        reader.start();
    }

    public synchronized void write(String data) throws IOException {
        if (!connected || out == null) throw new IOException("Not connected to any device.");
        out.write(data.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    public void sendCommand(String cmd) throws IOException {
        write(cmd.replaceAll("[\\r\\n]+$", "") + "\r");
    }

    public synchronized void disconnect() {
        if (ssh == null && telnet == null) return;
        connected = false;
        try { if (shell != null && out != null) { out.write("exit\r".getBytes(StandardCharsets.UTF_8)); out.flush(); } } catch (Exception ignored) {}
        try { if (shell != null) shell.disconnect(); } catch (Exception ignored) {}
        try { if (ssh != null) ssh.disconnect(); } catch (Exception ignored) {}
        try { if (telnet != null) telnet.close(); } catch (Exception ignored) {}
        ssh = null; shell = null; telnet = null; out = null; type = null;
        reader = null;
    }

    /** Answers keyboard-interactive password prompts some switches use instead of plain password auth. */
    static final class PasswordUserInfo implements com.jcraft.jsch.UserInfo, com.jcraft.jsch.UIKeyboardInteractive {
        private final String password;
        PasswordUserInfo(String password) { this.password = password == null ? "" : password; }
        @Override public String getPassphrase() { return null; }
        @Override public String getPassword() { return password; }
        @Override public boolean promptPassword(String message) { return true; }
        @Override public boolean promptPassphrase(String message) { return false; }
        @Override public boolean promptYesNo(String message) { return true; }
        @Override public void showMessage(String message) {}
        @Override public String[] promptKeyboardInteractive(String destination, String name, String instruction, String[] prompt, boolean[] echo) {
            String[] answers = new String[prompt.length];
            for (int i = 0; i < prompt.length; i++) answers[i] = password;
            return answers;
        }
    }

    /** Decodes UTF-8 across chunk boundaries so multi-byte characters are never split. */
    public static final class Utf8Stream {
        private final CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE);
        private ByteBuffer pending = ByteBuffer.allocate(0);

        public String decode(byte[] data, int len) {
            ByteBuffer in = ByteBuffer.allocate(pending.remaining() + len);
            in.put(pending).put(data, 0, len).flip();
            CharBuffer chars = CharBuffer.allocate(in.remaining() + 4);
            decoder.decode(in, chars, false);
            pending = in.slice();
            chars.flip();
            return chars.toString();
        }
    }

    /** RFC 854 negotiation identical to the desktop: refuse every option, drop subnegotiation. State survives chunk boundaries. */
    public static final class TelnetFilter {
        private static final int NONE = 0, CMD = 1, OPT = 2, SB = 3, SB_IAC = 4;
        private int state = NONE;
        private int cmd = 0;

        public static final class Result {
            public final byte[] data;
            public final byte[] reply;
            Result(byte[] data, byte[] reply) { this.data = data; this.reply = reply; }
        }

        public Result process(byte[] buf, int len) {
            ByteArrayOutputStream data = new ByteArrayOutputStream(len);
            ByteArrayOutputStream reply = new ByteArrayOutputStream();
            for (int i = 0; i < len; i++) {
                int b = buf[i] & 0xFF;
                switch (state) {
                    case NONE:
                        if (b == 255) state = CMD; else data.write(b);
                        break;
                    case CMD:
                        if (b == 255) { data.write(255); state = NONE; }
                        else if (b == 250) state = SB;
                        else if (b >= 251 && b <= 254) { cmd = b; state = OPT; }
                        else state = NONE;
                        break;
                    case OPT:
                        int resp = cmd == 253 ? 252 : cmd == 251 ? 254 : -1;
                        if (resp != -1) { reply.write(255); reply.write(resp); reply.write(b); }
                        state = NONE;
                        break;
                    case SB:
                        if (b == 255) state = SB_IAC;
                        break;
                    case SB_IAC:
                        state = b == 240 ? NONE : SB;
                        break;
                    default:
                        state = NONE;
                }
            }
            return new Result(data.toByteArray(), reply.toByteArray());
        }
    }
}
