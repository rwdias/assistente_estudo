document.getElementById('ir-para-cadastro').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('auth-panel-login').style.display = 'none';
  document.getElementById('auth-panel-cadastro').style.display = 'block';
});

document.getElementById('ir-para-login').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('auth-panel-cadastro').style.display = 'none';
  document.getElementById('auth-panel-login').style.display = 'block';
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;

  const { error } = await sb.auth.signInWithPassword({ email, password: senha });

  if (error) {
    toast('E-mail ou senha inválidos.', 'error');
    return;
  }

  await iniciarApp();
});

document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('cadastro-email').value.trim();
  const senha = document.getElementById('cadastro-senha').value;

  const { data, error } = await sb.auth.signUp({ email, password: senha });

  if (error) {
    toast(error.message, 'error');
    return;
  }

  if (!data.session) {
    // confirmação de e-mail ligada no projeto
    toast('Confira seu e-mail para confirmar a conta antes de entrar.');
    return;
  }

  await iniciarApp();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  definirMateriaAtual(null);
  mostrarTelaAuth();
});
