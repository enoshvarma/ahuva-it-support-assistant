package com.ahuva.itsupport.plugins;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AhuvaNetwork")
public class AhuvaNetworkPlugin extends Plugin {
    private static final String TAG = "AhuvaNetwork";
    private static final int[] COMMON_PORTS = {22, 23, 80, 443, 161, 8080, 8443, 3389};
    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    @PluginMethod
    public void scanRange(PluginCall call) {
        String target = call.getString("target", "");
        JSObject opts = call.getObject("opts", new JSObject());
        boolean fullPorts = opts != null && opts.optBoolean("fullPorts", false);

        executor.execute(() -> {
            try {
                List<String> ips = expandTarget(target);
                JSONArray results = new JSONArray();
                AtomicInteger done = new AtomicInteger(0);
                int total = ips.size();

                for (String ip : ips) {
                    try {
                        JSONObject host = scanHost(ip, fullPorts);
                        if (host != null) results.put(host);
                    } catch (Exception e) {
                        Log.w(TAG, "Scan error for " + ip, e);
                    }

                    int d = done.incrementAndGet();
                    JSObject progress = new JSObject();
                    progress.put("done", d);
                    progress.put("total", total);
                    progress.put("ip", ip);
                    notifyListeners("scanProgress", progress);
                }

                JSObject ret = new JSObject();
                ret.put("hosts", results);
                ret.put("total", total);
                ret.put("alive", results.length());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Scan failed: " + e.getMessage());
            }
        });
    }

    private JSONObject scanHost(String ip, boolean fullPorts) throws Exception {
        InetAddress addr = InetAddress.getByName(ip);
        boolean reachable = addr.isReachable(2000);

        JSONArray openPorts = new JSONArray();
        int[] ports = fullPorts ?
            new int[]{21, 22, 23, 25, 53, 80, 110, 143, 161, 443, 445, 993, 995, 1433, 3306, 3389, 5432, 5900, 8080, 8443} :
            COMMON_PORTS;

        for (int port : ports) {
            try {
                Socket s = new Socket();
                s.connect(new InetSocketAddress(ip, port), 1000);
                s.close();
                openPorts.put(port);
                if (!reachable) reachable = true;
            } catch (Exception ignored) {}
        }

        if (!reachable && openPorts.length() == 0) return null;

        JSONObject host = new JSONObject();
        host.put("ip", ip);
        host.put("alive", reachable);
        host.put("ports", openPorts);

        // DNS reverse lookup
        try {
            String hostname = addr.getCanonicalHostName();
            if (!hostname.equals(ip)) host.put("hostname", hostname);
        } catch (Exception ignored) {}

        // Ping latency
        try {
            long start = System.currentTimeMillis();
            if (addr.isReachable(3000)) {
                host.put("latency", System.currentTimeMillis() - start);
            }
        } catch (Exception ignored) {}

        return host;
    }

    private List<String> expandTarget(String target) {
        List<String> ips = new ArrayList<>();
        target = target.trim();

        // CIDR: 192.168.1.0/24
        if (target.contains("/")) {
            String[] parts = target.split("/");
            String baseIp = parts[0];
            int prefix = Integer.parseInt(parts[1]);
            long base = ipToLong(baseIp);
            int hostBits = 32 - prefix;
            long count = 1L << hostBits;
            long network = base & (0xFFFFFFFFL << hostBits);
            for (long i = 1; i < count - 1 && i < 1024; i++) {
                ips.add(longToIp(network + i));
            }
        }
        // Range: 192.168.1.1-50
        else if (target.contains("-")) {
            int dash = target.lastIndexOf("-");
            String baseIp = target.substring(0, dash);
            int lastDot = baseIp.lastIndexOf(".");
            String prefix = baseIp.substring(0, lastDot + 1);
            int startOctet = Integer.parseInt(baseIp.substring(lastDot + 1));
            int endOctet = Integer.parseInt(target.substring(dash + 1));
            for (int i = startOctet; i <= endOctet && i <= 255; i++) {
                ips.add(prefix + i);
            }
        }
        // Single IP
        else {
            ips.add(target);
        }
        return ips;
    }

    private long ipToLong(String ip) {
        String[] parts = ip.split("\\.");
        long result = 0;
        for (int i = 0; i < 4; i++) {
            result = (result << 8) | Integer.parseInt(parts[i]);
        }
        return result;
    }

    private String longToIp(long ip) {
        return ((ip >> 24) & 0xFF) + "." + ((ip >> 16) & 0xFF) + "." + ((ip >> 8) & 0xFF) + "." + (ip & 0xFF);
    }

    @PluginMethod
    public void wakeOnLan(PluginCall call) {
        String mac = call.getString("mac", "");
        String broadcast = call.getString("broadcast", "255.255.255.255");

        executor.execute(() -> {
            try {
                byte[] macBytes = parseMac(mac);
                byte[] magic = new byte[102];
                // 6 bytes of 0xFF
                for (int i = 0; i < 6; i++) magic[i] = (byte) 0xFF;
                // 16 repetitions of MAC
                for (int i = 0; i < 16; i++) {
                    System.arraycopy(macBytes, 0, magic, 6 + i * 6, 6);
                }

                DatagramSocket socket = new DatagramSocket();
                socket.setBroadcast(true);
                DatagramPacket packet = new DatagramPacket(magic, magic.length,
                    InetAddress.getByName(broadcast), 9);
                socket.send(packet);
                socket.close();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("WoL failed: " + e.getMessage());
            }
        });
    }

    private byte[] parseMac(String mac) {
        String clean = mac.replaceAll("[:\\-.]", "");
        byte[] bytes = new byte[6];
        for (int i = 0; i < 6; i++) {
            bytes[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }

    @PluginMethod
    public void traceroute(PluginCall call) {
        String ip = call.getString("ip", "");
        executor.execute(() -> {
            try {
                // Use system traceroute command
                ProcessBuilder pb = new ProcessBuilder("traceroute", "-m", "15", "-w", "2", ip);
                pb.redirectErrorStream(true);
                Process proc = pb.start();
                BufferedReader reader = new BufferedReader(new InputStreamReader(proc.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                proc.waitFor();

                JSObject ret = new JSObject();
                ret.put("output", sb.toString().trim());
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                // Fallback: traceroute may not be available
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("error", "Traceroute not available: " + e.getMessage());
                call.resolve(ret);
            }
        });
    }
}
