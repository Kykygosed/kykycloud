/* ─────────────────────────────────────────
   CONVERSATIONS + UNREAD
───────────────────────────────────────── */
function listenFriendsRT() {
  db.ref(`users/${CU.uid}/friends`).on('value', s => {
    const raw = s.val() || {}; myFriends = {};
    for (const [uid, val] of Object.entries(raw))
      if (val === true) myFriends[uid] = true;
    scheduleRender();
  });
}
function listenGroupsRT() { db.ref('groups').on('value', () => scheduleRender()); }

function scheduleRender() {
  if (_rTO) clearTimeout(_rTO);
  _rTO = setTimeout(() => renderConvList(el('search-input')?.value || ''), 120);
}

async function getUnreadCount(cid) {
  const lr = lastReadCache[cid] || 0;
  const snap = await db.ref(`messages/${cid}`).orderByChild('time').startAfter(lr).once('value');
  if (!snap.exists()) return 0;
  let cnt = 0;
  snap.forEach(ch => { if (ch.val().sender !== CU.uid) cnt++; });
  return cnt;
}

async function renderConvList(filter = '') {
  const c = el('conversations-list'); c.innerHTML = '';
  const q = filter.toLowerCase();

  for (const uid of Object.keys(myFriends)) {
    const u = (await db.ref(`users/${uid}`).once('value')).val();
    if (!u || (q && !u.pseudo.toLowerCase().includes(q))) continue;
    const cid = dmId(uid);
    const unread = await getUnreadCount(cid);
    c.appendChild(mkConvEl({
      avatarSrc: u.avatar, name: u.pseudo, status: u.status,
      active: cid === chatId, unread,
      onClick: () => openChat(false, uid, u.pseudo, u.avatar),
      onAvatarClick: e => { e.stopPropagation(); openProfileModal(uid); }
    }));
  }

  const gs = await db.ref('groups').once('value');
  if (gs.exists()) gs.forEach(ch => {
    const g = ch.val();
    if (!g.members?.[CU.uid]) return;
    if (q && !g.name.toLowerCase().includes(q)) return;
    c.appendChild(mkConvEl({
      isGroup: true, name: g.name,
      sub: `${Object.keys(g.members).length} membres`,
      active: ch.key === chatId,
      onClick: () => openChat(true, ch.key, g.name, null)
    }));
  });
}

function mkConvEl({ avatarSrc, name, status, sub, active, unread = 0, onClick, onAvatarClick, isGroup = false }) {
  const d = document.createElement('div');
  d.className = `nav-item flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition ${active ? 'nav-active' : ''}`;
  d.style.background = active ? '' : 'transparent';
  d.onmouseenter = () => { if (!active) d.style.background = 'var(--bg-card)'; };
  d.onmouseleave = () => { if (!active) d.style.background = 'transparent'; };
  const online = status === 'online';
  const dot = !isGroup ? `<span class="sdot ${online?'s-on':'s-off'}" style="position:absolute;bottom:-1px;right:-1px;border-color:var(--bg-deep)"></span>` : '';
  const av = isGroup
    ? `<div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">👥</div>`
    : `<div class="relative flex-shrink-0 cursor-pointer"><img src="${esc(avatarSrc)}" class="w-10 h-10 rounded-xl object-cover" onerror="this.src='basic1.png'">${dot}</div>`;
  const subH = sub || (online
    ? `<span style="color:#22c55e;font-size:11px">● En ligne</span>`
    : `<span style="color:var(--text-muted);font-size:11px">● Hors ligne</span>`);
  const badge = unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : '';
  d.innerHTML = `${av}<div class="flex-1 min-w-0"><div class="font-semibold text-sm truncate">${esc(name)}</div><div class="text-xs mt-0.5">${subH}</div></div>${badge}`;
  d.onclick = onClick;
  if (onAvatarClick) d.querySelector('.relative')?.addEventListener('click', onAvatarClick);
  return d;
}

