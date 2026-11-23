package dev.openclaw.mobile

import org.junit.Assert.*
import org.junit.Test

class HeartQueueTest {
    @Test fun repeatedRecommendationsDoNotDuplicateOrRepeatSeenSongs() {
        val queue = HeartQueue<Long> { it }
        queue.addFresh(listOf(1, 2, 2, 3)); assertEquals(3, queue.size)
        assertEquals(1L, queue.removeFirst())
        queue.addFresh(listOf(1, 2, 3, 4)); assertEquals(3, queue.size)
        assertEquals(listOf(2L, 3L, 4L), List(3) { queue.removeFirst() })
    }
    @Test fun finiteServerPoolRecyclesWithoutFixedPlaybackLimit() {
        val queue = HeartQueue<Long> { it }
        var current = 0L
        repeat(40) {
            queue.addFresh(listOf(1, 2, 3))
            if (queue.isEmpty()) queue.recycle(listOf(1, 2, 3, 3), current)
            val next = queue.removeFirst(); assertNotEquals(current, next); current = next
        }
    }
    @Test fun singleSongPoolRemainsPlayableAndLogoutResetsHistory() {
        val queue = HeartQueue<Long> { it }
        queue.addFresh(listOf(8)); assertEquals(8L, queue.removeFirst())
        queue.recycle(listOf(8), 8); assertEquals(8L, queue.removeFirst())
        queue.clear(); queue.addFresh(listOf(8)); assertEquals(1, queue.size)
    }
    @Test fun invalidIdsCannotEnterQueue() {
        val queue = HeartQueue<Long> { it }; queue.addFresh(listOf(0, -1)); queue.recycle(listOf(0, -1), 0)
        assertTrue(queue.isEmpty())
    }
}
