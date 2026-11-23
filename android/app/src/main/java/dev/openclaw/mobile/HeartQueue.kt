package dev.openclaw.mobile

/** Platform-free heart-mode queue policy shared by playback and JVM regression tests. */
internal class HeartQueue<T>(private val id: (T) -> Long) {
    private val items = ArrayDeque<T>()
    private val seen = linkedSetOf<Long>()
    val size get() = items.size
    fun isEmpty() = items.isEmpty()
    fun clear() { items.clear(); seen.clear() }
    fun removeFirst(): T = items.removeFirst().also { seen.add(id(it)); if (seen.size > 500) seen.remove(seen.first()) }
    fun addFresh(candidates: List<T>) {
        val existing = items.map(id).toMutableSet()
        candidates.filter { id(it) > 0 && id(it) !in seen && existing.add(id(it)) }.forEach { items.addLast(it) }
    }
    fun recycle(candidates: List<T>, current: Long) {
        val unique = candidates.filter { id(it) > 0 }.distinctBy(id)
        items.addAll(unique.filter { id(it) != current }.ifEmpty { unique })
    }
}
