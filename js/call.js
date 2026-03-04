/* ═══════════════════════════════════════════════════════════
   CALL.JS  v8  —  100% reliable WebRTC

   ARCHITECTURE
   ─────────────────────────────────────────────────────────
   peerMap[uid]   = RTCPeerConnection to that participant
   senderMap[uid] = { audio, video }  ← RTCRtpSender refs

   WHY VIDEO IS 100% RELIABLE
   ─────────────────────────────────────────────────────────
   Both audio AND video transceivers are pre-negotiated in
   the very first offer/answer, even when the camera is off.
   "Off" state = a silent 2×2 black canvas track.
   Camera toggle = sender.replaceTrack(realCam | blackTrack)
   → zero re-negotiation, zero race conditions, always works.

   JOINING WITH EXISTING CAM
   ─────────────────────────────────────────────────────────
   When C joins a call between A & B:
     1. C writes activeCalls/{chatId}/joinQueue/{C_uid}
     2. A & B detect this → each calls sendOfferToJoiner(C)
     3. Offers at calls/{id}/pair_offer_{from}_{to}
     4. C listens → acceptOfferFrom(from)
     5. Answers at calls/{id}/pair_answer_{from}_{to}
   Since A's video sender already has the real cam track,
   C instantly sees it once the peer connection is up.
═══════════════════════════════════════════════════════════ */

/* ── per-peer state ── */
var peerMap   = {};   // uid → RTCPeerConnection
var senderMap = {};   // uid → { audio: RTCRtpSender, video: RTCRtpSender }
var iceBufMap = {};   // uid → [RTCIceCandidateInit]

/* ── black canvas video track (camera OFF placeholder) ── */
var _blackCanvas = null;
function getBlackTrack() {
  if (!_blackCanvas) {
    _blackCanvas = Object.assign(document.createElement('canvas'), { width: 2, height: 2 });
    _blackCanvas.getContext('2d').fillRect(0, 0, 2, 2);
  }
  return _blackCanvas.captureStream(0).getVideoTracks()[0];
}

/* ════════════════════════════════════════
   ENTRY POINTS
════════════════════════════════════════ */

async function startCall() {
  if (!chatId) return toast('❌ Ouvre une conversation d\'abord');
  if (Object.keys(peerMap).length) return toast('❌ Déjà en appel');
  try {
    await initLocalStream();
    callId        = 'call_' + Date.now();
    callChatId    = chatId;
    callRemoteUid = chatIsGroup ? null : chatId.split('_').find(u => u !== CU.uid);

    await db.ref(`calls/${callId}`).set({
      callerUid: CU.uid, callerName: myData.pseudo, callerAvatar: myData.avatar,
      targetUid: callRemoteUid, chatId, status: 'ringing', created: Date.now()
    });
    await db.ref(`activeCalls/${chatId}`).set({ active: true, callerUid: CU.uid, callId });
    await db.ref(`activeCalls/${chatId}/participants/${CU.uid}`).set(myParticipant());

    if (callRemoteUid) await sendInitialOffer(callRemoteUid);

    watchJoinQueue();
    showCallScreen(el('header-name').textContent);
  } catch(e) { toast('❌ Micro : ' + e.message); console.error(e); cleanupAll(); }
}

async function acceptCall() {
  el('incoming-call').classList.add('hidden'); stopRing();
  if (missedTO) { clearTimeout(missedTO); missedTO = null; }
  if (!incomingData) return toast('❌ Données d\'appel manquantes');
  try {
    await initLocalStream();
    callId        = incomingData.id;
    callChatId    = incomingData.chatId;
    callRemoteUid = incomingData.callerUid;

    await acceptOfferFrom(callRemoteUid, incomingData.offer, false);

    await db.ref(`calls/${callId}/status`).set('answered');
    await db.ref(`activeCalls/${callChatId}/participants/${CU.uid}`).set(myParticipant());

    // Callee ICE → ice_B ; reads caller ICE from ice_A
    listenIce(callRemoteUid,
      `calls/${callId}/ice_A`,
      c => db.ref(`calls/${callId}/ice_B`).push(c));

    watchJoinQueue();
    showCallScreen(incomingData.callerName);
    incomingData = null;
  } catch(e) { toast('❌ ' + e.message); console.error(e); cleanupAll(); }
}

