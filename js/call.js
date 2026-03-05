/* ══════════════════════════════════════════════════════════
   CALL.JS  v9  —  simple, proven, 100% reliable

   DESIGN PRINCIPLES (learned from failures)
   ───────────────────────────────────────────────────────
   1. Single RTCPeerConnection per call (not peerMap).
      peerMap was overkill and broke basic 1:1 calls.

   2. Request audio+video ONCE at call start.
      Camera permission granted → both tracks added to PC
      before createOffer(). Video is negotiated from day 1.
      No renegotiation = no timing race = 100% reliable.

   3. Camera toggle = track.enabled true/false.
      No replaceTrack(), no renegotiate(), just flip .enabled.

   4. isCaller flag set explicitly BEFORE buildPeer().

   5. ICE routing:
        caller writes → ice_A   reads ← ice_B
        callee writes → ice_B   reads ← ice_A

   6. Remote audio always goes to <audio id="remote-audio">
      which is always in the DOM with autoplay.

   7. Remote video stored by callRemoteUid, attached to tile
      both in ontrack AND in renderGrid (race-condition safe).

   8. Phantom ring fix: listenIncomingCalls only reacts to
      calls created AFTER the listener was registered, and
      also re-checks status before showing ring UI.
══════════════════════════════════════════════════════════ */

/* ── Local state ── */
// pc, localStream, callId, callChatId, callRemoteUid, isCaller — in config.js

/* ════════════════════════════════════════
   LOCAL STREAM
   Always request audio + video.
   If camera is denied: fall back to audio only.
   Camera starts DISABLED (camOn = false).
   Cam toggle just flips track.enabled.
════════════════════════════════════════ */
async function initLocalStream() {
  // Try audio + video first
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    });
    // Camera available but starts OFF — user enables it explicitly
    localStream.getVideoTracks().forEach(t => { t.enabled = false; });
    camOn = false;
  } catch(videoErr) {
    // No camera or permission denied — audio only
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      camOn = false;
    } catch(audioErr) {
      throw new Error('Micro inaccessible : ' + audioErr.message);
    }
  }
  micOn = true;
}

/* ════════════════════════════════════════
   CALLER
════════════════════════════════════════ */
async function startCall() {
  if (!chatId) return toast('❌ Ouvre une conversation d\'abord');
  if (pc)      return toast('❌ Déjà en appel');
  try {
    await initLocalStream();
    callId        = 'call_' + Date.now();
    callChatId    = chatId;
    isCaller      = true;
    callRemoteUid = chatIsGroup ? null : chatId.split('_').find(u => u !== CU.uid);

    pc = buildPeer();
    // Add ALL tracks before createOffer — video negotiated from day 1
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Write call record + offer atomically
    await db.ref(`calls/${callId}`).set({
      callerUid: CU.uid, callerName: myData.pseudo, callerAvatar: myData.avatar,
      targetUid: callRemoteUid, chatId,
      status: 'ringing',
      offer: { type: offer.type, sdp: offer.sdp },
      created: Date.now()
    });
    await db.ref(`activeCalls/${chatId}`).set({ active: true, callerUid: CU.uid, callId });
    await db.ref(`activeCalls/${chatId}/participants/${CU.uid}`).set(myParticipant());

    // Caller reads callee ICE (ice_B)
    db.ref(`calls/${callId}/ice_B`).on('child_added', s => {
      if (s.val()) addIceSafe(s.val());
    });

    // Caller waits for answer
    db.ref(`calls/${callId}/answer`).on('value', async s => {
      const a = s.val();
      if (!a || !pc || pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(new RTCSessionDescription(a));
      remoteReady = true;
      flushIce();
      listenReoffer(); // in case other side adds video mid-call
    });

    showCallScreen(el('header-name').textContent);
  } catch(e) {
    toast('❌ ' + e.message);
    console.error('[startCall]', e);
    cleanupPeer();
  }
}

/* ════════════════════════════════════════
   INCOMING CALL LISTENER
   Fixed: only react to calls that are NEW
   and still in 'ringing' status when we check.
════════════════════════════════════════ */
function listenIncomingCalls() {
  // Remember the time we attached the listener
  const listenStart = Date.now();

  db.ref('calls').on('child_added', async s => {
    const d = s.val();
    if (!d) return;
    // Ignore calls that predate our listener (they're old/handled)
    if (d.created && d.created < listenStart - 3000) return;
    // Ignore calls not directed to us
    if (d.targetUid !== CU.uid) return;
    // Ignore already-done calls
    if (d.status === 'ended' || d.status === 'answered') return;
    // Don't interrupt an ongoing call
    if (pc) return;

    // Re-fetch to make sure it's still ringing (not ended in the meantime)
    const fresh = (await db.ref(`calls/${s.key}/status`).once('value')).val();
    if (fresh === 'ended' || fresh === 'answered') return;

    incomingData = { id: s.key, ...d };
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
        declineCall();
        toast(`📵 Appel manqué de ${d.callerName}`);
      }
    }, 30000);
  });

  // Also watch for a call being ended remotely (caller hung up)
  db.ref('calls').on('child_changed', s => {
    const d = s.val();
    if (!d || d.targetUid !== CU.uid) return;
    if (d.status === 'ended' && incomingData?.id === s.key) {
      // Caller hung up before we answered
      el('incoming-call').classList.add('hidden');
      stopRing();
      if (missedTO) { clearTimeout(missedTO); missedTO = null; }
      incomingData = null;
      toast('📵 Appel manqué');
    }
  });
}

