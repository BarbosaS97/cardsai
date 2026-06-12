// ─── Admin Email Marketing ────────────────────────────────────────────────────

let _emailSends = [];
let _emailLoaded = false;
let _pixBuyerIds = new Set();

// ─── Load & Render ────────────────────────────────────────────────────────────

window.loadEmailMarketing = async function () {
  await Promise.all([loadEmailHistory(), _loadPixBuyers()]);
  updateEmailRecipientCount();
};

async function _loadPixBuyers() {
  const { data } = await db
    .from('pix_charges')
    .select('user_id')
    .eq('status', 'completed');
  _pixBuyerIds = new Set((data || []).map(r => r.user_id).filter(Boolean));
}

window.loadEmailHistory = async function () {
  const wrap = document.getElementById('emailHistoryWrap');
  if (wrap) wrap.innerHTML = '<p style="color:var(--text-3);padding:24px;text-align:center;">Carregando…</p>';

  const { data, error } = await db
    .from('email_marketing_sends')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (wrap) wrap.innerHTML = `<p style="color:var(--red);padding:32px;text-align:center;">Erro ao carregar: ${escHtml(error.message)}</p>`;
    return;
  }

  _emailSends = data || [];
  _emailLoaded = true;
  _renderEmailHistory(_emailSends);
};

function _renderEmailHistory(list) {
  const wrap = document.getElementById('emailHistoryWrap');
  if (!wrap) return;

  if (list.length === 0) {
    wrap.innerHTML = '<p style="color:var(--text-3);padding:32px;text-align:center;">Nenhum envio registrado ainda.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="w-full" style="min-width:680px;">
      <thead style="background:var(--bg);border-bottom:1px solid var(--border);">
        <tr>
          <th>Assunto</th>
          <th>Data</th>
          <th>Total</th>
          <th>Enviados</th>
          <th>Erros</th>
          <th>Status</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(_emailRow).join('')}
      </tbody>
    </table>`;
}

function _emailRow(s) {
  const date = new Date(s.sent_at || s.created_at).toLocaleString('pt-BR');

  const statusClass = s.status === 'completed' ? 'status-completed'
    : s.status === 'sending'   ? 'status-processing'
    : 'status-failed';

  const statusLabel = s.is_test    ? 'Teste'
    : s.status === 'completed'     ? 'Enviado'
    : s.status === 'sending'       ? 'Enviando…'
    : 'Falhou';

  return `
    <tr>
      <td>
        <p style="font-weight:500;color:var(--text);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(s.title)}">${escHtml(s.title)}</p>
        ${s.is_test ? '<span style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;">Teste</span>' : ''}
      </td>
      <td style="color:var(--text-2);font-size:13px;">${date}</td>
      <td style="color:var(--text);font-weight:500;">${s.is_test ? '—' : s.total_recipients}</td>
      <td style="color:var(--green);font-weight:600;">${s.sent_count}</td>
      <td style="${s.error_count > 0 ? 'color:var(--red);font-weight:600;' : 'color:var(--text-3);'}">${s.error_count}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button onclick="_emailPreview('${s.id}')" class="btn-ghost">Prévia</button>
          <button onclick="_emailReuse('${s.id}')" class="btn-ghost">Reenviar</button>
          <button onclick="_emailDelete('${s.id}')" class="btn-danger">Excluir</button>
        </div>
      </td>
    </tr>`;
}

// ─── History actions ──────────────────────────────────────────────────────────

window._emailPreview = function (id) {
  const s = _emailSends.find(x => x.id === id);
  if (s) _openEmailPreviewModal(s.title, s.html_body);
};

window._emailReuse = function (id) {
  const s = _emailSends.find(x => x.id === id);
  if (!s) return;
  document.getElementById('emailTitle').value = s.title;
  document.getElementById('emailBody').value  = s.html_body;
  document.getElementById('emailComposeSection').scrollIntoView({ behavior: 'smooth' });
  showToast('Conteúdo carregado — revise e envie novamente.', 'info');
};

window._emailDelete = async function (id) {
  if (!confirm('Excluir este registro permanentemente?')) return;
  const { error } = await db.from('email_marketing_sends').delete().eq('id', id);
  if (error) { showToast('Erro: ' + error.message); return; }
  showToast('Registro excluído.', 'success');
  loadEmailHistory();
};

// ─── Preview modal ────────────────────────────────────────────────────────────

function _openEmailPreviewModal(title, body) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(title)}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <div style="background:#2563EB;padding:24px 32px;">
    <span style="color:#fff;font-size:18px;font-weight:700;">CardsQuestõesAI</span>
  </div>
  <div style="padding:32px;color:#18181B;font-size:15px;line-height:1.65;">${body}</div>
  <div style="border-top:1px solid #e5e7eb;padding:20px 32px;background:#f9fafb;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      Você recebeu este e-mail por ser cadastrado em
      <a href="https://cardsquestoes.com.br" style="color:#2563EB;text-decoration:none;">cardsquestoes.com.br</a>.
    </p>
  </div>
</div>
</body></html>`;

  const modal = document.getElementById('emailPreviewModal');
  const frame = document.getElementById('emailPreviewFrame');
  frame.srcdoc = html;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

window.closeEmailPreviewModal = function () {
  const modal = document.getElementById('emailPreviewModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
};

// ─── Filters ──────────────────────────────────────────────────────────────────

window.onEmailFilterChange = function () {
  updateEmailRecipientCount();
};

function _getFilteredIds() {
  const f = {
    withPurchase: !!document.getElementById('filterWithPurchase')?.checked,
    noPurchase:   !!document.getElementById('filterNoPurchase')?.checked,
    active:       !!document.getElementById('filterActive')?.checked,
    inactive:     !!document.getElementById('filterInactive')?.checked,
    reg7d:        !!document.getElementById('filterReg7d')?.checked,
    reg30d:       !!document.getElementById('filterReg30d')?.checked,
    reg90d:       !!document.getElementById('filterReg90d')?.checked,
  };

  if (!Object.values(f).some(Boolean)) return null; // null = todos

  const now = Date.now();
  const ms7d  =  7 * 86400000;
  const ms30d = 30 * 86400000;
  const ms90d = 90 * 86400000;

  const recentGenUserIds = new Set(
    allGens
      .filter(g => now - new Date(g.created_at).getTime() <= ms30d)
      .map(g => g.user_id)
  );

  return allUsers
    .filter(u => {
      const age         = now - new Date(u.created_at).getTime();
      const hasPurchase = _pixBuyerIds.has(u.id);
      const isActive    = recentGenUserIds.has(u.id);

      if (f.withPurchase && hasPurchase)               return true;
      if (f.noPurchase   && !hasPurchase)              return true;
      if (f.active       && isActive)                  return true;
      if (f.inactive     && !isActive && age > ms30d)  return true;
      if (f.reg7d        && age <= ms7d)               return true;
      if (f.reg30d       && age <= ms30d)              return true;
      if (f.reg90d       && age <= ms90d)              return true;
      return false;
    })
    .map(u => u.id);
}

function updateEmailRecipientCount() {
  const filteredIds  = _getFilteredIds();
  const previewEl    = document.getElementById('emailRecipientPreview');
  const badgeEl      = document.getElementById('emailFilterBadge');
  const btnSend      = document.getElementById('btnSendMass');

  const consentedSet = new Set(
    allUsers.filter(u => u.marketing_consent === true).map(u => u.id)
  );

  let count;
  if (filteredIds === null) {
    count = consentedSet.size;
    if (badgeEl) badgeEl.textContent = 'Todos';
    if (btnSend) btnSend.textContent = 'Enviar para todos →';
  } else {
    count = filteredIds.filter(id => consentedSet.has(id)).length;
    if (badgeEl) badgeEl.textContent = `${count} usuário(s)`;
    if (btnSend) btnSend.textContent = `Enviar para ${count} usuário(s) →`;
  }

  if (previewEl) {
    previewEl.innerHTML =
      `Você está prestes a enviar para <strong>${count}</strong> usuário(s) com e-mail marketing ativo`;
  }
}

// ─── Compose actions ──────────────────────────────────────────────────────────

window.previewEmailDraft = function () {
  const title = document.getElementById('emailTitle').value.trim() || '(sem assunto)';
  const body  = document.getElementById('emailBody').value.trim()  || '(sem conteúdo)';
  _openEmailPreviewModal(title, body);
};

window.sendTestEmail = async function () {
  const title    = document.getElementById('emailTitle').value.trim();
  const htmlBody = document.getElementById('emailBody').value.trim();

  if (!title || !htmlBody) {
    showToast('Preencha o assunto e a mensagem antes de enviar.', 'error');
    return;
  }

  const btn = document.getElementById('btnTestEmail');
  setLoading(btn, true, 'Enviando…');

  try {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(SEND_MASS_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ title, html_body: htmlBody, is_test: true }),
    });

    const result = await res.json();
    setLoading(btn, false);

    if (!res.ok || result.error) {
      showToast('Erro: ' + (result.error || 'Falha no envio'));
      return;
    }

    showToast('Teste enviado! Verifique seu e-mail.', 'success');
  } catch (e) {
    setLoading(btn, false);
    showToast('Erro inesperado: ' + (e.message || e));
  }
};

