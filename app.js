const MONTHS=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const DB_NAME="mahdy_net_billing";const DB_VERSION=1;
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.file";
const MAIN_FILE_NAME="mahdy-net-data.json";
const BACKUP_PREFIX="MAHDY-NET_Backup_";
let db,selectedYear=new Date().getFullYear(),currentPage=1,paymentContext=null,editingPackageId=null;
let googleAccessToken=null,googleTokenClient=null;

const $=id=>document.getElementById(id);
function money(n){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0))}
function ymd(d){return d.toISOString().slice(0,10)} function monthKey(y,m){return `${y}-${String(m+1).padStart(2,"0")}`}
function parseMonthKey(k){const [y,m]=k.split("-").map(Number);return{year:y,month:m-1}}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),1900)}
function markSaved(){localStorage.setItem("mahdy_net_last_saved",new Date().toISOString());updateSavedLabel()}
function updateSavedLabel(){const v=localStorage.getItem("mahdy_net_last_saved");$("lastSaved").textContent=v?"Save terakhir: "+new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"Belum disimpan"}

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains("packages"))d.createObjectStore("packages",{keyPath:"id",autoIncrement:true});if(!d.objectStoreNames.contains("customers"))d.createObjectStore("customers",{keyPath:"id",autoIncrement:true});if(!d.objectStoreNames.contains("payments")){const s=d.createObjectStore("payments",{keyPath:"id",autoIncrement:true});s.createIndex("customerId","customerId",{unique:false});s.createIndex("period","period",{unique:false})}};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function all(store){return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function add(store,val){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).add(val);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,val){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).put(val);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function del(store,id){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function clearStore(s){return new Promise((res,rej)=>{const r=db.transaction(s,"readwrite").objectStore(s).clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function dueDateForPeriod(c,y,m){const first=new Date(c.firstDueDate+"T00:00:00"),day=first.getDate(),d=new Date(y,m,1),last=new Date(y,m+1,0).getDate();d.setDate(Math.min(day,last));return d}
function firstBillingPeriod(c){const d=new Date(c.firstDueDate+"T00:00:00");return{year:d.getFullYear(),month:d.getMonth()}}
function comparePeriod(aY,aM,bY,bM){return aY===bY?aM-bM:aY-bY}
async function getPayment(cid,period){const ps=await all("payments");return ps.find(p=>p.customerId===cid&&p.period===period)||null}
async function statusFor(c,y,m){
  const sp=firstBillingPeriod(c);
  if(comparePeriod(y,m,sp.year,sp.month)<0)return"inactive";

  const period=monthKey(y,m),pay=await getPayment(c.id,period);
  if(pay)return"paid";

  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const due=dueDateForPeriod(c,y,m);
  const dueOnly=new Date(due.getFullYear(),due.getMonth(),due.getDate());

  if(today<dueOnly)return"notissued";
  if(today.getTime()===dueOnly.getTime())return"issued";
  return"arrears";
}

function initYears(){const s=$("yearSelect"),y=new Date().getFullYear();for(let i=y-3;i<=y+5;i++){const o=document.createElement("option");o.value=i;o.textContent=i;if(i===selectedYear)o.selected=true;s.appendChild(o)}}
async function seedPackages(){if((await all("packages")).length)return;await add("packages",{name:"Hemat",speed:"5 Mbps",price:100000});await add("packages",{name:"Reguler",speed:"10 Mbps",price:150000});await add("packages",{name:"Premium",speed:"20 Mbps",price:250000})}

async function refreshPackages(){
 const ps=await all("packages"),sel=$("custPackage");sel.innerHTML="";
 ps.forEach(p=>{const o=document.createElement("option");o.value=p.id;o.textContent=`${p.name} — ${p.speed} — ${money(p.price)}`;sel.appendChild(o)});
 const list=$("packageList");list.innerHTML="";if(!ps.length){list.innerHTML='<div class="empty">Belum ada paket.</div>';return}
 ps.forEach(p=>{const d=document.createElement("div");d.className="package-card";d.innerHTML=`<h3>${p.name}</h3><div class="price">${money(p.price)}</div><div class="small">${p.speed}</div><div class="pkg-actions"><button class="btn btn-soft" data-edit="${p.id}">✎ Edit</button><button class="btn btn-danger" data-del="${p.id}">Hapus</button></div>`;list.appendChild(d)});
 list.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditPackage(Number(b.dataset.edit))));
 list.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{const id=Number(b.dataset.del),used=(await all("customers")).some(c=>c.packageId===id);if(used){alert("Paket masih digunakan pelanggan. Edit paket atau pindahkan pelanggan terlebih dahulu.");return}if(confirm("Hapus paket ini?")){await del("packages",id);markSaved();await refreshPackages();toast("Paket dihapus")}}))
}
async function addPackageFn(){const name=$("pkgName").value.trim(),speed=$("pkgSpeed").value.trim(),price=Number($("pkgPrice").value.replace(/\D/g,""));if(!name||!speed||!price){toast("Lengkapi data paket");return}await add("packages",{name,speed,price});$("pkgName").value=$("pkgSpeed").value=$("pkgPrice").value="";markSaved();await refreshPackages();toast("Paket disimpan")}
async function openEditPackage(id){const p=(await all("packages")).find(x=>x.id===id);if(!p)return;editingPackageId=id;$("editPkgName").value=p.name;$("editPkgSpeed").value=p.speed;$("editPkgPrice").value=p.price;$("editPackageModal").classList.add("show")}
async function saveEditPackage(){const p=(await all("packages")).find(x=>x.id===editingPackageId);if(!p)return;const name=$("editPkgName").value.trim(),speed=$("editPkgSpeed").value.trim(),price=Number($("editPkgPrice").value.replace(/\D/g,""));if(!name||!speed||!price){toast("Lengkapi data paket");return}p.name=name;p.speed=speed;p.price=price;await put("packages",p);$("editPackageModal").classList.remove("show");markSaved();await refreshPackages();toast("Paket diperbarui")}

