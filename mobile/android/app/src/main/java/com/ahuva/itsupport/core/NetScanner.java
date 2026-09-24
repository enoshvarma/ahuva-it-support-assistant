package com.ahuva.itsupport.core;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Host discovery / port probing mirroring src/network-scanner.js. No Android dependencies. */
public class NetScanner {

    public static final class HostResult {
        public final String ip;
        public String status = "offline";
        public String mac = "";
        public String hostname = "";
        public final List<Integer> openPorts = new ArrayList<>();
        public final List<String> notes = new ArrayList<>();
        HostResult(String ip) { this.ip = ip; }
    }

    public interface Progress {
        void onHost(HostResult result, int done, int total);
    }

    public static final class Options {
        public int concurrency = 32;
        public int pingTimeoutMs = 1000;
        public int portTimeoutMs = 600;
        public boolean portFallback = false;
        public int[] ports = {22, 23, 80, 443, 3389, 5900, 445};
    }

    private static final int MAX_HOSTS = 65536;

    /** Parse "192.168.1.0/24", "192.168.1.1-192.168.1.100", "192.168.1.1-50" or a single host. */
    public static List<String> parseRange(String target) {
        String t = target == null ? "" : target.trim();
        List<String> ips = new ArrayList<>();
        if (t.isEmpty()) throw new IllegalArgumentException("Enter an IP, range or CIDR to scan.");
        if (t.contains("/")) {
            String[] parts = t.split("/");
            int prefix;
            try { prefix = Integer.parseInt(parts[1].trim()); } catch (Exception e) { throw new IllegalArgumentException("Invalid CIDR prefix length"); }
            if (prefix < 0 || prefix > 32) throw new IllegalArgumentException("Invalid CIDR prefix length");
            long base = ipToLong(parts[0].trim());
            long mask = prefix == 0 ? 0 : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
            long network = base & mask;
            long count = 1L << (32 - prefix);
            if (count - 2 > MAX_HOSTS) throw new IllegalArgumentException("Range too large (max /16).");
            for (long i = 1; i < count - 1; i++) ips.add(longToIp(network + i));
            if (count <= 2) ips.add(longToIp(base));
            return ips;
        }
        if (t.contains("-")) {
            int dash = t.indexOf('-');
            String startStr = t.substring(0, dash).trim();
            String endStr = t.substring(dash + 1).trim();
            long s = ipToLong(startStr);
            long e = endStr.contains(".") ? ipToLong(endStr) : (s & 0xFFFFFF00L) | parseOctet(endStr);
            if (s > e) throw new IllegalArgumentException("Start IP must be ≤ end IP");
            if (e - s + 1 > MAX_HOSTS) throw new IllegalArgumentException("Range too large (max 65536 hosts).");
            for (long i = s; i <= e; i++) ips.add(longToIp(i));
            return ips;
        }
        ips.add(t);
        return ips;
    }

    private static int parseOctet(String s) {
        int v;
        try { v = Integer.parseInt(s); } catch (Exception e) { throw new IllegalArgumentException("Invalid IP address: " + s); }
        if (v < 0 || v > 255) throw new IllegalArgumentException("Invalid IP address: " + s);
        return v;
    }

    public static long ipToLong(String ip) {
        String[] p = ip.split("\\.");
        if (p.length != 4) throw new IllegalArgumentException("Invalid IP address: " + ip);
        long r = 0;
        for (String o : p) r = (r << 8) | parseOctet(o.trim());
        return r;
    }

    public static String longToIp(long n) {
        return ((n >> 24) & 0xFF) + "." + ((n >> 16) & 0xFF) + "." + ((n >> 8) & 0xFF) + "." + (n & 0xFF);
    }

