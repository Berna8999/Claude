// Entrar / criar conta. Com ?convite=TOKEN, volta para o convite depois do login.
const params = new URLSearchParams(location.search);
const convite = params.get('convite');
const destino = convite ? `/convite.html?token=${encodeURIComponent(convite)}` : '/';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mostrarAba(nome) {
  document.querySelectorAll('[data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
  document.getElementById('form-entrar').hidden = nome !== 'entrar';
  document.getElementById('form-cadastro').hidden = nome !== 'cadastro';
}
document.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));

async function enviar(form, url, corpo) {
  const lista = form.querySelector('.erros');
  const botao = form.querySelector('button[type=submit]');
  lista.hidden = true;
  botao.disabled = true;
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    if (resp.ok) {
      location.href = destino;
      return;
    }
    const r = await resp.json().catch(() => ({}));
    lista.innerHTML = (r.erros ?? ['Algo deu errado. Tente de novo.']).map((e) => `<li>${esc(e)}</li>`).join('');
    lista.hidden = false;
  } finally {
    botao.disabled = false;
  }
}

document.getElementById('form-entrar').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  enviar(f, '/api/auth/entrar', { email: f.email.value, senha: f.senha.value });
});

document.getElementById('form-cadastro').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  enviar(f, '/api/auth/cadastro', { nome: f.nome.value, email: f.email.value, senha: f.senha.value, tipo: f.tipo.value });
});

// Já logado: segue direto.
fetch('/api/eu').then((r) => { if (r.ok) location.href = destino; });

// Veio de um convite: mostra para quem é e já abre "Criar conta" com o e-mail preenchido.
if (convite) {
  fetch(`/api/convites/${encodeURIComponent(convite)}`).then((r) => (r.ok ? r.json() : null)).then((c) => {
    if (!c || c.situacao !== 'pendente') return;
    const aviso = document.getElementById('aviso-convite');
    aviso.innerHTML = `<strong>${esc(c.convidadoPor)}</strong> convidou você para acessar <strong>${esc(c.empresa)}</strong>. Entre ou crie sua conta com <strong>${esc(c.email)}</strong>.`;
    aviso.hidden = false;
    document.querySelectorAll('input[name=email]').forEach((i) => { i.value = c.email; });
    mostrarAba('cadastro');
  });
}
