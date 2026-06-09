// ─── State ───────────────────────────────────────────────────────────────────
let _pkg = { qty: 0, priceRaw: 0, priceStr: '', priceId: '' };
let _coupon = null;

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

// ─── API pública ─────────────────────────────────────────────────────────────

window.initCouponModal = function (qty, priceRaw, priceStr, priceId) {
  _pkg    = { qty, priceRaw, priceStr, priceId };
  _coupon = null;

  const input = _el('couponInput');
  if (input) input.value = '';
  _clearCouponMsg();
  _updatePricing();
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
        stripeCouponId: _coupon?.stripe_coupon_id ?? null,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.url) {
      if (btn) { btn.disabled = false; btn.textContent = 'Pagar com Stripe'; }
      showToast(data.error || 'Erro ao iniciar checkout. Tente novamente.', 'error');
      return;
    }

    window.location.href = data.url;

  } catch (_e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Pagar com Stripe'; }
    showToast('Erro ao conectar com o servidor. Tente novamente.', 'error');
  }
};