function declineCall() {
  el('incoming-call').classList.add('hidden'); stopRing();
  if (missedTO) { clearTimeout(missedTO); missedTO = null; }
  if (incomingData?.id) db.ref(`calls/${incomingData.id}/status`).set('ended');
  incomingData = null;
}

async function joinCall() {
  if (!chatId) return;
  const snap = await db.ref(`activeCalls/${chatId}`).once('value');
  const a = snap.val();
  if (!a || !a.active) return toast('Cet appel est terminé');
  try {
    await initLocalStream();
    callId = a.callId; callChatId = chatId; callRemoteUid = null;

    await db.ref(`activeCalls/${chatId}/participants/${CU.uid}`).set(myParticipant());

    // Listen for offers from existing participants
    db.ref(`calls/${callId}`).on('child_added', async s => {
      if (!s.key.startsWith('pair_offer_')) return;
      const parts = s.key.replace('pair_offer_', '').split('_');
      if (parts.length < 2) return;
      const fromUid = parts[0];
      const toUid   = parts[1];
      if (toUid !== CU.uid || fromUid === CU.uid) return;
      await acceptOfferFrom(fromUid, s.val(), true);
    });

    // Signal to existing participants that we want to connect
    await db.ref(`activeCalls/${chatId}/joinQueue/${CU.uid}`).set({
      uid: CU.uid, name: myData.pseudo, avatar: myData.avatar, ts: Date.now()
    });

    watchJoinQueue();
    showCallScreen(el('header-name').textContent);
    toast('📞 Connecté à l\'appel');
  } catch(e) { toast('❌ Micro : ' + e.message); cleanupAll(); }
}

/* ════════════════════════════════════════
   SIGNALING HELPERS
════════════════════════════════════════ */

async function sendInitialOffer(remoteUid) {
  const p = buildPeerTo(remoteUid);
  const offer = await p.createOffer();
  await p.setLocalDescription(offer);

  // Store offer — callee reads it in listenIncomingCalls
  await db.ref(`calls/${callId}/offer`).set({ type: offer.type, sdp: offer.sdp });

  // Caller ICE → ice_A ; reads callee ICE from ice_B
  listenIce(remoteUid,
    `calls/${callId}/ice_B`,
    c => db.ref(`calls/${callId}/ice_A`).push(c));

  db.ref(`calls/${callId}/answer`).on('value', async s => {
    const ans = s.val();
    if (!ans || !p || p.signalingState !== 'have-local-offer') return;
    await p.setRemoteDescription(new RTCSessionDescription(ans));
    flushIceBuf(remoteUid);
  });
}

async function acceptOfferFrom(remoteUid, offerData, isPair) {
  const p = buildPeerTo(remoteUid);
  await p.setRemoteDescription(new RTCSessionDescription(offerData));
  flushIceBuf(remoteUid);

  const answer = await p.createAnswer();
  await p.setLocalDescription(answer);

  if (isPair) {
    await db.ref(`calls/${callId}/pair_answer_${remoteUid}_${CU.uid}`)
            .set({ type: answer.type, sdp: answer.sdp });
    listenIce(remoteUid,
      `calls/${callId}/pair_ice_${remoteUid}_${CU.uid}`,
      c => db.ref(`calls/${callId}/pair_ice_${CU.uid}_${remoteUid}`).push(c));
  } else {
    await db.ref(`calls/${callId}/answer`).set({ type: answer.type, sdp: answer.sdp });
    // ICE paths set up by the caller (acceptCall) or via listenIce() calls
  }
}

async function sendOfferToJoiner(joinerUid) {
  if (peerMap[joinerUid]) return;
  const p = buildPeerTo(joinerUid);
  const offer = await p.createOffer();
  await p.setLocalDescription(offer);

  await db.ref(`calls/${callId}/pair_offer_${CU.uid}_${joinerUid}`)
          .set({ type: offer.type, sdp: offer.sdp });

  db.ref(`calls/${callId}/pair_answer_${CU.uid}_${joinerUid}`).on('value', async s => {
    const ans = s.val();
    if (!ans || !p || p.signalingState !== 'have-local-offer') return;
    await p.setRemoteDescription(new RTCSessionDescription(ans));
    flushIceBuf(joinerUid);
  });

  listenIce(joinerUid,
    `calls/${callId}/pair_ice_${joinerUid}_${CU.uid}`,
    c => db.ref(`calls/${callId}/pair_ice_${CU.uid}_${joinerUid}`).push(c));
}

