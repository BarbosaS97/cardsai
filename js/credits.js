// ─── Coupon state ────────────────────────────────────────────────────────────
let _pkg = { qty: 0, priceRaw: 0, priceStr: '' };
let _coupon = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _brl(value) {
  return 'R$ ' + value.toFixed(2).replace('.', ',');
}

function _couponEl(id) {
  return document.getElementById(id);
}

function _setCouponMsg(msg, type) {
  const err = _couponEl('couponError');
  const ok  = _couponEl('couponApplied');
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
  const err = _couponEl('couponError');
  const ok  = _couponEl('couponApplied');
  if (err) err.classList.add('hidden');
  if (ok)  ok.classList.add('hidden');
}

function _updatePricing() {
  const mOrig     = _couponEl('mOriginalPrice');
  const mDRow     = _couponEl('mDiscountRow');
  const mDLabel   = _couponEl('mDiscountLabel');
  const mDValue   = _couponEl('mDiscountValue');
  const mTotal    = _couponEl('mPrice');
  const emailBtn  = _couponEl('modalEmailBtn');

  if (!mTotal) return;

  if (mOrig) mOrig.textContent = _pkg.priceStr;

  if (!_coupon) {
    if (mDRow) mDRow.classList.add('hidden');
    mTotal.textContent = _pkg.priceStr;
    _resetEmailBtn(_pkg.priceRaw, null);
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

  _resetEmailBtn(finalPrice, discount);
}

function _resetEmailBtn(finalPrice, discount) {
  const btn = _couponEl('modalEmailBtn');
  if (!btn) return;

  const qty  = _pkg.qty;
  let subject, body;

  if (_coupon && discount !== null) {
    subject = encodeURIComponent(
      `Compra de Créditos — ${qty} gerações (${_brl(finalPrice)} com cupom ${_coupon.code})`
    );
    body = encodeURIComponent(
      `Olá!\n\nGostaria de adquirir o pacote de ${qty} gerações.\n\n` +
      `Cupom: ${_coupon.code}\n` +
      `Preço original: ${_pkg.priceStr}\n` +
      `Desconto: −${_brl(discount)}\n` +
      `Total: ${_brl(finalPrice)}\n\n` +
      `Meu e-mail de conta: [informe seu e-mail aqui]`
    );
  } else {
    subject = encodeURIComponent(`Compra de Créditos — ${qty} gerações (${_pkg.priceStr})`);
    body = encodeURIComponent(
      `Olá!\n\nGostaria de adquirir o pacote de ${qty} gerações por ${_pkg.priceStr}.\n\n` +
      `Meu e-mail de conta: [informe seu e-mail aqui]`
    );
  }

  btn.href = `mailto:contato@cardsquestoes.com.br?subject=${subject}&body=${body}`;
}

// ─── API pública ─────────────────────────────────────────────────────────────

// Chamada pelo openModal() em pricing.html ao abrir o modal
window.initCouponModal = function (qty, priceRaw, priceStr) {
  _pkg    = { qty, priceRaw, priceStr };
  _coupon = null;

  const input = _couponEl('couponInput');
  if (input) input.value = '';
  _clearCouponMsg();
  _updatePricing();
};

window.applyCoupon = async function () {
  const input = _couponEl('couponInput');
  const code  = (input?.value || '').trim().toUpperCase();
  if (!code) return;

  const btn = _couponEl('btnApplyCoupon');
  if (btn) setLoading(btn, true, 'Verificando…');
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
    if (btn) setLoading(btn, false);

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
    if (btn) setLoading(btn, false);
    _setCouponMsg('Erro ao validar cupom. Tente novamente.', 'error');
  }
};

window.removeCoupon = function () {
  _coupon = null;
  const input = _couponEl('couponInput');
  if (input) input.value = '';
  _clearCouponMsg();
  _updatePricing();
};
