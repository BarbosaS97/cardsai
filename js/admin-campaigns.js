// ─── Admin Campaigns ──────────────────────────────────────────────────────────

let _campaigns         = [];
let _editingCampaignId = null;
let _campaignsLoaded   = false;

const _posLabels = {
  credits_page: 'Pág. de créditos',
  landing_page: 'Landing page',
  both:         'Ambas',
};

// ─── Load & Render ────────────────────────────────────────────────────────────

window.loadCampaigns = async function () {
  const wrap = document.getElementById('campaignsTableWrap');
  if (wrap) wrap.innerHTML = '<p style="color:var(--text-3);padding:24px;text-align:center;">Carregando…</p>';

  const { data, error } = await db
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Erro ao carregar campanhas: ' + error.message);
    return;
  }

  _campaigns       = data || [];
  _campaignsLoaded = true;
  renderCampaigns(_campaigns);
};

function renderCampaigns(list) {
  const wrap = document.getElementById('campaignsTableWrap');
  if (!wrap) return;

  if (list.length === 0) {
    wrap.innerHTML = '<p style="color:var(--text-3);padding:32px;text-align:center;">Nenhuma campanha cadastrada.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="w-full" style="min-width:640px;">
      <thead style="background:var(--bg);border-bottom:1px solid var(--border);">
        <tr>
          <th>Campanha</th>
          <th>Cupom</th>
          <th>Posição</th>
          <th>Status</th>
          <th>Criada em</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(_campaignRow).join('')}
      </tbody>
    </table>`;
}

function _campaignRow(c) {
  const posLabel    = _posLabels[c.posicao] || c.posicao;
  const statusClass = c.ativo ? 'status-completed' : 'status-pending';
  const statusLabel = c.ativo ? 'Ativa' : 'Pausada';
  const created     = new Date(c.created_at).toLocaleDateString('pt-BR');

  return `
    <tr>
      <td>
        <span style="font-weight:600;color:var(--text);">${escHtml(c.nome)}</span>
        <p style="font-size:12px;color:var(--text-3);margin-top:2px;">${escHtml(c.descricao)}</p>
      </td>
      <td style="font-family:monospace;font-size:13px;color:var(--text);">
        ${c.codigo_cupom ? escHtml(c.codigo_cupom) : '<span style="color:var(--text-3);">—</span>'}
      </td>
      <td style="font-size:13px;color:var(--text-2);">${posLabel}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td style="font-size:13px;color:var(--text-3);">${created}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button onclick="openCampaignModal('${c.id}')" class="btn-ghost">Editar</button>
          <button onclick="toggleCampaignActive('${c.id}',${c.ativo})" class="btn-ghost"
            style="${c.ativo ? 'color:#D97706;border-color:#FDE68A;' : 'color:var(--green);border-color:var(--green-bd);'}">
            ${c.ativo ? 'Pausar' : 'Ativar'}
          </button>
          <button onclick="deleteCampaign('${c.id}')" class="btn-danger">Excluir</button>
        </div>
      </td>
    </tr>`;
}

// ─── Modal create / edit ──────────────────────────────────────────────────────

window.openCampaignModal = function (campaignId) {
  const campaign    = campaignId ? _campaigns.find(c => c.id === campaignId) : null;
  _editingCampaignId = campaign?.id ?? null;

  const modal   = document.getElementById('campaignModal');
  const title   = document.getElementById('campaignModalTitle');
  const saveBtn = document.getElementById('btnSaveCampaign');

  title.textContent   = campaign ? 'Editar campanha' : 'Nova campanha';
  saveBtn.textContent = campaign ? 'Salvar alterações' : 'Criar campanha';

  document.getElementById('cfNome').value      = campaign?.nome         ?? '';
  document.getElementById('cfDescricao').value = campaign?.descricao    ?? '';
  document.getElementById('cfCupom').value     = campaign?.codigo_cupom ?? '';
  document.getElementById('cfLink').value      = campaign?.link_destino ?? '/pricing.html';
  document.getElementById('cfPosicao').value   = campaign?.posicao      ?? 'both';
  document.getElementById('cfAtivo').checked   = campaign ? campaign.ativo : true;

  document.getElementById('campaignModalMsg').classList.add('hidden');
  modal.style.display = 'flex';
};

window.closeCampaignModal = function () {
  document.getElementById('campaignModal').style.display = 'none';
  _editingCampaignId = null;
};

window.saveCampaign = async function () {
  const nome      = document.getElementById('cfNome').value.trim();
  const descricao = document.getElementById('cfDescricao').value.trim();

  if (!nome)      return _campaignModalMsg('Informe o nome da campanha.', 'error');
  if (!descricao) return _campaignModalMsg('Informe a descrição da campanha.', 'error');

  const cupom   = document.getElementById('cfCupom').value.trim().toUpperCase() || null;
  const link    = document.getElementById('cfLink').value.trim() || '/pricing.html';
  const posicao = document.getElementById('cfPosicao').value;
  const ativo   = document.getElementById('cfAtivo').checked;

  const payload = {
    nome, descricao,
    codigo_cupom: cupom,
    link_destino: link,
    posicao, ativo,
    updated_at: new Date().toISOString(),
  };

  const btn = document.getElementById('btnSaveCampaign');
  setLoading(btn, true, 'Salvando…');

  let error;
  if (_editingCampaignId) {
    ({ error } = await db.from('campaigns').update(payload).eq('id', _editingCampaignId));
  } else {
    ({ error } = await db.from('campaigns').insert(payload));
  }

  setLoading(btn, false);

  if (error) return _campaignModalMsg('Erro: ' + error.message, 'error');

  showToast(_editingCampaignId ? 'Campanha atualizada!' : 'Campanha criada!', 'success');
  closeCampaignModal();
  loadCampaigns();
};

// ─── Toggle & Delete ──────────────────────────────────────────────────────────

window.toggleCampaignActive = async function (id, isActive) {
  if (!confirm(`Deseja ${isActive ? 'pausar' : 'ativar'} esta campanha?`)) return;

  const { error } = await db
    .from('campaigns')
    .update({ ativo: !isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { showToast('Erro: ' + error.message); return; }
  showToast(isActive ? 'Campanha pausada.' : 'Campanha ativada!', 'success');
  loadCampaigns();
};

window.deleteCampaign = async function (id) {
  if (!confirm('Excluir esta campanha permanentemente?')) return;

  const { error } = await db.from('campaigns').delete().eq('id', id);
  if (error) { showToast('Erro: ' + error.message); return; }
  showToast('Campanha excluída.', 'success');
  loadCampaigns();
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function _campaignModalMsg(msg, type) {
  const el = document.getElementById('campaignModalMsg');
  if (!el) return;
  el.textContent       = msg;
  el.style.background  = type === 'success' ? 'var(--green-bg)' : 'var(--red-bg)';
  el.style.color       = type === 'success' ? 'var(--green)'    : 'var(--red)';
  el.style.border      = `1px solid ${type === 'success' ? 'var(--green-bd)' : 'var(--red-bd)'}`;
  el.classList.remove('hidden');
}