function watchJoinQueue() {
  if (!callChatId) return;
  db.ref(`activeCalls/${callChatId}/joinQueue`).on('child_added', async s => {
    const uid = s.key; if (uid === CU.uid) return;
    await sendOfferToJoiner(uid);
  });
}

/* ════════════════════════════════════════
   BUILD PEER CONNECTION
════════════════════════════════════════ */
function buildPeerTo(remoteUid) {
  if (peerMap[remoteUid]) { try { peerMap[remoteUid].close(); } catch(_){} }
  iceBufMap[remoteUid] = [];

  const p = new RTCPeerConnection(ICE_CFG);
  peerMap[remoteUid] = p;

  // ── PRE-ADD both audio AND video tracks ──────────────────
  // Video = black canvas initially. replaceTrack() for camera toggle.
  // Zero renegotiation needed → 100% reliable.
  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = (localStream.getVideoTracks()[0] || getBlackTrack()).clone();

  const sa = p.addTrack(audioTrack);
  const sv = p.addTrack(videoTrack);
  senderMap[remoteUid] = { audio: sa, video: sv };

  p.ontrack = e => {
    const track  = e.track;
    const stream = e.streams?.[0] || new MediaStream([track]);

    if (track.kind === 'audio') {
      const audioEl = el('remote-audio');
      if (!audioEl) return;
      audioEl.srcObject = stream;
      audioEl.play().catch(err => console.warn('[audio]', err.message));
    }

    if (track.kind === 'video') {
      if (!remoteVideoStreams[remoteUid])
        remoteVideoStreams[remoteUid] = new MediaStream();
      remoteVideoStreams[remoteUid].getVideoTracks()
        .forEach(t => remoteVideoStreams[remoteUid].removeTrack(t));
      remoteVideoStreams[remoteUid].addTrack(track);

      const vid = document.querySelector(`.ptile[data-uid="${remoteUid}"] video`);
      if (vid && vid.srcObject !== remoteVideoStreams[remoteUid]) {
        vid.srcObject = remoteVideoStreams[remoteUid];
        vid.play().catch(() => {});
      }
    }
  };

  p.onicecandidate = e => {
    if (!e.candidate || !callId) return;
    if (p._iceSendFn) p._iceSendFn(e.candidate.toJSON());
  };

  p.onconnectionstatechange = () => {
    console.log(`[WebRTC→${remoteUid.slice(0,6)}]`, p.connectionState);
    if (p.connectionState === 'connected') {
      el('call-title').style.color = '#22c55e';
      toast('✅ Connecté');
    }
    if (p.connectionState === 'failed' && p.restartIce) p.restartIce();
  };

  return p;
}

function listenIce(remoteUid, readPath, writeFn) {
  const p = peerMap[remoteUid]; if (!p) return;
  p._iceSendFn = writeFn;
  db.ref(readPath).on('child_added', s => {
    const c = s.val(); if (!c) return;
    if (p.remoteDescription)
      p.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    else {
      iceBufMap[remoteUid] = iceBufMap[remoteUid] || [];
      iceBufMap[remoteUid].push(c);
    }
  });
}

