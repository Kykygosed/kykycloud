/* ─────────────────────────────────────────
   AUTH
───────────────────────────────────────── */
auth.onAuthStateChanged(async u => {
  if (u) {
    CU = u;
    el('auth-screen').classList.add('hidden');
    el('app-screen').classList.remove('hidden');
    el('app-screen').style.display = 'flex';
    await initApp();
  } else {
    CU = null; myData = null;
    el('auth-screen').classList.remove('hidden');
    el('app-screen').style.display = 'none';
    el('app-screen').classList.add('hidden');
  }
});

async function registerUser() {
  const email  = v('reg-email').trim();
  const pseudo = v('reg-pseudo').trim().toLowerCase();
  const pass   = v('reg-password');
  if (!email || !pseudo || pass.length < 6) return toast('❌ Remplis tous les champs (mdp ≥ 6)');
  if ((await db.ref(`usernames/${pseudo}`).once('value')).exists()) return toast('❌ Pseudo déjà pris');
  try {
    const c = await auth.createUserWithEmailAndPassword(email, pass);
    await db.ref(`users/${c.user.uid}`).set({
      uid: c.user.uid, email, pseudo, avatar: randAv(),
      bio: 'Salut ! Je suis sur KyChat 👋', pronouns: '',
      banned: false, admin: false, friends: {}, status: 'offline', createdAt: Date.now()
    });
    await db.ref(`usernames/${pseudo}`).set(c.user.uid);
  } catch(e) { toast('❌ ' + e.message); }
}

async function loginUser() {
  try { await auth.signInWithEmailAndPassword(v('login-email').trim(), v('login-password')); }
  catch(e) { toast('❌ ' + e.message); }
}

async function logoutUser() {
  if (!confirm('Se déconnecter ?')) return;
  await setOffline(); auth.signOut();
}

/* ── PRESENCE ── */
function setupPresence() {
  const ref = db.ref(`users/${CU.uid}/status`);
  db.ref('.info/connected').on('value', s => {
    if (!s.val()) return;
    ref.onDisconnect().set('offline');
    ref.set('online');
  });
  window.addEventListener('beforeunload', setOffline);
}
async function setOffline() {
  if (CU) await db.ref(`users/${CU.uid}/status`).set('offline').catch(() => {});
}

/* ── BAN CHECK ── */
async function checkBan() {
  if (!CU) return;
  const banned = (await db.ref(`users/${CU.uid}/banned`).once('value')).val();
  if (banned === true) {
    el('app-screen').style.display = 'none';
    el('banned-screen').classList.remove('hidden');
  }
}