window.sendMassEmail = async function () {
  const title    = document.getElementById('emailTitle').value.trim();
  const htmlBody = document.getElementById('emailBody').value.trim();

  if (!title || !htmlBody) {
    showToast('Preencha o assunto e a mensagem antes de enviar.', 'error');
    return;
  }

  const filteredIds  = _getFilteredIds();
  const consentedSet = new Set(
    allUsers.filter(u => u.marketing_consent === true).map(u => u.id)
  );
  const count = filteredIds === null
    ? consentedSet.size
    : filteredIds.filter(id => consentedSet.has(id)).length;

  const targetLabel = filteredIds === null
    ? 'todos os usuários com e-mail marketing ativo'
    : `${count} usuário(s) filtrado(s)`;

  if (!confirm(
    `Você está prestes a enviar este e-mail para ${targetLabel}.\n\n` +
    `Assunto: "${title}"\n\n` +
    `Deseja continuar? Esta ação não pode ser desfeita.`
  )) return;

  const btn = document.getElementById('btnSendMass');
  setLoading(btn, true, 'Enviando…');

  try {
    const { data: { session } } = await db.auth.getSession();
    const payload = { title, html_body: htmlBody, is_test: false };
    if (filteredIds !== null) payload.recipient_user_ids = filteredIds;

    const res = await fetch(SEND_MASS_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    setLoading(btn, false);
    updateEmailRecipientCount();

    if (!res.ok || result.error) {
      showToast('Erro: ' + (result.error || 'Falha no envio'));
      return;
    }

    showToast(
      `Concluído! Enviados: ${result.sent}/${result.total}${result.errors > 0 ? ` · Erros: ${result.errors}` : ''}`,
      result.errors > 0 ? 'warning' : 'success'
    );

    document.getElementById('emailTitle').value = '';
    document.getElementById('emailBody').value  = '';
    await loadEmailHistory();
  } catch (e) {
    setLoading(btn, false);
    updateEmailRecipientCount();
    showToast('Erro inesperado: ' + (e.message || e));
  }
};
