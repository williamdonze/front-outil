/* =========================================================================
   Interface : base de fiches (localStorage) + fichiers lourds (IndexedDB)
   ========================================================================= */
(function () {
  'use strict';

  const LS_KEY = 'fiches.db.v1';
  const FIELDS = ['title', 'but', 'quand', 'pour', 'implication', 'materiel', 'temps', 'etapes', 'attention'];
  const $ = s => document.querySelector(s);

  /* ---------------- IndexedDB (PDF annexés + polices) ---------------- */
  const idb = (() => {
    let dbp;
    function open() {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open('fiches-files', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('files', mode);
        const req = fn(t.objectStore('files'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    }
    return {
      get: k => tx('readonly', s => s.get(k)),
      set: (k, v) => tx('readwrite', s => s.put(v, k)),
      del: k => tx('readwrite', s => s.delete(k)),
    };
  })();

  /* ---------------- Base ---------------- */
  let db = load();
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY));
      if (d && Array.isArray(d.entries)) return d;
    } catch (e) { /* ignore */ }
    return { version: 1, entries: [] };
  }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
    } catch (e) {
      toast('Stockage local plein : réduisez la taille des images ou sauvegardez/purgez la base.', true);
    }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function newEntry(data = {}) {
    const e = { id: uid(), logo: '1', image: null, attachment: null, updatedAt: Date.now() };
    FIELDS.forEach(f => e[f] = '');
    return Object.assign(e, data);
  }
  const SAMPLE = {
    title: 'Cartographie\nde son équipe',
    but: 'Rendre visibles la composition, les compétences,\nles responsabilités et/ou les liens au sein de l’équipe.',
    quand: 'L’équipe vient d’être créée ou transformée\nLes compétences et besoins sont insuffisamment connus\nLes collaborations ou responsabilités sont perçues comme floues ou déséquilibrées',
    pour: 'Faire émerger des hypothèses de travail utiles\nIdentifier les zones de fragilité ou de ressources\nPréparer certaines discussions',
    implication: 'Individuel\npuis possiblement collectif',
    materiel: 'Support visuel papier // ou numérique\nDonnées utiles',
    temps: '**45-90’** de préparation\n**30-60’** de mise en action',
    etapes: 'Définir les informations utiles à représenter.\nChaque membre renseigne son rôle, ses compétences et ses liens.\nMettre en commun et compléter la carte.\nIdentifier les ajustements ou collaborations à développer.',
    attention: 'Ne pas réduire les personnes à leur fonction officielle.\nObtenir l’accord avant d’afficher des informations personnelles.\nMettre régulièrement la carte à jour.',
  };
  if (!localStorage.getItem(LS_KEY)) { db.entries.push(newEntry(SAMPLE)); save(); }

  const byId = id => db.entries.find(e => e.id === id);
  const selected = new Set();

  /* ---------------- Utilitaires ---------------- */
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 4500);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function titleOf(e) { return e.title.split('\n').map(s => s.trim()).filter(Boolean).join(' ') || 'Sans titre'; }
  function slug(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '-')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'fiche';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const readAsArrayBuffer = f => f.arrayBuffer();
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  /** Réduit l'image (max 1200 px) pour tenir dans le localStorage. */
  function compressImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        const sc = Math.min(1, MAX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
      img.src = url;
    });
  }

  /* ---------------- Polices utilisateur ---------------- */
  let userFonts = {};
  async function loadUserFonts() {
    userFonts = {};
    for (const k of ['regular', 'semibold', 'bold']) {
      const v = await idb.get('font_' + k).catch(() => null);
      if (v) userFonts[k] = new Uint8Array(v.data);
    }
  }

  /* ---------------- Génération ---------------- */
  async function buildPdf(entry) {
    let attachment = null;
    if (entry.attachment) {
      const f = await idb.get('att_' + entry.id).catch(() => null);
      if (f) attachment = f.data;
    }
    return FichePDF.generate(entry, { userFonts, attachment });
  }

  async function generateMany(entries) {
    if (!entries.length) return;
    const zip = entries.length > 1 && $('#chkZip').checked;
    const z = zip ? new JSZip() : null;
    const used = {};
    const allWarn = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      $('#progress').textContent = `Génération ${i + 1}/${entries.length} : ${titleOf(e)}…`;
      try {
        const { bytes, warnings } = await buildPdf(e);
        warnings.forEach(w => allWarn.push(`${titleOf(e)} — ${w}`));
        let name = slug(titleOf(e));
        used[name] = (used[name] || 0) + 1;
        if (used[name] > 1) name += '-' + used[name];
        if (z) z.file(name + '.pdf', bytes);
        else {
          download(new Blob([bytes], { type: 'application/pdf' }), name + '.pdf');
          await new Promise(r => setTimeout(r, 350)); // laisse le navigateur enchaîner
        }
      } catch (err) {
        console.error(err);
        allWarn.push(`${titleOf(e)} — erreur : ${err.message}`);
      }
    }
    if (z) {
      $('#progress').textContent = 'Compression…';
      const blob = await z.generateAsync({ type: 'blob' });
      download(blob, `fiches-${new Date().toISOString().slice(0, 10)}.zip`);
    }
    $('#progress').textContent = '';
    const uniq = [...new Set(allWarn.filter(w => !/Helvetica/.test(w)))];
    if (allWarn.some(w => /Helvetica/.test(w))) uniq.unshift('Polices Zeitung Pro absentes : Helvetica utilisée.');
    toast(uniq.length ? uniq.join('\n') : `${entries.length} PDF généré(s).`, uniq.length > 0);
  }

  /* ---------------- Liste ---------------- */
  function render() {
    const tb = $('#rows');
    tb.innerHTML = '';
    for (const e of db.entries) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="c-chk"><input type="checkbox" data-sel="${e.id}" ${selected.has(e.id) ? 'checked' : ''}></td>
        <td class="c-img">${e.image ? `<img src="${e.image}" alt="">` : '<div class="ph"></div>'}</td>
        <td class="c-title"><a href="#" data-edit="${e.id}">${esc(titleOf(e))}</a></td>
        <td class="c-logo">Logo ${esc(e.logo || '1')}</td>
        <td class="muted">${e.attachment ? '📎 ' + esc(e.attachment.name) : '—'}</td>
        <td class="c-date muted">${new Date(e.updatedAt).toLocaleDateString('fr-CH')}</td>
        <td class="c-act">
          <button data-edit="${e.id}">Modifier</button>
          <button data-pdf="${e.id}">PDF</button>
          <button data-dup="${e.id}" title="Dupliquer">⧉</button>
          <button data-del="${e.id}" class="danger" title="Supprimer">✕</button>
        </td>`;
      tb.appendChild(tr);
    }
    $('#empty').hidden = db.entries.length > 0;
    updateSel();
  }
  function updateSel() {
    [...selected].forEach(id => { if (!byId(id)) selected.delete(id); });
    const n = selected.size;
    $('#selCount').textContent = n ? `${n} sélectionnée(s)` : '';
    $('#btnGenSel').disabled = !n;
    $('#btnGenSel').textContent = n ? `Générer la sélection (${n})` : 'Générer la sélection';
    const all = $('#chkAll');
    all.checked = n > 0 && n === db.entries.length;
    all.indeterminate = n > 0 && n < db.entries.length;
  }

  $('#rows').addEventListener('change', ev => {
    const id = ev.target.dataset.sel;
    if (!id) return;
    ev.target.checked ? selected.add(id) : selected.delete(id);
    updateSel();
  });
  $('#rows').addEventListener('click', async ev => {
    const t = ev.target.closest('[data-edit],[data-pdf],[data-dup],[data-del]');
    if (!t) return;
    ev.preventDefault();
    const d = t.dataset;
    if (d.edit) openEditor(d.edit);
    else if (d.pdf) generateMany([byId(d.pdf)]);
    else if (d.dup) {
      const src = byId(d.dup);
      const copy = newEntry({ ...JSON.parse(JSON.stringify(src)), id: uid(), updatedAt: Date.now() });
      copy.title = src.title + ' (copie)';
      if (src.attachment) {
        const f = await idb.get('att_' + src.id).catch(() => null);
        if (f) await idb.set('att_' + copy.id, f); else copy.attachment = null;
      }
      db.entries.splice(db.entries.indexOf(src) + 1, 0, copy);
      save(); render();
    } else if (d.del) {
      const e = byId(d.del);
      if (!confirm(`Supprimer « ${titleOf(e)} » ?`)) return;
      db.entries = db.entries.filter(x => x !== e);
      idb.del('att_' + e.id).catch(() => {});
      selected.delete(e.id);
      save(); render();
    }
  });
  $('#chkAll').addEventListener('change', ev => {
    selected.clear();
    if (ev.target.checked) db.entries.forEach(e => selected.add(e.id));
    render();
  });
  $('#btnGenSel').addEventListener('click', () => generateMany(db.entries.filter(e => selected.has(e.id))));
  $('#btnGenAll').addEventListener('click', () => generateMany(db.entries.slice()));
  $('#btnNew').addEventListener('click', () => {
    const e = newEntry();
    db.entries.push(e); save(); render(); openEditor(e.id);
  });

  /* ---------------- Sauvegarde / restauration ---------------- */
  $('#btnExport').addEventListener('click', async () => {
    const out = { app: 'fiches', version: 1, exportedAt: new Date().toISOString(), entries: [] };
    for (const e of db.entries) {
      const c = JSON.parse(JSON.stringify(e));
      if (e.attachment) {
        const f = await idb.get('att_' + e.id).catch(() => null);
        if (f) c.attachment.data = bufToB64(f.data);
      }
      out.entries.push(c);
    }
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    download(blob, `fiches-sauvegarde-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
  });
  $('#inpImport').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { return toast('Fichier de sauvegarde invalide.', true); }
    if (!data || !Array.isArray(data.entries)) return toast('Fichier de sauvegarde invalide.', true);
    const replace = confirm(`${data.entries.length} fiche(s) dans la sauvegarde.\n\nOK = remplacer la base actuelle\nAnnuler = ajouter à la base actuelle`);
    if (replace) {
      for (const e of db.entries) await idb.del('att_' + e.id).catch(() => {});
      db.entries = [];
    }
    for (const raw of data.entries) {
      const e = newEntry(raw);
      if (byId(e.id)) e.id = uid();
      if (raw.attachment && raw.attachment.data) {
        await idb.set('att_' + e.id, { name: raw.attachment.name, data: b64ToBuf(raw.attachment.data) });
        e.attachment = { name: raw.attachment.name, size: raw.attachment.size };
      } else e.attachment = null;
      db.entries.push(e);
    }
    save(); render();
    toast('Base restaurée.');
  });

  /* ---------------- Éditeur ---------------- */
  let current = null, pvTimer = null, pvUrl = null;
  const form = $('#form');

  function openEditor(id) {
    current = byId(id);
    if (!current) return;
    FIELDS.forEach(f => form.elements[f].value = current[f] || '');
    renderImage(); renderLogos(); renderAttach();
    $('#edTitle').textContent = titleOf(current);
    $('#editor').hidden = false;
    document.body.classList.add('noscroll');
    schedulePreview(0);
  }
  function closeEditor() {
    $('#editor').hidden = true;
    document.body.classList.remove('noscroll');
    current = null; render();
  }
  function touch() { current.updatedAt = Date.now(); save(); schedulePreview(); }

  form.addEventListener('input', ev => {
    if (!current || !FIELDS.includes(ev.target.name)) return;
    current[ev.target.name] = ev.target.value;
    $('#edTitle').textContent = titleOf(current);
    touch();
  });
  $('#edClose').addEventListener('click', closeEditor);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { if (!$('#editor').hidden) closeEditor(); else if (!$('#settings').hidden) $('#settings').hidden = true; }
  });
  $('#edDownload').addEventListener('click', () => current && generateMany([current]));

  function renderImage() {
    $('#imgPreview').innerHTML = current.image ? `<img src="${current.image}" alt="">` : '';
  }
  $('#inpImage').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f || !current) return;
    try { current.image = await compressImage(f); renderImage(); touch(); }
    catch (e) { toast(e.message, true); }
  });
  $('#btnImgClear').addEventListener('click', () => { current.image = null; renderImage(); touch(); });

  let logoStatus = { 1: null, 2: null };
  function logoThumb(n) {
    const l = logoStatus[n];
    return l ? `<img src="${l.url}" alt="">` : '<span class="missing">absent</span>';
  }
  function renderLogos() {
    $('#logoChoice').innerHTML = ['1', '2'].map(n => `
      <label class="logo ${current.logo === n ? 'on' : ''}">
        <input type="radio" name="logo" value="${n}" ${current.logo === n ? 'checked' : ''}>
        <span class="ring ring-${n}">${logoThumb(n)}</span><span>Logo ${n}</span>
      </label>`).join('');
  }
  $('#logoChoice').addEventListener('change', ev => {
    if (ev.target.name !== 'logo') return;
    current.logo = ev.target.value; renderLogos(); touch();
  });

  function renderAttach() {
    $('#attName').textContent = current.attachment
      ? `${current.attachment.name} (${Math.round((current.attachment.size || 0) / 1024)} Ko)` : 'Aucun';
  }
  $('#inpAttach').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f || !current) return;
    const data = await readAsArrayBuffer(f);
    await idb.set('att_' + current.id, { name: f.name, data });
    current.attachment = { name: f.name, size: f.size };
    renderAttach(); touch();
  });
  $('#btnAttClear').addEventListener('click', async () => {
    await idb.del('att_' + current.id).catch(() => {});
    current.attachment = null; renderAttach(); touch();
  });

  function schedulePreview(delay = 450) {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(preview, delay);
  }
  let pvBusy = false, pvAgain = false;
  async function preview() {
    if (!current) return;
    if (pvBusy) { pvAgain = true; return; }
    pvBusy = true;
    try {
      const { bytes, warnings } = await buildPdf(current);
      if (pvUrl) URL.revokeObjectURL(pvUrl);
      pvUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      $('#pvFrame').src = pvUrl + '#toolbar=0&navpanes=0&view=FitH';
      const w = $('#pvWarn');
      w.hidden = !warnings.length; w.textContent = warnings.join(' ');
    } catch (e) {
      console.error(e);
      $('#pvWarn').hidden = false; $('#pvWarn').textContent = 'Erreur d’aperçu : ' + e.message;
    }
    pvBusy = false;
    if (pvAgain) { pvAgain = false; preview(); }
  }

  /* ---------------- Ressources ---------------- */
  async function refreshAssets() {
    FichePDF.clearCache();
    await loadUserFonts();
    const st = await FichePDF.assetStatus(userFonts);
    logoStatus = { 1: st.logo1, 2: st.logo2 };
    const missing = [];
    const fontsOk = st.fonts.regular && st.fonts.semibold && st.fonts.bold;
    if (!fontsOk) missing.push('polices Zeitung Pro (Helvetica sera utilisée en attendant)');
    if (!st.logo1) missing.push('logo-1');
    if (!st.logo2) missing.push('logo-2');
    const w = $('#assetWarn');
    const fileProto = location.protocol === 'file:';
    w.hidden = !missing.length && !fileProto;
    w.innerHTML = fileProto
      ? 'Page ouverte en <code>file://</code> : le navigateur bloque la lecture des fichiers du dossier. Utilisez GitHub Pages ou lancez <code>python3 -m http.server</code> dans le dossier.'
      : `Ressources manquantes : ${missing.join(', ')}. <a href="#" id="lnkSettings">Voir « Ressources »</a>.`;
    ['regular', 'semibold', 'bold'].forEach(k => {
      $('#st_' + k).innerHTML = st.fonts[k]
        ? (userFonts[k] ? '<span class="ok">✓ chargée dans le navigateur</span>' : '<span class="ok">✓ assets/fonts</span>')
        : '<span class="missing">absente</span>';
    });
    $('#stLogos').innerHTML = ['1', '2'].map(n => `<div class="logo"><span class="ring ring-${n}">${logoThumb(n)}</span><span>${logoStatus[n] ? esc(logoStatus[n].url) : 'assets/logos/logo-' + n + '.png'}</span></div>`).join('');
    installUiFonts();
    if (current) { renderLogos(); schedulePreview(0); }
  }
  // Applique les polices à l'interface aussi (si disponibles)
  async function installUiFonts() {
    if (!window.FontFace) return;
    const map = { regular: '400', semibold: '600', bold: '700' };
    // (les fichiers de assets/fonts sont déjà déclarés dans style.css)
    for (const k of Object.keys(map)) {
      if (!userFonts[k]) continue;
      try {
        const ff = new FontFace('Zeitung Pro', userFonts[k].slice().buffer, { weight: map[k] });
        await ff.load(); document.fonts.add(ff);
      } catch (e) { /* ignore */ }
    }
  }
  document.addEventListener('click', ev => {
    if (ev.target.id === 'lnkSettings') { ev.preventDefault(); openSettings(); }
  });
  function openSettings() {
    $('#settings').hidden = false;
    let used = 0;
    try { used = (localStorage.getItem(LS_KEY) || '').length; } catch (e) { /* */ }
    $('#stStorage').textContent = `Base dans le localStorage : ${(used / 1024).toFixed(0)} Ko sur ~5 000 Ko (images incluses). Les PDF annexés et les polices chargées sont dans l’IndexedDB du navigateur. Pensez à « Sauvegarder la base » régulièrement : le fichier contient tout (fiches, images et PDF annexés).`;
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#stClose').addEventListener('click', () => $('#settings').hidden = true);
  document.querySelectorAll('[data-font]').forEach(inp => inp.addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    await idb.set('font_' + ev.target.dataset.font, { name: f.name, data: await f.arrayBuffer() });
    await refreshAssets();
    toast(`Police ${ev.target.dataset.font} enregistrée dans le navigateur.`);
  }));
  $('#btnFontsClear').addEventListener('click', async () => {
    for (const k of ['regular', 'semibold', 'bold']) await idb.del('font_' + k).catch(() => {});
    await refreshAssets();
  });

  render();
  refreshAssets();
})();
