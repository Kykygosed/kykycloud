/* ─────────────────────────────────────────
   PROFILE
───────────────────────────────────────── */
function showMyProfile() { openProfileModal(CU.uid, true); }

async function openProfileModal(uid, isMe = false) {
  const u = (await db.ref(`users/${uid}`).once('value')).val(); if (!u) return;
  tempUid = uid; isOwnModal = isMe || uid === CU.uid;

  el('profile-avatar-img').src = u.avatar;
  el('pv-pseudo').textContent = u.pseudo;
  el('pv-pronouns').textContent = u.pronouns || '';
  el('pv-bio').textContent = u.bio || 'Pas de bio.';
  el('avatar-hover-overlay').style.display = isOwnModal ? '' : 'none';

  const online = u.status === 'online';
  el('prof-sdot').className = `sdot ${online ? 's-on' : 's-off'}`;
  el('prof-status-txt').textContent = online ? 'En ligne' : 'Hors ligne';
  el('prof-status-txt').style.color = online ? '#22c55e' : 'var(--text-muted)';

  el('btn-edit-profile').classList.toggle('hidden', !isOwnModal);
  el('other-profile-actions').style.display = (isOwnModal || !myFriends[uid]) ? 'none' : 'grid';

  // Common friends
  const cfSection = el('common-friends-section');
  if (!isOwnModal && !isMe) {
    const common = await getCommonFriends(uid);
    if (common.length) {
      cfSection.style.display = 'block';
      const row = el('common-friends-row'); row.innerHTML = '';
      common.slice(0, 6).forEach(f => {
        const img = document.createElement('img');
        img.src = f.avatar || 'basic1.png'; img.onerror = () => img.src = 'basic1.png';
        img.className = 'w-8 h-8 rounded-xl object-cover';
        img.title = f.pseudo;
        img.style.cssText = 'border:2px solid var(--bg-deep);cursor:pointer';
        img.onclick = () => { hideModal('modal-profile'); openProfileModal(f.uid); };
        row.appendChild(img);
      });
      el('common-friends-label').textContent = `${common.length} ami${common.length > 1 ? 's' : ''} en commun`;
    } else {
      cfSection.style.display = 'none';
    }
  } else {
    cfSection.style.display = 'none';
  }

  el('profile-view-mode').classList.remove('hidden');
  el('profile-edit-mode').classList.add('hidden');
  el('modal-profile').classList.remove('hidden');
}

function enterEditMode() {
  el('edit-pseudo').value    = el('pv-pseudo').textContent;
  el('edit-pronouns').value  = el('pv-pronouns').textContent;
  const b = el('pv-bio').textContent;
  el('edit-bio').value       = b === 'Pas de bio.' ? '' : b;
  el('edit-avatar-url').value = '';
  el('profile-view-mode').classList.add('hidden');
  el('profile-edit-mode').classList.remove('hidden');
}
function cancelEdit() {
  el('profile-view-mode').classList.remove('hidden');
  el('profile-edit-mode').classList.add('hidden');
}

async function saveProfile() {
  const pseudo    = el('edit-pseudo').value.trim();
  const pronouns  = el('edit-pronouns').value.trim();
  const bio       = el('edit-bio').value.trim();
  const avatarUrl = el('edit-avatar-url').value.trim();
  if (!pseudo) return toast('❌ Pseudo vide');
  const updates = { pseudo, pronouns, bio }; if (avatarUrl) updates.avatar = avatarUrl;
  try {
    const old = myData.pseudo.toLowerCase();
    await db.ref(`users/${CU.uid}`).update(updates);
    if (pseudo.toLowerCase() !== old) {
      await db.ref(`usernames/${old}`).remove();
      await db.ref(`usernames/${pseudo.toLowerCase()}`).set(CU.uid);
    }
    myData = { ...myData, ...updates };
    el('my-pseudo').textContent = pseudo;
    if (avatarUrl) { el('my-avatar').src = avatarUrl; el('profile-avatar-img').src = avatarUrl; }
    el('pv-pseudo').textContent = pseudo;
    el('pv-pronouns').textContent = pronouns;
    el('pv-bio').textContent = bio || 'Pas de bio.';
    cancelEdit(); toast('✅ Profil mis à jour !');
  } catch(e) { toast('❌ ' + e.message); }
}

async function changeMyAvatarFile(evt) {
  const file = evt.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async e => {
    const b64 = e.target.result;
    await db.ref(`users/${CU.uid}/avatar`).set(b64);
    el('profile-avatar-img').src = b64; el('my-avatar').src = b64;
    if (myData) myData.avatar = b64; toast('📷 Photo mise à jour !');
  };
  r.readAsDataURL(file);
}

function blockUser()    { if (!confirm('Bloquer ?')) return; db.ref(`users/${CU.uid}/blocked/${tempUid}`).set(true); hideModal('modal-profile'); toast('🚫 Bloqué'); }
function removeFriend() { if (!confirm('Retirer ?')) return; db.ref(`users/${CU.uid}/friends/${tempUid}`).remove(); db.ref(`users/${tempUid}/friends/${CU.uid}`).remove(); hideModal('modal-profile'); toast('👋 Ami retiré'); }
