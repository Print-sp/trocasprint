const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const PORT = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const sessions = new Map();
const root = __dirname;
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'trocas.json');
const seed = [
  ['DYE8D19','Já estava no pátio','NÃO','X','Patio Jaraguá'],
  ['FCI0E15','Já estava no pátio','NÃO','X','Patio Jaraguá'],
  ['FSU1B94','Já estava no pátio','NÃO','X','Patio Jaraguá'],
  ['FZX7H76','Já estava no pátio','NÃO','X','Oficina'],
  ['GFT2A57','Já estava no pátio','NÃO','X','Oficina'],
  ['GGJ5J17','Já estava no pátio','NÃO','X','Oficina'],
  ['GHU3E83','Belém','SIM','UFW8B97','Oficina'],
  ['GJT1E84','Vitória da Conquista','SIM','UPF2B79','Oficina']
].map((r, i) => ({ id: i + 1, placaEntra:r[0], origem:r[1], troca:r[2], placaSai:r[3], local:r[4], observacoes:'', criadoEm:new Date().toISOString() }));
const imported = [
  ['GHU3E83','Belém','UFW8B97','Ramiro Gomes','6861392291','Sandro','26/09/2026'],
  ['GJT8J61','Belém','URN6H35','Jefferson Pereira dos Santos','','','24/09/2026'],
  ['UPK3D75','Vitória da Conquista','','Marcelo Pereira da Silva','02575661570','Pedro',''],
  ['FFJ8A64','Feira de Santana','','Edmilson Souza Soares','03125976821','Pedro',''],
  ['GJT1E84','Vitória da Conquista','UPF2B79','Ricardo Ferreira','02513001966','',''],
  ['UPD4A87','Correios','GAE0C35','Luiz André Lima da Silva','','',''],
  ['BPO7B85','São Luiz','UOH7J35','Carlos Magno Lemos Gomes','43758622387','Manoel','02/10/2026'],
  ['GDH5C66','São Luiz','UOQ0C53','José Rivaldo de Carvalho','63456346115','Suyane','01/10/2026'],
  ['TMB3E52','Campo Grande','URY5F34','Rodrigo de Paiva Oliveira Silva','0210998102','Elvis','01/10/2026'],
  ['T9H68','Campo Grande','GHE6G85','Luiz Armando Ribeiro do Nascimento','00563648147','Elvis',''],
  ['GHE6G85','São Luiz','QSY9G56','Neizael Saturnino de Oliveira','99613468153','',''],
  ['ESX01I71','Feira de Santana','TKP8B78','Valmir Rocha de Jesus','90018435572','Bob','06/10/2026'],
  ['GHE6G85','Campo Grande','TKR9H68','Luiz Armando Ribeiro do Nascimento','00563648147','',''],
  ['GGI8C36','Uberaba','','Murilo Bezerra dos Santos','03351887531','Nadir','03/10/2026']
].map((r,i)=>({id:100+i,placaEntra:r[0],tipoPlaca:'Mercosul',tipoVeiculo:'Cavalo',origem:r[1],troca:r[2]?'SIM':'NÃO',placaSai:r[2]||'X',local:r[1],marca:'Volks',modelo:'',dataEntrada:r[6]||'',baseOrigem:r[1],baseDestino:'',gestorBase:r[5],responsavelChaves:r[3],chassi:'',entregarDiversos:false,entregarCorreios:r[1]==='Correios',sinistro:false,tipoSinistro:'',observacoes:r[4]?'CPF: '+r[4]:'',fotos:[],criadoEm:new Date().toISOString()}));
function ensureData(){ if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir,{recursive:true}); if(!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(seed,null,2)); const rows=JSON.parse(fs.readFileSync(dataFile,'utf8')); if(!rows.some(x=>x.id===100)){ fs.writeFileSync(dataFile, JSON.stringify(rows.concat(imported),null,2)); } }
function read(){ ensureData(); return JSON.parse(fs.readFileSync(dataFile,'utf8')); }
function write(rows){ ensureData(); fs.writeFileSync(dataFile, JSON.stringify(rows,null,2)); }
async function initDb(){ if(!pool)return; await pool.query('CREATE TABLE IF NOT EXISTS vehicles (id BIGINT PRIMARY KEY, payload JSONB NOT NULL)'); const result=await pool.query('SELECT payload FROM vehicles ORDER BY id'); if(result.rows.length){ensureData();fs.writeFileSync(dataFile,JSON.stringify(result.rows.map(r=>r.payload),null,2));} else {const rows=read();await persistDb(rows);} }
async function persistDb(rows){if(!pool)return;const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM vehicles');for(const row of rows)await client.query('INSERT INTO vehicles (id,payload) VALUES ($1,$2)',[row.id,row]);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
const dbReady=initDb().catch(e=>{console.error('PostgreSQL indisponível:',e.message);return null});
function send(res, status, body, type='application/json'){ res.writeHead(status, {'Content-Type': type+'; charset=utf-8'}); res.end(type==='application/json'?JSON.stringify(body):body); }
function user(req){ const c=req.headers.cookie||''; const token=(c.match(/sid=([^;]+)/)||[])[1]; return token&&sessions.get(token); }
function auth(req,res){ const u=user(req); if(!u){send(res,401,{erro:'Login necessário.'});return null} return u; }
function can(u,row){ return u.role==='admin'||row.local===u.patio; }
function parseBody(req){ return new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}}); }); }
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    await dbReady;
    if(url.pathname==='/api/login'&&req.method==='POST'){const b=await parseBody(req);const users={admin:{password:'admin123',role:'admin',nome:'Administrador'},bandeirantes:{password:'band123',role:'patio',patio:'Pátio Bandeirantes',nome:'Pátio Bandeirantes'},cajamar:{password:'caj123',role:'patio',patio:'Pátio Cajamar',nome:'Pátio Cajamar'}};const x=users[String(b.usuario||'').toLowerCase()];if(!x||x.password!==b.senha)return send(res,401,{erro:'Usuário ou senha inválidos.'});const sid=Math.random().toString(36).slice(2)+Date.now();sessions.set(sid,{usuario:String(b.usuario).toLowerCase(),...x});res.setHeader('Set-Cookie',`sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);return send(res,200,{nome:x.nome,role:x.role,patio:x.patio||null})}
    if(url.pathname==='/api/session'&&req.method==='GET'){const u=user(req);return send(res,200,u?{nome:u.nome,role:u.role,patio:u.patio||null}:{})}
    if(url.pathname==='/api/logout'&&req.method==='POST'){const u=user(req);const c=(req.headers.cookie||'').match(/sid=([^;]+)/);if(c)sessions.delete(c[1]);res.setHeader('Set-Cookie','sid=; Max-Age=0; Path=/');return send(res,200,{ok:true})}
    if(url.pathname==='/api/trocas'){
      const u=user(req);if(req.method==='GET'&&!u)return send(res,200,[]);if(!u)return auth(req,res); if(req.method==='GET') return send(res,200, u.role==='admin'?read():read().filter(x=>x.local===u.patio));
      if(req.method==='POST') { const b=await parseBody(req); const rows=read(); const item={id:Date.now(),placaEntra:String(b.placaEntra||'').toUpperCase(),tipoPlaca:b.tipoPlaca||'Mercosul',tipoVeiculo:b.tipoVeiculo||'Caminhão Truck',origem:b.origem||'',troca:b.troca||'NÃO',placaSai:String(b.placaSai||'X').toUpperCase(),local:b.local||'',marca:b.marca||'',modelo:b.modelo||'',dataEntrada:b.dataEntrada||'',baseOrigem:b.baseOrigem||'',baseDestino:b.baseDestino||'',gestorBase:b.gestorBase||'',responsavelChaves:b.responsavelChaves||'',chassi:b.chassi||'',reserva:!!b.reserva,entregarDiversos:!!b.entregarDiversos,entregarCorreios:!!b.entregarCorreios,sinistro:!!b.sinistro,tipoSinistro:b.tipoSinistro||'',observacoes:b.observacoes||'',fotos:Array.isArray(b.fotos)?b.fotos:[],criadoEm:new Date().toISOString()}; if(u.role!=='admin')item.local=u.patio;if(!item.placaEntra||!item.local) return send(res,400,{erro:'Placa que entra e local são obrigatórios.'}); rows.unshift(item); write(rows); await persistDb(rows); return send(res,201,item); }
    }
    const match=url.pathname.match(/^\/api\/trocas\/(\d+)$/);
    if(match){ const u=auth(req,res);if(!u)return; const id=Number(match[1]), rows=read(), idx=rows.findIndex(x=>x.id===id); if(idx<0)return send(res,404,{erro:'Registro não encontrado.'}); if(!can(u,rows[idx]))return send(res,403,{erro:'Acesso restrito ao pátio do usuário.'}); if(req.method==='DELETE'){const [removed]=rows.splice(idx,1);write(rows);await persistDb(rows);return send(res,200,removed);} if(req.method==='PUT'){const b=await parseBody(req); rows[idx]={...rows[idx],...b,id,local:u.role==='admin'?(b.local||rows[idx].local):u.patio}; rows[idx].placaEntra=String(rows[idx].placaEntra||'').toUpperCase(); rows[idx].placaSai=String(rows[idx].placaSai||'X').toUpperCase(); write(rows);await persistDb(rows); return send(res,200,rows[idx]);}}
    if(req.method==='GET'){ let file=url.pathname==='/'?'/public/index.html':url.pathname; const full=path.normalize(path.join(root,file)); if(!full.startsWith(path.join(root,'public'))) return send(res,403,'Forbidden','text/plain'); if(fs.existsSync(full)){let body=fs.readFileSync(full);if(path.extname(full)==='.html')body=Buffer.from(body.toString().replace('</body>','<script src="/public/overrides.js"></script><script src="/public/autofill-fix.js"></script><script src="/public/ui-fix.js"></script><script src="/public/reports.js"></script><script src="/public/individual-report.js"></script><script src="/public/login-logo-fix.js"></script></body>'));return send(res,200,body,mime[path.extname(full)]||'application/octet-stream');} }
    send(res,404,{erro:'Rota não encontrada.'});
  }catch(e){ console.error(e); send(res,500,{erro:'Erro interno do servidor.'}); }
});
server.listen(PORT,()=>console.log(`Controle de trocas em http://localhost:${PORT}`));
