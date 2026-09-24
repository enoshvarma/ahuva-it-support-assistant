package com.ahuva.itsupport.core;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.apache.sshd.common.NamedFactory;
import org.apache.sshd.common.cipher.BuiltinCiphers;
import org.apache.sshd.common.kex.BuiltinDHFactories;
import org.apache.sshd.common.mac.BuiltinMacs;
import org.apache.sshd.common.signature.BuiltinSignatures;
import org.apache.sshd.server.ServerBuilder;
import org.apache.sshd.server.SshServer;
import org.apache.sshd.server.channel.ChannelSession;
import org.apache.sshd.server.command.Command;
import org.apache.sshd.server.Environment;
import org.apache.sshd.server.ExitCallback;
import org.apache.sshd.server.keyprovider.SimpleGeneratorHostKeyProvider;
import org.junit.After;
import org.junit.Test;

public class DeviceConnectionTest {

    static final class Capture implements DeviceConnection.Listener {
        final StringBuffer data = new StringBuffer();
        final CountDownLatch closed = new CountDownLatch(1);
        volatile String closeReason;

        @Override public void onData(String text) { data.append(text); }
        @Override public void onClosed(String reason) { closeReason = reason; closed.countDown(); }
        @Override public void onError(String message) {}

        boolean waitFor(String needle, long ms) throws InterruptedException {
            long end = System.currentTimeMillis() + ms;
            while (System.currentTimeMillis() < end) {
                if (data.toString().contains(needle)) return true;
                Thread.sleep(20);
            }
            return false;
        }
    }

    /** Minimal switch-like shell: prints a prompt and echoes each line back with a marker. */
    static final class EchoShell implements Command, Runnable {
        private InputStream in;
        private OutputStream out;
        private ExitCallback exit;
        @Override public void setInputStream(InputStream in) { this.in = in; }
        @Override public void setOutputStream(OutputStream out) { this.out = out; }
        @Override public void setErrorStream(OutputStream err) {}
        @Override public void setExitCallback(ExitCallback callback) { this.exit = callback; }
        @Override public void start(ChannelSession channel, Environment env) {
            assertEquals("vt100", env.getEnv().get("TERM"));
            new Thread(this).start();
        }
        @Override public void destroy(ChannelSession channel) {}
        @Override public void run() {
            try {
                out.write("Switch>".getBytes(StandardCharsets.UTF_8));
                out.flush();
                ByteArrayOutputStream line = new ByteArrayOutputStream();
                int b;
                while ((b = in.read()) != -1) {
                    if (b == '\r') {
                        String cmd = line.toString("UTF-8");
                        line.reset();
                        if (cmd.equals("exit")) break;
                        out.write(("\r\nECHO:" + cmd + "\r\nSwitch>").getBytes(StandardCharsets.UTF_8));
                        out.flush();
                    } else {
                        line.write(b);
                    }
                }
            } catch (IOException ignored) {
            } finally {
                exit.onExit(0);
            }
        }
    }

    private SshServer sshd;
    private DeviceConnection conn;

    @After
    public void tearDown() throws Exception {
        if (conn != null) conn.disconnect();
        if (sshd != null) sshd.stop(true);
    }

    private SshServer startSshd(boolean legacyOnly) throws IOException {
        SshServer s = SshServer.setUpDefaultServer();
        s.setHost("127.0.0.1");
        s.setPort(0);
        SimpleGeneratorHostKeyProvider keys = new SimpleGeneratorHostKeyProvider();
        keys.setAlgorithm("RSA");
        s.setKeyPairProvider(keys);
        s.setPasswordAuthenticator((user, pass, session) -> "admin".equals(user) && "cisco123".equals(pass));
        s.setShellFactory(channel -> new EchoShell());
        if (legacyOnly) {
            // Old Catalyst-style offer: SHA1 DH, CBC cipher, SHA1 MAC, ssh-rsa host key.
            s.setKeyExchangeFactories(NamedFactory.setUpTransformedFactories(
                false, Collections.singletonList(BuiltinDHFactories.dhg14), ServerBuilder.DH2KEX));
            s.setCipherFactories(Collections.singletonList(BuiltinCiphers.aes128cbc));
            s.setMacFactories(Collections.singletonList(BuiltinMacs.hmacsha1));
            s.setSignatureFactories(Collections.singletonList(BuiltinSignatures.rsa));
        }
        s.start();
        return s;
    }

    @Test
    public void sshModernServer() throws Exception {
        sshd = startSshd(false);
        assertSshSession();
    }

    @Test
    public void sshLegacyCatalystAlgorithms() throws Exception {
        sshd = startSshd(true);
        assertSshSession();
    }

    private void assertSshSession() throws Exception {
        Capture cap = new Capture();
        conn = new DeviceConnection(cap);
        conn.connectSSH("127.0.0.1", sshd.getPort(), "admin", "cisco123");
        assertTrue(conn.isConnected());
        assertEquals("ssh", conn.getType());
        assertTrue("prompt", cap.waitFor("Switch>", 5000));
        conn.sendCommand("show version\n");
        assertTrue("echoed command with CR line ending", cap.waitFor("ECHO:show version", 5000));
        conn.disconnect();
        assertFalse(conn.isConnected());
    }

