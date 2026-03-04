/* ─────────────────────────────────────────
   GIF PICKER — Tenor API
───────────────────────────────────────── */
let gifSearchTO = null;

function showGifPicker() {
  el('modal-gif').classList.remove('hidden');
  el('gif-search-input').value = '';
  loadGifs('');
  setTimeout(() => el('gif-search-input').focus(), 80);
}

function onGifSearch() {
  const q = el('gif-search-input').value.trim();
  if (gifSearchTO) clearTimeout(gifSearchTO);
  gifSearchTO = setTimeout(() => loadGifs(q), 400);
}

async function loadGifs(query) {
  const grid = el('gif-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">Chargement…</div>';
  try {
    const url = query
      ? `https://api.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=24&media_filter=minimal`
      : `https://api.tenor.com/v1/trending?key=${TENOR_KEY}&limit=24&media_filter=minimal`;
    const res = await fetch(url);
    const data = await res.json();
    renderGifs(data.results || []);
  } catch(e) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#f87171">Impossible de charger les GIFs</div>';
  }
}

function renderGifs(results) {
  const grid = el('gif-grid'); grid.innerHTML = '';
  if (!results.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">Aucun résultat</div>';
    return;
  }
  results.forEach(item => {
    const url = item.media?.[0]?.tinygif?.url || item.media?.[0]?.gif?.url;
    if (!url) return;
    const img = document.createElement('img');
    img.src = url; img.alt = item.title || 'gif';
    img.style.cssText = 'width:100%;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;transition:opacity .15s';
    img.onmouseenter = () => img.style.opacity = '.8';
    img.onmouseleave = () => img.style.opacity = '1';
    img.onclick = () => sendGif(url);
    grid.appendChild(img);
  });
}

async function sendGif(gifUrl) {
  if (!chatId) return;
  hideModal('modal-gif');
  const msg = { sender: CU.uid, senderPseudo: myData?.pseudo || '', text: '', imageUrl: gifUrl, isGif: true, time: Date.now() };
  const ref = await db.ref(`messages/${chatId}`).push(msg);
  await db.ref(`messages/${chatId}/${ref.key}/_key`).set(ref.key);
}
