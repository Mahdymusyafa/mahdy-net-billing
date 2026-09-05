
const MONTHS=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const DB_NAME="mahdy_net_billing_safe";
const DB_VERSION=1;
const CLIENT_ID="1048608388100-1jghinhuoff1necs78hd44h7ql0rjhj7.apps.googleusercontent.com";
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.file";
const MAIN_FILE="mahdy-net-data.json";
const BACKUP_PREFIX="MAHDY-NET_Backup_";
let db,currentPage=1,selectedYear=new Date().getFullYear(),editingCustomerId=null,editingPackageId=null,paymentCtx=null;
let googleTokenClient=null,googleAccessToken=null,cloudSnapshot=null;

const $=id=>document.getElementById(id);
function money(n){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0))}
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
      d.createObjectStore("packages",{keyPath:"id",autoIncrement:true});
      d.createObjectStore("customers",{keyPath:"id",autoIncrement:true});
      d.createObjectStore("payments",{keyPath:"id",autoIncrement:true});
      d.createObjectStore("meta",{keyPath:"key"});
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

function firstBillPeriod(c){const d=new Date(c.firstBillDate+"T00:00:00");return{year:d.getFullYear(),month:d.getMonth()}}
function periodCompare(y,m,y2,m2){return y===y2?m-m2:y-y2}
function dueDate(c,y,m){
  const first=new Date(c.firstBillDate+"T00:00:00"),day=first.getDate(),last=new Date(y,m+1,0).getDate();
  return new Date(y,m,Math.min(day,last));
}
async function paymentFor(customerId,period){
  return (await all("payments")).find(p=>p.customerId===customerId&&p.period===period)||null;
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
    $("customerFormTitle").textContent="Edit pelanggan";$("fCustomerName").value=c.name;await fillPackageSelect("fCustomerPackage",c.packageId);
    $("fCustomerPrice").value=c.customPrice||"";$("fRegistrationDate").value=c.registrationDate;$("fStartDate").value=c.startDate;$("fFirstBillDate").value=c.firstBillDate;
  }else{
    $("customerFormTitle").textContent="Tambah pelanggan";$("fCustomerName").value="";$("fCustomerPrice").value="";initDefaultDates();
  }
  openModal("customerFormModal");
}
async function saveCustomer(){
  const name=$("fCustomerName").value.trim(),packageId=Number($("fCustomerPackage").value),reg=$("fRegistrationDate").value,start=$("fStartDate").value,first=$("fFirstBillDate").value;
  if(!name||!packageId||!reg||!start||!first){toast("Lengkapi data pelanggan");return}
  const pkg=(await all("packages")).find(x=>x.id===packageId);if(!pkg)return;
  const customPrice=Number($("fCustomerPrice").value.replace(/\D/g,""))||null;
  if(editingCustomerId){
    const c=(await all("customers")).find(x=>x.id===editingCustomerId);
    Object.assign(c,{name,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first,updatedAt:nowISO()});
    await put("customers",c);
  }else{
    await add("customers",{name,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:customPrice||pkg.price,customPrice,registrationDate:reg,startDate:start,firstBillDate:first,active:true,createdAt:nowISO()});
  }
  await touchData();closeModal("customerFormModal");await renderAll();toast("Pelanggan disimpan");
}

