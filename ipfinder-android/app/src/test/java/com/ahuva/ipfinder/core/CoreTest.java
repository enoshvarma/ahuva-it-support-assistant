package com.ahuva.ipfinder.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

import org.junit.Test;

public class CoreTest {
    @Test public void parsesCidr() {
        List<Long> l = IpUtils.parseTargets("192.168.1.0/24");
        assertEquals(254, l.size());
        assertEquals("192.168.1.1", IpUtils.toIp(l.get(0)));
        assertEquals("192.168.1.254", IpUtils.toIp(l.get(253)));
        assertEquals(1, IpUtils.parseTargets("10.0.0.5/32").size());
        assertEquals(2, IpUtils.parseTargets("10.0.0.4/31").size());
        assertEquals(254, IpUtils.parseTargets("192.168.1.9/255.255.255.0").size());
    }

    @Test public void parsesRangesAndLists() {
        assertEquals(41, IpUtils.parseTargets("192.168.1.10-50").size());
        assertEquals(512, IpUtils.parseTargets("10.0.0.0-10.0.1.255").size());
        assertEquals(20, IpUtils.parseTargets("10.0.0.250-1.13").size());
        assertEquals(254, IpUtils.parseTargets("172.16.5.*").size());
        List<Long> l = IpUtils.parseTargets("192.168.1.1, 192.168.1.1 192.168.1.2;192.168.1.3");
        assertEquals(3, l.size());
        assertEquals(3, IpUtils.parseTargets("192.168.1.3-192.168.1.1").size());
    }

    @Test public void rejectsBadInput() {
        for (String s : new String[]{"", "300.1.1.1", "10.0.0.0/8", "1.2.3.4/33", "1.2.3.4-5.6.7.8.9"}) {
            try {
                IpUtils.parseTargets(s);
                fail("accepted " + s);
            } catch (IllegalArgumentException expected) {
                assertNotNull(expected.getMessage());
            }
        }
    }

    @Test public void macHelpers() {
        assertEquals("AA:BB:CC:DD:EE:FF", IpUtils.normalizeMac("aa-bb-cc-dd-ee-ff"));
        assertEquals("00:11:22:33:44:55", IpUtils.normalizeMac("0011.2233.4455"));
        assertNull(IpUtils.normalizeMac("00:00:00:00:00:00"));
        assertNull(IpUtils.normalizeMac("zz"));
        assertTrue(IpUtils.isRandomizedMac("DA:A1:19:00:00:01"));
        assertFalse(IpUtils.isRandomizedMac("B8:27:EB:00:00:01"));
    }

    @Test public void cidrHelpers() {
        assertEquals("192.168.1.1-192.168.1.254", IpUtils.cidrToRange("192.168.1.77", 24));
        assertEquals(24, IpUtils.prefixOf("255.255.255.0"));
        assertTrue(IpUtils.isPrivate(IpUtils.toLong("172.20.1.1")));
        assertFalse(IpUtils.isPrivate(IpUtils.toLong("8.8.8.8")));
        assertEquals("4.3.2.1.in-addr.arpa", IpUtils.reverseName("1.2.3.4"));
    }

    @Test public void portsParse() {
        assertEquals(Arrays.asList(22, 80, 81, 82), Ports.toList(Ports.parse("80-82, 22 80")));
        assertEquals("SSH", Ports.shortTag(22));
        assertEquals(0, Ports.parse("").length);
    }

