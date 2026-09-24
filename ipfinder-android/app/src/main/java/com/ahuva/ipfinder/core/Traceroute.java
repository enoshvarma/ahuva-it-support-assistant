package com.ahuva.ipfinder.core;

import java.net.InetAddress;
import java.util.concurrent.atomic.AtomicBoolean;

/** Traceroute via the system ping binary with increasing TTL (ICMP time-exceeded), no root required. */
public final class Traceroute {
    private Traceroute() {}

    public interface Listener {
        void onHop(int ttl, String ip, String name, double rttMs);
    }

    /** @return true when the destination was reached */
    public static boolean run(String host, int maxHops, AtomicBoolean cancel, Listener l) {
        String target;
        try {
            target = InetAddress.getByName(host).getHostAddress();
        } catch (Exception e) {
            return false;
        }
        for (int ttl = 1; ttl <= maxHops; ttl++) {
            if (cancel != null && cancel.get()) return false;
            long t = System.nanoTime();
            Pinger.Reply r = Pinger.once(target, 2, ttl);
            double ms = (System.nanoTime() - t) / 1_000_000.0;
            String hop = r.from;
            if (r.ok && hop == null) hop = target;
            String name = null;
            if (hop != null) {
                try {
                    String n = InetAddress.getByName(hop).getCanonicalHostName();
                    if (!n.equals(hop)) name = n;
                } catch (Exception ignored) {
                }
            }
            l.onHop(ttl, hop, name, r.ok && r.rttMs >= 0 ? r.rttMs : (hop != null ? ms : -1));
            if (r.ok || target.equals(hop)) return true;
        }
        return false;
    }
}