    private final ExecutorService portPool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "ahuva-port-probe");
        t.setDaemon(true);
        return t;
    });

    public List<HostResult> scan(List<String> ips, Options opts, Progress progress) throws InterruptedException {
        final int total = ips.size();
        final Map<String, String> arp = readArpTable();
        final boolean pingWorks = pingUsable();
        final Options o = opts;
        final AtomicInteger done = new AtomicInteger();
        ExecutorService hostPool = Executors.newFixedThreadPool(Math.max(1, Math.min(o.concurrency, 64)));
        List<Future<HostResult>> futures = new ArrayList<>(total);
        for (final String ip : ips) {
            futures.add(hostPool.submit(() -> {
                HostResult r = scanHost(ip, o, arp, pingWorks);
                if (progress != null) {
                    synchronized (this) { progress.onHost(r, done.incrementAndGet(), total); }
                }
                return r;
            }));
        }
        List<HostResult> results = new ArrayList<>(total);
        try {
            for (Future<HostResult> f : futures) {
                try { results.add(f.get()); }
                catch (java.util.concurrent.ExecutionException e) { /* single host failure is non-fatal */ }
            }
        } finally {
            hostPool.shutdownNow();
        }
        return results;
    }

    HostResult scanHost(String ip, Options o, Map<String, String> arp, boolean pingWorks) {
        HostResult r = new HostResult(ip);
        boolean alive = pingWorks ? ping(ip, o.pingTimeoutMs) : reachable(ip, o.pingTimeoutMs);
        // When ICMP is unusable on this phone we must probe ports to find anything at all.
        if (!alive && !o.portFallback && pingWorks) return r;
        List<Integer> open = probePorts(ip, o.ports, o.portTimeoutMs);
        if (!alive && open.isEmpty()) return r;
        r.status = alive ? "online" : "filtered";
        r.openPorts.addAll(open);
        String mac = arp.get(ip);
        if (mac != null) r.mac = mac;
        String nb = netbiosName(ip, 600);
        String dns = reverseDns(ip, 1500);
        r.hostname = !nb.isEmpty() ? nb : dns;
        if (!nb.isEmpty()) r.notes.add("NetBIOS: " + nb);
        return r;
    }

    public List<Integer> probePorts(final String ip, int[] ports, final int timeoutMs) {
        List<Future<Integer>> fs = new ArrayList<>();
        for (final int port : ports) {
            fs.add(portPool.submit(() -> {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress(ip, port), timeoutMs);
                    return port;
                } catch (IOException e) {
                    return -1;
                }
            }));
        }
        List<Integer> open = new ArrayList<>();
        for (Future<Integer> f : fs) {
            try {
                int p = f.get(timeoutMs + 2000L, TimeUnit.MILLISECONDS);
                if (p > 0) open.add(p);
            } catch (Exception ignored) {}
        }
        return open;
    }

    static String pingBinary() {
        for (String p : new String[]{"/system/bin/ping", "/bin/ping", "/usr/bin/ping", "/sbin/ping"}) {
            if (new File(p).exists()) return p;
        }
        return "ping";
    }

    /** Some ROMs block unprivileged ICMP; detect once per scan and fall back to TCP reachability. */
    public boolean pingUsable() {
        try {
            ProcResult r = run(new String[]{pingBinary(), "-c", "1", "-W", "1", "127.0.0.1"}, 4000);
            return r.exitCode == 0 || r.output.toLowerCase(Locale.ROOT).contains("bytes from");
        } catch (Exception e) {
            return false;
        }
    }

    public boolean ping(String ip, int timeoutMs) {
        int secs = Math.max(1, (int) Math.ceil(timeoutMs / 1000.0));
        try {
            ProcResult r = run(new String[]{pingBinary(), "-c", "1", "-W", String.valueOf(secs), ip}, timeoutMs + 3000);
            String out = r.output.toLowerCase(Locale.ROOT);
            return out.contains("bytes from") || out.contains("1 received") || out.contains("ttl=");
        } catch (Exception e) {
            return reachable(ip, timeoutMs);
        }
    }

    private boolean reachable(String ip, int timeoutMs) {
        try { return InetAddress.getByName(ip).isReachable(timeoutMs); } catch (IOException e) { return false; }
    }

    /** /proc/net/arp is readable up to Android 9; later versions return nothing and we simply skip MACs. */
    public static Map<String, String> readArpTable() {
        Map<String, String> map = new HashMap<>();
        File f = new File("/proc/net/arp");
        if (!f.canRead()) return map;
        try (BufferedReader br = new BufferedReader(new FileReader(f))) {
            String line = br.readLine();
            while ((line = br.readLine()) != null) {
                String[] cols = line.trim().split("\\s+");
                if (cols.length >= 4 && cols[3].matches("([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}") && !"00:00:00:00:00:00".equals(cols[3])) {
                    map.put(cols[0], cols[3].toUpperCase(Locale.ROOT));
                }
            }
        } catch (IOException ignored) {}
        return map;
    }

    private String reverseDns(final String ip, int timeoutMs) {
        Future<String> f = portPool.submit(() -> {
            String name = InetAddress.getByName(ip).getCanonicalHostName();
            return name == null || name.equals(ip) ? "" : name;
        });
        try { return f.get(timeoutMs, TimeUnit.MILLISECONDS); }
        catch (Exception e) { f.cancel(true); return ""; }
    }

    /** NetBIOS node-status query (UDP 137), same packet as the desktop scanner. */
    public static String netbiosName(String ip, int timeoutMs) {
        byte[] q = new byte[50];
        int txid = (int) (Math.random() * 0xFFFF);
        q[0] = (byte) (txid >> 8); q[1] = (byte) txid;
        q[5] = 0x01;
        q[12] = 0x20;
        byte[] wildcard = "CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(wildcard, 0, q, 13, 32);
        q[45] = 0x00; q[46] = 0x00; q[47] = 0x21; q[48] = 0x00; q[49] = 0x01;
        try (DatagramSocket s = new DatagramSocket()) {
            s.setSoTimeout(timeoutMs);
            s.send(new DatagramPacket(q, q.length, InetAddress.getByName(ip), 137));
            byte[] buf = new byte[1024];
            DatagramPacket resp = new DatagramPacket(buf, buf.length);
            s.receive(resp);
            int len = resp.getLength();
            if (len < 57) return "";
            int num = buf[56] & 0xFF;
            for (int i = 0; i < num && i < 10; i++) {
                int off = 57 + i * 18;
                if (off + 18 > len) break;
                String raw = new String(buf, off, 15, StandardCharsets.US_ASCII).replace("\u0000", "").trim();
                int flags = ((buf[off + 16] & 0xFF) << 8) | (buf[off + 17] & 0xFF);
                if (!raw.isEmpty() && (flags & 0x8000) == 0) return raw;
            }
        } catch (Exception ignored) {}
        return "";
    }

    public static void wakeOnLan(String mac, String broadcast) throws IOException {
        String clean = mac == null ? "" : mac.replaceAll("[:\\-.]", "");
        if (!clean.matches("[0-9a-fA-F]{12}")) throw new IllegalArgumentException("Invalid MAC address");
        byte[] macBytes = new byte[6];
        for (int i = 0; i < 6; i++) macBytes[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        byte[] magic = new byte[102];
        for (int i = 0; i < 6; i++) magic[i] = (byte) 0xFF;
        for (int i = 0; i < 16; i++) System.arraycopy(macBytes, 0, magic, 6 + i * 6, 6);
        String target = broadcast == null || broadcast.trim().isEmpty() ? "255.255.255.255" : broadcast.trim();
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            s.send(new DatagramPacket(magic, magic.length, InetAddress.getByName(target), 9));
        }
    }

    private static final Pattern HOP_FROM = Pattern.compile("[Ff]rom ([0-9a-fA-F:.]+)");
    private static final Pattern HOP_REPLY = Pattern.compile("bytes from ([0-9a-fA-F:.]+)");
    private static final Pattern RTT = Pattern.compile("time[=<]([0-9.]+) ?ms");

    /** Parses one TTL-limited ping. Returns {hopIp, rttMs|"", reachedTarget}. */
    public static String[] parseHop(String output) {
        Matcher reply = HOP_REPLY.matcher(output);
        if (reply.find()) {
            Matcher t = RTT.matcher(output);
            return new String[]{stripColon(reply.group(1)), t.find() ? t.group(1) : "", "true"};
        }
        Matcher from = HOP_FROM.matcher(output);
        if (from.find()) return new String[]{stripColon(from.group(1)), "", "false"};
        return null;
    }

    private static String stripColon(String s) {
        return s.endsWith(":") ? s.substring(0, s.length() - 1) : s;
    }

    /** Traceroute built from TTL-limited pings, because Android ships no traceroute binary. */
    public String traceroute(String ip, int maxHops) throws IOException {
        StringBuilder sb = new StringBuilder("traceroute to " + ip + ", " + maxHops + " hops max\n");
        String bin = pingBinary();
        for (int ttl = 1; ttl <= maxHops; ttl++) {
            long start = System.nanoTime();
            ProcResult r;
            try {
                r = run(new String[]{bin, "-c", "1", "-W", "2", "-t", String.valueOf(ttl), ip}, 5000);
            } catch (IOException e) {
                throw new IOException("ping is not available on this device: " + e.getMessage());
            }
            String[] hop = parseHop(r.output);
            if (hop == null) {
                sb.append(String.format(Locale.ROOT, "%2d  *\n", ttl));
                continue;
            }
            String rtt = hop[1].isEmpty()
                ? String.format(Locale.ROOT, "%.1f", (System.nanoTime() - start) / 1e6)
                : hop[1];
            sb.append(String.format(Locale.ROOT, "%2d  %s  %s ms\n", ttl, hop[0], rtt));
            if ("true".equals(hop[2])) break;
        }
        return sb.toString();
    }

    public void shutdown() {
        portPool.shutdownNow();
    }

    static final class ProcResult {
        final int exitCode;
        final String output;
        ProcResult(int exitCode, String output) { this.exitCode = exitCode; this.output = output; }
    }

    static ProcResult run(String[] cmd, long timeoutMs) throws IOException {
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        final StringBuilder sb = new StringBuilder();
        Thread drain = new Thread(() -> {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line).append('\n');
            } catch (IOException ignored) {}
        });
        drain.setDaemon(true);
        drain.start();
        long deadline = System.currentTimeMillis() + timeoutMs;
        int code = -1;
        while (true) {
            try { code = p.exitValue(); break; }
            catch (IllegalThreadStateException running) {
                if (System.currentTimeMillis() > deadline) { p.destroy(); break; }
                try { Thread.sleep(25); } catch (InterruptedException ie) { p.destroy(); Thread.currentThread().interrupt(); break; }
            }
        }
        try { drain.join(1000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        synchronized (sb) { return new ProcResult(code, sb.toString()); }
    }
}