    @Test public void dnsRoundTripWithCompression() {
        byte[] q = DnsPacket.query(7, "4.3.2.1.in-addr.arpa", DnsPacket.TYPE_PTR, true, false);
        DnsPacket.Message m = DnsPacket.parse(q, q.length);
        assertEquals(7, m.id);
        assertFalse(m.response);
        // Response: PTR 4.3.2.1.in-addr.arpa -> host.local, A host.local (compressed) -> 1.2.3.4, TXT
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(new byte[]{0, 0, (byte) 0x84, 0, 0, 0, 0, 3, 0, 0, 0, 0}, 0, 12);
        DnsPacket.writeName(o, "4.3.2.1.in-addr.arpa");
        o.write(new byte[]{0, 12, 0, 1, 0, 0, 0, 120}, 0, 8);
        ByteArrayOutputStream rd = new ByteArrayOutputStream();
        DnsPacket.writeName(rd, "host.local");
        o.write(0); o.write(rd.size());
        int hostOffset = o.size();
        o.write(rd.toByteArray(), 0, rd.size());
        o.write(0xC0); o.write(hostOffset);
        o.write(new byte[]{0, 1, (byte) 0x80, 1, 0, 0, 0, 120, 0, 4, 1, 2, 3, 4}, 0, 14);
        o.write(0xC0); o.write(hostOffset);
        byte[] txt = {6, 'f', 'n', '=', 'T', 'V', '1', 4, 'm', 'd', '=', 'X'};
        o.write(new byte[]{0, 16, 0, 1, 0, 0, 0, 120, 0, (byte) txt.length}, 0, 10);
        o.write(txt, 0, txt.length);
        byte[] b = o.toByteArray();
        DnsPacket.Message r = DnsPacket.parse(b, b.length);
        assertTrue(r.response);
        assertEquals(3, r.records.size());
        assertEquals("host.local", r.records.get(0).data);
        assertEquals("host.local", r.records.get(1).name);
        assertEquals("1.2.3.4", r.records.get(1).data);
        assertEquals("TV1", DnsPacket.txtValue(r.records.get(2).txt, "fn"));
        assertEquals("X", DnsPacket.txtValue(r.records.get(2).txt, "md"));
    }

    @Test public void netbiosNodeStatus() {
        byte[] req = NetBios.nodeStatusRequest(0x1234);
        assertEquals(50, req.length);
        assertEquals('C', req[13]);
        // Build a realistic reply: header + name + NBSTAT + 3 names + MAC
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(new byte[]{0x12, 0x34, (byte) 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0}, 0, 12);
        o.write(req, 12, 34);
        o.write(new byte[]{0, 0x21, 0, 1, 0, 0, 0, 0, 0, 0}, 0, 10);
        o.write(3);
        o.write(nbName("DESKTOP-42", 0x00, 0x0400), 0, 18);
        o.write(nbName("WORKGROUP", 0x00, 0x8400), 0, 18);
        o.write(nbName("ALICE", 0x03, 0x0400), 0, 18);
        o.write(new byte[]{(byte) 0xF0, (byte) 0xD5, (byte) 0xBF, 1, 2, 3}, 0, 6);
        byte[] b = o.toByteArray();
        NetBios.Info i = NetBios.parse(b, b.length);
        assertNotNull(i);
        assertEquals("DESKTOP-42", i.name);
        assertEquals("WORKGROUP", i.group);
        assertEquals("ALICE", i.user);
        assertEquals("F0:D5:BF:01:02:03", i.mac);
    }

    private static byte[] nbName(String n, int suffix, int flags) {
        byte[] r = new byte[18];
        Arrays.fill(r, 0, 15, (byte) ' ');
        byte[] nb = n.getBytes();
        System.arraycopy(nb, 0, r, 0, nb.length);
        r[15] = (byte) suffix;
        r[16] = (byte) (flags >> 8);
        r[17] = (byte) flags;
        return r;
    }

    @Test public void mdnsNames() {
        assertEquals("_googlecast._tcp", Mdns.serviceTypeOf("Living Room._googlecast._tcp.local"));
        assertEquals("_googlecast._tcp", Mdns.serviceTypeOf("_googlecast._tcp.local"));
        assertEquals("Living Room", Mdns.instanceLabel("Living Room._googlecast._tcp.local"));
        assertEquals("1.2.3.4", Scanner.ipFromReverse("4.3.2.1.in-addr.arpa"));
    }

    @Test public void arpParsing() {
        Map<String, String> m = new HashMap<>();
        ArpTable.parseProcLine("192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:ff     *        wlan0", m);
        ArpTable.parseProcLine("192.168.1.9      0x1         0x0         00:00:00:00:00:00     *        wlan0", m);
        ArpTable.parseNeighLine("192.168.1.20 dev wlan0 lladdr 11:22:33:44:55:66 STALE", m);
        ArpTable.parseNeighLine("192.168.1.21 dev wlan0  FAILED", m);
        assertEquals(2, m.size());
        assertEquals("AA:BB:CC:DD:EE:FF", m.get("192.168.1.1"));
        assertEquals("11:22:33:44:55:66", m.get("192.168.1.20"));
    }

