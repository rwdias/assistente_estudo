async function iniciarApp() {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    mostrarTelaAuth();
    return;
  }

  const email = session.user.email ?? '—';
  document.getElementById('sb-user-email').textContent = email;
  document.getElementById('sb-avatar').textContent = email[0] || '?';

  mostrarApp();
  await carregarMaterias();
  goPanel('revisao');
}

iniciarApp();
