const express=require("express"),http=require("http"),{Server}=require("socket.io"),crypto=require("crypto");
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:"*"}});
app.use(express.static("public"));app.get("/health",(_,r)=>r.json({ok:true,game:"Dead Air: After Hours"}));
const PORT=process.env.PORT||3000,ROUND=20*60*1000,rooms=new Map(),inRoom=new Map(),queue=[];
const MAPS=[
["Hollow Manor","mansion"],["Blackwood School","school"],["Last Stop Hotel","hotel"],["Mercy Hospital","hospital"],["Dead Mall","mall"],["Pinewatch Camp","forest"],["Museum After Dark","museum"],["Ashlight Theatre","theatre"],["Last Train","subway"],["Rustworks Factory","factory"],["Whispering Library","library"],["Blackwater Aquarium","aquarium"],["Cursed Carnival","carnival"],["Abandoned Prison","prison"],["Snowed-In Lodge","snow"],["Underground Bunker","bunker"],["Flooded Archives","water"],["Graveyard Chapel","graveyard"],["Old Arcade","arcade"],["The Funhouse","funhouse"]
];
function makeMap(){const [name,theme]=MAPS[Math.floor(Math.random()*MAPS.length)],rooms=[],walls=[],w=1500,h=1000;
 const cols=theme==="subway"?3:4,rows=theme==="hotel"?3:3,cellW=1300/cols,cellH=800/rows;
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){let rx=100+x*cellW,ry=90+y*cellH;rooms.push([rx,ry,cellW-35,cellH-35]);if(x<cols-1&&Math.random()>.18)walls.push([rx+cellW-25,ry,22,cellH-35]);}
 for(let y=0;y<rows-1;y++){if(Math.random()>.25)walls.push([100,90+(y+1)*cellH-20,1300,18]);}
 // Give every generated map a different room-layout silhouette and obstacle rhythm.
 for(let i=0;i<8;i++){let x=130+Math.random()*1200,y=130+Math.random()*700;walls.push([x,y,35+Math.random()*75,18+Math.random()*25]);}
 return {name,theme,w,h,rooms,walls};}
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),clean=n=>String(n||"Player").replace(/[^\w -]/g,"").trim().slice(0,14)||"Player",code=()=>crypto.randomBytes(3).toString("hex").toUpperCase();
function list(r){return [...r.players.values()].map(p=>({id:p.id,name:p.name,role:p.role,x:p.x,y:p.y,caught:p.caught}));}
function roomCreate(priv){let id;do{id=code()}while(rooms.has(id));const r={id,private:priv,map:makeMap(),players:new Map(),status:"lobby",endsAt:0,ghost:null};rooms.set(id,r);return r;}
function join(s,r,n){if(r.status!=="lobby"||r.players.size>=9){s.emit("notice","That room is full or already playing.");return false;}r.players.set(s.id,{id:s.id,name:clean(n),role:"survivor",x:750+Math.random()*70,y:500+Math.random()*70,caught:false,last:Date.now()});inRoom.set(s.id,r.id);s.join(r.id);s.emit("joined",{roomId:r.id,map:r.map,players:list(r)});io.to(r.id).emit("lobby-update",{roomId:r.id,map:r.map,players:list(r)});return true;}
function start(r){if(r.status!=="lobby"||r.players.size<2)return;const ps=[...r.players.values()],g=ps[Math.floor(Math.random()*ps.length)];r.ghost=g.id;r.status="playing";r.endsAt=Date.now()+ROUND;ps.forEach(p=>{p.role=p.id===g.id?"ghost":"survivor";p.caught=false;p.x=750+(Math.random()-.5)*160;p.y=500+(Math.random()-.5)*160;p.last=Date.now();});io.to(r.id).emit("game-start",{map:r.map,players:list(r),endsAt:r.endsAt,duration:ROUND});}
function finish(r,winner,reason){if(r.status!=="playing")return;r.status="ended";io.to(r.id).emit("game-over",{winner,reason,players:list(r)});setTimeout(()=>{for(const p of r.players.values()){const s=io.sockets.sockets.get(p.id);if(s){inRoom.delete(p.id);s.leave(r.id);s.emit("room-closed");}}rooms.delete(r.id);},10000);}
function unqueue(id){let i=queue.findIndex(q=>q.id===id);if(i>=0)queue.splice(i,1);}
function match(){while(queue.length>=2){let a=queue.shift(),b=queue.shift();if(!io.sockets.sockets.has(a.id)||!io.sockets.sockets.has(b.id))continue;let r=roomCreate(false),sa=io.sockets.sockets.get(a.id),sb=io.sockets.sockets.get(b.id);if(join(sa,r,a.name)&&join(sb,r,b.name))start(r);}}
io.on("connection",s=>{
 s.on("quick-play",d=>{if(inRoom.has(s.id))return;unqueue(s.id);queue.push({id:s.id,name:clean(d?.name)});s.emit("queue-status",{queued:true,position:queue.length});match();});
 s.on("cancel-queue",()=>{unqueue(s.id);s.emit("queue-status",{queued:false});});
 s.on("create-room",d=>{if(inRoom.has(s.id))return;let r=roomCreate(true);join(s,r,d?.name);s.emit("room-created",{roomId:r.id});});
 s.on("join-room",d=>{if(inRoom.has(s.id))return;let r=rooms.get(String(d?.roomId||"").toUpperCase().trim());if(!r){s.emit("notice","Room code not found.");return;}join(s,r,d?.name);});
 s.on("start-game",()=>{let r=rooms.get(inRoom.get(s.id));if(!r)return;if(r.players.size<2){s.emit("notice","You need at least two players.");return;}start(r);});
 s.on("move",d=>{let r=rooms.get(inRoom.get(s.id)),p=r?.players.get(s.id);if(!r||r.status!=="playing"||!p||p.caught)return;let now=Date.now(),dt=clamp((now-p.last)/1000,0,.12);p.last=now;let speed=p.role==="ghost"?235:(d.sprint?190:145),dx=clamp(+d.dx||0,-1,1),dy=clamp(+d.dy||0,-1,1),len=Math.hypot(dx,dy)||1;p.x=clamp(p.x+dx/len*speed*dt,25,r.map.w-25);p.y=clamp(p.y+dy/len*speed*dt,25,r.map.h-25);
 if(p.role==="ghost"&&d.tag)for(const t of r.players.values())if(t.role==="survivor"&&!t.caught&&Math.hypot(t.x-p.x,t.y-p.y)<52){t.caught=true;io.to(r.id).emit("caught",{id:t.id,name:t.name});}
 });
 s.on("disconnect",()=>{unqueue(s.id);let id=inRoom.get(s.id),r=rooms.get(id);inRoom.delete(s.id);if(!r)return;r.players.delete(s.id);if(r.status==="playing"){if(s.id===r.ghost)finish(r,"survivors","The ghost disconnected.");else if(![...r.players.values()].some(p=>p.role==="survivor"&&!p.caught))finish(r,"ghost","No survivors remain.");}else io.to(r.id).emit("lobby-update",{roomId:r.id,map:r.map,players:list(r)});if(!r.players.size)rooms.delete(r.id);});
});
setInterval(()=>{let now=Date.now();for(const r of rooms.values())if(r.status==="playing"){if(![...r.players.values()].some(p=>p.role==="survivor"&&!p.caught))finish(r,"ghost","Every survivor was caught.");else if(now>=r.endsAt)finish(r,"survivors","The survivors lasted 20 minutes.");else io.to(r.id).emit("state",{players:list(r),timeLeft:r.endsAt-now});}},50);
server.listen(PORT,()=>console.log("Dead Air: After Hours on port "+PORT));