    @Test
    public void sshWrongPasswordIsAuthFailure() throws Exception {
        sshd = startSshd(false);
        conn = new DeviceConnection(new Capture());
        try {
            conn.connectSSH("127.0.0.1", sshd.getPort(), "admin", "wrong");
            fail("expected auth failure");
        } catch (Exception e) {
            assertTrue(e.getMessage(), e.getMessage().contains("Auth fail"));
        }
        assertFalse(conn.isConnected());
    }

    @Test
    public void sshRemoteCloseEmitsClosed() throws Exception {
        sshd = startSshd(false);
        Capture cap = new Capture();
        conn = new DeviceConnection(cap);
        conn.connectSSH("127.0.0.1", sshd.getPort(), "admin", "cisco123");
        conn.write("exit\r");
        assertTrue(cap.closed.await(5, TimeUnit.SECONDS));
        assertEquals("SSH shell closed", cap.closeReason);
        assertFalse(conn.isConnected());
    }

    @Test
    public void telnetNegotiationAndData() throws Exception {
        try (ServerSocket server = new ServerSocket(0)) {
            final ByteArrayOutputStream fromClient = new ByteArrayOutputStream();
            final CountDownLatch gotCommand = new CountDownLatch(1);
            Thread t = new Thread(() -> {
                try (Socket s = server.accept()) {
                    OutputStream o = s.getOutputStream();
                    // DO ECHO, WILL SGA, a subnegotiation, and an IAC split across two packets.
                    o.write(new byte[]{(byte) 255, (byte) 253, 1, (byte) 255, (byte) 251, 3});
                    o.write(new byte[]{(byte) 255, (byte) 250, 24, 1, (byte) 255, (byte) 240});
                    o.write("User Access Verification\r\n".getBytes(StandardCharsets.UTF_8));
                    o.flush();
                    Thread.sleep(50);
                    o.write(new byte[]{(byte) 255});
                    o.flush();
                    Thread.sleep(50);
                    o.write(new byte[]{(byte) 253, 31});
                    o.write("Username: ".getBytes(StandardCharsets.UTF_8));
                    o.flush();
                    InputStream in = s.getInputStream();
                    int b;
                    while ((b = in.read()) != -1) {
                        fromClient.write(b);
                        if (b == '\r') { gotCommand.countDown(); o.write("\r\nok\r\n".getBytes(StandardCharsets.UTF_8)); o.flush(); }
                    }
                } catch (Exception ignored) {}
            });
            t.start();

            Capture cap = new Capture();
            conn = new DeviceConnection(cap);
            conn.connectTelnet("127.0.0.1", server.getLocalPort());
            assertTrue(cap.waitFor("Username: ", 5000));
            assertEquals("User Access Verification\r\nUsername: ", cap.data.toString());
            conn.sendCommand("admin");
            assertTrue(gotCommand.await(5, TimeUnit.SECONDS));
            byte[] expected = {
                (byte) 255, (byte) 252, 1,   // WONT ECHO
                (byte) 255, (byte) 254, 3,   // DONT SGA
                (byte) 255, (byte) 252, 31,  // WONT NAWS (split IAC)
                'a', 'd', 'm', 'i', 'n', '\r'
            };
            assertArrayEquals(expected, fromClient.toByteArray());
            assertTrue(cap.waitFor("ok", 5000));
        }
    }

    @Test
    public void telnetRemoteCloseEmitsClosed() throws Exception {
        try (ServerSocket server = new ServerSocket(0)) {
            new Thread(() -> {
                try (Socket s = server.accept()) { s.getOutputStream().write("bye".getBytes(StandardCharsets.UTF_8)); }
                catch (IOException ignored) {}
            }).start();
            Capture cap = new Capture();
            conn = new DeviceConnection(cap);
            conn.connectTelnet("127.0.0.1", server.getLocalPort());
            assertTrue(cap.closed.await(5, TimeUnit.SECONDS));
            assertEquals("Telnet connection closed", cap.closeReason);
        }
    }

    @Test
    public void telnetRefusedPortThrows() throws Exception {
        int port;
        try (ServerSocket s = new ServerSocket(0)) { port = s.getLocalPort(); }
        conn = new DeviceConnection(new Capture());
        try {
            conn.connectTelnet("127.0.0.1", port);
            fail("expected refusal");
        } catch (IOException expected) {
            assertFalse(conn.isConnected());
        }
    }

    @Test
    public void writeWhenDisconnectedThrows() {
        conn = new DeviceConnection(new Capture());
        try {
            conn.write("x");
            fail("expected IOException");
        } catch (IOException e) {
            assertEquals("Not connected to any device.", e.getMessage());
        }
    }

    @Test
    public void utf8SplitAcrossChunks() {
        DeviceConnection.Utf8Stream d = new DeviceConnection.Utf8Stream();
        byte[] euro = "a€b".getBytes(StandardCharsets.UTF_8); // € is 3 bytes
        assertEquals("a", d.decode(new byte[]{euro[0], euro[1]}, 2));
        assertEquals("", d.decode(new byte[]{euro[2]}, 1));
        assertEquals("€b", d.decode(new byte[]{euro[3], euro[4]}, 2));
    }

    @Test
    public void telnetFilterEscapedIac() {
        DeviceConnection.TelnetFilter f = new DeviceConnection.TelnetFilter();
        DeviceConnection.TelnetFilter.Result r = f.process(new byte[]{'x', (byte) 255, (byte) 255, 'y'}, 4);
        assertArrayEquals(new byte[]{'x', (byte) 255, 'y'}, r.data);
        assertEquals(0, r.reply.length);
    }
}
