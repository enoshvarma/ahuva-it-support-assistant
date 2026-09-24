package com.ahuva.itsupport.plugins;

import com.ahuva.itsupport.core.NetScanner;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;

@CapacitorPlugin(name = "AhuvaNetwork")
public class AhuvaNetworkPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final NetScanner scanner = new NetScanner();

    static JSObject toJs(NetScanner.HostResult r) {
        JSObject o = new JSObject();
        o.put("ip", r.ip);
        o.put("status", r.status);
        o.put("mac", r.mac);
        o.put("hostname", r.hostname);
        JSArray ports = new JSArray();
        for (int p : r.openPorts) ports.put(p);
        o.put("openPorts", ports);
        JSArray notes = new JSArray();
        for (String n : r.notes) notes.put(n);
        o.put("notes", notes);
        return o;
    }

    @PluginMethod
    public void scanRange(PluginCall call) {
        final String target = call.getString("target", "");
        final NetScanner.Options opts = new NetScanner.Options();
        opts.concurrency = call.getInt("concurrency", 32);
        opts.pingTimeoutMs = call.getInt("pingTimeout", 1000);
        opts.portTimeoutMs = call.getInt("portTimeout", 600);
        opts.portFallback = call.getBoolean("portFallback", false);
        JSONArray ports = call.getArray("ports", null);
        if (ports != null && ports.length() > 0) {
            opts.ports = new int[ports.length()];
            for (int i = 0; i < ports.length(); i++) opts.ports[i] = ports.optInt(i);
        }
        executor.execute(() -> {
            try {
                List<String> ips = NetScanner.parseRange(target);
                List<NetScanner.HostResult> results = scanner.scan(ips, opts, (r, done, total) -> {
                    JSObject ev = new JSObject();
                    ev.put("result", toJs(r));
                    ev.put("done", done);
                    ev.put("total", total);
                    notifyListeners("scanProgress", ev);
                });
                JSArray arr = new JSArray();
                for (NetScanner.HostResult r : results) arr.put(toJs(r));
                call.resolve(new JSObject().put("results", arr));
            } catch (IllegalArgumentException e) {
                call.reject(e.getMessage());
            } catch (Exception e) {
                call.reject("Scan failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void wakeOnLan(PluginCall call) {
        final String mac = call.getString("mac", "");
        final String broadcast = call.getString("broadcast", "255.255.255.255");
        executor.execute(() -> {
            try {
                NetScanner.wakeOnLan(mac, broadcast);
                call.resolve(new JSObject().put("ok", true));
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void traceroute(PluginCall call) {
        final String ip = call.getString("ip", "");
        executor.execute(() -> {
            JSObject ret = new JSObject();
            ret.put("ip", ip);
            try {
                ret.put("output", scanner.traceroute(ip, 20));
                ret.put("error", false);
            } catch (Exception e) {
                ret.put("output", "traceroute failed: " + e.getMessage());
                ret.put("error", true);
            }
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnDestroy() {
        scanner.shutdown();
        executor.shutdownNow();
    }
}
