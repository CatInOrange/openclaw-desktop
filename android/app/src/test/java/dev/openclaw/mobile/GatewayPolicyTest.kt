package dev.openclaw.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GatewayPolicyTest {
    @Test fun sharedContractCoversSavedAddressesAndExactOrigins() {
        val text = javaClass.classLoader!!.getResourceAsStream("gateway-cases.json")!!.bufferedReader().use { it.readText() }
        val contract = JSONObject(text)
        val valid = contract.getJSONArray("valid")
        for (i in 0 until valid.length()) {
            val row = valid.getJSONObject(i)
            val result = GatewayPolicy.normalize(row.getString("input"))
            assertEquals(row.getString("normalized"), result.url)
            assertEquals(row.getString("origin"), result.origin)
        }
        val invalid = contract.getJSONArray("invalid")
        for (i in 0 until invalid.length()) {
            try { GatewayPolicy.normalize(invalid.getString(i)); fail("Credential-bearing or unsupported entry accepted") }
            catch (_: IllegalArgumentException) { }
        }
        val pairs = contract.getJSONArray("originPairs")
        for (i in 0 until pairs.length()) {
            val row = pairs.getJSONObject(i)
            assertEquals(row.getBoolean("same"), GatewayPolicy.sameOrigin(row.getString("a"), row.getString("b")))
        }
    }
    @Test fun inPageRoutesMayHaveQueryAndHashButSavedEntrypointCannot() {
        assertEquals(GatewayPolicy.Navigation.INTERNAL, GatewayPolicy.navigation("https://claw.example.com/chat?session=abc#bottom", "https://claw.example.com/"))
        assertEquals(GatewayPolicy.Navigation.EXTERNAL, GatewayPolicy.navigation("https://claw.example.com:8443/chat", "https://claw.example.com/"))
        assertEquals(GatewayPolicy.Navigation.BLOCKED, GatewayPolicy.navigation("intent://claw.example.com/", "https://claw.example.com/"))
        assertEquals(GatewayPolicy.Navigation.BLOCKED, GatewayPolicy.navigation("https://user:pass@claw.example.com/", "https://claw.example.com/"))
    }
    @Test fun cleartextIsLimitedToExplicitLocalGatewaysAndProfilesSeparatePorts() {
        assertEquals("http://192.168.1.2:18789/", GatewayPolicy.normalize("http://192.168.1.2:18789").url)
        assertEquals("http://[::1]:18789/", GatewayPolicy.normalize("http://[::1]:18789").url)
        try { GatewayPolicy.normalize("http://public.example.com/"); fail("Public HTTP accepted") } catch (_: IllegalArgumentException) { }
        assertNotEquals(GatewayPolicy.profile("https://claw.example.com"), GatewayPolicy.profile("https://claw.example.com:8443"))
        assertEquals(GatewayPolicy.profile("https://claw.example.com"), GatewayPolicy.profile("https://claw.example.com"))
        assertFalse(GatewayPolicy.safeExternal("file:///sdcard/private"))
        assertFalse(GatewayPolicy.safeExternal("https://claw.example.com.evil.test\\@claw.example.com/"))
    }
}
