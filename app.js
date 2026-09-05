
const MONTHS=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const DB_NAME="mahdy_net_billing_safe";
const DB_VERSION=2;
const CLIENT_ID="1048608388100-1jghinhuoff1necs78hd44h7ql0rjhj7.apps.googleusercontent.com";
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.file";
const LEGACY_MAIN_FILE="mahdy-net-data.json";
const ROOT_FOLDER="MAHDY-NET Billing";
const BACKUP_PREFIX="MAHDY-NET_Backup_";
const SNAPSHOT_PREFIX="SNAPSHOT_";
let db,currentPage=1,selectedYear=new Date().getFullYear(),editingCustomerId=null,editingPackageId=null,paymentCtx=null;
let googleTokenClient=null,googleAccessToken=null,cloudSnapshot=null;

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
function closeModal(id){$(id).classList.remove("show")}
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
  const status=payment?"paid":await statusFor(c,y,m);const bill=dueDate(c,y,m);
  return{customerId:c.id,customerCode:c.customerCode,name:c.name,whatsapp:c.whatsapp||"",billingPeriod,usagePeriod:previousMonthKey(y,m),invoiceId:invoiceId(c,y,m),billingDate:ymdLocal(bill),amount:Number(c.monthlyPrice||0),status,paymentAmount:payment?Number(payment.amount||0):0,paymentDate:payment?.date||null,arrearsCount:arrears.length,arrearsPeriods:arrears,updatedAt:nowISO()};
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
  const name=$("fCustomerName").value.trim(),whatsapp=normalizeWhatsApp($("fCustomerWhatsapp").value),packageId=Number($("fCustomerPackage").value),reg=$("fRegistrationDate").value,start=$("fStartDate").value,first=$("fFirstBillDate").value;
  if(!name||!packageId||!reg||!start||!first){toast("Lengkapi data pelanggan");return}
  const pkg=(await all("packages")).find(x=>x.id===packageId);if(!pkg)return;
  const customPrice=Number($("fCustomerPrice").value.replace(/\D/g,""))||null;
  if(editingCustomerId){
    const c=(await all("customers")).find(x=>x.id===editingCustomerId);
    Object.assign(c,{name,whatsapp,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first,updatedAt:nowISO()});
    await put("customers",c);
  }else{
    await add("customers",{customerCode:await nextCustomerCode(),name,whatsapp,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first,active:true,createdAt:nowISO()});
  }
  await touchData();const targetId=editingCustomerId||(await all("customers")).slice(-1)[0]?.id;if(targetId)await refreshCurrentForCustomer(targetId);await rebuildSummary();closeModal("customerFormModal");await renderAll();toast("Pelanggan disimpan");
}

