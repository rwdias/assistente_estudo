async function iniciarApp() {
  if (!Estado.token) {
    mostrarTelaAuth();
    return;
  }

  try {
    const me = await api('GET', '/api/auth/me');
    document.getElementById('sb-user-email').textContent = me.email;
    document.getElementById('sb-avatar').textContent = me.email[0] || '?';
  } catch (_) {
    mostrarTelaAuth();
    return;
  }

  mostrarApp();
  await carregarMaterias();
  goPanel('dashboard');
}

iniciarApp();
