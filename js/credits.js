// ─── State ───────────────────────────────────────────────────────────────────
let _pkg = { qty: 0, priceRaw: 0, priceStr: '', priceId: '' };
let _coupon = null;
let _paymentMethod = 'card';
let _pixCorrelationId = null;
let _pixPollTimer = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _brl(value) {
  return 'R$ ' + value.toFixed(2).replace('.', ',');
}

function _el(id) {
  return document.getElementById(id);
}

function _setCouponMsg(msg, type) {
  const err = _el('couponError');
  const ok  = _el('couponApplied');
  if (!err || !ok) return;
  if (type === 'error') {
    err.textContent = msg;
    err.classList.remove('hidden');
    ok.classList.add('hidden');
  } else {
    ok.querySelector('#couponAppliedText').textContent = msg;
    ok.classList.remove('hidden');
    err.classList.add('hidden');
  }
}

function _clearCouponMsg() {
  const err = _el('couponError');
  const ok  = _el('couponApplied');
  if (err) err.classList.add('hidden');
  if (ok)  ok.classList.add('hidden');
}

function _updatePricing() {
  const mOrig   = _el('mOriginalPrice');
  const mDRow   = _el('mDiscountRow');
  const mDLabel = _el('mDiscountLabel');
  const mDValue = _el('mDiscountValue');
  const mTotal  = _el('mPrice');

  if (!mTotal) return;
  if (mOrig) mOrig.textContent = _pkg.priceStr;

  if (!_coupon) {
    if (mDRow) mDRow.classList.add('hidden');
    mTotal.textContent = _pkg.priceStr;
    return;
  }

  const discount = _coupon.discount_type === 'percentage'
    ? _pkg.priceRaw * (_coupon.discount_value / 100)
    : Math.min(Number(_coupon.discount_value), _pkg.priceRaw);

  const finalPrice = Math.max(0, _pkg.priceRaw - discount);

  if (mDLabel) {
    mDLabel.textContent = _coupon.discount_type === 'percentage'
      ? `Desconto (${_coupon.code} −${_coupon.discount_value}%)`
      : `Desconto (${_coupon.code})`;
  }
  if (mDValue) mDValue.textContent = '−' + _brl(discount);
  if (mDRow)   mDRow.classList.remove('hidden');
  mTotal.textContent = _brl(finalPrice);
}

function _resetPixUI() {
  _el('pixBeforeQR')?.classList.remove('hidden');
  _el('pixQRSection')?.classList.add('hidden');
  _el('pixSuccess')?.classList.add('hidden');
  const btn = _el('btnPixGenerate');
  if (btn) { btn.disabled = false; btn.textContent = 'Gerar QR Code PIX'; }
}

// ─── API pública ─────────────────────────────────────────────────────────────

window.initCouponModal = function (qty, priceRaw, priceStr, priceId) {
  _pkg    = { qty, priceRaw, priceStr, priceId };
  _coupon = null;
  _paymentMethod = 'card';

  if (_pixPollTimer) { clearInterval(_pixPollTimer); _pixPollTimer = null; }
  _pixCorrelationId = null;

  const input = _el('couponInput');
  if (input) input.value = '';
  _clearCouponMsg();
  _updatePricing();
  _resetPixUI();

  // Reset payment method tabs to card
  _el('tabCard')?.classList.add('pm-active');
  _el('tabPix')?.classList.remove('pm-active');
  _el('sectionCard')?.classList.remove('hidden');
  _el('sectionPix')?.classList.add('hidden');
};

window.applyCoupon = async function () {
  const input = _el('couponInput');
  const code  = (input?.value || '').trim().toUpperCase();
  if (!code) return;

  const btn = _el('btnApplyCoupon');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
  _clearCouponMsg();

  try {
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;

    const res = await fetch(VALIDATE_COUPON_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ code, package_size: _pkg.qty }),
    });

    const result = await res.json();
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }

    if (!result.valid) {
      _setCouponMsg(result.error || 'Cupom inválido', 'error');
      return;
    }

    _coupon = result;
    _updatePricing();

    const pct = result.discount_type === 'percentage'
      ? `${result.discount_value}%`
      : _brl(result.discount_value);
    _setCouponMsg(`Cupom "${result.code}" aplicado! Desconto de ${pct}`, 'ok');

  } catch (_e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }
    _setCouponMsg('Erro ao validar cupom. Tente novamente.', 'error');
  }
};

