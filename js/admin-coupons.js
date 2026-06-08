// ─── Admin Coupons ────────────────────────────────────────────────────────────
let _coupons       = [];
let _editingId     = null;
let _couponsLoaded = false;

// ─── Load & Render ────────────────────────────────────────────────────────────

window.loadCoupons = async function () {
  const wrap = document.getElementById('couponsTableWrap');
  if (wrap) wrap.innerHTML = '<p style="color:var(--text-3);padding:24px;text-align:center;">Carregando…</p>';

  const { data, error } = await db
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Erro ao carregar cupons: ' + error.message);
    return;
  }

  _coupons = data || [];
  _couponsLoaded = true;
  renderCoupons(_coupons);
};

function renderCoupons(list) {
  const wrap = document.getElementById('couponsTableWrap');
  if (!wrap) return;

  if (list.length === 0) {
    wrap.innerHTML = '<p style="color:var(--text-3);padding:32px;text-align:center;">Nenhum cupom cadastrado.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="w-full" style="min-width:640px;">
      <thead style="background:var(--bg);border-bottom:1px solid var(--border);">
        <tr>
          <th>Código</th>
          <th>Desconto</th>
          <th>Usos</th>
          <th>Pacotes</th>
          <th>Validade</th>
          <th>Status</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(_couponRow).join('')}
      </tbody>
    </table>`;
}

function _couponRow(c) {
  const discount = c.discount_type === 'percentage'
    ? `${c.discount_value}%`
    : `R$ ${Number(c.discount_value).toFixed(2).replace('.', ',')}`;

  const uses = c.max_uses
    ? `${c.used_count}/${c.max_uses}`
    : `${c.used_count}/∞`;

  const packages = Array.isArray(c.valid_for_packages) && c.valid_for_packages.length
    ? c.valid_for_packages.join(', ')
    : 'Todos';

  const now = new Date();
  const expired = c.expires_at && new Date(c.expires_at) < now;
  const validity = c.expires_at
    ? new Date(c.expires_at).toLocaleDateString('pt-BR')
    : 'Sem validade';

  let statusClass, statusLabel;
  if (expired) {
    statusClass = 'status-failed'; statusLabel = 'Expirado';
  } else if (!c.is_active) {
    statusClass = 'status-pending'; statusLabel = 'Pausado';
  } else {
    statusClass = 'status-completed'; statusLabel = 'Ativo';
  }

  const canToggle = !expired;

  return `
    <tr>
      <td>
        <span style="font-weight:700;color:var(--text);font-family:monospace;font-size:13px;">${c.code}</span>
        ${c.description ? `<p style="font-size:11px;color:var(--text-3);margin-top:2px;">${c.description}</p>` : ''}
      </td>
      <td style="font-weight:600;color:var(--text);">${discount}</td>
      <td style="color:var(--text);">${uses}
        <span style="font-size:11px;color:var(--text-3);margin-left:4px;">(max ${c.max_uses_per_user}x/user)</span>
      </td>
      <td style="color:var(--text-2);font-size:13px;">${packages}</td>
      <td style="color:var(--text-2);font-size:13px;">${validity}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button onclick="openCouponModal(${JSON.stringify(JSON.stringify(c))})" class="btn-ghost">Editar</button>
          ${canToggle
            ? `<button onclick="toggleCouponActive('${c.id}',${c.is_active})" class="btn-ghost" style="${c.is_active ? 'color:#D97706;border-color:#FDE68A;' : 'color:var(--green);border-color:var(--green-bd);'}">${c.is_active ? 'Pausar' : 'Ativar'}</button>`
            : ''}
          <button onclick="deleteCoupon('${c.id}')" class="btn-danger">Excluir</button>
        </div>
      </td>
    </tr>`;
}

// ─── Modal create / edit ──────────────────────────────────────────────────────

window.openCouponModal = function (couponJson) {
  const coupon = couponJson ? JSON.parse(couponJson) : null;
  _editingId   = coupon?.id ?? null;

  const modal   = document.getElementById('couponModal');
  const title   = document.getElementById('couponModalTitle');
  const saveBtn = document.getElementById('btnSaveCoupon');

  title.textContent   = coupon ? 'Editar cupom' : 'Novo cupom';
  saveBtn.textContent = coupon ? 'Salvar alterações' : 'Criar cupom';

  document.getElementById('cfCode').value          = coupon?.code          ?? '';
  document.getElementById('cfDesc').value          = coupon?.description   ?? '';
  document.getElementById('cfType').value          = coupon?.discount_type ?? 'percentage';
  document.getElementById('cfValue').value         = coupon?.discount_value ?? '';
  document.getElementById('cfMaxUses').value       = coupon?.max_uses       ?? '';
  document.getElementById('cfMaxPerUser').value    = coupon?.max_uses_per_user ?? 1;
  document.getElementById('cfStripeId').value      = coupon?.stripe_coupon_id ?? '';
  document.getElementById('cfExpires').value       = coupon?.expires_at
    ? new Date(coupon.expires_at).toISOString().slice(0, 10) : '';

  // Pacotes: checkboxes
  ['5','10','20','50'].forEach(v => {
    const cb = document.getElementById('cfPkg' + v);
    if (cb) cb.checked = !coupon?.valid_for_packages
      || coupon.valid_for_packages.includes(v);
  });

  document.getElementById('couponModalMsg').classList.add('hidden');
  modal.style.display = 'flex';
};

window.closeCouponModal = function () {
  document.getElementById('couponModal').style.display = 'none';
  _editingId = null;
};

window.saveCoupon = async function () {
  const code  = document.getElementById('cfCode').value.trim().toUpperCase();
  const type  = document.getElementById('cfType').value;
  const value = parseFloat(document.getElementById('cfValue').value);

  if (!code) return _couponModalMsg('Informe o código do cupom.', 'error');
  if (!/^[A-Z0-9_-]{2,24}$/.test(code))
    return _couponModalMsg('Código inválido. Use letras maiúsculas, números, _ ou - (2–24 chars).', 'error');
  if (isNaN(value) || value <= 0)
    return _couponModalMsg('Informe um valor de desconto válido.', 'error');
  if (type === 'percentage' && value > 100)
    return _couponModalMsg('Desconto percentual não pode exceder 100%.', 'error');

  const maxUses     = parseInt(document.getElementById('cfMaxUses').value, 10) || null;
  const maxPerUser  = parseInt(document.getElementById('cfMaxPerUser').value, 10) || 1;
  const expiresRaw  = document.getElementById('cfExpires').value;
  const stripeId    = document.getElementById('cfStripeId').value.trim() || null;
  const desc        = document.getElementById('cfDesc').value.trim() || null;

  const checkedPkgs = ['5','10','20','50'].filter(v =>
    document.getElementById('cfPkg' + v)?.checked
  );
  const pkgs = checkedPkgs.length === 4 ? null : checkedPkgs;

  const payload = {
    code,
    description:        desc,
    discount_type:      type,
    discount_value:     value,
    stripe_coupon_id:   stripeId,
    valid_for_packages: pkgs,
    max_uses:           maxUses,
    max_uses_per_user:  maxPerUser,
    expires_at:         expiresRaw ? new Date(expiresRaw).toISOString() : null,
  };

  const btn = document.getElementById('btnSaveCoupon');
  setLoading(btn, true, 'Salvando…');

  let error;
  if (_editingId) {
    ({ error } = await db.from('coupons').update(payload).eq('id', _editingId));
  } else {
    ({ error } = await db.from('coupons').insert(payload));
  }

  setLoading(btn, false);

  if (error) {
    const msg = error.code === '23505'
      ? 'Já existe um cupom com esse código.'
      : 'Erro: ' + error.message;
    return _couponModalMsg(msg, 'error');
  }

  showToast(_editingId ? 'Cupom atualizado!' : 'Cupom criado!', 'success');
  closeCouponModal();
  loadCoupons();
};

// ─── Toggle & Delete ──────────────────────────────────────────────────────────

window.toggleCouponActive = async function (id, isActive) {
  const label = isActive ? 'pausar' : 'ativar';
  if (!confirm(`Deseja ${label} este cupom?`)) return;

  const { error } = await db.from('coupons')
    .update({ is_active: !isActive })
    .eq('id', id);

  if (error) { showToast('Erro: ' + error.message); return; }
  showToast(isActive ? 'Cupom pausado.' : 'Cupom ativado!', 'success');
  loadCoupons();
};

window.deleteCoupon = async function (id) {
  if (!confirm('Excluir este cupom permanentemente? Os registros de uso também serão removidos.')) return;

  const { error } = await db.from('coupons').delete().eq('id', id);
  if (error) { showToast('Erro: ' + error.message); return; }
  showToast('Cupom excluído.', 'success');
  loadCoupons();
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function _couponModalMsg(msg, type) {
  const el = document.getElementById('couponModalMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.background = type === 'success' ? 'var(--green-bg)' : 'var(--red-bg)';
  el.style.color       = type === 'success' ? 'var(--green)'   : 'var(--red)';
  el.style.border      = `1px solid ${type === 'success' ? 'var(--green-bd)' : 'var(--red-bd)'}`;
  el.classList.remove('hidden');
}
