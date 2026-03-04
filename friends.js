/* ─────────────────────────────────────────
   FRIENDS
───────────────────────────────────────── */
function listenFriendRequests() {
  db.ref(`friendRequests/${CU.uid}`).on('value', s => {
    const list = Object.entries(s.val() || {});
    const badge = el('request-count');
    if (list.length) { badge.textContent = list.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
    const c = el('requests-list'); c.innerHTML = '';
    list.forEach(([uid, data]) => {
      const e = document.createElement('div');
      e.className = 'flex items-center gap-2 rounded-2xl px-3 py-2 mb-1';
      e.style.background = 'var(--bg-card)';
      e.innerHTML = `<span class="text-xs font-semibold flex-1 truncate">${esc(data.fromPseudo)}</span>
        <button onclick="acceptReq('${uid}')" class="px-2.5 py-1 rounded-lg text-xs font-bold text-white" style="background:#22c55e">✓</button>
        <button onclick="declineReq('${uid}')" class="px-2.5 py-1 rounded-lg text-xs font-bold text-white" style="background:#dc2626">✗</button>`;
      c.appendChild(e);
    });
  });
}

async function acceptReq(uid) {
  await db.ref(`users/${CU.uid}/friends/${uid}`).set(true);
  await db.ref(`users/${uid}/friends/${CU.uid}`).set(true);
  await db.ref(`friendRequests/${CU.uid}/${uid}`).remove();
}
async function declineReq(uid) { await db.ref(`friendRequests/${CU.uid}/${uid}`).remove(); }

function showAddFriendModal() {
  el('add-pseudo').value = ''; el('modal-add-friend').classList.remove('hidden');
  setTimeout(() => el('add-pseudo').focus(), 80);
}
async function sendFriendRequest() {
  const pseudo = el('add-pseudo').value.trim().toLowerCase(); if (!pseudo) return;
  const s = await db.ref(`usernames/${pseudo}`).once('value');
  if (!s.exists()) return toast('❌ Pseudo introuvable');
  const uid = s.val(); if (uid === CU.uid) return toast('❌ Tu ne peux pas t\'ajouter toi-même');
  await db.ref(`friendRequests/${uid}/${CU.uid}`).set({ fromUid: CU.uid, fromPseudo: myData?.pseudo || '', time: Date.now() });
  hideModal('modal-add-friend'); toast('✅ Demande envoyée !');
}

/* ── COMMON FRIENDS (used by profile.js) ── */
async function getCommonFriends(uid) {
  const theirSnap = await db.ref(`users/${uid}/friends`).once('value');
  const theirFriends = theirSnap.val() || {};
  const common = [];
  for (const fid of Object.keys(myFriends)) {
    if (fid !== uid && theirFriends[fid] === true) {
      const u = (await db.ref(`users/${fid}`).once('value')).val();
      if (u) common.push(u);
    }
  }
  return common;
}
