package dev.openclaw.mobile

import android.app.*
import android.content.*
import android.media.*
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.*
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Audio belongs to this private service, never to Gecko or the panel. */
class MusicService : Service() {
    data class State(val title: String = "心动音乐", val artist: String = "", val id: Long = 0, val playing: Boolean = false,
        val busy: Boolean = false, val liked: Boolean = false, val authenticated: Boolean = false,
        val message: String = "点击播放，开启心动模式", val qr: String = "")
    companion object {
        @Volatile var state = State(); private set
        val listeners = CopyOnWriteArraySet<(State) -> Unit>()
        fun send(context: Context, command: String, phone: String = "", code: String = "") {
            val intent = Intent(context, MusicService::class.java).setAction(command).putExtra("phone", phone).putExtra("code", code).putExtra("trackId", state.id)
            if (command in listOf("toggle", "play", "next")) context.startForegroundService(intent) else context.startService(intent)
        }
    }
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private val api = MusicApi()
    private lateinit var vault: MusicVault
    private lateinit var media: MediaSession
    private lateinit var audio: AudioManager
    private var player: MediaPlayer? = null
    @Volatile private var ready = false
    @Volatile private var alive = true
    @Volatile private var generation = 0L
    private var loginGeneration = 0L
    @Volatile private var failures = 0
    private var authenticated = false
    private var playlist = 0L
    private val seeds = mutableListOf<Long>()
    private var seedIndex = 0
    private val queue = HeartQueue<JSONObject> { it.getLong("id") }
    private val liked = mutableSetOf<Long>()
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private val focus by lazy { AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener({ change ->
        if (change != AudioManager.AUDIOFOCUS_GAIN) command("pause")
    }, main).build() }
    private val noisy = object : BroadcastReceiver() { override fun onReceive(context: Context, intent: Intent) { command("pause") } }