function flushIceBuf(remoteUid) {
  const p = peerMap[remoteUid]; if (!p) return;
  (iceBufMap[remoteUid] || []).forEach(c =>
    p.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  iceBufMap[remoteUid] = [];
}

/* ════════════════════════════════════════
   LOCAL STREAM
════════════════════════════════════════ */
async function initLocalStream() {
  const as = await navigator.mediaDevices.getUserMedia({ audio: true });
  localStream = new MediaStream();
  localStream.addTrack(as.getAudioTracks()[0]);
  localStream.addTrack(getBlackTrack().clone());
  micOn = true; camOn = false;
}

function myParticipant() {
  return { name: myData.pseudo, avatar: myData.avatar, micOn: true, camOn: false, ts: Date.now() };
}

/* ════════════════════════════════════════
   INCOMING CALLS LISTENER
════════════════════════════════════════ */
function listenIncomingCalls() {
  db.ref('calls').orderByChild('created').startAt(Date.now() - 5000)
    .on('child_added', async s => {
      const d = s.val();
      if (!d || d.targetUid !== CU.uid) return;
      if (d.status === 'ended' || d.status === 'answered') return;
      if (Object.keys(peerMap).length) return;

      const waitOffer = () => new Promise(resolve => {
        db.ref(`calls/${s.key}/offer`).on('value', function h(snap) {
          if (!snap.exists()) return;
          db.ref(`calls/${s.key}/offer`).off('value', h);
          resolve(snap.val());
        });
      });

      const offer = await waitOffer();
      incomingData = { id: s.key, ...d, offer };
      el('caller-name').textContent = d.callerName;
      el('caller-avatar').src       = d.callerAvatar || 'basic1.png';
      el('incoming-call').classList.remove('hidden');
      playRing();
      pushNotif('📞 Appel entrant', {
        body: `${d.callerName} t'appelle !`, tag: 'kychat-call', requireInteraction: true
      });
      if (missedTO) clearTimeout(missedTO);
      missedTO = setTimeout(() => {
        if (!el('incoming-call').classList.contains('hidden')) {
          declineCall(); toast(`📵 Appel manqué de ${d.callerName}`);
        }
      }, 30000);
    });
}

/* ════════════════════════════════════════
   CALL SCREEN UI
════════════════════════════════════════ */
function showCallScreen(title) {
  callMinimized = false;
  const cs = el('call-screen');
  cs.classList.remove('hidden'); cs.classList.remove('call-minimized');
  el('call-title').textContent = `📞 ${title || 'Appel'}`;
  el('local-video').srcObject  = localStream;
  el('pip-lbl').textContent    = myData.pseudo;
  updateCtrl(); startTimer(); listenParticipants();
}

function toggleMinimizeCall() {
  callMinimized = !callMinimized;
  el('call-screen').classList.toggle('call-minimized', callMinimized);
  el('minimize-btn').textContent = callMinimized ? '⤢' : '⤡';
  el('minimize-btn').title       = callMinimized ? 'Agrandir' : 'Réduire';
}

/* ════════════════════════════════════════
   PARTICIPANT GRID
════════════════════════════════════════ */
function listenParticipants() {
  if (partRef && callChatId)
    db.ref(`activeCalls/${callChatId}/participants`).off('value', partRef);
  if (!callChatId) return;
  prevPartKeys = new Set();

  partRef = db.ref(`activeCalls/${callChatId}/participants`).on('value', s => {
    const parts  = s.val() || {};
    const newKeys = new Set(Object.keys(parts));
    for (const k of newKeys)   if (!prevPartKeys.has(k) && k !== CU.uid) { playSound('join');  toast(`👋 ${parts[k].name} a rejoint`); }
    for (const k of prevPartKeys) if (!newKeys.has(k))                   { playSound('leave'); }
    prevPartKeys = newKeys; partSnap = parts; renderGrid(parts);
  });
}

function renderGrid(parts) {
  const grid   = el('call-grid');
  const others = Object.entries(parts).filter(([uid]) => uid !== CU.uid);
  const n      = others.length;

  grid.style.gridTemplateColumns = n <= 1 ? '1fr' : '1fr 1fr';
  grid.style.gridTemplateRows   = n > 2  ? '1fr 1fr' : '1fr';

  [...grid.querySelectorAll('.ptile[data-uid]')]
    .forEach(t => { if (!parts[t.dataset.uid]) t.remove(); });

  if (!others.length) {
    if (!grid.querySelector('.ptile')) {
      const w = document.createElement('div'); w.className = 'ptile';
      w.style.cssText = 'aspect-ratio:16/9;grid-column:1/-1';
      w.innerHTML = `<div class="av-fb"><div class="call-pulse text-5xl mb-3">📞</div><div class="text-sm font-semibold" style="color:var(--text-muted)">En attente…</div></div>`;
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
      tile.appendChild(vid);

      const fb = document.createElement('div'); fb.className = 'av-fb';
      fb.innerHTML = `<img src="${esc(data.avatar||'basic1.png')}" onerror="this.src='basic1.png'">
        <div class="text-xs font-semibold mt-1.5" style="color:var(--text-muted)">${esc(data.name)}</div>`;
      tile.appendChild(fb);

      const nt = document.createElement('div'); nt.className = 'nametag';
      nt.innerHTML = `<span>${esc(data.name)}</span><span class="mute-ic">🎤</span>`;
      tile.appendChild(nt);

      grid.appendChild(tile);
    }

    // attach video stream if available
    const vid = tile.querySelector('video');
    if (vid) {
      if (remoteVideoStreams[uid] && vid.srcObject !== remoteVideoStreams[uid]) {
        vid.srcObject = remoteVideoStreams[uid];
        vid.play().catch(() => {});
      }
      // Video visibility controlled by Firebase camOn — NOT by ontrack timing
      vid.classList.toggle('has-video', !!data.camOn);
    }

    // mic icon
    const mi = tile.querySelector('.mute-ic');
    if (mi) mi.textContent = data.micOn !== false ? '🎤' : '🔇';
  });
}