async function renderCustomerTable(){
  const tr=$("customerHeader");while(tr.children.length>2)tr.removeChild(tr.lastChild);
  MONTHS.forEach(m=>{const th=document.createElement("th");th.textContent=m;tr.appendChild(th)});
  const q=$("customerSearch").value.trim().toLowerCase();
  const customers=(await all("customers")).filter(c=>c.active!==false&&c.name.toLowerCase().includes(q));
  const size=Number($("pageSize").value),pages=Math.max(1,Math.ceil(customers.length/size));currentPage=Math.min(currentPage,pages);
  const start=(currentPage-1)*size,page=customers.slice(start,start+size),body=$("customerRows");body.innerHTML="";
  for(let i=0;i<page.length;i++){
    const c=page[i],row=document.createElement("tr");row.innerHTML=`<td>${start+i+1}</td><td><span class="customer-link" data-id="${c.id}">${c.name}</span><div class="row-meta">${c.speed} · ${money(c.monthlyPrice)}</div></td>`;
    for(let m=0;m<12;m++){
      const td=document.createElement("td"),s=await statusFor(c,selectedYear,m),b=document.createElement("button");
      b.className=`month-btn ${s}`;b.textContent=statusLabel(s);b.dataset.cid=c.id;b.dataset.month=m;
      if(s==="future"||s==="inactive")b.disabled=true; else b.addEventListener("click",()=>openPayment(c.id,m));
      td.appendChild(b);row.appendChild(td);
    }
    body.appendChild(row);
  }
  body.querySelectorAll(".customer-link").forEach(e=>e.addEventListener("click",()=>openCustomerDetail(Number(e.dataset.id))));
  $("pageInfo").textContent=`Menampilkan ${customers.length?start+1:0}–${Math.min(start+size,customers.length)} dari ${customers.length} data`;
  const pb=$("pageButtons");pb.innerHTML="";
  for(let p=1;p<=pages;p++){const b=document.createElement("button");b.className="page-btn"+(p===currentPage?" active":"");b.textContent=p;b.addEventListener("click",()=>{currentPage=p;renderCustomerTable()});pb.appendChild(b)}
  await renderCustomerFocus(customers);
}
async function renderCustomerFocus(matches){
  const box=$("customerFocus");box.innerHTML="";
  if(!$("customerSearch").value.trim()||matches.length!==1)return;
  const c=matches[0],now=new Date(),s=await statusFor(c,now.getFullYear(),now.getMonth());
  let arrears=[];
  const first=firstBillPeriod(c);
  for(let y=first.year;y<=now.getFullYear();y++){
    const from=y===first.year?first.month:0,to=y===now.getFullYear()?now.getMonth():11;
    for(let m=from;m<=to;m++)if(await statusFor(c,y,m)==="arrears")arrears.push(`${MONTHS[m]} ${y}`);
  }
  box.innerHTML=`<div class="focus-card"><h3>${c.name}</h3><div class="focus-meta">${c.packageName} · ${c.speed} · ${money(c.monthlyPrice)}</div><div class="focus-stats"><div class="focus-stat"><span>Bulan ini</span><b>${statusLabel(s)}</b></div><div class="focus-stat"><span>Tunggakan</span><b>${arrears.length} bulan</b></div><div class="focus-stat"><span>Rincian</span><b>${arrears.length?arrears.join(", "):"Tidak ada"}</b></div></div></div>`;
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
  await touchData();closeModal("paymentModal");await renderAll();toast("Pembayaran disimpan");
}
async function deletePayment(){
  if(!paymentCtx?.existing)return;if(confirm("Batalkan catatan pembayaran ini?")){await del("payments",paymentCtx.existing.id);await touchData();closeModal("paymentModal");await renderAll()}
}
async function openCustomerDetail(id){
  editingCustomerId=id;const c=(await all("customers")).find(x=>x.id===id);if(!c)return;
  $("detailCustomerName").textContent=c.name;
  $("detailCustomerInfo").innerHTML=`<div class="detail-grid"><div class="detail-cell"><span>Paket</span><b>${c.packageName} · ${c.speed}</b></div><div class="detail-cell"><span>Tarif</span><b>${money(c.monthlyPrice)}</b></div><div class="detail-cell"><span>Registrasi</span><b>${c.registrationDate}</b></div><div class="detail-cell"><span>Mulai layanan</span><b>${c.startDate}</b></div><div class="detail-cell"><span>Tagihan pertama</span><b>${c.firstBillDate}</b></div></div>`;
  const ps=(await all("payments")).filter(p=>p.customerId===id).sort((a,b)=>b.period.localeCompare(a.period)),hist=$("detailPaymentHistory");hist.innerHTML="";
  if(!ps.length)hist.innerHTML='<div class="empty-state">Belum ada pembayaran.</div>';
  ps.forEach(p=>{const {year,month}=parsePeriod(p.period),d=document.createElement("div");d.className="history-row";d.innerHTML=`<div><b>${MONTHS[month]} ${year}</b><small>${p.date} · ${p.method}</small></div><b>${money(p.amount)}</b>`;hist.appendChild(d)});
  openModal("customerDetailModal");
}
async function renderPayments(){
  const q=$("paymentSearch").value.trim().toLowerCase(),cs=await all("customers"),ps=(await all("payments")).sort((a,b)=>b.date.localeCompare(a.date)),list=$("paymentList");list.innerHTML="";
  const rows=ps.map(p=>({p,c:cs.find(c=>c.id===p.customerId)})).filter(x=>x.c&&x.c.name.toLowerCase().includes(q));
  if(!rows.length){list.innerHTML='<div class="empty-state">Belum ada pembayaran.</div>';return}
  rows.forEach(({p,c})=>{const {year,month}=parsePeriod(p.period),d=document.createElement("div");d.className="payment-item";d.innerHTML=`<div><b>${c.name}</b><small>${MONTHS[month]} ${year} · ${p.date} · ${p.method}</small></div><b>${money(p.amount)}</b>`;list.appendChild(d)});
}
async function renderHome(){
  const cs=(await all("customers")).filter(c=>c.active!==false),ps=await all("payments"),now=new Date(),y=now.getFullYear(),m=now.getMonth();
  let paid=0,issued=0,arrearsCustomers=0,revenue=0,attention=[];
  for(const c of cs){
    const s=await statusFor(c,y,m);if(s==="paid")paid++;if(s==="issued"){issued++;attention.push({c,s})}
    let has=false;const first=firstBillPeriod(c);
    for(let yy=first.year;yy<=y&&!has;yy++){const from=yy===first.year?first.month:0,to=yy===y?m:11;for(let mm=from;mm<=to;mm++)if(await statusFor(c,yy,mm)==="arrears"){has=true;break}}
    if(has){arrearsCustomers++;if(!attention.some(x=>x.c.id===c.id))attention.push({c,s:"arrears"})}
  }
  ps.filter(p=>p.period===monthKey(y,m)).forEach(p=>revenue+=Number(p.amount||0));
  $("homeMonthLabel").textContent=`${MONTHS[m]} ${y}`;$("statCustomers").textContent=cs.length;$("statPaid").textContent=paid;$("statIssued").textContent=issued;$("statArrears").textContent=arrearsCustomers;$("statRevenue").textContent=money(revenue);
  $("homeSummary").textContent=cs.length?`${paid} pelanggan sudah lunas. ${arrearsCustomers} pelanggan perlu diperiksa.`:"Belum ada data pelanggan.";
  const list=$("attentionList");list.innerHTML="";
  if(!attention.length){list.innerHTML='<div class="empty-state">Tidak ada tagihan yang perlu perhatian.</div>';return}
  attention.slice(0,8).forEach(({c,s})=>{const d=document.createElement("div");d.className="attention-item";d.innerHTML=`<div><b>${c.name}</b><small>${c.packageName} · ${money(c.monthlyPrice)}</small></div><span class="status-pill ${s==="arrears"?"red":"amber"}">${s==="arrears"?"Tunggak":"Tagihan terbit"}</span>`;d.addEventListener("click",()=>{showView("customersView");$("customerSearch").value=c.name;currentPage=1;renderCustomerTable()});list.appendChild(d)});
}
async function renderAll(){await renderPackages();await renderCustomerTable();await renderPayments();await renderHome();await renderLocalStatus()}

