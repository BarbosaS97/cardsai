// js/tutorial.js — guided tour engine
// Usage: new Tour(steps, localStorageKey)  →  .start() / .start(true) to force

(function () {
  /* ── Injected styles ──────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    .tour-hi {
      position: relative !important;
      z-index: 9001 !important;
      outline: 3px solid var(--blue, #2563EB) !important;
      outline-offset: 4px;
      border-radius: 10px;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.50) !important;
    }
    #_tourCard {
      position: fixed;
      z-index: 9002;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e2ddd7);
      border-radius: 14px;
      padding: 20px 22px 18px;
      max-width: 296px;
      width: calc(100vw - 40px);
      box-shadow: 0 12px 48px rgba(0,0,0,.20), 0 2px 8px rgba(0,0,0,.08);
      font-family: system-ui, -apple-system, sans-serif;
      pointer-events: all;
    }
    #_tourCard ._tb {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 4px; border-radius: 7px; font-weight: 600;
      font-size: 13px; cursor: pointer; border: none;
      padding: 8px 16px; font-family: inherit;
      transition: opacity .15s, background .15s;
    }
    #_tourCard ._tb:hover { opacity: .85; }
    #_tourCard ._pri { background: var(--blue, #2563EB); color: #fff; }
    #_tourCard ._sec {
      background: transparent; color: var(--text-2, #52525B);
      border: 1px solid var(--border, #e2ddd7);
    }
    #_tourCard ._skip {
      background: none; border: none; cursor: pointer;
      font-size: 12px; color: var(--text-3, #a1a1aa);
      font-family: inherit; padding: 0; line-height: 1;
      transition: color .15s;
    }
    #_tourCard ._skip:hover { color: var(--text-2, #52525b); }
    #_tourCard ._dot {
      width: 6px; height: 6px; border-radius: 99px;
      background: var(--border, #e2ddd7);
      transition: all .22s; flex-shrink: 0;
    }
    #_tourCard ._dot._on {
      width: 18px; background: var(--blue, #2563EB);
    }
  `;
  document.head.appendChild(style);

  /* ── Tour class ───────────────────────────────────────────── */
  class Tour {
    constructor(steps, lsKey) {
      this.steps = steps;
      this.key   = lsKey;
      this.cur   = 0;
      this._el   = null;   // highlighted element
      this._card = null;
      this._orig = {};     // original inline styles of highlighted el
    }

    shouldShow() {
      return !localStorage.getItem(this.key);
    }

    start(force = false) {
      if (!force && !this.shouldShow()) return;
      this.cur = 0;
      // Remove leftover card from a previous run
      document.getElementById('_tourCard')?.remove();
      this._card = document.createElement('div');
      this._card.id = '_tourCard';
      document.body.appendChild(this._card);
      this._render();
    }

    _render() {
      this._clearHi();
      const step  = this.steps[this.cur];
      const total = this.steps.length;

      // Optional per-step setup (e.g. switch tab)
      step.before?.();

      const target = typeof step.target === 'string'
        ? document.querySelector(step.target)
        : (step.target instanceof Element ? step.target : null);

      if (!target) {
        // Skip missing elements gracefully
        if (this.cur < total - 1) { this.cur++; this._render(); }
        else this.finish();
        return;
      }

      // Scroll target into view smoothly, then highlight + position
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      setTimeout(() => {
        this._applyHi(target);
        this._paint(step, total);
        // Two rAFs to let the browser measure the card after paint
        requestAnimationFrame(() =>
          requestAnimationFrame(() => this._place(target))
        );
      }, 250);
    }

    _applyHi(el) {
      this._el = el;
      this._orig = { position: el.style.position, zIndex: el.style.zIndex };
      el.classList.add('tour-hi');
    }

    _clearHi() {
      if (this._el) {
        this._el.classList.remove('tour-hi');
        this._el.style.position = this._orig.position || '';
        this._el.style.zIndex   = this._orig.zIndex   || '';
        this._el = null;
      }
    }

    _paint(step, total) {
      const isFirst = this.cur === 0;
      const isLast  = this.cur === total - 1;

      this._card.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="display:flex;gap:5px;align-items:center;">
            ${this.steps.map((_, i) =>
              `<div class="_dot${i === this.cur ? ' _on' : ''}"></div>`
            ).join('')}
          </div>
          <button class="_skip" id="_ts">Pular tutorial</button>
        </div>
        <p style="font-size:11px;font-weight:700;color:var(--blue,#2563EB);
                  text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px;">
          ${step.title}
        </p>
        <p style="font-size:13px;color:var(--text-2,#52525B);
                  line-height:1.65;margin-bottom:18px;">
          ${step.text}
        </p>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          ${!isFirst
            ? `<button class="_tb _sec" id="_tp">← Anterior</button>`
            : `<div></div>`}
          ${!isLast
            ? `<button class="_tb _pri" id="_tn">Próximo →</button>`
            : `<button class="_tb _pri" id="_tf">Concluir ✓</button>`}
        </div>
      `;

      document.getElementById('_ts')?.addEventListener('click', () => this.finish());
      document.getElementById('_tp')?.addEventListener('click', () => { this.cur--; this._render(); });
      document.getElementById('_tn')?.addEventListener('click', () => { this.cur++; this._render(); });
      document.getElementById('_tf')?.addEventListener('click', () => this.finish());
    }

    _place(target) {
      if (!this._card) return;
      const r   = target.getBoundingClientRect();
      const cw  = this._card.offsetWidth;
      const ch  = this._card.offsetHeight;
      const vw  = window.innerWidth;
      const vh  = window.innerHeight;
      const gap = 14;
      const pad = 10;

      // Vertical: prefer below → above → best fit
      let top;
      if (r.bottom + ch + gap + pad <= vh) {
        top = r.bottom + gap;
      } else if (r.top - ch - gap >= pad) {
        top = r.top - ch - gap;
      } else {
        top = Math.max(pad, Math.min(vh / 2 - ch / 2, vh - ch - pad));
      }

      // Horizontal: center over target, clamp to viewport
      let left = r.left + r.width / 2 - cw / 2;
      left = Math.max(pad, Math.min(left, vw - cw - pad));

      this._card.style.top  = top  + 'px';
      this._card.style.left = left + 'px';
    }

    finish() {
      localStorage.setItem(this.key, '1');
      this._cleanup();
    }

    _cleanup() {
      this._clearHi();
      this._card?.remove();
      this._card = null;
    }
  }

  window.Tour = Tour;
})();
