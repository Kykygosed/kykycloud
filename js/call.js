/* ═══════════════════════════════════════════════════
   CALL.JS  —  WebRTC v7
   
   KEY ARCHITECTURE:
   • isCaller flag set BEFORE buildPeer() — never computed inside ontrack
   • callRemoteUid stored at call start — used by ontrack for video routing
   • ICE: caller writes ice_A / reads ice_B, callee writes ice_B / reads ice_A
   • remote-audio element in DOM always gets the audio stream → srcObject + play()
   • Remote video stream stored in remoteVideoStreams[callRemoteUid], attached to
     tile both when tile is created AND when ontrack fires (race-condition safe)
   • Minimize: call screen shrinks to a floating PiP bar, full UI restored on click
═══════════════════════════════════════════════════ */

/* ── CALLER: start ── */
async function startCall() {
  if (!chatId) return toast('❌ Ouvre une conversation d\'abord');
  if (pc)      return toast('❌ Déjà en appel');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micOn = true; camOn = false;
    callId        = 'call_' + Date.now();
    callChatId    = chatId;
    isCaller      = true;
    callRemoteUid = chatIsGroup ? null : chatId.split('_').find(u => u !== CU.uid);

    pc = buildPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await db.ref(`calls/${callId}`).set({
      callerUid: CU.uid, callerName: myData.pseudo, callerAvatar: myData.avatar,
      targetUid: callRemoteUid, chatId, status: 'ringing',
      offer: { type: offer.type, sdp: offer.sdp }, created: Date.now()
    });
    await db.ref(`activeCalls/${chatId}`).set({ active: true, callerUid: CU.uid, callId });
    await db.ref(`activeCalls/${chatId}/participants/${CU.uid}`).set({
      name: myData.pseudo, avatar: myData.avatar, micOn: true, camOn: false, ts: Date.now()
    });

    // caller reads callee answer
    db.ref(`calls/${callId}/answer`).on('value', async s => {
      const a = s.val();
      if (a && pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(a));
        remoteReady = true; flushIce();
        listenReoffer(); // start listening for cam renegotiation
      }
    });
    // caller reads callee ICE (ice_B)
    db.ref(`calls/${callId}/ice_B`).on('child_added', s => { if (s.val()) addIceSafe(s.val()); });

    showCallScreen(el('header-name').textContent);
  } catch(e) { toast('❌ Micro : ' + e.message); cleanupPeer(); }
}

/* ── LISTEN for incoming calls ── */
function listenIncomingCalls() {
  db.ref('calls').on('child_added', async s => {
    const d = s.val();
    if (!d || d.targetUid !== CU.uid || d.status === 'ended' || d.status === 'answered') return;
    if (pc) return;
    incomingData = { id: s.key, ...d };
    el('caller-name').textContent  = d.callerName;
    el('caller-avatar').src        = d.callerAvatar || 'basic1.png';
    el('incoming-call').classList.remove('hidden');
    playRing();
    pushNotif('📞 Appel entrant', { body: `${d.callerName} t'appelle !`, tag: 'kychat-call', requireInteraction: true });
    if (missedTO) clearTimeout(missedTO);
    missedTO = setTimeout(() => {
      if (!el('incoming-call').classList.contains('hidden')) {
        declineCall();
        pushNotif('📵 Appel manqué', { body: `Appel manqué de ${d.callerName}`, tag: 'kychat-missed' });
        toast(`📵 Appel manqué de ${d.callerName}`);
      }
    }, 30000);
  });
}

/* ── CALLEE: accept ── */
async function acceptCall() {
  el('incoming-call').classList.add('hidden'); stopRing();
  if (missedTO) { clearTimeout(missedTO); missedTO = null; }
  if (!incomingData) return toast('❌ Données d\'appel manquantes');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micOn = true; camOn = false;
    callId        = incomingData.id;
    callChatId    = incomingData.chatId;
    isCaller      = false;
    callRemoteUid = incomingData.callerUid; // explicit — never derived from chatId

    pc = buildPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(incomingData.offer));
    remoteReady = true; flushIce();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await db.ref(`calls/${callId}/answer`).set({ type: answer.type, sdp: answer.sdp });
    await db.ref(`calls/${callId}/status`).set('answered');
    await db.ref(`activeCalls/${callChatId}/participants/${CU.uid}`).set({
      name: myData.pseudo, avatar: myData.avatar, micOn: true, camOn: false, ts: Date.now()
    });

    // callee reads caller ICE (ice_A)
    db.ref(`calls/${callId}/ice_A`).on('child_added', s => { if (s.val()) addIceSafe(s.val()); });
    listenReoffer();

    showCallScreen(incomingData.callerName);
    incomingData = null;
  } catch(e) { toast('❌ ' + e.message); cleanupPeer(); }
}

