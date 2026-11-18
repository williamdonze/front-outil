/* =========================================================================
   Génération du PDF « fiche outil » — reproduit la mise en page InDesign
   (A4, coordonnées en points, mesurées sur le PDF d'origine).
   Toutes les coordonnées Y ci-dessous sont exprimées « depuis le haut » de
   la page, puis converties pour pdf-lib (origine en bas à gauche).
   ========================================================================= */
(function () {
  'use strict';
  const { PDFDocument, StandardFonts, cmyk, rgb, pushGraphicsState, popGraphicsState,
          moveTo, appendBezierCurve, closePath, clip, endPath } = PDFLib;

  const PAGE_W = 595.276, PAGE_H = 841.89;
  const X0 = 56.693;            // marge gauche
  const XR = 538.583;           // bord droit (fin des filets / image)
  const BOTTOM_LIMIT = 800;     // au-delà : alerte de débordement

  const BLACK = cmyk(0, 0, 0, 1);
  const WHITE = cmyk(0, 0, 0, 0);
  const GREY  = cmyk(0, 0, 0, 0.08);
  const RED   = cmyk(0.109, 1, 0.922, 0.022);
  const ORANGE = rgb(0xfa / 255, 0xa2 / 255, 0x26 / 255); // #faa226

  // Couleur du cercle autour du logo, selon le logo choisi
  const LOGO_RING = { '1': ORANGE, '2': RED };

  // Libellés invariables (surlignés en rouge dans le PDF de référence)
  const LABELS = {
    but: 'But',
    quand: 'A utiliser quand…',
    pour: 'A utiliser pour…',
    implication: 'Implication',
    materiel: 'Matériel',
    temps: 'Temps',
    etapes: 'Etapes-clé',
    attention: 'Points d’attention',
  };

  /* ---------------------------------------------------------------------
     Chargement des ressources (mis en cache)
     --------------------------------------------------------------------- */
  const cache = {};
  async function fetchBytes(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { return null; }
  }
  async function firstAvailable(urls) {
    for (const u of urls) {
      const b = await fetchBytes(u);
      if (b) return { url: u, bytes: b };
    }
    return null;
  }
  function imgType(bytes, url) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
    return /\.png$/i.test(url || '') ? 'png' : 'jpg';
  }

  const FONT_FILES = {
    regular:  ['ZeitungPro-Regular'],
    semibold: ['ZeitungPro-Semibold', 'ZeitungPro-SemiBold'],
    bold:     ['ZeitungPro-Bold'],
  };
  const FONT_EXT = ['otf', 'ttf', 'woff'];

  /** Polices : d'abord celles chargées dans l'interface (IndexedDB),
   *  sinon le dossier assets/fonts/. Renvoie {regular, semibold, bold} en bytes ou null. */
  async function loadFontBytes(userFonts) {
    const out = {};
    for (const key of Object.keys(FONT_FILES)) {
      if (userFonts && userFonts[key]) { out[key] = userFonts[key]; continue; }
      if (!(('asset_' + key) in cache)) {
        const urls = [];
        FONT_FILES[key].forEach(n => FONT_EXT.forEach(e => urls.push(`assets/fonts/${n}.${e}`)));
        const f = await firstAvailable(urls);
        cache['asset_' + key] = f ? f.bytes : null;
      }
      out[key] = cache['asset_' + key];
    }
    return out;
  }

  async function loadLogo(n) {
    const k = 'logo' + n;
    if (!(k in cache)) {
      cache[k] = await firstAvailable(['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG']
        .map(e => `assets/logos/logo-${n}.${e}`));
    }
    return cache[k];
  }
  async function loadPicto(name) {
    const k = 'picto_' + name;
    if (!(k in cache)) cache[k] = await firstAvailable([`assets/pictos/${name}.png`, `assets/pictos/${name}.jpg`]);
    return cache[k];
  }
  function clearCache() { Object.keys(cache).forEach(k => delete cache[k]); }

  /* ---------------------------------------------------------------------
     Texte riche minimal : **gras** -> Semibold
     --------------------------------------------------------------------- */
  function parseRich(str) {
    const runs = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) runs.push({ text: str.slice(last, m.index), bold: false });
      runs.push({ text: m[1], bold: true });
      last = re.lastIndex;
    }
    if (last < str.length) runs.push({ text: str.slice(last), bold: false });
    return runs;
  }

  /* ---------------------------------------------------------------------
     Moteur de rendu
     --------------------------------------------------------------------- */
  class Renderer {
    constructor(page, fonts, standard) {
      this.page = page; this.fonts = fonts; this.standard = standard;
      this.maxY = 0;
    }
    clean(s) {
      s = String(s || '').replace(/\t/g, ' ').replace(/ /g, ' ');
      if (!this.standard) return s;
      // Les polices standard (secours) ne couvrent que WinAnsi
      return s.replace(/[‘’]/g, '’').replace(/[^\x20-\x7e -ÿ’‘“”…–—•€œŒ]/g, '?');
    }
    font(bold) { return bold ? this.fonts.semibold : this.fonts.regular; }
    width(text, bold, size) { return this.font(bold).widthOfTextAtSize(text, size); }

    text(str, x, yTop, size, font) {
      str = this.clean(str);
      if (!str) return;
      this.page.drawText(str, { x, y: PAGE_H - yTop, size, font, color: BLACK });
      this.maxY = Math.max(this.maxY, yTop);
    }

    /** Découpe un texte riche en lignes de largeur max. "//" force un retour. */
    wrap(str, size, maxW) {
      const lines = [];
      const hardLines = this.clean(str).split(/\s*\/\/\s*/);
      for (const hl of hardLines) {
        // tokens : mots avec leur graisse
        const tokens = [];
        for (const run of parseRich(hl)) {
          run.text.split(/(\s+)/).forEach(t => { if (t !== '') tokens.push({ text: t, bold: run.bold }); });
        }
        let cur = [], curW = 0;
        const push = () => {
          while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop();
          lines.push(cur); cur = []; curW = 0;
        };
        for (const tk of tokens) {
          const isSpace = /^\s+$/.test(tk.text);
          if (isSpace && !cur.length) continue;
          const w = this.width(isSpace ? ' ' : tk.text, tk.bold, size);
          if (!isSpace && cur.length && curW + w > maxW) push();
          cur.push(isSpace ? { text: ' ', bold: tk.bold } : tk);
          curW += w;
        }
        push();
      }
      return lines;
    }

    drawLine(tokens, x, yTop, size) {
      let cx = x;
      // fusionne les tokens contigus de même graisse
      const runs = [];
      tokens.forEach(t => {
        if (runs.length && runs[runs.length - 1].bold === t.bold) runs[runs.length - 1].text += t.text;
        else runs.push({ ...t });
      });
      for (const r of runs) {
        this.page.drawText(r.text, { x: cx, y: PAGE_H - yTop, size, font: this.font(r.bold), color: BLACK });
        cx += this.width(r.text, r.bold, size);
      }
      this.maxY = Math.max(this.maxY, yTop);
    }

    /** Paragraphe : renvoie la ligne de base de la dernière ligne */
    paragraph(str, x, yTop, size, leading, maxW) {
      const lines = this.wrap(str, size, maxW);
      let y = yTop;
      lines.forEach((l, i) => { if (i) y += leading; this.drawLine(l, x, y, size); });
      return y;
    }

    bullet(x, yBase) {
      // petit losange incliné (repris du PDF d'origine)
      const pts = [[0, -3.98], [4.843, -6.236], [6.698, -2.259], [1.855, 0]];
      const d = 'M' + pts.map(p => p[0] + ' ' + p[1]).join(' L') + ' Z';
      this.page.drawSvgPath(d, { x, y: PAGE_H - yBase, color: BLACK, borderWidth: 0 });
    }

    /** Liste à puces. Renvoie la ligne de base de la dernière ligne. */
    bulletList(items, x, yFirst, size, leading, spaceBefore, indent, maxW) {
      let y = yFirst - leading - spaceBefore, any = false;
      for (const it of items) {
        y += leading + spaceBefore;
        this.bullet(x, y);
        y = this.paragraph(it, x + indent, y, size, leading, maxW - indent);
        any = true;
      }
      return any ? y : null;
    }

    heading(label, x, yTop, size = 12.5) {
      this.text(label, x, yTop, size, this.fonts.semibold);
    }

    hLine(x1, x2, yTop, w = 0.5) {
      this.page.drawLine({ start: { x: x1, y: PAGE_H - yTop }, end: { x: x2, y: PAGE_H - yTop }, thickness: w, color: BLACK });
    }
    circle(cx, cyTop, r, stroke, w, fill) {
      const o = { x: cx, y: PAGE_H - cyTop, size: r, borderColor: stroke, borderWidth: w };
      if (fill) o.color = fill;
      this.page.drawCircle(o);
    }
    clipCircle(cx, cyTop, r) {
      const k = 0.5522847498 * r, cy = PAGE_H - cyTop;
      this.page.pushOperators(
        pushGraphicsState(),
        moveTo(cx + r, cy),
        appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
        appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
        appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
        appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
        closePath(), clip(), endPath());
    }
    endClip() { this.page.pushOperators(popGraphicsState()); }
  }

  function lines(str) {
    return String(str || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  function dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------------------------------------------------------------------
     Construction de la page de titre
     --------------------------------------------------------------------- */
  async function buildCover(pdf, entry, opts) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const fb = await loadFontBytes(opts.userFonts);
    let fonts, standard = false;
    if (fb.regular && fb.semibold && fb.bold) {
      pdf.registerFontkit(fontkit);
      fonts = {
        regular:  await pdf.embedFont(fb.regular,  { subset: false }),
        semibold: await pdf.embedFont(fb.semibold, { subset: false }),
        bold:     await pdf.embedFont(fb.bold,     { subset: false }),
      };
    } else {
      standard = true;
      fonts = {
        regular:  await pdf.embedFont(StandardFonts.Helvetica),
        semibold: await pdf.embedFont(StandardFonts.HelveticaBold),
        bold:     await pdf.embedFont(StandardFonts.HelveticaBold),
      };
    }
    const R = new Renderer(page, fonts, standard);
    const warnings = [];
    if (standard) warnings.push('Polices Zeitung Pro introuvables : police de secours (Helvetica) utilisée.');

    /* --- Image en haut à droite (153 × 153 pt) --- */
    const IMG = { x: 385.512, y: 34.016, s: 153.071 };
    if (entry.image) {
      const bytes = dataUrlToBytes(entry.image);
      const img = imgType(bytes) === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      // remplissage "cover" centré
      const sc = Math.max(IMG.s / img.width, IMG.s / img.height);
      const w = img.width * sc, h = img.height * sc;
      const y0 = PAGE_H - IMG.y - IMG.s;
      page.pushOperators(
        pushGraphicsState(),
        moveTo(IMG.x, y0), PDFLib.lineTo(IMG.x + IMG.s, y0), PDFLib.lineTo(IMG.x + IMG.s, y0 + IMG.s),
        PDFLib.lineTo(IMG.x, y0 + IMG.s), closePath(), clip(), endPath());
      page.drawImage(img, { x: IMG.x + (IMG.s - w) / 2, y: y0 + (IMG.s - h) / 2, width: w, height: h });
      page.pushOperators(popGraphicsState());
    } else {
      page.drawRectangle({ x: IMG.x, y: PAGE_H - IMG.y - IMG.s, width: IMG.s, height: IMG.s, color: GREY });
    }

    /* --- Titre --- */
    const TITLE_MAXW = IMG.x - 53.858 - 12;
    let y = 75.82;
    const titleLines = lines(entry.title);
    if (!titleLines.length) titleLines.push('Titre');
    let first = true;
    for (const tl of titleLines) {
      for (const l of R.wrap(tl.replace(/\*\*/g, ''), 32, TITLE_MAXW)) {
        if (!first) y += 34;
        first = false;
        R.text(l.map(t => t.text).join(''), 53.858, y, 32, fonts.bold);
      }
    }

    /* --- But --- */
    y += 26.86;
    R.heading(LABELS.but, X0, y);
    y += 14.83;
    const butLines = lines(entry.but);
    butLines.forEach((bl, i) => {
      if (i) y += 12;
      y = R.paragraph(bl, X0, y, 10.5, 12, TITLE_MAXW);
    });

    /* --- Logo + filet --- */
    const LOGO_R = 20.77;
    const cy = Math.max(198.425, y + 13.1 + LOGO_R + 1);
    const cx = 79.513;
    const logo = await loadLogo(entry.logo || '1');
    if (logo) {
      const img = imgType(logo.bytes, logo.url) === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
      const S = 43.55;
      R.clipCircle(cx, cy, LOGO_R);
      page.drawRectangle({ x: cx - LOGO_R, y: PAGE_H - cy - LOGO_R, width: 2 * LOGO_R, height: 2 * LOGO_R, color: WHITE });
      page.drawImage(img, { x: cx - S / 2, y: PAGE_H - cy - S / 2, width: S, height: S });
      R.endClip();
    } else {
      warnings.push(`Logo ${entry.logo || '1'} introuvable dans assets/logos/.`);
    }
    R.circle(cx, cy, LOGO_R, LOGO_RING[entry.logo || '1'] || RED, 2.05);
    R.hLine(102.331, XR, cy);
    y = cy + LOGO_R;

    /* --- A utiliser quand… --- */
    const LIST_W = XR - X0;
    y = cy + 43.7;
    R.heading(LABELS.quand, X0, y);
    let last = R.bulletList(lines(entry.quand), X0, y + 18.8, 10.5, 12, 3.97, 9.92, LIST_W);
    y = last != null ? last : y + 6;

    /* --- A utiliser pour… --- */
    y += 39.97;
    R.heading(LABELS.pour, X0, y);
    last = R.bulletList(lines(entry.pour), X0, y + 18.8, 10.5, 12, 3.97, 9.92, LIST_W);
    y = last != null ? last : y + 6;

    /* --- Ligne des pictos --- */
    const icY = y + 55.77;
    R.hLine(X0, XR, icY + 0.25);
    const ICONS = [
      { x: 70.866, picto: 'implication', w: 27.88, h: 27.88 },
      { x: 235.275, picto: 'materiel', w: 17.05, h: 15.29 },
      { x: 399.685, picto: 'temps', w: 12.57, h: 16.90 },
    ];
    for (const ic of ICONS) {
      R.circle(ic.x, icY, 12.9, BLACK, 1.279, WHITE);
      const p = await loadPicto(ic.picto);
      if (p) {
        const img = imgType(p.bytes, p.url) === 'png' ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
        page.drawImage(img, { x: ic.x - ic.w / 2, y: PAGE_H - icY - ic.h / 2, width: ic.w, height: ic.h });
      }
    }
    // re-trace les cercles par-dessus les pictos (comme dans l'original)
    for (const ic of ICONS) R.circle(ic.x, icY, 12.9, BLACK, 1.279);

    /* --- Trois colonnes --- */
    const colH = icY + 30.11;
    const colY = colH + 17.67;
    R.heading(LABELS.implication, X0, colH, 10.5);
    R.heading(LABELS.materiel, 221.10, colH, 10.5);
    R.heading(LABELS.temps, 385.512, colH, 10.5);

    let ends = [colH];
    // Implication : lignes simples
    let yi = colY - 14.83, anyI = false;
    for (const l of lines(entry.implication)) {
      yi += 14.83;
      yi = R.paragraph(l, X0, yi, 10, 12, 221.10 - X0 - 8);
      anyI = true;
    }
    if (anyI) ends.push(yi);
    // Matériel : puces
    last = R.bulletList(lines(entry.materiel), 221.10, colY, 10, 12, 2.83, 9.92, 385.512 - 221.10 - 8);
    if (last != null) ends.push(last);
    // Temps : puces
    last = R.bulletList(lines(entry.temps), 385.512, colY, 10, 12, 3.97, 9.92, XR - 385.512);
    if (last != null) ends.push(last);
    y = Math.max(...ends);

    /* --- Etapes-clé --- */
    y += 34.27;
    R.heading(LABELS.etapes, X0, y);
    let ye = y + 18.8 - 15.97, anyE = false;
    lines(entry.etapes).forEach((txt, i) => {
      ye += 15.97;
      const num = (i + 1) + '.';
      const nw = R.width(num + ' ', true, 10.5);
      R.drawLine([{ text: num, bold: true }], X0, ye, 10.5);
      ye = R.paragraph(txt.replace(/^\s*\d+[.)]\s*/, ''), X0 + nw, ye, 10.5, 12, LIST_W - nw);
      anyE = true;
    });
    y = anyE ? ye : y + 6;

    /* --- Points d'attention --- */
    y += 46.68;
    R.heading(LABELS.attention, X0, y);
    last = R.bulletList(lines(entry.attention), X0, y + 18.8, 10.5, 12, 3.97, 9.92, LIST_W);

    if (R.maxY > BOTTOM_LIMIT) warnings.push('Le contenu dépasse le bas de la page : raccourcissez certains textes.');
    return { warnings };
  }

  /** Génère le PDF complet (page de titre + PDF annexé éventuel). */
  async function generate(entry, opts = {}) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(lines(entry.title).join(' ') || 'Fiche');
    pdf.setCreator('Générateur de fiches');
    const { warnings } = await buildCover(pdf, entry, opts);
    if (opts.attachment) {
      try {
        const src = await PDFDocument.load(opts.attachment, { ignoreEncryption: true });
        const pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach(p => pdf.addPage(p));
      } catch (e) {
        warnings.push('Le PDF annexé n’a pas pu être lu : ' + e.message);
      }
    }
    const bytes = await pdf.save();
    return { bytes, warnings };
  }

  async function assetStatus(userFonts) {
    const fb = await loadFontBytes(userFonts);
    return {
      fonts: { regular: !!fb.regular, semibold: !!fb.semibold, bold: !!fb.bold },
      logo1: await loadLogo('1'),
      logo2: await loadLogo('2'),
    };
  }

  window.FichePDF = { generate, assetStatus, clearCache, LABELS };
})();
