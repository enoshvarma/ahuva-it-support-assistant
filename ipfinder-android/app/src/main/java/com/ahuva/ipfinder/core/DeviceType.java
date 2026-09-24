package com.ahuva.ipfinder.core;

/** Device categories shown in the list. */
public final class DeviceType {
    public static final String UNKNOWN = "Device";
    public static final String ROUTER = "Router / Gateway";
    public static final String NETWORK = "Network equipment";
    public static final String WINDOWS = "Windows PC";
    public static final String MAC = "Mac";
    public static final String LINUX = "Linux / Server";
    public static final String PHONE_IOS = "iPhone / iPad";
    public static final String PHONE_ANDROID = "Android device";
    public static final String PRINTER = "Printer";
    public static final String CAMERA = "Camera / NVR";
    public static final String TV = "TV / Media";
    public static final String SPEAKER = "Speaker / Audio";
    public static final String NAS = "NAS / Storage";
    public static final String IOT = "Smart home / IoT";
    public static final String CONSOLE = "Game console";
    public static final String VM = "Virtual machine";
    public static final String SELF = "This device";

    private DeviceType() {}

    /** One or two letters for the list avatar. */
    public static String glyph(String t) {
        if (t == null) return "?";
        switch (t) {
            case ROUTER: return "R";
            case NETWORK: return "N";
            case WINDOWS: return "W";
            case MAC: return "M";
            case LINUX: return "L";
            case PHONE_IOS: return "i";
            case PHONE_ANDROID: return "A";
            case PRINTER: return "P";
            case CAMERA: return "C";
            case TV: return "TV";
            case SPEAKER: return "S";
            case NAS: return "NS";
            case IOT: return "H";
            case CONSOLE: return "G";
            case VM: return "VM";
            case SELF: return "Me";
            default: return "D";
        }
    }

    /** ARGB avatar colour per type. */
    public static int color(String t) {
        if (t == null) return 0xFF607D8B;
        switch (t) {
            case ROUTER: return 0xFF1E88E5;
            case NETWORK: return 0xFF3949AB;
            case WINDOWS: return 0xFF0288D1;
            case MAC: return 0xFF757575;
            case LINUX: return 0xFFF57C00;
            case PHONE_IOS: return 0xFF546E7A;
            case PHONE_ANDROID: return 0xFF43A047;
            case PRINTER: return 0xFF8E24AA;
            case CAMERA: return 0xFFD81B60;
            case TV: return 0xFFE53935;
            case SPEAKER: return 0xFF6D4C41;
            case NAS: return 0xFF00897B;
            case IOT: return 0xFFFFB300;
            case CONSOLE: return 0xFF5E35B1;
            case VM: return 0xFF00ACC1;
            case SELF: return 0xFF00BFA5;
            default: return 0xFF607D8B;
        }
    }
}