/* ── CALLEE: decline ── */
function declineCall() {
  el('incoming-call').classList.add('hidden'); stopRing();
  if (missedTO) { clearTimeout(missedTO); missedTO = null; }
  if (incomingData?.id) db.ref(`calls/${incomingData.id}/status`).set('ended');
  incomingData = null;
}

/* ── JOIN ongoing call ── */
async function joinCall() {
  if (!chatId) return;
  const a = (await db.ref(`activeCalls/${chatId}`).once('value')).val();
  if (!a || !a.active) return toast('Cet appel est terminé');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micOn = true; camOn = false; callId = a.callId; callChatId = chatId; callRemoteUid = null;
    await db.ref(`activeCalls/${chatId}/participants/${CU.uid}`).set({
      name: myData.pseudo, avatar: myData.avatar, micOn: true, camOn: false, ts: Date.now()
    });
    showCallScreen(el('header-name').textContent);
    toast('📞 Connecté à l\'appel');
  } catch(e) { toast('❌ Micro : ' + e.message); }
}

/* ── BUILD PEER ── */
function buildPeer() {
  remoteReady = false; iceBuf = []; remoteVideoStreams = {};
  const p = new RTCPeerConnection(ICE_CFG);

  /* ─── ontrack ───────────────────────────────────────
     AUDIO: always pipe to <audio id="remote-audio">.
     This element is always in the DOM, has autoplay,
     and is the ONLY reliable fix for "on s'entend pas".
     
     VIDEO: store stream by callRemoteUid and attach to
     tile. Works whether tile exists yet or not.
  ─────────────────────────────────────────────────── */
  p.ontrack = e => {
    const track  = e.track;
    // Prefer the stream from the event if available
    const stream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([track]);

    if (track.kind === 'audio') {
      const audioEl = el('remote-audio');
      if (!audioEl) return;
      // Always reassign so play() is called fresh
      audioEl.srcObject = null;
      audioEl.srcObject = stream;
      const playPromise = audioEl.play();
      if (playPromise !== undefined)
        playPromise.catch(err => console.warn('[remote-audio] play blocked:', err.message));
    }

    if (track.kind === 'video' && callRemoteUid) {
      if (!remoteVideoStreams[callRemoteUid])
        remoteVideoStreams[callRemoteUid] = new MediaStream();
      // Remove stale video tracks first
      remoteVideoStreams[callRemoteUid].getVideoTracks()
        .forEach(t => remoteVideoStreams[callRemoteUid].removeTrack(t));
      remoteVideoStreams[callRemoteUid].addTrack(track);

      // Attach to tile if it exists already
      const vid = document.querySelector(`.ptile[data-uid="${callRemoteUid}"] video`);
      if (vid) {
        vid.srcObject = remoteVideoStreams[callRemoteUid];
        vid.classList.add('has-video');
        vid.play().catch(() => {});
      }
    }
  };

  // ICE: caller → ice_A, callee → ice_B
  p.onicecandidate = e => {
    if (!e.candidate || !callId) return;
    db.ref(`calls/${callId}/${isCaller ? 'ice_A' : 'ice_B'}`).push(e.candidate.toJSON());
  };

  p.onconnectionstatechange = () => {
    console.log('[WebRTC] connectionState:', p.connectionState);
    if (p.connectionState === 'connected') {
      el('call-title').style.color = '#22c55e';
      toast('✅ Appel connecté');
    }
    if (p.connectionState === 'failed') toast('⚠️ Connexion perdue');
  };

  p.onicegatheringstatechange = () => {
    console.log('[WebRTC] iceGatheringState:', p.iceGatheringState);
  };

  p.onsignalingstatechange = () => {
    console.log('[WebRTC] signalingState:', p.signalingState);
  };

  return p;
}

