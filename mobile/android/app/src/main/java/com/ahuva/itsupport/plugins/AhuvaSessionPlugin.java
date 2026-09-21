package com.ahuva.itsupport.plugins;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.jcraft.jsch.*;
import java.io.*;
import java.net.Socket;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AhuvaSession")
public class AhuvaSessionPlugin extends Plugin {
    private static final String TAG = "AhuvaSession";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private String sessionType = null; // "ssh", "telnet", "serial"
    private Session sshSession = null;
    private ChannelShell sshChannel = null;
    private InputStream sshIn = null;
    private OutputStream sshOut = null;
    private Socket telnetSocket = null;
    private InputStream telnetIn = null;
    private OutputStream telnetOut = null;
    private volatile boolean connected = false;
    private Thread readerThread = null;

    @PluginMethod
    public void connect(PluginCall call) {
        String type = call.getString("type", "ssh");
        String host = call.getString("host", "");
        int port    = call.getInt("port", type.equals("telnet") ? 23 : 22);
        String user = call.getString("username", "");
        String pass = call.getString("password", "");

        executor.execute(() -> {
            try {
                disconnect_internal();

                if ("ssh".equals(type)) {
                    connectSSH(host, port, user, pass);
                } else if ("telnet".equals(type)) {
                    connectTelnet(host, port);
                } else {
                    call.reject("Connection type '" + type + "' is not supported on Android");
                    return;
                }
                sessionType = type;
                connected = true;
                startReader();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("type", type);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Connect failed", e);
                call.reject("Connection failed: " + e.getMessage());
                emitError(e.getMessage());
            }
        });
    }

    private void connectSSH(String host, int port, String user, String pass) throws Exception {
        JSch jsch = new JSch();
        sshSession = jsch.getSession(user, host, port);
        sshSession.setPassword(pass);

        Properties config = new Properties();
        config.put("StrictHostKeyChecking", "no");
        // Support legacy algorithms for older network devices
        config.put("kex", "diffie-hellman-group14-sha256,diffie-hellman-group14-sha1,diffie-hellman-group-exchange-sha256,diffie-hellman-group-exchange-sha1,diffie-hellman-group1-sha1,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521");
        config.put("server_host_key", "ssh-rsa,ssh-dss,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,rsa-sha2-256,rsa-sha2-512");
        config.put("cipher.s2c", "aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,3des-cbc,aes256-cbc");
        config.put("cipher.c2s", "aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,3des-cbc,aes256-cbc");
        sshSession.setConfig(config);
        sshSession.setTimeout(30000);
        sshSession.connect(30000);

        sshChannel = (ChannelShell) sshSession.openChannel("shell");
        sshChannel.setPtyType("xterm", 120, 40, 0, 0);
        sshIn = sshChannel.getInputStream();
        sshOut = sshChannel.getOutputStream();
        sshChannel.connect(10000);
    }

    private void connectTelnet(String host, int port) throws Exception {
        telnetSocket = new Socket(host, port);
        telnetSocket.setSoTimeout(0); // non-blocking reads handled by reader thread
        telnetSocket.setKeepAlive(true);
        telnetIn = telnetSocket.getInputStream();
        telnetOut = telnetSocket.getOutputStream();
    }

    private void startReader() {
        readerThread = new Thread(() -> {
            byte[] buf = new byte[4096];
            InputStream in = "ssh".equals(sessionType) ? sshIn : telnetIn;
            try {
                int n;
                while (connected && in != null && (n = in.read(buf)) != -1) {
                    String data = new String(buf, 0, n, "UTF-8");
                    // Handle Telnet IAC negotiation (RFC 854)
                    if ("telnet".equals(sessionType)) {
                        data = stripTelnetIAC(buf, n);
                    }
                    if (!data.isEmpty()) {
                        JSObject ev = new JSObject();
                        ev.put("data", data);
                        notifyListeners("sessionData", ev);
                    }
                }
            } catch (IOException e) {
                if (connected) {
                    Log.w(TAG, "Reader error", e);
                }
            }
            if (connected) {
                connected = false;
                JSObject ev = new JSObject();
                ev.put("reason", "Connection closed by remote host");
                notifyListeners("sessionClosed", ev);
            }
        });
        readerThread.setDaemon(true);
        readerThread.start();
    }

    private String stripTelnetIAC(byte[] buf, int len) {
        StringBuilder sb = new StringBuilder();
        int i = 0;
        while (i < len) {
            int b = buf[i] & 0xFF;
            if (b == 0xFF && i + 1 < len) {
                int cmd = buf[i + 1] & 0xFF;
                if (cmd >= 0xFB && cmd <= 0xFE && i + 2 < len) {
                    // WILL/WONT/DO/DONT + option: skip 3 bytes, send refusal
                    try {
                        byte[] refusal = new byte[3];
                        refusal[0] = (byte) 0xFF;
                        refusal[1] = (cmd == 0xFB || cmd == 0xFD) ? (byte) 0xFE : (byte) 0xFC; // DONT or WONT
                        refusal[2] = buf[i + 2];
                        if (telnetOut != null) telnetOut.write(refusal);
                    } catch (IOException ignored) {}
                    i += 3;
                } else if (cmd == 0xFF) {
                    sb.append((char) 0xFF);
                    i += 2;
                } else {
                    i += 2;
                }
            } else {
                if (b != 0) sb.append((char) b);
                i++;
            }
        }
        return sb.toString();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        executor.execute(() -> {
            disconnect_internal();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        });
    }

    private void disconnect_internal() {
        connected = false;
        try { if (sshChannel != null) sshChannel.disconnect(); } catch (Exception ignored) {}
        try { if (sshSession != null) sshSession.disconnect(); } catch (Exception ignored) {}
        try { if (telnetSocket != null) telnetSocket.close(); } catch (Exception ignored) {}
        sshChannel = null; sshSession = null; sshIn = null; sshOut = null;
        telnetSocket = null; telnetIn = null; telnetOut = null;
        sessionType = null;
        if (readerThread != null) { readerThread.interrupt(); readerThread = null; }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data", "");
        executor.execute(() -> {
            try {
                OutputStream out = "ssh".equals(sessionType) ? sshOut : telnetOut;
                if (out != null) {
                    out.write(data.getBytes("UTF-8"));
                    out.flush();
                }
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject("Write failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sendCommand(PluginCall call) {
        String cmd = call.getString("command", "");
        executor.execute(() -> {
            try {
                OutputStream out = "ssh".equals(sessionType) ? sshOut : telnetOut;
                if (out != null) {
                    out.write((cmd + "\n").getBytes("UTF-8"));
                    out.flush();
                }
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject("Command send failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void listSerialPorts(PluginCall call) {
        // USB serial ports require usb-serial-for-android library
        // For now return empty list; USB OTG support added in future update
        JSObject ret = new JSObject();
        ret.put("ports", new org.json.JSONArray());
        call.resolve(ret);
    }

    private void emitError(String message) {
        JSObject ev = new JSObject();
        ev.put("message", message);
        notifyListeners("sessionError", ev);
    }
}