    @Test public void wolPacket() {
        byte[] p = WakeOnLan.magicPacket("01:02:03:04:05:06");
        assertEquals(102, p.length);
        assertEquals((byte) 0xFF, p[5]);
        assertEquals(1, p[6]);
        assertEquals(6, p[101]);
    }

    @Test public void ouiLookup() throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        GZIPOutputStream gz = new GZIPOutputStream(bo);
        gz.write("B827EB\tRaspberry Pi Foundation\nF0D5BF\tIntel Corporate\n".getBytes("UTF-8"));
        gz.close();
        OuiDb db = OuiDb.load(new ByteArrayInputStream(bo.toByteArray()));
        assertEquals(2, db.size());
        assertEquals("Raspberry Pi Foundation", db.lookup("b8-27-eb-12-34-56"));
        assertEquals("Private (randomized MAC)", db.lookup("DA:A1:19:00:00:01"));
        assertNull(db.lookup("00:11:22:33:44:55"));
    }

    @Test public void httpParse() {
        byte[] raw = ("HTTP/1.1 200 OK\r\nServer: lighttpd\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
                + "<html><head><title> Router &amp; Admin </title></head></html>").getBytes();
        HttpProbe.Response r = HttpProbe.parse(raw);
        assertEquals(200, r.status);
        assertEquals("lighttpd", r.server);
        assertEquals("Router & Admin", r.title);
        Ssdp.Description d = Ssdp.parseDescription("<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>"
                + "<friendlyName>Bedroom TV</friendlyName><manufacturer>Samsung</manufacturer><modelName>QN55</modelName></device></root>");
        assertEquals("Bedroom TV", d.friendlyName);
        assertEquals("mediarenderer", Ssdp.shortDeviceType(d.deviceType));
    }

    @Test public void classifierAndExport() {
        Device printer = new Device("192.168.1.50");
        printer.openPorts.add(9100);
        printer.openPorts.add(80);
        Classifier.classify(printer);
        assertEquals(DeviceType.PRINTER, printer.type);

        Device win = new Device("192.168.1.60");
        win.openPorts.add(135);
        win.openPorts.add(445);
        win.netbiosName = "DESKTOP-1";
        win.alive = true;
        win.customName = "=cmd|calc";
        Classifier.classify(win);
        assertEquals(DeviceType.WINDOWS, win.type);
        assertEquals("Windows", win.os);

        String csv = Exporter.export(Arrays.asList(printer, win), Exporter.CSV, "192.168.1.0/24");
        assertTrue(csv.contains("'=cmd|calc"));
        assertTrue(csv.contains("135 445"));
        String html = Exporter.export(Collections.singletonList(win), Exporter.HTML, "x<y");
        assertTrue(html.contains("x&lt;y"));
        String json = Exporter.export(Collections.singletonList(win), Exporter.JSON, "r");
        assertTrue(json.contains("\"netbios\": \"DESKTOP-1\""));
        Device back = Device.fromJson(win.toJson());
        assertEquals(win.openPorts, back.openPorts);
        assertEquals("DESKTOP-1", back.netbiosName);
    }

    @Test public void tcpProbeLocalhost() throws Exception {
        java.net.ServerSocket ss = new java.net.ServerSocket(0, 5, java.net.InetAddress.getByName("127.0.0.1"));
        try {
            int open = ss.getLocalPort();
            java.net.ServerSocket tmp = new java.net.ServerSocket(0);
            int closed = tmp.getLocalPort();
            tmp.close();
            TcpProbe.Result r = TcpProbe.probe(java.net.InetAddress.getByName("127.0.0.1"), new int[]{open, closed}, 1000);
            assertTrue(r.responded);
            assertEquals(Collections.singletonList(open), r.open);
        } finally {
            ss.close();
        }
    }
}