function addIceSafe(c) {
  if (pc && remoteReady) pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('[ICE]', e.message));
  else iceBuf.push(c);
}
function flushIce() {
  iceBuf.forEach(c => pc && pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  iceBuf = [];
}

/* ── RENEGOTIATION (cam toggle mid-call) ── */
async function renegotiate() {
  if (!pc || !callId) return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const path = isCaller ? `calls/${callId}/reoffer_caller` : `calls/${callId}/reoffer_callee`;
    await db.ref(path).set({ type: offer.type, sdp: offer.sdp });
    const ansPath = isCaller ? `calls/${callId}/reanswer_callee` : `calls/${callId}/reanswer_caller`;
    db.ref(ansPath).once('value', async s => {
      const a = s.val();
      if (a && pc) await pc.setRemoteDescription(new RTCSessionDescription(a)).catch(() => {});
    });
  } catch(_) {}
}

function listenReoffer() {
  if (!callId || !pc) return;
  const roPath = isCaller ? `calls/${callId}/reoffer_callee` : `calls/${callId}/reoffer_caller`;
  const raPath = isCaller ? `calls/${callId}/reanswer_caller` : `calls/${callId}/reanswer_callee`;
  db.ref(roPath).on('value', async s => {
    const d = s.val(); if (!d || !pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(d));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await db.ref(raPath).set({ type: ans.type, sdp: ans.sdp });
    } catch(_) {}
  });
}

/* ── CALL SCREEN UI ── */
function showCallScreen(title) {
  callMinimized = false;
  const cs = el('call-screen');
  cs.classList.remove('hidden');
  cs.classList.remove('call-minimized');
  el('call-title').textContent = `📞 ${title || 'Appel'}`;
  el('local-video').srcObject = localStream;
  el('pip-lbl').textContent = myData.pseudo;
  updateCtrl(); startTimer(); listenParticipants();
}

function toggleMinimizeCall() {
  callMinimized = !callMinimized;
  const cs = el('call-screen');
  if (callMinimized) {
    cs.classList.add('call-minimized');
    el('minimize-btn').textContent = '⤢';
    el('minimize-btn').title = 'Agrandir';
  } else {
    cs.classList.remove('call-minimized');
    el('minimize-btn').textContent = '⤡';
    el('minimize-btn').title = 'Réduire';
  }
}

/* ── PARTICIPANT GRID ── */
function listenParticipants() {
  if (partRef && callChatId) db.ref(`activeCalls/${callChatId}/participants`).off('value', partRef);
  if (!callChatId) return;
  prevPartKeys = new Set();
  partRef = db.ref(`activeCalls/${callChatId}/participants`).on('value', s => {
    const parts = s.val() || {};
    const newKeys = new Set(Object.keys(parts));

    for (const k of newKeys)    if (!prevPartKeys.has(k) && k !== CU.uid) { playSound('join');  toast(`👋 ${parts[k].name} a rejoint`); }
    for (const k of prevPartKeys) if (!newKeys.has(k))                    { playSound('leave'); }

    prevPartKeys = newKeys; partSnap = parts; renderGrid(parts);
  });
}

function renderGrid(parts) {
  const grid = el('call-grid');
  const others = Object.entries(parts).filter(([uid]) => uid !== CU.uid);
  const n = others.length;

  grid.style.gridTemplateColumns = n <= 1 ? '1fr' : '1fr 1fr';
  grid.style.gridTemplateRows   = n > 2  ? '1fr 1fr' : '1fr';

  // remove tiles for users who left
  [...grid.querySelectorAll('.ptile[data-uid]')].forEach(t => { if (!parts[t.dataset.uid]) t.remove(); });

  if (!others.length) {
    if (!grid.querySelector('.ptile')) {
      const w = document.createElement('div'); w.className = 'ptile';
      w.style.cssText = 'aspect-ratio:16/9;grid-column:1/-1';
      w.innerHTML = `<div class="av-fb"><div class="call-pulse text-5xl mb-3">📞</div><div class="text-sm font-semibold" style="color:var(--text-muted)">En attente d'un participant…</div></div>`;
      grid.appendChild(w);
    }
    return;
  }
  grid.querySelector('.ptile:not([data-uid])')?.remove();

  others.forEach(([uid, data]) => {
    let tile = grid.querySelector(`.ptile[data-uid="${uid}"]`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'ptile'; tile.dataset.uid = uid; tile.style.aspectRatio = '4/3';

      const vid = document.createElement('video');
      vid.autoplay = true; vid.playsInline = true;
      // attach stream if already received by ontrack
      if (remoteVideoStreams[uid]) {
        vid.srcObject = remoteVideoStreams[uid]; vid.classList.add('has-video');
      }
      tile.appendChild(vid);

      const fb = document.createElement('div'); fb.className = 'av-fb';
      fb.innerHTML = `<img src="${esc(data.avatar || 'basic1.png')}" onerror="this.src='basic1.png'"><div class="text-xs font-semibold mt-1.5" style="color:var(--text-muted)">${esc(data.name)}</div>`;
      tile.appendChild(fb);

      const nt = document.createElement('div'); nt.className = 'nametag';
      nt.innerHTML = `<span>${esc(data.name)}</span><span class="mute-ic">${data.micOn ? '🎤' : '🔇'}</span>`;
      tile.appendChild(nt);

      grid.appendChild(tile);
    } else {
      // update mute icon
      const mi = tile.querySelector('.mute-ic'); if (mi) mi.textContent = data.micOn ? '🎤' : '🔇';
      // attach video if track arrived after tile creation
      const vid = tile.querySelector('video');
      if (vid && remoteVideoStreams[uid] && vid.srcObject !== remoteVideoStreams[uid]) {
        vid.srcObject = remoteVideoStreams[uid]; vid.classList.add('has-video'); vid.play().catch(() => {});
      }
    }
  });
}