function autofillDates(){const t=new Date();$("custRegDate").value=ymd(t);$("custStartDate").value=ymd(t);const n=new Date(t);n.setMonth(n.getMonth()+1);$("custDueDate").value=ymd(n)}
async function addCustomerFn(){const name=$("custName").value.trim(),packageId=Number($("custPackage").value),reg=$("custRegDate").value,start=$("custStartDate").value,due=$("custDueDate").value;if(!name||!packageId||!reg||!start||!due){toast("Lengkapi data pelanggan");return}const pkg=(await all("packages")).find(x=>x.id===packageId);if(!pkg)return;const custom=Number($("custCustomPrice").value.replace(/\D/g,""))||null;await add("customers",{name,packageId,packageName:pkg.name,speed:pkg.speed,monthlyPrice:custom||pkg.price,registrationDate:reg,startDate:start,firstDueDate:due,active:true});$("custName").value="";$("custCustomPrice").value="";autofillDates();markSaved();await renderAll();toast("Pelanggan ditambahkan")}

async function buildHeader(){const tr=$("tableHeader");while(tr.children.length>2)tr.removeChild(tr.lastChild);MONTHS.forEach(m=>{const th=document.createElement("th");th.textContent=m;tr.appendChild(th)})}
async function renderCustomers(){await buildHeader();const cs=(await all("customers")).filter(c=>c.active!==false),q=$("searchInput").value.trim().toLowerCase(),filtered=cs.filter(c=>c.name.toLowerCase().includes(q)),size=Number($("pageSize").value),pages=Math.max(1,Math.ceil(filtered.length/size));if(currentPage>pages)currentPage=pages;const start=(currentPage-1)*size,page=filtered.slice(start,start+size),tb=$("customerBody");tb.innerHTML="";
 for(let i=0;i<page.length;i++){const c=page[i],tr=document.createElement("tr"),no=document.createElement("td");no.textContent=start+i+1;tr.appendChild(no);const name=document.createElement("td");name.innerHTML=`<span class="customer-name" data-cid="${c.id}">${c.name}</span><div class="help">${c.speed} · ${money(c.monthlyPrice)}</div>`;tr.appendChild(name);for(let m=0;m<12;m++){const td=document.createElement("td"),st=await statusFor(c,selectedYear,m),b=document.createElement("button");b.className="status-btn "+({paid:"status-paid",issued:"status-unpaid",notissued:"status-future",arrears:"status-arrears",inactive:"status-inactive"}[st]);b.textContent={paid:"✓ Lunas",issued:"Tagihan Terbit",notissued:"Belum Ditagih",arrears:"Tunggak",inactive:"—"}[st];b.disabled=st==="notissued"||st==="inactive";b.dataset.cid=c.id;b.dataset.month=m;td.appendChild(b);tr.appendChild(td)}tb.appendChild(tr)}
 tb.querySelectorAll(".customer-name").forEach(e=>e.addEventListener("click",()=>openCustomer(Number(e.dataset.cid))));
 tb.querySelectorAll(".status-btn:not(:disabled)").forEach(e=>e.addEventListener("click",()=>openPayment(Number(e.dataset.cid),Number(e.dataset.month))));
 $("pageInfo").textContent=`Menampilkan ${filtered.length?start+1:0}–${Math.min(start+size,filtered.length)} dari ${filtered.length} data`;renderPageControls(pages);await renderInsight(filtered)
}
function renderPageControls(pages){const pc=$("pageControls");pc.innerHTML="";const prev=document.createElement("button");prev.className="page-btn";prev.textContent="‹";prev.disabled=currentPage===1;prev.onclick=()=>{currentPage--;renderCustomers()};pc.appendChild(prev);for(let p=1;p<=pages;p++){if(pages>7&&Math.abs(p-currentPage)>2&&p!==1&&p!==pages)continue;const b=document.createElement("button");b.className="page-btn"+(p===currentPage?" active":"");b.textContent=p;b.onclick=()=>{currentPage=p;renderCustomers()};pc.appendChild(b)}const next=document.createElement("button");next.className="page-btn";next.textContent="›";next.disabled=currentPage===pages;next.onclick=()=>{currentPage++;renderCustomers()};pc.appendChild(next)}
async function renderInsight(filtered){if(!$("searchInput").value.trim()||filtered.length!==1){$("insight").classList.remove("show");return}const c=filtered[0],now=new Date(),m=now.getMonth(),y=now.getFullYear(),st=await statusFor(c,y,m);$("insightName").textContent=c.name;$("insightDate").textContent=`Status per ${new Intl.DateTimeFormat("id-ID",{dateStyle:"long"}).format(now)}`;$("insightCurrent").textContent={paid:"Lunas",issued:"Tagihan terbit hari ini",notissued:"Belum ditagih",arrears:"Tunggak",inactive:"Belum ada tagihan"}[st];$("insightPackage").textContent=`${c.packageName} · ${c.speed}`;let arr=[];const sp=firstBillingPeriod(c);for(let yy=sp.year;yy<=y;yy++){const from=yy===sp.year?sp.month:0,to=yy===y?m:11;for(let mm=from;mm<=to;mm++)if(await statusFor(c,yy,mm)==="arrears")arr.push(`${MONTHS[mm]} ${yy}`)}$("insightArrears").textContent=arr.length?`${arr.length} bulan`:"Tidak ada";$("insightChips").innerHTML="";arr.forEach(a=>{const s=document.createElement("span");s.className="chip";s.textContent=a;$("insightChips").appendChild(s)});$("insight").classList.add("show")}

