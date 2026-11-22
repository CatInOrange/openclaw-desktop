'use strict';
// Queue lifetime is independent of the Control UI, panel visibility and playback count.
class MusicController {
  constructor({api, vault, onChange = () => {}, loginInterval = 2500}) {
    this.api = api; this.vault = vault; this.onChange = onChange; this.loginInterval = loginInterval;
    this.cookie = vault.load(); this.queue = []; this.seen = new Set(); this.liked = new Set();
    this.state = {authenticated:false, playing:false, busy:false, track:null, token:0, message:'点击播放，开启心动模式', qr:'', expanded:false};
    this.chain = Promise.resolve(); this.stopped = false; this.failures = 0; this.generation = 0;
  }
  emit(patch = {}) {if (this.stopped) return; Object.assign(this.state, patch); this.onChange({...this.state, track:this.state.track && {...this.state.track}});}
  async request(name, args = {}) {
    const body = await this.api.call(name, {...args, cookie:this.cookie});
    if (body?.code === 301 || body?.code === 302) {
      this.cookie = ''; this.vault.clear(); this.emit({authenticated:false, playing:false, message:'登录已过期，请重新扫码。'});
      throw new Error('登录已过期，请重新扫码。');
    }
    return body;
  }
  command(action, token) {
    if (action === 'panel') {this.emit({expanded:!this.state.expanded}); return Promise.resolve();}
    const task = this.chain.then(async () => {
      if (this.stopped) return;
      if (['ended','failed','playing','blocked'].includes(action) && token !== this.state.token) return;
      if (action === 'playing') {this.failures = 0; return;}
      if (action === 'blocked') {this.emit({playing:false, message:'音频未能开始播放，请点击播放重试。'}); return;}
      this.emit({busy:true});
      try {
        if (action === 'login') {await this.login(); return;}
        if (action === 'logout') {this.logout(); return;}
        if (!this.state.authenticated && !await this.authenticate()) {await this.login(); return;}
        if (action === 'toggle') {
          if (this.state.track) this.emit({playing:!this.state.playing, message:''});
          else {this.failures = 0; await this.next();}
        } else if (action === 'next' || action === 'ended' || action === 'failed') {
          if (action === 'next') this.failures = 0;
          if (action === 'failed' && ++this.failures >= 8) throw new Error('连续歌曲播放失败，已暂停。请检查网络后点击下一首重试。');
          await this.next();
        } else if (action === 'like' && this.state.track) {
          const id = this.state.track.id, value = !this.liked.has(id);
          const result = await this.request('like',{id,like:String(value)});
          if(result.code !== 200) throw new Error('红心同步失败，请重试。');
          if(value) this.liked.add(id); else this.liked.delete(id);
          this.emit({track:{...this.state.track,liked:value},message:''});
        }
      } catch(error) {this.emit({playing:['next','ended','failed','toggle'].includes(action) ? false : this.state.playing, message:error.message || '音乐请求失败，请重试。'});}
      finally {this.emit({busy:false});}
    });
    this.chain = task.catch(() => {}); return task;
  }
  async authenticate() {
    const generation = this.generation;
    if (!this.cookie) return false;
    const result = await this.request('login_status');
    const uid = result.data?.profile?.userId;
    if (!uid) {this.cookie = ''; this.vault.clear(); return false;}
    const lists = await this.request('user_playlist', {uid,limit:100});
    const list = lists.playlist?.find(p => p.specialType === 5 && Number(p.creator?.userId) === Number(uid));
    if(!list) throw new Error('没有找到红心歌单，请先在网易云喜欢几首歌曲。');
    const detail = await this.request('playlist_detail',{id:list.id});
    const seeds = detail.playlist?.trackIds?.map(x=>x.id).filter(Boolean) || [];
    if (!seeds.length) throw new Error('红心歌单为空，请先在网易云喜欢几首歌曲。');
    const likes = await this.request('likelist',{uid});
    if(likes.code !== 200 || !Array.isArray(likes.ids)) throw new Error('读取红心状态失败，请重试。');
    if (generation !== this.generation || this.stopped) return false;
    this.uid = uid; this.playlist = list.id; this.seeds = seeds; this.seedIndex = 0; this.liked = new Set(likes.ids);
    this.emit({authenticated:true, qr:'',message:'已连接网易云 · 心动模式'}); return true;
  }
  async login() {
    clearTimeout(this.loginTimer);
    const generation = ++this.generation;
    const result = await this.api.call('login_qr_key',{});
    const key = result.data?.unikey;
    if(!key) throw new Error('登录二维码获取失败，请重试。');
    const qr = await this.api.call('login_qr_create',{key,qrimg:true});
    if (!qr.data?.qrimg?.startsWith('data:image/png;base64,')) throw new Error('二维码生成失败。');
    if (generation !== this.generation || this.stopped) return;
    this.emit({expanded:true,qr:qr.data.qrimg,message:'请用网易云音乐 App 扫码确认'});
    const poll = async () => {
      if (this.stopped || generation !== this.generation) return;
      try {
        const result = await this.api.call('login_qr_check',{key});
        if (this.stopped || generation !== this.generation) return;
        if(result.code === 803 && result.cookie) {
          this.cookie = result.cookie;
          let saved = false; try {saved = this.vault.save(this.cookie);} catch {}
          const authenticated = await this.authenticate();
          if (generation !== this.generation || this.stopped) return;
          if (!authenticated) throw new Error('Account unavailable');
          this.emit({qr:'', message:saved ? '登录成功，点击播放开启心动模式' : '登录成功；本机加密不可用或保存失败，本次会话有效。'}); return;
        }
        if(result.code === 800) {this.emit({qr:'',message:'二维码已过期，请点击重新登录。'}); return;}
        this.emit({message:result.code === 802 ? '已扫码，请在手机上确认' : '请用网易云音乐 App 扫码确认'});
      } catch {this.emit({message:'登录检查失败，请点击重新登录。'}); return;}
      this.loginTimer = setTimeout(poll, this.loginInterval);
    };
    this.loginTimer = setTimeout(poll, this.loginInterval);
  }
  async fill() {
    if (this.filling) return this.filling;
    const generation = this.generation;
    this.filling = (async () => {
      let recyclable = [];
      for(let attempt=0;attempt<3;attempt++) {
        const seed = attempt === 0 && this.state.track ? this.state.track.id : this.seeds[this.seedIndex++ % this.seeds.length];
        const result = await this.request('playmode_intelligence_list',{id:seed,pid:this.playlist,sid:this.seeds[0],count:30});
        if (generation !== this.generation || this.stopped) return;
        if(result.code !== 200 || !Array.isArray(result.data)) throw new Error('心动推荐暂不可用，请稍后重试。');
        const candidates = result.data.map(x=>x.songInfo || x).filter(x=>Number.isSafeInteger(x.id));
        if(candidates.length) recyclable = candidates;
        const existing = new Set(this.queue.map(x=>x.id));
        const fresh = result.data.map(x=>x.songInfo || x).filter(x=>Number.isSafeInteger(x.id) && !existing.has(x.id) && !this.seen.has(x.id));
        for(const song of fresh) {if(existing.has(song.id)) continue; existing.add(song.id); this.queue.push(song);}
        if(this.queue.length) return;
      }
      // A finite recommendation pool is not an end-of-playback signal. Prefer
      // unseen songs, then recycle the server's own recommendations (never FM).
      const unique = [...new Map(recyclable.map(x=>[x.id,x])).values()];
      const alternatives = unique.filter(x=>x.id !== this.state.track?.id);
      this.queue.push(...(alternatives.length ? alternatives : unique));
      if(!this.queue.length) throw new Error('暂时没有心动推荐，请稍后点击下一首重试。');
    })();
    try {await this.filling;} finally {this.filling = null;}
  }
  async next() {
    // Invalidate old media events before awaiting I/O. Stop the previous track immediately.
    this.emit({playing:false,token:this.state.token+1,message:'正在准备下一首…'});
    for(let attempt=0;attempt<8;attempt++) {
      if(!this.queue.length) await this.fill();
      const song = this.queue.shift(); if(!song) break;
      this.seen.add(song.id); if(this.seen.size>500) this.seen.delete(this.seen.values().next().value);
      let info = song;
      try {
        if(!info.name) {const detail = await this.request('song_detail',{ids:String(song.id)}); info = detail.songs?.[0] || song;}
        const result = await this.request('song_url',{id:song.id,br:128000});
        const entry = result.data?.[0];
        if(!entry?.url || entry.code !== 200 || entry.freeTrialInfo) continue;
        const url = new URL(entry.url);
        if (!['http:','https:'].includes(url.protocol)) continue;
        if(url.protocol === 'http:') url.protocol = 'https:';
        this.emit({track:{id:song.id,name:info.name || '未知歌曲',artist:(info.ar || info.artists || []).map(x=>x.name).join(' / '),url:url.href,liked:this.liked.has(song.id)},playing:true,message:''});
        // Refill before exhaustion, without interrupting the current song on a transient error.
        if(this.queue.length<5) void this.fill().catch(()=>{});
        return;
      } catch(error) {if(!this.cookie) throw error;}
    }
    throw new Error('多首歌曲不可播或网络异常，已暂停。点击下一首可重试。');
  }
  logout() {
    ++this.generation; clearTimeout(this.loginTimer); this.cookie='';this.vault.clear();this.queue=[];this.seen.clear();this.liked.clear();
    this.emit({authenticated:false,playing:false,track:null,qr:'',token:this.state.token+1,message:'已退出网易云登录'});
  }
  stop() {this.stopped=true;++this.generation;clearTimeout(this.loginTimer);this.api.stop?.();}
}
module.exports = {MusicController};
