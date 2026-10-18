(function(){
  'use strict';

  const BreakAlarmManager={
    pipWindow:null,pipRefs:null,pipOpening:null,
    audioCtx:null,mediaKeyAudio:null,mediaKeyBound:false,mediaKeyActive:false,silentMediaUrl:null,
    breakSessionKey:'mando_break_alarm_session_v1',
    breakActive:false,breakDurationMinutes:0,breakStartedEpoch:0,breakEndsEpoch:0,
    breakTicker:null,breakPipTicker:null,breakAlarmBand:'idle',breakSirenTimer:null,breakMenuOpen:false,
    wakeLock:null,wakeLockPip:null,wakeListenersBound:false,bound:false,

    init(){
      if(this.bound)return;
      const host=document.getElementById('MNDO_BREAK_ALARM_HOST');
      if(!host)return;
      const refs={
        host,
        input:null,
        status:document.getElementById('breakStatus'),
        breakBtn:document.getElementById('breakAlarmButton'),
        breakMenu:document.getElementById('breakMenu'),
        breakState:document.getElementById('breakState'),
        breakCustom:document.getElementById('breakCustom'),
        breakStart:document.getElementById('breakStart'),
        breakStop:document.getElementById('breakStop'),
        breakClose:document.getElementById('breakClose'),
        breakPresetButtons:Array.from(host.querySelectorAll('[data-break-minutes]'))
      };
      if(!refs.breakBtn||!refs.breakMenu||!refs.breakCustom||!refs.breakStart||!refs.breakStop)return;

      this.pipRefs=refs;
      this.bindWakeRecovery();

      refs.breakBtn.addEventListener('click',async e=>{
        e.preventDefault();e.stopPropagation();
        this.primeAudio();
        if(this.breakActive&&!this.pipWindow)await this.ensureBreakPipWindow();
        this.renderBreakMenu(refs,!this.breakMenuOpen);
      });
      for(const btn of refs.breakPresetButtons){
        btn.addEventListener('click',()=>this.startBreak(btn.dataset.breakMinutes,refs));
      }
      refs.breakStart.addEventListener('click',()=>this.startBreak(refs.breakCustom.value,refs));
      refs.breakCustom.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();this.startBreak(refs.breakCustom.value,refs);}
      });
      refs.breakStop.addEventListener('click',()=>{
        this.cancelBreak(refs);
        this.renderBreakMenu(refs,false);
      });
      refs.breakClose?.addEventListener('click',()=>this.renderBreakMenu(refs,false));
      document.addEventListener('keydown',e=>{
        if(e.key==='Escape'&&this.breakMenuOpen){
          e.preventDefault();e.stopPropagation();this.renderBreakMenu(refs,false);
        }
      },{capture:true});

      this.bound=true;
      this.loadBreakSession();
      this.renderBreakButton(refs);
      this.updateBreakMenu(refs);
      if(this.breakActive)this.ensureWakeProtection();
    },

    bindWakeRecovery(){
      if(this.wakeListenersBound)return;
      const recover=()=>{if(this.breakActive)this.ensureWakeProtection();};
      document.addEventListener('visibilitychange',recover);
      window.addEventListener('focus',recover);
      window.addEventListener('pageshow',recover);
      this.wakeListenersBound=true;
    },

    normalizeBreakMinutes(value){
      const n=Math.round(Number(value));
      return Number.isFinite(n)?Math.min(720,Math.max(1,n)):0;
    },

    loadBreakSession(){
      try{
        const raw=localStorage.getItem(this.breakSessionKey),obj=raw?JSON.parse(raw):null;
        if(!obj||obj.active!==true)return false;
        const started=Number(obj.startedAt||0),ends=Number(obj.endsAt||0),minutes=this.normalizeBreakMinutes(obj.durationMinutes);
        const now=Date.now();
        if(!minutes||!Number.isFinite(started)||!Number.isFinite(ends)||started<=0||ends<=started||ends>now+12*60*60*1000){
          localStorage.removeItem(this.breakSessionKey);return false;
        }
        if(ends<=now){localStorage.removeItem(this.breakSessionKey);return false;}
        this.breakDurationMinutes=minutes;
        this.breakStartedEpoch=started;
        this.breakEndsEpoch=ends;
        this.breakActive=true;
        this.breakAlarmBand='idle';
        this.ensureBreakTicker();
        this.ensureWakeProtection();
        this.renderBreakEverywhere();
        return true;
      }catch(_){return false;}
    },

    saveBreakSession(){
      try{
        if(!this.breakActive){localStorage.removeItem(this.breakSessionKey);return true;}
        localStorage.setItem(this.breakSessionKey,JSON.stringify({
          active:true,
          durationMinutes:this.breakDurationMinutes,
          startedAt:this.breakStartedEpoch,
          endsAt:this.breakEndsEpoch,
          updatedAt:Date.now()
        }));
        return true;
      }catch(_){return false;}
    },

    breakRemainingNow(){return this.breakActive?Math.max(0,this.breakEndsEpoch-Date.now()):0;},

    breakStage(remaining=this.breakRemainingNow()){
      if(!this.breakActive)return 'idle';
      if(remaining<=0)return 'finished';
      if(remaining<=60000)return 'urgent';
      if(remaining<=120000)return 'warning';
      return 'active';
    },

    formatBreakRemaining(ms=this.breakRemainingNow()){
      const total=Math.max(0,Math.ceil((Number(ms)||0)/1000)),mins=Math.floor(total/60),secs=total%60;
      return String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0');
    },

    async startBreak(minutes,refs=null){
      const duration=this.normalizeBreakMinutes(minutes);
      if(!duration){this.setBreakStatus(refs,'اكتب مدة من 1 إلى 720 دقيقة','bad');return false;}
      this.primeAudio();
      this.setupHardwareMediaReset();
      const now=Date.now();
      this.breakDurationMinutes=duration;
      this.breakStartedEpoch=now;
      this.breakEndsEpoch=now+duration*60000;
      this.breakActive=true;
      this.breakAlarmBand='idle';
      this.breakMenuOpen=false;
      this.saveBreakSession();
      this.ensureBreakTicker();
      await this.ensureBreakPipWindow();
      await this.ensureWakeProtection();
      this.renderBreakEverywhere();
      this.renderBreakMenu(refs||this.pipRefs,false);
      const backgroundProtected=!!(this.wakeLockPip||(this.wakeLock&&document.visibilityState==='visible'));
      this.setBreakStatus(
        refs||this.pipRefs,
        backgroundProtected
          ?'Break '+duration+'m بدأ • حماية الشاشة شغالة'
          :'Break '+duration+'m بدأ • اضغط BREAK لو عايز تفعيل حماية الخلفية',
        backgroundProtected?'ok':'warn'
      );
      return true;
    },

    cancelBreak(refs=null){
      this.breakActive=false;
      this.breakDurationMinutes=0;
      this.breakStartedEpoch=0;
      this.breakEndsEpoch=0;
      this.breakAlarmBand='idle';
      this.stopBreakTicker();
      this.stopBreakSiren();
      this.releaseWakeProtection();
      this.closeBreakPipWindow();
      this.saveBreakSession();
      this.stopHardwareMediaSession();
      this.renderBreakEverywhere();
      this.setBreakStatus(refs||this.pipRefs,'تم إيقاف Break Alarm','warn');
    },

    completeBreak(){
      if(!this.breakActive)return;
      this.breakActive=false;
      this.stopBreakTicker();
      this.stopBreakSiren();
      this.releaseWakeProtection();
      this.closeBreakPipWindow();
      this.saveBreakSession();
      this.stopHardwareMediaSession();
      this.playBreakFinishAlarm();
      this.renderBreakEverywhere();
      this.setBreakStatus(this.pipRefs,'انتهى البريك — ارجع للشغل','bad');
    },

    ensureBreakTicker(){
      if(!this.breakActive)return;
      if(this.pipWindow&&!this.pipWindow.closed){this.ensureBreakPipTicker();return;}
      if(!this.breakTicker)this.breakTicker=setInterval(()=>this.renderBreakEverywhere(),500);
    },

    ensureBreakPipTicker(){
      if(!this.breakActive||!this.pipWindow||this.pipWindow.closed)return;
      if(this.breakTicker){clearInterval(this.breakTicker);this.breakTicker=null;}
      if(this.breakPipTicker)return;
      try{this.breakPipTicker=this.pipWindow.setInterval(()=>this.renderBreakEverywhere(),500);}
      catch(_){this.breakPipTicker=null;}
    },

    stopBreakTicker(){
      if(this.breakTicker){clearInterval(this.breakTicker);this.breakTicker=null;}
      if(this.breakPipTicker){
        try{this.pipWindow?.clearInterval?.(this.breakPipTicker);}catch(_){}
        this.breakPipTicker=null;
      }
    },

    supportsBreakPip(){
      try{return !!window.documentPictureInPicture?.requestWindow;}
      catch(_){return false;}
    },

    buildBreakPip(win){
      try{
        const doc=win.document;
        doc.documentElement.lang='ar';
        doc.documentElement.dir='rtl';
        doc.title='SR Break';
        doc.head.innerHTML='';
        doc.body.innerHTML='';
        const style=doc.createElement('style');
        style.textContent=`
          :root{color-scheme:dark;font-family:Inter,Segoe UI,Tahoma,Arial,sans-serif}
          *{box-sizing:border-box}
          html,body{margin:0;width:100%;height:100%;background:#11151b;color:#f7f8fa;overflow:hidden}
          body{display:flex;align-items:stretch;justify-content:center;padding:8px}
          .srBreakPip{width:100%;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:linear-gradient(155deg,#1a2029,#0f1318);box-shadow:0 10px 28px rgba(0,0,0,.28);padding:9px 11px;display:grid;grid-template-columns:1fr auto;grid-template-areas:'meta actions' 'time actions';gap:2px 10px;align-items:center}
          .srBreakMeta{grid-area:meta;font-size:10px;font-weight:800;letter-spacing:.12em;color:#aeb8c6;text-transform:uppercase;white-space:nowrap}
          .srBreakTime{grid-area:time;font:800 28px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.03em;color:#f8fafc;white-space:nowrap}
          .srBreakActions{grid-area:actions;display:flex;gap:6px;align-items:center}
          button{border:0;border-radius:9px;padding:8px 10px;font-weight:800;cursor:pointer;background:#273140;color:#fff}
          #srBreakPipStop{background:#b52634}
          [data-stage='warning'] .srBreakTime{color:#ffd166}
          [data-stage='urgent'] .srBreakTime{color:#ff6b6b}
        `;
        doc.head.appendChild(style);
        const shell=doc.createElement('div');
        shell.id='srBreakPipShell';
        shell.className='srBreakPip';
        shell.innerHTML=`
          <div class="srBreakMeta">SR BREAK • KEEP AWAKE</div>
          <div id="srBreakPipTime" class="srBreakTime">00:00</div>
          <div class="srBreakActions">
            <button id="srBreakPipBack" type="button" title="الرجوع لتول SR">SR</button>
            <button id="srBreakPipStop" type="button" title="إيقاف البريك">Stop</button>
          </div>
        `;
        doc.body.appendChild(shell);
        doc.getElementById('srBreakPipBack')?.addEventListener('click',()=>{try{window.focus();}catch(_){}});
        doc.getElementById('srBreakPipStop')?.addEventListener('click',()=>this.cancelBreak(this.pipRefs));
        return true;
      }catch(_){return false;}
    },

    renderBreakPip(){
      const win=this.pipWindow;
      if(!win||win.closed)return;
      try{
        const doc=win.document,time=doc.getElementById('srBreakPipTime'),shell=doc.getElementById('srBreakPipShell');
        if(time)time.textContent=this.breakActive?this.formatBreakRemaining():'00:00';
        if(shell)shell.dataset.stage=this.breakStage();
      }catch(_){}
    },

    handleBreakPipClosed(win){
      if(this.pipWindow!==win)return;
      if(this.breakPipTicker){
        try{win.clearInterval(this.breakPipTicker);}catch(_){}
        this.breakPipTicker=null;
      }
      const lock=this.wakeLockPip;this.wakeLockPip=null;
      try{lock?.release?.();}catch(_){}
      this.pipWindow=null;
      this.pipOpening=null;
      if(this.breakActive){
        this.ensureBreakTicker();
        this.ensureWakeProtection();
        this.setBreakStatus(this.pipRefs,'البريك شغال • افتح BREAK لإرجاع حماية الخلفية','warn');
      }
      this.renderBreakEverywhere();
    },

    closeBreakPipWindow(){
      const win=this.pipWindow;
      if(!win)return;
      if(this.breakPipTicker){
        try{win.clearInterval(this.breakPipTicker);}catch(_){}
        this.breakPipTicker=null;
      }
      this.pipWindow=null;
      this.pipOpening=null;
      try{win.close();}catch(_){}
    },

    async ensureBreakPipWindow(){
      if(!this.breakActive)return false;
      const existing=this.pipWindow;
      if(existing&&!existing.closed){
        this.ensureBreakPipTicker();
        await this.requestWakeLock(existing,'wakeLockPip');
        this.renderBreakPip();
        return true;
      }
      if(!this.supportsBreakPip())return false;
      if(this.pipOpening)return this.pipOpening;
      const activation=navigator.userActivation;
      if(activation&&activation.isActive===false)return false;

      this.pipOpening=(async()=>{
        try{
          const win=await window.documentPictureInPicture.requestWindow({width:240,height:116});
          if(!this.breakActive){try{win.close();}catch(_){}return false;}
          this.pipWindow=win;
          this.buildBreakPip(win);
          const onClosed=()=>this.handleBreakPipClosed(win);
          win.addEventListener('pagehide',onClosed,{once:true});
          win.addEventListener('unload',onClosed,{once:true});
          this.ensureBreakPipTicker();
          await this.requestWakeLock(win,'wakeLockPip');
          this.renderBreakPip();
          return true;
        }catch(_){return false;}
        finally{this.pipOpening=null;}
      })();
      return this.pipOpening;
    },

    async requestWakeLock(targetWindow=window,slot='wakeLock'){
      try{
        const nav=targetWindow?.navigator,doc=targetWindow?.document;
        if(!this.breakActive||!nav?.wakeLock?.request)return false;
        if(doc?.visibilityState&&doc.visibilityState!=='visible')return false;
        const current=this[slot];
        if(current&&!current.released)return true;
        const lock=await nav.wakeLock.request('screen');
        if(!this.breakActive){try{await lock.release();}catch(_){}return false;}
        this[slot]=lock;
        lock.addEventListener('release',()=>{
          if(this[slot]===lock)this[slot]=null;
          if(this.breakActive)setTimeout(()=>this.ensureWakeProtection(),350);
        },{once:true});
        return true;
      }catch(_){return false;}
    },

    async ensureWakeProtection(){
      if(!this.breakActive)return false;
      const tasks=[];
      if(document.visibilityState==='visible')tasks.push(this.requestWakeLock(window,'wakeLock'));
      const win=this.pipWindow;
      if(win&&!win.closed)tasks.push(this.requestWakeLock(win,'wakeLockPip'));
      this.startHardwareMediaSession();
      if(tasks.length)await Promise.allSettled(tasks);
      this.renderBreakEverywhere();
      return !!(this.wakeLock||this.wakeLockPip||this.mediaKeyActive);
    },

    releaseWakeProtection(){
      for(const slot of ['wakeLock','wakeLockPip']){
        const lock=this[slot];this[slot]=null;
        try{lock?.release?.();}catch(_){}
      }
    },

    wakeProtectionLabel(){
      if(this.wakeLockPip)return 'Background Wake Lock ON';
      if(this.wakeLock)return 'Wake Lock ON';
      if(this.mediaKeyActive)return 'Keep-awake fallback ON';
      return 'Wake protection pending';
    },

    silentWavUrl(){
      if(this.silentMediaUrl)return this.silentMediaUrl;
      try{
        const sampleRate=8000,samples=sampleRate,bytes=44+samples*2;
        const buffer=new ArrayBuffer(bytes),view=new DataView(buffer);
        const write=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
        write(0,'RIFF');view.setUint32(4,36+samples*2,true);write(8,'WAVE');write(12,'fmt ');
        view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
        view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
        view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,samples*2,true);
        this.silentMediaUrl=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
        return this.silentMediaUrl;
      }catch(_){return '';}
    },

    timerMode(){return 'break';},
    restartTimer(){},

    updateMediaMetadata(){
      try{
        if(!('mediaSession' in navigator)||!('MediaMetadata' in window))return false;
        navigator.mediaSession.metadata=new MediaMetadata({title:'SR Break Timer',artist:'SR Tool',album:'Break Alarm'});
        return true;
      }catch(_){return false;}
    },

    setupHardwareMediaReset(){
      try{
        if(!('mediaSession' in navigator))return false;
        if(!this.mediaKeyAudio){
          const a=document.createElement('audio');
          a.setAttribute('aria-hidden','true');
          a.preload='auto';a.loop=true;a.playsInline=true;
          a.src=this.silentWavUrl();
          a.style.display='none';
          document.body.appendChild(a);
          this.mediaKeyAudio=a;
        }
        if(!this.mediaKeyBound){
          this.updateMediaMetadata();
          const keepAlive=()=>{this.startHardwareMediaSession();};
          try{navigator.mediaSession.setActionHandler('nexttrack',()=>{this.restartTimer();this.startHardwareMediaSession();});}catch(_){}
          try{navigator.mediaSession.setActionHandler('play',keepAlive);}catch(_){}
          try{navigator.mediaSession.setActionHandler('pause',keepAlive);}catch(_){}
          try{navigator.mediaSession.setActionHandler('stop',keepAlive);}catch(_){}
          this.mediaKeyBound=true;
        }
        return this.startHardwareMediaSession();
      }catch(_){return false;}
    },

    startHardwareMediaSession(){
      try{
        if(!this.mediaKeyAudio||!('mediaSession' in navigator))return false;
        const p=this.mediaKeyAudio.play();
        this.mediaKeyActive=true;
        try{navigator.mediaSession.playbackState='playing';}catch(_){}
        if(p&&typeof p.catch==='function')p.catch(()=>{this.mediaKeyActive=false;});
        return true;
      }catch(_){this.mediaKeyActive=false;return false;}
    },

    stopHardwareMediaSession(){
      try{
        if(this.mediaKeyAudio){this.mediaKeyAudio.pause();this.mediaKeyAudio.currentTime=0;}
      }catch(_){}
      try{if('mediaSession' in navigator)navigator.mediaSession.playbackState='none';}catch(_){}
      this.mediaKeyActive=false;
    },

    primeAudio(){
      try{
        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC)return false;
        if(!this.audioCtx)this.audioCtx=new AC();
        if(this.audioCtx.state==='suspended')this.audioCtx.resume().catch(()=>{});
        return true;
      }catch(_){return false;}
    },

    playSirenPulse(level='warning'){
      try{
        if(!this.primeAudio()||!this.audioCtx)return false;
        const ctx=this.audioCtx,now=ctx.currentTime,finish=level==='finish',urgent=level==='urgent'||finish;
        if(!urgent){
          const duration=.46,osc=ctx.createOscillator(),gain=ctx.createGain();
          osc.type='triangle';
          osc.frequency.setValueAtTime(720,now);
          osc.frequency.linearRampToValueAtTime(980,now+duration*.48);
          osc.frequency.linearRampToValueAtTime(760,now+duration);
          gain.gain.setValueAtTime(.0001,now);
          gain.gain.exponentialRampToValueAtTime(.12,now+.025);
          gain.gain.setValueAtTime(.12,now+duration*.78);
          gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
          osc.connect(gain);gain.connect(ctx.destination);osc.start(now);osc.stop(now+duration+.02);
          return true;
        }

        const melody=finish
          ?[1046.5,1318.51,1567.98,2093,1567.98,1318.51,1760,2093]
          :[880,1108.73,1318.51,1108.73,987.77,1244.51,1479.98,1244.51];
        const step=finish?.145:.17,noteLen=finish?.33:.30;
        const duration=(melody.length-1)*step+noteLen;
        const master=ctx.createGain(),saturator=ctx.createWaveShaper(),compressor=ctx.createDynamicsCompressor(),post=ctx.createGain(),delay=ctx.createDelay(.25),echo=ctx.createGain();
        const curve=new Float32Array(1024);
        for(let i=0;i<curve.length;i++){
          const x=i*2/(curve.length-1)-1;
          curve[i]=Math.tanh((finish?4.2:3.3)*x);
        }
        saturator.curve=curve;saturator.oversample='4x';
        master.gain.setValueAtTime(.0001,now);
        master.gain.exponentialRampToValueAtTime(finish?1.85:1.48,now+.010);
        master.gain.setValueAtTime(finish?1.85:1.48,now+duration-.045);
        master.gain.exponentialRampToValueAtTime(.0001,now+duration);
        compressor.threshold.setValueAtTime(finish?-34:-29,now);
        compressor.knee.setValueAtTime(4,now);
        compressor.ratio.setValueAtTime(finish?20:14,now);
        compressor.attack.setValueAtTime(.0015,now);
        compressor.release.setValueAtTime(.075,now);
        post.gain.setValueAtTime(.98,now);
        delay.delayTime.setValueAtTime(finish?.067:.078,now);
        echo.gain.setValueAtTime(finish?.11:.09,now);
        master.connect(saturator);
        master.connect(delay);
        delay.connect(echo);
        echo.connect(saturator);
        saturator.connect(compressor);
        compressor.connect(post);
        post.connect(ctx.destination);

        const addTone=(freq,t,len,level)=>{
          const body=ctx.createOscillator(),bodyGain=ctx.createGain();
          body.type='triangle';
          body.frequency.setValueAtTime(freq,t);
          body.frequency.exponentialRampToValueAtTime(freq*.994,t+len);
          bodyGain.gain.setValueAtTime(.0001,t);
          bodyGain.gain.exponentialRampToValueAtTime(level,t+.009);
          bodyGain.gain.setValueAtTime(level*.86,t+len*.28);
          bodyGain.gain.exponentialRampToValueAtTime(level*.52,t+len*.68);
          bodyGain.gain.exponentialRampToValueAtTime(.0001,t+len);
          body.connect(bodyGain);bodyGain.connect(master);body.start(t);body.stop(t+len+.015);

          const warm=ctx.createOscillator(),warmGain=ctx.createGain();
          warm.type='sine';warm.frequency.setValueAtTime(freq*.5,t);
          warmGain.gain.setValueAtTime(.0001,t);
          warmGain.gain.exponentialRampToValueAtTime(level*(finish?.42:.34),t+.012);
          warmGain.gain.exponentialRampToValueAtTime(.0001,t+len*.95);
          warm.connect(warmGain);warmGain.connect(master);warm.start(t);warm.stop(t+len+.015);

          const presence=ctx.createOscillator(),presenceGain=ctx.createGain();
          presence.type='sine';presence.frequency.setValueAtTime(freq*1.5,t);
          presenceGain.gain.setValueAtTime(.0001,t);
          presenceGain.gain.exponentialRampToValueAtTime(level*(finish?.25:.20),t+.006);
          presenceGain.gain.exponentialRampToValueAtTime(.0001,t+len*.72);
          presence.connect(presenceGain);presenceGain.connect(master);presence.start(t);presence.stop(t+len+.012);

          const shimmer=ctx.createOscillator(),shimmerGain=ctx.createGain();
          shimmer.type='sine';shimmer.frequency.setValueAtTime(freq*2,t);
          shimmerGain.gain.setValueAtTime(.0001,t);
          shimmerGain.gain.exponentialRampToValueAtTime(level*(finish?.18:.13),t+.005);
          shimmerGain.gain.exponentialRampToValueAtTime(.0001,t+len*.58);
          shimmer.connect(shimmerGain);shimmerGain.connect(master);shimmer.start(t);shimmer.stop(t+len+.012);
        };

        melody.forEach((freq,i)=>addTone(
          freq,
          now+i*step,
          noteLen,
          finish?((i===3||i===7)?.56:.49):((i===2||i===6)?.45:.39)
        ));
        return true;
      }catch(_){return false;}
    },

    startBreakSiren(level){
      if(level!=='warning'&&level!=='urgent'){this.stopBreakSiren();return;}
      if(this.breakAlarmBand===level&&this.breakSirenTimer)return;
      this.stopBreakSiren(false);
      this.breakAlarmBand=level;
      const tick=()=>{
        if(!this.breakActive||this.breakStage()!==level){this.stopBreakSiren();return;}
        this.playSirenPulse(level);
        const timerHost=this.pipWindow&&!this.pipWindow.closed?this.pipWindow:window;
        this.breakSirenTimer=timerHost.setTimeout(tick,level==='urgent'?1360:1250);
      };
      tick();
    },

    stopBreakSiren(resetBand=true){
      if(this.breakSirenTimer){
        try{clearTimeout(this.breakSirenTimer);}catch(_){}
        try{this.pipWindow?.clearTimeout?.(this.breakSirenTimer);}catch(_){}
        this.breakSirenTimer=null;
      }
      if(resetBand)this.breakAlarmBand='idle';
    },

    playBreakFinishAlarm(){
      this.primeAudio();
      let count=0;
      const ring=()=>{
        if(count++>=4)return;
        this.playSirenPulse('finish');
        setTimeout(ring,1120);
      };
      ring();
    },

    syncBreakAlarm(){
      if(!this.breakActive){this.stopBreakSiren();return;}
      const remaining=this.breakRemainingNow();
      if(remaining<=0){this.completeBreak();return;}
      const stage=this.breakStage(remaining);
      if(stage==='urgent')this.startBreakSiren('urgent');
      else if(stage==='warning')this.startBreakSiren('warning');
      else this.stopBreakSiren();
    },

    renderBreakButton(refs=this.pipRefs){
      const btn=refs?.breakBtn;
      if(!btn)return;
      const stage=this.breakStage(),remaining=this.breakRemainingNow();
      btn.classList.remove('active','warning','urgent');
      if(stage==='active')btn.classList.add('active');
      else if(stage==='warning')btn.classList.add('warning');
      else if(stage==='urgent')btn.classList.add('urgent');
      btn.setAttribute('aria-pressed',this.breakActive?'true':'false');
      btn.title=this.breakActive
        ?'Break '+this.formatBreakRemaining(remaining)+' • اضغط للإدارة أو الإيقاف • '+this.wakeProtectionLabel()
        :'Break Alarm • اضغط لاختيار 15 / 30 / Custom بدون تكبير النافذة';
      btn.setAttribute('aria-label',btn.title);
      // Keep the compact Break icon static; remaining time stays accessible via menu/tooltip.
      const glyph=btn.querySelector('.breakGlyph');
      if(glyph)glyph.textContent='🚨';
    },

    renderBreakEverywhere(){
      this.syncBreakAlarm();
      this.renderBreakButton(this.pipRefs);
      this.renderBreakPip();
      if(this.breakMenuOpen)this.updateBreakMenu(this.pipRefs);
    },

    setExternalStatus(refs,msg,type=''){
      if(refs?.status){
        refs.status.textContent=msg;
        refs.status.className='status'+(type?' '+type:'');
      }
    },

    setBreakStatus(refs,msg,type=''){this.setExternalStatus(refs,msg,type);},

    renderBreakMenu(refs=this.pipRefs,open=!this.breakMenuOpen){
      if(!refs?.breakMenu)return;
      this.breakMenuOpen=!!open;
      refs.breakMenu.hidden=!this.breakMenuOpen;
      refs.breakBtn?.setAttribute('aria-expanded',this.breakMenuOpen?'true':'false');
      this.updateBreakMenu(refs);
      if(!this.breakMenuOpen){
        setTimeout(()=>{try{refs.input?.focus?.();}catch(_){}},0);
        return;
      }
      if(!this.breakActive){
        setTimeout(()=>{try{refs.breakCustom?.focus?.();refs.breakCustom?.select?.();}catch(_){}},0);
      }else{
        setTimeout(()=>{try{refs.breakStop?.focus?.();}catch(_){}},0);
      }
    },

    updateBreakMenu(refs=this.pipRefs){
      if(!refs?.breakMenu)return;
      const rem=this.breakRemainingNow(),stage=this.breakStage();
      refs.breakMenu.classList.toggle('is-active',this.breakActive);
      refs.breakMenu.dataset.stage=stage;
      if(refs.breakState){
        refs.breakState.textContent=this.breakActive?this.formatBreakRemaining(rem):'اختار مدة';
        refs.breakState.dataset.stage=stage;
        refs.breakState.title=this.breakActive?this.wakeProtectionLabel():'15 / 30 / Custom';
      }
      if(refs.breakStop){
        refs.breakStop.hidden=!this.breakActive;
        refs.breakStop.title=this.breakActive?'إيقاف البريك الحالي':'';
      }
      for(const b of refs.breakPresetButtons||[])b.disabled=this.breakActive;
      if(refs.breakStart)refs.breakStart.disabled=this.breakActive;
      if(refs.breakCustom)refs.breakCustom.disabled=this.breakActive;
    }
  };

  window.__MNDO_BREAK_ALARM__=BreakAlarmManager;

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>BreakAlarmManager.init(),{once:true});
  }else{
    BreakAlarmManager.init();
  }
})();