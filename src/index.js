import {hashPassword,verifyPassword,hashToken,asCents,summarize} from './logic.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
const response=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
const fail=(message,status=400)=>response({error:message},status);
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const text=(value,max=240)=>String(value??'').trim().slice(0,max);
const date=(value)=>{let s=text(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(new Date(s+'T00:00:00Z').getTime())||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('Date invalide');return s};
const cents=(value,allowZero=false)=>{let n=asCents(value);if(n===null||n<0||(!allowZero&&n===0)||n>1_000_000_000_00)throw Error('Montant invalide');return n};
const own=(v)=>['ELF','LARBI'].includes(v)?v:(()=>{throw Error('Propriétaire invalide')})();
const validRole=(r)=>['admin','editor','viewer'].includes(r);
const requireField=(value,label)=>{const s=text(value);if(!s)throw Error(`${label} obligatoire`);return s};
const dbget=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const dball=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
async function audit(db,user,action,entity,id,before,after){await db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').bind(uid(),user.id,action,entity,id,before?JSON.stringify(before):null,after?JSON.stringify(after):null,now()).run()}
async function site(db,id){let s=await dbget(db,'SELECT * FROM sites WHERE id=?',id);if(!s)throw Error('Chantier introuvable');return s}
async function party(db,id){let s=await dbget(db,'SELECT * FROM parties WHERE id=?',id);if(!s)throw Error('Fournisseur / intervenant introuvable');return s}
function cookie(token,maxAge){return `elf_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`}
async function session(request,db){const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)elf_session=([^;]+)/)?.[1];if(!token)return null;const s=await dbget(db,'SELECT u.id,u.name,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?',await hashToken(decodeURIComponent(token)),now());return s?.active?s:null}
function checkWrite(u){if(u.role==='viewer')throw Error('Accès lecture seule')}
function checkAdmin(u){if(u.role!=='admin')throw Error('Administrateur requis')}
const allowed={sites:['name','phone','progress'],parties:['name','phone'],quotes:['type','amount','date','note'],receipts:['amount','date','note'],expenses:['type','description','amount','date','note'],payments:['amount','payer','date','note'],larbi_transfers:['direction','amount','date','note']};
async function getData(db){const [sites,parties,quotes,receipts,expenses,payments,transfers]=await Promise.all([
 dball(db,'SELECT * FROM sites WHERE archived=0 ORDER BY name COLLATE NOCASE'),
 dball(db,'SELECT * FROM parties WHERE archived=0 ORDER BY name COLLATE NOCASE'),
 dball(db,'SELECT * FROM quotes WHERE canceled=0 ORDER BY date DESC,created_at DESC'),
 dball(db,'SELECT * FROM receipts WHERE canceled=0 ORDER BY date DESC,created_at DESC'),
 dball(db,'SELECT * FROM expenses WHERE canceled=0 ORDER BY date DESC,created_at DESC'),
 dball(db,'SELECT * FROM payments WHERE canceled=0 ORDER BY date DESC,created_at DESC'),
 dball(db,'SELECT * FROM larbi_transfers WHERE canceled=0 ORDER BY date DESC,created_at DESC')]);
return {sites,parties,quotes,receipts,expenses,payments,transfers,totals:summarize({sites,parties,quotes,receipts,expenses,payments,transfers})}}
async function handle(request,env){const url=new URL(request.url),path=url.pathname,method=request.method,db=env.DB;if(!db)return fail('Base D1 non reliée : configurer le binding DB dans Cloudflare.',503);
 if(path==='/api/health')return response({status:'ok',database:true});
 if(path==='/api/setup-state'&&method==='GET'){const row=await dbget(db,'SELECT COUNT(*) count FROM users');return response({needsSetup:!row.count})}
 if(path==='/api/setup'&&method==='POST'){
  if(!env.SETUP_TOKEN||env.SETUP_TOKEN.length<20)return fail('Configurer le secret SETUP_TOKEN (20 caractères minimum) dans Cloudflare.',503);
  const data=await request.json(),count=await dbget(db,'SELECT COUNT(*) count FROM users');if(count.count)return fail('Administrateur déjà créé',403);
  if(data.setupToken!==env.SETUP_TOKEN)return fail('Code de première installation incorrect',403);
  const email=text(data.email,200).toLowerCase(),password=String(data.password||'');if(!/^\S+@\S+\.\S+$/.test(email)||password.length<12)return fail('E-mail valide et mot de passe de 12 caractères minimum requis');
  const {salt,hash}=await hashPassword(password);await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1,?)').bind(uid(),email,requireField(data.name,'Nom'),'admin',salt,hash,now()).run();return response({ok:true})
 }
 if(path==='/api/login'&&method==='POST'){
  const b=await request.json(),email=text(b.email,200).toLowerCase(),u=await dbget(db,'SELECT * FROM users WHERE email=?',email);
  if(!u||!u.active||!(await verifyPassword(String(b.password||''),u.salt,u.password_hash)))return fail('Identifiants incorrects',401);
  const token=uid()+'.'+uid(),idHash=await hashToken(token);await db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(idHash,u.id,new Date(Date.now()+7*86400000).toISOString()).run();return response({user:{id:u.id,name:u.name,role:u.role,email:u.email} },200,{'set-cookie':cookie(token,7*86400)})
 }
 const user=await session(request,db);if(!user)return fail('Connexion nécessaire',401);
 if(path==='/api/me'&&method==='GET')return response({user});
 if(path==='/api/logout'&&method==='POST'){const token=(request.headers.get('cookie')||'').match(/elf_session=([^;]+)/)?.[1];if(token)await db.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await hashToken(decodeURIComponent(token))).run();return response({ok:true},200,{'set-cookie':cookie('',0)})}
 if(path==='/api/data'&&method==='GET')return response(await getData(db));
 if(path==='/api/audit'&&method==='GET'){checkAdmin(user);const rows=await dball(db,'SELECT a.*,u.name user_name FROM audit a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 150');return response(rows)}
 if(path==='/api/users'&&method==='GET'){checkAdmin(user);return response(await dball(db,'SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at'))}
 if(path==='/api/users'&&method==='POST'){checkAdmin(user);const b=await request.json(),email=text(b.email,200).toLowerCase(),password=String(b.password||'');if(!/^\S+@\S+\.\S+$/.test(email)||password.length<12||!validRole(b.role))throw Error('E-mail, rôle ou mot de passe invalide (12 caractères minimum)');const p=await hashPassword(password),id=uid();await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1,?)').bind(id,email,requireField(b.name,'Nom'),b.role,p.salt,p.hash,now()).run();await audit(db,user,'create','users',id,null,{email,role:b.role});return response({ok:true})}
 if(path==='/api/password'&&method==='POST'){const b=await request.json(),u=await dbget(db,'SELECT * FROM users WHERE id=?',user.id);if(!await verifyPassword(String(b.oldPassword||''),u.salt,u.password_hash))return fail('Ancien mot de passe incorrect',403);if(String(b.newPassword||'').length<12)throw Error('12 caractères minimum');const p=await hashPassword(String(b.newPassword));await db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').bind(p.salt,p.hash,u.id).run();await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();return response({ok:true},200,{'set-cookie':cookie('',0)})}
 if(path==='/api/create'&&method==='POST'){
 checkWrite(user);const b=await request.json(),kind=text(b.kind),id=uid(),created=now();let record;
 switch(kind){
 case 'sites': record={id,name:requireField(b.name,'Nom'),owner:own(b.owner),phone:text(b.phone,40),progress:'saisie',archived:0,created_at:created};await db.prepare('INSERT INTO sites VALUES (?,?,?,?,?,?,?)').bind(id,record.name,record.owner,record.phone,record.progress,0,created).run();break;
 case 'parties':record={id,kind:['supplier','worker'].includes(b.type)?b.type:'supplier',name:requireField(b.name,'Nom'),phone:text(b.phone,40),created_at:created,archived:0};await db.prepare('INSERT INTO parties VALUES (?,?,?,?,?,0)').bind(id,record.kind,record.name,record.phone,created).run();break;
 case 'quotes':{let s=await site(db,b.site_id),recordType=['devis','avenant'].includes(b.type)?b.type:'devis';if(s.owner!=='ELF')throw Error('Devis uniquement pour les chantiers ELF');record={id,site_id:s.id,type:recordType,amount:cents(b.amount,true),date:date(b.date),note:text(b.note,500),created_at:created};await db.prepare('INSERT INTO quotes VALUES (?,?,?,?,?,?,0,?)').bind(id,s.id,record.type,record.amount,record.date,record.note,created).run();break}
 case 'receipts':{let s=await site(db,b.site_id);if(s.owner!=='ELF')throw Error('Encaissements clients uniquement pour les chantiers ELF');record={id,site_id:s.id,amount:cents(b.amount),date:date(b.date),note:text(b.note,500),created_at:created};await db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?,0,?)').bind(id,s.id,record.amount,record.date,record.note,created).run();break}
 case 'expenses':{
 let s=b.site_id?await site(db,b.site_id):null,typ=['supplier','worker','other'].includes(b.type)?b.type:'supplier';if(!s&&typ!=='other')throw Error('Chantier requis');if(!s&&b.owner!=='ELF')throw Error('Frais généraux réservés à ELF');let p=b.party_id?await party(db,b.party_id):null;if(typ!=='other'&&!p)throw Error('Choisir un fournisseur ou intervenant');
 record={id,site_id:s?.id||null,party_id:p?.id||null,type:typ,description:requireField(b.description,'Description'),amount:cents(b.amount),date:date(b.date),note:text(b.note,500),created_at:created};await db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,0,?)').bind(id,record.site_id,record.party_id,typ,record.description,record.amount,record.date,record.note,created).run();break}
 case 'payments':{
 const e=await dbget(db,'SELECT * FROM expenses WHERE id=? AND canceled=0',b.expense_id);if(!e)throw Error('Dépense introuvable');const s=e.site_id?await site(db,e.site_id):{owner:'ELF'};let payer=own(b.payer),amount=cents(b.amount),sum=await dbget(db,'SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE expense_id=? AND canceled=0',e.id);if(sum.paid+amount>e.amount)throw Error('Le règlement dépasse le solde restant');if(s.owner==='LARBI'&&payer==='ELF')throw Error('Paiement ELF sur chantier personnel Larbi non pris en charge');record={id,expense_id:e.id,amount,payer,date:date(b.date),note:text(b.note,500),created_at:created};await db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,0,?)').bind(id,e.id,amount,payer,record.date,record.note,created).run();break}
 case 'larbi_transfers':{
 const direction=['advance','repayment'].includes(b.direction)?b.direction:null;if(!direction)throw Error('Type de mouvement invalide');if(b.site_id){const s=await site(db,b.site_id);if(s.owner!=='ELF')throw Error('Avance liée uniquement à un chantier ELF')}record={id,direction,amount:cents(b.amount),date:date(b.date),site_id:b.site_id||null,note:text(b.note,500),created_at:created};await db.prepare('INSERT INTO larbi_transfers VALUES (?,?,?,?,?,?,0,?)').bind(id,direction,record.amount,record.date,record.site_id,record.note,created).run();break}
 default:throw Error('Opération inconnue')}
 await audit(db,user,'create',kind,id,null,record);return response({ok:true,id});
 }
 if(path==='/api/update'&&method==='POST'){
 checkWrite(user);const b=await request.json(),kind=text(b.kind),id=text(b.id);if(!allowed[kind]||!id)throw Error('Modification non autorisée');const old=await dbget(db,`SELECT * FROM ${kind} WHERE id=?`,id);if(!old)throw Error('Information introuvable');if(!['sites','parties'].includes(kind)&&old.canceled)throw Error('Écriture annulée');if(kind==='sites'&&b.changes?.owner!==undefined)throw Error('Le propriétaire du chantier est verrouillé pour éviter les transferts accidentels');
 let ch=b.changes||{},keys=Object.keys(ch).filter(k=>allowed[kind].includes(k));if(!keys.length)throw Error('Aucune modification');let vals=[];for(const k of keys){let v=ch[k];if(k==='amount')v=cents(v,kind==='quotes');else if(k==='date')v=date(v);else if(k==='progress'){if(!['saisie','verifie'].includes(v))throw Error('Statut incorrect')}else if(k==='payer'){if(!['ELF','LARBI'].includes(v))throw Error('Payeur invalide');const e=await dbget(db,'SELECT * FROM expenses WHERE id=?',old.expense_id);const s=e?.site_id?await site(db,e.site_id):{owner:'ELF'};if(s.owner==='LARBI'&&v==='ELF')throw Error('Paiement ELF sur chantier personnel Larbi non pris en charge')}else if(k==='type'&&kind==='quotes'){if(!['devis','avenant'].includes(v))throw Error('Type de devis invalide')}else if(k==='type'&&kind==='expenses'){if(!['supplier','worker','other'].includes(v))throw Error('Type de dépense invalide')}else if(k==='direction'){if(!['advance','repayment'].includes(v))throw Error('Direction invalide')}else if(k==='name'||k==='description')v=requireField(v,k);else v=text(v,k==='note'?500:240);vals.push(v)}
 if(kind==='payments'&&keys.includes('amount')){const e=await dbget(db,'SELECT amount FROM expenses WHERE id=?',old.expense_id),other=await dbget(db,'SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE expense_id=? AND id<>? AND canceled=0',old.expense_id,id);if(other.paid+vals[keys.indexOf('amount')]>e.amount)throw Error('Paiements supérieurs à la dépense')}
 if(kind==='expenses'&&keys.includes('amount')){const paid=await dbget(db,'SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE expense_id=? AND canceled=0',id);if(paid.paid>vals[keys.indexOf('amount')])throw Error('Montant inférieur aux paiements enregistrés')}
 await db.prepare(`UPDATE ${kind} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).bind(...vals,id).run();await audit(db,user,'update',kind,id,old,{...old,...Object.fromEntries(keys.map((k,i)=>[k,vals[i]]))});return response({ok:true})
 }
 if(path==='/api/cancel'&&method==='POST'){
 checkWrite(user);const b=await request.json(),kind=text(b.kind),id=text(b.id);if(!['quotes','receipts','expenses','payments','larbi_transfers'].includes(kind))throw Error('Annulation non autorisée');const old=await dbget(db,`SELECT * FROM ${kind} WHERE id=?`,id);if(!old||old.canceled)throw Error('Opération introuvable');if(kind==='expenses'){const paid=await dbget(db,'SELECT COUNT(*) n FROM payments WHERE expense_id=? AND canceled=0',id);if(paid.n)throw Error('Annuler les paiements liés avant la dépense')}
 await db.prepare(`UPDATE ${kind} SET canceled=1 WHERE id=?`).bind(id).run();await audit(db,user,'cancel',kind,id,old,{...old,canceled:1});return response({ok:true})
 }
 if(path==='/api/archive'&&method==='POST'){
 checkWrite(user);const b=await request.json(),kind=text(b.kind),id=text(b.id),archive=b.archive!==false;
 if(!['sites','parties'].includes(kind))throw Error('Archivage non autorisé');
 const old=await dbget(db,`SELECT * FROM ${kind} WHERE id=?`,id);if(!old)throw Error('Introuvable');
 if(archive&&kind==='sites'){const linked=await dbget(db,'SELECT COUNT(*) n FROM expenses WHERE site_id=? AND canceled=0',id);if(linked.n)throw Error('Solder les dépenses avant d’archiver ce chantier')}
 if(archive&&kind==='parties'){const linked=await dbget(db,'SELECT COUNT(*) n FROM expenses WHERE party_id=? AND canceled=0',id);if(linked.n)throw Error('Solder les dépenses liées avant d’archiver ce fournisseur')}
 await db.prepare(`UPDATE ${kind} SET archived=? WHERE id=?`).bind(archive?1:0,id).run();
 await audit(db,user,archive?'archive':'restore',kind,id,old,{...old,archived:archive?1:0});return response({ok:true})
 }
 if(path==='/api/users/toggle'&&method==='POST'){
 checkAdmin(user);const b=await request.json(),id=text(b.id);if(id===user.id)throw Error('Impossible de désactiver son propre compte');
 const u=await dbget(db,'SELECT * FROM users WHERE id=?',id);if(!u)throw Error('Utilisateur introuvable');
 const active=u.active?0:1;await db.prepare('UPDATE users SET active=? WHERE id=?').bind(active,id).run();
 if(!active)await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
 await audit(db,user,active?'activate':'deactivate','users',id,{active:u.active},{active});return response({ok:true,active})
 }
 return fail('Route inconnue',404)
}
export default {async fetch(request,env){const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('Assets manquants',{status:503});if(!['GET','POST'].includes(request.method))return fail('Méthode non autorisée',405);if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return fail('Origine non autorisée',403);try{return await handle(request,env)}catch(e){console.error('API error',e);if(e?.message?.includes('no such table'))return fail('Base de données non initialisée : exécuter la migration D1.',503);if(e?.message?.includes('UNIQUE constraint'))return fail('Cet élément existe déjà',409);if(e?.message?.includes('FOREIGN KEY constraint'))return fail('Opération liée à une autre information',409);if(e instanceof SyntaxError)return fail('Format de saisie incorrect',400);return fail(e?.message||'Erreur du serveur',e?.message?.includes('Accès')||e?.message?.includes('Administrateur')?403:400)}}};
