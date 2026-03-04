/* ─────────────────────────────────────────
   MESSAGES — send, receive, reply, edit, delete, images
───────────────────────────────────────── */
function loadMessages() {
  el('messages-area').innerHTML = ''; isInitialLoad = true;
  msgRef = db.ref(`messages/${chatId}`).limitToLast(100).on('child_added', s => {
    appendMsg(s.val(), s.key);
    setTimeout(() => isInitialLoad = false, 800);
  });
  // Listen for edits / deletes on loaded messages
  db.ref(`messages/${chatId}`).limitToLast(100).on('child_changed', s => {
    updateMsgDOM(s.key, s.val());
  });
  db.ref(`messages/${chatId}`).on('child_removed', s => {
    document.querySelector(`.bubble-row[data-msg-id="${s.key}"]`)?.remove();
  });
}

function appendMsg(msg, msgKey) {
  const area = el('messages-area'), mine = msg.sender === CU.uid;

  if (!isInitialLoad && !mine && msg.time > Date.now() - 8000) {
    playSound('notif');
    if (notifOn) pushNotif(`💬 ${msg.senderPseudo}`, {
      body: msg.text?.length > 80 ? msg.text.slice(0, 80) + '…' : (msg.text || '📷 Image'),
      tag: 'kychat-msg'
    });
    markRead(chatId);
  }

  const row = document.createElement('div');
  row.className = `bubble-row ${mine ? 'mine' : ''}`;
  row.dataset.msgId = msgKey;

  const bub = document.createElement('div');
  bub.className = `bubble ${mine ? 'mine' : 'theirs'} bubble-animate`;
  bub.dataset.msgId = msgKey;
  bub.innerHTML = buildBubbleHTML(msg, mine);

  // reply button
  const rBtn = document.createElement('button');
  rBtn.className = 'reply-btn'; rBtn.title = 'Répondre'; rBtn.textContent = '↩';
  rBtn.onclick = () => setReply({ msgId: msgKey, pseudo: msg.senderPseudo, text: msg.text || '' });

  if (mine) { row.appendChild(rBtn); row.appendChild(bub); }
  else       { row.appendChild(bub); row.appendChild(rBtn); }

  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function buildBubbleHTML(msg, mine) {
  const replyQ = msg.replyTo
    ? `<div class="reply-quote" onclick="scrollToMsg('${esc(msg.replyTo.msgId || '')}')">
         <div class="rq-who">${esc(msg.replyTo.pseudo)}</div>
         <div class="rq-text">${esc(msg.replyTo.text?.slice(0, 100) || '')}</div>
       </div>` : '';

  let content = '';
  if (msg.imageUrl) {
    content = `<img src="${esc(msg.imageUrl)}" alt="" style="max-width:100%;border-radius:10px;display:block;margin-top:${msg.text?'6px':'0'};cursor:pointer" onclick="window.open('${esc(msg.imageUrl)}','_blank')" onerror="this.style.display='none'">`;
    if (msg.text) content = `<div>${esc(msg.text)}</div>` + content;
  } else {
    content = `<div>${esc(msg.text || '')}</div>`;
  }

  const edited = msg.edited ? `<span style="font-size:10px;opacity:.55;margin-left:4px">(modifié)</span>` : '';
  const deleted = msg.deleted ? `<span style="opacity:.5;font-style:italic;font-size:13px">Message supprimé</span>` : '';

  const ctxMenu = mine && !msg.deleted
    ? `<div class="msg-actions">
         ${!msg.imageUrl ? `<button onclick="startEditMsg('${esc(msg._key||'')}',this)" title="Modifier">✏️</button>` : ''}
         <button onclick="deleteMsg('${esc(msg._key||'')}',this)" title="Supprimer">🗑</button>
       </div>` : '';

  return `<div class="meta">${esc(msg.senderPseudo)} · ${fmtTime(msg.time)}${edited}</div>
    ${replyQ}
    ${msg.deleted ? deleted : content}
    ${ctxMenu}`;
}

function updateMsgDOM(key, msg) {
  const bub = document.querySelector(`.bubble[data-msg-id="${key}"]`);
  if (!bub) return;
  const mine = msg.sender === CU.uid;
  msg._key = key;
  bub.innerHTML = buildBubbleHTML(msg, mine);
}

/* ── SCROLL TO ORIGINAL MESSAGE ── */
function scrollToMsg(msgId) {
  if (!msgId) return;
  const row = document.querySelector(`.bubble-row[data-msg-id="${msgId}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.style.transition = 'background .2s';
  row.style.background = 'rgba(34,197,94,.18)';
  setTimeout(() => row.style.background = '', 1200);
}

/* ── SEND ── */
async function sendMessage() {
  const inp = el('msg-input'), text = inp.value.trim();
  if (!text && !replyCtx) return;
  if (text.length > MSG_LIMIT) return toast(`❌ Message trop long (max ${MSG_LIMIT} caractères)`);
  if (!chatId) return;
  const msg = { sender: CU.uid, senderPseudo: myData?.pseudo || '', text, time: Date.now() };
  if (replyCtx) msg.replyTo = { msgId: replyCtx.msgId, pseudo: replyCtx.pseudo, text: replyCtx.text.slice(0, 200) };
  const ref = await db.ref(`messages/${chatId}`).push(msg);
  // Store key in the message for ctx menu lookups
  await db.ref(`messages/${chatId}/${ref.key}/_key`).set(ref.key);
  inp.value = ''; el('char-counter').style.display = 'none';
  clearReply(); playSound('send');
  if (typingTO) clearTimeout(typingTO);
  db.ref(`typing/${chatId}/${CU.uid}`).remove();
}

/* ── SEND IMAGE URL ── */
function showImageModal() {
  el('image-url-input').value = '';
  el('modal-image').classList.remove('hidden');
  setTimeout(() => el('image-url-input').focus(), 80);
}
async function sendImageUrl() {
  const url = el('image-url-input').value.trim();
  if (!url || !chatId) return;
  hideModal('modal-image');
  const msg = { sender: CU.uid, senderPseudo: myData?.pseudo || '', text: '', imageUrl: url, time: Date.now() };
  const ref = await db.ref(`messages/${chatId}`).push(msg);
  await db.ref(`messages/${chatId}/${ref.key}/_key`).set(ref.key);
}

/* ── REPLY ── */
function setReply(ctx) {
  replyCtx = ctx;
  el('rbar-name').textContent = ctx.pseudo;
  el('rbar-text').textContent = ctx.text;
  el('reply-bar').style.display = 'block';
  el('msg-input').focus();
}
function clearReply() {
  replyCtx = null;
  el('reply-bar').style.display = 'none';
  el('rbar-name').textContent = ''; el('rbar-text').textContent = '';
}

/* ── EDIT ── */
function startEditMsg(msgId, btnEl) {
  // find the bubble
  const bub = document.querySelector(`.bubble[data-msg-id="${msgId}"]`);
  if (!bub) return;
  const textDiv = bub.querySelector('div:not(.meta):not(.reply-quote):not(.msg-actions)');
  const current = textDiv?.textContent || '';
  editingMsgId = msgId;

  // replace text div with an input
  const wrap = document.createElement('div');
  wrap.id = 'edit-inline-wrap';
  wrap.innerHTML = `
    <textarea id="edit-inline-input" style="width:100%;background:rgba(255,255,255,.08);color:inherit;border:1px solid #22c55e55;border-radius:10px;padding:6px 10px;font-size:14px;font-family:inherit;resize:vertical;min-height:60px;outline:none">${esc(current)}</textarea>
    <div style="display:flex;gap:6px;margin-top:5px;justify-content:flex-end">
      <button onclick="cancelEditMsg()" style="background:rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;color:inherit">Annuler</button>
      <button onclick="saveEditMsg('${msgId}')" style="background:#22c55e;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;color:#fff;font-weight:700">Enregistrer</button>
    </div>`;
  if (textDiv) bub.replaceChild(wrap, textDiv);
  // hide msg-actions during edit
  bub.querySelector('.msg-actions')?.style && (bub.querySelector('.msg-actions').style.display = 'none');
  el('edit-inline-input')?.focus();
}
async function saveEditMsg(msgId) {
  const newText = el('edit-inline-input')?.value?.trim();
  if (!newText) return cancelEditMsg();
  if (newText.length > MSG_LIMIT) return toast(`❌ Max ${MSG_LIMIT} caractères`);
  await db.ref(`messages/${chatId}/${msgId}`).update({ text: newText, edited: true });
  editingMsgId = null;
}
function cancelEditMsg() {
  editingMsgId = null;
  const wrap = el('edit-inline-wrap');
  if (!wrap) return;
  const msgId = wrap.closest('.bubble')?.dataset?.msgId;
  if (!msgId) return wrap.remove();
  db.ref(`messages/${chatId}/${msgId}`).once('value').then(s => {
    if (s.exists()) updateMsgDOM(msgId, { ...s.val(), _key: msgId });
  });
}

/* ── DELETE ── */
async function deleteMsg(msgId) {
  if (!confirm('Supprimer ce message ?')) return;
  await db.ref(`messages/${chatId}/${msgId}`).update({ text: '', imageUrl: null, deleted: true, edited: false });
}
