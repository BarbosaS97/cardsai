// ─── Admin Plan Promotion ─────────────────────────────────────────────────────

let _planPromoUserId = null;

// Retorna badge HTML com o plano atual do usuário (para exibir na tabela)
function getPlanBadge(u) {
  const now = new Date();
  if (u.is_admin || u.unlimited_access) return '';
  if (
    u.subscription_status === 'active' &&
    u.subscription_end_date &&
    new Date(u.subscription_end_date) > now
  ) {
    const label = u.subscription_plan === 'pro_annual' ? 'Pro Anual' : 'Pro Mensal';
    const end   = new Date(u.subscription_end_date).toLocaleDateString('pt-BR');
    return `<span style="font-size:10px;font-weight:600;color:#7C3AED;background:#F5F3FF;padding:2px 7px;border-radius:4px;border:1px solid #DDD6FE;">${label} · ${end}</span>`;
  }
  if (u.pro_features_until && new Date(u.pro_features_until) > now) {
    const end = new Date(u.pro_features_until).toLocaleDateString('pt-BR');
    return `<span style="font-size:10px;font-weight:600;color:#15803D;background:#F0FDF4;padding:2px 7px;border-radius:4px;border:1px solid #BBF7D0;">Bônus Pro · ${end}</span>`;
  }
  if (u.credits > 0) {
    return `<span style="font-size:10px;font-weight:600;color:#15803D;background:#F0FDF4;padding:2px 7px;border-radius:4px;border:1px solid #BBF7D0;">Créditos avulsos</span>`;
  }
  return `<span style="font-size:10px;font-weight:600;color:var(--text-3);background:var(--surface-2);padding:2px 7px;border-radius:4px;border:1px solid var(--border);">Grátis</span>`;
}

function _getPlanCurrentText(u) {
  const now = new Date();
  if (u.is_admin || u.unlimited_access) return 'Admin / Acesso ilimitado';
  if (
    u.subscription_status === 'active' &&
    u.subscription_end_date &&
    new Date(u.subscription_end_date) > now
  ) {
    const label = u.subscription_plan === 'pro_annual' ? 'Pro Anual' : 'Pro Mensal';
    return `${label} · expira ${new Date(u.subscription_end_date).toLocaleDateString('pt-BR')}`;
  }
  if (u.pro_features_until && new Date(u.pro_features_until) > now) {
    return `Bônus Pro até ${new Date(u.pro_features_until).toLocaleDateString('pt-BR')} · ${u.credits} crédito(s)`;
  }
  if (u.credits > 0) return `Créditos avulsos · ${u.credits} crédito(s)`;
  return 'Grátis';
}

// ─── Modal ────────────────────────────────────────────────────────────────────

window.openPlanPromoModal = function (userId) {
  _planPromoUserId = userId;
  const user = (typeof allUsers !== 'undefined' ? allUsers : []).find(u => u.id === userId);

  document.getElementById('planPromoEmail').textContent   = user?.email ?? '—';
  document.getElementById('planPromoCurrent').textContent = 'Plano atual: ' + _getPlanCurrentText(user || {});

  document.getElementById('planPromoSelect').value = 'pro_monthly';
  document.getElementById('planPromoCreditsInput').value = '5';
  document.getElementById('planPromoStartDate').value = '';
  document.getElementById('planPromoEndDate').value   = '';
  document.getElementById('planPromoMsg').classList.add('hidden');

  onPlanPromoChange();
  document.getElementById('planPromoModal').style.display = 'flex';
};

window.closePlanPromoModal = function () {
  document.getElementById('planPromoModal').style.display = 'none';
  _planPromoUserId = null;
};

window.onPlanPromoChange = function () {
  const plan      = document.getElementById('planPromoSelect').value;
  const isPro     = plan === 'pro_monthly' || plan === 'pro_annual';
  const isCredits = plan === 'credits';

  document.getElementById('planPromoDaysRow').style.display      = isPro             ? '' : 'none';
  document.getElementById('planPromoDateRow').style.display      = (isPro || isCredits) ? '' : 'none';
  document.getElementById('planPromoStartDateWrap').style.display = isPro            ? '' : 'none';
  document.getElementById('planPromoCreditsRow').style.display   = isCredits         ? '' : 'none';
  document.getElementById('planPromoFreeWarn').style.display     = plan === 'free'   ? '' : 'none';

  if (isPro) {
    document.getElementById('planPromoDateLabel').innerHTML =
      'Datas personalizadas <span style="font-weight:400;text-transform:none;">(opcional)</span>';
    document.getElementById('planPromoEndDateLabel').textContent = 'Data de fim';
    document.getElementById('planPromoDateHint').textContent =
      'Se preenchidas, substituem os dias acima. Deixe em branco para usar hoje + dias.';
  } else if (isCredits) {
    document.getElementById('planPromoDateLabel').innerHTML =
      'Bônus Pro até <span style="font-weight:400;text-transform:none;">(opcional)</span>';
    document.getElementById('planPromoEndDateLabel').textContent = 'Data de validade do bônus';
    document.getElementById('planPromoDateHint').textContent =
      'Data em que o acesso Pro de bônus expira. Padrão: +30 dias a partir de hoje.';
  }

  if (plan === 'pro_monthly') {
    document.getElementById('planPromoDaysInput').value       = '30';
    document.getElementById('planPromoDaysHint').textContent  = 'Padrão: 30 dias';
  } else if (plan === 'pro_annual') {
    document.getElementById('planPromoDaysInput').value       = '365';
    document.getElementById('planPromoDaysHint').textContent  = 'Padrão: 365 dias';
  }
};

window.applyPlanPromo = async function () {
  if (!_planPromoUserId) return;

  const plan      = document.getElementById('planPromoSelect').value;
  const credits   = parseInt(document.getElementById('planPromoCreditsInput').value, 10) || 5;
  const daysRaw   = document.getElementById('planPromoDaysInput').value;
  const days      = daysRaw ? (parseInt(daysRaw, 10) || null) : null;
  const startRaw  = document.getElementById('planPromoStartDate')?.value || '';
  const endRaw    = document.getElementById('planPromoEndDate')?.value   || '';
  const startDate = startRaw ? new Date(startRaw).toISOString() : null;
  const endDate   = endRaw   ? new Date(endRaw + 'T23:59:59').toISOString() : null;

  const btn = document.getElementById('btnApplyPlanPromo');
  setLoading(btn, true, 'Aplicando…');
  document.getElementById('planPromoMsg').classList.add('hidden');

  const { error } = await db.rpc('admin_set_plan', {
    p_user_id:    _planPromoUserId,
    p_plan:       plan,
    p_credits:    credits,
    p_days:       days,
    p_start_date: startDate,
    p_end_date:   endDate,
  });

  setLoading(btn, false);

  if (error) {
    _planPromoShowMsg(error.message, 'error');
    return;
  }

  showToast('Plano aplicado com sucesso!', 'success');
  closePlanPromoModal();
  if (typeof loadData === 'function') await loadData();
};

function _planPromoShowMsg(msg, type) {
  const el = document.getElementById('planPromoMsg');
  if (!el) return;
  el.textContent       = msg;
  el.style.background  = type === 'success' ? 'var(--green-bg)' : 'var(--red-bg)';
  el.style.color       = type === 'success' ? 'var(--green)'    : 'var(--red)';
  el.style.border      = `1px solid ${type === 'success' ? 'var(--green-bd)' : 'var(--red-bd)'}`;
  el.classList.remove('hidden');
}