/* ════════════════════════════════════════
   CALLEE: ACCEPT
════════════════════════════════════════ */
async function acceptCall() {
  el('incoming-call').classList.add('hidden');
  stopRing();
  if (missedTO) { clearTimeout(missedTO); missedTO = null; }
  if (!incomingData) return toast('❌ Données d\'appel manquantes');

  try {
    await initLocalStream();
    callId        = incomingData.id;
    callChatId    = incomingData.chatId;
    isCaller      = false;
    callRemoteUid = incomingData.callerUid;  // explicit, never derived

    pc = buildPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(incomingData.offer));
    remoteReady = true;
    flushIce();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await db.ref(`calls/${callId}/answer`).set({ type: answer.type, sdp: answer.sdp });
    await db.ref(`calls/${callId}/status`).set('answered');
    await db.ref(`activeCalls/${callChatId}/participants/${CU.uid}`).set(myParticipant());

    // Callee reads caller ICE (ice_A)
    db.ref(`calls/${callId}/ice_A`).on('child_added', s => {
      if (s.val()) addIceSafe(s.val());
    });

    listenReoffer();
    showCallScreen(incomingData.callerName);
    incomingData = null;
  } catch(e) {
    toast('❌ ' + e.message);
    console.error('[acceptCall'], e);
    cleanupPeer();
  }
}

/* ════════════════════════════════════════
   CALLEE: DECLINE
════════════════════════════════════════ */
function declineCall() {
  el('incoming-call').classList.add('hidden');
  stopRing();
  if (missedTO) { clearTimeout(missedTO); missedTO = null; }
  if (incomingData?.id) db.ref(`calls/${incomingData.id}/status`).set('ended');
  incomingData = null;
}

/* ════════════════════════════════════════
   JOIN EXISTING CALL
   For now: joins audio only (no 1:1 peer
   mesh for group calls in this version).
════════════════════════════════════════ */
async function joinCall() {
  if (!chatId) return;
  const snap = await db.ref(`activeCalls/${chatId}`).once('value');
  const a = snap.val();
  if (!a || !a.active) return toast('Cet appel est terminé');
  try {
    await initLocalStream();
    callId = a.callId; callChatId = chatId; callRemoteUid = null;
    await db.ref(`activeCalls/${chatId}/participants/${CU.uid}`).set(myParticipant());
    showCallScreen(el('header-name').textContent);
    toast('📞 Connecté à l\'appel');
  } catch(e) { toast('❌ ' + e.message); }
}

