import { TableView, TABLE, type Aim } from '../../view/table.ts';
import { RULES, pieceSpec } from '../../core/rules.ts';
import type { GameEvent, MatchState } from '../../core/types.ts';
const S = TABLE.w / RULES.width;
const pos = (x:number,y:number) => ({x:TABLE.x+x*S,y:TABLE.y+y*S});
interface Mark {x:number;y:number;nx:number;ny:number;age:number;power:boolean;strength:number;metal:boolean}
interface Trace {id:number;age:number;power:boolean;points:{x:number;y:number}[]}
class InkView {
  shaking = true; effects = true;
  private base:TableView; private ctx:CanvasRenderingContext2D;
  private traces:Trace[]=[]; private marks:Mark[]=[]; private drops:{x:number;y:number;age:number}[]=[];
  private powered:number|null=null; private preparation={id:null as number|null,power:0,armed:false};
  private reduced=typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(canvas:HTMLCanvasElement) {this.base=new TableView(canvas);this.base.effects=false;this.base.shaking=false;this.ctx=canvas.getContext('2d')!;}
  point(x:number,y:number){return this.base.point(x,y);}
  setPreparation(id:number|null,power:number,armed:boolean){this.preparation={id,power:Math.max(0,Math.min(1,power)),armed};}
  clear(){this.base.clear();this.traces=[];this.marks=[];this.drops=[];this.powered=null;this.setPreparation(null,0,false);}
  receive(events:GameEvent[], previous:MatchState){
    this.base.receive(this.effects ? events : events.filter(e=>e.kind!=='removed'),previous);
    const latest=Math.max(previous.tick,...events.map(e=>e.tick));
    for(const e of events){
      const age=Math.max(0,(latest-e.tick)*RULES.dt);
      if(e.kind==='shot'){
        const s=previous.stones.find(s=>s.id===e.stoneId);this.powered=e.skill==='power'?e.stoneId:null;
        if(s)this.traces.push({id:s.id,age,power:e.skill==='power',points:[pos(s.x,s.y)]});
      } else if(e.kind==='hit'||e.kind==='hinge-hit'){
        const a=previous.stones.find(s=>s.id===(e.kind==='hit'?e.a:e.stoneId));
        const b=e.kind==='hit'?previous.stones.find(s=>s.id===e.b):undefined;
        let nx=b&&a?b.x-a.x:a?e.x-a.x:0,ny=b&&a?b.y-a.y:a?e.y-a.y:1;
        const l=Math.hypot(nx,ny)||1;nx/=l;ny/=l;
        const power=this.powered!==null&&(e.kind==='hit'?(e.a===this.powered||e.b===this.powered):e.stoneId===this.powered);
        if(e.strength>.06)this.marks.push({...pos(e.x,e.y),nx,ny,age,power,strength:e.strength,metal:e.kind==='hinge-hit'});
        if(power)this.powered=null;
        if(e.strength>.25)for(const s of [a,b])if(s&&!this.traces.some(t=>t.id===s.id))this.traces.push({id:s.id,age,power,points:[pos(s.x,s.y)]});
      } else if(e.kind==='removed'){this.drops.push({...pos(e.x,e.y),age});if(e.stoneId===this.powered)this.powered=null;}
      else if(e.kind==='turn-ended')this.powered=null;
    }
  }
  render(state:MatchState,dt:number,selected:number|null,aim:Aim|null,previous?:MatchState,alpha=1){
    if(!this.effects)this.base.clear();
    this.base.render(state,dt,selected,aim,previous,alpha);
    for(const t of this.traces){t.age+=dt;const s=state.stones.find(s=>s.id===t.id&&s.alive);if(s){const old=previous?.stones.find(o=>o.id===s.id);const p=old?pos(old.x+(s.x-old.x)*alpha,old.y+(s.y-old.y)*alpha):pos(s.x,s.y);const last=t.points.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>2)t.points.push(p);if(t.points.length>28)t.points.shift();}}
    this.traces=this.traces.filter(t=>t.age<(t.power?.52:.23));this.marks.forEach(m=>m.age+=dt);this.marks=this.marks.filter(m=>m.age<(m.power?.38:.15));this.drops.forEach(d=>d.age+=dt);this.drops=this.drops.filter(d=>d.age<.45);
    if(!this.effects)return;
    const c=this.ctx;c.save();
    // Every overlay excludes actual stone silhouettes: the physical position stays legible.
    c.beginPath();c.rect(0,0,TABLE.width,TABLE.height);
    for(const s of state.stones.filter(s=>s.alive)){const old=previous?.stones.find(o=>o.id===s.id);const p=old?pos(old.x+(s.x-old.x)*alpha,old.y+(s.y-old.y)*alpha):pos(s.x,s.y);const r=pieceSpec(s.kind).radius*S+3;c.moveTo(p.x+r,p.y);c.arc(p.x,p.y,r,0,Math.PI*2);}
    c.clip('evenodd');
    if(!this.reduced)for(const t of this.traces){const life=t.power?.52:.23;c.globalAlpha=Math.max(0,1-t.age/life)*.8;
      for(let i=1;i<t.points.length;i++){const a=t.points[i-1],b=t.points[i],f=i/t.points.length;c.strokeStyle='#251e1b';c.lineCap='butt';c.lineWidth=(t.power?25:5)*(0.15+f*.85);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();if(t.power){c.strokeStyle='#efdbb5';c.lineWidth=2;c.beginPath();c.moveTo(a.x+3,a.y+2);c.lineTo(b.x+3,b.y+2);c.stroke();}}
    }
    for(const m of this.marks){const life=m.power?.38:.15,t=m.age/life,span=(m.power?42:12)*(.3+m.strength*.7);c.save();c.translate(m.x,m.y);c.rotate(Math.atan2(m.ny,m.nx));c.globalAlpha=(1-t)*(.4+m.strength*.6);
      c.strokeStyle=m.metal?'#f5f4df':'#fff0d0';c.lineWidth=m.power?13:4;c.beginPath();c.moveTo(-3,-span);c.lineTo(3,span);c.stroke();
      c.strokeStyle='#241d19';c.lineWidth=m.power?6:2;c.beginPath();c.moveTo(4,-span*.95);c.lineTo(7,span*.95);c.stroke();
      if(m.power&&!this.reduced)for(const side of [-1,1]){const drift=8+t*23;c.fillStyle='#30221d';c.beginPath();c.moveTo(-7,side*(span+drift));c.lineTo(5,side*(span+drift+17*(1-t)));c.lineTo(2,side*(span+drift+2));c.closePath();c.fill();}c.restore();}
    c.globalAlpha=1;
    if(state.phase==='aiming'&&this.preparation.id!==null){const s=state.stones.find(s=>s.id===this.preparation.id);if(s){const p=pos(s.x,s.y),r=pieceSpec(s.kind).radius*S,armed=this.preparation.armed,q=this.preparation.power;const angle=aim?Math.atan2(s.y-aim.y,s.x-aim.x):-Math.PI/2;c.save();c.translate(p.x,p.y);c.rotate(angle);c.strokeStyle='#29201b';c.lineCap='butt';
      for(let j=0;j<(armed?3:1);j++){c.lineWidth=armed?(j===0?10:3):3;const gap=r+13+j*12+(1-q)*18;for(const side of [-1,1]){c.beginPath();c.moveTo(-r*.8-16*(1-q),side*(gap+10));c.quadraticCurveTo(-r*.4,side*gap,r*.48,side*(gap-5));c.stroke();}}c.restore();}}
    for(const d of this.drops){c.globalAlpha=1-d.age/.45;c.fillStyle='#33241c';for(let j=0;j<3;j++){const y=d.y+12+j*14+d.age*45;c.fillRect(d.x-2,y,4,Math.max(1,9-j*2));}}
    c.restore();
  }
}
class InkAudio {
  private active=false;private ctx?:AudioContext;private bus?:GainNode;private voices=new Set<AudioScheduledSourceNode>();private powered:number|null=null;private lastHit=-Infinity;
  get enabled(){return this.active;}set enabled(v:boolean){this.active=v;if(!v)this.reset();}
  async unlock(){if(!this.ctx){this.ctx=new AudioContext();this.bus=this.ctx.createGain();this.bus.gain.value=.65;const compressor=this.ctx.createDynamicsCompressor();compressor.threshold.value=-15;compressor.ratio.value=5;this.bus.connect(compressor).connect(this.ctx.destination);}await this.ctx.resume();}
  reset(){for(const s of this.voices){try{s.stop();}catch{}}this.voices.clear();this.powered=null;this.lastHit=-Infinity;}
  suspend(){this.reset();void this.ctx?.suspend();}
  private tone(hz:number,end:number,duration:number,gain:number,delay=0){const c=this.ctx!,o=c.createOscillator(),g=c.createGain(),t=c.currentTime+delay;o.type='triangle';o.frequency.setValueAtTime(hz,t);o.frequency.exponentialRampToValueAtTime(end,t+duration);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+.003);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g).connect(this.bus!);this.voices.add(o);o.onended=()=>{this.voices.delete(o);o.disconnect();g.disconnect();};o.start(t);o.stop(t+duration+.01);}
  private brush(duration:number,gain:number,frequency:number){const c=this.ctx!,buffer=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),data=buffer.getChannelData(0);let seed=73;for(let i=0;i<data.length;i++){seed=(seed*16807)%2147483647;data[i]=(seed/2147483647*2-1)*Math.pow(1-i/data.length,1.7);}const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();f.type='bandpass';f.frequency.value=frequency;f.Q.value=.7;g.gain.value=gain;s.buffer=buffer;s.connect(f).connect(g).connect(this.bus!);this.voices.add(s);s.onended=()=>{this.voices.delete(s);s.disconnect();f.disconnect();g.disconnect();};s.start();}
  event(e:GameEvent,state?:MatchState){
    if(!this.active||!this.ctx||this.ctx.state!=='running')return;
    if(e.kind==='shot'){this.powered=e.skill==='power'?e.stoneId:null;this.brush(e.skill==='power'?.13:.045,.16+e.power*.12,e.skill==='power'?1200:2200);this.tone(620,240,.045,.12);}
    else if(e.kind==='hit'||e.kind==='hinge-hit'){
      const powered=this.powered!==null&&(e.kind==='hit'?(e.a===this.powered||e.b===this.powered):e.stoneId===this.powered);if(powered)this.powered=null;
      const now=this.ctx.currentTime;if(now-this.lastHit<.045&&e.strength<.5)return;this.lastHit=now;
      const strength=Math.max(0,Math.min(1,e.strength));if(strength<.04)return;
      if(e.kind==='hinge-hit'){this.tone(1780,1450,.1,.1+strength*.12);this.tone(2630,2500,.15,.04, .008);}
      else {const a=state?.stones.find(s=>s.id===e.a),b=state?.stones.find(s=>s.id===e.b);const mass=Math.max(pieceSpec(a?.kind).mass,pieceSpec(b?.kind).mass);this.brush(.018,.12+strength*.18,1800);this.tone(560/Math.sqrt(mass),170/Math.sqrt(mass),.07,.13+strength*.16);if(powered){this.tone(160,69,.17,.24);this.tone(520,210,.035,.08,.055);}}
    }else if(e.kind==='removed'){this.tone(160,48,.14,.17,.09);if(e.stoneId===this.powered)this.powered=null;}
    else if(e.kind==='turn-ended')this.powered=null;
    else if(e.kind==='match-ended'){this.tone(294,294,.22,.06,.45);this.tone(440,440,.3,.045,.57);}
  }
}
export const createView=(canvas:HTMLCanvasElement)=>new InkView(canvas);
export const createAudio=()=>new InkAudio();
