package com.ahuva.ipfinder.core;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/** Multicast DNS (Bonjour / Avahi / Android NSD) discovery. */
public final class Mdns {
    public static final int PORT = 5353;
    public static final String GROUP = "224.0.0.251";

    /** Common service types. Anything else is picked up through the _services._dns-sd meta query. */
    static final String[] SERVICE_TYPES = {
            "_services._dns-sd._udp.local", "_workstation._tcp.local", "_device-info._tcp.local",
            "_http._tcp.local", "_https._tcp.local", "_ssh._tcp.local", "_sftp-ssh._tcp.local", "_smb._tcp.local",
            "_afpovertcp._tcp.local", "_ipp._tcp.local", "_ipps._tcp.local", "_printer._tcp.local",
            "_pdl-datastream._tcp.local", "_scanner._tcp.local", "_uscan._tcp.local", "_airplay._tcp.local",
            "_raop._tcp.local", "_googlecast._tcp.local", "_spotify-connect._tcp.local", "_companion-link._tcp.local",
            "_homekit._tcp.local", "_hap._tcp.local", "_matter._tcp.local", "_matterc._udp.local",
            "_sleep-proxy._udp.local", "_adb-tls-connect._tcp.local", "_androidtvremote2._tcp.local",
            "_amzn-wplay._tcp.local", "_sonos._tcp.local", "_roku-rcp._tcp.local", "_hue._tcp.local",
            "_esphomelib._tcp.local", "_home-assistant._tcp.local", "_mqtt._tcp.local", "_rfb._tcp.local",
            "_rdp._tcp.local", "_nfs._tcp.local", "_ftp._tcp.local", "_daap._tcp.local", "_touch-able._tcp.local",
            "_apple-mobdev2._tcp.local", "_rtsp._tcp.local", "_axis-video._tcp.local", "_nvstream._tcp.local",
            "_teamviewer._tcp.local", "_plexmediasvr._tcp.local", "_miio._udp.local", "_elg._tcp.local",
            "_ptp._tcp.local", "_webdav._tcp.local", "_dns-sd._udp.local"
    };

    private Mdns() {}

    public interface Handler {
        void onMessage(String fromIp, DnsPacket.Message msg);
    }

    /** Asks every target directly (unicast to port 5353) for the name of its own address. */
    public static void reverseSweep(List<Long> targets, int listenMs, AtomicBoolean cancel, final Handler handler) {
        UdpSweep.run(targets, PORT, null, new UdpSweep.Payload() {
            @Override public byte[] build(int index, long ip) {
                return DnsPacket.query(index & 0xFFFF, IpUtils.reverseName(IpUtils.toIp(ip)), DnsPacket.TYPE_PTR, false, false);
            }
        }, listenMs, cancel, new UdpSweep.ReplyHandler() {
            @Override public void onReply(String fromIp, byte[] data, int len) {
                handler.onMessage(fromIp, DnsPacket.parse(data, len));
            }
        });
    }

    /** Multicast browse of well-known and advertised service types. */
    public static void browse(NetworkInterface nif, int listenMs, AtomicBoolean cancel, Handler handler) {
        MulticastSocket sock = null;
        try {
            sock = new MulticastSocket(null);
            sock.setReuseAddress(true);
            try {
                sock.bind(new InetSocketAddress(PORT));
            } catch (IOException e) {
                // 5353 is taken (system responder) - an ephemeral port still gets QU (unicast) replies.
                sock.close();
                sock = new MulticastSocket(0);
            }
            if (nif != null) try { sock.setNetworkInterface(nif); } catch (IOException ignored) { }
            sock.setTimeToLive(255);
            InetAddress group = InetAddress.getByName(GROUP);
            try {
                if (nif != null) sock.joinGroup(new InetSocketAddress(group, PORT), nif);
                else sock.joinGroup(group);
            } catch (IOException ignored) {
                // Unicast replies still arrive without group membership.
            }
            sock.setSoTimeout(100);
            Set<String> asked = new LinkedHashSet<>();
            for (String t : SERVICE_TYPES) sendQuery(sock, group, t, asked);
            byte[] rx = new byte[9000];
            DatagramPacket in = new DatagramPacket(rx, rx.length);
            long deadline = System.currentTimeMillis() + listenMs;
            long resendAt = System.currentTimeMillis() + 1000;
            boolean resent = false;
            while (System.currentTimeMillis() < deadline) {
                if (cancel != null && cancel.get()) return;
                if (!resent && System.currentTimeMillis() > resendAt) {
                    // Second round: some responders rate-limit or miss the first burst.
                    resent = true;
                    Set<String> again = new LinkedHashSet<>(asked);
                    asked.clear();
                    for (String t : again) sendQuery(sock, group, t, asked);
                }
                try {
                    in.setData(rx);
                    sock.receive(in);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                DnsPacket.Message m;
                try {
                    m = DnsPacket.parse(in.getData(), in.getLength());
                } catch (RuntimeException e) {
                    continue;
                }
                if (!m.response) continue;
                // Follow service types advertised through the meta query.
                for (DnsPacket.Record r : m.records) {
                    if (r.type == DnsPacket.TYPE_PTR && r.name != null
                            && r.name.equalsIgnoreCase("_services._dns-sd._udp.local") && r.data != null
                            && !asked.contains(r.data.toLowerCase(java.util.Locale.US)) && asked.size() < 200) {
                        sendQuery(sock, group, r.data, asked);
                    }
                }
                handler.onMessage(in.getAddress().getHostAddress(), m);
            }
        } catch (IOException ignored) {
        } finally {
            if (sock != null) sock.close();
        }
    }

    private static void sendQuery(MulticastSocket sock, InetAddress group, String type, Set<String> asked) {
        asked.add(type.toLowerCase(java.util.Locale.US));
        byte[] q = DnsPacket.query(0, type, DnsPacket.TYPE_PTR, true, false);
        try {
            sock.send(new DatagramPacket(q, q.length, group, PORT));
        } catch (IOException ignored) {
        }
    }

    /** "Living Room._googlecast._tcp.local" -> "_googlecast._tcp" */
    public static String serviceTypeOf(String instance) {
        if (instance == null) return null;
        String s = instance.endsWith(".local") ? instance.substring(0, instance.length() - 6) : instance;
        int i = s.lastIndexOf("._");
        if (i < 0) return null;
        int j = s.lastIndexOf("._", i - 1);
        return j >= 0 ? s.substring(j + 1) : (s.startsWith("_") ? s : null);
    }

    /** "Living Room._googlecast._tcp.local" -> "Living Room" */
    public static String instanceLabel(String instance) {
        String type = serviceTypeOf(instance);
        if (type == null) return null;
        int i = instance.indexOf("." + type);
        return i > 0 ? instance.substring(0, i).replace("\\032", " ").replace("\\.", ".") : null;
    }
}
