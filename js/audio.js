/* ─────────────────────────────────────────
   AUDIO — Web Audio API sounds + ring.mp3
───────────────────────────────────────── */

function getACtx() {
  if (!audioCtx || audioCtx.state === 'closed')
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Unlock AudioContext + pre-load ring on first user interaction
function unlockAudio() {
  try { getACtx(); } catch(_) {}
  if (!window._ringPreload) {
    window._ringPreload = new Audio('ring.mp3');
    window._ringPreload.volume = 0;
    window._ringPreload.play()
      .then(() => {
        window._ringPreload.pause();
        window._ringPreload.volume = 0.8;
        window._ringPreload.currentTime = 0;
      })
      .catch(() => {});
  }
}
['click','keydown','touchstart'].forEach(ev =>
  document.addEventListener(ev, unlockAudio, { once: true })
);

function playTone(freq, dur = 0.12, type = 'sine', vol = 0.3, delay = 0) {
  try {
    const ctx = getACtx(), t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  } catch(_) {}
}

function playSound(type) {
  switch (type) {
    case 'notif':   playTone(880, 0.14, 'sine', 0.22); break;
    case 'join':
      playTone(523, 0.1, 'sine', 0.28, 0);
      playTone(659, 0.1, 'sine', 0.28, 0.11);
      playTone(784, 0.16, 'sine', 0.28, 0.22); break;
    case 'leave':
      playTone(784, 0.1, 'sine', 0.22, 0);
      playTone(523, 0.16, 'sine', 0.18, 0.11); break;
    case 'send':    playTone(600, 0.08, 'sine', 0.15); break;
  }
}

/* ── RING (ring.mp3) ── */
function playRing() {
  stopRing();
  const pre = window._ringPreload;
  if (pre && pre.readyState >= 2) {
    pre.loop = true; pre.volume = 0.8; pre.currentTime = 0;
    pre.play().catch(() => _ringFallback());
    ringAudio = pre;
  } else {
    _ringFallback();
  }
  swPost({ type: 'RING_START', name: incomingData?.callerName || 'KyChat', callId: incomingData?.id });
  document.addEventListener('visibilitychange', _ringVis);
}
function _ringFallback() {
  try {
    ringAudio = new Audio('ring.mp3');
    ringAudio.loop = true; ringAudio.volume = 0.8;
    ringAudio.play().catch(() => {});
  } catch(_) {}
}
function _ringVis() {
  if (document.visibilityState === 'visible' && ringAudio?.paused)
    ringAudio.play().catch(() => {});
}
function stopRing() {
  if (ringAudio) { ringAudio.pause(); ringAudio.currentTime = 0; ringAudio = null; }
  document.removeEventListener('visibilitychange', _ringVis);
  swPost({ type: 'RING_STOP' });
}

/* ── SERVICE WORKER ── */
const SW_SRC = `
const RING_TAG = 'kychat-ring';
self.addEventListener('message', e => {
  const d = e.data; if (!d) return;
  if (d.type === 'NOTIFY')
    e.waitUntil(self.registration.showNotification(d.title, d.opts || {}));
  if (d.type === 'RING_START')
    e.waitUntil(self.registration.showNotification('📞 ' + (d.name||'KyChat') + " t'appelle", {
      body: 'Ouvre KyChat pour répondre', tag: RING_TAG, requireInteraction: true, renotify: true,
      icon: 'basic1.png', badge: 'basic1.png', vibrate: [500,200,500,200,500],
      actions: [{ action:'accept', title:'✅ Répondre' }, { action:'decline', title:'❌ Refuser' }],
      data: { callId: d.callId }
    }));
  if (d.type === 'RING_STOP')
    e.waitUntil(self.registration.getNotifications({ tag: RING_TAG }).then(ns => ns.forEach(n => n.close())));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const win = cs.find(c => c.visibilityState === 'visible') || cs[0];
    if (win) { win.postMessage({ type: action === 'decline' ? 'SW_DECLINE' : 'SW_ACCEPT' }); return win.focus(); }
    return clients.openWindow('./');
  }));
});
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));
`;

(async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const blob = new Blob([SW_SRC], { type: 'text/javascript' });
    swReg = await navigator.serviceWorker.register(URL.createObjectURL(blob), { scope: './' });
    await navigator.serviceWorker.ready;
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_ACCEPT')  acceptCall();
      if (e.data?.type === 'SW_DECLINE') declineCall();
    });
  } catch(e) { swReg = null; console.warn('[SW]', e.message); }
})();

async function swPost(msg) {
  try {
    const reg = swReg || await navigator.serviceWorker?.ready.catch(() => null);
    if (reg?.active) reg.active.postMessage(msg);
  } catch(_) {}
}

async function pushNotif(title, opts) {
  if (!notifOn || Notification.permission !== 'granted') return;
  try {
    const reg = swReg || await navigator.serviceWorker?.ready.catch(() => null);
    if (reg) reg.showNotification(title, opts || {});
    else new Notification(title, opts || {});
  } catch(_) { try { new Notification(title, opts || {}); } catch(__) {} }
}
