package com.ahuva.ipfinder.core;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** ICMP echo via InetAddress.isReachable and the system ping binary (no root needed on Android). */
public final class Pinger {
    private static final Pattern TIME = Pattern.compile("time[=<]\\s*([0-9.]+)\\s*ms");
    private static final Pattern FROM = Pattern.compile("[Ff]rom ([0-9.]+)");
    private static String pingBin;

    private Pinger() {}

    public static synchronized String pingBinary() {
        if (pingBin == null) {
            String[] c = {"/system/bin/ping", "/system/xbin/ping", "/bin/ping", "/usr/bin/ping", "/sbin/ping"};
            pingBin = "ping";
            for (String p : c) if (new File(p).exists()) { pingBin = p; break; }
        }
        return pingBin;
    }

    /** Returns round trip in ms, or -1 if no reply. */
    public static int isReachable(InetAddress addr, int timeoutMs) {
        long t = System.nanoTime();
        try {
            if (addr.isReachable(timeoutMs)) return Math.max(0, (int) ((System.nanoTime() - t) / 1_000_000L));
        } catch (IOException ignored) {
        }
        return -1;
    }

    public static final class Reply {
        public boolean ok;
        public double rttMs = -1;
        public String from;      // who answered (differs from target for TTL exceeded)
        public boolean ttlExceeded;
        public String line;
    }

    /** One echo request via the ping binary. ttl <= 0 means default. */
    public static Reply once(String ip, int timeoutSec, int ttl) {
        Reply r = new Reply();
        List<String> cmd = new ArrayList<>();
        cmd.add(pingBinary());
        cmd.add("-c");
        cmd.add("1");
        cmd.add("-W");
        cmd.add(String.valueOf(Math.max(1, timeoutSec)));
        if (ttl > 0) {
            cmd.add("-t");
            cmd.add(String.valueOf(ttl));
        }
        cmd.add(ip);
        Process p = null;
        try {
            p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line;
            while ((line = br.readLine()) != null) {
                String l = line.toLowerCase(Locale.US);
                if (l.contains("bytes from") || l.contains("time to live exceeded") || l.contains("time exceeded")) {
                    r.line = line;
                    Matcher f = FROM.matcher(line);
                    if (f.find()) r.from = f.group(1);
                    if (l.contains("exceeded")) {
                        r.ttlExceeded = true;
                    } else {
                        r.ok = true;
                        Matcher m = TIME.matcher(line);
                        if (m.find()) r.rttMs = Double.parseDouble(m.group(1));
                    }
                }
            }
            p.waitFor(); // output hit EOF, so the process has exited; -c 1 -W bounds the runtime
        } catch (IOException e) {
            r.line = "ping unavailable: " + e.getMessage();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            if (p != null) p.destroy();
        }
        return r;
    }
}
