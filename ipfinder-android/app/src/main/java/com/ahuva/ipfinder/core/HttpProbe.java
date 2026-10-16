package com.ahuva.ipfinder.core;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.Charset;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Tiny HTTP client for fingerprinting: page title, Server header, UPnP XML. Plain sockets, no proxies. */
public final class HttpProbe {
    private HttpProbe() {}

    public static final class Response {
        public int status;
        public String server;
        public String location;
        public String body;
        public String title;
    }

    public static Response get(String url, int timeoutMs, int maxBytes) {
        try {
            URI u = new URI(url);
            if (!"http".equalsIgnoreCase(u.getScheme())) return null;
            int port = u.getPort() > 0 ? u.getPort() : 80;
            String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
            if (u.getRawQuery() != null) path += "?" + u.getRawQuery();
            return request(u.getHost(), port, path, timeoutMs, maxBytes);
        } catch (Exception e) {
            return null;
        }
    }

    /** GET / on host:port, following one same-host redirect. */
    public static Response fetchRoot(String host, int port, int timeoutMs) {
        Response r = request(host, port, "/", timeoutMs, 32 * 1024);
        if (r != null && r.status >= 300 && r.status < 400 && r.location != null && r.title == null) {
            try {
                URI u = new URI(r.location);
                if (u.getHost() == null || u.getHost().equals(host)) {
                    if (u.getScheme() == null || "http".equalsIgnoreCase(u.getScheme())) {
                        String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
                        int p = u.getPort() > 0 ? u.getPort() : port;
                        Response r2 = request(host, p, path, timeoutMs, 32 * 1024);
                        if (r2 != null) {
                            if (r2.server == null) r2.server = r.server;
                            return r2;
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return r;
    }

    static Response request(String host, int port, String path, int timeoutMs, int maxBytes) {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, port), timeoutMs);
            s.setSoTimeout(timeoutMs);
            OutputStream out = s.getOutputStream();
            String hostHeader = port == 80 ? host : host + ":" + port;
            String req = "GET " + path + " HTTP/1.0\r\nHost: " + hostHeader
                    + "\r\nUser-Agent: Mozilla/5.0 (Linux; Android) AhuvaIPFinder/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n";
            out.write(req.getBytes(Charset.forName("US-ASCII")));
            out.flush();
            InputStream in = s.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[4096];
            long deadline = System.currentTimeMillis() + timeoutMs * 2L;
            int n;
            try {
                while (buf.size() < maxBytes && System.currentTimeMillis() < deadline && (n = in.read(b)) > 0) buf.write(b, 0, n);
            } catch (IOException ignored) {
                // timeout mid-body: use what we have
            }
            return parse(buf.toByteArray());
        } catch (IOException e) {
            return null;
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    static Response parse(byte[] raw) {
        if (raw.length == 0) return null;
        String text = new String(raw, Charset.forName("ISO-8859-1"));
        if (!text.startsWith("HTTP/")) return null;
        Response r = new Response();
        int hdrEnd = text.indexOf("\r\n\r\n");
        String head = hdrEnd >= 0 ? text.substring(0, hdrEnd) : text;
        String[] lines = head.split("\r\n");
        String[] status = lines[0].split(" ");
        if (status.length >= 2) try { r.status = Integer.parseInt(status[1]); } catch (NumberFormatException ignored) { }
        String charset = "UTF-8";
        for (int i = 1; i < lines.length; i++) {
            int c = lines[i].indexOf(':');
            if (c <= 0) continue;
            String k = lines[i].substring(0, c).trim().toLowerCase(Locale.US), v = lines[i].substring(c + 1).trim();
            if (k.equals("server")) r.server = v;
            else if (k.equals("location")) r.location = v;
            else if (k.equals("content-type")) {
                Matcher m = Pattern.compile("charset=([\\w-]+)", Pattern.CASE_INSENSITIVE).matcher(v);
                if (m.find()) charset = m.group(1);
            }
        }
        if (hdrEnd >= 0) {
            int bodyStart = head.getBytes(Charset.forName("ISO-8859-1")).length + 4;
            try {
                r.body = new String(raw, bodyStart, raw.length - bodyStart, Charset.forName(charset));
            } catch (Exception e) {
                r.body = new String(raw, bodyStart, raw.length - bodyStart, Charset.forName("UTF-8"));
            }
            r.title = title(r.body);
        }
        return r;
    }

    static String title(String html) {
        if (html == null) return null;
        Matcher m = Pattern.compile("<title[^>]*>([^<]{1,200})", Pattern.CASE_INSENSITIVE).matcher(html);
        if (!m.find()) return null;
        String t = unescape(m.group(1)).replaceAll("\\s+", " ").trim();
        return t.isEmpty() ? null : t;
    }

    static String unescape(String s) {
        return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
                .replace("&#39;", "'").replace("&apos;", "'").replace("&nbsp;", " ");
    }

    /**
     * Reads the subject of a TLS server certificate without trusting it: the trust manager records the chain and
     * then rejects it, so the handshake always fails and no data is ever exchanged over an unverified channel.
     */
    public static String tlsCertificateName(String host, int port, int timeoutMs) {
        final X509Certificate[][] captured = new X509Certificate[1][];
        TrustManager tm = new X509TrustManager() {
            @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                throw new CertificateException("client certs not accepted");
            }

            @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                captured[0] = chain;
                throw new CertificateException("inspection only");
            }

            @Override public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        };
        Socket raw = new Socket();
        try {
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[]{tm}, null);
            raw.connect(new InetSocketAddress(host, port), timeoutMs);
            raw.setSoTimeout(timeoutMs);
            SSLSocket ssl = (SSLSocket) ctx.getSocketFactory().createSocket(raw, host, port, true);
            try {
                ssl.startHandshake();
            } catch (IOException expected) {
                // rejected by design
            } finally {
                try { ssl.close(); } catch (IOException ignored) { }
            }
        } catch (Exception ignored) {
        } finally {
            try { raw.close(); } catch (IOException ignored) { }
        }
        if (captured[0] == null || captured[0].length == 0) return null;
        String dn = captured[0][0].getSubjectX500Principal().getName();
        Matcher m = Pattern.compile("CN=([^,]+)").matcher(dn);
        String cn = m.find() ? m.group(1).trim() : dn;
        Matcher o = Pattern.compile("(?:^|,)O=([^,]+)").matcher(dn);
        if (o.find() && !o.group(1).trim().equalsIgnoreCase(cn)) cn = cn + " (" + o.group(1).trim() + ")";
        return cn.isEmpty() ? null : cn;
    }
}
