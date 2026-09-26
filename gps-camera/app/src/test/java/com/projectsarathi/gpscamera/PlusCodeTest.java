package com.projectsarathi.gpscamera;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PlusCodeTest {

    @Test
    public void encodesReferenceCoordinates() {
        // Reference values from the Open Location Code test suite.
        assertEquals("8FVC9G8F+6X", PlusCode.encode(47.365590, 8.524997));
        assertEquals("7FG49QCJ+2V", PlusCode.encode(20.3700625, 2.7821875));
        assertEquals("4VCPPQGP+Q9", PlusCode.encode(-41.2730625, 174.7859375));
    }

    @Test
    public void wrapsLongitudeAndClipsLatitude() {
        assertEquals(PlusCode.encode(10, 10), PlusCode.encode(10, 370));
        assertEquals(11, PlusCode.encode(90, 0).length());
    }
}
