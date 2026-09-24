package com.ahuva.itsupport.core;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.net.ServerSocket;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Assume;
import org.junit.Test;

public class NetScannerTest {

    @Test
    public void parseCidr24() {
        List<String> ips = NetScanner.parseRange("192.168.1.77/24");
        assertEquals(254, ips.size());
        assertEquals("192.168.1.1", ips.get(0));
        assertEquals("192.168.1.254", ips.get(253));
    }

    @Test
    public void parseCidr32And31() {
        assertEquals(Collections.singletonList("10.0.0.5"), NetScanner.parseRange("10.0.0.5/32"));
        assertEquals(1, NetScanner.parseRange("10.0.0.4/31").size());
    }

    @Test
    public void parseFullAndShortRanges() {
        assertEquals(Arrays.asList("10.0.0.250", "10.0.0.251", "10.0.0.252"), NetScanner.parseRange("10.0.0.250-10.0.0.252"));
        assertEquals(50, NetScanner.parseRange("192.168.1.1-50").size());
        assertEquals(Collections.singletonList("172.16.0.9"), NetScanner.parseRange(" 172.16.0.9 "));
    }

    @Test
    public void rejectsBadInput() {
        for (String bad : new String[]{"", "10.0.0.0/33", "300.1.1.1-300.1.1.2", "10.0.0.9-10.0.0.1", "10.0.0.0/8"}) {
            try {
                NetScanner.parseRange(bad);
                fail("should reject " + bad);
            } catch (IllegalArgumentException expected) {}
        }
    }

    @Test
    public void probeFindsOpenPortOnly() throws Exception {
        try (ServerSocket open = new ServerSocket(0)) {
            int closedPort;
            try (ServerSocket tmp = new ServerSocket(0)) { closedPort = tmp.getLocalPort(); }
            NetScanner s = new NetScanner();
            List<Integer> found = s.probePorts("127.0.0.1", new int[]{open.getLocalPort(), closedPort}, 800);
            assertEquals(Collections.singletonList(open.getLocalPort()), found);
            s.shutdown();
        }
    }

    @Test
    public void scanReportsHostWithPortsAndProgress() throws Exception {
        try (ServerSocket open = new ServerSocket(0)) {
            NetScanner s = new NetScanner();
            NetScanner.Options o = new NetScanner.Options();
            o.ports = new int[]{open.getLocalPort()};
            o.portFallback = true;
            final int[] progressCalls = {0};
            List<NetScanner.HostResult> r = s.scan(Collections.singletonList("127.0.0.1"), o, (h, done, total) -> {
                progressCalls[0]++;
                assertEquals(1, total);
            });
            assertEquals(1, progressCalls[0]);
            assertEquals(1, r.size());
            assertTrue(r.get(0).status.equals("online") || r.get(0).status.equals("filtered"));
            assertEquals(Collections.singletonList(open.getLocalPort()), r.get(0).openPorts);
            s.shutdown();
        }
    }

    @Test
    public void parsesHopOutputs() {
        assertArrayEquals(new String[]{"192.168.1.1", "", "false"},
            NetScanner.parseHop("PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.\nFrom 192.168.1.1: icmp_seq=1 Time to live exceeded\n"));
        assertArrayEquals(new String[]{"10.0.0.1", "", "false"},
            NetScanner.parseHop("From 10.0.0.1 icmp_seq=1 Time to live exceeded"));
        assertArrayEquals(new String[]{"8.8.8.8", "12.3", "true"},
            NetScanner.parseHop("64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.3 ms"));
        assertNull(NetScanner.parseHop("1 packets transmitted, 0 received, 100% packet loss"));
    }

    @Test
    public void tracerouteLocalhostWhenPingAvailable() throws Exception {
        NetScanner s = new NetScanner();
        Assume.assumeTrue("ping not usable in this environment", s.pingUsable());
        String out = s.traceroute("127.0.0.1", 3);
        assertTrue(out, out.contains(" 1  127.0.0.1"));
        s.shutdown();
    }

    @Test
    public void wolValidatesMac() throws Exception {
        try {
            NetScanner.wakeOnLan("zz:11", "127.0.0.1");
            fail("bad mac accepted");
        } catch (IllegalArgumentException e) {
            assertEquals("Invalid MAC address", e.getMessage());
        }
        NetScanner.wakeOnLan("00-11-22-33-44-55", "127.0.0.1");
    }

    @Test
    public void netbiosTimeoutReturnsEmpty() {
        assertEquals("", NetScanner.netbiosName("127.0.0.1", 200));
    }
}