    override fun onCreate() {
        super.onCreate(); state = State(); vault = MusicVault(this); api.cookie = vault.load()
        audio = getSystemService(AudioManager::class.java)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("music", "心动音乐", NotificationManager.IMPORTANCE_LOW))
        media = MediaSession(this, "OpenClaw music").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { foreground(); command("play") }
                override fun onPause() { command("pause") }
                override fun onSkipToNext() { foreground(); command("next") }
                override fun onStop() { stopSelf() }
            }); isActive = true
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED)
        else { @Suppress("DEPRECATION") registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)) }
    }
    override fun onBind(intent: Intent): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: "state"
        if (action in listOf("toggle", "play", "next")) foreground()
        if (action == "stop") { stopSelf(); return START_NOT_STICKY }
        command(action, intent?.getStringExtra("phone").orEmpty(), intent?.getStringExtra("code").orEmpty(), intent?.getLongExtra("trackId", 0) ?: 0)
        return START_NOT_STICKY
    }
    private fun emit(value: State) {
        if (!alive) return
        state = value
        main.post { if (alive) { listeners.forEach { it(value) }; updateMedia(value) } }
    }
    private fun command(action: String, phone: String = "", code: String = "", target: Long = state.id) {
        if (!alive) return
        worker.execute {
            if (!alive) return@execute
            emit(state.copy(busy = true))
            try {
                when (action) {
                    "state" -> Unit
                    "pause" -> pause()
                    "logout" -> { loginGeneration++; authenticated = false; api.cookie = ""; vault.clear(); queue.clear(); liked.clear(); seeds.clear(); pause(); emit(State(message = "已退出网易云登录")) }
                    "login" -> login()
                    "sms" -> {
                        require(phone.matches(Regex("[0-9]{6,15}"))) { "请输入手机号码（中国大陆）" }
                        val result = api.call("/api/sms/captcha/sent", JSONObject().put("ctcode", "86").put("secrete", "music_middleuser_pclogin").put("cellphone", phone), true, false)
                        require(result.optInt("code") == 200) { "验证码发送失败或需要风控验证，请使用二维码登录" }
                        emit(state.copy(message = "验证码已发送，请输入短信验证码"))
                    }
                    "smsLogin" -> {
                        require(phone.matches(Regex("[0-9]{6,15}")) && code.matches(Regex("[0-9]{4,8}"))) { "请填写手机号和短信验证码" }
                        val result = api.call("/api/w/login/cellphone", JSONObject().put("type", "1").put("https", "true").put("phone", phone).put("countrycode", "86").put("captcha", code).put("remember", "true").put("secureCaptcha", ""), true, false)
                        require(result.optInt("code") == 200) { "登录未成功，请检查验证码；遇到风控可改用二维码" }
                        acceptLogin(result)
                    }
                    "like" -> {
                        if (target == 0L) return@execute
                        val value = !liked.contains(target)
                        val result = request("/api/radio/like", JSONObject().put("alg", "itembased").put("trackId", target).put("like", value).put("time", "3"), true)
                        require(result.optInt("code") == 200) { "红心同步失败，请重试" }
                        if (value) liked.add(target) else liked.remove(target)
                        if (state.id == target) emit(state.copy(liked = value, message = ""))
                    }
                    "toggle", "play", "next" -> {
                        if (!authenticated && !authenticate()) { login(); return@execute }
                        if (action == "toggle" && state.playing) pause()
                        else if (action != "next" && state.id != 0L && ready) resume()
                        else { failures = 0; next() }
                    }
                }
            } catch (error: Exception) {
                if (api.cookie.isEmpty()) { authenticated = false; vault.clear() }
                if (action in listOf("toggle", "play", "next")) pause()
                // Only our own fixed messages, never upstream URLs/cookies/errors.
                val message = if (error is IllegalArgumentException || error is IllegalStateException) error.message?.takeIf { it.any { c -> c.code > 127 } } else null
                emit(state.copy(authenticated = authenticated, message = message ?: "音乐网络请求失败，请稍后重试"))
            } finally { emit(state.copy(busy = false)); main.post { if (!state.playing) stopForeground(STOP_FOREGROUND_DETACH) } }
        }
    }
    private fun request(path: String, data: JSONObject = JSONObject(), web: Boolean = false) = api.call(path, data, web)
    private fun authenticate(): Boolean {
        if (api.cookie.isEmpty()) return false
        val account = request("/api/w/nuser/account/get", web = true)
        val uid = account.optJSONObject("profile")?.optLong("userId") ?: 0
        if (uid == 0L) { api.cookie = ""; vault.clear(); return false }
        val lists = request("/api/user/playlist", JSONObject().put("uid", uid).put("limit", 100).put("offset", 0).put("includeVideo", true), true).optJSONArray("playlist") ?: JSONArray()
        val list = (0 until lists.length()).map { lists.getJSONObject(it) }.find { it.optInt("specialType") == 5 && it.optJSONObject("creator")?.optLong("userId") == uid }
            ?: error("没有找到红心歌单，请先在网易云喜欢几首歌曲")
        playlist = list.getLong("id")
        val tracks = request("/api/v6/playlist/detail", JSONObject().put("id", playlist).put("n", 100000).put("s", 8)).optJSONObject("playlist")?.optJSONArray("trackIds") ?: JSONArray()
        seeds.clear(); for (i in 0 until tracks.length()) seeds.add(tracks.getJSONObject(i).getLong("id"))
        check(seeds.isNotEmpty()) { "红心歌单为空，请先在网易云喜欢几首歌曲" }
        val likes = request("/api/song/like/get", JSONObject().put("uid", uid))
        check(likes.optInt("code") == 200 && likes.optJSONArray("ids") != null) { "读取红心状态失败，请重试" }
        liked.clear(); likes.getJSONArray("ids").let { for (i in 0 until it.length()) liked.add(it.getLong(i)) }
        authenticated = true; emit(state.copy(authenticated = true, qr = "", message = "已连接网易云 · 心动模式")); return true
    }
    private fun acceptLogin(result: JSONObject) {
        val cookie = result.optString("sessionCookie")
        check(cookie.contains("MUSIC_U=")) { "登录未返回会话，请重新登录" }
        api.cookie = cookie; loginGeneration++
        check(authenticate()) { "登录会话无效，请重试" }
        val saved = vault.save(cookie)
        emit(state.copy(qr = "", message = if (saved) "登录成功，点击播放开启心动模式" else "登录成功；加密保存失败，仅本次会话有效"))
    }
    private fun login() {
        val token = ++loginGeneration
        val key = api.call("/api/login/qrcode/unikey", JSONObject().put("type", 3), authenticated = false).optString("unikey")
        check(key.isNotBlank()) { "二维码获取失败，请重试" }
        emit(state.copy(qr = "https://music.163.com/login?codekey=$key", message = "使用网易云扫码；也可使用短信登录"))
        val deadline = System.currentTimeMillis() + 180000
        fun poll() {
            if (!alive || token != loginGeneration) return
            try {
                val result = api.call("/api/login/qrcode/client/login", JSONObject().put("key", key).put("type", 3), authenticated = false)
                when (result.optInt("code")) {
                    803 -> { acceptLogin(result); return }
                    800 -> { emit(state.copy(qr = "", message = "二维码已过期，请刷新")); return }
                    802 -> emit(state.copy(message = "已扫码，请在网易云确认"))
                }
                if (System.currentTimeMillis() < deadline) worker.schedule({ poll() }, 2500, TimeUnit.MILLISECONDS)
                else emit(state.copy(qr = "", message = "二维码已过期，请刷新"))
            } catch (_: Exception) { emit(state.copy(message = "登录检查失败，请刷新二维码")) }
        }
        worker.schedule({ poll() }, 2500, TimeUnit.MILLISECONDS)
    }
    private fun fill() {
        var recyclable = emptyList<JSONObject>()
        repeat(3) { attempt ->
            val seed = if (attempt == 0 && state.id != 0L) state.id else seeds[seedIndex++ % seeds.size]
            val result = request("/api/playmode/intelligence/list", JSONObject().put("songId", seed).put("type", "fromPlayOne").put("playlistId", playlist).put("startMusicId", seeds.first()).put("count", 30))
            check(result.optInt("code") == 200) { "心动推荐暂不可用，请稍后重试" }
            val list = result.optJSONArray("data") ?: JSONArray()
            recyclable = (0 until list.length()).map { list.getJSONObject(it).optJSONObject("songInfo") ?: list.getJSONObject(it) }.filter { it.optLong("id") > 0 }.distinctBy { it.getLong("id") }
            queue.addFresh(recyclable)
            if (!queue.isEmpty()) return
        }
        queue.recycle(recyclable, state.id)
        check(!queue.isEmpty()) { "暂时没有心动推荐，请稍后重试" }
    }
    private fun next() {
        val token = ++generation
        ready = false; main.post { player?.release(); player = null }
        emit(state.copy(playing = false, message = "正在准备下一首…"))
        repeat(8) {
            if (queue.isEmpty()) fill()
            val song = queue.removeFirst(); val id = song.getLong("id")
            val result = request("/api/song/enhance/player/url", JSONObject().put("ids", "[\"$id\"]").put("br", 128000)).optJSONArray("data")?.optJSONObject(0)
            val raw = result?.optString("url").orEmpty()
            if (result == null || result.optInt("code") != 200 || !result.isNull("freeTrialInfo") || raw.isEmpty()) return@repeat
            val url = android.net.Uri.parse(raw)
            if (url.scheme !in listOf("http", "https")) return@repeat
            val artists = song.optJSONArray("ar") ?: song.optJSONArray("artists") ?: JSONArray()
            emit(state.copy(title = song.optString("name", "未知歌曲"), artist = (0 until artists.length()).joinToString(" / ") { artists.getJSONObject(it).optString("name") }, id = id, liked = id in liked, playing = true, message = "缓冲中…"))
            main.post {
                if (!alive || token != generation) return@post
                foreground()
                if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { command("pause"); return@post }
                try {
                    val fresh = MediaPlayer(); player = fresh
                    fresh.setAudioAttributes(attributes); fresh.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
                    fresh.setOnPreparedListener { if (alive && token == generation && state.playing) { ready = true; fresh.start(); failures = 0; emit(state.copy(message = "")) } }
                    fresh.setOnCompletionListener { mediaEvent(token, false) }
                    fresh.setOnErrorListener { _, _, _ -> mediaEvent(token, true); true }
                    fresh.setDataSource(url.buildUpon().scheme("https").build().toString()); fresh.prepareAsync()
                } catch (_: Exception) { mediaEvent(token, true) }
            }
            if (queue.size < 5) runCatching { fill() }
            return
        }
        error("多首歌曲不可播，已暂停。点击下一首重试")
    }
    private fun mediaEvent(token: Long, failed: Boolean) {
        worker.execute {
            if (!alive || token != generation || !state.playing) return@execute
            try { if (failed) { failures++; check(failures < 8) { "连续歌曲播放失败，已暂停" } }; next() }
            catch (_: Exception) { pause(); emit(state.copy(message = "连续歌曲播放失败，已暂停。请点击下一首重试")) }
        }
    }
    private fun pause() {
        emit(state.copy(playing = false))
        main.post { runCatching { if (ready) player?.pause() }; audio.abandonAudioFocusRequest(focus); stopForeground(STOP_FOREGROUND_DETACH) }
    }
    private fun resume() {
        emit(state.copy(playing = true, message = ""))
        main.post { foreground(); if (audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) runCatching { player?.start() }.onFailure { command("pause") } else command("pause") }
    }
    private fun pending(action: String): PendingIntent = PendingIntent.getService(this, action.hashCode(), Intent(this, MusicService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun notification(): Notification = Notification.Builder(this, "music").setSmallIcon(android.R.drawable.ic_media_play)
        .setContentTitle(state.title).setContentText(if (state.message.isNotBlank()) state.message else state.artist)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(state.playing)
        .addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause, if (state.playing) "暂停" else "播放", pending(if (state.playing) "pause" else "play")).build())
        .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", pending("next")).build())
        .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "停止", pending("stop")).build())
        .setStyle(Notification.MediaStyle().setMediaSession(media.sessionToken).setShowActionsInCompactView(0, 1, 2)).build()
    private fun foreground() { if (alive) startForeground(2401, notification()) }
    private fun updateMedia(value: State) {
        media.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, value.title).putString(MediaMetadata.METADATA_KEY_ARTIST, value.artist).build())
        media.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_STOP)
            .setState(if (value.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (value.playing) 1f else 0f).build())
        if (value.id != 0L) getSystemService(NotificationManager::class.java).notify(2401, notification())
    }
    override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }
    override fun onDestroy() {
        alive = false; generation++; loginGeneration++; worker.shutdownNow(); player?.release(); player = null
        audio.abandonAudioFocusRequest(focus); unregisterReceiver(noisy); media.release(); stopForeground(STOP_FOREGROUND_REMOVE)
        state = State(); listeners.forEach { it(state) }; super.onDestroy()
    }
}
