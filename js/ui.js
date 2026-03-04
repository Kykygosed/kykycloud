/* ─────────────────────────────────────────
   UI UTILS
───────────────────────────────────────── */
function el(id)  { return document.getElementById(id); }
function v(id)   { return el(id).value; }
function esc(s)  {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(s || '')));
  return d.innerHTML;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}
function hideModal(id) { el(id).classList.add('hidden'); }

let _tTO = null;
function toast(msg) {
  const o = document.querySelector('.toast'); if (o) o.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  if (_tTO) clearTimeout(_tTO);
  _tTO = setTimeout(() => t.remove(), 2800);
}

function dmId(uid) { return [CU.uid, uid].sort().join('_'); }

/* ── NOTIFICATIONS ── */
function updateNotifUI() {
  const on = notifOn && Notification.permission === 'granted';
  el('notif-btn').style.color = on ? '#22c55e' : 'var(--text-muted)';
}
async function toggleNotifications() {
  if (notifOn && Notification.permission === 'granted') {
    notifOn = false; localStorage.setItem('kychat_notif','off'); updateNotifUI(); toast('🔕 Notifications désactivées');
  } else {
    if (Notification.permission === 'denied') return toast('❌ Bloquées dans les réglages navigateur');
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      notifOn = true; localStorage.setItem('kychat_notif','on'); updateNotifUI();
      pushNotif('KyChat 🟢', { body:'Notifications activées !' }); toast('🔔 Notifications activées');
    } else toast('❌ Permission refusée');
  }
}

/* ── CHAR COUNTER ── */
function onTyping() {
  if (!chatId) return;
  const len = el('msg-input').value.length;
  const counter = el('char-counter');
  if (len > 1800) {
    counter.textContent = `${len}/${MSG_LIMIT}`;
    counter.style.color = len >= MSG_LIMIT ? '#f87171' : '#f59e0b';
    counter.style.display = 'block';
  } else {
    counter.style.display = 'none';
  }
  db.ref(`typing/${chatId}/${CU.uid}`).set({ pseudo: myData?.pseudo || '', time: Date.now() });
  if (typingTO) clearTimeout(typingTO);
  typingTO = setTimeout(() => db.ref(`typing/${chatId}/${CU.uid}`).remove(), 2600);
}

/* ── AUTH UI ── */
function switchTab(t) {
  el('login-panel').classList.toggle('hidden', t !== 0);
  el('register-panel').classList.toggle('hidden', t !== 1);
  el('tab-login').className  = `flex-1 pb-3 text-base font-semibold ${t===0?'tab-on':'tab-off'}`;
  el('tab-register').className = `flex-1 pb-3 text-base font-semibold ${t===1?'tab-on':'tab-off'}`;
}

/* ── APP INIT (called by auth.js after login) ── */
async function initApp() {
  myData = (await db.ref(`users/${CU.uid}`).once('value')).val();
  const rawF = myData.friends || {};
  myFriends = {};
  for (const [uid, val] of Object.entries(rawF))
    if (val === true) myFriends[uid] = true;

  el('my-pseudo').textContent = myData.pseudo;
  el('my-avatar').src = myData.avatar;
  if (myData.admin) el('admin-section').classList.remove('hidden');
  updateNotifUI();
  setupPresence();
  listenFriendsRT();
  listenGroupsRT();
  listenFriendRequests();
  listenIncomingCalls();
  const lrSnap = await db.ref(`lastRead/${CU.uid}`).once('value');
  lastReadCache = lrSnap.val() || {};
  setInterval(checkBan, 15000); checkBan();
}
