package com.ahuva.ipfinder.core;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.SocketChannel;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Non-blocking TCP connect scanner: many ports on one host share a single timeout window. */
public final class TcpProbe {
    private TcpProbe() {}

    public static final class Result {
        public final List<Integer> open = new ArrayList<>();
        /** True if the host answered at all (open port or RST), i.e. it is alive. */
        public boolean responded;
        public int firstResponseMs = -1;
    }

    public static Result probe(InetAddress addr, int[] ports, int timeoutMs) {
        return probe(addr, ports, 0, ports.length, timeoutMs, null);
    }

    /** Probes ports[from, to). Stops early if cancel is set. */
    public static Result probe(InetAddress addr, int[] ports, int from, int to, int timeoutMs, AtomicBoolean cancel) {
        Result r = new Result();
        Selector selector = null;
        List<SocketChannel> channels = new ArrayList<>();
        long start = System.nanoTime();
        try {
            selector = Selector.open();
            int pending = 0;
            for (int i = from; i < to; i++) {
                SocketChannel ch = null;
                try {
                    ch = SocketChannel.open();
                    ch.configureBlocking(false);
                    channels.add(ch);
                    boolean connected = ch.connect(new InetSocketAddress(addr, ports[i]));
                    if (connected) {
                        markOpen(r, ports[i], start);
                    } else {
                        ch.register(selector, SelectionKey.OP_CONNECT, ports[i]);
                        pending++;
                    }
                } catch (IOException e) {
                    if (isRefused(e)) markResponded(r, start);
                    closeQuietly(ch);
                }
            }
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (pending > 0) {
                if (cancel != null && cancel.get()) break;
                long wait = deadline - System.currentTimeMillis();
                if (wait <= 0) break;
                if (selector.select(Math.min(wait, 100)) == 0) continue;
                Iterator<SelectionKey> it = selector.selectedKeys().iterator();
                while (it.hasNext()) {
                    SelectionKey k = it.next();
                    it.remove();
                    SocketChannel ch = (SocketChannel) k.channel();
                    int port = (Integer) k.attachment();
                    try {
                        if (ch.finishConnect()) markOpen(r, port, start);
                    } catch (IOException e) {
                        if (isRefused(e)) markResponded(r, start);
                    }
                    k.cancel();
                    closeQuietly(ch);
                    pending--;
                }
            }
        } catch (IOException ignored) {
        } finally {
            for (SocketChannel ch : channels) closeQuietly(ch);
            if (selector != null) try { selector.close(); } catch (IOException ignored) { }
        }
        java.util.Collections.sort(r.open);
        return r;
    }

    private static void markOpen(Result r, int port, long startNs) {
        r.open.add(port);
        markResponded(r, startNs);
    }

    private static void markResponded(Result r, long startNs) {
        if (!r.responded) {
            r.responded = true;
            r.firstResponseMs = (int) ((System.nanoTime() - startNs) / 1_000_000L);
        }
    }

    static boolean isRefused(IOException e) {
        String m = String.valueOf(e.getMessage()).toLowerCase(Locale.US);
        return m.contains("refused") || m.contains("econnrefused") || m.contains("reset");
    }

    private static void closeQuietly(SocketChannel ch) {
        if (ch != null) try { ch.close(); } catch (IOException ignored) { }
    }

    /** Reads whatever a service says first (SSH, FTP, SMTP, Telnet...). Returns null if silent. */
    public static String grabBanner(String ip, int port, int timeoutMs) {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(ip, port), timeoutMs);
            s.setSoTimeout(timeoutMs);
            InputStream in = s.getInputStream();
            byte[] buf = new byte[512];
            int n = in.read(buf);
            if (n <= 0) return null;
            return cleanBanner(buf, n);
        } catch (IOException e) {
            return null;
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    /** Sends a probe then reads the reply (used for RTSP / Redis style services). */
    public static String query(String ip, int port, byte[] payload, int timeoutMs) {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(ip, port), timeoutMs);
            s.setSoTimeout(timeoutMs);
            OutputStream out = s.getOutputStream();
            out.write(payload);
            out.flush();
            byte[] buf = new byte[1024];
            int n = s.getInputStream().read(buf);
            return n > 0 ? cleanBanner(buf, n) : null;
        } catch (IOException e) {
            return null;
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    static String cleanBanner(byte[] buf, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            int c = buf[i] & 0xFF;
            if (c == '\r' || c == '\n') {
                if (sb.length() > 0) break; // first line only
                continue;
            }
            if (c >= 0x20 && c < 0x7F) sb.append((char) c);
        }
        String s = sb.toString().trim();
        if (s.length() > 120) s = s.substring(0, 120);
        return s.isEmpty() ? null : s;
    }
}
