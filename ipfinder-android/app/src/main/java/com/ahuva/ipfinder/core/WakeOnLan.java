package com.ahuva.ipfinder.core;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;

/** Wake-on-LAN magic packet: 6 x 0xFF followed by the target MAC 16 times, broadcast on UDP 9 (and 7). */
public final class WakeOnLan {
    private WakeOnLan() {}

    public static byte[] magicPacket(String mac) {
        byte[] m = IpUtils.macBytes(mac);
        byte[] p = new byte[102];
        for (int i = 0; i < 6; i++) p[i] = (byte) 0xFF;
        for (int i = 6; i < p.length; i += 6) System.arraycopy(m, 0, p, i, 6);
        return p;
    }

    /** @param broadcast subnet broadcast (e.g. 192.168.1.255) or a unicast IP for directed WoL */
    public static void send(String mac, String broadcast, int port) throws IOException {
        byte[] p = magicPacket(mac);
        DatagramSocket s = new DatagramSocket();
        try {
            s.setBroadcast(true);
            InetAddress to = InetAddress.getByName(broadcast);
            for (int i = 0; i < 3; i++) {
                s.send(new DatagramPacket(p, p.length, to, port));
                if (port != 7) s.send(new DatagramPacket(p, p.length, to, 7));
            }
        } finally {
            s.close();
        }
    }
}
