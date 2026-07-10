// CTAs da landing -> tela de auth no painel certo
document.getElementById('ld-entrar').addEventListener('click', () => mostrarAuth('login'));
document.getElementById('ld-ja-tenho').addEventListener('click', () => mostrarAuth('login'));
document.getElementById('ld-comecar').addEventListener('click', () => mostrarAuth('cadastro'));
document.getElementById('ld-cta-final').addEventListener('click', () => mostrarAuth('cadastro'));

document.getElementById('voltar-landing').addEventListener('click', (e) => {
  e.preventDefault();
  mostrarTelaAuth();
});

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

// Login/cadastro com Google: redireciona para o OAuth do Supabase e volta
// para esta mesma página; o supabase-js captura a sessão da URL ao carregar.
async function entrarComGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) toast('Não foi possível iniciar o login com o Google.', 'error');
}

document.getElementById('google-login-btn').addEventListener('click', entrarComGoogle);
document.getElementById('google-cadastro-btn').addEventListener('click', entrarComGoogle);

document.getElementById('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  definirMateriaAtual(null);
  mostrarTelaAuth();
});
