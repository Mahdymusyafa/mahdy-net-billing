
const MONTHS=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const DB_NAME="mahdy_net_billing_safe";
const DB_VERSION=3;
const CLIENT_ID="1048608388100-1jghinhuoff1necs78hd44h7ql0rjhj7.apps.googleusercontent.com";
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.file";
const LEGACY_MAIN_FILE="mahdy-net-data.json";
const ROOT_FOLDER="MAHDY-NET Billing";
const V8_SCHEMA=8;
const APP_VERSION="8.3";
const WA_STATUS_SCHEMA=3;
const BOT_SERVICE_ACCOUNT="mahdy-net-bot@mahdy-net-billing.iam.gserviceaccount.com";
const BACKUP_PREFIX="MAHDY-NET_Backup_";
const SNAPSHOT_PREFIX="SNAPSHOT_";
let db,currentPage=1,selectedYear=new Date().getFullYear(),editingCustomerId=null,detailCustomerId=null,editingPackageId=null,paymentCtx=null;
let mobileSelectedMonth=new Date().getMonth();
let googleTokenClient=null,googleAccessToken=null,cloudSnapshot=null;
const GOOGLE_SESSION_KEY="mahdy_google_session_v1";
let googleAccountLabel="";
let pendingAccountSwitch=false;

const $=id=>document.getElementById(id);
function money(n){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0))}
function normalizeWhatsApp(v){
  let d=String(v||"").replace(/\D/g,"");
  if(!d)return "";
  if(d.startsWith("62"))return d;
  if(d.startsWith("0"))return "62"+d.slice(1);
  if(d.startsWith("8"))return "62"+d;
  return d;
}

