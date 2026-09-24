package com.ahuva.ipfinder.core;

import java.util.Locale;

/** Best-effort device type and OS guess from vendor, open ports, service announcements and names. */
public final class Classifier {
    private Classifier() {}

    public static void classify(Device d) {
        synchronized (d) {
            String type = guess(d);
            d.type = type;
            if (d.os == null) d.os = guessOs(d, type);
        }
    }

    private static boolean has(String hay, String... needles) {
        if (hay == null) return false;
        String h = hay.toLowerCase(Locale.US);
        for (String n : needles) if (h.contains(n)) return true;
        return false;
    }

    private static boolean svc(Device d, String... types) {
        for (String s : d.services) for (String t : types) if (s.toLowerCase(Locale.US).startsWith(t)) return true;
        return false;
    }

    static String guess(Device d) {
        if (d.isSelf) return DeviceType.SELF;
        String vendor = d.vendor == null ? "" : d.vendor;
        String names = (d.friendlyName + " " + d.mdnsName + " " + d.hostname + " " + d.netbiosName + " " + d.model + " "
                + d.manufacturer).toLowerCase(Locale.US);
        String web = (d.httpTitle + " " + d.httpServer + " " + d.banners.values()).toLowerCase(Locale.US);
        java.util.Set<Integer> p = d.openPorts;

        if (d.isGateway) return DeviceType.ROUTER;
        if (svc(d, "_ipp", "_printer", "_pdl-datastream", "_scanner", "_uscan") || p.contains(9100) || p.contains(515)
                || has(names, "printer", "laserjet", "officejet", "deskjet", "epson", "brother", "canon mf", "kyocera")
                || has(vendor, "brother industries", "seiko epson", "kyocera", "lexmark", "xerox", "ricoh"))
            return DeviceType.PRINTER;
        if (p.contains(554) || p.contains(8554) || p.contains(37777) || svc(d, "_axis-video", "_rtsp")
                || has(vendor, "hikvision", "dahua", "axis communications", "reolink", "uniview", "amcrest", "hangzhou")
                || has(web, "hikvision", "dahua", "webcam", "nvr", "dvr", "ipcam", "network camera"))
            return DeviceType.CAMERA;
        if (svc(d, "_googlecast", "_airplay", "_androidtvremote", "_amzn-wplay", "_roku", "_nvstream", "_plexmediasvr")
                || has(names, "chromecast", "apple tv", "appletv", "bravia", "roku", "fire tv", "firetv", "shield", "smart tv", "[tv]")
                || has(vendor, "roku", "lg electronics", "vizio", "tcl", "hisense", "tpv") && !p.contains(22))
            return svc(d, "_raop", "_spotify-connect", "_sonos") && !svc(d, "_googlecast", "_airplay") ? DeviceType.SPEAKER : DeviceType.TV;
        if (svc(d, "_sonos", "_spotify-connect", "_raop") || has(vendor, "sonos", "bose", "harman") || has(names, "sonos", "homepod", "echo"))
            return DeviceType.SPEAKER;
        if (has(vendor, "nintendo", "sony interactive") || has(names, "playstation", "xbox", "nintendo", "ps4", "ps5"))
            return DeviceType.CONSOLE;
        if (has(vendor, "synology", "qnap", "western digital", "buffalo", "netgear") && (p.contains(5000) || p.contains(5001) || p.contains(445))
                || has(names, "synology", "diskstation", "qnap", "nas") || svc(d, "_afpovertcp") && !svc(d, "_companion-link"))
            return DeviceType.NAS;
        if (p.contains(62078) || svc(d, "_apple-mobdev2", "_companion-link") && !svc(d, "_airplay") && !p.contains(22)
                || has(names, "iphone", "ipad"))
            return has(names, "macbook", "imac", "mac-mini", "macmini", "mac pro") ? DeviceType.MAC : DeviceType.PHONE_IOS;
        if (has(names, "macbook", "imac", "mac-mini", "macmini", "mac pro", "macpro") || has(vendor, "apple") && (p.contains(22) || p.contains(548) || p.contains(5900)))
            return DeviceType.MAC;
        if (p.contains(135) || p.contains(3389) || p.contains(5985) || (p.contains(445) && d.netbiosName != null && !p.contains(22)))
            return DeviceType.WINDOWS;
        if (has(vendor, "vmware", "virtualbox", "parallels", "qemu", "xensource", "microsoft corporation") && (p.contains(22) || p.contains(3389)))
            return DeviceType.VM;
        if (p.contains(8291) || has(vendor, "cisco", "juniper", "mikrotik", "routerboard", "ubiquiti", "aruba", "ruckus", "allied telesis",
                "fortinet", "tp-link", "d-link", "zyxel", "netgear", "hewlett packard enterprise", "extreme networks", "cambium")
                || has(web, "routeros", "fortigate", "unifi", "cisco", "juniper", "switch", "access point", "openwrt", "luci")
                || p.contains(161) && !p.contains(445))
            return p.contains(53) || has(web, "router") ? DeviceType.ROUTER : DeviceType.NETWORK;
        if (svc(d, "_hap", "_homekit", "_matter", "_hue", "_esphomelib", "_home-assistant", "_miio", "_mqtt") || p.contains(1883) || p.contains(8123)
                || has(vendor, "espressif", "tuya", "shelly", "signify", "philips lighting", "xiaomi", "sonoff", "itead", "nest", "ring", "ecobee", "wiz")
                || has(names, "esp_", "esp-", "shelly", "tasmota", "wled", "hue"))
            return DeviceType.IOT;
        if (p.contains(5555) || svc(d, "_adb-tls-connect") || has(names, "android", "galaxy", "pixel", "redmi", "oneplus", "oppo", "vivo", "realme")
                || has(vendor, "samsung", "xiaomi", "oneplus", "oppo", "vivo", "huawei", "motorola", "google") && p.isEmpty())
            return DeviceType.PHONE_ANDROID;
        if (p.contains(22) || p.contains(111) || p.contains(2049) || has(vendor, "raspberry", "super micro", "dell", "hewlett") || has(web, "ubuntu", "debian", "nginx", "apache"))
            return DeviceType.LINUX;
        if (p.contains(445) || p.contains(139) || d.netbiosName != null) return DeviceType.WINDOWS;
        if (has(vendor, "apple")) return DeviceType.PHONE_IOS;
        return DeviceType.UNKNOWN;
    }

    static String guessOs(Device d, String type) {
        String b = String.valueOf(d.sshBanner) + " " + d.httpServer;
        if (has(b, "ubuntu")) return "Ubuntu Linux";
        if (has(b, "debian")) return "Debian Linux";
        if (has(b, "raspbian")) return "Raspberry Pi OS";
        if (has(b, "freebsd")) return "FreeBSD";
        if (has(b, "mikrotik", "routeros")) return "RouterOS";
        if (has(b, "microsoft-iis", "windows")) return "Windows";
        switch (type) {
            case DeviceType.WINDOWS: return "Windows";
            case DeviceType.MAC: return "macOS";
            case DeviceType.PHONE_IOS: return "iOS / iPadOS";
            case DeviceType.PHONE_ANDROID: return "Android";
            case DeviceType.LINUX: return "Linux / Unix";
            default: return null;
        }
    }
}