/* ── CONTROLS ── */
function toggleMic() {
  micOn = !micOn;
  localStream?.getAudioTracks().forEach(t => t.enabled = micOn);
  if (callChatId) db.ref(`activeCalls/${callChatId}/participants/${CU.uid}/micOn`).set(micOn);
  updateCtrl();
}

async function toggleCam() {
  if (!camOn) {
    try {
      const vs  = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' } });
      const vt  = vs.getVideoTracks()[0];
      localStream.addTrack(vt);
      if (pc) { pc.addTrack(vt, localStream); await renegotiate(); }
      el('local-video').srcObject = null;
      el('local-video').srcObject = localStream;
      camOn = true;
      if (callChatId) db.ref(`activeCalls/${callChatId}/participants/${CU.uid}/camOn`).set(true);
    } catch(e) { toast('❌ Caméra : ' + e.message); }
  } else {
    localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
    el('local-video').srcObject = null;
    el('local-video').srcObject = localStream;
    camOn = false;
    if (callChatId) db.ref(`activeCalls/${callChatId}/participants/${CU.uid}/camOn`).set(false);
  }
  updateCtrl();
}

function updateCtrl() {
  const mic = el('ctl-mic'), cam = el('ctl-cam');
  mic.querySelector('.ico').textContent = micOn ? '🎤' : '🔇';
  mic.classList.toggle('ctl-muted', !micOn);
  cam.querySelector('.ico').textContent = camOn ? '📷' : '📵';
  cam.classList.toggle('ctl-on', camOn);
}

async function endCall() {
  if (callId) db.ref(`calls/${callId}/status`).set('ended').catch(() => {});
  if (callChatId) {
    await db.ref(`activeCalls/${callChatId}/participants/${CU.uid}`).remove().catch(() => {});
    const s = await db.ref(`activeCalls/${callChatId}/participants`).once('value').catch(() => null);
    if (!s || !s.numChildren()) db.ref(`activeCalls/${callChatId}`).remove().catch(() => {});
  }
  cleanupPeer(); callId = null; callChatId = null; callRemoteUid = null;
}

function cleanupPeer() {
  if (partRef && callChatId) { db.ref(`activeCalls/${callChatId}/participants`).off('value', partRef); partRef = null; }
  if (pc)          { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (timerIv)     { clearInterval(timerIv); timerIv = null; }
  const cs = el('call-screen');
  cs.classList.add('hidden'); cs.classList.remove('call-minimized');
  el('call-grid').innerHTML = '';
  el('local-video').srcObject = null;
  el('call-timer').textContent = '00:00';
  el('minimize-btn').textContent = '⤡';
  micOn = true; camOn = false; remoteReady = false; iceBuf = [];
  remoteVideoStreams = {}; isCaller = false; callMinimized = false; prevPartKeys = new Set();
}

function startTimer() {
  timerStart = Date.now(); if (timerIv) clearInterval(timerIv);
  timerIv = setInterval(() => {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    el('call-timer').textContent = `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }, 1000);
}
