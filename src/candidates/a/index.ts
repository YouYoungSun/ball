import { TableView, TABLE, type Aim } from '../../view/table.ts';
import { RULES, pieceSpec } from '../../core/rules.ts';
import type { GameEvent, MatchState, StoneState } from '../../core/types.ts';
const S = TABLE.w / RULES.width;
const pos = (s: {x:number;y:number}) => ({x:TABLE.x+s.x*S,y:TABLE.y+s.y*S});
interface Reaction { id:number; age:number; force:number; nx:number; ny:number; powered:boolean; launch?:boolean }
interface Contact { x:number;y:number;age:number;force:number;nx:number;ny:number;powered:boolean;metal:boolean }
class TimberView {
  shaking=true; effects=true;
  private board:TableView; private ctx:CanvasRenderingContext2D;
  private prep={id:null as number|null,power:0,armed:false};
  private reactions:Reaction[]=[]; private contacts:Contact[]=[];
  private falling:{s:StoneState;age:number}[]=[];
  private releases:{x:number;y:number;nx:number;ny:number;age:number;powered:boolean}[]=[];
  private powered:number|null=null;
  constructor(canvas:HTMLCanvasElement){this.board=new TableView(canvas);this.board.effects=false;this.board.shaking=false;this.ctx=canvas.getContext('2d')!;}
  point(x:number,y:number){return this.board.point(x,y);}
  setPreparation(id:number|null,power:number,armed:boolean){this.prep={id,power:Math.max(0,Math.min(1,power)),armed};}
  clear(){this.board.clear();this.reactions=[];this.contacts=[];this.falling=[];this.powered=null;this.releases=[];this.setPreparation(null,0,false);}
  receive(events:GameEvent[],previous:MatchState){
    const tick=Math.max(previous.tick,...events.map(e=>e.tick));
    for(const e of events){const age=Math.max(0,(tick-e.tick)*RULES.dt);
      if(e.kind==='shot'){const stone=previous.stones.find(s=>s.id===e.stoneId);if(stone)this.releases.push({...pos(stone),nx:e.directionX,ny:e.directionY,age,powered:e.skill==='power'});this.powered=e.skill==='power'?e.stoneId:null;this.reactions.push({id:e.stoneId,age,force:e.power,nx:e.directionX,ny:e.directionY,powered:e.skill==='power',launch:true});}
      if(e.kind==='hit'||e.kind==='hinge-hit'){
        const a=previous.stones.find(s=>s.id===(e.kind==='hit'?e.a:e.stoneId)),b=e.kind==='hit'?previous.stones.find(s=>s.id===e.b):undefined;
        let nx=b&&a?b.x-a.x:a?e.x-a.x:0,ny=b&&a?b.y-a.y:a?e.y-a.y:1;const len=Math.hypot(nx,ny)||1;nx/=len;ny/=len;
        const powered=this.powered!==null&&(a?.id===this.powered||b?.id===this.powered);
        if(powered)this.powered=null;
        const force=Math.max(0,Math.min(1,e.strength));
        if(force>.06)this.contacts.push({...pos(e),age,force,nx,ny,powered,metal:e.kind==='hinge-hit'});
        for(const [s,sign] of [[a,-1],[b,1]] as const)if(s)this.reactions.push({id:s.id,age,force,nx:nx*sign,ny:ny*sign,powered});
      }
      if(e.kind==='removed'){const s=previous.stones.find(s=>s.id===e.stoneId);if(s)this.falling.push({s:{...s,x:e.x,y:e.y,vx:e.vx,vy:e.vy},age});if(this.powered===e.stoneId)this.powered=null;}
      if(e.kind==='turn-ended')this.powered=null;
    }
  }
  render(state:MatchState,dt:number,selected:number|null,aim:Aim|null,previous?:MatchState,alpha=1){
    this.board.render({...state,stones:[]},dt,null,null);
    for(const r of this.reactions)r.age+=dt;this.reactions=this.reactions.filter(r=>r.age<.28);
    for(const r of this.contacts)r.age+=dt;this.contacts=this.contacts.filter(r=>r.age<.26);
    for(const r of this.falling)r.age+=dt;this.falling=this.falling.filter(r=>r.age<.42);
    const stones=state.stones.filter(s=>s.alive).map(s=>{const old=previous?.stones.find(o=>o.id===s.id);return old?.alive?{...s,x:old.x+(s.x-old.x)*alpha,y:old.y+(s.y-old.y)*alpha}:s;});
    for(const r of this.releases)r.age+=dt;this.releases=this.releases.filter(r=>r.age<.19);
    if(this.effects)for(const r of this.releases){const c=this.ctx,t=r.age/.19;c.save();c.translate(r.x,r.y);c.rotate(Math.atan2(r.ny,r.nx));c.globalAlpha=(1-t)*(r.powered?.6:.18);c.fillStyle='#56351e';c.beginPath();c.ellipse(-9,5,r.powered?33:17,13,0,0,Math.PI*2);c.fill();if(r.powered)for(let i=0;i<10;i++){c.fillStyle=i%2?'#e6c68d':'#75502d';c.fillRect(-20-t*(15+i*3),(i-4.5)*(3+t*6),3+i%3,2);}c.restore();}
    for(const s of stones.sort((a,b)=>a.y-b.y))this.drawStone(s,0,state.phase==='aiming'&&selected===s.id,aim);
    if(this.effects){for(const f of this.falling)this.drawStone(f.s,f.age/.42,false,null);for(const c of this.contacts)this.contact(c);}
  }
  private oct(r:number,oy=0){const c=this.ctx;c.beginPath();for(let i=0;i<8;i++){const a=Math.PI/8+i*Math.PI/4;const x=Math.cos(a)*r,y=Math.sin(a)*r+oy;i?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();}
  private drawStone(s:StoneState,fall:number,selected:boolean,aim:Aim|null){
    const c=this.ctx,p=pos(s),spec=pieceSpec(s.kind),r=spec.radius*S;
    const prep=this.effects&&selected&&this.prep.id===s.id?this.prep.power:0,armed=this.prep.armed&&prep>0;
    let nx=0,ny=-1;if(aim){const d=Math.hypot(s.x-aim.x,s.y-aim.y)||1;nx=(s.x-aim.x)/d;ny=(s.y-aim.y)/d;}
    let tilt=-prep*(armed?22:5);
    const hit=this.effects?this.reactions.filter(h=>h.id===s.id).sort((a,b)=>b.force-a.force)[0]:undefined;
    if(hit){const t=hit.age/.28,w=Math.cos(t*Math.PI*2.5)*Math.exp(-t*3.8);tilt=w*hit.force*(hit.powered?32:7)/Math.sqrt(spec.mass);nx=hit.nx;ny=hit.ny;}
    c.save();c.translate(p.x,p.y);
    // Fixed contact footprint never changes collider scale.
    c.fillStyle=`rgba(42,25,11,${.2+(armed?.3:hit?.powered?.25:0)})`;c.beginPath();c.ellipse(3,9,r*.94,r*.88,0,0,Math.PI*2);c.fill();
    if(selected){c.strokeStyle=armed?'#3e2414':'#785333';c.lineWidth=armed?6:2;c.beginPath();c.arc(0,0,r+9,0,Math.PI*2);c.stroke();
      if(aim){c.strokeStyle='#4b301a';c.lineWidth=3;c.setLineDash([3,9]);c.beginPath();c.moveTo(nx*(r+16),ny*(r+16));c.lineTo(nx*(r+50+prep*90),ny*(r+50+prep*90));c.stroke();c.setLineDash([]);}
      if(armed){c.save();c.rotate(Math.atan2(ny,nx));c.fillStyle='#4c2d1970';c.beginPath();c.ellipse(-r-9,0,7+prep*8,r*.72,0,0,Math.PI*2);c.fill();c.strokeStyle='#3f281a';c.lineWidth=4;c.beginPath();c.arc(0,0,r+4,Math.PI*.68,Math.PI*1.32);c.stroke();c.restore();}
    }
    c.globalAlpha=1-fall;c.translate(0,fall*fall*110);c.rotate(fall*.85);c.scale(1-fall*.5,1-fall*.7);
    const depth=4+spec.mass*1.5;
    c.fillStyle='#77502c';this.oct(r,depth);c.fill();
    const face=c.createLinearGradient(-r,-r,r,r);face.addColorStop(0,'#fff0c8');face.addColorStop(.5,'#e5c48b');face.addColorStop(1,'#b98a4d');c.fillStyle=face;
    c.save();
    // The lower wooden rim stays planted. Only the top plane rocks around it.
    const pitch=Math.min(.24,Math.abs(tilt)*.011),angle=Math.atan2(ny,nx);
    c.translate(nx*tilt*.12,ny*tilt*.12);c.rotate(angle);c.transform(1-pitch,0,Math.sign(tilt)*pitch*.35,1,0,0);c.rotate(-angle);this.oct(r);c.fill();c.strokeStyle='#71451f';c.lineWidth=2;c.stroke();
    c.save();this.oct(r-3);c.clip();for(let i=0;i<9;i++){c.strokeStyle=i%2?'#80592a22':'#fff5d72d';c.lineWidth=1;c.beginPath();const y=-r+i*r/4;c.moveTo(-r,y);c.bezierCurveTo(-r*.3,y+3,r*.3,y-4,r,y+2);c.stroke();}c.restore();
    c.strokeStyle='#fff6d9a0';c.lineWidth=2;this.oct(r-3);c.stroke();c.strokeStyle=s.side?'#96392e':'#315873';c.lineWidth=1.6;this.oct(r*.78);c.stroke();
    c.font=`700 ${r*1.23}px "Noto Serif KR", "Noto Serif CJK KR", Batang, serif`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=s.side?'#9c3028':'#244e70';c.fillText(spec.label[s.side],0,1);c.restore();c.restore();
  }
  private contact(f:Contact){const c=this.ctx,t=f.age/.26;c.save();c.translate(f.x,f.y);c.rotate(Math.atan2(f.ny,f.nx));
    const hard=f.powered?.105:.065;if(f.age<hard){c.globalAlpha=(1-f.age/hard)*f.force;c.fillStyle='#3d2416';const width=f.powered?12:6,span=9+f.force*(f.powered?27:16);c.fillRect(-width/2,-span,width,span*2);c.fillStyle=f.metal?'#ebf4f0':'#fff2c4';c.fillRect(-width/2,-span*.9,3,span*1.8);}
    const count=f.force>.3?(f.powered?13:4):0;
    for(let i=0;i<count;i++){const seed=Math.sin(i*17.1+f.x)*.5+.5;const sign=i%2?1:-1;c.globalAlpha=(1-t)*f.force*(f.powered?.8:.5);c.fillStyle=f.metal?'#e8e9d3':i%3?'#79502a':'#ead39a';const x=(seed-.5)*24*t,y=sign*(8+seed*25+40*t);c.fillRect(x,y,2+seed*4,2+seed*2);}
    c.restore();}
}
export const createView=(canvas:HTMLCanvasElement)=>new TimberView(canvas);
class TimberAudio {
  private on=false; private context?:AudioContext; private voices=new Set<AudioBufferSourceNode>();private powered:number|null=null;private last=-10;
  get enabled(){return this.on;} set enabled(v:boolean){this.on=v;if(!v)this.reset();}
  async unlock(){this.context??=new AudioContext();await this.context.resume();}
  reset(){for(const v of this.voices){try{v.stop();}catch{ /* ended */ }}this.voices.clear();this.powered=null;this.last=-10;}
  suspend(){this.reset();void this.context?.suspend();}
  event(e:GameEvent,state?:MatchState){
    if(e.kind==='shot')this.powered=e.skill==='power'?e.stoneId:null;
    if(e.kind==='turn-ended')this.powered=null;
    if(!this.enabled||this.context?.state!=='running')return;
    if(e.kind==='shot')this.sound(e.skill==='power'?420:730,.12+e.power*.10,e.skill==='power'?.11:.065,0,false,e.skill==='power');
    if(e.kind==='hit'||e.kind==='hinge-hit'){
      const id=e.kind==='hit'?e.a:e.stoneId;const powered=this.powered===id||(e.kind==='hit'&&this.powered===e.b);if(powered)this.powered=null;
      const now=this.context.currentTime;if(now-this.last<.035&&e.strength<.5)return;this.last=now;
      const a=state?.stones.find(s=>s.id===id),b=e.kind==='hit'?state?.stones.find(s=>s.id===e.b):undefined;
      const mass=Math.sqrt(pieceSpec(a?.kind).mass*pieceSpec(b?.kind).mass);
      this.sound(e.kind==='hinge-hit'?1750:660/Math.sqrt(mass),.13+e.strength*.28,powered?.145:.08,0,e.kind==='hinge-hit',powered);
    }
    if(e.kind==='removed'){if(e.stoneId===this.powered)this.powered=null;this.sound(240,.30,.13,.17,false,true);this.sound(390,.12,.07,.25,false,false);}
  }
  private sound(freq:number,level:number,duration:number,delay:number,metal:boolean,heavy:boolean){
    const c=this.context!;if(this.voices.size>10)return;const rate=c.sampleRate,buffer=c.createBuffer(1,Math.ceil(rate*duration),rate),d=buffer.getChannelData(0);let seed=73;
    for(let i=0;i<d.length;i++){const t=i/rate;seed=(seed*1664525+1013904223)>>>0;const noise=(seed/4294967296*2-1);const attack=Math.min(1,t/.0007);
      const body=Math.sin(2*Math.PI*freq*t)*Math.exp(-t/(metal?.055:.024))*.5+Math.sin(2*Math.PI*freq*(metal?2.76:1.63)*t)*Math.exp(-t/.017)*.3;
      const click=noise*Math.exp(-t/.0035)*.48;
      const table=heavy?Math.sin(2*Math.PI*165*t)*Math.exp(-t/.047)*.23:0;
      d[i]=(body+click+table)*attack*level;
    }
    const source=c.createBufferSource();source.buffer=buffer;source.connect(c.destination);this.voices.add(source);source.onended=()=>{source.disconnect();this.voices.delete(source);};source.start(c.currentTime+delay);
  }
}
export const createAudio=()=>new TimberAudio();