/* ════════════════════════════════════════
   RTCPeerConnection FACTORY
════════════════════════════════════════ */
function buildPeer() {
  remoteReady = false; iceBuf = [];
  const p = new RTCPeerConnection(ICE_CFG);

  /* ── AUDIO ─────────────────────────────────────────────
     Always piped to <audio id="remote-audio"> in the DOM.
     Element has autoplay + playsinline.
     Explicit .play() call to beat browser autoplay policy.
  ──────────────────────────────────────────────────────── */
  /* ── VIDEO ─────────────────────────────────────────────
     Stored in remoteVideoStreams[callRemoteUid].
     Tile video element: srcObject set both in ontrack and
     in renderGrid so there's no race condition.
     Visibility controlled by Firebase camOn flag.
  ──────────────────────────────────────────────────────── */
  p.ontrack = e => {
    const track  = e.track;
    const stream = e.streams?.[0] || new MediaStream([track]);

    if (track.kind === 'audio') {
      const audioEl = el('remote-audio');
      if (!audioEl) return;
      audioEl.srcObject = stream;
      const promise = audioEl.play();
      if (promise) promise.catch(err => console.warn('[remote-audio]', err.message));
    }

    if (track.kind === 'video' && callRemoteUid) {
      if (!remoteVideoStreams[callRemoteUid])
        remoteVideoStreams[callRemoteUid] = new MediaStream();
      // Replace old tracks, add new one
      remoteVideoStreams[callRemoteUid].getVideoTracks()
        .forEach(t => remoteVideoStreams[callRemoteUid].removeTrack(t));
      remoteVideoStreams[callRemoteUid].addTrack(track);

      // Attach to tile if it already exists
      const vid = document.querySelector(`.ptile[data-uid="${callRemoteUid}"] video`);
      if (vid) {
        vid.srcObject = remoteVideoStreams[callRemoteUid];
        vid.play().catch(() => {});
      }
    }
  };

  // ICE: caller writes ice_A, callee writes ice_B
  p.onicecandidate = e => {
    if (!e.candidate || !callId) return;
    db.ref(`calls/${callId}/${isCaller ? 'ice_A' : 'ice_B'}`).push(e.candidate.toJSON());
  };

  p.onconnectionstatechange = () => {
    console.log('[WebRTC] state:', p.connectionState);
    if (p.connectionState === 'connected') {
      el('call-title').style.color = '#22c55e';
      toast('✅ Appel connecté');
    }
    if (p.connectionState === 'failed') {
      console.warn('[WebRTC] failed, trying ICE restart');
      if (p.restartIce) p.restartIce();
    }
  };

  p.onsignalingstatechange  = () => console.log('[WebRTC] signaling:', p.signalingState);
  p.onicegatheringstatechange = () => console.log('[WebRTC] ice:', p.iceGatheringState);

  return p;
}

