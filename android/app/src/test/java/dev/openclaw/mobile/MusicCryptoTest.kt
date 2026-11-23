package dev.openclaw.mobile

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

class MusicCryptoTest {
    @Test fun eapiMatchesPinnedNodeAdapterVector() {
        val expected = "FA90B329E9614F79E79598F37DC2EDB430F8378D2A2796338F0BFDEAEF824A22975CDA9D96D79E6DC4A59218CDB8199F491E719151F8DBAA75438E3AC614C4DCAA594A4DE12B53B70FB3AB447FD5061386DF0385BAD3B750D3528E4ECAFFAFBD8F8A33E34FDD2380F0939BC6F00F2456E1447DDE7AB2BDBE6362692C57E82AA9"
        assertEquals(expected, MusicCrypto.eapi("/api/song/enhance/player/url", "{\"ids\":\"[\\\"123\\\"]\",\"br\":128000}"))
    }
    @Test fun weapiAesMatchesNodeVectorAndRsaIsFixedWidth() {
        val result = MusicCrypto.weapi("{\"csrf_token\":\"\"}", "abcdefghijklmnop")
        assertEquals("Xq7VamFhKH1OmZhJfUWqviI00tbweILz08QglvBsyBzamphgzo8DM5n5/oKf79/r", result["params"])
        assertEquals(256, result.getValue("encSecKey").length)
        assertEquals(result, MusicCrypto.weapi("{\"csrf_token\":\"\"}", "abcdefghijklmnop"))
    }
    @Test fun randomWeapiEnvelopesDoNotReuseSecret() {
        val first = MusicCrypto.weapi("{}")
        val second = MusicCrypto.weapi("{}")
        assertNotEquals(first["params"], second["params"])
        assertNotEquals(first["encSecKey"], second["encSecKey"])
    }
}
