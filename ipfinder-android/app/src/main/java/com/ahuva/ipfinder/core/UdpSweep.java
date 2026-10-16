package com.ahuva.ipfinder.core;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Fires one UDP datagram at every target from a single socket and collects replies. One socket for a whole
 * /24 is far cheaper than a thread per host and finds hosts that drop ICMP but answer NetBIOS or mDNS.
 */
public final class UdpSweep {
    private UdpSweep() {}

    public interface Payload {
        byte[] build(int index, long ip);
    }

    public interface ReplyHandler {
        void onReply(String fromIp, byte[] data, int len);
    }

    /**
     * @param destination if non-null every packet goes to this address (e.g. a DNS server) instead of the target
     * @param listenMs    how long to keep listening after the last packet is sent
     */
    public static void run(List<Long> targets, int port, InetAddress destination, Payload payload,
                           int listenMs, AtomicBoolean cancel, ReplyHandler handler) {
        DatagramSocket sock = null;
        try {
            sock = new DatagramSocket();
            sock.setSoTimeout(50);
            byte[] rx = new byte[4096];
            DatagramPacket in = new DatagramPacket(rx, rx.length);
            int i = 0;
            for (long ip : targets) {
                if (cancel != null && cancel.get()) return;
                byte[] p = payload.build(i, ip);
                InetAddress to = destination != null ? destination : InetAddress.getByAddress(IpUtils.toBytes(ip));
                try {
                    sock.send(new DatagramPacket(p, p.length, to, port));
                } catch (IOException ignored) {
                    // EHOSTUNREACH etc. for a single target shouldn't abort the sweep
                }
                i++;
                // Pace sends and drain replies so the socket buffer never overflows on big ranges.
                if (i % 32 == 0) {
                    sock.setSoTimeout(1);
                    drain(sock, in, rx, 0, handler);
                    if (i % 256 == 0) Thread.sleep(2);
                }
            }
            sock.setSoTimeout(50);
            long deadline = System.currentTimeMillis() + listenMs;
            while (System.currentTimeMillis() < deadline) {
                if (cancel != null && cancel.get()) return;
                drain(sock, in, rx, 1, handler);
            }
        } catch (IOException ignored) {
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            if (sock != null) sock.close();
        }
    }

    private static void drain(DatagramSocket sock, DatagramPacket in, byte[] rx, int minReads, ReplyHandler handler) {
        for (int n = 0; n < 256; n++) {
            try {
                in.setData(rx);
                sock.receive(in);
                try {
                    handler.onReply(in.getAddress().getHostAddress(), in.getData(), in.getLength());
                } catch (RuntimeException ignored) {
                    // malformed packet
                }
            } catch (SocketTimeoutException e) {
                if (n >= minReads - 1) return;
            } catch (IOException e) {
                return;
            }
        }
    }
}