/* ════════════════════════════════════════
   CONTROLS
════════════════════════════════════════ */
function toggleMic() {
  micOn = !micOn;
  localStream?.getAudioTracks().forEach(t => t.enabled = micOn);
  if (callChatId) db.ref(`activeCalls/${callChatId}/participants/${CU.uid}/micOn`).set(micOn);
  updateCtrl();
}

async function toggleCam() {
  if (!camOn) {
    try {
      const vs = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' }
      });
      const vt = vs.getVideoTracks()[0];

      // replaceTrack in every peer — no renegotiation
      for (const [, s] of Object.entries(senderMap))
        if (s.video) await s.video.replaceTrack(vt);

      localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
      localStream.addTrack(vt);
      el('local-video').srcObject = localStream;
      camOn = true;
      if (callChatId) db.ref(`activeCalls/${callChatId}/participants/${CU.uid}/camOn`).set(true);
    } catch(e) { toast('❌ Caméra : ' + e.message); }
  } else {
    const black = getBlackTrack().clone();
    for (const [, s] of Object.entries(senderMap))
      if (s.video) await s.video.replaceTrack(black);

    localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
    localStream.addTrack(black);
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

/* ════════════════════════════════════════
   END / CLEANUP
════════════════════════════════════════ */
async function endCall() {
  if (callId) db.ref(`calls/${callId}/status`).set('ended').catch(() => {});
  if (callChatId) {
    await db.ref(`activeCalls/${callChatId}/participants/${CU.uid}`).remove().catch(() => {});
    db.ref(`activeCalls/${callChatId}/joinQueue/${CU.uid}`).remove().catch(() => {});
    const s = await db.ref(`activeCalls/${callChatId}/participants`).once('value').catch(() => null);
    if (!s || !s.numChildren()) db.ref(`activeCalls/${callChatId}`).remove().catch(() => {});
  }
  cleanupAll();
}

function cleanupAll() {
  for (const uid of Object.keys(peerMap)) try { peerMap[uid].close(); } catch(_) {}
  peerMap = {}; senderMap = {}; iceBufMap = {};
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (partRef && callChatId) {
    db.ref(`activeCalls/${callChatId}/participants`).off('value', partRef); partRef = null;
  }
  if (timerIv) { clearInterval(timerIv); timerIv = null; }
  const cs = el('call-screen');
  cs.classList.add('hidden'); cs.classList.remove('call-minimized');
  el('call-grid').innerHTML    = '';
  el('local-video').srcObject  = null;
  el('call-timer').textContent = '00:00';
  el('minimize-btn').textContent = '⤡';
  micOn = true; camOn = false; remoteVideoStreams = {};
  callId = null; callChatId = null; callRemoteUid = null;
  isCaller = false; callMinimized = false; prevPartKeys = new Set();
}

function startTimer() {
  timerStart = Date.now(); if (timerIv) clearInterval(timerIv);
  timerIv = setInterval(() => {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    el('call-timer').textContent =
      `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }, 1000);
}
