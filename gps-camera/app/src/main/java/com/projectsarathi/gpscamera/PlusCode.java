package com.projectsarathi.gpscamera;

/** Minimal Open Location Code ("Plus Code") encoder, 10-digit precision (~14 m). */
public final class PlusCode {

    private static final String ALPHABET = "23456789CFGHJMPQRVWX";
    private static final int ENCODING_BASE = 20;
    private static final int PAIR_CODE_LENGTH = 10;

    private PlusCode() {
    }

    public static String encode(double latitude, double longitude) {
        latitude = Math.min(90, Math.max(-90, latitude));
        if (latitude == 90) {
            latitude -= 0.000125; // keep the north pole inside the last cell
        }
        longitude = ((longitude + 180) % 360 + 360) % 360 - 180;

        // Work in integers of the smallest pair resolution to avoid floating point drift.
        long latVal = (long) Math.floor((latitude + 90) * 8000);
        long lngVal = (long) Math.floor((longitude + 180) * 8000);

        char[] code = new char[PAIR_CODE_LENGTH];
        for (int i = PAIR_CODE_LENGTH / 2 - 1; i >= 0; i--) {
            code[i * 2] = ALPHABET.charAt((int) (latVal % ENCODING_BASE));
            code[i * 2 + 1] = ALPHABET.charAt((int) (lngVal % ENCODING_BASE));
            latVal /= ENCODING_BASE;
            lngVal /= ENCODING_BASE;
        }
        String s = new String(code);
        return s.substring(0, 8) + "+" + s.substring(8);
    }
}
