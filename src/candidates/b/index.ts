import { TableView, TABLE, type Aim } from '../../view/table.ts';
import { RULES, pieceSpec } from '../../core/rules.ts';
import type { GameEvent, MatchState, StoneState } from '../../core/types.ts';
const scale = TABLE.w / RULES.width;
const xy = (s: {x:number;y:number}) => ({x:TABLE.x+s.x*scale,y:TABLE.y+s.y*scale});
type Cue = {kind:'launch'|'hit'|'fall'; age:number; x:number;y:number; angle:number; strong:boolean; strength:number; metal?:boolean};
class ArcadeView {
  shaking = true; effects = true;
  private base: TableView; private ctx: CanvasRenderingContext2D;
  private cues: Cue[]=[]; private powered:number|null=null; private shotAngle=0;
  private prep={id:null as number|null,power:0,armed:false};
  private hold: {age:number; stones:StoneState[]}|null=null;
  constructor(canvas:HTMLCanvasElement){this.base=new TableView(canvas);this.base.effects=false;this.base.shaking=false;this.ctx=canvas.getContext('2d')!;}
  point(x:number,y:number){return this.base.point(x,y);}
  setPreparation(stoneId:number|null,power:number,armed:boolean){this.prep={id:stoneId,power:Math.max(0,Math.min(1,power)),armed};}
  clear(){this.base.clear();this.cues=[];this.powered=null;this.hold=null;this.prep={id:null,power:0,armed:false};}
  receive(events:GameEvent[],previous:MatchState){
    if(this.effects)this.base.receive(events.filter(e=>e.kind==='removed'),previous);
    const latest=Math.max(previous.tick,...events.map(e=>e.tick));
    for(const e of events){const age=Math.max(0,(latest-e.tick)*RULES.dt);
      if(e.kind==='shot'){this.powered=e.skill==='power'?e.stoneId:null;this.shotAngle=Math.atan2(e.directionY,e.directionX);const s=previous.stones.find(s=>s.id===e.stoneId);if(s)this.cues.push({kind:'launch',...xy(s),age,angle:this.shotAngle,strong:this.powered!==null,strength:e.power});}
      if(e.kind==='hit'||e.kind==='hinge-hit'){
        const ids=e.kind==='hit'?[e.a,e.b]:[e.stoneId];const strong=this.powered!==null&&ids.includes(this.powered);
        const ss=previous.stones.filter(s=>ids.includes(s.id));
        let angle=this.shotAngle;
        if(ss.length===2){let a=ss[0],b=ss[1];if(Math.hypot(b.vx,b.vy)>Math.hypot(a.vx,a.vy)){[a,b]=[b,a];}angle=Math.atan2(b.y-a.y,b.x-a.x);}
        if(strong){this.powered=null;if(this.effects&&e.kind==='hit'&&e.strength>.18&&age<.052)this.hold={age,stones:ss.map(s=>({...s}))};}
        if(e.strength>.06)this.cues.push({kind:'hit',...xy(e),age,angle,strong:strong&&e.strength>.18,strength:e.strength,metal:e.kind==='hinge-hit'});
      }
      if(e.kind==='removed'){this.cues.push({kind:'fall',...xy(e),age,angle:Math.atan2(e.vy,e.vx),strong:false,strength:1});if(this.powered===e.stoneId)this.powered=null;}
      if(e.kind==='turn-ended')this.powered=null;
    }
    this.cues=this.cues.slice(-28);
  }
  render(state:MatchState,dt:number,selected:number|null,aim:Aim|null,previous?:MatchState,alpha=1){
    if(!this.effects)this.base.clear();
    let display=state;
    if(this.hold&&this.effects){this.hold.age+=dt;const t=Math.max(0,Math.min(1,(this.hold.age-.052)/.065));const held=this.hold;
      display={...state,stones:state.stones.map(s=>{const h=held.stones.find(h=>h.id===s.id);return h&&s.alive?{...s,x:h.x+(s.x-h.x)*t,y:h.y+(s.y-h.y)*t}:s;})};
      if(t>=1)this.hold=null;
    }else this.hold=null;
    this.base.render(display,dt,selected,aim,this.hold?undefined:previous,alpha);
    const c=this.ctx;const prep=state.stones.find(s=>s.id===this.prep.id&&s.alive);
    if(prep&&state.phase==='aiming'){
      const p=xy(prep),r=pieceSpec(prep.kind).radius*scale;const angle=aim?Math.atan2(prep.y-aim.y,prep.x-aim.x):-Math.PI/2;
      c.save();c.translate(p.x,p.y);c.rotate(angle);const gap=r+12+(1-this.prep.power)*40;
      c.strokeStyle=this.prep.armed?'#2c2118':'#755431';c.lineWidth=this.prep.armed?10:3;
      for(const side of [-1,1]){c.beginPath();c.moveTo(-r*.65,side*(gap+15));c.lineTo(0,side*gap);c.lineTo(r*.65,side*(gap+15));c.stroke();if(this.prep.armed){c.strokeStyle='#ffde83';c.lineWidth=3;c.stroke();c.strokeStyle='#2c2118';c.lineWidth=10;}}
      c.restore();
    }
    for(const cue of this.cues)cue.age+=dt;
    this.cues=this.cues.filter(q=>q.age<(q.kind==='fall'?.4:q.strong?.25:.11));
    if(!this.effects)return;
    const flying=display.stones.find(s=>s.id===this.powered&&s.alive);
    if(flying&&Math.hypot(flying.vx,flying.vy)>1){const p=xy(flying),r=pieceSpec(flying.kind).radius*scale;c.save();c.translate(p.x,p.y);c.rotate(Math.atan2(flying.vy,flying.vx));for(const side of [-1,1]){c.fillStyle='#30251de8';c.beginPath();c.moveTo(-r*3,side*r*.85);c.lineTo(-r*.15,side*r*1.16);c.lineTo(-r*.55,side*r*1.4);c.closePath();c.fill();c.strokeStyle='#ffdc83';c.lineWidth=3;c.stroke();}c.restore();}
    for(const q of this.cues){c.save();c.translate(q.x,q.y);c.rotate(q.angle);const life=q.kind==='fall'?.4:q.strong?.25:.11;const t=q.age/life;c.globalAlpha=Math.max(0,1-t);c.fillStyle='#382318';c.strokeStyle='#ffe3a0';c.lineWidth=3;
      if(q.kind==='launch'){const reach=q.strong?145:40;for(const sign of q.strong?[-1,1]:[0]){c.beginPath();c.moveTo(-30-t*reach,sign*26);c.lineTo(-8-t*reach*.3,sign*45);c.lineTo(-95-t*reach,sign*48);c.closePath();c.fill();c.stroke();}}
      else if(q.kind==='hit'){
        const size=q.strong?40+q.strength*28:5+q.strength*13;
        if(q.strong){c.globalAlpha=Math.max(0,1-t*.9);c.fillStyle=q.metal?'#dce8ef':'#fff0ba';c.strokeStyle='#2c2018';c.lineWidth=6;c.beginPath();c.moveTo(-8,-size);c.lineTo(8,-size*.65);c.lineTo(5,size);c.lineTo(-9,size*.7);c.closePath();c.fill();c.stroke();}
        for(const sign of [-1,1]){const offset=q.strong?size+Math.max(0,t-.22)*80:size;c.fillStyle=q.metal?'#e0e9ef':'#382318';c.beginPath();c.moveTo(t*25,sign*offset);c.lineTo(18+t*40,sign*(offset+size*.45));c.lineTo(-10+t*12,sign*(offset+size*.55));c.closePath();c.fill();if(q.strong)c.stroke();}
      }else{c.rotate(-q.angle);c.strokeStyle='#3d2618';c.lineWidth=5;for(const sign of [-1,1]){c.beginPath();c.moveTo(sign*20,t*80);c.lineTo(sign*10,t*80+30);c.stroke();}}
      c.restore();
    }
  }
}
class ArcadeAudio {
  private active=false;private context?:AudioContext;private sources=new Set<AudioScheduledSourceNode>();private powered:number|null=null;private lastHit=-Infinity;
  get enabled(){return this.active;}set enabled(v:boolean){this.active=v;if(!v)this.reset();}
  async unlock(){this.context??=new AudioContext();await this.context.resume();}
  private tone(freq:number,end:number,duration:number,level:number,delay=0,noise=false){const c=this.context;if(!c||!this.active||c.state!=='running')return;const at=c.currentTime+delay,g=c.createGain();g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(level,at+.003);g.gain.exponentialRampToValueAtTime(.0001,at+duration);g.connect(c.destination);
    let source:AudioScheduledSourceNode;
    if(noise){const b=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1);const s=c.createBufferSource();s.buffer=b;const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=freq;f.Q.value=.8;s.connect(f).connect(g);source=s;}else{const s=c.createOscillator();s.type='triangle';s.frequency.setValueAtTime(freq,at);s.frequency.exponentialRampToValueAtTime(end,at+duration);s.connect(g);source=s;}
    this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect();g.disconnect();};source.start(at);source.stop(at+duration+.01);
  }
  event(e:GameEvent,state?:MatchState){
    if(e.kind==='shot'){this.powered=e.skill==='power'?e.stoneId:null;this.tone(this.powered!==null?1300:900,350,.055,.07,0,true);if(this.powered!==null)this.tone(320,90,.12,.07);}
    if(e.kind==='hit'||e.kind==='hinge-hit'){const strong=this.powered!==null&&(e.kind==='hit'?[e.a,e.b]:[e.stoneId]).includes(this.powered);if(strong)this.powered=null;const now=this.context?.currentTime??0;if(!strong&&now-this.lastHit<.045)return;this.lastHit=now;const mass=e.kind==='hit'?Math.max(...state?.stones.filter(s=>s.id===e.a||s.id===e.b).map(s=>pieceSpec(s.kind).mass)??[1]):1;const level=.04+Math.min(1,e.strength)*.09;
      if(e.kind==='hinge-hit'){this.tone(2100,1600,.08,level*.7);this.tone(3300,3200,.05,level*.3);}
      else{this.tone(1700,800,.027,level,0,true);this.tone(300/Math.sqrt(Math.max(.5,mass)),95,strong?.14:.065,level*.7,strong?.024:0);if(strong)this.tone(750,190,.045,level*.5,.012);}}
    if(e.kind==='removed'){this.tone(170,65,.18,.085,.09);this.tone(800,400,.055,.04,.09,true);}
    if(e.kind==='turn-ended')this.powered=null;
  }
  reset(){for(const s of this.sources){try{s.stop();}catch{}}this.sources.clear();this.powered=null;this.lastHit=-Infinity;}
  suspend(){this.reset();void this.context?.suspend();}
}
export const createView=(canvas:HTMLCanvasElement)=>new ArcadeView(canvas);
export const createAudio=()=>new ArcadeAudio();