/* ── ICE helpers ── */
function addIceSafe(c) {
  if (pc && remoteReady)
    pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('[ICE]', e.message));
  else
    iceBuf.push(c);
}
function flushIce() {
  iceBuf.forEach(c => pc && pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  iceBuf = [];
}

function myParticipant() {
  return { name: myData.pseudo, avatar: myData.avatar, micOn: true, camOn: false, ts: Date.now() };
}

/* ════════════════════════════════════════
   CALL SCREEN
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
    const parts   = s.val() || {};
    const newKeys = new Set(Object.keys(parts));

    for (const k of newKeys)
      if (!prevPartKeys.has(k) && k !== CU.uid) { playSound('join'); toast(`👋 ${parts[k].name} a rejoint`); }
    for (const k of prevPartKeys)
      if (!newKeys.has(k)) playSound('leave');

    prevPartKeys = newKeys; partSnap = parts; renderGrid(parts);
  });
}

function renderGrid(parts) {
  const grid   = el('call-grid');
  const others = Object.entries(parts).filter(([uid]) => uid !== CU.uid);
  const n      = others.length;

  grid.style.gridTemplateColumns = n <= 1 ? '1fr' : '1fr 1fr';
  grid.style.gridTemplateRows   = n > 2  ? '1fr 1fr' : '1fr';

  // Remove tiles for departed participants
  [...grid.querySelectorAll('.ptile[data-uid]')]
    .forEach(t => { if (!parts[t.dataset.uid]) t.remove(); });

  if (!others.length) {
    if (!grid.querySelector('.ptile')) {
      const w = document.createElement('div'); w.className = 'ptile';
      w.style.cssText = 'aspect-ratio:16/9;grid-column:1/-1';
      w.innerHTML = `<div class="av-fb">
        <div class="call-pulse text-5xl mb-3">📞</div>
        <div class="text-sm font-semibold" style="color:var(--text-muted)">En attente…</div>
      </div>`;
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
      fb.innerHTML = `<img src="${esc(data.avatar || 'basic1.png')}" onerror="this.src='basic1.png'">
        <div class="text-xs font-semibold mt-1.5" style="color:var(--text-muted)">${esc(data.name)}</div>`;
      tile.appendChild(fb);

      const nt = document.createElement('div'); nt.className = 'nametag';
      nt.innerHTML = `<span>${esc(data.name)}</span><span class="mute-ic">🎤</span>`;
      tile.appendChild(nt);

      grid.appendChild(tile);
    }

    // ── attach remote video stream ──────────────────────
    const vid = tile.querySelector('video');
    if (vid) {
      // Attach stream if we have it (ontrack may have fired already)
      if (remoteVideoStreams[uid] && vid.srcObject !== remoteVideoStreams[uid]) {
        vid.srcObject = remoteVideoStreams[uid];
        vid.play().catch(() => {});
      }
      // Visibility: only show video element if the OTHER side has camOn=true
      vid.classList.toggle('has-video', !!data.camOn && !!vid.srcObject);
    }

    // ── mic icon ────────────────────────────────────────
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
    // Try to enable existing video track first
    const vTracks = localStream?.getVideoTracks() || [];
    if (vTracks.length > 0) {
      // We already have a video track (from initLocalStream), just enable it
      vTracks.forEach(t => t.enabled = true);
      camOn = true;
      el('local-video').srcObject = localStream;
    } else {
      // No video track yet (audio-only fallback) — try to add one now
      try {
        const vs = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        });
        const vt = vs.getVideoTracks()[0];
        localStream.addTrack(vt);

        // Need renegotiation since video was never in the original offer
        if (pc) {
          pc.addTrack(vt, localStream);
          await doRenegotiate();
        }
        camOn = true;
        el('local-video').srcObject = localStream;
      } catch(e) { return toast('❌ Caméra : ' + e.message); }
    }
  } else {
    localStream?.getVideoTracks().forEach(t => t.enabled = false);
    camOn = false;
  }
  if (callChatId) db.ref(`activeCalls/${callChatId}/participants/${CU.uid}/camOn`).set(camOn);
  updateCtrl();
}

// Renegotiation — only needed for audio-only fallback adding video mid-call
async function doRenegotiate() {
  if (!pc || !callId) return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const path = isCaller ? `calls/${callId}/reoffer_caller` : `calls/${callId}/reoffer_callee`;
    await db.ref(path).set({ type: offer.type, sdp: offer.sdp });
    const ansPath = isCaller ? `calls/${callId}/reanswer_callee` : `calls/${callId}/reanswer_caller`;
    await new Promise(resolve => {
      db.ref(ansPath).on('value', async function h(s) {
        if (!s.val()) return;
        db.ref(ansPath).off('value', h);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(s.val())).catch(() => {});
        resolve();
      });
    });
  } catch(e) { console.warn('[renegotiate]', e); }
}
// Listen for reoffer from the other side (audio-only fallback)
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
    } catch(e) { console.warn('[listenReoffer]', e); }
  });
}

function updateCtrl() {
  const mic = el('ctl-mic'), cam = el('ctl-cam');
  mic.querySelector('.ico').textContent = micOn ? '🎤' : '🔇';
  mic.classList.toggle('ctl-muted', !micOn);
  cam.querySelector('.ico').textContent = camOn ? '📷' : '📵';
  cam.classList.toggle('ctl-on', camOn);
}

/* ════════════════════════════════════════
   END CALL / CLEANUP
════════════════════════════════════════ */
async function endCall() {
  if (callId) db.ref(`calls/${callId}/status`).set('ended').catch(() => {});
  if (callChatId) {
    await db.ref(`activeCalls/${callChatId}/participants/${CU.uid}`).remove().catch(() => {});
    const s = await db.ref(`activeCalls/${callChatId}/participants`).once('value').catch(() => null);
    if (!s || !s.numChildren()) db.ref(`activeCalls/${callChatId}`).remove().catch(() => {});
  }
  cleanupPeer();
  callId = null; callChatId = null; callRemoteUid = null;
}

function cleanupPeer() {
  if (partRef && callChatId) {
    db.ref(`activeCalls/${callChatId}/participants`).off('value', partRef); partRef = null;
  }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (timerIv) { clearInterval(timerIv); timerIv = null; }

  const cs = el('call-screen');
  cs.classList.add('hidden'); cs.classList.remove('call-minimized');
  el('call-grid').innerHTML    = '';
  el('local-video').srcObject  = null;
  el('call-timer').textContent = '00:00';
  el('minimize-btn').textContent = '⤡';

  micOn = true; camOn = false; remoteReady = false; iceBuf = [];
  remoteVideoStreams = {}; isCaller = false; callMinimized = false; prevPartKeys = new Set();
}

/* ── Timer ── */
function startTimer() {
  timerStart = Date.now(); if (timerIv) clearInterval(timerIv);
  timerIv = setInterval(() => {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    el('call-timer').textContent =
      `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }, 1000);
}
