(function () {
  "use strict";
  const STORE_KEY = "feuCanteenRentalStores";
  const PAYMENT_KEY = "feuCanteenRentalPayments";
  const session = JSON.parse(localStorage.getItem("feuCanteenSession") || "null");
  if (!session || String(session.role || "").toLowerCase() !== "superadmin") {
    window.location.replace("login.html"); return;
  }
  const $ = id => document.getElementById(id);
  const read = key => { try { const data = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(data) ? data : []; } catch (_) { return []; } };
  let stores = read(STORE_KEY), payments = read(PAYMENT_KEY);
  const save = () => { localStorage.setItem(STORE_KEY, JSON.stringify(stores)); localStorage.setItem(PAYMENT_KEY, JSON.stringify(payments)); };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const pesos = n => new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(Number(n) || 0);
  const today = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const monthNow = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); };
  const dueDate = (store, month) => month + '-' + String(store.dueDay).padStart(2,'0');
  const paidFor = (store, month) => payments.filter(p => p.storeId === store.id && p.month === month).reduce((sum,p) => sum+Number(p.amount),0);
  function status(store) {
    if (paidFor(store, monthNow()) >= Number(store.rent)) return 'Paid';
    return today() >= dueDate(store, monthNow()) ? 'Due' : 'Unpaid';
  }
  function render() {
    $('storeTotal').textContent = stores.length;
    $('paidTotal').textContent = stores.filter(s=>status(s)==='Paid').length;
    $('outstandingTotal').textContent = stores.filter(s=>status(s)!=='Paid').length;
    $('storeRows').innerHTML = stores.length ? stores.map(s => `<tr><td><strong>${escape(s.name)}</strong></td><td>${escape(s.owner)}</td><td>${pesos(s.rent)}</td><td>${escape(dueDate(s, monthNow()))}</td><td><span class="rental-pill ${status(s).toLowerCase()}">${status(s)}</span></td><td><div class="rental-actions"><button class="rental-btn" data-action="pay" data-id="${escape(s.id)}">Record Payment</button><button class="rental-btn secondary" data-action="edit" data-id="${escape(s.id)}">Edit</button><button class="rental-btn secondary" data-action="delete" data-id="${escape(s.id)}">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="rental-empty">No stores yet. Select Add Store to register the first rental.</td></tr>';
    $('paymentRows').innerHTML = payments.length ? [...payments].sort((a,b)=>b.date.localeCompare(a.date)).map(p => {
      const store = stores.find(s=>s.id===p.storeId);
      return `<tr><td>${escape(store?.name || 'Removed store')}</td><td>${escape(p.month)}</td><td>${escape(p.date)}</td><td>${pesos(p.amount)}</td><td>${p.proof ? `<button class="rental-btn secondary" data-action="proof" data-id="${escape(p.id)}">View Proof</button>` : '—'}</td><td><button class="rental-btn secondary" data-action="remove-payment" data-id="${escape(p.id)}">Delete</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="rental-empty">No rental payments recorded.</td></tr>';
  }
  const open = id => $(id).classList.add('open');
  const close = id => $(id).classList.remove('open');
  $('changeSuperadminPassword').addEventListener('click',()=>{ $('passwordForm').reset(); open('passwordModal'); });
  async function hashPassword(value) {
    if (!window.crypto?.subtle || !window.TextEncoder) return 'plain:' + String(value);
    const bytes = new TextEncoder().encode(String(value));
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  $('passwordForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const users = read('feuCanteenUsers');
    const u = users.find(user=>user.id===session.id && String(user.role||'').toLowerCase()==='superadmin');
    if(!u){alert('Superadmin account not found.');return;}
    const oldValue=$('oldSuperadminPassword').value;
    const oldMatch = u.passwordHash ? (u.passwordHash==='plain:'+oldValue || u.passwordHash===await hashPassword(oldValue)) : u.password===oldValue;
    if(!oldMatch){alert('Current password is incorrect.');return;}
    const newValue=$('newSuperadminPassword').value;
    if(newValue.length<8 || newValue!==$('confirmSuperadminPassword').value){alert('New passwords must match and contain at least 8 characters.');return;}
    u.passwordHash=await hashPassword(newValue);u.passwordHashAlgorithm='SHA-256';delete u.password;
    localStorage.setItem('feuCanteenUsers',JSON.stringify(users));close('passwordModal');alert('Superadmin password changed.');
  });
  $('addStore').addEventListener('click',()=>{ $('storeForm').reset(); $('storeId').value=''; $('storeDialogTitle').textContent='Add Store'; open('storeModal'); });
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>close(b.dataset.close)));
  document.querySelectorAll('.rental-modal').forEach(modal=>modal.addEventListener('click',e=>{if(e.target===modal) close(modal.id); }));
  $('storeForm').addEventListener('submit',e=>{
    e.preventDefault();
    const id = $('storeId').value || ('STORE-'+Date.now()+'-'+Math.random().toString(36).slice(2,6));
    const record = {id, name:$('storeName').value.trim(),owner:$('ownerName').value.trim(),rent:Number($('rentAmount').value),dueDay:Number($('dueDay').value)};
    if (!record.name || !record.owner || record.rent<=0 || record.dueDay<1 || record.dueDay>28) return;
    const at = stores.findIndex(s=>s.id===id); if(at===-1) stores.push(record); else stores[at]=record;
    save(); render(); close('storeModal');
  });
  document.body.addEventListener('click', e=>{
    const b=e.target.closest('[data-action]');if(!b)return;
    const id=b.dataset.id, action=b.dataset.action;
    if(action==='edit') {const s=stores.find(x=>x.id===id);if(!s)return; $('storeId').value=s.id;$('storeName').value=s.name;$('ownerName').value=s.owner;$('rentAmount').value=s.rent;$('dueDay').value=s.dueDay;$('storeDialogTitle').textContent='Edit Store';open('storeModal');}
    if(action==='pay'){const s=stores.find(x=>x.id===id);if(!s)return;$('paymentForm').reset();$('paymentStoreId').value=id;$('paymentMonth').value=monthNow();$('paymentDate').value=today();$('paymentAmount').value=Math.max(0.01,Number(s.rent)-paidFor(s,monthNow())).toFixed(2);open('paymentModal');}
    if(action==='delete' && confirm('Delete this store and all its rental payment history?')) {stores=stores.filter(s=>s.id!==id);payments=payments.filter(p=>p.storeId!==id);save();render();}
    if(action==='remove-payment' && confirm('Delete this payment record?')) {payments=payments.filter(p=>p.id!==id);save();render();}
    if(action==='proof'){const p=payments.find(x=>x.id===id);if(!p?.proof)return;const win=window.open('','_blank');if(!win){alert('Allow pop-ups to view this proof.');return;} const safe=p.proof.type==='application/pdf' ? 'application/pdf' : 'image/'+(p.proof.type.split('/')[1]||'png'); const blob=dataToBlob(p.proof.data,safe);const url=URL.createObjectURL(blob);win.location=url;setTimeout(()=>URL.revokeObjectURL(url),60000);}
  });
  function dataToBlob(data,type){const raw=atob(data.split(',')[1]);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);return new Blob([bytes],{type});}
  $('paymentForm').addEventListener('submit',async e=>{
    e.preventDefault();const file=$('paymentProof').files[0];let proof=null;
    if(file){if(!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)){alert('Select a PNG, JPG, WEBP, or PDF file.');return;} if(file.size>1024*1024){alert('File exceeds the 1 MB demo storage limit.');return;} proof={type:file.type,data:await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);})};}
    const record={id:'PAY-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),storeId:$('paymentStoreId').value,month:$('paymentMonth').value,date:$('paymentDate').value,amount:Number($('paymentAmount').value),proof};
    if(!stores.some(s=>s.id===record.storeId)||record.amount<=0)return;
    payments.push(record);try{save();}catch(err){payments.pop();alert('Browser storage is full. Use a smaller proof file or a shared backend.');return;}render();close('paymentModal');
  });
  render();
})();
