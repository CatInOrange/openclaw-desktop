package dev.openclaw.mobile

import org.junit.Assert.*
import org.junit.Test

class MusicCryptoTest {
    @Test fun eapiMatchesPinnedNodeAdapterVector() {
        val expected = "FA90B329E9614F79E79598F37DC2EDB430F8378D2A2796338F0BFDEAEF824A22975CDA9D96D79E6DC4A59218CDB8199F491E719151F8DBAA75438E3AC614C4DCAA594A4DE12B53B70FB3AB447FD5061386DF0385BAD3B750D3528E4ECAFFAFBD8F8A33E34FDD2380F0939BC6F00F2456E1447DDE7AB2BDBE6362692C57E82AA9"
        assertEquals(expected, MusicCrypto.eapi("/api/song/enhance/player/url", "{\"ids\":\"[\\\"123\\\"]\",\"br\":128000}"))
    }
    @Test fun weapiAesMatchesNodeVectorAndRsaIsFixedWidth() {
        val result = MusicCrypto.weapi("{\"csrf_token\":\"\"}", "abcdefghijklmnop")
        assertEquals("Xq7VamFhKH1OmZhJfUWqviI00tbweILz08QglvBsyBzamphgzo8DM5n5/oKf79/r", result["params"])
        assertEquals("d15a1683c992095d0c234c19966605c5c5964911268bbeda8cb8d08d834913e59d53b32358903a121b5fca784c1f5ae44951fd02524df58ecc98e52cc7cf8689b42c2e93ddf05b0592512d87f5960467e2f086c018849d76014d323500e30f13ef4cafbb0cf5a66731a3f1776c75ca35d0062dac70a3e33245afabcf47938487", result["encSecKey"])
        assertEquals(result, MusicCrypto.weapi("{\"csrf_token\":\"\"}", "abcdefghijklmnop"))
    }
    @Test fun randomWeapiEnvelopesDoNotReuseSecret() {
        val first = MusicCrypto.weapi("{}")
        val second = MusicCrypto.weapi("{}")
        assertNotEquals(first["params"], second["params"])
        assertNotEquals(first["encSecKey"], second["encSecKey"])
    }
}