/* ── OPEN CHAT ── */
async function openChat(isGroup, id, name, avatarUrl) {
  if (msgRef && chatId) { db.ref(`messages/${chatId}`).off('child_added', msgRef); msgRef = null; }
  if (typingRef && chatId) { db.ref(`typing/${chatId}`).off('value', typingRef); typingRef = null; db.ref(`typing/${chatId}/${CU.uid}`).remove(); }
  if (activeCallRef && chatId) { db.ref(`activeCalls/${chatId}`).off('value', activeCallRef); activeCallRef = null; }
  if (partRef && chatId) { db.ref(`activeCalls/${chatId}/participants`).off('value', partRef); partRef = null; }
  clearReply();
  cancelEditMsg();

  chatId = isGroup ? id : dmId(id);
  chatIsGroup = isGroup; chatTarget = id;
  markRead(chatId);

  el('header-name').textContent = name;
  const avC = el('header-avatar');
  avC.innerHTML = avatarUrl
    ? `<img src="${esc(avatarUrl)}" class="w-9 h-9 rounded-xl object-cover" onerror="this.src='basic1.png'">`
    : `<div class="w-9 h-9 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">👥</div>`;

  if (!isGroup) {
    const s = await db.ref(`users/${id}/status`).once('value'); updateHdrSub(s.val());
    db.ref(`users/${id}/status`).on('value', s => updateHdrSub(s.val()));
  } else {
    el('header-subtitle').textContent = 'Groupe'; el('header-subtitle').style.color = '#22c55e';
  }

  const rp = el('right-panel');
  if (isGroup) {
    rp.classList.remove('hidden'); rp.style.display = 'flex'; groupId = id;
    const gs = await db.ref(`groups/${id}`).once('value'); groupOwner = gs.val()?.owner;
    el('group-owner-btns').classList.toggle('hidden', groupOwner !== CU.uid);
    loadGroupMembers(id);
  } else {
    rp.classList.add('hidden'); rp.style.display = 'none'; groupId = null;
  }

  // active call watcher → buttons + participant preview
  activeCallRef = db.ref(`activeCalls/${chatId}`).on('value', snap => {
    const a = snap.val(), active = a && a.active;
    const amInCall = active && a.callerUid === CU.uid;
    el('btn-call').classList.toggle('hidden', active && !amInCall);
    el('btn-join').classList.toggle('hidden', !active || amInCall);
    const preview = el('call-preview');
    if (active && a.participants) {
      const parts = Object.values(a.participants);
      preview.classList.remove('hidden'); preview.style.display = 'flex';
      const row = el('preview-avatars'); row.innerHTML = '';
      parts.slice(0, 4).forEach(p => {
        const img = document.createElement('img');
        img.src = p.avatar || 'basic1.png'; img.onerror = () => img.src = 'basic1.png';
        img.className = 'w-7 h-7 rounded-lg object-cover';
        img.style.cssText = 'border:2px solid var(--bg-panel)'; img.title = p.name;
        row.appendChild(img);
      });
      el('preview-label').textContent = parts.length === 1
        ? `${parts[0].name} en appel` : `${parts.length} en appel`;
    } else { preview.classList.add('hidden'); preview.style.display = 'none'; }
  });

  loadMessages(); startTypingListener(); scheduleRender();
}

async function markRead(cid) {
  const ts = Date.now(); lastReadCache[cid] = ts;
  await db.ref(`lastRead/${CU.uid}/${cid}`).set(ts).catch(() => {});
}

function updateHdrSub(s) {
  el('header-subtitle').textContent = s === 'online' ? '● En ligne' : '● Hors ligne';
  el('header-subtitle').style.color = s === 'online' ? '#22c55e' : 'var(--text-muted)';
}
function openCurrentChatProfile() { if (!chatTarget || chatIsGroup) return; openProfileModal(chatTarget); }

/* ── TYPING ── */
function startTypingListener() {
  typingRef = db.ref(`typing/${chatId}`).on('value', s => {
    const others = Object.entries(s.val() || {}).filter(([uid]) => uid !== CU.uid).map(([, d]) => d.pseudo);
    const ind = el('typing-indicator');
    if (others.length) {
      el('typing-text').textContent = others.length === 1 ? `${others[0]} écrit…` : `${others.join(', ')} écrivent…`;
      ind.classList.remove('hidden');
    } else ind.classList.add('hidden');
  });
}
