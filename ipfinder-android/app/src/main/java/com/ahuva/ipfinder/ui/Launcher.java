package com.ahuva.ipfinder.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;

import com.ahuva.ipfinder.core.Device;
import com.ahuva.ipfinder.core.Ports;

import java.util.ArrayList;
import java.util.List;

/**
 * Opens a discovered service in whatever app on the phone handles it: browsers, SSH/Telnet clients (Termius,
 * JuiceSSH, ConnectBot, Termux), RDP (Microsoft Remote Desktop), VNC viewers, file managers (FTP/SMB), video
 * players (RTSP) - through standard URI intents, so any installed app that registers the scheme works.
 */
public final class Launcher {
    private Launcher() {}

    public static final class Action {
        public final String label;
        public final String uri;
        public final String appHint; // shown when nothing can open it

        Action(String label, String uri, String appHint) {
            this.label = label;
            this.uri = uri;
            this.appHint = appHint;
        }
    }

    public static Action forPort(String ip, int port) {
        String hp = ip + ":" + port;
        if (Ports.isHttps(port)) return new Action("Open https://" + (port == 443 ? ip : hp), "https://" + (port == 443 ? ip : hp) + "/", "web browser");
        if (Ports.isHttp(port) || port == 631 || port == 5800) return new Action("Open http://" + (port == 80 ? ip : hp), "http://" + (port == 80 ? ip : hp) + "/", "web browser");
        switch (port) {
            case 22: return new Action("SSH to " + ip, "ssh://" + hp, "SSH client (Termius, JuiceSSH, ConnectBot)");
            case 23: return new Action("Telnet to " + ip, "telnet://" + hp, "Telnet client (ConnectBot, Termius)");
            case 21: return new Action("Browse FTP", "ftp://" + ip + (port == 21 ? "" : ":" + port) + "/", "file manager with FTP");
            case 139:
            case 445: return new Action("Browse shared folders (SMB)", "smb://" + ip + "/", "file manager with SMB/LAN");
            case 3389: return new Action("Remote Desktop to " + ip, "rdp://full%20address=s:" + hp, "Microsoft Remote Desktop");
            case 5900:
            case 5901: return new Action("VNC to " + ip, "vnc://" + hp, "VNC viewer (RealVNC, bVNC)");
            case 554:
            case 8554: return new Action("Open video stream (RTSP)", "rtsp://" + hp + "/", "video player (VLC)");
            case 1883: return new Action("MQTT broker " + hp, "mqtt://" + hp, "MQTT client");
            case 5555: return new Action("ADB " + hp, "adb://" + hp, "ADB client");
            case 8291: return new Action("MikroTik Winbox", "winbox://" + ip, "MikroTik app");
            default: return null;
        }
    }

    public static List<Action> forDevice(Device d) {
        List<Action> out = new ArrayList<>();
        List<Integer> ports;
        synchronized (d) {
            ports = new ArrayList<>(d.openPorts);
        }
        for (int p : ports) {
            Action a = forPort(d.ip, p);
            if (a != null) out.add(a);
        }
        return out;
    }

    /** Best single "Open" action for a device: web UI first, then remote access. */
    public static Action primary(Device d) {
        List<Action> all = forDevice(d);
        for (Action a : all) if (a.uri.startsWith("http")) return a;
        return all.isEmpty() ? null : all.get(0);
    }

    public static void open(Activity a, Action act) {
        open(a, act.uri, act.appHint, false);
    }

    public static void open(final Activity a, final String uri, final String appHint, boolean chooser) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            a.startActivity(chooser ? Intent.createChooser(i, "Open " + uri + " with") : i);
        } catch (ActivityNotFoundException e) {
            final String scheme = Uri.parse(uri).getScheme();
            new AlertDialog.Builder(a)
                    .setTitle("No app for " + scheme + "://")
                    .setMessage("Install a " + (appHint == null ? "compatible app" : appHint) + " to open " + uri
                            + ".\n\nYou can also copy the address and paste it into any app.")
                    .setPositiveButton("Find app", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) {
                            String q = Uri.encode((appHint == null ? scheme : appHint.replaceAll("\\(.*\\)", "")).trim());
                            try {
                                a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=" + q)));
                            } catch (ActivityNotFoundException e2) {
                                try {
                                    a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/search?q=" + q)));
                                } catch (ActivityNotFoundException ignored) {
                                    Ui.toast(a, "No app store or browser found");
                                }
                            }
                        }
                    })
                    .setNeutralButton("Copy address", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) {
                            Ui.copy(a, "address", uri);
                        }
                    })
                    .setNegativeButton("Close", null)
                    .show();
        } catch (SecurityException e) {
            Ui.toast(a, "That app refused to open " + uri);
        }
    }

    public static void share(Activity a, String subject, String text) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_SUBJECT, subject);
        i.putExtra(Intent.EXTRA_TEXT, text);
        try {
            a.startActivity(Intent.createChooser(i, "Share"));
        } catch (ActivityNotFoundException e) {
            Ui.toast(a, "No app to share with");
        }
    }
}
