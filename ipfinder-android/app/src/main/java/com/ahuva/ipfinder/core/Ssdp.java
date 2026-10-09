package com.ahuva.ipfinder.core;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** UPnP / SSDP discovery: routers, smart TVs, media servers, printers, cameras, consoles. */
public final class Ssdp {
    private static final String GROUP = "239.255.255.250";
    private static final int PORT = 1900;

    private Ssdp() {}

    public interface Handler {
        void onReply(String fromIp, String location, String server);
    }

    public static final class Description {
        public String friendlyName, manufacturer, modelName, modelNumber, deviceType, presentationUrl;
    }

    public static void discover(NetworkInterface nif, int listenMs, AtomicBoolean cancel, Handler handler) {
        MulticastSocket sock = null;
        try {
            sock = new MulticastSocket(0);
            if (nif != null) try { sock.setNetworkInterface(nif); } catch (IOException ignored) { }
            sock.setTimeToLive(4);
            sock.setSoTimeout(100);
            InetAddress group = InetAddress.getByName(GROUP);
            String[] targets = {"ssdp:all", "upnp:rootdevice"};
            for (String st : targets) {
                String req = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: "
                        + st + "\r\nUSER-AGENT: Android UPnP/1.1 AhuvaIPFinder/1.0\r\n\r\n";
                byte[] b = req.getBytes(Charset.forName("US-ASCII"));
                for (int i = 0; i < 2; i++) sock.send(new DatagramPacket(b, b.length, group, PORT));
            }
            byte[] rx = new byte[2048];
            DatagramPacket in = new DatagramPacket(rx, rx.length);
            long deadline = System.currentTimeMillis() + listenMs;
            while (System.currentTimeMillis() < deadline) {
                if (cancel != null && cancel.get()) return;
                try {
                    in.setData(rx);
                    sock.receive(in);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                String s = new String(in.getData(), 0, in.getLength(), Charset.forName("UTF-8"));
                handler.onReply(in.getAddress().getHostAddress(), header(s, "LOCATION"), header(s, "SERVER"));
            }
        } catch (IOException ignored) {
        } finally {
            if (sock != null) sock.close();
        }
    }

    static String header(String msg, String name) {
        for (String line : msg.split("\r?\n")) {
            int c = line.indexOf(':');
            if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase(name)) {
                String v = line.substring(c + 1).trim();
                return v.isEmpty() ? null : v;
            }
        }
        return null;
    }

    public static Description fetchDescription(String location, int timeoutMs) {
        HttpProbe.Response r = HttpProbe.get(location, timeoutMs, 64 * 1024);
        if (r == null || r.body == null) return null;
        return parseDescription(r.body);
    }

    static Description parseDescription(String xml) {
        Description d = new Description();
        d.friendlyName = tag(xml, "friendlyName");
        d.manufacturer = tag(xml, "manufacturer");
        d.modelName = tag(xml, "modelName");
        d.modelNumber = tag(xml, "modelNumber");
        d.deviceType = tag(xml, "deviceType");
        d.presentationUrl = tag(xml, "presentationURL");
        return d;
    }

    private static String tag(String xml, String name) {
        Matcher m = Pattern.compile("<(?:\\w+:)?" + name + "\\s*>([^<]*)</", Pattern.CASE_INSENSITIVE).matcher(xml);
        if (!m.find()) return null;
        String v = HttpProbe.unescape(m.group(1)).trim();
        return v.isEmpty() ? null : v;
    }

    public static String shortDeviceType(String urn) {
        if (urn == null) return null;
        // urn:schemas-upnp-org:device:MediaRenderer:1 -> MediaRenderer
        String[] p = urn.split(":");
        return p.length >= 2 ? p[p.length - 2].toLowerCase(Locale.US) : urn;
    }
}