async function renderCustomerTable(){
  const tr=$("customerHeader");while(tr.children.length>2)tr.removeChild(tr.lastChild);
  MONTHS.forEach(m=>{const th=document.createElement("th");th.textContent=m;tr.appendChild(th)});
  const q=$("customerSearch").value.trim().toLowerCase();
  const customers=(await all("customers")).filter(c=>c.active!==false&&c.name.toLowerCase().includes(q));
  const size=Number($("pageSize").value),pages=Math.max(1,Math.ceil(customers.length/size));currentPage=Math.min(currentPage,pages);
  const start=(currentPage-1)*size,page=customers.slice(start,start+size),body=$("customerRows");body.innerHTML="";
  for(let i=0;i<page.length;i++){
    const c=page[i],paidSet=new Set((await paymentsForCustomerYear(c.id,selectedYear)).map(p=>p.period)),row=document.createElement("tr");
    row.innerHTML=`<td>${start+i+1}</td><td><span class="customer-link" data-id="${c.id}">${c.name}</span><div class="row-meta">${c.customerCode} · ${c.speed} · ${money(c.monthlyPrice)}${c.whatsapp?` · WA ${c.whatsapp}`:""}</div></td>`;
    for(let m=0;m<12;m++){
      const td=document.createElement("td"),period=monthKey(selectedYear,m);let st;
      const first=firstBillPeriod(c);
      if(periodCompare(selectedYear,m,first.year,first.month)<0)st="inactive";
      else if(paidSet.has(period))st="paid";
      else{const today=new Date();today.setHours(0,0,0,0);const due=dueDate(c,selectedYear,m);due.setHours(0,0,0,0);st=today<due?"future":today.getTime()===due.getTime()?"issued":"arrears"}
      const b=document.createElement("button");b.className=`month-btn ${st}`;b.textContent=statusLabel(st);b.dataset.cid=c.id;b.dataset.month=m;
      if(st==="future"||st==="inactive")b.disabled=true;else b.addEventListener("click",()=>openPayment(c.id,m));td.appendChild(b);row.appendChild(td);
    }
    body.appendChild(row);
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
  editingCustomerId=id;const c=(await all("customers")).find(x=>x.id===id);if(!c)return;
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
  const state=await getState();return{schema:2,app:"MAHDY-NET Billing V7.2",revision:state.revision||0,modifiedAt:state.modifiedAt||null,exportedAt:nowISO(),packages:await all("packages"),customers:await all("customers"),payments:await all("payments")}
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
  const manifest={schema:2,app:"MAHDY-NET Billing V7.2",revision:state.revision||0,modifiedAt:state.modifiedAt||null,generatedAt:nowISO(),counts:{customers:customers.length,packages:packages.length,payments:payments.length},paymentYears:Object.keys(years).sort()};
  return{manifest,packages:{schema:2,revision:manifest.revision,modifiedAt:manifest.modifiedAt,items:packages},customers:{schema:2,revision:manifest.revision,modifiedAt:manifest.modifiedAt,items:customers},current:{schema:1,generatedAt:nowISO(),items:await all("current")},summary:summaryFile,paymentYears:years,bot};
}

function initGoogle(){
  if(!window.google?.accounts?.oauth2){toast("Google belum siap, coba lagi beberapa detik");return false}
  googleTokenClient=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:DRIVE_SCOPE,callback:r=>{if(r.error){alert("Login Google gagal: "+r.error);return}googleAccessToken=r.access_token;updateDriveUI();toast("Google Drive terhubung")}});return true;
}
function connectDrive(){if(initGoogle())googleTokenClient.requestAccessToken({prompt:""})}
function disconnectDrive(){googleAccessToken=null;cloudSnapshot=null;updateDriveUI()}
function updateDriveUI(){const ok=!!googleAccessToken;$("driveBadge").classList.toggle("ok",ok);$("driveBadge").querySelector("span").textContent=ok?"Drive terhubung":"Drive belum terhubung";$("driveStatusText").textContent=ok?"Terhubung · struktur V7 siap":"Belum terhubung";$("connectDriveBtn").classList.toggle("hidden",ok);$("disconnectDriveBtn").classList.toggle("hidden",!ok)}
async function driveFetch(url,opts={}){if(!googleAccessToken)throw new Error("Hubungkan Google Drive dulu");const r=await fetch(url,{...opts,headers:{Authorization:"Bearer "+googleAccessToken,...(opts.headers||{})}});if(!r.ok){if(r.status===401){googleAccessToken=null;updateDriveUI()}throw new Error(await r.text())}return r}
function qEscape(v){return String(v).replace(/\\/g,"\\\\").replace(/'/g,"\\'")}
async function driveList(query,fields="files(id,name,mimeType,parents,modifiedTime,size)",pageSize=100){const r=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=${encodeURIComponent(fields)}&pageSize=${pageSize}`);return (await r.json()).files||[]}
async function findFolder(name,parentId=null){let q=`name='${qEscape(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;if(parentId)q+=` and '${qEscape(parentId)}' in parents`;return (await driveList(q))[0]||null}
async function createFolder(name,parentId=null){const body={name,mimeType:"application/vnd.google-apps.folder"};if(parentId)body.parents=[parentId];return (await driveFetch("https://www.googleapis.com/drive/v3/files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).json()}
async function ensureFolder(name,parentId=null){return await findFolder(name,parentId)||await createFolder(name,parentId)}
async function ensureDriveStructure(){const root=await ensureFolder(ROOT_FOLDER),data=await ensureFolder("data",root.id),payments=await ensureFolder("payments",root.id),bot=await ensureFolder("bot",root.id),backups=await ensureFolder("backups",root.id);return{root,data,payments,bot,backups}}
const DRIVE_ID_CACHE_KEY="mahdy_v7_drive_file_ids";
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
  return{schema:2,app:"MAHDY-NET Billing V7.2",revision:manifest?.revision||0,modifiedAt:manifest?.modifiedAt||null,packages:packages?.items||[],customers:customers?.items||[],payments};
}
async function createStructuredSafetyBackup(st,label="AUTO"){
  const year=String(new Date().getFullYear()),yearFolder=await ensureFolder(year,st.backups.id),stamp=new Date().toISOString().replace(/[:.]/g,"-"),snap=await createFolder(`${SNAPSHOT_PREFIX}${label}_${stamp}`,yearFolder.id);
  for(const [prefix,folder] of [["data",st.data],["payments",st.payments],["bot",st.bot]]){for(const f of await listChildren(folder.id)){if(f.mimeType==="application/vnd.google-apps.folder")continue;await copyFile(f.id,`${prefix}__${f.name}`,snap.id)}}
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
  for(const y of manifest.paymentYears||[]){const d=await read(`payments__${y}.json`);if(Array.isArray(d?.items))payments.push(...d.items)}return{schema:2,revision:manifest.revision||0,modifiedAt:manifest.modifiedAt||null,packages:packages?.items||[],customers:customers?.items||[],payments};
}
async function openRestore(){
  if(!googleAccessToken){toast("Hubungkan Google Drive dulu");return}try{const snaps=await findSnapshotFolders(),legacy=await driveList(`name contains '${BACKUP_PREFIX}' and trashed=false`),box=$("restoreList");box.innerHTML="";const items=[...snaps.map(f=>({type:"snapshot",f})),...legacy.map(f=>({type:"legacy",f}))].sort((a,b)=>String(b.f.modifiedTime||"").localeCompare(String(a.f.modifiedTime||"")));
    if(!items.length)box.innerHTML='<div class="empty-state">Belum ada backup.</div>';
    for(const it of items){const f=it.f,row=document.createElement("div");row.className="restore-row";row.innerHTML=`<div><b>${f.name}</b><small>${f.modifiedTime?new Date(f.modifiedTime).toLocaleString("id-ID"):it.type}</small></div><button class="btn subtle">Restore</button>`;row.querySelector("button").addEventListener("click",async()=>{try{const backup=it.type==="snapshot"?await restoreSnapshot(f):await downloadDrive(f.id),bs=summary(backup),local=await exportData(),ls=summary(local);if(!confirm(`Restore backup ini?\n\nBackup: ${bs.customers} pelanggan, ${bs.payments} pembayaran\nSaat ini: ${ls.customers} pelanggan, ${ls.payments} pembayaran\n\nData saat ini akan diganti.`))return;if(ls.customers||ls.payments)downloadJson(local,`MAHDY-NET_SEBELUM_RESTORE_${ymdLocal()}.json`);await importData(backup);closeModal("restoreModal");toast("Restore selesai")}catch(e){alert("Restore gagal: "+e.message)}});box.appendChild(row)}openModal("restoreModal");
  }catch(e){alert("Gagal membaca backup: "+e.message)}
}
function downloadJson(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportLocal(){downloadJson(await exportData(),`MAHDY-NET_V7_${ymdLocal()}.json`)}
async function importLocalFile(file){const text=await file.text(),data=JSON.parse(text),s=summary(data),local=summary(await exportData());if(!confirm(`Import file ini?\n\nFile: ${s.customers} pelanggan, ${s.payments} pembayaran\nSaat ini: ${local.customers} pelanggan, ${local.payments} pembayaran\n\nData saat ini akan diganti.`))return;if(local.customers||local.payments)downloadJson(await exportData(),`MAHDY-NET_SEBELUM_IMPORT_${ymdLocal()}.json`);await importData(data);toast("Import selesai")}

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
$("editCustomerBtn").addEventListener("click",()=>{closeModal("customerDetailModal");openCustomerForm(editingCustomerId)});
$("fStartDate").addEventListener("change",()=>{if(!$("fStartDate").value)return;const d=new Date($("fStartDate").value+"T00:00:00");d.setMonth(d.getMonth()+1);$("fFirstBillDate").value=ymdLocal(d)});
$("customerSearch").addEventListener("input",()=>{currentPage=1;renderCustomerTable()});
$("paymentSearch").addEventListener("input",renderPayments);
$("paymentYearSelect")?.addEventListener("change",renderPayments);
$("yearSelect").addEventListener("change",()=>{selectedYear=Number($("yearSelect").value);renderCustomerTable()});
$("pageSize").addEventListener("change",()=>{currentPage=1;renderCustomerTable()});
$("connectDriveBtn").addEventListener("click",connectDrive);
$("disconnectDriveBtn").addEventListener("click",disconnectDrive);
$("safeSyncBtn").addEventListener("click",openSafeSync);
$("pullDriveBtn").addEventListener("click",pullFromDrive);
$("pushDriveBtn").addEventListener("click",pushToDrive);
$("backupBtn").addEventListener("click",backupNow);
$("restoreBtn").addEventListener("click",openRestore);
$("exportBtn").addEventListener("click",exportLocal);
$("importFile").addEventListener("change",async e=>{if(e.target.files[0]){try{await importLocalFile(e.target.files[0])}catch(err){alert("Import gagal: "+err.message)}e.target.value=""}});

(async()=>{
  await openDB();await ensureCustomerCodes();initYears();initDefaultDates();await seedPackages();await fillPackageSelect("fCustomerPackage");
  const py=$("paymentYearSelect");if(py){const y=new Date().getFullYear();for(let i=y-10;i<=y+1;i++){const o=document.createElement("option");o.value=i;o.textContent=i;if(i===y)o.selected=true;py.appendChild(o)}}
  await rebuildCurrentSnapshot();updateDriveUI();await renderAll();
})();async function migrateWhatsappFields(){
  const cs=await all("customers");let changed=false;
  for(const c of cs){const n=normalizeWhatsApp(c.whatsapp||"");if(c.whatsapp!==n){c.whatsapp=n;await put("customers",c);changed=true}}
  return changed;
}


