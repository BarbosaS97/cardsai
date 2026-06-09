async function requireAuth(adminRequired = false) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  if (adminRequired) {
    const profile = await getProfile();
    if (!profile?.is_admin) {
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;background:#F8FAFC;">
          <div style="text-align:center;padding:40px 32px;background:#fff;border:1px solid #E2E8F0;border-radius:16px;max-width:400px;width:90%;">
            <div style="width:56px;height:56px;background:#FEF2F2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;">&#x1F6AB;</div>
            <h1 style="font-size:20px;font-weight:700;color:#DC2626;margin:0 0 8px;">Acesso Negado</h1>
            <p style="color:#475569;font-size:14px;margin:0 0 4px;">Você não tem permissão para acessar o painel administrativo.</p>
            <p style="color:#94A3B8;font-size:12px;margin:0;">Redirecionando em 3 segundos…</p>
          </div>
        </div>`;
      setTimeout(() => { window.location.href = '/dashboard.html'; }, 3000);
      return null;
    }
    return { session, profile };
  }
  return session;
}

async function getProfile() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

async function signOut() {
  await db.auth.signOut();
  window.location.href = '/login.html';
}

function showToast(message, type = 'error') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const bg = { error: '#EF4444', success: '#10B981', info: '#3B82F6', warning: '#F59E0B' };
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.style.cssText = [
    'position:fixed', 'top:24px', 'right:24px', 'z-index:9999',
    'padding:12px 18px', 'border-radius:12px',
    `background:${bg[type] || bg.error}`,
    'color:#fff', 'font-size:14px', 'font-weight:500',
    'box-shadow:0 8px 32px rgba(0,0,0,.25)',
    'max-width:360px', 'line-height:1.5',
    'transition:opacity .3s,transform .3s',
    'pointer-events:none',
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function setLoading(btn, loading, text = null) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<svg class="animate-spin h-4 w-4 mr-2 inline" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>${text || 'Aguarde...'}`;
  } else {
    btn.innerHTML = btn.dataset.originalText || text || btn.innerHTML;
  }
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCredits(credits) {
  if (credits >= 999990) return '∞';
  return credits.toString();
}