window.removeCoupon = function () {
  _coupon = null;
  const input = _el('couponInput');
  if (input) input.value = '';
  _clearCouponMsg();
  _updatePricing();
};

window.selectPaymentMethod = function (method) {
  _paymentMethod = method;

  if (method === 'card') {
    _el('tabCard')?.classList.add('pm-active');
    _el('tabPix')?.classList.remove('pm-active');
    _el('sectionCard')?.classList.remove('hidden');
    _el('sectionPix')?.classList.add('hidden');
  } else {
    _el('tabPix')?.classList.add('pm-active');
    _el('tabCard')?.classList.remove('pm-active');
    _el('sectionCard')?.classList.add('hidden');
    _el('sectionPix')?.classList.remove('hidden');
    _resetPixUI();
  }
};

window.startCheckout = async function () {
  const btn = _el('btnCheckout');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecionando…'; }

  try {
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;

    const res = await fetch(STRIPE_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        credits: _pkg.qty,
        priceId: _pkg.priceId,
        couponCode: _coupon?.code ?? null,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.url) {
      if (btn) { btn.disabled = false; btn.textContent = 'Pagar com Cartão'; }
      showToast(data.error || 'Erro ao iniciar checkout. Tente novamente.', 'error');
      return;
    }

    window.location.href = data.url;

  } catch (_e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Pagar com Cartão'; }
    showToast('Erro ao conectar com o servidor. Tente novamente.', 'error');
  }
};

window.startPixCheckout = async function () {
  const btn = _el('btnPixGenerate');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando QR Code…'; }

  try {
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;

    const res = await fetch(PIX_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        credits: _pkg.qty,
        priceRaw: _pkg.priceRaw,
        couponCode: _coupon?.code ?? null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (btn) { btn.disabled = false; btn.textContent = 'Gerar QR Code PIX'; }
      showToast(data.error || 'Erro ao gerar QR Code PIX.', 'error');
      return;
    }

    _pixCorrelationId = data.correlationID;

    _el('pixBeforeQR')?.classList.add('hidden');
    _el('pixQRSection')?.classList.remove('hidden');

    const img = _el('pixQRImage');
    if (img && data.qrCodeImage) img.src = data.qrCodeImage;

    const brCodeEl = _el('pixBrCode');
    if (brCodeEl) brCodeEl.textContent = data.brCode || '';

    const expiryEl = _el('pixExpiry');
    if (expiryEl && data.expiresDate) {
      const mins = Math.max(1, Math.round((new Date(data.expiresDate) - new Date()) / 60000));
      expiryEl.textContent = `QR Code válido por ${mins} minuto${mins !== 1 ? 's' : ''}`;
    }

    _pixPollTimer = setInterval(_pollPixStatus, 5000);

  } catch (_e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Gerar QR Code PIX'; }
    showToast('Erro ao conectar com o servidor.', 'error');
  }
};

async function _pollPixStatus() {
  if (!_pixCorrelationId) return;

  try {
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;

    const res = await fetch(PIX_STATUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ correlationId: _pixCorrelationId }),
    });

    const data = await res.json();

    if (data.status === 'completed') {
      clearInterval(_pixPollTimer);
      _pixPollTimer = null;
      _pixCorrelationId = null;
      _el('pixQRSection')?.classList.add('hidden');
      _el('pixSuccess')?.classList.remove('hidden');
    } else if (data.status === 'expired') {
      clearInterval(_pixPollTimer);
      _pixPollTimer = null;
      _pixCorrelationId = null;
      _resetPixUI();
      showToast('QR Code PIX expirado. Gere um novo.', 'info');
    }
  } catch (_e) {
    // Ignore transient polling errors
  }
}

window.copyPixCode = function () {
  const code = _el('pixBrCode')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code)
    .then(() => showToast('Código PIX copiado!', 'success'))
    .catch(() => showToast('Não foi possível copiar automaticamente.', 'info'));
};

window.cleanupPixPolling = function () {
  if (_pixPollTimer) { clearInterval(_pixPollTimer); _pixPollTimer = null; }
};
