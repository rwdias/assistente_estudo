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

  try {
    const resposta = await api('POST', '/api/auth/login', { email, senha });
    definirToken(resposta.access_token);
    await iniciarApp();
  } catch (erro) {
    toast(erro.message, 'error');
  }
});

document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('cadastro-email').value.trim();
  const senha = document.getElementById('cadastro-senha').value;

  try {
    const resposta = await api('POST', '/api/auth/cadastro', { email, senha });
    definirToken(resposta.access_token);
    await iniciarApp();
  } catch (erro) {
    toast(erro.message, 'error');
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  definirToken(null);
  definirMateriaAtual(null);
  mostrarTelaAuth();
});