async function openPayment(cid,m){const c=(await all("customers")).find(x=>x.id===cid);if(!c)return;const period=monthKey(selectedYear,m),existing=await getPayment(cid,period);paymentContext={customer:c,period,existing};$("paymentTitle").textContent=`${c.name} — ${MONTHS[m]} ${selectedYear}`;$("payPeriod").value=`${MONTHS[m]} ${selectedYear}`;$("payAmount").value=existing?existing.amount:c.monthlyPrice;$("payDate").value=existing?existing.date:ymd(new Date());$("payMethod").value=existing?existing.method:"Tunai";$("payNote").value=existing?existing.note||"":"";$("deletePaymentBtn").style.display=existing?"inline-flex":"none";$("paymentModal").classList.add("show")}
async function savePaymentFn(){const x=paymentContext;if(!x)return;const amount=Number($("payAmount").value.replace(/\D/g,""));if(!amount||!$("payDate").value){toast("Lengkapi pembayaran");return}if(x.existing){x.existing.amount=amount;x.existing.date=$("payDate").value;x.existing.method=$("payMethod").value;x.existing.note=$("payNote").value.trim();await put("payments",x.existing)}else await add("payments",{customerId:x.customer.id,period:x.period,amount,date:$("payDate").value,method:$("payMethod").value,note:$("payNote").value.trim(),createdAt:new Date().toISOString()});$("paymentModal").classList.remove("show");markSaved();await renderAll();toast("Pembayaran disimpan")}
async function deletePaymentFn(){if(!paymentContext?.existing)return;if(confirm("Batalkan catatan pembayaran?")){await del("payments",paymentContext.existing.id);$("paymentModal").classList.remove("show");markSaved();await renderAll();toast("Pembayaran dibatalkan")}}
async function openCustomer(id){const c=(await all("customers")).find(x=>x.id===id);if(!c)return;$("customerModalTitle").textContent=c.name;$("customerDetail").innerHTML=`<div class="grid"><div><b>Paket</b><div class="help">${c.packageName} · ${c.speed}</div></div><div><b>Tarif</b><div class="help">${money(c.monthlyPrice)}/bulan</div></div><div><b>Registrasi</b><div class="help">${c.registrationDate}</div></div><div><b>Mulai berlangganan</b><div class="help">${c.startDate}</div></div><div><b>Tagihan pertama</b><div class="help">${c.firstDueDate}</div></div></div>`;const ps=(await all("payments")).filter(p=>p.customerId===id).sort((a,b)=>b.period.localeCompare(a.period));$("customerHistory").innerHTML="<b>Riwayat pembayaran</b>";if(!ps.length)$("customerHistory").innerHTML+='<div class="help" style="margin-top:8px">Belum ada pembayaran.</div>';ps.forEach(p=>{const{year,month}=parseMonthKey(p.period);$("customerHistory").innerHTML+=`<div class="history-item"><span>${MONTHS[month]} ${year}<br><span class="help">${p.date} · ${p.method}</span></span><b>${money(p.amount)}</b></div>`});$("customerModal").classList.add("show")}
async function renderPaymentHistory(){const q=$("paymentSearch").value.trim().toLowerCase(),cs=await all("customers"),ps=await all("payments"),rows=ps.map(p=>({p,c:cs.find(c=>c.id===p.customerId)})).filter(x=>x.c&&(!q||x.c.name.toLowerCase().includes(q))).sort((a,b)=>b.p.date.localeCompare(a.p.date));$("paymentHistory").innerHTML="";if(!rows.length){$("paymentHistory").innerHTML='<div class="empty">Belum ada riwayat pembayaran.</div>';return}rows.slice(0,200).forEach(x=>{const{year,month}=parseMonthKey(x.p.period);$("paymentHistory").innerHTML+=`<div class="history-item"><span><b>${x.c.name}</b><br><span class="help">${MONTHS[month]} ${year} · ${x.p.date} · ${x.p.method}</span></span><b>${money(x.p.amount)}</b></div>`})}
async function renderDashboard(){const cs=(await all("customers")).filter(c=>c.active!==false),ps=await all("payments"),now=new Date(),y=now.getFullYear(),m=now.getMonth();let paid=0,arrears=0,revenue=0;for(const c of cs){if(await statusFor(c,y,m)==="paid")paid++;let has=false,sp=firstBillingPeriod(c);for(let yy=sp.year;yy<=y&&!has;yy++){const from=yy===sp.year?sp.month:0,to=yy===y?m:11;for(let mm=from;mm<=to;mm++)if(await statusFor(c,yy,mm)==="arrears"){has=true;break}}if(has)arrears++}ps.filter(p=>p.period===monthKey(y,m)).forEach(p=>revenue+=Number(p.amount||0));$("dashCustomers").textContent=cs.length;$("dashPaid").textContent=paid;$("dashArrears").textContent=arrears;$("dashRevenue").textContent=money(revenue);$("dashMonth").textContent=`${MONTHS[m]} ${y}`;$("todaySummary").textContent=`${paid} dari ${cs.length} pelanggan sudah melunasi tagihan ${MONTHS[m]}. ${arrears} pelanggan memiliki tagihan yang sudah lewat.`}
async function renderAll(){await refreshPackages();await renderCustomers();await renderDashboard();await renderPaymentHistory();updateSavedLabel()}