async function exportData(){
  const state=await getState();
  return{schema:1,app:"MAHDY-NET Billing",revision:state.revision||0,modifiedAt:state.modifiedAt||null,exportedAt:nowISO(),packages:await all("packages"),customers:await all("customers"),payments:await all("payments")}
}
function summary(data){return{customers:Array.isArray(data?.customers)?data.customers.length:0,payments:Array.isArray(data?.payments)?data.payments.length:0,packages:Array.isArray(data?.packages)?data.packages.length:0,modifiedAt:data?.modifiedAt||null,revision:data?.revision||0}}
async function importData(data,{mark=true}={}){
  if(!data||!Array.isArray(data.packages)||!Array.isArray(data.customers)||!Array.isArray(data.payments))throw new Error("Format backup tidak valid");
  await clearStore("packages");await clearStore("customers");await clearStore("payments");
  for(const x of data.packages)await put("packages",x);for(const x of data.customers)await put("customers",x);for(const x of data.payments)await put("payments",x);
  await put("meta",{key:"state",revision:Number(data.revision||0),modifiedAt:data.modifiedAt||nowISO()});
  if(mark)await renderAll();
}

function initGoogle(){
  if(!window.google?.accounts?.oauth2){toast("Google belum siap, coba lagi beberapa detik");return false}
  googleTokenClient=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:DRIVE_SCOPE,callback:r=>{
    if(r.error){alert("Login Google gagal: "+r.error);return}
    googleAccessToken=r.access_token;updateDriveUI();toast("Google Drive terhubung");
  }});
  return true;
}
function connectDrive(){if(initGoogle())googleTokenClient.requestAccessToken({prompt:""})}
function disconnectDrive(){googleAccessToken=null;cloudSnapshot=null;updateDriveUI()}
function updateDriveUI(){
  const ok=!!googleAccessToken;$("driveBadge").classList.toggle("ok",ok);$("driveBadge").querySelector("span").textContent=ok?"Drive terhubung":"Drive belum terhubung";
  $("driveStatusText").textContent=ok?"Terhubung dan siap digunakan":"Belum terhubung";$("connectDriveBtn").classList.toggle("hidden",ok);$("disconnectDriveBtn").classList.toggle("hidden",!ok);
}
async function driveFetch(url,opts={}){
  if(!googleAccessToken)throw new Error("Hubungkan Google Drive dulu");
  const r=await fetch(url,{...opts,headers:{Authorization:"Bearer "+googleAccessToken,...(opts.headers||{})}});
  if(!r.ok){if(r.status===401){googleAccessToken=null;updateDriveUI()}throw new Error(await r.text())}return r;
}
async function listNamed(name,contains=false){
  const query=contains?`name contains '${name}' and trashed=false`:`name='${name}' and trashed=false`;
  const r=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)&pageSize=50`);
  return (await r.json()).files||[];
}
async function downloadDrive(id){return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json()}
async function createDriveFile(name,data){
  const meta={name,mimeType:"application/json"},boundary="mahdy_"+Date.now();
  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const r=await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});return r.json();
}
async function updateDriveFile(id,data){return (await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})).json()}
async function getCloudMain(){
  const files=await listNamed(MAIN_FILE);if(!files.length)return{file:null,data:null};
  return{file:files[0],data:await downloadDrive(files[0].id)};
}
async function createSafetyBackup(data,label="AUTO"){
  if(!data)return;
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  await createDriveFile(`${BACKUP_PREFIX}${label}_${stamp}.json`,data);
}
async function openSafeSync(){
  if(!googleAccessToken){toast("Hubungkan Google Drive dulu");showView("dataView");return}
  try{
    const local=await exportData(),cloud=await getCloudMain();cloudSnapshot=cloud;
    const ls=summary(local),cs=summary(cloud.data);
    $("localCustomerCount").textContent=`${ls.customers} pelanggan`;$("localPaymentCount").textContent=`${ls.payments} pembayaran`;$("localModified").textContent=ls.modifiedAt?new Date(ls.modifiedAt).toLocaleString("id-ID"):"Belum ada perubahan";
    if(!cloud.data){$("cloudCustomerCount").textContent="Belum ada file";$("cloudPaymentCount").textContent="—";$("cloudModified").textContent="—"}
    else{$("cloudCustomerCount").textContent=`${cs.customers} pelanggan`;$("cloudPaymentCount").textContent=`${cs.payments} pembayaran`;$("cloudModified").textContent=cs.modifiedAt?new Date(cs.modifiedAt).toLocaleString("id-ID"):"Tanpa tanggal"}
    const w=$("syncWarning"),push=$("pushDriveBtn"),pull=$("pullDriveBtn");w.className="sync-warning";push.disabled=false;pull.disabled=!cloud.data;
    if(ls.customers===0&&cs.customers>0){
      w.classList.add("danger");w.textContent="HP ini kosong tetapi Drive berisi data. Mengirim data HP DIBLOKIR. Ambil data dari Drive.";push.disabled=true;
    }else if(!cloud.data&&ls.customers>0){
      w.classList.add("good");w.textContent="Drive belum punya data utama. Anda bisa mengirim data HP sebagai data utama pertama.";
    }else if(ls.customers>0&&cs.customers===0){
      w.classList.add("danger");w.textContent="Drive terlihat kosong. Sebelum mengirim, aplikasi akan membuat snapshot Drive jika ada file lama.";
    }else{
      w.textContent="Pilih arah dengan sengaja. Tidak ada data yang akan ditimpa otomatis.";
    }
    openModal("syncModal");
  }catch(e){alert("Gagal membaca Drive: "+e.message)}
}
async function pullFromDrive(){
  if(!cloudSnapshot?.data)return;
  const local=await exportData(),ls=summary(local),cs=summary(cloudSnapshot.data);
  const msg=`Ambil data Drive?\n\nHP: ${ls.customers} pelanggan, ${ls.payments} pembayaran\nDrive: ${cs.customers} pelanggan, ${cs.payments} pembayaran\n\nData HP saat ini akan diganti.`;
  if(!confirm(msg))return;
  // Always download a local JSON safety copy before replacing non-empty local data.
  if(ls.customers||ls.payments)downloadJson(local,`MAHDY-NET_SEBELUM_AMBIL_DRIVE_${ymdLocal()}.json`);
  await importData(cloudSnapshot.data);closeModal("syncModal");toast("Data Drive sudah diambil");
}
async function pushToDrive(){
  const local=await exportData(),ls=summary(local),cloud=cloudSnapshot||await getCloudMain(),cs=summary(cloud.data);
  if(ls.customers===0&&cs.customers>0){alert("Diblokir: data HP kosong tidak boleh menimpa Drive yang berisi pelanggan.");return}
  const msg=`Kirim data HP ke Drive?\n\nHP: ${ls.customers} pelanggan, ${ls.payments} pembayaran\nDrive: ${cs.customers} pelanggan, ${cs.payments} pembayaran\n\nVersi Drive lama akan dibackup otomatis terlebih dahulu.`;
  if(!confirm(msg))return;
  try{
    if(cloud.data)await createSafetyBackup(cloud.data,"SEBELUM_KIRIM");
    if(cloud.file)await updateDriveFile(cloud.file.id,local);else await createDriveFile(MAIN_FILE,local);
    closeModal("syncModal");toast("Data HP berhasil dikirim ke Drive");
  }catch(e){alert("Gagal mengirim ke Drive: "+e.message)}
}
async function backupNow(){
  if(!googleAccessToken){toast("Hubungkan Google Drive dulu");return}
  try{const data=await exportData(),s=summary(data);if(!s.customers&&!s.payments&&!confirm("Data saat ini kosong. Tetap buat backup kosong?"))return;await createSafetyBackup(data,"MANUAL");toast("Backup selesai")}catch(e){alert("Backup gagal: "+e.message)}
}
async function openRestore(){
  if(!googleAccessToken){toast("Hubungkan Google Drive dulu");return}
  try{
    const files=await listNamed(BACKUP_PREFIX,true),box=$("restoreList");box.innerHTML="";
    if(!files.length){box.innerHTML='<div class="empty-state">Belum ada backup.</div>'}
    for(const f of files){
      const row=document.createElement("div");row.className="restore-row";row.innerHTML=`<div><b>${f.name}</b><small>${new Date(f.modifiedTime).toLocaleString("id-ID")}</small></div><button class="btn subtle">Restore</button>`;
      row.querySelector("button").addEventListener("click",async()=>{
        try{
          const backup=await downloadDrive(f.id),bs=summary(backup),local=await exportData(),ls=summary(local);
          if(!confirm(`Restore backup ini?\n\nBackup: ${bs.customers} pelanggan, ${bs.payments} pembayaran\nSaat ini: ${ls.customers} pelanggan, ${ls.payments} pembayaran\n\nData saat ini akan diganti.`))return;
          if(ls.customers||ls.payments)downloadJson(local,`MAHDY-NET_SEBELUM_RESTORE_${ymdLocal()}.json`);
          await importData(backup);closeModal("restoreModal");toast("Restore selesai");
        }catch(e){alert("Restore gagal: "+e.message)}
      });
      box.appendChild(row);
    }
    openModal("restoreModal");
  }catch(e){alert("Gagal membaca backup: "+e.message)}
}
function downloadJson(data,name){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function exportLocal(){downloadJson(await exportData(),`MAHDY-NET_${ymdLocal()}.json`)}
async function importLocalFile(file){
  const text=await file.text(),data=JSON.parse(text),s=summary(data),local=summary(await exportData());
  if(!confirm(`Import file ini?\n\nFile: ${s.customers} pelanggan, ${s.payments} pembayaran\nSaat ini: ${local.customers} pelanggan, ${local.payments} pembayaran\n\nData saat ini akan diganti.`))return;
  if(local.customers||local.payments)downloadJson(await exportData(),`MAHDY-NET_SEBELUM_IMPORT_${ymdLocal()}.json`);
  await importData(data);toast("Import selesai");
}

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
  await openDB();initYears();initDefaultDates();await seedPackages();await fillPackageSelect("fCustomerPackage");updateDriveUI();await renderAll();
})();