function ymdLocal(date=new Date()){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function monthKey(y,m){return `${y}-${String(m+1).padStart(2,"0")}`}
function parsePeriod(k){const [y,m]=k.split("-").map(Number);return{year:y,month:m-1}}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),1800)}
function openModal(id){$(id).classList.add("show")}
function closeModal(id){$(id).classList.remove("show");if(id==="customerFormModal")editingCustomerId=null;if(id==="customerDetailModal")detailCustomerId=null}
function nowISO(){return new Date().toISOString()}

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      const tx=e.target.transaction;
      const packages=d.objectStoreNames.contains("packages")?tx.objectStore("packages"):d.createObjectStore("packages",{keyPath:"id",autoIncrement:true});
      const customers=d.objectStoreNames.contains("customers")?tx.objectStore("customers"):d.createObjectStore("customers",{keyPath:"id",autoIncrement:true});
      const payments=d.objectStoreNames.contains("payments")?tx.objectStore("payments"):d.createObjectStore("payments",{keyPath:"id",autoIncrement:true});
      if(!d.objectStoreNames.contains("meta"))d.createObjectStore("meta",{keyPath:"key"});
      if(!d.objectStoreNames.contains("current"))d.createObjectStore("current",{keyPath:"customerId"});
      if(!d.objectStoreNames.contains("summary"))d.createObjectStore("summary",{keyPath:"key"});
      const events=d.objectStoreNames.contains("events")?tx.objectStore("events"):d.createObjectStore("events",{keyPath:"eventId"});
      const paymentStates=d.objectStoreNames.contains("paymentStates")?tx.objectStore("paymentStates"):d.createObjectStore("paymentStates",{keyPath:"invoiceId"});
      if(!events.indexNames.contains("byAt"))events.createIndex("byAt","at",{unique:false});
      if(!events.indexNames.contains("byType"))events.createIndex("byType","type",{unique:false});
      if(!events.indexNames.contains("byEntity"))events.createIndex("byEntity","entityKey",{unique:false});
      if(!payments.indexNames.contains("byCustomer"))payments.createIndex("byCustomer","customerId",{unique:false});
      if(!payments.indexNames.contains("byPeriod"))payments.createIndex("byPeriod","period",{unique:false});
      if(!payments.indexNames.contains("byCustomerPeriod"))payments.createIndex("byCustomerPeriod",["customerId","period"],{unique:false});
      if(!payments.indexNames.contains("byDate"))payments.createIndex("byDate","date",{unique:false});
      if(!customers.indexNames.contains("byCode"))customers.createIndex("byCode","customerCode",{unique:true});
    };
    r.onsuccess=()=>{db=r.result;resolve()};
    r.onerror=()=>reject(r.error);
  });
}
function all(store){return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function getOne(store,key){return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,val){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).put(val);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function add(store,val){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).add(val);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function del(store,key){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function clearStore(store){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function indexGetAll(store,indexName,key){return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).index(indexName).getAll(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function indexGet(store,indexName,key){return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).index(indexName).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function touchData(){
  const m=await getOne("meta","state")||{key:"state",revision:0};
  m.revision=(m.revision||0)+1;m.modifiedAt=nowISO();
  await put("meta",m);renderLocalStatus();
}
async function getState(){return await getOne("meta","state")||{key:"state",revision:0,modifiedAt:null}}
async function renderLocalStatus(){
  const s=await getState();
  $("localSaveStatus").textContent=s.modifiedAt?"Tersimpan otomatis · "+new Intl.DateTimeFormat("id-ID",{hour:"2-digit",minute:"2-digit"}).format(new Date(s.modifiedAt)):"Tersimpan otomatis";
}
function customerCodeNumber(code){const m=String(code||"").match(/^C(\d+)$/i);return m?Number(m[1]):0}
function formatCustomerCode(n){return "C"+String(n).padStart(6,"0")}
async function ensureCustomerCodes(){
  const cs=(await all("customers")).sort((a,b)=>Number(a.id)-Number(b.id));
  let seq=0,changed=false;
  for(const c of cs)seq=Math.max(seq,customerCodeNumber(c.customerCode));
  for(const c of cs){if(!c.customerCode){c.customerCode=formatCustomerCode(++seq);await put("customers",c);changed=true}}
  const m=await getOne("meta","customerSeq")||{key:"customerSeq",value:0};m.value=Math.max(Number(m.value||0),seq);await put("meta",m);
  if(changed){const st=await getState();if(!st.modifiedAt)await touchData()}
}
async function nextCustomerCode(){
  const m=await getOne("meta","customerSeq")||{key:"customerSeq",value:0};m.value=Number(m.value||0)+1;await put("meta",m);return formatCustomerCode(m.value)
}

function firstBillPeriod(c){const d=new Date(c.firstBillDate+"T00:00:00");return{year:d.getFullYear(),month:d.getMonth()}}
function periodCompare(y,m,y2,m2){return y===y2?m-m2:y-y2}
function dueDate(c,y,m){
  const first=new Date(c.firstBillDate+"T00:00:00"),day=first.getDate(),last=new Date(y,m+1,0).getDate();
  return new Date(y,m,Math.min(day,last));
}
async function paymentFor(customerId,period){
  return await indexGet("payments","byCustomerPeriod",[customerId,period])||null;
}
async function paymentsForCustomer(customerId){return await indexGetAll("payments","byCustomer",customerId)}
async function paymentsForPeriod(period){return await indexGetAll("payments","byPeriod",period)}
async function paymentsForCustomerYear(customerId,year){return (await paymentsForCustomer(customerId)).filter(p=>String(p.period||"").startsWith(year+"-"))}
function previousMonthKey(y,m){const d=new Date(y,m-1,1);return monthKey(d.getFullYear(),d.getMonth())}
function invoiceId(c,y,m){return `${c.customerCode||("C"+c.id)}-${monthKey(y,m)}`}
async function buildCurrentRecord(c,now=new Date()){
  const y=now.getFullYear(),m=now.getMonth(),billingPeriod=monthKey(y,m),ps=await paymentsForCustomer(c.id),paidSet=new Set(ps.map(p=>p.period));
  const first=firstBillPeriod(c);let arrears=[];
  for(let yy=first.year;yy<=y;yy++){const from=yy===first.year?first.month:0,to=yy===y?m:11;for(let mm=from;mm<=to;mm++){const per=monthKey(yy,mm);if(paidSet.has(per))continue;const d=dueDate(c,yy,mm);d.setHours(0,0,0,0);const t=new Date(now);t.setHours(0,0,0,0);if(t>d)arrears.push(per)}}
  const payment=ps.find(p=>p.period===billingPeriod)||null;
  const invId=invoiceId(c,y,m),paymentState=await getOne("paymentStates",invId);
  const status=payment?"paid":await statusFor(c,y,m);const bill=dueDate(c,y,m);
  return{customerId:c.id,customerCode:c.customerCode,name:c.name,whatsapp:c.whatsapp||"",billingPeriod,usagePeriod:previousMonthKey(y,m),invoiceId:invId,billingDate:ymdLocal(bill),amount:Number(c.monthlyPrice||0),status,paymentAmount:payment?Number(payment.amount||0):0,paymentDate:payment?.date||null,paymentStateEventId:paymentState?.eventId||null,paymentStatusAt:paymentState?.at||null,paymentSource:paymentState?.source||null,paymentCycle:Number(paymentState?.cycle||0),arrearsCount:arrears.length,arrearsPeriods:arrears,updatedAt:nowISO()};
}
async function refreshCurrentForCustomer(customerId){const c=await getOne("customers",customerId);if(!c||c.active===false){await del("current",customerId);return}await put("current",await buildCurrentRecord(c))}
async function rebuildCurrentSnapshot(force=false){
  const today=ymdLocal(),meta=await getOne("meta","currentSnapshot"),cs=(await all("customers")).filter(c=>c.active!==false),cur=await all("current");
  if(!force&&meta?.date===today&&cur.length===cs.length)return;
  await clearStore("current");for(const c of cs)await put("current",await buildCurrentRecord(c));
  await put("meta",{key:"currentSnapshot",date:today,updatedAt:nowISO()});await rebuildSummary();
}
async function rebuildSummary(){
  const rows=await all("current");let paid=0,issued=0,arrearsCustomers=0,revenue=0;for(const r of rows){if(r.status==="paid"){paid++;revenue+=Number(r.paymentAmount||0)}if(r.status==="issued")issued++;if(r.arrearsCount>0)arrearsCustomers++}
  const x={key:"current",date:ymdLocal(),customers:rows.length,paid,issued,arrearsCustomers,revenue,updatedAt:nowISO()};await put("summary",x);return x
}
async function statusFor(c,y,m){
  const first=firstBillPeriod(c);
  if(periodCompare(y,m,first.year,first.month)<0)return"inactive";
  if(await paymentFor(c.id,monthKey(y,m)))return"paid";
  const today=new Date();today.setHours(0,0,0,0);
  const due=dueDate(c,y,m);due.setHours(0,0,0,0);
  if(today<due)return"future";
  if(today.getTime()===due.getTime())return"issued";
  return"arrears";
}
function statusLabel(s){return{paid:"✓ Lunas",issued:"Tagihan terbit",arrears:"Tunggak",future:"Belum ditagih",inactive:"—"}[s]}
async function seedPackages(){
  if((await all("packages")).length)return;
  await add("packages",{name:"Hemat",speed:"5 Mbps",price:100000});
  await add("packages",{name:"Reguler",speed:"10 Mbps",price:150000});
  await add("packages",{name:"Premium",speed:"20 Mbps",price:250000});
  await touchData();
}
function initYears(){
  const s=$("yearSelect"),y=new Date().getFullYear();s.innerHTML="";
  for(let i=y-3;i<=y+4;i++){const o=document.createElement("option");o.value=i;o.textContent=i;if(i===selectedYear)o.selected=true;s.appendChild(o)}
}
function initDefaultDates(){
  const t=new Date();$("fRegistrationDate").value=ymdLocal(t);$("fStartDate").value=ymdLocal(t);
  const n=new Date(t.getFullYear(),t.getMonth()+1,t.getDate());$("fFirstBillDate").value=ymdLocal(n);
}
async function fillPackageSelect(id,selected=null){
  const s=$(id);s.innerHTML="";
  for(const p of await all("packages")){const o=document.createElement("option");o.value=p.id;o.textContent=`${p.name} — ${p.speed} — ${money(p.price)}`;if(Number(selected)===Number(p.id))o.selected=true;s.appendChild(o)}
}
async function renderPackages(){
  const grid=$("packageGrid"),ps=await all("packages");grid.innerHTML="";
  if(!ps.length){grid.innerHTML='<div class="empty-state">Belum ada paket.</div>';return}
  ps.forEach(p=>{
    const d=document.createElement("article");d.className="package-card";
    d.innerHTML=`<span class="speed">${p.speed}</span><h3>${p.name}</h3><div class="price">${money(p.price)}</div><div class="package-actions"><button class="btn subtle edit-package" data-id="${p.id}">✎ Edit</button><button class="btn danger delete-package" data-id="${p.id}">Hapus</button></div>`;
    grid.appendChild(d);
  });
  grid.querySelectorAll(".edit-package").forEach(b=>b.addEventListener("click",()=>openPackageForm(Number(b.dataset.id))));
  grid.querySelectorAll(".delete-package").forEach(b=>b.addEventListener("click",()=>deletePackage(Number(b.dataset.id))));
}
async function openPackageForm(id=null){
  editingPackageId=id;
  if(id){
    const p=(await all("packages")).find(x=>x.id===id);if(!p)return;
    $("packageFormTitle").textContent="Edit paket";$("fPackageName").value=p.name;$("fPackageSpeed").value=p.speed;$("fPackagePrice").value=p.price;
  }else{
    $("packageFormTitle").textContent="Tambah paket";$("fPackageName").value="";$("fPackageSpeed").value="";$("fPackagePrice").value="";
  }
  openModal("packageFormModal");
}
async function savePackage(){
  const name=$("fPackageName").value.trim(),speed=$("fPackageSpeed").value.trim(),price=Number($("fPackagePrice").value.replace(/\D/g,""));
  if(!name||!speed||!price){toast("Lengkapi data paket");return}
  if(editingPackageId){
    const p=(await all("packages")).find(x=>x.id===editingPackageId);Object.assign(p,{name,speed,price,updatedAt:nowISO()});await put("packages",p);
  }else await add("packages",{name,speed,price,createdAt:nowISO()});
  await touchData();closeModal("packageFormModal");await renderAll();toast("Paket disimpan");
}
async function deletePackage(id){
  if((await all("customers")).some(c=>c.packageId===id)){alert("Paket masih digunakan pelanggan. Edit pelanggan terlebih dahulu.");return}
  if(confirm("Hapus paket ini?")){await del("packages",id);await touchData();await renderAll()}
}

async function openCustomerForm(id=null){
  editingCustomerId=id;await fillPackageSelect("fCustomerPackage");
  if(id){
    const c=(await all("customers")).find(x=>x.id===id);if(!c)return;
    $("customerFormTitle").textContent="Edit pelanggan";$("fCustomerName").value=c.name;$("fCustomerWhatsapp").value=c.whatsapp||"";await fillPackageSelect("fCustomerPackage",c.packageId);
    $("fCustomerPrice").value=c.customPrice||"";$("fRegistrationDate").value=c.registrationDate;$("fStartDate").value=c.startDate;$("fFirstBillDate").value=c.firstBillDate;
  }else{
    $("customerFormTitle").textContent="Tambah pelanggan";$("fCustomerName").value="";$("fCustomerWhatsapp").value="";$("fCustomerPrice").value="";initDefaultDates();
  }
  openModal("customerFormModal");
}
async function saveCustomer(){
  const targetIdBeforeSave=editingCustomerId;
  const name=$("fCustomerName").value.trim(),whatsapp=normalizeWhatsApp($("fCustomerWhatsapp").value),packageId=Number($("fCustomerPackage").value),reg=$("fRegistrationDate").value,start=$("fStartDate").value,first=$("fFirstBillDate").value;
  if(!name||!packageId||!reg||!start||!first){toast("Lengkapi data pelanggan");return}
  const pkg=(await all("packages")).find(x=>x.id===packageId);if(!pkg)return;
  const customPrice=Number($("fCustomerPrice").value.replace(/\D/g,""))||null;
  let savedCustomerId=targetIdBeforeSave;
  if(targetIdBeforeSave!=null){
    const c=(await all("customers")).find(x=>x.id===targetIdBeforeSave);
    if(!c){toast("Pelanggan tidak ditemukan");editingCustomerId=null;return}
    Object.assign(c,{name,whatsapp,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first,updatedAt:nowISO()});
    await put("customers",c);
  }else{
    savedCustomerId=await add("customers",{customerCode:await nextCustomerCode(),name,whatsapp,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first,active:true,createdAt:nowISO()});
  }
  editingCustomerId=null;
  await touchData();
  if(savedCustomerId!=null)await refreshCurrentForCustomer(savedCustomerId);
  await rebuildSummary();
  closeModal("customerFormModal");
  await renderAll();
  toast("Pelanggan disimpan");
}

function customerMonthState(c,year,month,paidSet){
  const period=monthKey(year,month),first=firstBillPeriod(c);if(periodCompare(year,month,first.year,first.month)<0)return'inactive';if(paidSet.has(period))return'paid';
  const today=new Date();today.setHours(0,0,0,0);const due=dueDate(c,year,month);due.setHours(0,0,0,0);return today<due?'future':today.getTime()===due.getTime()?'issued':'arrears';
}
async function renderCustomerTable(){
  const tr=$("customerHeader");while(tr.children.length>2)tr.removeChild(tr.lastChild);
  MONTHS.forEach(m=>{const th=document.createElement("th");th.textContent=m;tr.appendChild(th)});
  const q=$("customerSearch").value.trim().toLowerCase();
  const activeCustomers=(await all("customers")).filter(c=>c.active!==false);$('customerTotalCount').textContent=activeCustomers.length;
  let customers=activeCustomers.filter(c=>c.name.toLowerCase().includes(q)||String(c.customerCode||'').toLowerCase().includes(q));
  const mobilePeriod=monthKey(selectedYear,mobileSelectedMonth),mobilePaidIds=new Set((await paymentsForPeriod(mobilePeriod)).map(p=>p.customerId));
  const mobileStateOf=c=>customerMonthState(c,selectedYear,mobileSelectedMonth,mobilePaidIds.has(c.id)?new Set([mobilePeriod]):new Set());
  const statusFilter=$('customerStatusFilter')?.value||'all';
  if(statusFilter!=='all'){
    customers=customers.filter(c=>{const s=mobileStateOf(c);return statusFilter==='paid'?s==='paid':statusFilter==='arrears'?s==='arrears':s!=='paid'&&s!=='inactive'});
  }
  const sort=$('customerSort')?.value||'default';if(sort==='name')customers.sort((a,b)=>a.name.localeCompare(b.name,'id'));if(sort==='status'){const rank={arrears:0,issued:1,future:2,paid:3,inactive:4};customers.sort((a,b)=>rank[mobileStateOf(a)]-rank[mobileStateOf(b)]||a.name.localeCompare(b.name,'id'))}
  const size=Number($("pageSize").value),pages=Math.max(1,Math.ceil(customers.length/size));currentPage=Math.min(currentPage,pages);
  const start=(currentPage-1)*size,page=customers.slice(start,start+size),body=$("customerRows"),mobileList=$('mobileCustomerList');body.innerHTML="";mobileList.innerHTML="";$('mobileMonthLabel').textContent=`${MONTHS[mobileSelectedMonth]} ${selectedYear}`;
  for(let i=0;i<page.length;i++){
    const c=page[i],paidSet=new Set((await paymentsForCustomerYear(c.id,selectedYear)).map(p=>p.period)),row=document.createElement("tr");
    row.innerHTML=`<td>${start+i+1}</td><td><span class="customer-link" data-id="${c.id}">${c.name}</span><div class="row-meta">${c.customerCode} · ${c.speed} · ${money(c.monthlyPrice)}${c.whatsapp?` · WA ${c.whatsapp}`:""}</div></td>`;
    for(let m=0;m<12;m++){
      const td=document.createElement("td"),period=monthKey(selectedYear,m);let st;
      st=customerMonthState(c,selectedYear,m,paidSet);
      const now=new Date(),next=new Date(now.getFullYear(),now.getMonth()+1,1),isPayablePeriod=(selectedYear===now.getFullYear()&&m===now.getMonth())||(selectedYear===next.getFullYear()&&m===next.getMonth());
      const b=document.createElement("button");b.className=`month-btn ${st}`;b.textContent=st==="future"&&isPayablePeriod?"Bayar lebih awal":statusLabel(st);b.dataset.cid=c.id;b.dataset.month=m;
      if(st==="inactive"||(st==="future"&&!isPayablePeriod))b.disabled=true;else b.addEventListener("click",()=>openPayment(c.id,m));td.appendChild(b);row.appendChild(td);
    }
    body.appendChild(row);
    const mobileState=customerMonthState(c,selectedYear,mobileSelectedMonth,paidSet),pay=mobileState==='paid'?await paymentFor(c.id,monthKey(selectedYear,mobileSelectedMonth)):null,card=document.createElement('article');
    const stateText=mobileState==='paid'?'Lunas':mobileState==='arrears'?'Menunggak':mobileState==='issued'?'Tagihan terbit':mobileState==='inactive'?'Belum aktif':'Belum bayar';
    card.className='mobile-customer-card';card.innerHTML=`<span class="mobile-row-number">${start+i+1}</span><button class="mobile-customer-name" type="button"><b>${c.name}</b><small>${c.customerCode}</small></button><div class="mobile-package"><b>${c.speed}</b><small>${money(c.monthlyPrice)}</small></div><button class="mobile-month-status ${mobileState}" type="button"><b>${mobileState==='paid'?'✓ ':''}${stateText}</b><small>${pay?.date||MONTHS[mobileSelectedMonth]+' '+selectedYear}</small></button><button class="mobile-more" type="button">⋮</button>`;
    card.querySelector('.mobile-customer-name').addEventListener('click',()=>openCustomerDetail(c.id));card.querySelector('.mobile-more').addEventListener('click',()=>openCustomerDetail(c.id));
    const sb=card.querySelector('.mobile-month-status'),now=new Date(),next=new Date(now.getFullYear(),now.getMonth()+1,1),payable=(selectedYear===now.getFullYear()&&mobileSelectedMonth===now.getMonth())||(selectedYear===next.getFullYear()&&mobileSelectedMonth===next.getMonth());if(mobileState==='inactive'||(mobileState==='future'&&!payable))sb.disabled=true;else sb.addEventListener('click',()=>openPayment(c.id,mobileSelectedMonth));mobileList.appendChild(card);
  }
  body.querySelectorAll(".customer-link").forEach(e=>e.addEventListener("click",()=>openCustomerDetail(Number(e.dataset.id))));
  $("pageInfo").textContent=`Menampilkan ${customers.length?start+1:0}–${Math.min(start+size,customers.length)} dari ${customers.length} data`;
  const pb=$("pageButtons");pb.innerHTML="";const maxButtons=7,from=Math.max(1,Math.min(currentPage-3,pages-maxButtons+1)),to=Math.min(pages,from+maxButtons-1);
  for(let p=from;p<=to;p++){const b=document.createElement("button");b.className="page-btn"+(p===currentPage?" active":"");b.textContent=p;b.addEventListener("click",()=>{currentPage=p;renderCustomerTable()});pb.appendChild(b)}
  await renderCustomerFocus(customers);
}
async function renderCustomerFocus(matches){
  const box=$("customerFocus");box.innerHTML="";
  if(!$("customerSearch").value.trim()||matches.length!==1)return;
  const c=matches[0],now=new Date(),cur=await getOne("current",c.id),s=cur?.status||await statusFor(c,now.getFullYear(),now.getMonth()),arrears=cur?.arrearsPeriods||[];
  box.innerHTML=`<div class="focus-card"><h3>${c.name}</h3><div class="focus-meta">${c.customerCode} · ${c.packageName} · ${c.speed} · ${money(c.monthlyPrice)}</div><div class="focus-stats"><div class="focus-stat"><span>Bulan ini</span><b>${statusLabel(s)}</b></div><div class="focus-stat"><span>Tunggakan</span><b>${arrears.length} bulan</b></div><div class="focus-stat"><span>Rincian</span><b>${arrears.length?arrears.map(k=>{const x=parsePeriod(k);return MONTHS[x.month]+" "+x.year}).join(", "):"Tidak ada"}</b></div></div></div>`;
}
async function refreshCurrentForCustomer(customerId){const c=await getOne('customers',customerId);if(!c||c.active===false){await del('current',customerId);return}const events=await allLedgerEvents(),states=await all('paymentStates'),pref={events,states,stateMap:new Map(states.map(x=>[x.invoiceId,x]))};await put('current',await buildCurrentRecord(c,new Date(),pref))}
async function rebuildCurrentSnapshot(force=false){
  const today=ymdLocal(),meta=await getOne('meta','currentSnapshot'),cs=(await all('customers')).filter(c=>c.active!==false),cur=await all('current');if(!force&&meta?.date===today&&cur.length===cs.length)return;const events=await allLedgerEvents(),states=await all('paymentStates'),pref={events,states,stateMap:new Map(states.map(x=>[x.invoiceId,x]))};await clearStore('current');for(const c of cs)await put('current',await buildCurrentRecord(c,new Date(),pref));await put('meta',{key:'currentSnapshot',date:today,updatedAt:nowISO()});await rebuildSummary();
}

async function openPayment(customerId,month){
  const c=(await all("customers")).find(x=>x.id===customerId);if(!c)return;
  const period=monthKey(selectedYear,month),existing=await paymentFor(customerId,period);paymentCtx={customer:c,period,existing};
  $("paymentTitle").textContent=`${c.name} · ${MONTHS[month]} ${selectedYear}`;$("payPeriod").value=`${MONTHS[month]} ${selectedYear}`;
  $("payAmount").value=existing?existing.amount:c.monthlyPrice;$("payDate").value=existing?existing.date:ymdLocal();$("payMethod").value=existing?existing.method:"Tunai";$("payNote").value=existing?.note||"";
  $("deletePaymentBtn").classList.toggle("hidden",!existing);openModal("paymentModal");
}
async function savePayment(){
  if(!paymentCtx)return;const amount=Number($("payAmount").value.replace(/\D/g,""));if(!amount||!$("payDate").value){toast("Lengkapi pembayaran");return}
  if(paymentCtx.existing){Object.assign(paymentCtx.existing,{amount,date:$("payDate").value,method:$("payMethod").value,note:$("payNote").value.trim(),updatedAt:nowISO()});await put("payments",paymentCtx.existing)}
  else await add("payments",{customerId:paymentCtx.customer.id,period:paymentCtx.period,amount,date:$("payDate").value,method:$("payMethod").value,note:$("payNote").value.trim(),createdAt:nowISO()});
  await touchData();await refreshCurrentForCustomer(paymentCtx.customer.id);await rebuildSummary();closeModal("paymentModal");await renderAll();toast("Pembayaran disimpan");
}
async function deletePayment(){
  if(!paymentCtx?.existing)return;if(confirm("Batalkan catatan pembayaran ini?")){const cid=paymentCtx.customer.id;await del("payments",paymentCtx.existing.id);await touchData();await refreshCurrentForCustomer(cid);await rebuildSummary();closeModal("paymentModal");await renderAll()}
}
async function openCustomerDetail(id){
  detailCustomerId=id;const c=(await all("customers")).find(x=>x.id===id);if(!c)return;
  $("detailCustomerName").textContent=c.name;
  $("detailCustomerInfo").innerHTML=`<div class="detail-grid"><div class="detail-cell"><span>Paket</span><b>${c.packageName} · ${c.speed}</b></div><div class="detail-cell"><span>Tarif</span><b>${money(c.monthlyPrice)}</b></div><div class="detail-cell"><span>WhatsApp</span><b>${c.whatsapp||"-"}</b></div><div class="detail-cell"><span>Registrasi</span><b>${c.registrationDate}</b></div><div class="detail-cell"><span>Mulai layanan</span><b>${c.startDate}</b></div><div class="detail-cell"><span>Tagihan pertama</span><b>${c.firstBillDate}</b></div></div>`;
  const ps=(await paymentsForCustomer(id)).sort((a,b)=>b.period.localeCompare(a.period)),hist=$("detailPaymentHistory");hist.innerHTML="";
  if(!ps.length)hist.innerHTML='<div class="empty-state">Belum ada pembayaran.</div>';
  ps.forEach(p=>{const {year,month}=parsePeriod(p.period),d=document.createElement("div");d.className="history-row";d.innerHTML=`<div><b>${MONTHS[month]} ${year}</b><small>${p.date} · ${p.method}</small></div><b>${money(p.amount)}</b>`;hist.appendChild(d)});
  openModal("customerDetailModal");
}
async function renderPayments(){
  const q=$("paymentSearch").value.trim().toLowerCase(),year=Number($("paymentYearSelect")?.value||new Date().getFullYear()),cs=await all("customers"),cmap=new Map(cs.map(c=>[c.id,c])),ps=[];
  for(let m=0;m<12;m++)ps.push(...await paymentsForPeriod(monthKey(year,m)));ps.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const list=$("paymentList");list.innerHTML="";const rows=ps.map(p=>({p,c:cmap.get(p.customerId)})).filter(x=>x.c&&x.c.name.toLowerCase().includes(q));
  if(!rows.length){list.innerHTML='<div class="empty-state">Belum ada pembayaran pada tahun ini.</div>';return}
  rows.slice(0,250).forEach(({p,c})=>{const {year,month}=parsePeriod(p.period),d=document.createElement("div");d.className="payment-item";d.innerHTML=`<div><b>${c.name}</b><small>${c.customerCode} · ${MONTHS[month]} ${year} · ${p.date} · ${p.method}</small></div><b>${money(p.amount)}</b>`;list.appendChild(d)});
  if(rows.length>250){const d=document.createElement("div");d.className="empty-state";d.textContent=`Menampilkan 250 transaksi terbaru dari ${rows.length} transaksi tahun ${year}. Gunakan pencarian untuk mempersempit.`;list.appendChild(d)}
}
async function renderHome(){
  await rebuildCurrentSnapshot();const rows=await all("current"),sum=await getOne("summary","current")||await rebuildSummary(),now=new Date(),y=now.getFullYear(),m=now.getMonth();
  $("homeMonthLabel").textContent=`${MONTHS[m]} ${y}`;$("statCustomers").textContent=sum.customers||0;$("statPaid").textContent=sum.paid||0;$("statIssued").textContent=sum.issued||0;$("statArrears").textContent=sum.arrearsCustomers||0;$("statRevenue").textContent=money(sum.revenue||0);
  $("homeSummary").textContent=sum.customers?`${sum.paid} pelanggan sudah lunas. ${sum.arrearsCustomers} pelanggan perlu diperiksa.`:"Belum ada data pelanggan.";
  const attention=rows.filter(r=>r.status==="issued"||r.arrearsCount>0).sort((a,b)=>b.arrearsCount-a.arrearsCount),list=$("attentionList");list.innerHTML="";
  if(!attention.length){list.innerHTML='<div class="empty-state">Tidak ada tagihan yang perlu perhatian.</div>';return}
  attention.slice(0,8).forEach(r=>{const d=document.createElement("div");d.className="attention-item";d.innerHTML=`<div><b>${r.name}</b><small>${r.customerCode} · ${money(r.amount)}</small></div><span class="status-pill ${r.arrearsCount>0?"red":"amber"}">${r.arrearsCount>0?"Tunggak":"Tagihan terbit"}</span>`;d.addEventListener("click",async()=>{const c=await getOne("customers",r.customerId);showView("customersView");$("customerSearch").value=c?.name||r.name;currentPage=1;renderCustomerTable()});list.appendChild(d)});
}
async function buildBotStatus(){
  const state=await getState(),rows=(await all("current")).map(r=>({invoiceId:r.invoiceId,customerId:r.customerCode,name:r.name,whatsapp:r.whatsapp||"",billingPeriod:r.billingPeriod,usagePeriod:r.usagePeriod,billingDate:r.billingDate,amount:r.amount,status:r.status==="paid"?"paid":"unpaid",paymentDate:r.paymentDate||null}));
  return{schema:1,app:"MAHDY-NET Billing",generatedAt:nowISO(),revision:state.revision||0,customers:rows};
}
async function buildSummaryFile(){const x=await getOne("summary","current")||await rebuildSummary();return{schema:1,generatedAt:nowISO(),current:x}}
async function renderAll(){await renderPackages();await renderCustomerTable();await renderPayments();await renderHome();await renderLocalStatus()}

async function exportData(){
  const state=await getState();return{schema:2,app:"MAHDY-NET Billing V7.2.1",revision:state.revision||0,modifiedAt:state.modifiedAt||null,exportedAt:nowISO(),packages:await all("packages"),customers:await all("customers"),payments:await all("payments")}
}
function summary(data){return{customers:Array.isArray(data?.customers)?data.customers.length:0,payments:Array.isArray(data?.payments)?data.payments.length:0,packages:Array.isArray(data?.packages)?data.packages.length:0,modifiedAt:data?.modifiedAt||null,revision:data?.revision||0}}
async function importData(data,{mark=true}={}){
  if(!data||!Array.isArray(data.packages)||!Array.isArray(data.customers)||!Array.isArray(data.payments))throw new Error("Format backup tidak valid");
  await clearStore("packages");await clearStore("customers");await clearStore("payments");await clearStore("current");await clearStore("summary");
  for(const x of data.packages)await put("packages",x);for(const x of data.customers)await put("customers",x);for(const x of data.payments)await put("payments",x);
  await put("meta",{key:"state",revision:Number(data.revision||0),modifiedAt:data.modifiedAt||nowISO()});await ensureCustomerCodes();await rebuildCurrentSnapshot(true);if(mark)await renderAll();
}
function groupPaymentsByYear(payments){const out={};for(const p of payments){const y=String(p.period||"").slice(0,4);if(!/^\d{4}$/.test(y))continue;(out[y]||(out[y]=[])).push(p)}return out}
async function buildBundle(){
  await rebuildCurrentSnapshot();const state=await getState(),packages=await all("packages"),customers=await all("customers"),payments=await all("payments"),years=groupPaymentsByYear(payments),summaryFile=await buildSummaryFile(),bot=await buildBotStatus();
  const manifest={schema:2,app:"MAHDY-NET Billing V7.2.1",revision:state.revision||0,modifiedAt:state.modifiedAt||null,generatedAt:nowISO(),counts:{customers:customers.length,packages:packages.length,payments:payments.length},paymentYears:Object.keys(years).sort()};
  return{manifest,packages:{schema:2,revision:manifest.revision,modifiedAt:manifest.modifiedAt,items:packages},customers:{schema:2,revision:manifest.revision,modifiedAt:manifest.modifiedAt,items:customers},current:{schema:1,generatedAt:nowISO(),items:await all("current")},summary:summaryFile,paymentYears:years,bot};
}

function savedGoogleSession(){try{return JSON.parse(localStorage.getItem(GOOGLE_SESSION_KEY)||"null")}catch{return null}}
function persistGoogleSession(r){
  const expiresAt=Date.now()+Math.max(60,Number(r.expires_in||3600))*1000-60000;
  localStorage.setItem(GOOGLE_SESSION_KEY,JSON.stringify({accessToken:r.access_token,expiresAt,accountLabel:googleAccountLabel||""}));
}
function restoreGoogleSession(){
  const s=savedGoogleSession();
  if(!s?.accessToken||Number(s.expiresAt||0)<=Date.now()){googleAccountLabel=s?.accountLabel||"";return false}
  googleAccessToken=s.accessToken;googleAccountLabel=s.accountLabel||"";return true;
}
function autoReconnectGoogle(attempt=0){
  if(googleAccessToken||!savedGoogleSession())return;
  if(!window.google?.accounts?.oauth2){if(attempt<20)setTimeout(()=>autoReconnectGoogle(attempt+1),250);return}
  if(initGoogle())googleTokenClient.requestAccessToken({prompt:""});
}
async function loadGoogleAccount(){
  if(!googleAccessToken)return;
  try{const r=await driveFetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)");const u=(await r.json()).user||{};googleAccountLabel=u.emailAddress||u.displayName||"Akun Google aktif";const s=savedGoogleSession();if(s){s.accountLabel=googleAccountLabel;localStorage.setItem(GOOGLE_SESSION_KEY,JSON.stringify(s))}updateDriveUI()}catch{}
}
function initGoogle(){
  if(!window.google?.accounts?.oauth2){toast("Google belum siap, coba lagi beberapa detik");return false}
  googleTokenClient=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:DRIVE_SCOPE,error_callback:()=>{pendingAccountSwitch=false;toast("Pemilihan akun dibatalkan. Akun lama tetap terhubung.")},callback:r=>{if(r.error){pendingAccountSwitch=false;if(r.error!=="interaction_required"&&r.error!=="popup_closed")toast("Pemilihan akun dibatalkan. Akun lama tetap terhubung.");return}googleAccessToken=r.access_token;pendingAccountSwitch=false;persistGoogleSession(r);updateDriveUI();loadGoogleAccount();toast("Google Drive terhubung dan sesi disimpan")}});return true;
}
function connectDrive(){if(initGoogle())googleTokenClient.requestAccessToken({prompt:""})}
function switchDriveAccount(){if(pendingAccountSwitch)return;pendingAccountSwitch=true;toast("Pilih akun baru. Akun lama tetap aktif sampai pilihan berhasil.");if(initGoogle())googleTokenClient.requestAccessToken({prompt:"select_account"});else pendingAccountSwitch=false}
function disconnectDrive(){googleAccessToken=null;googleAccountLabel="";cloudSnapshot=null;localStorage.removeItem(GOOGLE_SESSION_KEY);updateDriveUI();toast("Google Drive diputuskan dari perangkat ini")}
function updateDriveUI(){const ok=!!googleAccessToken;$("driveBadge").classList.toggle("ok",ok);$("driveBadge").querySelector("span").textContent=ok?"Drive terhubung":"Drive belum terhubung";$("driveStatusText").textContent=ok?"Terhubung · Event Ledger V8 siap":"Belum terhubung";$("connectDriveBtn").classList.toggle("hidden",ok);$("disconnectDriveBtn").classList.toggle("hidden",!ok)}
async function driveFetch(url,opts={}){if(!googleAccessToken)throw new Error("Hubungkan Google Drive dulu");const r=await fetch(url,{...opts,headers:{Authorization:"Bearer "+googleAccessToken,...(opts.headers||{})}});if(!r.ok){if(r.status===401){googleAccessToken=null;localStorage.removeItem(GOOGLE_SESSION_KEY);updateDriveUI()}throw new Error(await r.text())}return r}
function qEscape(v){return String(v).replace(/\\/g,"\\\\").replace(/'/g,"\\'")}
async function driveList(query,fields="files(id,name,mimeType,parents,modifiedTime,size)",pageSize=100){const r=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=${encodeURIComponent(fields)}&pageSize=${pageSize}`);return (await r.json()).files||[]}
async function findFolder(name,parentId=null){let q=`name='${qEscape(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;if(parentId)q+=` and '${qEscape(parentId)}' in parents`;return (await driveList(q))[0]||null}
async function createFolder(name,parentId=null){const body={name,mimeType:"application/vnd.google-apps.folder"};if(parentId)body.parents=[parentId];return (await driveFetch("https://www.googleapis.com/drive/v3/files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).json()}
async function ensureFolder(name,parentId=null){return await findFolder(name,parentId)||await createFolder(name,parentId)}
async function ensureDriveStructure(){const root=await ensureFolder(ROOT_FOLDER),data=await ensureFolder("data",root.id),payments=await ensureFolder("payments",root.id),bot=await ensureFolder("bot",root.id),events=await ensureFolder("events",root.id),eventsBilling=await ensureFolder("billing",events.id),backups=await ensureFolder("backups",root.id);return{root,data,payments,bot,events,eventsBilling,backups}}
const DRIVE_ID_CACHE_KEY="mahdy_v81_drive_file_ids";
let driveWriteLock=false;
function driveIdCache(){try{return JSON.parse(localStorage.getItem(DRIVE_ID_CACHE_KEY)||"{}")}catch{return{}}}
function cacheDriveId(parentId,name,id){const c=driveIdCache();c[`${parentId}/${name}`]=id;localStorage.setItem(DRIVE_ID_CACHE_KEY,JSON.stringify(c))}
function cachedDriveId(parentId,name){return driveIdCache()[`${parentId}/${name}`]||null}
function forgetDriveId(parentId,name){const c=driveIdCache();delete c[`${parentId}/${name}`];localStorage.setItem(DRIVE_ID_CACHE_KEY,JSON.stringify(c))}
async function trashDriveFile(id){return driveFetch(`https://www.googleapis.com/drive/v3/files/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})})}
async function findJsonAll(name,parentId){const q=`name='${qEscape(name)}' and '${qEscape(parentId)}' in parents and trashed=false`;return await driveList(q)}
async function findJson(name,parentId){
  const files=await findJsonAll(name,parentId);
  if(!files.length)return null;
  files.sort((a,b)=>String(b.modifiedTime||"").localeCompare(String(a.modifiedTime||"")));
  const keep=files[0];
  cacheDriveId(parentId,name,keep.id);
  return keep;
}
async function downloadDrive(id){return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json()}
async function createJson(name,data,parentId){
  const meta={name,mimeType:"application/json",parents:[parentId]},boundary="mahdy_"+Date.now()+Math.random().toString(36).slice(2);
  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const created=await (await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime",{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body})).json();
  cacheDriveId(parentId,name,created.id);
  return created;
}
async function updateJson(id,data){return (await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,name,modifiedTime`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})).json()}
async function upsertJson(name,data,parentId){
  const cached=cachedDriveId(parentId,name);
  if(cached){
    try{return await updateJson(cached,data)}
    catch(e){forgetDriveId(parentId,name)}
  }
  let files=await findJsonAll(name,parentId);
  if(files.length){
    files.sort((a,b)=>String(b.modifiedTime||"").localeCompare(String(a.modifiedTime||"")));
    const keep=files[0];
    cacheDriveId(parentId,name,keep.id);
    const updated=await updateJson(keep.id,data);
    // Bersihkan duplikat lama dengan nama yang sama di folder aktif.
    for(const extra of files.slice(1)){try{await trashDriveFile(extra.id)}catch{}}
    return updated;
  }
  // Beri kesempatan indeks Drive menyusul agar klik sinkron berurutan tidak membuat file ganda.
  await new Promise(r=>setTimeout(r,700));
  files=await findJsonAll(name,parentId);
  if(files.length){
    files.sort((a,b)=>String(b.modifiedTime||"").localeCompare(String(a.modifiedTime||"")));
    const keep=files[0];cacheDriveId(parentId,name,keep.id);
    for(const extra of files.slice(1)){try{await trashDriveFile(extra.id)}catch{}}
    return await updateJson(keep.id,data);
  }
  return await createJson(name,data,parentId);
}
async function listChildren(parentId){return await driveList(`'${qEscape(parentId)}' in parents and trashed=false`)}
async function copyFile(fileId,name,parentId){return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,parents:[parentId]})})).json()}
async function findLegacyMain(){const q=`name='${qEscape(LEGACY_MAIN_FILE)}' and trashed=false`;return (await driveList(q))[0]||null}
async function getCloudHeader(){
  const root=await findFolder(ROOT_FOLDER);if(root){const data=await findFolder("data",root.id);if(data){const mf=await findJson("manifest.json",data.id);if(mf){const manifest=await downloadDrive(mf.id);return{kind:"v7",root,data,manifest,structure:null}}}}
  const legacy=await findLegacyMain();if(legacy){const data=await downloadDrive(legacy.id);return{kind:"legacy",file:legacy,data,manifest:{schema:1,revision:data.revision||0,modifiedAt:data.modifiedAt||null,counts:summary(data),paymentYears:[...new Set((data.payments||[]).map(p=>String(p.period||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))]}}}
  return{kind:"empty",manifest:null};
}
async function readV7Bundle(header){
  const st=await ensureDriveStructure(),read=async(name,folder)=>{const f=await findJson(name,folder.id);return f?await downloadDrive(f.id):null},manifest=header.manifest||await read("manifest.json",st.data),packages=await read("packages.json",st.data),customers=await read("customers.json",st.data),payments=[];
  for(const y of manifest?.paymentYears||[]){const d=await read(`${y}.json`,st.payments);if(Array.isArray(d?.items))payments.push(...d.items);else if(Array.isArray(d))payments.push(...d)}
  return{schema:2,app:"MAHDY-NET Billing V7.2.1",revision:manifest?.revision||0,modifiedAt:manifest?.modifiedAt||null,packages:packages?.items||[],customers:customers?.items||[],payments};
}
async function createStructuredSafetyBackup(st,label="AUTO"){
  const year=String(new Date().getFullYear()),yearFolder=await ensureFolder(year,st.backups.id),stamp=new Date().toISOString().replace(/[:.]/g,"-"),snap=await createFolder(`${SNAPSHOT_PREFIX}${label}_${stamp}`,yearFolder.id);
  for(const [prefix,folder] of [["data",st.data],["payments",st.payments],["bot",st.bot],["events",st.eventsBilling]]){for(const f of await listChildren(folder.id)){if(f.mimeType==="application/vnd.google-apps.folder")continue;await copyFile(f.id,`${prefix}__${f.name}`,snap.id)}}
  await createJson("snapshot-info.json",{schema:1,label,createdAt:nowISO()},snap.id);return snap;
}
async function writeBundle(bundle,{backup=true}={}){
  if(driveWriteLock)throw new Error("Sinkronisasi Drive masih berjalan. Tunggu sampai selesai.");
  driveWriteLock=true;
  try{
    const st=await ensureDriveStructure();const existingManifest=await findJson("manifest.json",st.data.id);if(backup&&existingManifest)await createStructuredSafetyBackup(st,"SEBELUM_KIRIM");
    const legacy=await findLegacyMain();if(backup&&!existingManifest&&legacy){const yearFolder=await ensureFolder(String(new Date().getFullYear()),st.backups.id),snap=await createFolder(`${SNAPSHOT_PREFIX}MIGRASI_V6_${new Date().toISOString().replace(/[:.]/g,"-")}`,yearFolder.id);await copyFile(legacy.id,"legacy__mahdy-net-data.json",snap.id)}
    await upsertJson("packages.json",bundle.packages,st.data.id);await upsertJson("customers.json",bundle.customers,st.data.id);await upsertJson("current.json",bundle.current,st.data.id);await upsertJson("summary.json",bundle.summary,st.data.id);
    for(const [y,items] of Object.entries(bundle.paymentYears))await upsertJson(`${y}.json`,{schema:1,year:Number(y),revision:bundle.manifest.revision,modifiedAt:bundle.manifest.modifiedAt,items},st.payments.id);
    await upsertJson("wa-status.json",bundle.bot,st.bot.id);await upsertJson("manifest.json",bundle.manifest,st.data.id);return st;
  } finally {driveWriteLock=false}
}
async function openSafeSync(){
  if(!googleAccessToken){toast("Hubungkan Google Drive dulu");showView("dataView");return}
  try{const local=await exportData(),ls=summary(local),cloud=await getCloudHeader();cloudSnapshot=cloud;const cm=cloud.manifest,cc=cm?.counts||{};
    $("localCustomerCount").textContent=`${ls.customers} pelanggan`;$("localPaymentCount").textContent=`${ls.payments} pembayaran`;$("localModified").textContent=ls.modifiedAt?new Date(ls.modifiedAt).toLocaleString("id-ID"):"Belum ada perubahan";
    if(cloud.kind==="empty"){$("cloudCustomerCount").textContent="Belum ada data";$("cloudPaymentCount").textContent="—";$("cloudModified").textContent="—"}else{$("cloudCustomerCount").textContent=`${cc.customers||0} pelanggan`;$("cloudPaymentCount").textContent=`${cc.payments||0} pembayaran · ${cloud.kind==="v7"?"V7":"V6 lama"}`;$("cloudModified").textContent=cm.modifiedAt?new Date(cm.modifiedAt).toLocaleString("id-ID"):"Tanpa tanggal"}
    const w=$("syncWarning"),push=$("pushDriveBtn"),pull=$("pullDriveBtn");w.className="sync-warning";push.disabled=false;pull.disabled=cloud.kind==="empty";
    if(ls.customers===0&&(cc.customers||0)>0){w.classList.add("danger");w.textContent="HP ini kosong tetapi Drive berisi data. Mengirim data HP DIBLOKIR. Ambil data dari Drive.";push.disabled=true}else if(cloud.kind==="legacy"){w.classList.add("good");w.textContent="Data V6 lama ditemukan. Ambil tetap didukung, atau Kirim untuk migrasi aman ke struktur folder V7. File V6 lama tidak dihapus."}else if(cloud.kind==="empty"&&ls.customers>0){w.classList.add("good");w.textContent="Belum ada struktur V7. Kirim akan membuat folder MAHDY-NET Billing beserta subfolder otomatis."}else w.textContent="Pilih arah dengan sengaja. Tidak ada data yang ditimpa otomatis.";
    openModal("syncModal");
  }catch(e){alert("Gagal membaca Drive: "+e.message)}
}
async function pullFromDrive(){
  if(!cloudSnapshot||cloudSnapshot.kind==="empty")return;const local=await exportData(),ls=summary(local);let cloudData;
  try{cloudData=cloudSnapshot.kind==="legacy"?cloudSnapshot.data:await readV7Bundle(cloudSnapshot)}catch(e){alert("Gagal membaca data Drive: "+e.message);return}const cs=summary(cloudData);
  if(!confirm(`Ambil data Drive?\n\nHP: ${ls.customers} pelanggan, ${ls.payments} pembayaran\nDrive: ${cs.customers} pelanggan, ${cs.payments} pembayaran\n\nData HP saat ini akan diganti.`))return;
  if(ls.customers||ls.payments)downloadJson(local,`MAHDY-NET_SEBELUM_AMBIL_DRIVE_${ymdLocal()}.json`);await importData(cloudData);closeModal("syncModal");toast("Data Drive sudah diambil");
}
async function pushToDrive(){
  const local=await exportData(),ls=summary(local),cloud=cloudSnapshot||await getCloudHeader(),cc=cloud.manifest?.counts||{};if(ls.customers===0&&(cc.customers||0)>0){alert("Diblokir: data HP kosong tidak boleh menimpa Drive yang berisi pelanggan.");return}
  if(!confirm(`Kirim data HP ke Drive V7?\n\nHP: ${ls.customers} pelanggan, ${ls.payments} pembayaran\nDrive: ${cc.customers||0} pelanggan, ${cc.payments||0} pembayaran\n\nData akan disimpan terstruktur per tahun dan snapshot lama dibuat lebih dulu.`))return;
  try{await writeBundle(await buildBundle(),{backup:true});cloudSnapshot=await getCloudHeader();closeModal("syncModal");toast("Data V7 berhasil dikirim ke Drive")}catch(e){alert("Gagal mengirim ke Drive: "+e.message)}
}
async function backupNow(){if(!googleAccessToken){toast("Hubungkan Google Drive dulu");return}try{const st=await ensureDriveStructure(),mf=await findJson("manifest.json",st.data.id);if(!mf){toast("Belum ada data V7 di Drive");return}await createStructuredSafetyBackup(st,"MANUAL");toast("Snapshot backup V7 selesai")}catch(e){alert("Backup gagal: "+e.message)}}
async function findSnapshotFolders(){return await driveList(`name contains '${SNAPSHOT_PREFIX}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}
async function restoreSnapshot(folder){
  const files=await listChildren(folder.id),map=new Map(files.map(f=>[f.name,f])),read=async n=>map.has(n)?await downloadDrive(map.get(n).id):null;
  const legacy=map.get("legacy__mahdy-net-data.json");if(legacy)return await downloadDrive(legacy.id);
  const manifest=await read("data__manifest.json");if(!manifest)throw new Error("Manifest snapshot tidak ditemukan");const packages=await read("data__packages.json"),customers=await read("data__customers.json"),payments=[];
  for(const y of manifest.paymentYears||[]){const d=await read(`payments__${y}.json`);if(Array.isArray(d?.items))payments.push(...d.items)}
  if(Number(manifest.schema||0)>=8){
    const ev=[];for(const [name,f] of map){if(!name.startsWith("events__"))continue;try{const d=await downloadDrive(f.id);if(Array.isArray(d?.events))ev.push(...d.events);else if(d?.eventId)ev.push(d)}catch{}}
    const botEv=await read("bot__bot-events.json");if(Array.isArray(botEv?.events))ev.push(...botEv.events);
    if(ev.length){const merged=mergeEventSets(ev),mat=materializeLedger(merged);return{schema:8,revision:manifest.revision||0,modifiedAt:manifest.modifiedAt||null,packages:mat.packages,customers:mat.customers,payments:mat.payments,events:merged}}
  }
  return{schema:2,revision:manifest.revision||0,modifiedAt:manifest.modifiedAt||null,packages:packages?.items||[],customers:customers?.items||[],payments};
}
async function openRestore(){
  if(!googleAccessToken){toast("Hubungkan Google Drive dulu");return}try{const snaps=await findSnapshotFolders(),legacy=await driveList(`name contains '${BACKUP_PREFIX}' and trashed=false`),box=$("restoreList");box.innerHTML="";const items=[...snaps.map(f=>({type:"snapshot",f})),...legacy.map(f=>({type:"legacy",f}))].sort((a,b)=>String(b.f.modifiedTime||"").localeCompare(String(a.f.modifiedTime||"")));
    if(!items.length)box.innerHTML='<div class="empty-state">Belum ada backup.</div>';
    for(const it of items){const f=it.f,row=document.createElement("div");row.className="restore-row";row.innerHTML=`<div><b>${f.name}</b><small>${f.modifiedTime?new Date(f.modifiedTime).toLocaleString("id-ID"):it.type}</small></div><button class="btn subtle">Restore</button>`;row.querySelector("button").addEventListener("click",async()=>{try{const backup=it.type==="snapshot"?await restoreSnapshot(f):await downloadDrive(f.id),bs=summary(backup),local=await exportData(),ls=summary(local);if(!confirm(`Restore backup ini?\n\nBackup: ${bs.customers} pelanggan, ${bs.payments} pembayaran\nSaat ini: ${ls.customers} pelanggan, ${ls.payments} pembayaran\n\nData saat ini akan diganti.`))return;if(ls.customers||ls.payments)downloadJson(local,`MAHDY-NET_SEBELUM_RESTORE_${ymdLocal()}.json`);await importData(backup);closeModal("restoreModal");toast("Restore selesai")}catch(e){alert("Restore gagal: "+e.message)}});box.appendChild(row)}openModal("restoreModal");
  }catch(e){alert("Gagal membaca backup: "+e.message)}
}
function downloadJson(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportLocal(){downloadJson(await exportData(),`MAHDY-NET_V8_${ymdLocal()}.json`)}
async function importLocalFile(file){const text=await file.text(),data=JSON.parse(text),s=summary(data),local=summary(await exportData());if(!confirm(`Import file ini?\n\nFile: ${s.customers} pelanggan, ${s.payments} pembayaran\nSaat ini: ${local.customers} pelanggan, ${local.payments} pembayaran\n\nData saat ini akan diganti.`))return;if(local.customers||local.payments)downloadJson(await exportData(),`MAHDY-NET_SEBELUM_IMPORT_${ymdLocal()}.json`);await importData(data);toast("Import selesai")}


// ============================================================
// MAHDY-NET Billing V8.0 — Event Ledger Sync
// Source of truth = immutable events. Materialized stores are views.
// ============================================================
const V8_EVENT_PREFIX="EV8";
function simpleHash(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,"0")}
function randomToken(n=8){const a=new Uint8Array(n);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function getDeviceId(){let m=await getOne("meta","v8Device");if(m?.value)return m.value;const v="HP-"+randomToken(6);await put("meta",{key:"v8Device",value:v,createdAt:nowISO()});return v}
function eventSort(a,b){const x=String(a.at||"").localeCompare(String(b.at||""));return x||String(a.eventId||"").localeCompare(String(b.eventId||""))}
function eventFingerprint(e){return simpleHash(JSON.stringify({type:e.type,entityKey:e.entityKey,invoiceId:e.invoiceId||null,at:e.at,payload:e.payload}))}
function normalizeEvent(e){return{schema:1,eventId:String(e.eventId),type:String(e.type),entityType:String(e.entityType||String(e.type).split(".")[0]),entityKey:String(e.entityKey||e.invoiceId||""),invoiceId:e.invoiceId?String(e.invoiceId):null,at:String(e.at||nowISO()),source:String(e.source||"billing_web"),deviceId:String(e.deviceId||"unknown"),payload:e.payload||{}}}
async function appendLedgerEvent(type,entityKey,payload={},extra={}){const deviceId=await getDeviceId(),at=extra.at||nowISO(),eventId=extra.eventId||`${V8_EVENT_PREFIX}-${deviceId}-${Date.now().toString(36)}-${randomToken(4)}`;const e=normalizeEvent({eventId,type,entityType:String(type).split(".")[0],entityKey,invoiceId:extra.invoiceId||null,at,source:extra.source||"billing_web",deviceId,payload});await put("events",e);const st=await getState();st.revision=(st.revision||0)+1;st.modifiedAt=at;await put("meta",st);return e}
async function allLedgerEvents(){return (await all("events")).map(normalizeEvent).sort(eventSort)}
function nextDisplayPackageCode(items){let n=0;for(const p of items){const m=String(p.packageCode||"").match(/^P(\d+)$/);if(m)n=Math.max(n,+m[1])}return"P"+String(n+1).padStart(6,"0")}
async function ensureSyncKeys(){const ps=await all("packages"),pkgById=new Map();let pc=0;for(const p of ps){if(!p.packageCode)p.packageCode="P"+String(++pc).padStart(6,"0");else{const m=p.packageCode.match(/^P(\d+)$/);if(m)pc=Math.max(pc,+m[1])}if(!p.syncKey)p.syncKey=`PKG-LEGACY-${String(p.id).padStart(6,"0")}`;pkgById.set(Number(p.id),p);await put("packages",p)}const cs=await all("customers");for(const c of cs){if(!c.customerCode)c.customerCode=await nextCustomerCode();if(!c.syncKey)c.syncKey=`CUS-${c.customerCode}`;const pkg=pkgById.get(Number(c.packageId));if(pkg&&!c.packageSyncKey)c.packageSyncKey=pkg.syncKey;await put("customers",c)}}
function legacySeedEvent(type,key,payload,at,source){const raw={type,key,payload,at:at||"2000-01-01T00:00:00.000Z"};return normalizeEvent({eventId:`MIG-${simpleHash(JSON.stringify(raw))}`,type,entityType:type.split(".")[0],entityKey:key,invoiceId:type.startsWith("payment.")?key:null,at:raw.at,source,deviceId:"migration",payload})}
function legacyEventsFromData(data,source="legacy"){const events=[],ps=Array.isArray(data?.packages)?data.packages:[],cs=Array.isArray(data?.customers)?data.customers:[],pays=Array.isArray(data?.payments)?data.payments:[],pkgIdMap=new Map();let pseq=0;for(const p0 of ps){const p={...p0},syncKey=p.syncKey||`PKG-LEGACY-${String(p.id??++pseq).padStart(6,"0")}`,packageCode=p.packageCode||`P${String(++pseq).padStart(6,"0")}`;pkgIdMap.set(Number(p.id),syncKey);events.push(legacySeedEvent("package.seed",syncKey,{syncKey,packageCode,name:p.name||"",speed:p.speed||"",price:Number(p.price||0),active:p.active!==false,createdAt:p.createdAt||null},p.updatedAt||p.createdAt||data?.modifiedAt||"2000-01-01T00:00:00.000Z",source))}for(const c0 of cs){const c={...c0},code=c.customerCode||`C${String(c.id||0).padStart(6,"0")}`,syncKey=c.syncKey||`CUS-${code}`,packageSyncKey=c.packageSyncKey||pkgIdMap.get(Number(c.packageId))||"";events.push(legacySeedEvent("customer.seed",syncKey,{syncKey,customerCode:code,name:c.name||"",whatsapp:normalizeWhatsApp(c.whatsapp||""),packageSyncKey,packageName:c.packageName||"",speed:c.speed||"",monthlyPrice:Number(c.monthlyPrice||0),customPrice:c.customPrice??null,registrationDate:c.registrationDate||"",startDate:c.startDate||"",firstBillDate:c.firstBillDate||"",active:c.active!==false,createdAt:c.createdAt||null},c.updatedAt||c.createdAt||data?.modifiedAt||"2000-01-01T00:00:00.000Z",source))}const cmap=new Map(cs.map(c=>[Number(c.id),c.customerCode||`C${String(c.id||0).padStart(6,"0")}`]));for(const p of pays){const code=cmap.get(Number(p.customerId));if(!code||!p.period)continue;const inv=`${code}-${p.period}`;events.push(legacySeedEvent("payment.paid",inv,{customerCode:code,period:p.period,amount:Number(p.amount||0),date:p.date||String(p.createdAt||data?.modifiedAt||"").slice(0,10),method:p.method||"Tunai",note:p.note||"",notifyCustomer:false,legacyPaymentId:p.id??null},p.updatedAt||p.createdAt||data?.modifiedAt||"2000-01-01T00:00:00.000Z",source))}return events}
async function ensureV8Migration(){
  await ensureSyncKeys();const m=await getOne("meta","v8Migration");if(m?.completed)return;
  const data={modifiedAt:(await getState()).modifiedAt,packages:await all("packages"),customers:await all("customers"),payments:await all("payments")},before=m?.before||{packages:data.packages.length,customers:data.customers.length,payments:data.payments.length};
  let existing=await allLedgerEvents();
  if(existing.length){
    const mat=materializeLedger(existing),got={packages:mat.packages.length,customers:mat.customers.length,payments:mat.payments.length};
    if(got.packages!==before.packages||got.customers!==before.customers||got.payments!==before.payments)throw new Error(`Migrasi V8 sebelumnya belum tervalidasi. Data lama tetap dipertahankan. Sebelum ${JSON.stringify(before)}, event menghasilkan ${JSON.stringify(got)}.`);
    await put("meta",{key:"v8Migration",completed:true,completedAt:nowISO(),before,events:existing.length,recovered:true});return;
  }
  await put("meta",{key:"v8PreMigrationBackup",createdAt:nowISO(),data});
  await put("meta",{key:"v8Migration",completed:false,inProgress:true,startedAt:nowISO(),before});
  const seeds=legacyEventsFromData(data,"local_v7_migration");
  try{
    for(const e of seeds)await put("events",e);
    const mat=materializeLedger(seeds),got={packages:mat.packages.length,customers:mat.customers.length,payments:mat.payments.length};
    if(got.packages!==before.packages||got.customers!==before.customers||got.payments!==before.payments)throw new Error(`Validasi jumlah tidak cocok. Sebelum ${JSON.stringify(before)}, hasil ${JSON.stringify(got)}`);
    await put("meta",{key:"v8Migration",completed:true,completedAt:nowISO(),before,events:seeds.length});
  }catch(e){await clearStore("events");await put("meta",{key:"v8Migration",completed:false,failedAt:nowISO(),before,error:String(e.message||e)});throw new Error(`Migrasi V8 dihentikan dan event parsial dibersihkan: ${e.message||e}`)}
}
function mergeEventSets(...sets){const map=new Map();for(const list of sets)for(const raw of list||[]){if(!raw?.eventId)continue;const e=normalizeEvent(raw),old=map.get(e.eventId);if(old&&eventFingerprint(old)!==eventFingerprint(e))throw new Error(`Konflik event ID ${e.eventId}. Sinkron dihentikan agar data tidak rusak.`);if(!old)map.set(e.eventId,e)}return [...map.values()].sort(eventSort)}
function materializeLedger(events){const pkgs=new Map(),custs=new Map(),payStates=new Map(),sameMoment=new Map();for(const e of [...events].sort(eventSort)){const sig=`${e.entityKey}|${e.at}|${e.entityType}`;const fp=eventFingerprint(e),prior=sameMoment.get(sig);if(prior&&prior!==fp)throw new Error(`Dua perubahan berbeda terjadi pada waktu identik untuk ${e.entityKey}. Sinkron dihentikan untuk mencegah pemilihan acak.`);sameMoment.set(sig,fp);const p=e.payload||{};if(e.type==="package.seed"||e.type==="package.create"||e.type==="package.update"){const cur=pkgs.get(e.entityKey)||{syncKey:e.entityKey,active:true};pkgs.set(e.entityKey,{...cur,...p,syncKey:e.entityKey,_lastEventId:e.eventId,_lastAt:e.at})}else if(e.type==="package.delete"){const cur=pkgs.get(e.entityKey)||{syncKey:e.entityKey};pkgs.set(e.entityKey,{...cur,active:false,_lastEventId:e.eventId,_lastAt:e.at})}else if(e.type==="customer.seed"||e.type==="customer.create"||e.type==="customer.update"){const cur=custs.get(e.entityKey)||{syncKey:e.entityKey,active:true};custs.set(e.entityKey,{...cur,...p,syncKey:e.entityKey,_lastEventId:e.eventId,_lastAt:e.at})}else if(e.type==="customer.deactivate"){const cur=custs.get(e.entityKey)||{syncKey:e.entityKey};custs.set(e.entityKey,{...cur,active:false,_lastEventId:e.eventId,_lastAt:e.at})}else if(e.type==="payment.paid"||e.type==="payment.cancelled"){const inv=e.invoiceId||e.entityKey,prev=payStates.get(inv),cycle=(prev?.cycle||0)+(e.type==="payment.paid"&&prev?.status!=="paid"?1:0);payStates.set(inv,{invoiceId:inv,status:e.type==="payment.paid"?"paid":"unpaid",eventId:e.eventId,at:e.at,source:e.source,cycle,payload:p})}}
  const codeOwner=new Map();for(const [key,c] of custs){if(!c.customerCode)continue;const old=codeOwner.get(c.customerCode);if(old&&old!==key)throw new Error(`Konflik kode pelanggan ${c.customerCode} dari dua perangkat. Sinkron dihentikan tanpa menghapus data.`);codeOwner.set(c.customerCode,key)}
  const packages=[...pkgs.values()],customers=[...custs.values()],payments=[];const byCode=new Map(customers.map(c=>[c.customerCode,c]));for(const st of payStates.values()){if(st.status!=="paid")continue;const c=byCode.get(st.payload.customerCode);if(!c)continue;payments.push({syncKey:`PAY-${st.invoiceId}`,customerSyncKey:c.syncKey,customerCode:c.customerCode,period:st.payload.period||st.invoiceId.slice(-7),amount:Number(st.payload.amount||c.monthlyPrice||0),date:st.payload.date||String(st.at).slice(0,10),method:st.payload.method||"Tunai",note:st.payload.note||"",eventId:st.eventId,eventAt:st.at,source:st.source,cycle:st.cycle})}return{packages,customers,payments,paymentStates:[...payStates.values()]}}
async function commitMaterialized(mat,events){const oldP=await all("packages"),oldC=await all("customers"),pId=new Map(oldP.filter(x=>x.syncKey).map(x=>[x.syncKey,x.id])),cId=new Map(oldC.filter(x=>x.syncKey).map(x=>[x.syncKey,x.id]));let pMax=oldP.reduce((m,x)=>Math.max(m,Number(x.id)||0),0),cMax=oldC.reduce((m,x)=>Math.max(m,Number(x.id)||0),0);const packages=mat.packages.map(x=>({...x,id:pId.get(x.syncKey)||++pMax}));const pMap=new Map(packages.map(x=>[x.syncKey,x]));const customers=mat.customers.map(x=>{const pkg=pMap.get(x.packageSyncKey);return{...x,id:cId.get(x.syncKey)||++cMax,packageId:pkg?.id||null,packageName:x.packageName||pkg?.name||"",speed:x.speed||pkg?.speed||"",monthlyPrice:Number(x.customPrice||x.monthlyPrice||pkg?.price||0),whatsapp:normalizeWhatsApp(x.whatsapp||"")}});const cMap=new Map(customers.map(x=>[x.customerCode,x]));let payId=0;const payments=mat.payments.map(x=>({...x,id:++payId,customerId:cMap.get(x.customerCode)?.id||null})).filter(x=>x.customerId!=null);const tx=db.transaction(["packages","customers","payments","paymentStates","events","current","summary"],"readwrite");for(const st of ["packages","customers","payments","paymentStates","events","current","summary"])tx.objectStore(st).clear();for(const x of packages)tx.objectStore("packages").put(x);for(const x of customers)tx.objectStore("customers").put(x);for(const x of payments)tx.objectStore("payments").put(x);for(const x of mat.paymentStates)tx.objectStore("paymentStates").put(x);for(const x of events)tx.objectStore("events").put(x);await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error("Transaksi materialisasi dibatalkan"))});const seq=Math.max(0,...customers.map(c=>customerCodeNumber(c.customerCode)));await put("meta",{key:"customerSeq",value:seq});await rebuildCurrentSnapshot(true)}
async function rematerializeLocal(){const ev=await allLedgerEvents(),mat=materializeLedger(ev);await commitMaterialized(mat,ev);await renderAll();return mat}
async function listDriveAll(query,fields="files(id,name,mimeType,parents,modifiedTime,size)"){let out=[],token="";do{const f=`nextPageToken,${fields}`,url=`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=${encodeURIComponent(f)}&pageSize=100${token?`&pageToken=${encodeURIComponent(token)}`:""}`,j=await (await driveFetch(url)).json();out.push(...(j.files||[]));token=j.nextPageToken||""}while(token);return out}
async function ensureBotEventsFile(st){let f=await findJson("bot-events.json",st.bot.id);if(!f)f=await createJson("bot-events.json",{schema:1,events:[],updatedAt:nowISO()},st.bot.id);try{const j=await (await driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?fields=permissions(id,emailAddress,role,type)`)).json();const ok=(j.permissions||[]).some(x=>String(x.emailAddress||"").toLowerCase()===BOT_SERVICE_ACCOUNT.toLowerCase()&&["writer","owner"].includes(x.role));if(!ok)await driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?sendNotificationEmail=false`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"user",role:"writer",emailAddress:BOT_SERVICE_ACCOUNT})})}catch(e){throw new Error(`Izin Writer service account ke bot-events.json gagal dipastikan. Sinkron dihentikan agar integrasi pembayaran tidak setengah aktif. ${e.message||e}`)}return f}
async function readBotLedger(st){const f=await ensureBotEventsFile(st);const d=await downloadDrive(f.id);if(!d||!Array.isArray(d.events))throw new Error("bot-events.json tidak valid/tidak dapat dibaca. Sinkron dihentikan agar event bot tidak terlewat.");return{file:f,events:d.events}}
async function readDriveBillingEvents(st){const files=await listDriveAll(`'${qEscape(st.eventsBilling.id)}' in parents and trashed=false`),events=[],errors=[];for(const f of files){if(f.mimeType==="application/vnd.google-apps.folder")continue;try{const d=await downloadDrive(f.id);if(Array.isArray(d?.events))events.push(...d.events);else if(d?.eventId)events.push(d);else errors.push(`${f.name}: format event tidak valid`)}catch(e){errors.push(`${f.name}: ${e.message||e}`)}}if(errors.length)throw new Error(`Sebagian file event Drive gagal dibaca. Sinkron dibatalkan tanpa menulis apa pun. ${errors.join(" | ")}`);return events}
async function upsertDeviceLog(st,events){const deviceId=await getDeviceId(),mine=events.filter(e=>e.deviceId===deviceId||e.deviceId==="migration-local"||e.source==="local_v7_migration"),name=`device_${deviceId}.json`,data={schema:1,deviceId,updatedAt:nowISO(),events:mine};await upsertJson(name,data,st.eventsBilling.id)}
async function getCloudHeaderV8(){const root=await findFolder(ROOT_FOLDER);if(root){const data=await findFolder("data",root.id);if(data){const mf=await findJson("manifest.json",data.id);if(mf){const manifest=await downloadDrive(mf.id);return{kind:Number(manifest?.schema)>=8?"v8":"v7",root,data,manifest}}}}const legacy=await findLegacyMain();if(legacy){const data=await downloadDrive(legacy.id);return{kind:"legacy",file:legacy,data,manifest:{schema:1,revision:data.revision||0,modifiedAt:data.modifiedAt||null,counts:summary(data)}}}return{kind:"empty",manifest:null}}
async function deriveCurrentFilesForV8(st,events){const mat=materializeLedger(events);await commitMaterialized(mat,events);const state=await getState(),packages=await all("packages"),customers=await all("customers"),payments=await all("payments"),years=groupPaymentsByYear(payments),summaryFile=await buildSummaryFile(),cur=await all("current"),recentPay=events.filter(e=>e.type==="payment.paid"||e.type==="payment.cancelled").sort(eventSort).slice(-250).map(e=>({...e,payload:{...e.payload}}));const bot={schema:2,app:"MAHDY-NET Billing V8.0",generatedAt:nowISO(),revision:state.revision||0,botEventsFileId:(await ensureBotEventsFile(st)).id,customers:cur.map(r=>({invoiceId:r.invoiceId,customerId:r.customerCode,name:r.name,whatsapp:r.whatsapp||"",billingPeriod:r.billingPeriod,usagePeriod:r.usagePeriod,billingDate:r.billingDate,amount:r.amount,status:r.status==="paid"?"paid":"unpaid",paymentDate:r.paymentDate||null,paymentStateEventId:r.paymentStateEventId||null,paymentStatusAt:r.paymentStatusAt||null,paymentSource:r.paymentSource||null,paymentCycle:r.paymentCycle||0})),packages:packages.filter(p=>p.active!==false).map(p=>({id:p.packageCode||p.syncKey,name:p.name||"",speed:p.speed||"",price:Number(p.price||0),active:true})),paymentEvents:recentPay};const manifest={schema:8,app:"MAHDY-NET Billing V8.0 Event Ledger",revision:state.revision||0,modifiedAt:state.modifiedAt||null,generatedAt:nowISO(),counts:{customers:customers.length,packages:packages.length,payments:payments.length,events:events.length,billingEvents:events.filter(e=>e.deviceId!=="wa-bot").length,botEvents:events.filter(e=>e.deviceId==="wa-bot").length},eventModel:"append-only",paymentYears:Object.keys(years).sort()};return{manifest,packages:{schema:8,items:packages},customers:{schema:8,items:customers},current:{schema:8,items:cur},summary:summaryFile,paymentYears:years,bot}}
async function writeV8Derived(st,bundle){const oldMf=await findJson("manifest.json",st.data.id),old=oldMf?await downloadDrive(oldMf.id):null;await upsertJson("packages.json",bundle.packages,st.data.id);await upsertJson("customers.json",bundle.customers,st.data.id);await upsertJson("current.json",bundle.current,st.data.id);await upsertJson("summary.json",bundle.summary,st.data.id);const years=new Set([...(old?.paymentYears||[]),...Object.keys(bundle.paymentYears)]);for(const y of years)await upsertJson(`${y}.json`,{schema:8,year:Number(y),items:bundle.paymentYears[y]||[]},st.payments.id);await upsertJson("wa-status.json",bundle.bot,st.bot.id);await upsertJson("manifest.json",bundle.manifest,st.data.id)}
async function syncEventLedger({showResult=true}={}){if(!googleAccessToken)throw new Error("Hubungkan Google Drive dulu");if(driveWriteLock)throw new Error("Sinkronisasi masih berjalan");driveWriteLock=true;try{await ensureV8Migration();const local=await allLedgerEvents(),st=await ensureDriveStructure(),head=await getCloudHeaderV8(),driveEvents=await readDriveBillingEvents(st),botLedger=await readBotLedger(st);if(head.kind==="v8"){const expected=Number(head.manifest?.counts?.billingEvents??0),uniqueRemote=mergeEventSets(driveEvents).length;if(expected>uniqueRemote)throw new Error(`Manifest V8 mencatat ${expected} event billing tetapi hanya ${uniqueRemote} event unik yang terbaca. Sinkron dihentikan tanpa menulis agar event tidak terlewat.`)}let legacyEvents=[];if((head.kind==="v7"||head.kind==="legacy")&&driveEvents.length===0){const data=head.kind==="legacy"?head.data:await readV7Bundle(head);legacyEvents=legacyEventsFromData(data,"drive_v7_migration").map(e=>({...e,deviceId:"migration-local"}))}let union=mergeEventSets(local,driveEvents,botLedger.events,legacyEvents);materializeLedger(union);const localBefore={customers:(await all("customers")).length,payments:(await all("payments")).length,events:local.length};if(head.kind!=="empty"){const mf=await findJson("manifest.json",st.data.id);if(mf)await createStructuredSafetyBackup(st,"V8_SEBELUM_MERGE")}await upsertDeviceLog(st,union);/* Final re-read: ambil event yang mungkin masuk dari HP lain saat proses sinkron berjalan. */const finalDrive=await readDriveBillingEvents(st),finalBot=await readBotLedger(st);union=mergeEventSets(union,finalDrive,finalBot.events);const mat=materializeLedger(union);await commitMaterialized(mat,union);const bundle=await deriveCurrentFilesForV8(st,union);await writeV8Derived(st,bundle);const report={localBefore,driveEvents:mergeEventSets(finalDrive).length,botEvents:finalBot.events.length,legacyEvents:legacyEvents.length,mergedEvents:union.length,customers:mat.customers.length,payments:mat.payments.length};await put("meta",{key:"lastV8Sync",at:nowISO(),report});if(showResult)toast(`Sinkron V8 selesai · ${union.length} event · ${mat.payments.length} lunas`);return report}finally{driveWriteLock=false}}

// V8 mutations: write an event, then rematerialize. No whole-database overwrite.
async function seedPackages(){return}
async function savePackage(){const name=$("fPackageName").value.trim(),speed=$("fPackageSpeed").value.trim(),price=Number($("fPackagePrice").value.replace(/\D/g,""));if(!name||!speed||!price){toast("Lengkapi data paket");return}await ensureV8Migration();if(editingPackageId){const p=(await all("packages")).find(x=>x.id===editingPackageId);if(!p)return;const patch={};for(const [k,v] of Object.entries({name,speed,price}))if(String(p[k]??"")!==String(v))patch[k]=v;if(!Object.keys(patch).length){closeModal("packageFormModal");toast("Tidak ada perubahan");return}await appendLedgerEvent("package.update",p.syncKey,patch)}else{const ps=await all("packages"),syncKey="PKG-"+randomToken(10);await appendLedgerEvent("package.create",syncKey,{syncKey,packageCode:nextDisplayPackageCode(ps),name,speed,price,active:true,createdAt:nowISO()})}editingPackageId=null;await rematerializeLocal();closeModal("packageFormModal");toast("Paket disimpan sebagai event")}
async function deletePackage(id){const p=(await all("packages")).find(x=>x.id===id);if(!p)return;if((await all("customers")).some(c=>c.active!==false&&c.packageSyncKey===p.syncKey)){alert("Paket masih digunakan pelanggan.");return}if(confirm("Nonaktifkan paket ini? Riwayat tidak akan dihapus.")){await appendLedgerEvent("package.delete",p.syncKey,{reason:"Dihapus dari Web Billing"});await rematerializeLocal();toast("Paket dinonaktifkan")}}
async function saveCustomer(){const target=editingCustomerId,name=$("fCustomerName").value.trim(),whatsapp=normalizeWhatsApp($("fCustomerWhatsapp").value),packageId=Number($("fCustomerPackage").value),reg=$("fRegistrationDate").value,start=$("fStartDate").value,first=$("fFirstBillDate").value;if(!name||!packageId||!reg||!start||!first){toast("Lengkapi data pelanggan");return}await ensureV8Migration();const pkg=(await all("packages")).find(x=>x.id===packageId);if(!pkg)return;const customPrice=Number($("fCustomerPrice").value.replace(/\D/g,""))||null,values={name,whatsapp,packageSyncKey:pkg.syncKey,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first};if(target!=null){const c=(await all("customers")).find(x=>x.id===target);if(!c){toast("Pelanggan tidak ditemukan");return}const patch={};for(const [k,v] of Object.entries(values))if(JSON.stringify(c[k]??null)!==JSON.stringify(v??null))patch[k]=v;if(!Object.keys(patch).length){editingCustomerId=null;closeModal("customerFormModal");toast("Tidak ada perubahan");return}await appendLedgerEvent("customer.update",c.syncKey,patch)}else{const code=await nextCustomerCode(),syncKey="CUS-"+randomToken(10);await appendLedgerEvent("customer.create",syncKey,{syncKey,customerCode:code,...values,active:true,createdAt:nowISO()})}editingCustomerId=null;await rematerializeLocal();closeModal("customerFormModal");toast("Pelanggan disimpan sebagai event")}
async function savePayment(){if(!paymentCtx)return;await ensureV8Migration();const amount=Number($("payAmount").value.replace(/\D/g,"")),date=$("payDate").value,method=$("payMethod").value,note=$("payNote").value.trim();if(!amount||!date){toast("Lengkapi pembayaran");return}const c=paymentCtx.customer,inv=`${c.customerCode}-${paymentCtx.period}`,existing=paymentCtx.existing;if(existing&&Number(existing.amount)===amount&&existing.date===date&&existing.method===method&&String(existing.note||"")===note){closeModal("paymentModal");toast("Invoice ini sudah LUNAS dan tidak berubah");return}const pp=parsePeriod(paymentCtx.period),billDate=ymdLocal(dueDate(c,pp.year,pp.month)),usagePeriod=previousMonthKey(pp.year,pp.month);await appendLedgerEvent("payment.paid",inv,{customerCode:c.customerCode,customerName:c.name,whatsapp:c.whatsapp||"",period:paymentCtx.period,usagePeriod,billingDate:billDate,amount,date,method,note,notifyCustomer:!existing},{invoiceId:inv,source:"billing_web"});await rematerializeLocal();closeModal("paymentModal");toast("Pembayaran LUNAS tercatat. Sinkronkan Drive agar bot menerima perubahan.")}
async function deletePayment(){if(!paymentCtx?.existing)return;const reason=prompt("Alasan pembatalan pembayaran:","Salah klik");if(reason===null)return;if(!confirm(`Batalkan pembayaran ${paymentCtx.customer.name} periode ${paymentCtx.period}?\n\nRiwayat LUNAS tidak dihapus; event pembatalan baru akan dibuat.`))return;const c=paymentCtx.customer,inv=`${c.customerCode}-${paymentCtx.period}`;const pp=parsePeriod(paymentCtx.period),billDate=ymdLocal(dueDate(c,pp.year,pp.month)),usagePeriod=previousMonthKey(pp.year,pp.month);await appendLedgerEvent("payment.cancelled",inv,{customerCode:c.customerCode,customerName:c.name,whatsapp:c.whatsapp||"",period:paymentCtx.period,usagePeriod,billingDate:billDate,amount:Number(paymentCtx.existing.amount||0),date:ymdLocal(),reason:String(reason||"Pembayaran dibatalkan"),askCustomerNotice:true,notifyCustomer:false},{invoiceId:inv,source:"billing_web"});await rematerializeLocal();closeModal("paymentModal");toast("Pembayaran dibatalkan sebagai event. Sinkronkan Drive.")}
async function exportData(){const state=await getState();return{schema:8,app:"MAHDY-NET Billing V8.0 Event Ledger",revision:state.revision||0,modifiedAt:state.modifiedAt||null,exportedAt:nowISO(),packages:await all("packages"),customers:await all("customers"),payments:await all("payments"),events:await allLedgerEvents()}}
async function importData(data,{mark=true}={}){if(!data||!Array.isArray(data.packages)||!Array.isArray(data.customers)||!Array.isArray(data.payments))throw new Error("Format backup tidak valid");for(const st of ["packages","customers","payments","paymentStates","events","current","summary"])await clearStore(st);for(const x of data.packages)await put("packages",x);for(const x of data.customers)await put("customers",x);for(const x of data.payments)await put("payments",x);if(Array.isArray(data.events))for(const e of data.events)await put("events",normalizeEvent(e));await put("meta",{key:"state",revision:Number(data.revision||0),modifiedAt:data.modifiedAt||nowISO()});await put("meta",{key:"v8Migration",completed:false});await ensureCustomerCodes();await ensureV8Migration();await rematerializeLocal();if(mark)await renderAll()}
async function openSafeSync(){if(!googleAccessToken){toast("Hubungkan Google Drive dulu");showView("dataView");return}try{await ensureV8Migration();const local=await allLedgerEvents(),st=await ensureDriveStructure(),head=await getCloudHeaderV8(),remote=await readDriveBillingEvents(st),bot=await readBotLedger(st);const localSummary=summary(await exportData()),cc=head.manifest?.counts||{};$("localCustomerCount").textContent=`${localSummary.customers} pelanggan`;$("localPaymentCount").textContent=`${localSummary.payments} pembayaran · ${local.length} event`;$("localModified").textContent=(await getState()).modifiedAt?new Date((await getState()).modifiedAt).toLocaleString("id-ID"):"Belum ada perubahan";$("cloudCustomerCount").textContent=head.kind==="empty"?"Belum ada data":`${cc.customers??"?"} pelanggan`;$("cloudPaymentCount").textContent=head.kind==="empty"?"—":`${cc.payments??"?"} pembayaran · ${remote.length} event billing · ${bot.events.length} event bot`;$("cloudModified").textContent=head.manifest?.modifiedAt?new Date(head.manifest.modifiedAt).toLocaleString("id-ID"):head.kind.toUpperCase();const w=$("syncWarning");w.className="sync-warning good";w.innerHTML=`Sinkron V8 tidak memilih database pemenang. Sistem akan <b>menggabungkan event unik dari HP, Drive, dan WhatsApp Bot</b>, lalu menghitung ulang status final setiap invoice. Data yang tidak memiliki event penghapus tidak akan dibuang.`;$("pullDriveBtn").classList.add("hidden");$("pushDriveBtn").classList.add("hidden");$("mergeDriveBtn")?.classList.remove("hidden");openModal("syncModal")}catch(e){alert("Gagal membandingkan event: "+e.message)}}
async function mergeDriveNow(){if(!confirm("Gabungkan event HP + Google Drive + WhatsApp Bot sekarang?\n\nTidak ada database yang ditimpa utuh. Sebelum menulis tampilan materialisasi, snapshot keamanan dibuat."))return;try{const r=await syncEventLedger();closeModal("syncModal");await renderAll();alert(`Sinkron Event Ledger selesai.\n\nEvent gabungan: ${r.mergedEvents}\nPelanggan: ${r.customers}\nInvoice LUNAS: ${r.payments}`)}catch(e){alert("Sinkron V8 dihentikan: "+e.message)}}
async function pullFromDrive(){return mergeDriveNow()}
async function pushToDrive(){return mergeDriveNow()}
async function backupNow(){if(!googleAccessToken){toast("Hubungkan Google Drive dulu");return}try{const st=await ensureDriveStructure();await createStructuredSafetyBackup(st,"MANUAL_V8");toast("Snapshot V8 selesai. Event ledger tetap dipertahankan.")}catch(e){alert("Backup gagal: "+e.message)}}



// ============================================================
// MAHDY-NET Billing V8.1 — Dynamic Invoice + Fast Event Sync
// Backward compatible with Event Ledger schema 8.
// ============================================================
const V81_STRUCTURE_CACHE_KEY="mahdy_v81_drive_structure";
const V81_BOT_PERMISSION_TTL=24*60*60*1000;
let multiPaymentCtx=null;

function nextMonthPeriod(period){const p=parsePeriod(period),d=new Date(p.year,p.month+1,1);return monthKey(d.getFullYear(),d.getMonth())}
function periodLabel(period){if(!period)return"—";const p=parsePeriod(period);return `${MONTHS[p.month]} ${p.year}`}
function dateOnlyMs(v){const t=new Date(String(v||"")+"T00:00:00").getTime();return Number.isFinite(t)?t:0}
function eventAtMs(v){const t=new Date(v||0).getTime();return Number.isFinite(t)?t:0}
function paymentGroupId(){return `PAYG-${Date.now().toString(36)}-${randomToken(4)}`}
function eventSetHash(events){return simpleHash(JSON.stringify((events||[]).map(normalizeEvent).sort(eventSort).map(e=>[e.eventId,eventFingerprint(e)])))}
function canonicalForHash(v){
  if(Array.isArray(v))return v.map(canonicalForHash);
  if(v&&typeof v==='object'){
    const o={};for(const k of Object.keys(v).sort()){if(k==='generatedAt'||k==='updatedAt'||k==='exportedAt')continue;o[k]=canonicalForHash(v[k])}return o;
  }
  return v;
}
function contentHash(v){return simpleHash(JSON.stringify(canonicalForHash(v)))}

// Preserve payment group metadata in materialized payment views.
function materializeLedger(events){
  const pkgs=new Map(),custs=new Map(),payStates=new Map(),sameMoment=new Map();
  for(const e of [...events].sort(eventSort)){
    const sig=`${e.entityKey}|${e.at}|${e.entityType}`,fp=eventFingerprint(e),prior=sameMoment.get(sig);
    if(prior&&prior!==fp)throw new Error(`Dua perubahan berbeda terjadi pada waktu identik untuk ${e.entityKey}. Sinkron dihentikan untuk mencegah pemilihan acak.`);
    sameMoment.set(sig,fp);const p=e.payload||{};
    if(e.type==='package.seed'||e.type==='package.create'||e.type==='package.update'){
      const cur=pkgs.get(e.entityKey)||{syncKey:e.entityKey,active:true};pkgs.set(e.entityKey,{...cur,...p,syncKey:e.entityKey,_lastEventId:e.eventId,_lastAt:e.at});
    }else if(e.type==='package.delete'){
      const cur=pkgs.get(e.entityKey)||{syncKey:e.entityKey};pkgs.set(e.entityKey,{...cur,active:false,_lastEventId:e.eventId,_lastAt:e.at});
    }else if(e.type==='customer.seed'||e.type==='customer.create'||e.type==='customer.update'){
      const cur=custs.get(e.entityKey)||{syncKey:e.entityKey,active:true};custs.set(e.entityKey,{...cur,...p,syncKey:e.entityKey,_lastEventId:e.eventId,_lastAt:e.at});
    }else if(e.type==='customer.deactivate'){
      const cur=custs.get(e.entityKey)||{syncKey:e.entityKey};custs.set(e.entityKey,{...cur,active:false,_lastEventId:e.eventId,_lastAt:e.at});
    }else if(e.type==='payment.paid'||e.type==='payment.cancelled'){
      const inv=e.invoiceId||e.entityKey,prev=payStates.get(inv),cycle=(prev?.cycle||0)+(e.type==='payment.paid'&&prev?.status!=='paid'?1:0);
      payStates.set(inv,{invoiceId:inv,status:e.type==='payment.paid'?'paid':'unpaid',eventId:e.eventId,at:e.at,source:e.source,cycle,payload:p});
    }
  }
  const codeOwner=new Map();for(const [key,c] of custs){if(!c.customerCode)continue;const old=codeOwner.get(c.customerCode);if(old&&old!==key)throw new Error(`Konflik kode pelanggan ${c.customerCode} dari dua perangkat. Sinkron dihentikan tanpa menghapus data.`);codeOwner.set(c.customerCode,key)}
  const packages=[...pkgs.values()],customers=[...custs.values()],payments=[],byCode=new Map(customers.map(c=>[c.customerCode,c]));
  for(const st of payStates.values()){
    if(st.status!=='paid')continue;const c=byCode.get(st.payload.customerCode);if(!c)continue;const p=st.payload||{};
    payments.push({syncKey:`PAY-${st.invoiceId}`,customerSyncKey:c.syncKey,customerCode:c.customerCode,period:p.period||st.invoiceId.slice(-7),amount:Number(p.amount||c.monthlyPrice||0),date:p.date||String(st.at).slice(0,10),method:p.method||'Tunai',note:p.note||'',eventId:st.eventId,eventAt:st.at,source:st.source,cycle:st.cycle,paymentGroupId:p.paymentGroupId||null,paymentGroupSize:Number(p.paymentGroupSize||1),paymentGroupTotal:Number(p.paymentGroupTotal||p.amount||0),paymentGroupInvoiceIds:Array.isArray(p.paymentGroupInvoiceIds)?p.paymentGroupInvoiceIds:[st.invoiceId]});
  }
  return{packages,customers,payments,paymentStates:[...payStates.values()]};
}

function customerHistoricalPrice(c,billingDate,events){
  let state={},seen=false;const cutoff=dateOnlyMs(billingDate)+86399999;
  for(const e of (events||[])){
    if(e.entityKey!==c.syncKey||!['customer.seed','customer.create','customer.update'].includes(e.type)||eventAtMs(e.at)>cutoff)continue;
    state={...state,...(e.payload||{})};seen=true;
  }
  const v=seen?Number(state.customPrice||state.monthlyPrice||0):0;
  return v||Number(c.monthlyPrice||0);
}
async function invoiceTimelineForCustomer(c,now=new Date(),prefetched=null){
  const events=prefetched?.events||await allLedgerEvents(),states=prefetched?.states||await all('paymentStates'),stateMap=prefetched?.stateMap||new Map(states.map(x=>[x.invoiceId,x]));
  const first=firstBillPeriod(c),cy=now.getFullYear(),cm=now.getMonth(),end=new Date(cy,cm+1,1),ey=end.getFullYear(),em=end.getMonth(),today=ymdLocal(now),items=[];
  for(let yy=first.year;yy<=ey;yy++){
    const from=yy===first.year?first.month:0,to=yy===ey?em:11;
    for(let mm=from;mm<=to;mm++){
      const billingPeriod=monthKey(yy,mm),billDate=ymdLocal(dueDate(c,yy,mm)),inv=invoiceId(c,yy,mm),st=stateMap.get(inv),paid=st?.status==='paid';
      let status=paid?'paid':today<billDate?'future':today===billDate?'issued':'arrears';
      const amount=paid?Number(st.payload?.amount||0)||customerHistoricalPrice(c,billDate,events):customerHistoricalPrice(c,billDate,events);
      items.push({invoiceId:inv,customerId:c.customerCode,billingPeriod,usagePeriod:previousMonthKey(yy,mm),billingDate:billDate,amount,status,paymentDate:paid?(st.payload?.date||String(st.at||'').slice(0,10)):null,paymentStateEventId:st?.eventId||null,paymentStatusAt:st?.at||null,paymentSource:st?.source||null,paymentCycle:Number(st?.cycle||0),paymentGroupId:st?.payload?.paymentGroupId||null});
    }
  }
  return items;
}
async function invoiceContextForCustomer(c,now=new Date(),prefetched=null){
  const invoices=await invoiceTimelineForCustomer(c,now,prefetched),outstanding=invoices.filter(x=>x.status==='issued'||x.status==='arrears'),payable=invoices.filter(x=>x.status!=='paid'),issued=invoices.filter(x=>x.status!=='future'),latestIssued=issued.at(-1)||null,current=invoices.find(x=>x.billingPeriod===monthKey(now.getFullYear(),now.getMonth()))||null;
  let example=null;
  if(latestIssued){const nextPeriod=nextMonthPeriod(latestIssued.billingPeriod),np=parsePeriod(nextPeriod);example={invoiceId:latestIssued.invoiceId,billingDate:latestIssued.billingDate,billingPeriod:latestIssued.billingPeriod,usagePeriod:latestIssued.usagePeriod,currentUsagePeriod:latestIssued.billingPeriod,nextBillingPeriod:nextPeriod,nextBillingDate:ymdLocal(dueDate(c,np.year,np.month))}}
  // Invoice future boleh dibayar lebih awal, tetapi tetap bukan tunggakan.
  return{invoices,outstanding,payable,latestIssued,current,outstandingCount:outstanding.length,outstandingTotal:outstanding.reduce((a,x)=>a+Number(x.amount||0),0),payableCount:payable.length,payableTotal:payable.reduce((a,x)=>a+Number(x.amount||0),0),example};
}

async function buildCurrentRecord(c,now=new Date(),prefetched=null){
  const ctx=await invoiceContextForCustomer(c,now,prefetched),cur=ctx.current||{invoiceId:invoiceId(c,now.getFullYear(),now.getMonth()),billingPeriod:monthKey(now.getFullYear(),now.getMonth()),usagePeriod:previousMonthKey(now.getFullYear(),now.getMonth()),billingDate:ymdLocal(dueDate(c,now.getFullYear(),now.getMonth())),amount:Number(c.monthlyPrice||0),status:'future'};
  const arrears=ctx.outstanding.filter(x=>x.status==='arrears');
  return{customerId:c.id,customerCode:c.customerCode,name:c.name,whatsapp:c.whatsapp||'',billingPeriod:cur.billingPeriod,usagePeriod:cur.usagePeriod,invoiceId:cur.invoiceId,billingDate:cur.billingDate,amount:Number(cur.amount||0),status:cur.status,paymentAmount:cur.status==='paid'?Number(cur.amount||0):0,paymentDate:cur.paymentDate||null,paymentStateEventId:cur.paymentStateEventId||null,paymentStatusAt:cur.paymentStatusAt||null,paymentSource:cur.paymentSource||null,paymentCycle:Number(cur.paymentCycle||0),arrearsCount:arrears.length,arrearsPeriods:arrears.map(x=>x.billingPeriod),outstandingCount:ctx.outstandingCount,outstandingTotal:ctx.outstandingTotal,outstandingPeriods:ctx.outstanding.map(x=>x.billingPeriod),latestIssuedInvoiceId:ctx.latestIssued?.invoiceId||null,latestIssuedBillingDate:ctx.latestIssued?.billingDate||null,nextBillingDate:ctx.example?.nextBillingDate||null,updatedAt:nowISO()};
}

async function openPayment(customerId,month){
  const c=(await all('customers')).find(x=>x.id===customerId);if(!c)return;const period=monthKey(selectedYear,month),existing=await paymentFor(customerId,period),ctx=await invoiceContextForCustomer(c),inv=ctx.invoices.find(x=>x.billingPeriod===period);paymentCtx={customer:c,period,existing,invoice:inv};
  $('paymentTitle').textContent=`${c.name} · ${MONTHS[month]} ${selectedYear}`;$('payPeriod').value=`${MONTHS[month]} ${selectedYear}`;$('payAmount').value=existing?existing.amount:(inv?.amount||c.monthlyPrice);$('payDate').value=existing?existing.date:ymdLocal();$('payMethod').value=existing?existing.method:'Tunai';$('payNote').value=existing?.note||'';$('deletePaymentBtn').classList.toggle('hidden',!existing);openModal('paymentModal');
}
async function savePayment(){
  if(!paymentCtx)return;await ensureV8Migration();const amount=Number($('payAmount').value.replace(/\D/g,'')),date=$('payDate').value,method=$('payMethod').value,note=$('payNote').value.trim();if(!amount||!date){toast('Lengkapi pembayaran');return}
  const c=paymentCtx.customer,inv=`${c.customerCode}-${paymentCtx.period}`,existing=paymentCtx.existing;if(existing&&Number(existing.amount)===amount&&existing.date===date&&existing.method===method&&String(existing.note||'')===note){closeModal('paymentModal');toast('Invoice ini sudah LUNAS dan tidak berubah');return}
  const pp=parsePeriod(paymentCtx.period),billDate=ymdLocal(dueDate(c,pp.year,pp.month)),usagePeriod=previousMonthKey(pp.year,pp.month),gid=existing?.paymentGroupId||paymentGroupId();
  const earlyPayment=paymentCtx.invoice?.status==='future';
  await appendLedgerEvent('payment.paid',inv,{customerCode:c.customerCode,customerName:c.name,whatsapp:c.whatsapp||'',period:paymentCtx.period,usagePeriod,billingDate:billDate,amount,date,method,note,notifyCustomer:!existing,paymentMode:earlyPayment?'early':'normal',earlyPayment,paymentGroupId:gid,paymentGroupSize:1,paymentGroupTotal:amount,paymentGroupInvoiceIds:[inv]},{invoiceId:inv,source:'billing_web'});
  await rematerializeLocal();closeModal('paymentModal');toast('Pembayaran LUNAS tercatat. Sinkronkan Drive agar bot menerima perubahan.');
}
async function deletePayment(){
  if(!paymentCtx?.existing)return;const reason=prompt('Alasan pembatalan pembayaran:','Salah klik');if(reason===null)return;if(!confirm(`Batalkan pembayaran ${paymentCtx.customer.name} periode ${paymentCtx.period}?\n\nRiwayat LUNAS tidak dihapus; event pembatalan baru akan dibuat.`))return;
  const c=paymentCtx.customer,inv=`${c.customerCode}-${paymentCtx.period}`,pp=parsePeriod(paymentCtx.period),billDate=ymdLocal(dueDate(c,pp.year,pp.month)),usagePeriod=previousMonthKey(pp.year,pp.month),ex=paymentCtx.existing;
  await appendLedgerEvent('payment.cancelled',inv,{customerCode:c.customerCode,customerName:c.name,whatsapp:c.whatsapp||'',period:paymentCtx.period,usagePeriod,billingDate:billDate,amount:Number(ex.amount||0),date:ymdLocal(),reason:String(reason||'Pembayaran dibatalkan'),askCustomerNotice:true,notifyCustomer:false,paymentGroupId:ex.paymentGroupId||null,paymentGroupSize:Number(ex.paymentGroupSize||1),paymentGroupTotal:Number(ex.paymentGroupTotal||ex.amount||0),paymentGroupInvoiceIds:ex.paymentGroupInvoiceIds||[inv]},{invoiceId:inv,source:'billing_web'});
  await rematerializeLocal();closeModal('paymentModal');toast('Pembayaran dibatalkan sebagai event. Sinkronkan Drive.');
}

async function openCustomerDetail(id){
  detailCustomerId=id;const c=(await all('customers')).find(x=>x.id===id);if(!c)return;const ctx=await invoiceContextForCustomer(c);$('detailCustomerName').textContent=c.name;
  $('detailCustomerInfo').innerHTML=`<div class="detail-grid"><div class="detail-cell"><span>Paket</span><b>${c.packageName} · ${c.speed}</b></div><div class="detail-cell"><span>Tarif saat ini</span><b>${money(c.monthlyPrice)}</b></div><div class="detail-cell"><span>WhatsApp</span><b>${c.whatsapp||'-'}</b></div><div class="detail-cell"><span>Registrasi</span><b>${c.registrationDate}</b></div><div class="detail-cell"><span>Mulai layanan</span><b>${c.startDate}</b></div><div class="detail-cell"><span>Tagihan pertama</span><b>${c.firstBillDate}</b></div><div class="detail-cell"><span>Belum lunas</span><b>${ctx.outstandingCount} invoice · ${money(ctx.outstandingTotal)}</b></div><div class="detail-cell"><span>Tagihan terbaru terbit</span><b>${ctx.latestIssued?`${periodLabel(ctx.latestIssued.usagePeriod)} · ${ctx.latestIssued.billingDate}`:'Belum ada'}</b></div></div>`;
  const btn=$('multiPaymentOpenBtn');if(btn){btn.disabled=ctx.payableCount===0;btn.textContent=ctx.payableCount?`✓ Lunasi tagihan (${ctx.payableCount})`:'✓ Tidak ada tagihan yang dapat dilunasi'}
  const ps=(await paymentsForCustomer(id)).sort((a,b)=>b.period.localeCompare(a.period)),hist=$('detailPaymentHistory');hist.innerHTML='';if(!ps.length)hist.innerHTML='<div class="empty-state">Belum ada pembayaran.</div>';
  ps.forEach(p=>{const {year,month}=parsePeriod(p.period),d=document.createElement('div');d.className='history-row';d.innerHTML=`<div><b>${MONTHS[month]} ${year}</b><small>${p.date} · ${p.method}${p.paymentGroupId?` · ${p.paymentGroupId}`:''}</small></div><b>${money(p.amount)}</b>`;hist.appendChild(d)});openModal('customerDetailModal');
}
async function openMultiPayment(){
  if(!detailCustomerId)return;const c=(await all('customers')).find(x=>x.id===detailCustomerId);if(!c)return;const ctx=await invoiceContextForCustomer(c),items=ctx.payable;
  if(!items.length){toast('Tidak ada invoice yang dapat dilunasi');return}multiPaymentCtx={customer:c,items};$('multiPaymentTitle').textContent=`${c.name} · Pilih tagihan`;$('multiPayDate').value=ymdLocal();$('multiPayMethod').value='Tunai';$('multiPayNote').value='';const box=$('multiInvoiceList');box.innerHTML='';
  for(const x of items){const row=document.createElement('label');row.className='multi-invoice-row';const label=x.status==='future'?'Bisa dibayar lebih awal':(x.status==='arrears'?'Tunggak':'Tagihan terbit');row.innerHTML=`<input type="checkbox" class="multi-invoice-check" data-invoice="${x.invoiceId}" checked><div class="multi-invoice-copy"><b>Pemakaian ${periodLabel(x.usagePeriod)}</b><small>Jatuh tempo ${x.billingDate} · ${label}</small></div><span class="multi-invoice-amount">${money(x.amount)}</span>`;box.appendChild(row)}
  box.querySelectorAll('.multi-invoice-check').forEach(el=>el.addEventListener('change',updateMultiPaymentTotal));updateMultiPaymentTotal();openModal('multiPaymentModal');
}
function selectedMultiInvoices(){if(!multiPaymentCtx)return[];const ids=new Set([...document.querySelectorAll('.multi-invoice-check:checked')].map(x=>x.dataset.invoice));return multiPaymentCtx.items.filter(x=>ids.has(x.invoiceId))}
function updateMultiPaymentTotal(){const xs=selectedMultiInvoices();$('multiPaymentTotal').textContent=money(xs.reduce((a,x)=>a+Number(x.amount||0),0))}
async function saveMultiPayment(){
  if(!multiPaymentCtx)return;const selected=selectedMultiInvoices();if(!selected.length){toast('Pilih minimal satu invoice');return}const date=$('multiPayDate').value,method=$('multiPayMethod').value,note=$('multiPayNote').value.trim();if(!date){toast('Tanggal pembayaran belum diisi');return}
  const c=multiPaymentCtx.customer,gid=paymentGroupId(),total=selected.reduce((a,x)=>a+Number(x.amount||0),0),ids=selected.map(x=>x.invoiceId),notifyInvoice=[...selected].sort((a,b)=>a.billingDate.localeCompare(b.billingDate)).at(-1)?.invoiceId;
  if(!confirm(`Tandai ${selected.length} invoice sebagai LUNAS?\n\nTotal: ${money(total)}\nPayment Group: ${gid}`))return;await ensureV8Migration();const at=nowISO();
  for(const x of selected){const earlyPayment=x.status==='future';await appendLedgerEvent('payment.paid',x.invoiceId,{customerCode:c.customerCode,customerName:c.name,whatsapp:c.whatsapp||'',period:x.billingPeriod,usagePeriod:x.usagePeriod,billingDate:x.billingDate,amount:Number(x.amount||0),date,method,note,notifyCustomer:x.invoiceId===notifyInvoice,paymentMode:earlyPayment?'early':'normal',earlyPayment,paymentGroupId:gid,paymentGroupSize:selected.length,paymentGroupTotal:total,paymentGroupInvoiceIds:ids,paymentGroupUsagePeriods:selected.map(i=>i.usagePeriod),paymentGroupBillingDates:selected.map(i=>i.billingDate)},{invoiceId:x.invoiceId,source:'billing_web',at});}
  await rematerializeLocal();closeModal('multiPaymentModal');closeModal('customerDetailModal');multiPaymentCtx=null;toast(`${selected.length} invoice LUNAS · ${gid}`);
}

function driveStructureCacheV81(){try{return JSON.parse(localStorage.getItem(V81_STRUCTURE_CACHE_KEY)||'{}')}catch{return{}}}
function saveDriveStructureCacheV81(st){localStorage.setItem(V81_STRUCTURE_CACHE_KEY,JSON.stringify(Object.fromEntries(Object.entries(st).map(([k,v])=>[k,{id:v.id,name:v.name}]))))}
async function ensureDriveStructure(){
  const c=driveStructureCacheV81(),need=['root','data','payments','bot','events','eventsBilling','backups'];if(need.every(k=>c[k]?.id))return c;
  const root=await ensureFolder(ROOT_FOLDER),[data,payments,bot,events,backups]=await Promise.all([ensureFolder('data',root.id),ensureFolder('payments',root.id),ensureFolder('bot',root.id),ensureFolder('events',root.id),ensureFolder('backups',root.id)]),eventsBilling=await ensureFolder('billing',events.id),st={root,data,payments,bot,events,eventsBilling,backups};saveDriveStructureCacheV81(st);return st;
}
async function driveMeta(id){return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,parents,modifiedTime,size,trashed`)).json()}
async function findJson(name,parentId){
  const cached=cachedDriveId(parentId,name);if(cached){try{const m=await driveMeta(cached);if(!m.trashed&&m.name===name){cacheDriveId(parentId,name,m.id);return m}}catch{forgetDriveId(parentId,name)}}
  const files=await findJsonAll(name,parentId);if(!files.length)return null;files.sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')));const keep=files[0];cacheDriveId(parentId,name,keep.id);return keep;
}
function remoteCacheKey(id){return `driveRemote:${id}`}
function driveFileSig(f){return `${f.id}|${f.modifiedTime||''}`}
async function remoteCacheGet(id){return await getOne('meta',remoteCacheKey(id))}
async function remoteCachePut(f,events){await put('meta',{key:remoteCacheKey(f.id),sig:driveFileSig(f),name:f.name,events,at:nowISO()})}
async function readDriveJsonFast(f,cacheName){
  const key=`driveJson:${cacheName}:${f.id}`,c=await getOne('meta',key),sig=driveFileSig(f);
  if(c?.sig===sig&&c.data)return c.data;
  const data=await downloadDrive(f.id);await put('meta',{key,sig,data,at:nowISO()});return data;
}
async function readDriveBillingEventsFast(st){
  const files=(await listDriveAll(`'${qEscape(st.eventsBilling.id)}' in parents and trashed=false`)).filter(f=>f.mimeType!=='application/vnd.google-apps.folder'),results=await Promise.all(files.map(async f=>{const c=await remoteCacheGet(f.id);if(c?.sig===driveFileSig(f)&&Array.isArray(c.events))return{f,events:c.events,cached:true};const d=await downloadDrive(f.id),ev=Array.isArray(d?.events)?d.events:(d?.eventId?[d]:null);if(!ev)throw new Error(`${f.name}: format event tidak valid`);await remoteCachePut(f,ev);return{f,events:ev,cached:false}}));
  return{files,events:results.flatMap(x=>x.events),perFile:new Map(results.map(x=>[x.f.id,x.events])),downloaded:results.filter(x=>!x.cached).length,cached:results.filter(x=>x.cached).length,signature:results.map(x=>driveFileSig(x.f)).sort().join('||')};
}
async function ensureBotEventsFile(st){
  let f=await findJson('bot-events.json',st.bot.id);if(!f)f=await createJson('bot-events.json',{schema:1,events:[],updatedAt:nowISO()},st.bot.id);const key=`botPermission:${f.id}`,pc=await getOne('meta',key),fresh=pc?.ok&&(Date.now()-Number(pc.checkedAt||0)<V81_BOT_PERMISSION_TTL);
  if(!fresh){try{const j=await (await driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?fields=permissions(id,emailAddress,role,type)`)).json();const ok=(j.permissions||[]).some(x=>String(x.emailAddress||'').toLowerCase()===BOT_SERVICE_ACCOUNT.toLowerCase()&&['writer','owner'].includes(x.role));if(!ok)await driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?sendNotificationEmail=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'user',role:'writer',emailAddress:BOT_SERVICE_ACCOUNT})});await put('meta',{key,ok:true,checkedAt:Date.now()})}catch(e){throw new Error(`Izin Writer service account ke bot-events.json gagal dipastikan. Sinkron dihentikan agar integrasi pembayaran tidak setengah aktif. ${e.message||e}`)}}return f;
}
async function readBotLedgerFast(st){
  let f=await ensureBotEventsFile(st);if(!f.modifiedTime)f=await driveMeta(f.id);const c=await remoteCacheGet(f.id);if(c?.sig===driveFileSig(f)&&Array.isArray(c.events))return{file:f,events:c.events,cached:true};const d=await downloadDrive(f.id);if(!d||!Array.isArray(d.events))throw new Error('bot-events.json tidak valid/tidak dapat dibaca. Sinkron dihentikan agar event bot tidak terlewat.');await remoteCachePut(f,d.events);return{file:f,events:d.events,cached:false};
}
async function getCloudHeaderV8(st=null){st=st||await ensureDriveStructure();const mf=await findJson('manifest.json',st.data.id);if(mf){const manifest=await readDriveJsonFast(mf,'manifest');return{kind:Number(manifest?.schema)>=8?'v8':'v7',root:st.root,data:st.data,manifest,file:mf}}const legacy=await findLegacyMain();if(legacy){const data=await readDriveJsonFast(legacy,'legacy-main');return{kind:'legacy',file:legacy,data,manifest:{schema:1,revision:data.revision||0,modifiedAt:data.modifiedAt||null,counts:summary(data)}}}return{kind:'empty',manifest:null}}
function deviceEventsForLog(events,deviceId){return(events||[]).filter(e=>e.deviceId===deviceId||e.deviceId==='migration-local'||e.source==='local_v7_migration')}
async function createDeltaDeviceBackup(st,file){if(!file?.id)return null;const stamp=new Date().toISOString().replace(/[:.]/g,'-'),name=`DELTA_${file.name||'device-events'}_${stamp}.json`;return await copyFile(file.id,name,st.backups.id)}
async function upsertDeviceLogFast(st,events,remote){
  const deviceId=await getDeviceId(),mine=deviceEventsForLog(events,deviceId),name=`device_${deviceId}.json`,existing=remote.files.find(f=>f.name===name)||null,remoteEvents=existing?remote.perFile.get(existing.id)||[]:[],same=eventSetHash(mine)===eventSetHash(remoteEvents);if(same)return{changed:false,file:existing,events:mine};
  if(existing){const fresh=await driveMeta(existing.id);if(String(fresh.modifiedTime||'')!==String(existing.modifiedTime||''))throw new Error(`Log event perangkat ${name} berubah di Drive saat sinkron berlangsung. Tidak ada file yang ditimpa. Jalankan sinkron sekali lagi agar perubahan terbaru ikut digabung.`);await createDeltaDeviceBackup(st,existing)}const data={schema:2,deviceId,eventCount:mine.length,contentHash:eventSetHash(mine),updatedAt:nowISO(),events:mine},saved=existing?await updateJson(existing.id,data):await createJson(name,data,st.eventsBilling.id);const f={...existing,...saved,name};await remoteCachePut(f,mine);return{changed:true,file:f,events:mine};
}
function buildPaymentGroups(events){
  const groups=new Map();for(const e of (events||[]).filter(x=>x.type==='payment.paid').sort(eventSort)){const p=e.payload||{},gid=p.paymentGroupId||`SINGLE-${e.eventId}`,g=groups.get(gid)||{paymentGroupId:gid,customerId:p.customerCode||'',customerName:p.customerName||'',whatsapp:p.whatsapp||'',date:p.date||String(e.at).slice(0,10),method:p.method||'',createdAt:e.at,byInvoice:new Map()};g.byInvoice.set(e.invoiceId||e.entityKey,e);g.createdAt=String(g.createdAt).localeCompare(String(e.at))<0?e.at:g.createdAt;groups.set(gid,g)}
  return[...groups.values()].map(g=>{const ev=[...g.byInvoice.values()].sort((a,b)=>String(a.payload?.billingDate||'').localeCompare(String(b.payload?.billingDate||''))),invoices=ev.map(e=>({invoiceId:e.invoiceId,period:e.payload?.period||'',usagePeriod:e.payload?.usagePeriod||'',billingDate:e.payload?.billingDate||'',amount:Number(e.payload?.amount||0),eventId:e.eventId,notifyCustomer:e.payload?.notifyCustomer!==false}));return{paymentGroupId:g.paymentGroupId,customerId:g.customerId,customerName:g.customerName,whatsapp:g.whatsapp,date:g.date,method:g.method,invoiceCount:invoices.length,total:invoices.reduce((a,x)=>a+x.amount,0),invoiceIds:invoices.map(x=>x.invoiceId),invoices,notifyEventId:invoices.find(x=>x.notifyCustomer)?.eventId||null,createdAt:g.createdAt}}).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,250);
}
async function deriveCurrentFilesForV8(st,events){
  const state=await getState(),packages=await all('packages'),customers=await all('customers'),payments=await all('payments'),years=groupPaymentsByYear(payments),summaryFile=await buildSummaryFile(),cur=await all('current'),curMap=new Map(cur.map(x=>[x.customerCode,x])),states=await all('paymentStates'),pref={events,states,stateMap:new Map(states.map(x=>[x.invoiceId,x]))},botFile=await ensureBotEventsFile(st),botCustomers=[];
  for(const c of customers.filter(x=>x.active!==false)){
    const ctx=await invoiceContextForCustomer(c,new Date(),pref),r=curMap.get(c.customerCode)||{},out=ctx.outstanding.map(x=>({...x,billingState:x.status,status:'unpaid'})),payable=ctx.payable.map(x=>({...x,billingState:x.status,status:'unpaid'})),latest=ctx.latestIssued;
    botCustomers.push({invoiceId:r.invoiceId||ctx.current?.invoiceId||null,customerId:c.customerCode,name:c.name,whatsapp:c.whatsapp||'',billingPeriod:r.billingPeriod||ctx.current?.billingPeriod||null,usagePeriod:r.usagePeriod||ctx.current?.usagePeriod||null,billingDate:r.billingDate||ctx.current?.billingDate||null,amount:Number(r.amount||ctx.current?.amount||c.monthlyPrice||0),status:r.status==='paid'?'paid':'unpaid',paymentDate:r.paymentDate||null,paymentStateEventId:r.paymentStateEventId||null,paymentStatusAt:r.paymentStatusAt||null,paymentSource:r.paymentSource||null,paymentCycle:Number(r.paymentCycle||0),billingDay:new Date(c.firstBillDate+'T00:00:00').getDate(),outstandingInvoices:out,outstandingCount:ctx.outstandingCount,outstandingTotal:ctx.outstandingTotal,outstandingInvoiceIds:out.map(x=>x.invoiceId),latestOutstandingInvoice:out.at(-1)||null,earlyPaymentInvoices:payable,earlyPaymentCount:ctx.payableCount,earlyPaymentTotal:ctx.payableTotal,latestIssuedInvoice:latest||null,pascaBayarExample:ctx.example,dynamicMessage:{mode:'adaptive-single-multiple',unpaid:{invoiceCount:ctx.outstandingCount,total:ctx.outstandingTotal,invoices:out,example:ctx.example}}});
  }
  const recentPay=events.filter(e=>e.type==='payment.paid'||e.type==='payment.cancelled').sort(eventSort).slice(-500).map(e=>({...e,payload:{...e.payload}})),paymentGroups=buildPaymentGroups(events),maxAt=events.length?[...events].sort(eventSort).at(-1).at:null;
  const bot={schema:WA_STATUS_SCHEMA,app:'MAHDY-NET Billing V8.1',generatedAt:nowISO(),revision:state.revision||0,botEventsFileId:botFile.id,templateCapabilities:{version:1,mode:'adaptive-single-multiple',templates:['dynamic_bill_unpaid','dynamic_bill_paid'],variables:['nama','jumlah_invoice','rincian_invoice','total_tagihan','tanggal_terbit_terbaru','periode_pemakaian_terbaru','periode_tagihan_terbaru','tanggal_tagihan_berikutnya','tanda_tangan']},customers:botCustomers,packages:packages.filter(p=>p.active!==false).map(p=>({id:p.packageCode||p.syncKey,name:p.name||'',speed:p.speed||'',price:Number(p.price||0),active:true})),paymentEvents:recentPay,paymentGroups};
  const manifest={schema:8,app:'MAHDY-NET Billing V8.3 Fast Event Ledger',revision:state.revision||0,modifiedAt:maxAt||state.modifiedAt||null,generatedAt:nowISO(),counts:{customers:customers.length,packages:packages.length,payments:payments.length,events:events.length,billingEvents:events.filter(e=>e.deviceId!=='wa-bot').length,botEvents:events.filter(e=>e.deviceId==='wa-bot').length},eventModel:'append-only',syncEngine:'fast-incremental-v2-no-change',eventHash:eventSetHash(events),paymentYears:Object.keys(years).sort()};
  const bundle={manifest,packages:{schema:8,items:packages},customers:{schema:8,items:customers},current:{schema:8,items:cur},summary:summaryFile,paymentYears:years,bot};
  const hashes={packages:contentHash(bundle.packages),customers:contentHash(bundle.customers),current:contentHash(bundle.current),summary:contentHash(bundle.summary),bot:contentHash(bundle.bot),paymentYears:{}};for(const [y,items] of Object.entries(years))hashes.paymentYears[y]=contentHash({schema:8,year:Number(y),items});bundle.manifest.fileHashes=hashes;return bundle;
}
async function knownFolderMaps(st){const [data,payments,bot]=await Promise.all([listChildren(st.data.id),listChildren(st.payments.id),listChildren(st.bot.id)]);return{data:new Map(data.map(x=>[x.name,x])),payments:new Map(payments.map(x=>[x.name,x])),bot:new Map(bot.map(x=>[x.name,x]))}}
async function saveKnownJson(name,data,parentId,map){const f=map.get(name);if(f){const u=await updateJson(f.id,data);map.set(name,{...f,...u,name});cacheDriveId(parentId,name,f.id);return u}const c=await createJson(name,data,parentId);map.set(name,{...c,name});return c}
async function writeV8DerivedFast(st,bundle,oldManifest){
  const maps=await knownFolderMaps(st),oldH=oldManifest?.fileHashes||{},newH=bundle.manifest.fileHashes||{},jobs=[],changed=[];
  const add=(kind,name,data,parent,map,oldHash,newHash)=>{if(oldHash===newHash&&oldHash)return;changed.push(name);jobs.push(saveKnownJson(name,data,parent,map))};
  add('data','packages.json',bundle.packages,st.data.id,maps.data,oldH.packages,newH.packages);add('data','customers.json',bundle.customers,st.data.id,maps.data,oldH.customers,newH.customers);add('data','current.json',bundle.current,st.data.id,maps.data,oldH.current,newH.current);add('data','summary.json',bundle.summary,st.data.id,maps.data,oldH.summary,newH.summary);add('bot','wa-status.json',bundle.bot,st.bot.id,maps.bot,oldH.bot,newH.bot);
  const years=new Set([...(oldManifest?.paymentYears||[]),...Object.keys(bundle.paymentYears)]);for(const y of years){const data={schema:8,year:Number(y),items:bundle.paymentYears[y]||[]},nh=contentHash(data),oh=oldH.paymentYears?.[y];bundle.manifest.fileHashes.paymentYears[y]=nh;add('payments',`${y}.json`,data,st.payments.id,maps.payments,oh,nh)}
  await Promise.all(jobs);const manifestCoreChanged=!oldManifest||oldManifest.eventHash!==bundle.manifest.eventHash||JSON.stringify(oldManifest.fileHashes||{})!==JSON.stringify(bundle.manifest.fileHashes||{})||JSON.stringify(oldManifest.counts||{})!==JSON.stringify(bundle.manifest.counts||{});if(manifestCoreChanged){changed.push('manifest.json');await saveKnownJson('manifest.json',bundle.manifest,st.data.id,maps.data)}return{changed};
}
async function openSafeSync(){
  if(!googleAccessToken){toast('Hubungkan Google Drive dulu');showView('dataView');return}const btn=$('safeSyncBtn'),label=btn.querySelector('.sync-button-label');btn.classList.add('busy');label.textContent='Memeriksa perubahan…';try{await ensureV8Migration();const [local,st]=await Promise.all([allLedgerEvents(),ensureDriveStructure()]),head=await getCloudHeaderV8(st),localSummary=summary(await exportData()),cc=head.manifest?.counts||{};$('localCustomerCount').textContent=`${localSummary.customers} pelanggan`;$('localPaymentCount').textContent=`${localSummary.payments} pembayaran · ${local.length} event`;$('localModified').textContent=(await getState()).modifiedAt?new Date((await getState()).modifiedAt).toLocaleString('id-ID'):'Belum ada perubahan';$('cloudCustomerCount').textContent=head.kind==='empty'?'Belum ada data':`${cc.customers??'?'} pelanggan`;$('cloudPaymentCount').textContent=head.kind==='empty'?'—':`${cc.payments??'?'} pembayaran · ${cc.billingEvents??'?'} event billing · ${cc.botEvents??'?'} event bot`;$('cloudModified').textContent=head.manifest?.modifiedAt?new Date(head.manifest.modifiedAt).toLocaleString('id-ID'):head.kind.toUpperCase();const w=$('syncWarning');w.className='sync-warning good';w.innerHTML=`<b>Fast No-Change Mode V8.3.</b> Jika sidik data HP, Drive, dan bot sama, proses berhenti tanpa menghitung atau menulis ulang file. Jika ada perubahan, sinkron penuh berjalan otomatis.`;$('pullDriveBtn').classList.add('hidden');$('pushDriveBtn').classList.add('hidden');$('mergeDriveBtn')?.classList.remove('hidden');openModal('syncModal')}catch(e){alert('Gagal membandingkan event: '+e.message)}finally{btn.classList.remove('busy');label.textContent='Bandingkan & Sinkron'}
}
async function syncEventLedger({showResult=true}={}){
  if(!googleAccessToken)throw new Error('Hubungkan Google Drive dulu');if(driveWriteLock)throw new Error('Sinkronisasi masih berjalan');driveWriteLock=true;const started=performance.now();try{
    await ensureV8Migration();const local=await allLedgerEvents(),st=await ensureDriveStructure(),head=await getCloudHeaderV8(st),[remote,botLedger]=await Promise.all([readDriveBillingEventsFast(st),readBotLedgerFast(st)]);
    if(head.kind==='v8'){const expected=Number(head.manifest?.counts?.billingEvents??0),uniqueRemote=mergeEventSets(remote.events).length;if(expected>uniqueRemote)throw new Error(`Manifest V8 mencatat ${expected} event billing tetapi hanya ${uniqueRemote} event unik yang terbaca. Sinkron dihentikan tanpa menulis agar event tidak terlewat.`)}
    const localHash=eventSetHash(local),remoteUnion=mergeEventSets(remote.events,botLedger.events),remoteHash=eventSetHash(remoteUnion),lastSync=await getOne('meta','lastV8Sync'),today=ymdLocal(),botSignature=driveFileSig(botLedger.file||{}),manifestHash=String(head.manifest?.eventHash||'');
    const fastNoChange=head.kind==='v8'&&manifestHash&&localHash===manifestHash&&remoteHash===manifestHash&&remote.downloaded===0&&botLedger.cached===true&&String(lastSync?.syncDate||String(lastSync?.at||'').slice(0,10))===today;
    if(fastNoChange){
      const elapsed=Math.round(performance.now()-started),report={fastNoChange:true,mode:'no-change',syncDate:today,localHash,remoteSignature:remote.signature,botSignature,localBefore:{customers:(await all('customers')).length,payments:(await all('payments')).length,events:local.length},driveEvents:mergeEventSets(remote.events).length,botEvents:botLedger.events.length,legacyEvents:0,mergedEvents:local.length,customers:(await all('customers')).length,payments:(await all('payments')).length,eventFilesDownloaded:0,eventFilesFromCache:remote.cached+(botLedger.cached?1:0),deviceLogChanged:false,derivedFilesChanged:[],elapsedMs:elapsed};
      await put('meta',{key:'lastV8Sync',at:nowISO(),syncDate:today,report,...report});if(showResult)toast(`Fast Check selesai · ${(elapsed/1000).toFixed(1)} dtk · tidak ada perubahan`);return report;
    }
    let legacyEvents=[];if((head.kind==='v7'||head.kind==='legacy')&&remote.events.length===0){const data=head.kind==='legacy'?head.data:await readV7Bundle(head);legacyEvents=legacyEventsFromData(data,'drive_v7_migration').map(e=>({...e,deviceId:'migration-local'}))}
    let union=mergeEventSets(local,remote.events,botLedger.events,legacyEvents);materializeLedger(union);const localBefore={customers:(await all('customers')).length,payments:(await all('payments')).length,events:local.length};if((head.kind==='v7'||head.kind==='legacy')&&head.kind!=='empty')await createStructuredSafetyBackup(st,'MIGRASI_KE_V81');
    const dev=await upsertDeviceLogFast(st,union,remote);
    // Final metadata pass. Unchanged files reuse verified cache; only changed/new files are downloaded.
    const [finalRemote,finalBot]=await Promise.all([readDriveBillingEventsFast(st),readBotLedgerFast(st)]);union=mergeEventSets(union,finalRemote.events,finalBot.events);const mat=materializeLedger(union);await commitMaterialized(mat,union);const bundle=await deriveCurrentFilesForV8(st,union),write=await writeV8DerivedFast(st,bundle,head.manifest||null),elapsed=Math.round(performance.now()-started);
    const report={fastNoChange:false,mode:'full',syncDate:ymdLocal(),localHash:eventSetHash(union),remoteSignature:finalRemote.signature,botSignature:driveFileSig(finalBot.file||{}),localBefore,driveEvents:mergeEventSets(finalRemote.events).length,botEvents:finalBot.events.length,legacyEvents:legacyEvents.length,mergedEvents:union.length,customers:mat.customers.length,payments:mat.payments.length,eventFilesDownloaded:remote.downloaded+finalRemote.downloaded,eventFilesFromCache:remote.cached+finalRemote.cached,deviceLogChanged:dev.changed,derivedFilesChanged:write.changed,elapsedMs:elapsed};await put('meta',{key:'lastV8Sync',at:nowISO(),syncDate:report.syncDate,report,...report});if(showResult)toast(`Fast Sync selesai · ${(elapsed/1000).toFixed(1)} dtk · ${union.length} event`);return report;
  }finally{driveWriteLock=false}
}
async function mergeDriveNow(){if(!confirm('Gabungkan event HP + Google Drive + WhatsApp Bot sekarang?\n\nFast Sync hanya mengunduh event yang berubah. Event Ledger tetap append-only dan log perangkat dibackup delta sebelum ditulis.'))return;try{const r=await syncEventLedger();closeModal('syncModal');await renderAll();if(r.fastNoChange){alert(`Fast Check selesai.\n\nWaktu: ${(r.elapsedMs/1000).toFixed(1)} detik\nTidak ada perubahan. Tidak ada file yang ditulis ulang.\nEvent: ${r.mergedEvents}\nPelanggan: ${r.customers}`);return}alert(`Fast Event Sync selesai.\n\nWaktu: ${(r.elapsedMs/1000).toFixed(1)} detik\nEvent gabungan: ${r.mergedEvents}\nEvent file diunduh: ${r.eventFilesDownloaded}\nCache event dipakai: ${r.eventFilesFromCache}\nFile turunan berubah: ${r.derivedFilesChanged.length}\nPelanggan: ${r.customers}\nInvoice LUNAS: ${r.payments}`)}catch(e){alert('Sinkron V8.3 dihentikan: '+e.message)}}
async function exportData(){const state=await getState();return{schema:8,app:'MAHDY-NET Billing V8.1 Fast Event Ledger',revision:state.revision||0,modifiedAt:state.modifiedAt||null,exportedAt:nowISO(),packages:await all('packages'),customers:await all('customers'),payments:await all('payments'),events:await allLedgerEvents()}}
function updateDriveUI(){const ok=!!googleAccessToken;$('driveBadge').classList.toggle('ok',ok);$('driveBadge').querySelector('span').textContent=ok?'Drive terhubung':'Drive belum terhubung';$('driveStatusText').textContent=ok?'Terhubung · Fast Event Sync siap':'Belum terhubung';$('driveAccountText').textContent=ok?(googleAccountLabel||'Sesi Google tersimpan di perangkat ini'):'Akun Google belum dipilih';$('topDriveText').textContent=ok?'● Terhubung':'Belum terhubung';$('topDrivePill').classList.toggle('connected',ok);$('connectDriveBtn').classList.toggle('hidden',ok);$('driveAccountActions').classList.toggle('hidden',!ok)}

$('multiPaymentOpenBtn')?.addEventListener('click',openMultiPayment);
$('saveMultiPaymentBtn')?.addEventListener('click',saveMultiPayment);

function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.view===id));
  const active=document.getElementById(id);
  if(active){
    active.animate([{opacity:.68,transform:"translateY(6px)"},{opacity:1,transform:"translateY(0)"}],{duration:180,easing:"ease-out"});
  }
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-item").forEach(n=>n.addEventListener("click",()=>showView(n.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
$("quickAddCustomer").addEventListener("click",()=>openCustomerForm());
$("addCustomerOpen").addEventListener("click",()=>openCustomerForm());
$("addPackageOpen").addEventListener("click",()=>openPackageForm());
$("saveCustomerBtn").addEventListener("click",saveCustomer);
$("savePackageBtn").addEventListener("click",savePackage);
$("savePaymentBtn").addEventListener("click",savePayment);
$("deletePaymentBtn").addEventListener("click",deletePayment);
$("editCustomerBtn").addEventListener("click",()=>{const id=detailCustomerId;closeModal("customerDetailModal");if(id!=null)openCustomerForm(id)});
$("fStartDate").addEventListener("change",()=>{if(!$("fStartDate").value)return;const d=new Date($("fStartDate").value+"T00:00:00");d.setMonth(d.getMonth()+1);$("fFirstBillDate").value=ymdLocal(d)});
$("customerSearch").addEventListener("input",()=>{currentPage=1;renderCustomerTable()});
$("customerStatusFilter").addEventListener("change",()=>{currentPage=1;renderCustomerTable()});
$("customerSort").addEventListener("change",()=>{currentPage=1;renderCustomerTable()});
$("customerTotalPill").addEventListener("click",()=>$("customerSearch").focus());
$("mobilePrevMonth").addEventListener("click",()=>{mobileSelectedMonth--;if(mobileSelectedMonth<0){mobileSelectedMonth=11;selectedYear--;$('yearSelect').value=selectedYear}currentPage=1;renderCustomerTable()});
$("mobileNextMonth").addEventListener("click",()=>{mobileSelectedMonth++;if(mobileSelectedMonth>11){mobileSelectedMonth=0;selectedYear++;$('yearSelect').value=selectedYear}currentPage=1;renderCustomerTable()});
$("paymentSearch").addEventListener("input",renderPayments);
$("paymentYearSelect")?.addEventListener("change",renderPayments);
$("yearSelect").addEventListener("change",()=>{selectedYear=Number($("yearSelect").value);renderCustomerTable()});
$("pageSize").addEventListener("change",()=>{currentPage=1;renderCustomerTable()});
$("connectDriveBtn").addEventListener("click",connectDrive);
$("disconnectDriveBtn").addEventListener("click",disconnectDrive);
$("switchDriveBtn").addEventListener("click",switchDriveAccount);
$("topDrivePill").addEventListener("click",()=>showView("dataView"));
$("safeSyncBtn").addEventListener("click",openSafeSync);
$("pullDriveBtn").addEventListener("click",pullFromDrive);
$("pushDriveBtn").addEventListener("click",pushToDrive);
$("mergeDriveBtn")?.addEventListener("click",mergeDriveNow);
$("backupBtn").addEventListener("click",backupNow);
$("restoreBtn").addEventListener("click",openRestore);
$("exportBtn").addEventListener("click",exportLocal);
$("importFile").addEventListener("change",async e=>{if(e.target.files[0]){try{await importLocalFile(e.target.files[0])}catch(err){alert("Import gagal: "+err.message)}e.target.value=""}});

(async()=>{
  await openDB();await ensureCustomerCodes();await ensureV8Migration();initYears();initDefaultDates();await fillPackageSelect("fCustomerPackage");
  const py=$("paymentYearSelect");if(py){const y=new Date().getFullYear();for(let i=y-10;i<=y+1;i++){const o=document.createElement("option");o.value=i;o.textContent=i;if(i===y)o.selected=true;py.appendChild(o)}}
  const restored=restoreGoogleSession();await rebuildCurrentSnapshot();updateDriveUI();if(restored)loadGoogleAccount();else autoReconnectGoogle();await renderAll();
})();async function migrateWhatsappFields(){
  const cs=await all("customers");let changed=false;
  for(const c of cs){const n=normalizeWhatsApp(c.whatsapp||"");if(c.whatsapp!==n){c.whatsapp=n;await put("customers",c);changed=true}}
  return changed;
}