async function exportDataObject(){return{version:2,lastUpdated:new Date().toISOString(),packages:await all("packages"),customers:await all("customers"),payments:await all("payments")}}
async function importDataObject(d){if(!d||!Array.isArray(d.packages)||!Array.isArray(d.customers)||!Array.isArray(d.payments))throw new Error("Format tidak valid");for(const s of["packages","customers","payments"])await clearStore(s);for(const x of d.packages)await put("packages",x);for(const x of d.customers)await put("customers",x);for(const x of d.payments)await put("payments",x);markSaved();await renderAll()}

async function saveLocal(){markSaved();toast("Data lokal tersimpan")}
function updateCloudUI(){const connected=!!googleAccessToken;$("cloudPill").classList.toggle("connected",connected);$("cloudText").textContent=connected?"Drive terhubung":"Drive belum terhubung";$("settingsCloudStatus").classList.toggle("ok",connected);$("settingsCloudText").textContent=connected?"Terhubung ke Google Drive":"Belum terhubung"}

function initGoogleClient(){const clientId=$("googleClientId").value.trim();if(!clientId){toast("Masukkan Google OAuth Client ID");return false}localStorage.setItem("mahdy_google_client_id",clientId);if(!window.google?.accounts?.oauth2){alert("Google Identity belum siap. Pastikan internet aktif lalu coba lagi.");return false}googleTokenClient=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:DRIVE_SCOPE,callback:resp=>{if(resp.error){alert("Login Google gagal: "+resp.error);return}googleAccessToken=resp.access_token;updateCloudUI();toast("Google Drive terhubung")}});return true}
function connectGoogle(){if(initGoogleClient())googleTokenClient.requestAccessToken({prompt:"consent"})}
function disconnectGoogle(){googleAccessToken=null;updateCloudUI();toast("Koneksi Google diputus")}
async function driveFetch(url,opts={}){if(!googleAccessToken)throw new Error("Drive belum terhubung");const h=Object.assign({Authorization:"Bearer "+googleAccessToken},opts.headers||{});const r=await fetch(url,Object.assign({},opts,{headers:h}));if(!r.ok)throw new Error(await r.text());return r}
async function findDriveFile(name){const q=encodeURIComponent(`name='${name}' and trashed=false`);const r=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)`);const d=await r.json();return d.files?.[0]||null}
async function createDriveJson(name,obj){const meta={name,mimeType:"application/json"},boundary="-------mahdy"+Date.now(),body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;const r=await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});return r.json()}
async function updateDriveJson(fileId,obj){const r=await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(obj)});return r.json()}
async function downloadDriveJson(fileId){const r=await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);return r.json()}

async function syncDrive(){try{if(!googleAccessToken){toast("Hubungkan Google Drive dulu");activateTab("settings");return}const local=await exportDataObject(),f=await findDriveFile(MAIN_FILE_NAME);if(!f){await createDriveJson(MAIN_FILE_NAME,local);toast("Data pertama dikirim ke Drive");return}const remote=await downloadDriveJson(f.id),lt=new Date(local.lastUpdated||0).getTime(),rt=new Date(remote.lastUpdated||0).getTime();if(rt>lt&&confirm("Data Drive lebih baru. Ambil data dari Drive?")){await importDataObject(remote);toast("Data Drive diterapkan")}else{await updateDriveJson(f.id,local);toast("Drive disinkronkan dari data HP")}}catch(e){alert("Sinkron gagal. "+e.message)}}
async function backupDrive(){try{if(!googleAccessToken){toast("Hubungkan Google Drive dulu");activateTab("settings");return}const data=await exportDataObject(),name=BACKUP_PREFIX+new Date().toISOString().replace(/[:.]/g,"-")+".json";await createDriveJson(name,data);toast("Backup dibuat di Drive")}catch(e){alert("Backup gagal. "+e.message)}}
async function restoreDrive(){try{if(!googleAccessToken){toast("Hubungkan Google Drive dulu");activateTab("settings");return}const q=encodeURIComponent(`name contains '${BACKUP_PREFIX}' and trashed=false`);const r=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)&pageSize=30`),d=await r.json(),list=$("restoreList");list.innerHTML="";if(!d.files?.length){list.innerHTML='<div class="empty">Belum ada backup di Drive.</div>'}else d.files.forEach(f=>{const row=document.createElement("div");row.className="history-item";row.innerHTML=`<span><b>${f.name}</b><br><span class="help">${new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(f.modifiedTime))}</span></span><button class="btn btn-soft" data-rid="${f.id}">Restore</button>`;list.appendChild(row)});list.querySelectorAll("[data-rid]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Restore backup ini? Data lokal sekarang akan diganti."))return;try{const obj=await downloadDriveJson(b.dataset.rid);const safety=await exportDataObject();await createDriveJson(BACKUP_PREFIX+"SEBELUM_RESTORE_"+new Date().toISOString().replace(/[:.]/g,"-")+".json",safety);await importDataObject(obj);$("restoreModal").classList.remove("show");toast("Restore selesai")}catch(e){alert("Restore gagal. "+e.message)}}));$("restoreModal").classList.add("show")}catch(e){alert("Gagal membaca backup. "+e.message)}}
async function exportLocalJson(){const d=await exportDataObject(),blob=new Blob([JSON.stringify(d,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="MAHDY-NET_Local_"+ymd(new Date())+".json";a.click();URL.revokeObjectURL(a.href)}

function activateTab(id){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));document.querySelectorAll(".section").forEach(x=>x.classList.toggle("active",x.id===id))}
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>activateTab(t.dataset.tab)));
$("addPackageBtn").onclick=addPackageFn;$("addCustomerBtn").onclick=addCustomerFn;
$("searchInput").addEventListener("input",()=>{currentPage=1;renderCustomers()});$("yearSelect").addEventListener("change",()=>{selectedYear=Number($("yearSelect").value);renderCustomers()});$("pageSize").addEventListener("change",()=>{currentPage=1;renderCustomers()});
$("custStartDate").addEventListener("change",()=>{if(!$("custStartDate").value)return;const d=new Date($("custStartDate").value+"T00:00:00");d.setMonth(d.getMonth()+1);$("custDueDate").value=ymd(d)});
$("savePaymentBtn").onclick=savePaymentFn;$("deletePaymentBtn").onclick=deletePaymentFn;$("closePaymentBtn").onclick=()=>$("paymentModal").classList.remove("show");$("closeCustomerBtn").onclick=()=>$("customerModal").classList.remove("show");
$("closeEditPkgBtn").onclick=()=>$("editPackageModal").classList.remove("show");$("saveEditPkgBtn").onclick=saveEditPackage;
$("paymentSearch").addEventListener("input",renderPaymentHistory);
$("saveBtn").onclick=saveLocal;$("syncBtn").onclick=syncDrive;$("backupBtn").onclick=backupDrive;$("restoreBtn").onclick=restoreDrive;
$("connectGoogleBtn").onclick=connectGoogle;$("disconnectGoogleBtn").onclick=disconnectGoogle;$("exportLocalBtn").onclick=exportLocalJson;$("closeRestoreBtn").onclick=()=>$("restoreModal").classList.remove("show");
document.addEventListener("pointerdown",e=>{const b=e.target.closest("button,.btn");if(!b)return;const r=b.getBoundingClientRect(),s=document.createElement("span");s.className="ripple";s.style.left=(e.clientX-r.left)+"px";s.style.top=(e.clientY-r.top)+"px";b.appendChild(s);setTimeout(()=>s.remove(),520)},{passive:true});
[$("paymentModal"),$("customerModal"),$("editPackageModal"),$("restoreModal")].forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("show")}));

(async()=>{await openDB();initYears();autofillDates();await seedPackages();const cid=localStorage.getItem("mahdy_google_client_id");if(cid)$("googleClientId").value=cid;updateCloudUI();await renderAll()})();

// Extra UI polish for GitHub edition
document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    const target=document.getElementById(tab.dataset.tab);
    if(target){
      target.animate(
        [{opacity:.6,transform:"translateY(5px)"},{opacity:1,transform:"translateY(0)"}],
        {duration:220,easing:"ease-out"}
      );
    }
  });
});
