/* ─────────────────────────────────────────
   ADMIN
───────────────────────────────────────── */
async function showAdminPanel() {
  el('modal-admin').classList.remove('hidden');
  const s = await db.ref('users').once('value');
  allUsers = [];
  s.forEach(ch => { const u = ch.val(); if (u) allUsers.push(u); });
  renderAdminList(allUsers);
}

function adminSearch() {
  const q = el('admin-search').value.toLowerCase();
  renderAdminList(q ? allUsers.filter(u =>
    u.pseudo?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  ) : allUsers);
}

function renderAdminList(users) {
  const c = el('admin-user-list'); c.innerHTML = '';
  if (!users.length) {
    c.innerHTML = '<div class="text-center py-6" style="color:var(--text-muted)">Aucun utilisateur trouvé</div>';
    return;
  }
  users.forEach(u => {
    const banned = u.banned === true, isMe = u.uid === CU.uid;
    const e = document.createElement('div');
    e.className = 'flex items-center gap-4 p-4 rounded-2xl';
    e.style.background = 'var(--bg-input)';
    e.innerHTML = `
      <img src="${esc(u.avatar)}" class="w-10 h-10 rounded-xl object-cover flex-shrink-0" onerror="this.src='basic1.png'">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-sm">${esc(u.pseudo)}</span>
          ${u.admin ? '<span class="admin-badge">ADMIN</span>' : ''}
          ${banned ? '<span class="text-xs px-2 py-px rounded-full font-bold" style="background:rgba(220,38,38,.2);color:#f87171">BANNI</span>' : ''}
          <span class="w-2 h-2 rounded-full ${u.status === 'online' ? 'bg-green-500' : 'bg-zinc-600'}"></span>
        </div>
        <div class="text-xs truncate" style="color:var(--text-muted)">${esc(u.email || '')}</div>
      </div>
      ${!isMe
        ? `<button onclick="adminToggleBan('${u.uid}',${banned})" class="px-3 py-1.5 rounded-xl text-xs font-bold flex-shrink-0"
             style="background:${banned ? 'rgba(34,197,94,.2)' : 'rgba(220,38,38,.2)'};color:${banned ? '#22c55e' : '#f87171'}">
             ${banned ? 'Débannir' : 'Bannir'}</button>`
        : '<span class="text-xs italic" style="color:var(--text-muted)">Vous</span>'}`;
    c.appendChild(e);
  });
}

async function adminToggleBan(uid, banned) {
  if (!confirm(`${banned ? 'Débannir' : 'Bannir'} cet utilisateur ?`)) return;
  await db.ref(`users/${uid}/banned`).set(!banned);
  toast(banned ? '✅ Débanni' : '🚫 Banni');
  await showAdminPanel();
}
