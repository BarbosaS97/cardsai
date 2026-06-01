// CardsQuestõesIA — utilitários globais

// CSRF token para fetch requests
function getCsrfToken() {
  return document.querySelector('[name=csrfmiddlewaretoken]')?.value
    || document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='))?.split('=')[1]
    || '';
}

// Auto-dismiss de mensagens Django após 5s
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-dismiss]').forEach(el => {
    setTimeout(() => el.remove(), 5000);
  });
});
