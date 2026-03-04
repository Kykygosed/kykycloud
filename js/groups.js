/* ─────────────────────────────────────────
   GROUPS
───────────────────────────────────────── */
function showCreateGroupModal() {
  el('group-name-input').value = ''; el('group-search-input').value = '';
  selMembers = []; el('modal-create-group').classList.remove('hidden'); loadGrpFriends();
}

async function loadGrpFriends() {
  grpFriendsCache = [];
  for (const uid of Object.keys(myFriends)) {
    const u = (await db.ref(`users/${uid}`).once('value')).val();
    if (u) grpFriendsCache.push({ uid, ...u });
  }
  renderGrpFriends(grpFriendsCache);
}
function filterGroupFriends() {
  const q = el('group-search-input').value.toLowerCase();
  renderGrpFriends(grpFriendsCache.filter(u => u.pseudo.toLowerCase().includes(q)));
}
function renderGrpFriends(friends) {
  const c = el('group-friends-list'); c.innerHTML = '';
  friends.forEach(u => {
    const sel = selMembers.includes(u.uid);
    const e = document.createElement('div');
    e.className = 'flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition';
    e.style.background = sel ? 'rgba(34,197,94,.12)' : 'transparent';
    e.onmouseenter = () => { if (!sel) e.style.background = 'var(--bg-card)'; };
    e.onmouseleave = () => { e.style.background = sel ? 'rgba(34,197,94,.12)' : 'transparent'; };
    e.innerHTML = `<img src="${esc(u.avatar)}" class="w-9 h-9 rounded-xl object-cover" onerror="this.src='basic1.png'"><span class="flex-1 text-sm font-semibold">${esc(u.pseudo)}</span><span>${sel ? '✅' : '⭕'}</span>`;
    e.onclick = () => { if (sel) selMembers = selMembers.filter(x => x !== u.uid); else selMembers.push(u.uid); renderGrpFriends(friends); };
    c.appendChild(e);
  });
}

async function createNewGroup() {
  const name = el('group-name-input').value.trim();
  if (!name || !selMembers.length) return toast('❌ Nom + au moins 1 ami');
  const gid = 'g_' + Date.now(), members = { [CU.uid]: true };
  selMembers.forEach(uid => members[uid] = true);
  await db.ref(`groups/${gid}`).set({ name, owner: CU.uid, members, created: Date.now() });
  hideModal('modal-create-group'); toast('✅ Groupe créé !');
}

async function loadGroupMembers(gid) {
  const c = el('members-list'); c.innerHTML = '';
  const g = (await db.ref(`groups/${gid}`).once('value')).val(); if (!g) return;
  const isOwner = g.owner === CU.uid;
  for (const uid of Object.keys(g.members || {})) {
    const u = (await db.ref(`users/${uid}`).once('value')).val(); if (!u) continue;
    const e = document.createElement('div');
    e.className = 'flex items-center gap-3 p-2 rounded-xl cursor-pointer transition';
    e.style.background = 'transparent';
    e.onmouseenter = () => e.style.background = 'var(--bg-input)';
    e.onmouseleave = () => e.style.background = 'transparent';
    const rmBtn = (isOwner && uid !== CU.uid)
      ? `<button onclick="removeMember('${gid}','${uid}');event.stopPropagation()" class="text-xs px-2 py-1 rounded-lg opacity-60 hover:opacity-100" style="background:rgba(220,38,38,.2);color:#f87171">✕</button>` : '';
    e.innerHTML = `<img src="${esc(u.avatar)}" class="w-8 h-8 rounded-xl object-cover" onerror="this.src='basic1.png'">
      <span class="text-sm flex-1 truncate">${esc(u.pseudo)}</span>
      ${uid === g.owner ? '<span class="text-xs">👑</span>' : ''}
      <span class="w-2 h-2 rounded-full ${u.status === 'online' ? 'bg-green-500' : 'bg-zinc-600'}"></span>
      ${rmBtn}`;
    e.onclick = () => { if (uid !== CU.uid) openProfileModal(uid); };
    c.appendChild(e);
  }
}

async function removeMember(gid, uid) {
  if (!confirm('Retirer ce membre ?')) return;
  await db.ref(`groups/${gid}/members/${uid}`).remove();
  loadGroupMembers(gid); toast('👋 Membre retiré');
}

async function deleteCurrentGroup() {
  if (!confirm('Supprimer ce groupe ?')) return;
  await db.ref(`groups/${groupId}`).remove();
  chatId = null; groupId = null;
  el('right-panel').classList.add('hidden');
  el('messages-area').innerHTML = ''; el('header-name').textContent = '';
  el('header-subtitle').textContent = ''; el('header-avatar').innerHTML = '';
  toast('🗑 Groupe supprimé');
}

async function leaveCurrentGroup() {
  if (!confirm('Quitter ce groupe ?')) return;
  await db.ref(`groups/${groupId}/members/${CU.uid}`).remove();
  chatId = null; groupId = null;
  el('right-panel').classList.add('hidden');
  el('messages-area').innerHTML = ''; el('header-name').textContent = '';
  el('header-subtitle').textContent = ''; el('header-avatar').innerHTML = '';
  scheduleRender(); toast('👋 Tu as quitté le groupe');
}

async function showAddMemberModal() {
  el('add-member-search').value = ''; el('modal-add-member').classList.remove('hidden');
  const ex = (await db.ref(`groups/${groupId}/members`).once('value')).val() || {};
  addMemberCache = [];
  for (const uid of Object.keys(myFriends)) {
    if (ex[uid]) continue;
    const u = (await db.ref(`users/${uid}`).once('value')).val();
    if (u) addMemberCache.push({ uid, ...u });
  }
  renderAddMember(addMemberCache);
}
function filterAddMember() {
  const q = el('add-member-search').value.toLowerCase();
  renderAddMember(addMemberCache.filter(u => u.pseudo.toLowerCase().includes(q)));
}
function renderAddMember(friends) {
  const c = el('add-member-list'); c.innerHTML = '';
  if (!friends.length) { c.innerHTML = '<div class="text-center text-sm py-4" style="color:var(--text-muted)">Aucun ami disponible</div>'; return; }
  friends.forEach(u => {
    const e = document.createElement('div');
    e.className = 'flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition';
    e.style.background = 'transparent';
    e.onmouseenter = () => e.style.background = 'var(--bg-card)';
    e.onmouseleave = () => e.style.background = 'transparent';
    e.innerHTML = `<img src="${esc(u.avatar)}" class="w-9 h-9 rounded-xl object-cover" onerror="this.src='basic1.png'"><span class="flex-1 text-sm font-semibold">${esc(u.pseudo)}</span><button class="text-xs px-3 py-1.5 rounded-xl font-bold text-white" style="background:#22c55e">Ajouter</button>`;
    e.onclick = async () => { await db.ref(`groups/${groupId}/members/${u.uid}`).set(true); toast(`✅ ${u.pseudo} ajouté !`); loadGroupMembers(groupId); hideModal('modal-add-member'); };
    c.appendChild(e);
  });
}
