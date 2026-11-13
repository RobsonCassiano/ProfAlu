const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const toast = document.querySelector("#toast");
const savedFontSize = localStorage.getItem("techfatec.fontSize");
const state = {
  user: null,
  authVisible: false,
  pendingIntent: null,
  page: "inicio",
  authView: "login",
  demoAccountsEnabled: false,
  registrationEnabled: false,
  groupId: null,
  groupName: "",
  classId: null,
  groupTab: "materiais",
  communicationRoom: "",
  communicationContact: "",
  fontSize: savedFontSize === "small" || savedFontSize === "large" ? savedFontSize : "",
  highContrast: localStorage.getItem("techfatec.highContrast") === "true",
  profilePreviewUrl: null,
  toastTimer: null
};

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const initials = (name = "") => name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
const isStudent = () => state.user?.perfil === "ALUNO";
const roleName = (profile) => profile === "ALUNO" ? "Aluno" : "Professor";
const formatDate = (value) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Sem prazo";
const formatDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const avatar = (user, className = "") => user.fotoUrl
  ? `<div class="avatar avatar-image ${className}"><img src="${escapeHtml(user.fotoUrl)}" alt="Foto de perfil de ${escapeHtml(user.nome)}"></div>`
  : `<div class="avatar ${className}">${escapeHtml(initials(user.nome))}</div>`;

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (isForm && result?.erro === "Corpo JSON inválido.") {
      throw new Error("O servidor em execução está desatualizado. Reinicie o TechFatec para salvar o perfil.");
    }
    throw new Error(result?.erro || "Não foi possível concluir a operação.");
  }
  return result;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function applyAccessibilityPreferences() {
  document.documentElement.classList.toggle("fs-sm", state.fontSize === "small");
  document.documentElement.classList.toggle("fs-lg", state.fontSize === "large");
  document.documentElement.classList.toggle("hc", state.highContrast);
}

function accessibilityControls() {
  return `<div class="a11y" aria-label="Opções de acessibilidade">
    <span class="rot">Acessibilidade</span>
    <button class="chip" type="button" data-action="font-size" data-size="small" aria-pressed="${state.fontSize === "small"}" aria-label="Diminuir tamanho do texto">A−</button>
    <button class="chip" type="button" data-action="font-size" data-size="large" aria-pressed="${state.fontSize === "large"}" aria-label="Aumentar tamanho do texto">A+</button>
    <button class="chip hc" type="button" data-action="high-contrast" aria-pressed="${state.highContrast}">Alto contraste</button>
  </div>`;
}

function institutionalLogos() {
  return `<span class="institution-logos plate plate-lg" role="group" aria-label="Fatec São Roque">
    <img class="logo-img" src="/img/logo-fatec-saoroque.png" alt="Fatec São Roque">
  </span>`;
}

function renderAuth() {
  const views = {
    login: { title: "Bem-vindo de volta", subtitle: "Entre com seu e-mail institucional para continuar." },
    aluno: { title: "Criar conta de aluno", subtitle: "Use seus dados acadêmicos e o e-mail institucional." },
    professor: { title: "Criar conta de professor", subtitle: "Cadastre sua conta para organizar as atividades." },
    recuperar: { title: "Recuperar acesso", subtitle: "Informe o e-mail vinculado à sua conta Fatec." }
  };
  const view = views[state.authView];
  const tabs = state.authView === "login"
    ? ""
    : `<div class="form-actions"><button class="text-button" data-action="auth-view" data-view="login">← Voltar para entrar</button></div>`;
  let form;
  if (state.authView === "login") {
    form = `<form data-form="login">
      <div class="field"><label for="email">E-mail institucional</label><input id="email" name="email" type="email" autocomplete="username" placeholder="voce@fatec.sp.gov.br" required></div>
      <div class="field"><label for="senha">Senha</label><input id="senha" name="senha" type="password" autocomplete="current-password" placeholder="Sua senha" required></div>
      <div class="form-actions"><span></span><button class="text-button" type="button" data-action="auth-view" data-view="recuperar">Esqueci minha senha</button></div>
      <p class="form-error" data-error></p><button class="btn primary wide" type="submit">Entrar na plataforma <span aria-hidden="true">→</span></button>
    </form>
    ${state.registrationEnabled ? `<div class="form-actions"><span>Não tem conta?</span><button class="text-button" type="button" data-action="auth-view" data-view="aluno">Cadastrar aluno</button>${state.demoAccountsEnabled ? `<button class="text-button" type="button" data-action="auth-view" data-view="professor">Cadastrar professor</button>` : ""}</div>` : ""}
    ${state.demoAccountsEnabled ? `<div class="demo-note"><strong>Conta para demonstração</strong><br>tiago.santos@fatec.sp.gov.br ou camila.souza@fatec.sp.gov.br<br>Senha: fatec123</div>` : ""}`;
  } else if (state.authView === "recuperar") {
    form = `<form data-form="recuperar"><div class="field"><label for="email">E-mail institucional</label><input id="email" name="email" type="email" autocomplete="email" required></div><p class="form-error" data-error></p><button class="btn primary wide" type="submit">Verificar e-mail</button></form>`;
  } else {
    const student = state.authView === "aluno";
    form = `<form data-form="cadastro" data-profile="${student ? "aluno" : "professor"}"><div class="form-grid">
      <div class="field full"><label for="nome">Nome completo</label><input id="nome" name="nome" autocomplete="name" required></div>
      <div class="field full"><label for="email">E-mail institucional</label><input id="email" name="email" type="email" placeholder="voce@fatec.sp.gov.br" autocomplete="email" required></div>
      ${student
        ? `<div class="field"><label for="ra">RA</label><input id="ra" name="ra" required></div><div class="field"><label for="curso">Curso</label><select id="curso" name="curso" required><option value="">Selecione</option>${courses.map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("")}</select></div><div class="field full"><label for="semestre">Semestre</label><select id="semestre" name="semestre" required><option value="">Selecione</option>${[1, 2, 3, 4, 5, 6].map((semester) => `<option value="${semester}">${semester}º semestre</option>`).join("")}</select></div>`
        : `<div class="field full"><label for="matricula">Matrícula</label><input id="matricula" name="matricula" required></div>`}
      <div class="field full"><label for="senha">Senha (mínimo 6 caracteres)</label><input id="senha" name="senha" type="password" minlength="6" autocomplete="new-password" required></div>
    </div><p class="form-error" data-error></p><button class="btn primary wide" type="submit">Criar conta e entrar</button></form>`;
  }
  app.innerHTML = `${accessibilityControls()}<div class="auth-shell">
    <section class="brand-panel">
      <div class="brand auth-brand">${institutionalLogos()}<span class="brand-word">TechFatec</span></div>
      <div class="brand-copy"><div class="eyebrow">Aprender • colaborar • evoluir</div><h1>Seu espaço para crescer junto.</h1><p>Conecte-se com sua comunidade acadêmica, organize atividades e acompanhe sua jornada em um só lugar.</p></div>
      <div class="brand-foot">Uma plataforma feita para a comunidade Fatec.</div>
    </section>
    <section class="auth-side"><div class="auth-card"><button class="text-button public-back" type="button" data-action="public-home">← Voltar ao portal público</button><h2>${view.title}</h2><p>${view.subtitle}</p>${tabs}${form}</div></section>
  </div>`;
}

const studentNav = [
  ["inicio", "⌂", "Home"], ["noticias", "▤", "Notícias"], ["grupos", "◉", "Grupos"],
  ["meus-grupos", "◎", "Meus grupos"], ["atividades", "▣", "Atividades"],
  ["projetos", "◇", "Projetos"], ["materiais", "▧", "Materiais"], ["perfil", "●", "Perfil"]
];
const teacherNavGroups = [
  ["Início", [["dashboard", "⌂", "Dashboard"]]],
  ["Gestão acadêmica", [["turmas", "▦", "Turmas"], ["disciplinas", "▤", "Disciplinas"]]],
  ["Gestão de grupos", [["grupos", "◉", "Grupos de estudo"]]],
  ["Atividades e correções", [["tarefas", "▣", "Tarefas"], ["projetos", "◇", "Projetos"], ["entregaveis", "⇧", "Entregáveis"]]],
  ["Conteúdos e comunicação", [["materiais", "▧", "Materiais"], ["videos", "▷", "Vídeos"], ["noticias", "▤", "Avisos"]]],
  ["Acompanhamento", [["desempenho", "▥", "Desempenho"], ["relatorios", "▤", "Relatórios"]]],
  ["Conta", [["perfil", "●", "Meu perfil"]]]
];
studentNav.push(["forum", "◌", "Fórum"], ["mensagens", "✉", "Mensagens"], ["documentos", "▤", "Documentos"]);
teacherNavGroups.push(["Recursos institucionais", [["forum", "◌", "Fórum"], ["mensagens", "✉", "Mensagens"], ["documentos", "▤", "Documentos"], ["reservas", "▣", "Reservas"]]]);
const courses = [
  "Engenharia de Produção",
  "Gastronomia",
  "Gestão Comercial",
  "Gestão de Empreendimentos Gastronômicos",
  "Gestão de Turismo",
  "Sistemas para Internet"
];
const disciplineImages = {
  "Engenharia de Produção": "/img/engenharia.png",
  Gastronomia: "/img/gastronomia.png",
  "Gestão Comercial": "/img/comercial.png",
  "Gestão de Empreendimentos Gastronômicos": "/img/empreendimento.png",
  "Gestão de Turismo": "/img/turismo.png",
  "Sistemas para Internet": "/img/sistema.png"
};
studentNav.splice(4, 0, ["inscricoes", "•", "Minhas inscrições"]);
const pageTitles = {
  inicio: ["Home", "Seu portal acadêmico e próximos passos"],
  noticias: ["Notícias e Oportunidades", "Atualizações da sua comunidade acadêmica"],
  grupos: ["Grupos de estudo", "Encontre uma comunidade de aprendizagem"],
  "meus-grupos": ["Meus grupos", "Acesse seus grupos e conteúdos"],
  grupo: ["Área do grupo", "Materiais, vídeos, atividades e projetos"],
  turma: ["Diário da turma", "Aulas, horários, frequência e atividades acadêmicas"],
  turmas: ["Turmas acadêmicas", "Diário, frequência e atividades das suas turmas"],
  disciplinas: ["Disciplinas", "Componentes curriculares cadastrados nas suas turmas"],
  atividades: ["Atividades", "Tarefas, exercícios e entregas"],
  projetos: ["Projetos", "Acompanhe seus projetos e progresso"],
  materiais: ["Materiais", "Conteúdos publicados para você"],
  videos: ["Vídeos", "Aulas gravadas e conteúdos em vídeo"],
  tarefas: ["Tarefas", "Gerencie atividades e exercícios"],
  entregaveis: ["Entregáveis", "Acompanhe e corrija os envios dos alunos"],
  desempenho: ["Desempenho", "Acompanhamento por semestre e grupo de estudo"],
  relatorios: ["Relatórios", "Indicadores de atividades e projetos"],
  dashboard: ["Dashboard", "Visão geral da sua área docente"],
  "dashboard-projetos": ["Dashboard de projetos", "Acompanhe o status e o progresso"],
  "dashboard-tarefas": ["Dashboard de tarefas", "Entregas e pendências das atividades"],
  "dashboard-entregaveis": ["Dashboard de entregáveis", "Previsto, recebido e pendente"],
  perfil: ["Meu perfil", "Seus dados e sua foto de perfil"]
};

Object.assign(pageTitles, {
  inscricoes: ["Minhas inscrições", "Acompanhe as solicitações para grupos de estudo"],
  forum: ["Fórum", "Discussões vinculadas a grupos e turmas"],
  mensagens: ["Mensagens", "Comunicação privada nos espaços vinculados"],
  documentos: ["Documentos", "Arquivos institucionais e compartilhados"],
  reservas: ["Reservas", "Agendamento de salas e recursos"]
});

function shell(content, pageTitle, subtitle) {
  const navigation = isStudent()
    ? studentNav.map(([id, icon, label]) => `<button class="nav-item" data-action="navigate" data-page="${id}" aria-current="${state.page === id ? "page" : "false"}">${icon}<span>${label}</span></button>`).join("")
    : teacherNavGroups.map(([group, items]) => `<div class="nav-group"><span class="nav-group-label">${group}</span>${items.map(([id, icon, label]) =>
      `<button class="nav-item ${state.page === id || (id === "dashboard" && state.page.startsWith("dashboard")) ? "active" : ""}" data-action="navigate" data-page="${id}" aria-current="${state.page === id || (id === "dashboard" && state.page.startsWith("dashboard")) ? "page" : "false"}" title="${label}">${icon}<span>${label}</span></button>`
    ).join("")}</div>`).join("");
  app.innerHTML = `${accessibilityControls()}<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><img class="brand-logo-img" src="/img/logo-fatec-saoroque.png" alt=""><span class="brand-word">TechFatec</span></div>
      <p class="nav-caption">${isStudent() ? "Área do aluno" : "Área do professor"}</p>
      <nav class="nav-list ${isStudent() ? "student-nav" : "teacher-nav"}" aria-label="Navegação principal">${navigation}</nav>
      <div class="sidebar-bottom">
        <div class="profile-chip">${avatar(state.user)}<div class="profile-info"><div class="profile-name">${escapeHtml(state.user.nome)}</div><div class="profile-role">${roleName(state.user.perfil)}</div></div></div>
        <button class="logout" data-action="logout">↪ <span>Sair da conta</span></button>
      </div>
    </aside>
    <main class="main-area"><header class="topbar"><div><h1>${escapeHtml(pageTitle)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="topbar-right">${avatar(state.user)}</div></header>
      <section class="content">${content}</section>
    </main>
  </div>`;
}

function emptyState(title, message) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}

function statCard(label, value, note = "") {
  return `<article class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div>${note ? `<div class="stat-label">${escapeHtml(note)}</div>` : ""}</article>`;
}

function dashboardChart(title, description, series) {
  const values = series.map((item) => Math.max(0, Number(item.value) || 0));
  const maximum = Math.max(1, ...values);
  return `<section class="panel chart-panel" aria-label="${escapeHtml(title)}"><div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div>
    <div class="bar-chart">${series.map((item, index) => {
      const value = values[index];
      return `<div class="chart-row"><span>${escapeHtml(item.label)}</span><progress class="chart-progress ${escapeHtml(item.color || "")}" value="${value}" max="${maximum}" aria-label="${escapeHtml(item.label)}"></progress><strong>${value}</strong></div>`;
    }).join("")}</div></section>`;
}

function semesterDashboard(semesters = []) {
  return `<section class="panel semester-dashboard"><div class="section-heading"><div><h2>Acompanhamento por semestre</h2><p>Grupos, alunos e tarefas consolidados do 1º ao 6º semestre.</p></div></div>
    <div class="semester-grid">${semesters.map((item) => `<article class="semester-card"><strong>${item.semestre}º</strong><span>semestre</span><b>${item.grupos} grupos</b><small>${item.alunos} alunos • ${item.tarefas} tarefas</small>${progressBar(item.progresso, item.progresso >= 100 ? "COMPLETED" : "IN_PROGRESS")}</article>`).join("")}</div></section>`;
}

function reportResult(report) {
  const rows = report.linhas || [];
  if(report.tipo==="turma") return `<div class="report-result"><div class="stats">${statCard("Alunos",report.total)}${statCard("Média ponderada",report.mediaTurma??"—")}${statCard("Frequência média",report.frequenciaMedia==null?"—":`${report.frequenciaMedia}%`)}${statCard("Ocorrências",report.ocorrencias)}</div>${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Aluno</th><th>Média ponderada</th><th>Frequência</th><th>Aulas registradas</th><th>Ocorrências</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.aluno)}</td><td>${r.mediaPonderada==null?"—":`${r.mediaPonderada}%`}</td><td>${r.frequencia==null?"—":`${r.frequencia}%`}</td><td>${r.aulasRegistradas}</td><td>${r.ocorrencias}</td></tr>`).join("")}</tbody></table></div>`:emptyState("Nenhuma matrícula ativa","Não há dados acadêmicos para esta turma.")}</div>`;
  return `<div class="report-result"><div class="stats">${statCard("Entregáveis", report.total)}${statCard("Recebidos", report.recebidos)}${statCard("Pendentes", report.pendentes)}${statCard("Aproveitamento", `${report.aproveitamento}%`)}</div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Disciplina</th><th>Tarefa</th><th>Modalidade</th><th>Prazo</th><th>Progresso</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.disciplina || "Geral")} • ${row.semestre || "—"}º</td><td>${escapeHtml(row.titulo)}</td><td>${row.modalidade === "GROUP" ? "Grupo de 4" : "Individual"}</td><td>${formatDate(row.prazo)}</td><td>${row.progresso}%</td><td>${escapeHtml(row.status || "—")}</td></tr>`).join("")}</tbody></table></div>` : emptyState("Nenhum dado encontrado", "Ajuste os filtros e gere o relatório novamente.")}</div>`;
}

function progressBar(percent, status) {
  const color = status === "COMPLETED" ? "green" : status === "NOT_MET"
    ? "red" : status === "OVERDUE" || status === "ATTENTION" ? "yellow" : "blue";
  return `<progress class="progress-track ${color}" value="${percent}" max="100" aria-label="Progresso: ${percent}%"></progress><div class="progress-caption">${percent}%</div>`;
}

function statusPill(status, code = "") {
  const color = ["COMPLETED", "APPROVED", "OPEN"].includes(code) ? "success"
    : ["NOT_MET", "CLOSED", "REJECTED"].includes(code) ? "danger"
      : ["OVERDUE", "WAITING_MEMBERS", "COMPLETE", "IN_REVIEW", "RESUBMIT"].includes(code) ? "warning" : "";
  return `<span class="pill ${color}">${escapeHtml(status || "—")}</span>`;
}

function groupCard(group) {
  const details = `<div class="item-meta"><span class="pill">${escapeHtml(group.disciplina || "Grupo de estudo")}</span>${statusPill(group.statusLabel, group.status)}</div>
    <h3>${escapeHtml(group.nome)}</h3><p>${escapeHtml(group.descricao || "Sem descrição.")}</p>
    <div class="item-meta"><span class="pill">Professor: ${escapeHtml(group.professor)}</span>${group.tema ? `<span class="pill">Tema: ${escapeHtml(group.tema)}</span>` : ""}${group.modalidade ? `<span class="pill">${escapeHtml(group.modalidade)}</span>` : ""}${group.nivel ? `<span class="pill">${escapeHtml(group.nivel)}</span>` : ""}<span class="pill">${group.participantes}/${group.limiteAlunos} alunos</span><span class="pill">${group.vagas} vagas restantes</span></div>`;
  let actions;
  if (isStudent()) {
    actions = group.participacaoStatus === "PENDING"
      ? `<button class="btn secondary small" disabled>Solicitação pendente</button><button class="btn secondary small" data-action="cancel-group-request" data-id="${group.id}">Cancelar solicitação</button>`
      : group.participo
      ? `<button class="btn primary small" data-action="enter-group" data-id="${group.id}">Acessar grupo</button><button class="btn secondary small" data-action="leave-group" data-id="${group.id}">Sair do grupo</button>`
      : group.status === "OPEN" && group.vagas > 0
        ? `<button class="btn primary small" data-action="join-group" data-id="${group.id}">Solicitar participação</button>`
        : `<button class="btn secondary small" disabled>${group.status === "CLOSED" ? "Grupo encerrado" : "Grupo Completo"}</button>`;
  } else {
    actions = `<button class="btn secondary small" data-action="enter-group" data-id="${group.id}">Abrir grupo</button><button class="btn secondary small" data-action="edit-group" data-id="${group.id}">Editar</button><button class="btn secondary small" data-action="close-group" data-id="${group.id}" ${group.status === "CLOSED" ? "disabled" : ""}>Encerrar</button><button class="btn danger small" data-action="delete-group" data-id="${group.id}">Excluir</button>`;
  }
  return `<article class="item-card" data-feed-card data-group-catalog data-discipline="${escapeHtml(group.disciplina || "")}" data-theme="${escapeHtml(group.tema || "")}" data-professor="${escapeHtml(group.professor || "")}" data-modality="${escapeHtml(group.modalidade || "")}" data-level="${escapeHtml(group.nivel || "")}">${details}<div class="card-actions">${actions}</div></article>`;
}

function assignmentCard(item) {
  const action = isStudent()
    ? `<button class="btn primary small" data-action="upload-assignment" data-id="${item.id}" data-title="${escapeHtml(item.titulo)}">${item.statusCodigo === "APPROVED" ? "Ver entrega" : "Enviar / reenviar"}</button>`
    : `<button class="btn danger small" data-action="delete-assignment" data-id="${item.id}">Excluir tarefa</button>`;
  const status = isStudent() ? statusPill(item.status, item.statusCodigo) : "";
  return `<article class="item-card" data-feed-card data-assignment-id="${item.id}" data-task-status="${item.statusCodigo||"NOT_STARTED"}" data-task-text="${escapeHtml(`${item.titulo} ${item.disciplina||""} ${item.grupo||""}`)}" data-discipline="${escapeHtml(item.disciplina || "")}"><div class="item-meta"><span class="pill">${escapeHtml(item.disciplina || item.tipo || "Atividade")}</span>${item.grupo ? `<span class="pill">Grupo: ${escapeHtml(item.grupo)}</span>` : ""}${item.prazo ? `<span class="pill warning">Prazo: ${formatDate(item.prazo)}</span>` : ""}${status}</div>
    <h3>${escapeHtml(item.titulo)}</h3><p>${escapeHtml(item.descricao || "Sem descrição.")}</p><div class="item-meta">${item.grupo ? `<span class="pill">Grupo: ${escapeHtml(item.grupo)}</span>` : ""}${item.professor ? `<span class="pill">Professor: ${escapeHtml(item.professor)}</span>` : ""}</div>
    ${!isStudent() ? `${progressBar(item.progresso, item.statusCodigo)}<p>${item.recebidos} de ${item.esperados} entregas</p>` : ""}
    ${isStudent() && item.feedback ? `<p class="feedback-note"><strong>Feedback do professor:</strong> ${escapeHtml(item.feedback)}</p>` : ""}
    ${isStudent() && item.entregaId ? `<p>${escapeHtml(item.status)} • ${escapeHtml(item.nomeArquivo || "")} • ${formatDateTime(item.enviadaEm)}${item.nota == null ? "" : ` • Nota: ${item.nota}`}</p><button class="btn secondary small" data-action="submission-history" data-id="${item.entregaId}">Histórico de versões</button>` : ""}
    <div class="card-actions">${action}</div></article>`;
}

function projectCard(project) {
  return `<article class="item-card" data-feed-card data-discipline="${escapeHtml(project.disciplina || "")}"><div class="item-meta"><span class="pill">${escapeHtml(project.disciplina || "Projeto")}</span>${statusPill(project.status, project.statusCodigo)}</div>
    <h3>${escapeHtml(project.nome)}</h3><p>${escapeHtml(project.descricao || "Sem descrição.")}</p>
    <div class="item-meta"><span class="pill">Grupo: ${escapeHtml(project.grupo)}</span><span class="pill">${formatDate(project.inicio)} – ${formatDate(project.fim)}</span></div>
    ${progressBar(project.progresso, project.statusCodigo)}<p>${project.recebidos} de ${project.esperados} entregas${project.criterios ? ` • Critérios: ${escapeHtml(project.criterios)}` : ""}</p>
    ${isStudent()
      ? `<div class="item-meta">${project.minhaEntrega ? statusPill(project.minhaEntrega.status, project.minhaEntrega.statusCodigo) : statusPill("Não iniciado", "NOT_STARTED")}<span class="pill">Nota: ${project.minhaEntrega?.nota ?? "—"}</span></div>${project.minhaEntrega ? `<p>${escapeHtml(project.minhaEntrega.nomeArquivo || "")} • ${formatDateTime(project.minhaEntrega.enviadaEm)}</p>` : ""}<div class="card-actions"><button class="btn primary small" data-action="upload-project" data-id="${project.id}" data-title="${escapeHtml(project.nome)}">Enviar / reenviar</button>${project.minhaEntrega ? `<button class="btn secondary small" data-action="submission-history" data-id="${project.minhaEntrega.id}">Histórico de versões</button>` : ""}</div>`
      : `<div class="card-actions"><button class="btn secondary small" data-action="edit-project" data-id="${project.id}">Editar</button><button class="btn danger small" data-action="delete-project" data-id="${project.id}">Excluir</button></div>`}
  </article>`;
}

function videoEmbedSource(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) {
      const id = host === "youtu.be" ? parsed.pathname.split("/").filter(Boolean)[0]
        : parsed.searchParams.get("v") || parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : url;
    }
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
      const id = parsed.pathname.match(/\/(\d+)(?:$|\/)/)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : url;
    }
    return url;
  } catch {
    return null;
  }
}

function materialCard(item, video = false) {
  const destination = item.arquivoId ? `/api/arquivos/${item.arquivoId}` : item.url;
  const label = item.nomeArquivo || (video ? "Assistir v\u00eddeo" : "Abrir material");
  const externalVideo = video && !item.arquivoId ? videoEmbedSource(item.url) : null;
  const directVideo = video && item.url && /\.(mp4|webm|ogg)(?:$|[?#])/i.test(item.url);
  const playback = video && (item.arquivoId || directVideo)
    ? `<video class="video-player" controls preload="metadata" src="${escapeHtml(destination)}">Seu navegador n\u00e3o oferece suporte \u00e0 reprodu\u00e7\u00e3o de v\u00eddeo.</video>`
    : externalVideo ? `<iframe class="video-player video-embed" src="${escapeHtml(externalVideo)}" title="${escapeHtml(item.titulo)}" loading="eager" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>` : "";
  return `<article class="item-card" data-feed-card data-discipline="${escapeHtml(item.disciplina || "")}"><div class="item-meta"><span class="pill">${escapeHtml(item.tipo || (video ? "V\u00eddeo" : "Material"))}</span>${item.grupo ? `<span class="pill">${escapeHtml(item.grupo)}</span>` : ""}</div>
    <h3>${escapeHtml(item.titulo)}</h3><p>${escapeHtml(item.descricao || "Conte\u00fado publicado pelo professor.")}</p>
    ${item.professor ? `<p>Professor: ${escapeHtml(item.professor)}</p>` : ""}
    ${playback}
    ${destination ? `<div class="card-actions"><a class="btn secondary small" href="${escapeHtml(destination)}" ${item.url ? 'target="_blank" rel="noopener noreferrer"' : "download"}>${escapeHtml(label)}</a></div>` : ""}</article>`;
}

function newsCard(news) {
  const announcement = news.tipo === "ANNOUNCEMENT";
  return `<article class="item-card ${announcement ? "notice-card" : "feature-card"}" data-feed-card data-discipline=""><div class="item-meta"><span class="pill ${announcement ? "warning" : ""}">${announcement ? "Aviso importante" : "Notícia"}</span>${news.grupo ? `<span class="pill">${escapeHtml(news.grupo)}</span>` : ""}</div>
    <h3>${escapeHtml(news.titulo)}</h3><p>${escapeHtml(news.descricao)}</p><div class="item-meta"><span class="pill">${escapeHtml(news.autor || "Professor")} • ${formatDateTime(news.criadoEm)}</span></div></article>`;
}

function teacherProgressCard(group) {
  const hasActivities = Number(group.tarefas) > 0;
  const percent = hasActivities ? Math.max(0, Math.min(100, Number(group.progresso) || 0)) : null;
  return `<article class="teacher-progress-card">
    <div class="progress-ring ${hasActivities ? "" : "no-progress"}" role="img" aria-label="${hasActivities ? `${percent}% de entregas recebidas` : "Sem atividades para medir o progresso"}" ${hasActivities ? `style="--progress:${percent}"` : ""}><span>${hasActivities ? `${percent}%` : "—"}</span></div>
    <h3>${escapeHtml(group.disciplina || group.nome)}</h3><p>${group.tarefas} ${group.tarefas === 1 ? "atividade" : "atividades"}</p>
    <button class="text-button" data-action="enter-group" data-id="${group.id}">Abrir grupo</button>
  </article>`;
}

function teacherTaskTable(tasks) {
  if (!tasks.length) return emptyState("Nenhuma atividade cadastrada", "Atividades criadas para seus grupos aparecerão aqui.");
  return `<div class="table-wrap dashboard-table-wrap"><table class="data-table dashboard-table"><thead><tr><th>Atividade</th><th>Grupo</th><th>Prazo</th><th>Entregas</th></tr></thead><tbody>${tasks.slice(0, 5).map((task) =>
    `<tr><td><strong>${escapeHtml(task.titulo)}</strong><small>${escapeHtml(task.disciplina || task.tipo || "Atividade")}</small></td><td>${escapeHtml(task.grupo || "—")}</td><td>${formatDate(task.prazo)}</td><td>${task.recebidos}/${task.esperados}</td></tr>`
  ).join("")}</tbody></table></div>`;
}

function teacherGradeList(submissions) {
  const graded = submissions.filter((item) => item.nota !== null && item.nota !== undefined)
    .sort((a, b) => new Date(b.enviadaEm) - new Date(a.enviadaEm)).slice(0, 4);
  if (!graded.length) return emptyState("Nenhuma nota registrada", "Notas de entregas corrigidas aparecerão aqui.");
  return `<div class="teacher-grade-list">${graded.map((item) =>
    `<article class="teacher-grade-item"><div><strong>${escapeHtml(item.titulo)}</strong><small>${escapeHtml(item.aluno)} · ${escapeHtml(item.grupo || "Sem grupo")}</small></div><span class="teacher-grade-value">${escapeHtml(item.nota)}<small>/100</small></span></article>`
  ).join("")}</div>`;
}

function teacherRecentMaterials(items) {
  if (!items.length) return emptyState("Nenhum arquivo publicado", "Materiais e vídeos compartilhados com seus grupos aparecerão aqui.");
  return `<div class="card-grid dashboard-file-grid">${items.slice(0, 4).map((item) => materialCard(item, item._video)).join("")}</div>`;
}

function teacherScheduleList(classes) {
  const weekday=new Date().getDay()||7;
  const items=classes.flatMap(c=>c.horarios.filter(h=>h.dia===weekday).map(h=>({c,h}))).sort((a,b)=>a.h.inicio.localeCompare(b.h.inicio));
  return items.length?`<div class="teacher-grade-list">${items.map(({c,h})=>`<article class="teacher-grade-item"><div><strong>${escapeHtml(h.inicio)}–${escapeHtml(h.fim)} · ${escapeHtml(c.nome)}</strong><small>${escapeHtml(c.disciplina)} · ${escapeHtml(h.local||h.modalidade)}</small></div><button class="text-button" data-action="open-class" data-id="${c.id}">Diário</button></article>`).join("")}</div><button class="btn secondary small" data-action="navigate" data-page="turmas">Ver todas as turmas</button>`:`<div class="empty dashboard-unavailable"><strong>Sem aulas programadas para hoje</strong><span>Cadastre os horários nas páginas das turmas acadêmicas.</span></div><button class="btn secondary small" data-action="navigate" data-page="turmas">Gerenciar turmas</button>`;
}

function institutionalNewsCards() {
  const cards = [
    ["inter", "Intercâmbio", "https://arinter.cps.sp.gov.br/inscricoes-para-o-15o-intercambio-cultural-do-centro-paula-souza-sao-prorrogadas-ate-22-de-outubro/"],
    ["spanish", "Spanish", "https://arinter.cps.sp.gov.br/dle-2-2026/"],
    ["vestibular", "Vestibular", "https://www.cps.sp.gov.br/inscricoes-para-o-vestibulinho-terminam-as-20h-de-amanha-10/"],
    ["cps", "Centro Paula Souza", "https://fatecsaoroque.cps.sp.gov.br/minicurso/"]
  ];
  return `<div class="institutional-news-grid" aria-label="Informações institucionais">${cards.map(([name, label, url]) =>
    `<a class="institutional-news-card" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Abrir: ${label}"><img src="/img/${name}.jpg" data-fallback="/img/${name}.jpg" alt="${label}" loading="lazy" decoding="async"></a>`
  ).join("")}</div>`;
}

function socialMediaCards() {
  const cards = [
    ["x", "X", "https://x.com/paulasouzasp"],
    ["facebook", "Facebook", "https://www.facebook.com/centropaulasouza/"],
    ["instagram", "Instagram", "https://www.instagram.com/centropaulasouza/"],
    ["linkedin", "LinkedIn", "https://br.linkedin.com/company/centropaulasouza?original_referer=https%3A%2F%2Fwww.cps.sp.gov.br%2F"],
    ["youtube", "YouTube", "https://www.youtube.com/user/centropaulasouzasp"],
    ["tik-tok", "TikTok", "https://www.tiktok.com/@centropaulasouza"]
  ];
  return `<div class="social-media-grid" aria-label="Redes sociais do Centro Paula Souza">${cards.map(([name, label, url]) =>
    `<a class="social-media-card" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Acessar o ${label} do Centro Paula Souza"><img src="/img/${name}.png" alt="${label}" loading="lazy" decoding="async"></a>`
  ).join("")}</div>`;
}

function publicGroupCard(group) {
  const image = disciplineImages[group.disciplina];
  return `<article class="item-card public-feed-card" data-feed-card data-discipline="${escapeHtml(group.disciplina || "")}">
    ${image ? `<div class="public-group-discipline"><img src="${image}" alt="" loading="lazy" decoding="async"><span>${escapeHtml(group.disciplina)}</span></div>` : ""}
    <h3>${escapeHtml(group.nome)}</h3><p>${escapeHtml(group.descricao || "Conheça este grupo de estudos.")}</p>
    <div class="item-meta"><span class="pill">${escapeHtml(group.disciplina || "Grupo de estudo")}</span>${statusPill(group.statusLabel, group.status)}</div>
    <div class="item-meta"><span class="pill">Professor: ${escapeHtml(group.professor)}</span>${group.tema ? `<span class="pill">Tema: ${escapeHtml(group.tema)}</span>` : ""}${group.modalidade ? `<span class="pill">${escapeHtml(group.modalidade)}</span>` : ""}${group.nivel ? `<span class="pill">${escapeHtml(group.nivel)}</span>` : ""}<span class="pill">${group.participantes}/${group.limiteAlunos} alunos</span><span class="pill">${group.vagas} vagas disponíveis</span></div>
    <button class="btn primary small" data-action="public-intent" data-intent="group" data-id="${group.id}">Conhecer grupo</button>
  </article>`;
}

function publicAssignmentCard(assignment) {
  return `<article class="item-card public-feed-card" data-feed-card data-discipline="">
    <div class="item-meta"><span class="pill">Atividade acadêmica</span>${assignment.prazo ? `<span class="pill warning">Prazo: ${formatDate(assignment.prazo)}</span>` : ""}</div>
    <h3>${escapeHtml(assignment.titulo)}</h3><p>Professor: ${escapeHtml(assignment.professor)}</p>
    <button class="btn secondary small" data-action="public-intent" data-intent="assignment" data-id="${assignment.id}">Entrar para acompanhar</button>
  </article>`;
}

async function renderPublicHome() {
  const feed = await api("/api/public/home");
  state.demoAccountsEnabled = feed.demoAccountsEnabled;
  state.registrationEnabled = feed.registrationEnabled;
  app.innerHTML = `${accessibilityControls()}<main class="public-home">
    <header class="public-header">
      <a class="brand public-brand" href="/" aria-label="TechFatec - início">${institutionalLogos()}<span class="brand-word">TechFatec</span></a>
      <nav class="public-nav" aria-label="Navegação pública"><a href="#public-news">Notícias</a><a href="#public-groups">Grupos abertos</a><a href="#public-activities">Atividades</a></nav>
    </header>
    <section class="public-hero">
      <div class="public-hero-copy"><span class="eyebrow">Comunidade acadêmica Fatec</span><h1>Aprenda e construa junto.</h1><p>Encontre grupos de estudo, acompanhe novidades e conecte-se com seus professores em um só espaço.</p>
        <div class="card-actions"><button class="btn primary" data-action="show-login">Entrar na plataforma <span aria-hidden="true">→</span></button></div>
      </div>
      <div class="public-hero-aside" aria-label="Resumo da comunidade">
        <div><strong>${feed.destaques.gruposAbertos}</strong><span>grupos abertos</span></div>
        <div><strong>${feed.destaques.vagasDisponiveis}</strong><span>vagas disponíveis</span></div>
        <div><strong>${feed.destaques.atividades}</strong><span>atividades abertas</span></div>
      </div>
    </section>
    <div class="feed-tools public-feed-tools"><div class="field"><label for="feed-search">Destaques</label><input id="feed-search" type="search" placeholder="Buscar notícias, grupos ou atividades"></div>
      <div class="field"><label for="feed-discipline">Cursos</label><select id="feed-discipline"><option value="">Todos os Cursos</option>${courses.map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("")}</select></div></div>
    <section class="public-section" id="public-news"><div class="section-heading"><div><h2>Notícias e Oportunidades</h2><p>Fique por dentro do que acontece na comunidade.</p></div></div>
      ${institutionalNewsCards()}
        ${feed.noticias.length ? `<div class="card-grid feature-grid">${feed.noticias.map(newsCard).join("")}</div>` : `${emptyState("Siga nossas Redes Sociais", "Acompanhe as novidades e comunicados do Centro Paula Souza.")}${socialMediaCards()}`}</section>
    <section class="public-section" id="public-groups">    <div class="section-heading"><div><h2>Grupos de estudo abertos</h2><p>Veja disciplinas, professores e vagas disponíveis.</p></div><button class="btn secondary small" data-action="public-intent" data-intent="groups">Ver todos</button></div>
      ${feed.grupos.length ? `<div class="card-grid">${feed.grupos.map(publicGroupCard).join("")}</div>` : emptyState("Nenhum grupo aberto agora", "Volte em breve para conhecer novos grupos.")}</section>
    <section class="public-section" id="public-activities"><div class="section-heading"><div><h2>Atividades acadêmicas</h2><p>Entre para acompanhar prazos, instruções e entregas.</p></div></div>
      ${feed.atividades.length ? `<div class="card-grid">${feed.atividades.map(publicAssignmentCard).join("")}</div>` : emptyState("Atividades em breve", "As próximas atividades abertas aparecerão aqui.")}</section>
    <footer class="public-footer">TechFatec • Uma plataforma feita para aprender, colaborar e evoluir.</footer>
  </main>`;
}

function dashboardNavigation() {
  return `<div class="dashboard-links"><button class="btn secondary small" data-action="navigate" data-page="dashboard-projetos">Projetos</button><button class="btn secondary small" data-action="navigate" data-page="dashboard-tarefas">Tarefas</button><button class="btn secondary small" data-action="navigate" data-page="dashboard-entregaveis">Entregáveis</button></div>`;
}

function groupFormOptions(groups, selected = "") {
  return groups.map((group) => `<option value="${group.id}" ${String(group.id) === String(selected) ? "selected" : ""}>${escapeHtml(group.nome)} • ${escapeHtml(group.disciplina || "")}</option>`).join("");
}

async function renderStudentHome() {
  const feed = await api("/api/home");
  const highlights = feed.news.length
    ? `<div class="card-grid feature-grid">${feed.news.slice(0, 2).map(newsCard).join("")}</div>`
    : emptyState("Boas-vindas à sua comunidade", "As notícias e avisos dos seus professores aparecerão aqui.");
  return `<div class="welcome portal-banner"><div><div class="eyebrow">Portal acadêmico</div><h2>Olá, ${escapeHtml(state.user.nome.split(" ")[0])}!</h2><p>Acompanhe novidades, conteúdos e suas próximas entregas.</p></div><div class="welcome-icon">✦</div></div>
    <div class="feed-tools"><div class="field"><label for="feed-search">Destaques</label><input id="feed-search" type="search" placeholder="Buscar notícias, grupos ou materiais"></div><div class="field"><label for="feed-discipline">Cursos</label><select id="feed-discipline"><option value="">Todos os Cursos</option>${courses.map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("")}</select></div></div>
    <div class="section-heading"><div><h2>Destaques e avisos</h2><p>Informações recentes da comunidade Fatec</p></div><button class="btn secondary small" data-action="navigate" data-page="noticias">Ver notícias</button></div>
    <div class="feed-grid">${highlights}</div>
    <div class="section-heading"><div><h2>Próximas entregas</h2><p>Organize suas atividades e prazos</p></div><button class="btn secondary small" data-action="navigate" data-page="atividades">Ver atividades</button></div>
    ${feed.assignments.length ? `<div class="card-grid">${feed.assignments.slice(0, 3).map(assignmentCard).join("")}</div>` : emptyState("Sem atividades pendentes", "Novas tarefas publicadas aparecerão nesta área.")}
    <div class="section-heading"><div><h2>Projetos em andamento</h2><p>Acompanhe o progresso do seu grupo</p></div><button class="btn secondary small" data-action="navigate" data-page="projetos">Ver projetos</button></div>
    ${feed.projects.length ? `<div class="card-grid">${feed.projects.slice(0, 2).map(projectCard).join("")}</div>` : emptyState("Nenhum projeto por enquanto", "Quando seu professor criar um projeto, ele aparecerá aqui.")}
    <div class="section-heading"><div><h2>Materiais publicados</h2><p>Consulte os materiais dos seus grupos</p></div><button class="btn secondary small" data-action="navigate" data-page="materiais">Ver materiais</button></div>
    ${feed.materials.length ? `<div class="card-grid">${feed.materials.slice(0, 2).map((item) => materialCard(item)).join("")}</div>` : emptyState("Nenhum material publicado", "Materiais compartilhados pelos seus professores aparecerão aqui.")}
    <div class="section-heading"><div><h2>Grupos de estudo disponíveis</h2><p>Conheça grupos abertos para participar</p></div><button class="btn secondary small" data-action="navigate" data-page="grupos">Explorar grupos</button></div>
    ${feed.groups.length ? `<div class="card-grid">${feed.groups.slice(0, 2).map(groupCard).join("")}</div>` : emptyState("Nenhum grupo disponível", "Volte em breve para conferir os grupos.")}`;
}

async function renderPage() {
  if (!state.user) return state.authVisible ? renderAuth() : renderPublicHome();
  const [title, subtitle] = pageTitles[state.page] ?? pageTitles.inicio;
  let content = "";
  if (state.page === "inicio" && isStudent()) {
    content = await renderStudentHome();
  } else if (state.page === "inicio" || state.page === "dashboard") {
    const [dashboard, taskDashboard, announcements, materials, videos, deliveryDashboard, academicClasses] = await Promise.all([
      api("/api/dashboard?tipo=resumo"),
      api("/api/dashboard?tipo=tarefas"),
      api("/api/noticias"),
      api("/api/materiais"),
      api("/api/videos"),
      api("/api/dashboard?tipo=entregaveis"),
      isStudent() ? Promise.resolve([]) : api("/api/turmas")
    ]);
    const today = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short" }).format(new Date());
    const latestMaterials = [...materials.map((item) => ({ ...item, _video: false })), ...videos.map((item) => ({ ...item, _video: true }))]
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    content = `<div class="teacher-dashboard-heading"><div><span class="eyebrow">${escapeHtml(today)}</span><h2>Olá, ${escapeHtml(state.user.nome.split(" ")[0])}!</h2><p>Acompanhe os grupos e atividades sob sua responsabilidade.</p></div></div>
      <div class="teacher-dashboard-columns">
        <div class="teacher-dashboard-main">
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Progresso dos grupos</h2><p>${dashboard.grupos} grupos de estudo · ${dashboard.alunos} alunos participantes</p></div><button class="btn secondary small" data-action="navigate" data-page="grupos">Ver grupos</button></div>
            ${(dashboard.gruposResumo || []).length ? `<div class="teacher-progress-grid">${dashboard.gruposResumo.slice(0, 4).map(teacherProgressCard).join("")}</div>` : emptyState("Nenhum grupo vinculado", "Grupos sob sua responsabilidade aparecerão aqui.")}</section>
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Atividades e prazos</h2><p>${taskDashboard.tarefasPendentes} entregas pendentes · ${dashboard.aguardandoCorrecao} aguardando correção</p></div><button class="btn secondary small" data-action="navigate" data-page="tarefas">Ver tarefas</button></div>${teacherTaskTable(taskDashboard.tarefas || [])}</section>
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Materiais publicados recentemente</h2><p>Arquivos e vídeos compartilhados com os grupos.</p></div><button class="btn secondary small" data-action="navigate" data-page="materiais">Ver materiais</button></div>${teacherRecentMaterials(latestMaterials)}</section>
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Avisos e comunicados</h2><p>Publicações recentes para sua comunidade.</p></div><button class="btn primary small" data-action="new-news">+ Novo aviso</button></div>${announcements.length ? `<div class="card-grid">${announcements.slice(0, 2).map(newsCard).join("")}</div>` : emptyState("Nenhum aviso recente", "Publicações novas aparecerão aqui.")}</section>
        </div>
        <aside class="teacher-dashboard-side" aria-label="Resumo complementar">
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Agenda de hoje</h2><p>Horários e locais de aula</p></div></div>${teacherScheduleList(academicClasses)}</section>
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Notas lançadas</h2><p>Correções de trabalhos e projetos</p></div><button class="btn secondary small" data-action="navigate" data-page="entregaveis">Entregas</button></div>${teacherGradeList(deliveryDashboard.entregaveis || [])}</section>
          <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Resumo da atividade</h2><p>Indicadores dos grupos de estudo</p></div></div><div class="teacher-mini-stats">${statCard("Tarefas pendentes", dashboard.tarefasPendentes)}${statCard("Projetos ativos", dashboard.projetosAtivos)}${statCard("Aguardando correção", dashboard.aguardandoCorrecao)}</div><button class="btn secondary small" data-action="navigate" data-page="relatorios">Abrir relatórios</button></section>
        </aside>
      </div>`;
  } else if (state.page === "noticias") {
    const news = await api("/api/noticias");
    content = `${!isStudent() ? `<div class="section-heading"><div><h2>Comunicados</h2><p>Publique novidades para os alunos.</p></div><button class="btn primary small" data-action="new-news">+ Nova publicação</button></div>` : ""}
      ${news.length ? `<div class="card-grid feature-grid">${news.map(newsCard).join("")}</div>` : emptyState("Nenhuma notícia publicada", "As notícias e avisos aparecerão aqui.")}`;
  } else if (["forum", "mensagens"].includes(state.page)) {
    const [groups,classes]=await Promise.all([api("/api/grupos?meus=1"),api("/api/turmas")]);
    const rooms=[...groups.map(g=>({key:`grupo:${g.id}`,label:`Grupo · ${g.nome}`})),...classes.map(c=>({key:`turma:${c.id}`,label:`Turma · ${c.disciplina} · ${c.nome}`}))];
    if(!rooms.some(r=>r.key===state.communicationRoom))state.communicationRoom=rooms[0]?.key||"";
    const [roomType,roomId]=(state.communicationRoom||":").split(":");
    const query=roomType==="grupo"?`grupoId=${roomId}`:`turmaId=${roomId}`;
    const roomSelect=`<div class="field"><label>Espaço</label><select data-communication-room>${rooms.map(r=>`<option value="${r.key}" ${r.key===state.communicationRoom?"selected":""}>${escapeHtml(r.label)}</option>`).join("")}</select></div>`;
    if(!rooms.length)content=emptyState("Nenhum espaço disponível","Entre em um grupo ou aguarde uma matrícula acadêmica ativa para acessar as conversas.");
    else if(state.page==="forum"){
      const topics=await api(`/api/forum?${query}`);
      content=`<div class="section-heading"><div><h2>Discussões</h2><p>Fóruns separados por grupo de estudo e turma acadêmica.</p></div><button class="btn primary small" data-action="new-topic">+ Nova discussão</button></div><section class="panel report-filters">${roomSelect}</section>${topics.length?`<div class="card-grid">${topics.map(t=>`<article class="item-card"><div class="item-meta"><span class="pill">${t.bloqueado?"Encerrada":"Aberta"}</span><span class="pill">${t.respostas} respostas</span></div><h3>${escapeHtml(t.titulo)}</h3><p>${escapeHtml(t.descricao)}</p><small>${escapeHtml(t.autor)} · ${formatDateTime(t.atualizadoEm)}</small><div class="card-actions"><button class="btn secondary small" data-action="open-topic" data-id="${t.id}">Abrir discussão</button></div></article>`).join("")}</div>`:emptyState("Nenhuma discussão iniciada","Crie um tópico para compartilhar perguntas e conhecimento.")}`;
    } else {
      const [contacts,messages]=await Promise.all([api(`/api/contatos?${query}`),api(`/api/mensagens?${query}`)]);
      if(!contacts.some(c=>String(c.id)===String(state.communicationContact)))state.communicationContact=String(contacts[0]?.id||"");
      const selected=contacts.find(c=>String(c.id)===String(state.communicationContact));
      const thread=messages.filter(m=>selected&&(String(m.remetenteId)===String(selected.id)||String(m.destinatarioId)===String(selected.id)));
      content=`<section class="panel report-filters"><div class="form-grid">${roomSelect}<div class="field"><label>Contato</label><select data-communication-contact>${contacts.map(c=>`<option value="${c.id}" ${String(c.id)===String(state.communicationContact)?"selected":""}>${escapeHtml(c.nome)} · ${c.perfil==="ALUNO"?"Aluno":"Professor"}</option>`).join("")}</select></div></div></section>${selected?`<section class="panel dashboard-panel"><div class="teacher-grade-list">${thread.map(m=>`<article class="teacher-grade-item"><div><strong>${escapeHtml(m.remetente)} ${m.remetenteId===state.user.id?"(você)":""}</strong><small>${formatDateTime(m.enviadaEm)}</small><p>${escapeHtml(m.mensagem)}</p></div></article>`).join("")||"<p>Sem mensagens nesta conversa.</p>"}</div><form data-form="message" data-room="${state.communicationRoom}" data-recipient="${selected.id}"><div class="field"><label>Mensagem para ${escapeHtml(selected.nome)}</label><textarea name="mensagem" maxlength="4000" required></textarea></div>${errorField()}<button class="btn primary" type="submit">Enviar mensagem</button></form></section>`:emptyState("Sem contatos disponíveis","Mensagens são permitidas entre alunos e docentes vinculados ao mesmo espaço.")}`;
    }
  } else if(state.page==="documentos"){
    const docs=await api("/api/documentos");content=`<div class="section-heading"><div><h2>Biblioteca de documentos</h2><p>Arquivos e links institucionais, de turma ou grupo.</p></div>${!isStudent()?`<button class="btn primary small" data-action="new-document">+ Publicar documento</button>`:""}</div>${docs.length?`<div class="card-grid">${docs.map(d=>`<article class="item-card"><div class="item-meta"><span class="pill">${d.grupoId?"Grupo de estudo":d.turmaId?"Turma acadêmica":"Institucional"}</span></div><h3>${escapeHtml(d.titulo)}</h3><p>${escapeHtml(d.descricao||d.nomeArquivo||"Documento compartilhado")}</p><small>${escapeHtml(d.autor)} · ${formatDateTime(d.criadoEm)}</small><div class="card-actions">${d.arquivoId?`<a class="btn secondary small" href="/api/arquivos/${d.arquivoId}" download>Baixar documento</a>`:`<a class="btn secondary small" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">Abrir link</a>`}</div></article>`).join("")}</div>`:emptyState("Nenhum documento publicado","Documentos compartilhados aparecerão aqui.")}`;
  } else if(state.page==="reservas"){
    if(isStudent()){state.page="inicio";return renderPage();}
    const reservations=await api("/api/reservas");content=`<div class="section-heading"><div><h2>Reservas de recursos</h2><p>Agende salas e equipamentos, evitando conflitos de horário.</p></div></div><form class="panel report-filters" data-form="reservation"><div class="form-grid"><div class="field"><label>Sala ou recurso</label><input name="recurso" placeholder="Ex.: Laboratório 2" maxlength="120" required></div><div class="field"><label>Turma relacionada (opcional)</label><select name="turmaId"><option value="">Reserva institucional</option>${(await api("/api/turmas")).map(c=>`<option value="${c.id}">${escapeHtml(c.disciplina)} · ${escapeHtml(c.nome)}</option>`).join("")}</select></div><div class="field"><label>Início</label><input type="datetime-local" name="inicio" required></div><div class="field"><label>Término</label><input type="datetime-local" name="fim" required></div></div><div class="field"><label>Finalidade</label><input name="finalidade" maxlength="500" required></div>${errorField()}<button class="btn primary" type="submit">Reservar recurso</button></form>${reservations.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Recurso</th><th>Finalidade</th><th>Início</th><th>Término</th><th>Turma</th><th></th></tr></thead><tbody>${reservations.filter(r=>r.status==="CONFIRMED").map(r=>`<tr><td>${escapeHtml(r.recurso)}</td><td>${escapeHtml(r.finalidade)}</td><td>${formatDateTime(r.inicio)}</td><td>${formatDateTime(r.fim)}</td><td>${escapeHtml(r.turma||"Institucional")}</td><td><button class="btn danger small" data-action="cancel-reservation" data-id="${r.id}">Cancelar</button></td></tr>`).join("")}</tbody></table></div>`:emptyState("Nenhuma reserva cadastrada","Suas reservas confirmadas aparecerão nesta lista.")}`;
  } else if (state.page === "grupos" || state.page === "meus-grupos") {
    const mine = state.page === "meus-grupos" || !isStudent();
    const groups = await api(`/api/grupos${mine ? "?meus=1" : ""}`);
    content = `<div class="section-heading"><div><h2>${isStudent() && !mine ? "Explore os grupos" : "Grupos gerenciados"}</h2><p>${isStudent() && !mine ? "Encontre grupos por disciplina, tema, professor ou modalidade." : "Crie, edite e acompanhe os integrantes."}</p></div>${!isStudent() ? `<button class="btn primary small" data-action="new-group">+ Criar grupo</button>` : ""}</div>
      ${isStudent() && !mine ? `<section class="panel report-filters"><div class="form-grid"><div class="field"><label for="catalog-search">Buscar grupos</label><input id="catalog-search" data-group-filter placeholder="Nome ou tema"></div><div class="field"><label for="catalog-subject">Disciplina</label><select id="catalog-subject" data-group-filter><option value="">Todas</option>${[...new Set(groups.map(g=>g.disciplina).filter(Boolean))].map(x=>`<option>${escapeHtml(x)}</option>`).join("")}</select></div><div class="field"><label for="catalog-modality">Modalidade</label><select id="catalog-modality" data-group-filter><option value="">Todas</option>${[...new Set(groups.map(g=>g.modalidade).filter(Boolean))].map(x=>`<option>${escapeHtml(x)}</option>`).join("")}</select></div><div class="field"><label for="catalog-level">N\u00edvel</label><select id="catalog-level" data-group-filter><option value="">Todos</option>${[...new Set(groups.map(g=>g.nivel).filter(Boolean))].map(x=>`<option>${escapeHtml(x)}</option>`).join("")}</select></div><div class="field"><label><input type="checkbox" id="catalog-open" data-group-filter> Apenas com vagas</label></div></div></section>` : ""}
      ${groups.length ? `<div class="card-grid">${groups.map(groupCard).join("")}</div>` : emptyState("Nenhum grupo encontrado", isStudent() ? "N\u00e3o h\u00e1 grupos dispon\u00edveis neste momento." : "Crie seu primeiro grupo de estudo.")}`;
  } else if (state.page === "inscricoes") {
    const requests = await api("/api/inscricoes");
    content = requests.length ? `<div class="card-grid">${requests.map(g => `<article class="item-card"><div class="item-meta"><span class="pill">${escapeHtml(g.disciplina||"Grupo de estudo")}</span>${statusPill(g.solicitacaoStatus==="PENDING"?"Aguardando aprova\u00e7\u00e3o":g.solicitacaoStatus==="ACTIVE"?"Aprovada":g.solicitacaoStatus==="REJECTED"?"Recusada":g.solicitacaoStatus==="CANCELLED"?"Cancelada":"Saiu do grupo",g.solicitacaoStatus)}</div><h3>${escapeHtml(g.nome)}</h3><p>${escapeHtml(g.descricao||"")}</p><small>Professor: ${escapeHtml(g.professor)}</small>${g.solicitacaoStatus==="PENDING"?`<div class="card-actions"><button class="btn secondary small" data-action="cancel-group-request" data-id="${g.id}">Cancelar solicita\u00e7\u00e3o</button></div>`:g.solicitacaoStatus==="ACTIVE"?`<div class="card-actions"><button class="btn primary small" data-action="enter-group" data-id="${g.id}">Acessar grupo</button></div>`:""}</article>`).join("")}</div>` : emptyState("Nenhuma inscri\u00e7\u00e3o", "Suas solicita\u00e7\u00f5es e grupos aprovados aparecer\u00e3o aqui.");
  } else if (state.page === "grupo") {
    if (!state.groupId) {
      state.page = isStudent() ? "meus-grupos" : "grupos";
      return renderPage();
    }
    const group = await api(`/api/grupos/${state.groupId}/portal`);
    state.groupName = group.nome;
    const tabs = [...(isStudent() ? [["visao-geral", "Vis\u00e3o geral"], ["avisos", "Avisos"], ["professores", "Professores"], ["participantes", "Participantes"], ["agenda", "Agenda"], ["discussoes", "Discuss\u00f5es"]] : []), ["materiais", "Materiais"], ["videos", "V\u00eddeos"], ["atividades", "Atividades"], ["projetos", "Projetos"], ...(!isStudent() ? [["planejamento", "Planejamento"], ["integrantes", "Integrantes"]] : [])];
    let panel;
    const data = group[state.groupTab] || [];
    if (state.groupTab === "visao-geral") panel = `<div class="teacher-dashboard-columns"><section class="panel"><h3>Sobre o grupo</h3><p>${escapeHtml(group.objetivos || group.descricao || "Objetivos ainda n\u00e3o informados.")}</p><p>${escapeHtml(group.tema || group.disciplina || "")} ? ${escapeHtml(group.modalidade || "Modalidade n\u00e3o informada")} ? ${escapeHtml(group.horarioEncontros || "Hor\u00e1rio a combinar")}</p></section><section class="panel"><h3>Pr\u00f3ximos encontros</h3>${group.agenda?.length ? group.agenda.slice(0, 3).map(p => `<p><strong>${escapeHtml(p.titulo)}</strong> ? ${formatDate(p.dataPrevista)}</p>`).join("") : "<p>Nenhum encontro planejado.</p>"}</section></div><section class="panel"><h3>Avisos recentes</h3>${group.avisos?.length ? group.avisos.slice(0, 3).map(a => `<p><strong>${escapeHtml(a.titulo)}</strong> ? ${escapeHtml(a.texto || "")}</p>`).join("") : "<p>Nenhum aviso publicado.</p>"}</section>`;
    else if (state.groupTab === "avisos") panel = group.avisos?.length ? `<div class="card-grid">${group.avisos.map(a => `<article class="item-card"><h3>${escapeHtml(a.titulo)}</h3><p>${escapeHtml(a.texto || "")}</p><small>${formatDateTime(a.criadoEm)}</small></article>`).join("")}</div>` : emptyState("Nenhum aviso publicado", "Avisos do grupo aparecer\u00e3o aqui.");
    else if (["professores", "participantes"].includes(state.groupTab)) { const people = state.groupTab === "professores" ? group.orientadores : group.membros; panel = people?.length ? `<div class="card-grid">${people.map(m => `<article class="item-card"><h3>${escapeHtml(m.nome)}</h3><p>${state.groupTab === "professores" ? "Professor orientador" : "Participante do grupo"}</p></article>`).join("")}</div>` : emptyState("Nenhuma pessoa cadastrada", "Os integrantes aparecer\u00e3o aqui."); }
    else if (state.groupTab === "agenda") panel = group.agenda?.length ? `<div class="card-grid">${group.agenda.map(p => `<article class="item-card"><h3>${escapeHtml(p.titulo)}</h3><p>${formatDate(p.dataPrevista)} ? ${escapeHtml(p.objetivos || p.conteudo || "")}</p></article>`).join("")}</div>` : emptyState("Agenda vazia", "Encontros planejados aparecer\u00e3o aqui.");
    else if (state.groupTab === "discussoes") panel = group.discussoes?.length ? `<div class="card-grid">${group.discussoes.map(t => `<article class="item-card"><h3>${escapeHtml(t.titulo)}</h3><p>${escapeHtml(t.descricao)}</p><small>${escapeHtml(t.autor)} ? ${t.respostas} respostas</small><div class="card-actions"><button class="btn secondary small" data-action="open-topic" data-id="${t.id}">Abrir discuss\u00e3o</button></div></article>`).join("")}</div>` : emptyState("Nenhuma discuss\u00e3o iniciada", "Inicie uma conversa no f\u00f3rum do grupo.");
    else if (state.groupTab === "materiais" || state.groupTab === "videos") {
      panel = data.length ? `<div class="card-grid">${data.map((item) => materialCard(item, state.groupTab === "videos")).join("")}</div>` : emptyState("Nenhum conteúdo publicado", "O professor poderá publicar materiais e vídeos neste grupo.");
    } else if (state.groupTab === "atividades") {
      panel = data.length ? `<div class="card-grid">${data.map(assignmentCard).join("")}</div>` : emptyState("Nenhuma atividade publicada", "As atividades deste grupo aparecerão aqui.");
    } else if (state.groupTab === "projetos") {
      panel = data.length ? `<div class="card-grid">${data.map(projectCard).join("")}</div>` : emptyState("Nenhum projeto vinculado", "Projetos do grupo aparecerão aqui.");
    } else if (state.groupTab === "planejamento") {
      panel = group.planejamentos?.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Encontro</th><th>Data prevista</th><th>Objetivos</th><th>Conteúdo planejado / realizado</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${group.planejamentos.map((p) => `<tr><td>${escapeHtml(p.titulo)}</td><td>${formatDate(p.dataPrevista)}</td><td>${escapeHtml(p.objetivos||"—")}</td><td>${escapeHtml(p.conteudoRealizado||p.conteudoPlanejado||"—")}</td><td>${escapeHtml(p.status==="COMPLETED"?"Realizado":p.status==="CANCELED"?"Cancelado":"Planejado")}</td><td><button class="btn secondary small" data-action="edit-group-plan" data-id="${p.id}">Editar</button> <button class="btn danger small" data-action="delete-group-plan" data-id="${p.id}">Excluir</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("Planejamento ainda vazio", "Registre objetivos, conteúdo e a realização dos encontros deste grupo.");
    } else if (state.groupTab === "integrantes") {
      panel = group.membros.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Aluno</th><th>E-mail</th><th>Data de entrada</th><th>Situação</th><th></th></tr></thead><tbody>${group.membros.map((member) => `<tr><td>${escapeHtml(member.nome)}</td><td>${escapeHtml(member.email)}</td><td>${formatDateTime(member.entrouEm)}</td><td>${escapeHtml(member.status)}</td><td><div class="card-actions">${member.statusCodigo === "PENDING" ? `<button class="btn primary small" data-action="decide-group-request" data-status="APPROVED" data-group="${group.id}" data-id="${member.id}">Aprovar</button><button class="btn danger small" data-action="decide-group-request" data-status="REJECTED" data-group="${group.id}" data-id="${member.id}">Recusar</button>` : `<button class="btn secondary small" data-action="view-member-submissions" data-group="${group.id}" data-id="${member.id}">Ver entregas</button><button class="btn danger small" data-action="remove-member" data-group="${group.id}" data-id="${member.id}">Remover</button>`}</div></td></tr>`).join("")}</tbody></table></div>` : emptyState("Sem integrantes", "Os alunos que entrarem no grupo aparecerão aqui.");
    }
    content = `<button class="text-button back-link" data-action="navigate" data-page="${isStudent() ? "meus-grupos" : "grupos"}">← Voltar aos grupos</button>
      <div class="welcome"><div><div class="item-meta"><span class="pill">${escapeHtml(group.disciplina || "Grupo de estudo")}</span>${statusPill(group.statusLabel, group.status)}</div><h2>${escapeHtml(group.nome)}</h2><p>${escapeHtml(group.descricao || "")}</p><p>Professor: ${escapeHtml(group.professor)} • ${group.participantes}/${group.limiteAlunos} participantes • ${group.vagas} vagas restantes</p></div></div>
      <div class="group-tabs">${tabs.map(([id, label]) => `<button class="tab ${state.groupTab === id ? "active" : ""}" data-action="group-tab" data-tab="${id}">${label}</button>`).join("")}</div>
      ${!isStudent() && ["materiais", "videos", "atividades", "projetos", "planejamento"].includes(state.groupTab) ? `<div class="card-actions group-content-actions">${state.groupTab === "planejamento" ? `<button class="btn primary small" data-action="new-group-plan" data-group="${group.id}">+ Planejar encontro</button>` : ""}${state.groupTab === "materiais" ? `<button class="btn primary small" data-action="new-material" data-group="${group.id}">+ Publicar material</button>` : ""}${state.groupTab === "videos" ? `<button class="btn primary small" data-action="new-video" data-group="${group.id}">+ Publicar vídeo</button>` : ""}${state.groupTab === "atividades" ? `<button class="btn primary small" data-action="new-assignment" data-group="${group.id}">+ Criar tarefa</button>` : ""}${state.groupTab === "projetos" ? `<button class="btn primary small" data-action="new-project" data-group="${group.id}">+ Criar projeto</button>` : ""}</div>` : ""}
      ${panel}`;
  } else if (state.page === "turma") {
    if(!state.classId){state.page="turmas";return renderPage();}
    const [c,lessons,assessments,occurrences,students,report]=await Promise.all([api(`/api/turmas/${state.classId}`),api(`/api/turmas/${state.classId}/aulas`),api(`/api/turmas/${state.classId}/avaliacoes`),api(`/api/turmas/${state.classId}/ocorrencias`),api(`/api/turmas/${state.classId}/alunos`),api(`/api/turmas/${state.classId}/relatorio`)]);
    const avg=report.alunos.filter(r=>r.mediaPonderada!==null),avgValue=avg.length?(avg.reduce((s,r)=>s+r.mediaPonderada,0)/avg.length).toFixed(1):"—",freq=report.alunos.filter(r=>r.frequencia!==null),freqValue=freq.length?`${Math.round(freq.reduce((s,r)=>s+r.frequencia,0)/freq.length)}%`:"—";
    const needsSupport=report.alunos.filter(r=>(r.mediaPonderada!==null&&r.mediaPonderada<60)||(r.frequencia!==null&&r.frequencia<75)),strong=report.alunos.filter(r=>r.mediaPonderada!==null&&r.mediaPonderada>=80&&r.frequencia!==null&&r.frequencia>=75).sort((a,b)=>b.mediaPonderada-a.mediaPonderada);
    content=`<button class="text-button back-link" data-action="navigate" data-page="turmas">← Voltar às turmas</button><div class="welcome"><div><span class="pill">${escapeHtml(c.disciplina)}</span><h2>${escapeHtml(c.nome)}</h2><p>${c.anoLetivo} · ${c.periodo}º período · ${c.alunos} matrículas ativas</p></div></div><div class="stats">${statCard("Alunos matriculados",c.alunos)}${statCard("Avaliações",report.avaliacoes)}${statCard("Média da turma",avgValue)}${statCard("Frequência média",freqValue)}</div><div class="section-heading"><div><h2>Acompanhamento</h2><p>Avaliações, trabalhos, frequência e ocorrências da turma.</p></div><div class="card-actions"><button class="btn primary small" data-action="new-assessment" data-id="${c.id}">+ Nova avaliação</button><button class="btn secondary small" data-action="new-occurrence" data-id="${c.id}">+ Ocorrência</button></div></div><section class="panel dashboard-panel"><div class="section-heading"><div><h3>Avaliações e trabalhos</h3><p>Notas ponderadas pelo peso cadastrado em cada item.</p></div></div>${assessments.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Avaliação / trabalho</th><th>Categoria</th><th>Prazo</th><th>Peso</th><th>Notas lançadas</th><th></th></tr></thead><tbody>${assessments.map(a=>`<tr><td>${escapeHtml(a.titulo)}</td><td>${escapeHtml(a.categoria)}</td><td>${formatDate(a.prazo)}</td><td>${a.peso}</td><td>${a.notas.filter(n=>n.nota!==null).length}/${a.notas.length}</td><td><button class="btn secondary small" data-action="enter-grades" data-id="${a.id}">Lançar notas</button></td></tr>`).join("")}</tbody></table></div>`:emptyState("Nenhuma avaliação cadastrada","Crie provas, trabalhos ou outras avaliações com peso.")}</section><div class="teacher-dashboard-columns"><section class="panel dashboard-panel"><div class="section-heading"><div><h3>Diário de classe</h3><p>Planejamento e conteúdo realizado.</p></div><div class="card-actions"><button class="btn secondary small" data-action="new-schedule" data-id="${c.id}">+ Horário</button><button class="btn primary small" data-action="new-lesson" data-id="${c.id}">+ Registrar aula</button></div></div>${c.horarios.length?`<p>${c.horarios.map(h=>`${["","Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"][h.dia]} ${h.inicio}–${h.fim} · ${escapeHtml(h.local||h.modalidade)}`).join(" | ")}</p>`:"<p>Nenhum horário cadastrado.</p>"}${lessons.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Conteúdo realizado</th><th>Frequência</th></tr></thead><tbody>${lessons.map(l=>`<tr><td>${formatDate(l.data)}</td><td>${escapeHtml(l.conteudoMinistrado||l.conteudoPlanejado||"—")}</td><td><button class="btn secondary small" data-action="attendance" data-class="${c.id}" data-id="${l.id}">Lançar / ver</button></td></tr>`).join("")}</tbody></table></div>`:emptyState("Diário ainda sem aulas","Adicione o primeiro registro para iniciar o diário.")}</section><section class="panel dashboard-panel"><div class="section-heading"><div><h3>Ocorrências</h3><p>Registre fatos e próximos passos de acompanhamento.</p></div></div>${occurrences.length?`<div class="teacher-grade-list">${occurrences.map(o=>`<article class="teacher-grade-item"><div><strong>${escapeHtml(o.aluno)} · ${escapeHtml(o.tipo)}</strong><small>${formatDate(o.data)} · ${escapeHtml(o.descricao)}${o.acompanhamento?` · Próximo passo: ${escapeHtml(o.acompanhamento)}`:""}</small></div>${o.status==="OPEN"?`<button class="btn secondary small" data-action="resolve-occurrence" data-id="${o.id}" data-class="${c.id}">Concluir</button>`:statusPill("Concluída","COMPLETED")}</article>`).join("")}</div>`:emptyState("Sem ocorrências registradas","Novos registros de acompanhamento aparecerão aqui.")}</section></div><section class="panel dashboard-panel"><div class="section-heading"><div><h3>Desempenho dos alunos</h3><p>Média ponderada, frequência e registros de acompanhamento.</p></div></div>${report.alunos.length?`<div class="teacher-dashboard-columns"><section><h4>Precisam de atenção</h4>${needsSupport.length?needsSupport.map(r=>`<article class="teacher-grade-item"><div><strong>${escapeHtml(r.aluno)}</strong><small>Média ${r.mediaPonderada??"—"} · Frequência ${r.frequencia==null?"—":`${r.frequencia}%`}</small></div><span class="pill warning">Atenção</span></article>`).join(""):"<p>Nenhum alerta pelos indicadores disponíveis.</p>"}</section><section><h4>Bom desempenho</h4>${strong.length?strong.slice(0,5).map(r=>`<article class="teacher-grade-item"><div><strong>${escapeHtml(r.aluno)}</strong><small>Média ${r.mediaPonderada}% · Frequência ${r.frequencia}%</small></div><span class="pill success">Em dia</span></article>`).join(""):"<p>Os destaques aparecerão após o lançamento de notas e frequência.</p>"}</section></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Aluno</th><th>Média ponderada</th><th>Frequência</th><th>Ocorrências</th></tr></thead><tbody>${report.alunos.map(r=>`<tr><td>${escapeHtml(r.aluno)}</td><td>${r.mediaPonderada===null?"—":`${r.mediaPonderada}%`}</td><td>${r.frequencia===null?"—":`${r.frequencia}%`}</td><td>${r.ocorrencias}</td></tr>`).join("")}</tbody></table></div>`:emptyState("Dados de acompanhamento ainda indisponíveis","O relatório será preenchido após a matrícula acadêmica oficial dos alunos.")}</section>`;
  } else if (state.page === "turmas") {
    const classes=await api("/api/turmas");
    content=`<div class="section-heading"><div><h2>Turmas sob sua responsabilidade</h2><p>Organize diário, frequência, horários e tarefas acadêmicas.</p></div><button class="btn primary small" data-action="new-class">+ Nova turma</button></div>${classes.length?`<div class="card-grid">${classes.map(c=>`<article class="item-card"><div class="item-meta"><span class="pill">${escapeHtml(c.codigoDisciplina||c.disciplina)}</span><span class="pill">${c.anoLetivo} · ${c.periodo}º período</span></div><h3>${escapeHtml(c.nome)}</h3><p>${escapeHtml(c.disciplina)} · ${c.alunos} alunos matriculados</p><p>${c.horarios.length?c.horarios.map(h=>`${["","Seg","Ter","Qua","Qui","Sex","Sáb","Dom"][h.dia]} ${h.inicio}–${h.fim}`).join(" · "):"Sem horário cadastrado"}</p><button class="btn secondary small" data-action="open-class" data-id="${c.id}">Abrir diário da turma</button></article>`).join("")}</div>`:emptyState("Nenhuma turma cadastrada","Cadastre uma disciplina e crie uma turma acadêmica para iniciar o diário.")}`;
  } else if (state.page === "disciplinas") {
    const subjects=await api("/api/disciplinas");
    content=`<div class="section-heading"><div><h2>Disciplinas</h2><p>As disciplinas formam a estrutura das turmas acadêmicas.</p></div><button class="btn primary small" data-action="new-subject">+ Nova disciplina</button></div>${subjects.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Código</th><th>Disciplina</th><th>Turmas vinculadas</th></tr></thead><tbody>${subjects.map(s=>`<tr><td>${escapeHtml(s.codigo||"—")}</td><td>${escapeHtml(s.nome)}</td><td>${s.turmas}</td></tr>`).join("")}</tbody></table></div>`:emptyState("Nenhuma disciplina cadastrada","Cadastre disciplinas para vinculá-las às suas turmas.")}`;
  } else if (state.page === "atividades" || state.page === "tarefas" || state.page === "dashboard-tarefas") {
    const data = state.page === "dashboard-tarefas" ? await api("/api/dashboard?tipo=tarefas") : { tarefas: await api("/api/tarefas") };
    const items = data.tarefas || [];
    content = `${!isStudent() ? `<div class="dashboard-links">${dashboardNavigation()}<button class="btn primary small" data-action="new-assignment">+ Nova tarefa</button></div><div class="stats">${statCard("Criadas", data.tarefasCriadas ?? items.length)}${statCard("Entregues", data.tarefasEntregues ?? items.reduce((sum, item) => sum + item.recebidos, 0))}${statCard("Pendentes", data.tarefasPendentes ?? items.reduce((sum, item) => sum + item.vagasPendentes, 0))}</div>${state.page === "dashboard-tarefas" ? dashboardChart("Entregas de tarefas", "Volume previsto em relação às entregas recebidas.", [{ label: "Entregues", value: data.tarefasEntregues, color: "green" }, { label: "Pendentes", value: data.tarefasPendentes, color: "yellow" }]) : ""}` : ""}
      ${isStudent() && items.length ? `<section class="panel report-filters"><div class="form-grid"><div class="field"><label for="task-search">Buscar atividade</label><input id="task-search" data-task-filter placeholder="T\u00edtulo, disciplina ou grupo"></div><div class="field"><label for="task-status">Status</label><select id="task-status" data-task-filter><option value="">Todos</option><option value="NOT_STARTED">Pendente</option><option value="IN_PROGRESS">Em andamento</option><option value="SUBMITTED">Entregue</option><option value="IN_REVIEW">Em corre\u00e7\u00e3o</option><option value="RESUBMIT">Reenviar</option><option value="APPROVED">Corrigida</option></select></div></div></section>` : ""}${items.length ? `<div class="card-grid">${items.map(assignmentCard).join("")}</div>` : emptyState("Nenhuma tarefa cadastrada", isStudent() ? "As atividades dos seus grupos aparecerão aqui." : "Crie uma tarefa para começar.")}`;
  } else if (state.page === "projetos" || state.page === "dashboard-projetos") {
    const data = state.page === "dashboard-projetos" ? await api("/api/dashboard?tipo=projetos") : null;
    const projects = data?.projetos || await api("/api/projetos");
    const projectSummary = data ? `<div class="stats">${statCard("Projetos ativos", data.projetosAtivos)}${statCard("Concluídos", data.projetosConcluidos)}${statCard("Atrasados", data.projetosAtrasados)}</div>${dashboardChart("Situação dos projetos", "Acompanhe projetos ativos, concluídos e atrasados.", [{ label: "Ativos", value: data.projetosAtivos, color: "blue" }, { label: "Concluídos", value: data.projetosConcluidos, color: "green" }, { label: "Atrasados", value: data.projetosAtrasados, color: "red" }])}` : "";
    content = `${!isStudent() ? `<div class="dashboard-links">${dashboardNavigation()}<button class="btn primary small" data-action="new-project">+ Novo projeto</button></div>${projectSummary}` : ""}
      ${projects.length ? `<div class="card-grid">${projects.map(projectCard).join("")}</div>` : emptyState("Nenhum projeto cadastrado", "Projetos dos seus grupos aparecerão aqui.")}`;
  } else if (state.page === "materiais" || state.page === "videos") {
    const video = state.page === "videos";
    const items = await api(video ? "/api/videos" : "/api/materiais");
    content = `${!isStudent() ? `<div class="section-heading"><div><h2>Conteúdos publicados</h2><p>Compartilhe arquivos, links e conteúdos com os grupos.</p></div><button class="btn primary small" data-action="${video ? "new-video" : "new-material"}">+ Publicar ${video ? "vídeo" : "material"}</button></div>` : ""}
      ${items.length ? `<div class="card-grid">${items.map((item) => materialCard(item, video)).join("")}</div>` : emptyState(video ? "Nenhum vídeo publicado" : "Nenhum material publicado", "Conteúdos de seus grupos aparecerão nesta página.")}`;
  } else if (state.page === "entregaveis" || state.page === "dashboard-entregaveis") {
    const data = await api("/api/dashboard?tipo=entregaveis");
    content = `${dashboardNavigation()}<div class="stats">${statCard("Total previsto", data.entregaveisPrevistos)}${statCard("Total recebido", data.entregaveisRecebidos)}${statCard("Total pendente", data.entregaveisPendentes)}${statCard("Aguardando correção", data.aguardandoCorrecao)}</div>
      ${dashboardChart("Entregáveis recebidos", "Comparativo de entregas previstas, recebidas e pendentes.", [{ label: "Recebidos", value: data.entregaveisRecebidos, color: "green" }, { label: "Pendentes", value: data.entregaveisPendentes, color: "yellow" }])}
      ${data.entregaveis?.length ? `<div class="card-grid">${data.entregaveis.map(submissionCard).join("")}</div>` : emptyState("Nenhuma entrega recebida", "Os envios dos alunos aparecerão nesta área.")}`;
  } else if (state.page === "relatorios") {
    const [groups,classes] = await Promise.all([ownedGroups(),api("/api/turmas")]);
    content = `<div class="section-heading"><div><h2>Relatórios de aproveitamento</h2><p>Compare entregas de grupos com notas, frequência e ocorrências das turmas.</p></div></div>
      <form class="panel report-filters" data-form="report"><div class="form-grid"><div class="field"><label for="report-type">Tipo</label><select id="report-type" name="tipo"><option value="semester">Por semestre / grupos</option><option value="group">Por grupo</option><option value="class">Por turma acadêmica</option></select></div><div class="field"><label for="report-semester">Semestre</label><select id="report-semester" name="semestre"><option value="">Todos</option>${[1, 2, 3, 4, 5, 6].map((semester) => `<option value="${semester}">${semester}º semestre</option>`).join("")}</select></div><div class="field"><label for="report-group">Grupo de estudo</label><select id="report-group" name="grupoId"><option value="">Todos os grupos</option>${groupFormOptions(groups)}</select></div><div class="field"><label for="report-class">Turma acadêmica</label><select id="report-class" name="turmaId"><option value="">Selecione uma turma</option>${classes.map(c=>`<option value="${c.id}">${escapeHtml(c.disciplina)} · ${escapeHtml(c.nome)}</option>`).join("")}</select></div><div class="field"><label for="report-student">ID do aluno (opcional)</label><input id="report-student" name="alunoId" type="number" min="1" placeholder="Para filtrar individualmente"></div></div><div class="card-actions"><button class="btn primary" type="submit">Gerar relatório</button><button class="btn secondary" type="button" data-action="print-report">Imprimir / salvar PDF</button></div></form><div id="report-result">${emptyState("Nenhum relatório gerado", "Selecione os filtros e clique em Gerar relatório.")}</div>`;
  } else if (state.page === "desempenho") {
    const dashboard = await api("/api/dashboard?tipo=resumo");
    content = `<div class="stats">${statCard("Grupos de estudo", dashboard.grupos)}${statCard("Alunos participantes", dashboard.alunos)}${statCard("Tarefas pendentes", dashboard.tarefasPendentes)}${statCard("Entregas aguardando correção", dashboard.aguardandoCorrecao)}</div>
      ${semesterDashboard(dashboard.semestres)}
      <section class="panel dashboard-panel"><div class="section-heading"><div><h2>Desempenho por grupo</h2><p>Progresso calculado a partir das entregas previstas e recebidas.</p></div></div>${dashboard.gruposResumo?.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Grupo</th><th>Semestre</th><th>Alunos</th><th>Atividades</th><th>Progresso</th></tr></thead><tbody>${dashboard.gruposResumo.map((group) => `<tr><td>${escapeHtml(group.nome)}</td><td>${group.semestre || "—"}</td><td>${group.alunos}</td><td>${group.tarefas}</td><td>${Math.max(0, Math.min(100, Number(group.progresso) || 0))}%</td></tr>`).join("")}</tbody></table></div>` : emptyState("Sem grupos para acompanhar", "Os indicadores aparecerão quando houver grupos vinculados.")}</section>`;
  } else if (state.page === "perfil") {
    state.user = await api("/api/auth/me");
    content = `<div class="panel profile-editor">
      <div class="profile-editor-heading">${avatar(state.user, "profile-photo-preview")}<div><h2>Editar perfil</h2><p>Atualize seu nome e sua foto. Os dados institucionais são gerenciados pela Fatec.</p></div></div>
      <form data-form="profile">
        <div class="field"><label for="profile-name">Nome completo</label><input id="profile-name" name="nome" value="${escapeHtml(state.user.nome)}" maxlength="120" autocomplete="name" required></div>
        <div class="field"><label for="profile-photo">Foto de perfil</label><input id="profile-photo" name="foto" type="file" accept="image/png,image/jpeg,image/webp"><span class="helper-text">PNG, JPG ou WebP; máximo de 5 MB.</span></div>
        ${state.user.fotoUrl ? `<label class="profile-remove"><input name="removerFoto" type="checkbox" value="true"> Remover foto atual</label>` : ""}
        <div class="profile-details">
          <div><span>E-mail institucional</span><strong>${escapeHtml(state.user.email)}</strong></div>
          <div><span>Perfil</span><strong>${roleName(state.user.perfil)}</strong></div>
          ${state.user.ra ? `<div><span>RA</span><strong>${escapeHtml(state.user.ra)}</strong></div>` : ""}
          ${state.user.curso ? `<div><span>Curso</span><strong>${escapeHtml(state.user.curso)}</strong></div>` : ""}
          ${state.user.matricula ? `<div><span>Matrícula</span><strong>${escapeHtml(state.user.matricula)}</strong></div>` : ""}
        </div>
        <p class="form-error" data-error></p>
        <button class="btn primary" type="submit">Salvar alterações</button>
      </form>
    </div>`;
  } else {
    content = emptyState("Página não encontrada", "Selecione uma opção no menu.");
  }
  shell(content, title, subtitle);
  if (state.focusedAssignmentId) {
    document.querySelector(`[data-assignment-id="${state.focusedAssignmentId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    state.focusedAssignmentId = null;
  }
}

function submissionCard(item) {
  const statusSelect = `<select name="status"><option value="IN_REVIEW">Em revisão</option><option value="APPROVED">Aprovar</option><option value="REJECTED">Reprovar</option><option value="RESUBMIT">Solicitar reenvio</option></select>`;
  return `<article class="item-card"><div class="item-meta"><span class="pill">${item.projeto ? "Projeto" : "Tarefa"}</span>${statusPill(item.status, item.statusCodigo)}</div>
    <h3>${escapeHtml(item.titulo)}</h3><p>Aluno: ${escapeHtml(item.aluno)} • ${escapeHtml(item.email)}</p><p>Grupo: ${escapeHtml(item.grupo || "—")} • Versão ${item.versao}</p>
    <p>${escapeHtml(item.nomeArquivo)} • ${formatDateTime(item.enviadaEm)}</p><p>${escapeHtml(item.comentario || "Sem comentário do aluno.")}</p>
    ${item.arquivoId ? `<a class="btn secondary small" href="/api/arquivos/${item.arquivoId}" download>Baixar arquivo</a>` : ""}
    <button class="btn primary small" data-action="review-submission" data-id="${item.id}">Corrigir entrega</button></article>`;
}

function openModal(title, description, body) {
  modal.innerHTML = `<div class="modal-content"><div class="modal-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></div>${body}</div>`;
  modal.showModal();
}

function errorField() {
  return `<p class="form-error" data-error></p>`;
}

function showFormError(form, message) {
  const target = form.querySelector("[data-error]");
  if (target) target.textContent = message;
  else showToast(message);
}

async function openGroupForm(group = null) {
  const content = group || {};
  openModal(group ? "Editar grupo" : "Criar grupo", "Defina a disciplina, o semestre e os dados do grupo. O limite máximo é 20 alunos.", `<form data-form="group" ${group ? `data-id="${group.id}"` : ""}>
    <div class="field"><label for="group-name">Nome do grupo</label><input id="group-name" name="nome" maxlength="150" value="${escapeHtml(content.nome || "")}" required></div>
    <div class="form-grid"><div class="field"><label for="group-subject">Disciplina</label><select id="group-subject" name="disciplina" required><option value="">Selecione</option>${courses.map((course) => `<option value="${escapeHtml(course)}" ${content.disciplina === course ? "selected" : ""}>${escapeHtml(course)}</option>`).join("")}</select></div><div class="field"><label for="group-semester">Semestre</label><select id="group-semester" name="semestre" required><option value="">Selecione</option>${[1, 2, 3, 4, 5, 6].map((semester) => `<option value="${semester}" ${Number(content.semestre) === semester ? "selected" : ""}>${semester}º semestre</option>`).join("")}</select></div></div>
    <div class="field"><label for="group-description">Descrição</label><textarea id="group-description" name="descricao" maxlength="1000">${escapeHtml(content.descricao || "")}</textarea></div>
    <div class="form-grid"><div class="field"><label>Tema</label><input name="tema" maxlength="160" value="${escapeHtml(content.tema||"")}"></div><div class="field"><label>Nível</label><select name="nivel"><option value="">Selecione</option>${["Iniciante","Intermediário","Avançado","Todos os níveis"].map(x=>`<option ${content.nivel===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="field"><label>Modalidade</label><select name="modalidade"><option value="">Selecione</option>${["Presencial","Remota","Híbrida"].map(x=>`<option ${content.modalidade===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="field"><label>Horário dos encontros</label><input name="horarioEncontros" maxlength="180" value="${escapeHtml(content.horarioEncontros||"")}"></div></div>
    <div class="field"><label>Objetivos de estudo</label><textarea name="objetivos" maxlength="1000">${escapeHtml(content.objetivos||"")}</textarea></div><div class="field"><label>Metodologia</label><textarea name="metodologia" maxlength="1000">${escapeHtml(content.metodologia||"")}</textarea></div><div class="field"><label>Regras de participação</label><textarea name="regrasParticipacao" maxlength="1000">${escapeHtml(content.regrasParticipacao||"")}</textarea></div>
    <div class="form-grid"><div class="field"><label for="group-limit">Limite de alunos (máx. 20)</label><input id="group-limit" name="limiteAlunos" type="number" min="1" max="20" value="${content.limiteAlunos || 20}" required></div><div class="field"><label for="group-min">Mínimo para iniciar projetos</label><input id="group-min" name="minimoAlunos" type="number" min="1" max="20" value="${content.minimoAlunos || 5}" required></div>
    <div class="field"><label for="group-start">Data de início</label><input id="group-start" name="dataInicio" type="date" value="${escapeHtml(content.dataInicio || "")}"></div><div class="field"><label for="group-end">Data de término</label><input id="group-end" name="dataTermino" type="date" value="${escapeHtml(content.dataTermino || "")}"></div></div>
    ${errorField()}<button class="btn primary wide" type="submit">${group ? "Salvar alterações" : "Criar grupo"}</button>
  </form>`);
}

async function ownedGroups() {
  const groups = await api("/api/grupos?meus=1");
  return groups.filter((group) => group.status !== "CLOSED");
}

async function openAssignmentForm(groupId = "", classId = "") {
  const groups = await ownedGroups();
  const classes = await api("/api/turmas");
  openModal("Nova tarefa", "Escolha um grupo de estudo ou uma turma acadêmica como destino.", `<form data-form="assignment">
    <div class="field"><label for="task-title">Título</label><input id="task-title" name="titulo" maxlength="180" required></div>
    <div class="field"><label for="task-description">Descrição</label><textarea id="task-description" name="descricao" maxlength="2000"></textarea></div>
    <div class="form-grid"><div class="field"><label for="task-kind">Tipo</label><select id="task-kind" name="tipo"><option value="TASK">Tarefa</option><option value="EXERCISE">Exercício</option><option value="WORK">Trabalho</option></select></div>
    <div class="field"><label for="task-group">Grupo de estudo</label><select id="task-group" name="grupoId"><option value="">Nenhum</option>${groupFormOptions(groups, groupId)}</select></div>
    <div class="field"><label for="task-class">Turma acadêmica</label><select id="task-class" name="turmaId"><option value="">Nenhuma</option>${classes.map(c=>`<option value="${c.id}" ${String(c.id)===String(classId)?"selected":""}>${escapeHtml(c.disciplina)} · ${escapeHtml(c.nome)}</option>`).join("")}</select></div>
    <div class="field"><label for="task-mode">Modalidade</label><select id="task-mode" name="modalidade"><option value="INDIVIDUAL">Individual</option><option value="GROUP">Grupo de 4 alunos</option></select></div><div class="field"><label for="task-due">Prazo</label><input id="task-due" name="prazo" type="date"></div><div class="field"><label for="task-expected">Entregas esperadas (opcional)</label><input id="task-expected" name="entregasEsperadas" type="number" min="1" max="10000" placeholder="Calculado automaticamente"></div></div>
    ${errorField()}<button class="btn primary wide" type="submit">Publicar tarefa</button></form>`);
}

async function openProjectForm(project = null, groupId = "") {
  const groups = await ownedGroups();
  openModal(project ? "Editar projeto" : "Novo projeto", "Os envios esperados são calculados por integrante ativo do grupo.", `<form data-form="project" ${project ? `data-id="${project.id}"` : ""}>
    <div class="field"><label for="project-name">Nome do projeto</label><input id="project-name" name="nome" maxlength="180" value="${escapeHtml(project?.nome || "")}" required></div>
    <div class="field"><label for="project-description">Descrição</label><textarea id="project-description" name="descricao" maxlength="2000">${escapeHtml(project?.descricao || "")}</textarea></div>
    <div class="field"><label for="project-group">Grupo</label><select id="project-group" name="grupoId" required><option value="">Selecione</option>${groupFormOptions(groups, project?.grupoId || groupId)}</select></div>
    <div class="form-grid"><div class="field"><label for="project-start">Data de início</label><input id="project-start" name="dataInicio" type="date" value="${escapeHtml(project?.inicio || "")}" required></div><div class="field"><label for="project-end">Data final</label><input id="project-end" name="dataFinal" type="date" value="${escapeHtml(project?.fim || "")}" required></div></div>
    <div class="field"><label for="project-criteria">Critérios de avaliação</label><textarea id="project-criteria" name="criterios" maxlength="2000">${escapeHtml(project?.criterios || "")}</textarea></div>
    ${errorField()}<button class="btn primary wide" type="submit">${project ? "Salvar alterações" : "Criar projeto"}</button></form>`);
}

async function openContentForm(type, groupId = "") {
  const video = type === "video";
  const groups = await ownedGroups();
  const accept = video ? ".mp4,.webm,.mov" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.png,.jpg,.jpeg,.gif,.webp";
  openModal(video ? "Publicar v\u00eddeo" : "Publicar material", video ? "Cole um link externo ou envie um arquivo. Com um link v\u00e1lido, o arquivo n\u00e3o \u00e9 necess\u00e1rio." : "Arquivos ficam dispon\u00edveis somente aos integrantes e respons\u00e1veis do grupo.", `<form data-form="${video ? "video" : "material"}" enctype="multipart/form-data">
    <div class="field"><label for="content-title">Título</label><input id="content-title" name="titulo" maxlength="180" required></div>
    <div class="field"><label for="content-group">Grupo</label><select id="content-group" name="grupoId" required><option value="">Selecione</option>${groupFormOptions(groups, groupId)}</select></div>
    <div class="field"><label for="content-description">Descrição</label><textarea id="content-description" name="descricao" maxlength="1000"></textarea></div>
    <div class="field"><label for="content-url">Link externo ${video ? "(YouTube/Stream)" : "(opcional)"}</label><input id="content-url" name="url" type="url" placeholder="https://..."></div>
    <div class="field"><label for="content-file">${video ? "Arquivo de v\u00eddeo (opcional)" : "Enviar arquivo"} (${video ? "at\u00e9 100 MB, MP4/WebM/MOV" : "at\u00e9 25 MB, PDF/DOCX/XLSX/PPTX/ZIP/imagem"})</label><input id="content-file" name="arquivo" type="file" accept="${accept}"></div>
    ${errorField()}<button class="btn primary wide" type="submit">Publicar</button></form>`);
}

function openUploadForm(kind, id, title) {
  openModal("Enviar entregável", title, `<form data-form="upload" data-kind="${kind}" data-id="${id}" enctype="multipart/form-data">
    <div class="field"><label for="upload-file">Arquivo (PDF, DOCX, XLSX, PPTX, ZIP ou imagem; até 25 MB)</label><input id="upload-file" name="arquivo" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.png,.jpg,.jpeg,.gif,.webp" required></div>
    <div class="field"><label for="upload-comment">Comentário para o professor</label><textarea id="upload-comment" name="comentario" maxlength="1000"></textarea></div>
    ${errorField()}<button class="btn primary wide" type="submit">Enviar arquivo</button></form>`);
}

function openReviewForm(submission) {
  openModal("Corrigir entregável", `${submission.aluno} • ${submission.titulo}`, `<form data-form="review" data-id="${submission.id}">
    <div class="field"><label for="review-status">Resultado</label><select id="review-status" name="status"><option value="IN_REVIEW">Em revisão</option><option value="APPROVED">Aprovar</option><option value="REJECTED">Reprovar</option><option value="RESUBMIT">Solicitar reenvio</option></select></div>
    <div class="field"><label for="review-grade">Nota (0–100, opcional)</label><input id="review-grade" name="nota" type="number" min="0" max="100" step="0.1"></div>
    <div class="field"><label for="review-comment">Comentário para o aluno</label><textarea id="review-comment" name="comentario" maxlength="2000"></textarea></div>
    ${errorField()}<button class="btn primary wide" type="submit">Salvar correção</button></form>`);
}

async function renderDashboardSubmission() {
  const data = await api("/api/dashboard?tipo=entregaveis");
  const content = `${dashboardNavigation()}<div class="stats">${statCard("Total previsto", data.entregaveisPrevistos)}${statCard("Total recebido", data.entregaveisRecebidos)}${statCard("Total pendente", data.entregaveisPendentes)}${statCard("Aguardando correção", data.aguardandoCorrecao)}</div>
    ${data.entregaveis?.length ? `<div class="card-grid">${data.entregaveis.map(submissionCard).join("")}</div>` : emptyState("Nenhuma entrega recebida", "Os envios dos alunos aparecerão nesta área.")}`;
  return content;
}

async function continueAfterAuthentication() {
  const intent = state.pendingIntent;
  state.pendingIntent = null;
  state.authVisible = false;
  if (isStudent() && intent?.type === "group" && Number.isSafeInteger(intent.id) && intent.id > 0) {
    try {
      await api(`/api/grupos/${intent.id}/participar`, { method: "POST" });
      state.groupId = intent.id;
      state.groupTab = isStudent() ? "visao-geral" : "materiais";
      state.page = "grupo";
    } catch (error) {
      state.page = "grupos";
      showToast(`Não foi possível entrar no grupo. ${error.message}`);
    }
  } else if (isStudent() && intent?.type === "assignment" &&
      Number.isSafeInteger(intent.id) && intent.id > 0) {
    state.page = "atividades";
    state.focusedAssignmentId = intent.id;
  } else if (isStudent() && intent?.type === "groups") {
    state.page = "grupos";
  } else {
    state.page = isStudent() ? "inicio" : "dashboard";
  }
  await refreshPage();
}

async function refreshPage() {
  try {
    await renderPage();
  } catch (error) {
    if (error.message === "Faça login para continuar.") {
      state.user = null;
      state.authVisible = false;
      state.pendingIntent = null;
      await renderPublicHome();
      return;
    }
    if (!state.user) {
      app.innerHTML = `${accessibilityControls()}<main class="public-home"><section class="public-error"><h1>Portal temporariamente indisponível</h1><p>${escapeHtml(error.message)}</p><button class="btn primary" data-action="retry-public-home">Tentar novamente</button></section></main>`;
      return;
    }
    const [title, subtitle] = pageTitles[state.page] ?? ["Ops!", "Ocorreu um problema ao carregar os dados."];
    shell(emptyState("Não foi possível carregar", error.message), title, subtitle);
  }
}

function filterTaskCards() {
  const search=document.getElementById("task-search")?.value.trim().toLocaleLowerCase("pt-BR")||"";
  const status=document.getElementById("task-status")?.value||"";
  for(const card of document.querySelectorAll("[data-assignment-id]")) card.hidden=Boolean((search&&!card.dataset.taskText.toLocaleLowerCase("pt-BR").includes(search))||(status&&card.dataset.taskStatus!==status));
}
function filterGroupCatalog() {
  const value=(id)=>document.getElementById(id)?.value?.trim().toLocaleLowerCase("pt-BR")||"";
  const search=value("catalog-search"),subject=value("catalog-subject"),modality=value("catalog-modality"),level=value("catalog-level"),open=Boolean(document.getElementById("catalog-open")?.checked);
  for(const card of document.querySelectorAll("[data-group-catalog]")) card.hidden=Boolean((search&&!card.textContent.toLocaleLowerCase("pt-BR").includes(search))||(subject&&card.dataset.discipline.toLocaleLowerCase("pt-BR")!==subject)||(modality&&card.dataset.modality.toLocaleLowerCase("pt-BR")!==modality)||(level&&card.dataset.level.toLocaleLowerCase("pt-BR")!==level)||(open&&Number(card.querySelector(".pill:last-of-type")?.textContent.match(/\d+/)?.[0]||0)<=0));
}
document.addEventListener("input", (event) => { if(event.target.matches("[data-group-filter]")) filterGroupCatalog(); if(event.target.matches("[data-task-filter]")) filterTaskCards(); });
document.addEventListener("change", (event) => { if(event.target.matches("[data-group-filter]")) filterGroupCatalog(); if(event.target.matches("[data-task-filter]")) filterTaskCards(); });

document.addEventListener("input", (event) => {
  if (!["feed-search", "feed-discipline"].includes(event.target.id)) return;
  const search = document.querySelector("#feed-search")?.value.trim().toLocaleLowerCase("pt-BR") || "";
  const discipline = document.querySelector("#feed-discipline")?.value || "";
  for (const card of document.querySelectorAll("[data-feed-card]")) {
    const matchesText = !search || card.textContent.toLocaleLowerCase("pt-BR").includes(search);
    const matchesDiscipline = !discipline || !card.dataset.discipline || card.dataset.discipline === discipline;
    card.hidden = !matchesText || !matchesDiscipline;
  }
});

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied || !image.dataset.fallback) return;
  image.dataset.fallbackApplied = "true";
  image.src = image.dataset.fallback;
}, true);

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button instanceof HTMLAnchorElement) event.preventDefault();
  const { action } = button.dataset;
  try {
    if (action === "auth-view") {
      state.authVisible = true;
      state.authView = button.dataset.view;
      renderAuth();
    } else if (action === "show-login") {
      state.authVisible = true;
      state.authView = "login";
      renderAuth();
    } else if (action === "public-home") {
      state.authVisible = false;
      state.pendingIntent = null;
      await refreshPage();
    } else if (action === "public-intent") {
      state.pendingIntent = {
        type: button.dataset.intent,
        id: Number(button.dataset.id)
      };
      state.authVisible = true;
      state.authView = "login";
      renderAuth();
    } else if (action === "retry-public-home") {
      await refreshPage();
    } else if (action === "font-size") {
      state.fontSize = button.dataset.size === state.fontSize ? "" : button.dataset.size;
      localStorage.setItem("techfatec.fontSize", state.fontSize);
      applyAccessibilityPreferences();
      await refreshPage();
    } else if (action === "high-contrast") {
      state.highContrast = !state.highContrast;
      localStorage.setItem("techfatec.highContrast", String(state.highContrast));
      applyAccessibilityPreferences();
      await refreshPage();
    } else if (action === "navigate") {
      state.page = button.dataset.page;
      await refreshPage();
    } else if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      state.authVisible = false;
      state.pendingIntent = null;
      await refreshPage();
    } else if (action === "close-modal") {
      modal.close();
    } else if (action === "print-report") {
      window.print();
    } else if (action === "new-group") {
      await openGroupForm();
    } else if (action === "edit-group") {
      await openGroupForm(await api(`/api/grupos/${button.dataset.id}`));
    } else if (action === "delete-group") {
      if (confirm("Excluir este grupo e os conteúdos e projetos vinculados?")) {
        await api(`/api/grupos/${button.dataset.id}`, { method: "DELETE" });
        showToast("Grupo excluído.");
        await refreshPage();
      }
    } else if (action === "close-group") {
      await api(`/api/grupos/${button.dataset.id}/encerrar`, { method: "POST" });
      showToast("Grupo encerrado.");
      await refreshPage();
    } else if (action === "join-group") {
      await api(`/api/grupos/${button.dataset.id}/participar`, { method: "POST" });
      showToast("Solicitação enviada para aprovação do professor.");
      await refreshPage();
    } else if (action === "cancel-group-request") {
      await api(`/api/grupos/${button.dataset.id}/participar`, { method: "DELETE" });
      showToast("Solicitação cancelada.");
      await refreshPage();
    } else if (action === "leave-group") {
      if (confirm("Deseja sair deste grupo?")) {
        await api(`/api/grupos/${button.dataset.id}/sair`, { method: "POST" });
        showToast("Você saiu do grupo.");
        await refreshPage();
      }
    } else if (action === "enter-group") {
      state.groupId = Number(button.dataset.id);
      state.groupTab = isStudent() ? "visao-geral" : "materiais";
      state.page = "grupo";
      await refreshPage();
    } else if (action === "group-tab") {
      state.groupTab = button.dataset.tab;
      await refreshPage();
    } else if (action === "decide-group-request") {
      await api(`/api/grupos/${button.dataset.group}/solicitacoes/${button.dataset.id}`, { method: "PUT", body: { status: button.dataset.status } });
      showToast(button.dataset.status === "APPROVED" ? "Participa\u00e7\u00e3o aprovada." : "Solicita\u00e7\u00e3o recusada.");
      await refreshPage();
    } else if (action === "remove-member") {
      if (confirm("Remover este integrante do grupo?")) {
        await api(`/api/grupos/${button.dataset.group}/membros/${button.dataset.id}`, { method: "DELETE" });
        showToast("Integrante removido.");
        await refreshPage();
      }
    } else if (action === "view-member-submissions") {
      const submissions = await api(`/api/grupos/${button.dataset.group}/membros/${button.dataset.id}/entregas`);
      openModal("Entregas do aluno", "Entregáveis enviados neste grupo.", submissions.length
        ? `<div class="card-grid">${submissions.map(submissionCard).join("")}</div>`
        : emptyState("Nenhuma entrega", "Este aluno ainda não enviou entregáveis para o grupo."));
    } else if (action === "new-assignment") {
      await openAssignmentForm(button.dataset.group || "",button.dataset.class || "");
    } else if (action === "new-subject") {
      state.returnToClassAfterSubject = button.dataset.returnToClass === "true";
      openModal("Nova disciplina","Cadastre uma disciplina para usar em turmas acadêmicas.",`<form data-form="subject"><div class="field"><label>Código (opcional)</label><input name="codigo" maxlength="30"></div><div class="field"><label>Nome da disciplina</label><input name="nome" maxlength="160" required></div>${errorField()}<button class="btn primary wide" type="submit">Cadastrar disciplina</button></form>`);
    } else if (action === "new-class") {
      const subjects=await api("/api/disciplinas");
      const prerequisite=subjects.length?"":`<section class="panel"><p>Para criar uma turma, primeiro cadastre a disciplina que ela vai oferecer.</p><button type="button" class="btn secondary" data-action="new-subject" data-return-to-class="true">Cadastrar disciplina agora</button></section>`;
      openModal("Nova turma acad\u00eamica","Crie sua turma e mantenha as matr\u00edculas separadas dos grupos de estudo.",`${prerequisite}<form data-form="class"><div class="field"><label>Disciplina</label><select name="disciplinaId" required><option value="">Selecione</option>${subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join("")}</select></div><div class="field"><label>Nome da turma</label><input name="nome" maxlength="120" placeholder="Ex.: Sistemas Web - 2\u00ba semestre" required></div><div class="form-grid"><div class="field"><label>Ano letivo</label><input name="anoLetivo" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required></div><div class="field"><label>Per\u00edodo</label><select name="periodo"><option value="1">1\u00ba per\u00edodo</option><option value="2">2\u00ba per\u00edodo</option></select></div><div class="field"><label>In\u00edcio</label><input type="date" name="dataInicio"></div><div class="field"><label>T\u00e9rmino</label><input type="date" name="dataFim"></div></div>${errorField()}<button class="btn primary wide" type="submit" ${subjects.length?"":"disabled"}>Criar turma</button></form>`);
    } else if (action === "open-class") { state.classId=Number(button.dataset.id);state.page="turma";await refreshPage();
    } else if (action === "new-schedule") {
      openModal("Adicionar horário semanal","O horário fica vinculado somente a esta turma.",`<form data-form="schedule" data-id="${button.dataset.id}"><div class="form-grid"><div class="field"><label>Dia da semana</label><select name="dia">${["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"].map((d,i)=>`<option value="${i+1}">${d}</option>`).join("")}</select></div><div class="field"><label>Início</label><input type="time" name="inicio" required></div><div class="field"><label>Término</label><input type="time" name="fim" required></div><div class="field"><label>Modalidade</label><select name="modalidade"><option>PRESENCIAL</option><option>REMOTA</option><option>HIBRIDA</option></select></div></div><div class="field"><label>Sala ou link</label><input name="local" maxlength="160"></div>${errorField()}<button class="btn primary wide" type="submit">Salvar horário</button></form>`);
    } else if (action === "new-lesson") {
      openModal("Registrar aula","Preencha o diário com planejamento e conteúdo realizado.",`<form data-form="lesson" data-id="${button.dataset.id}"><div class="form-grid"><div class="field"><label>Data</label><input name="data" type="date" required></div><div class="field"><label>Início</label><input name="inicio" type="time"></div><div class="field"><label>Término</label><input name="fim" type="time"></div></div><div class="field"><label>Objetivos</label><textarea name="objetivos"></textarea></div><div class="field"><label>Conteúdo planejado</label><textarea name="conteudoPlanejado"></textarea></div><div class="field"><label>Metodologia</label><textarea name="metodologia"></textarea></div><div class="field"><label>Conteúdo ministrado</label><textarea name="conteudoMinistrado"></textarea></div><div class="field"><label>Observações</label><textarea name="observacoes"></textarea></div>${errorField()}<button class="btn primary wide" type="submit">Registrar aula</button></form>`);
    } else if (action === "attendance") {
      const roster=await api(`/api/turmas/${button.dataset.class}/aulas/${button.dataset.id}/frequencia`);
      openModal("Frequência da aula",roster.length?"Marque presença, ausência ou justificativa apenas para matrículas ativas.":"Não há matrículas acadêmicas ativas nesta turma. O diário não cria matrícula automaticamente.",roster.length?`<form data-form="attendance" data-class="${button.dataset.class}" data-id="${button.dataset.id}">${roster.map((r,i)=>`<div class="form-grid attendance-row"><strong>${escapeHtml(r.nome)}</strong><input type="hidden" name="alunoId_${i}" value="${r.id}"><select name="status_${i}"><option value="PRESENT" ${r.status==="PRESENT"?"selected":""}>Presente</option><option value="ABSENT" ${r.status==="ABSENT"?"selected":""}>Ausente</option><option value="JUSTIFIED" ${r.status==="JUSTIFIED"?"selected":""}>Justificada</option></select><input name="justificativa_${i}" placeholder="Justificativa (opcional)" value="${escapeHtml(r.justificativa||"")}"></div>`).join("")}${errorField()}<button class="btn primary wide" type="submit">Salvar frequência</button></form>`:emptyState("Sem matrículas ativas","Solicite ao setor acadêmico a carga das matrículas desta turma."));
    } else if(action==="new-assessment"){
      openModal("Nova avaliação ou trabalho","Defina a nota máxima e o peso usado no cálculo da média.",`<form data-form="assessment" data-class="${button.dataset.id}"><div class="field"><label>Título</label><input name="titulo" maxlength="180" required></div><div class="form-grid"><div class="field"><label>Categoria</label><select name="categoria"><option value="AVALIACAO">Avaliação</option><option value="PROVA">Prova</option><option value="TRABALHO">Trabalho</option><option value="SEMINARIO">Seminário</option><option value="PARTICIPACAO">Participação</option><option value="OUTRA">Outra</option></select></div><div class="field"><label>Nota máxima</label><input name="notaMaxima" type="number" min="0.1" step="0.1" value="100" required></div><div class="field"><label>Peso</label><input name="peso" type="number" min="0.1" max="100" step="0.1" value="1" required></div><div class="field"><label>Prazo</label><input name="prazo" type="date"></div></div><div class="field"><label>Descrição</label><textarea name="descricao"></textarea></div>${errorField()}<button class="btn primary wide" type="submit">Criar avaliação</button></form>`);
    } else if(action==="enter-grades"){
      const assessments=await api(`/api/turmas/${state.classId}/avaliacoes`),a=assessments.find(x=>x.id===Number(button.dataset.id));
      if(a){const graded=a.notas.filter(n=>n.nota!==null);openModal(`Notas · ${a.titulo}`,`Informe notas de 0 a ${a.notaMaxima}. Alunos sem matrícula ativa não aparecem.`,a.notas.length?`<form data-form="grades" data-class="${state.classId}" data-id="${a.id}">${a.notas.map((n,i)=>`<div class="form-grid attendance-row"><strong>${escapeHtml(n.aluno)}</strong><input type="hidden" name="alunoId_${i}" value="${n.alunoId}"><input name="nota_${i}" type="number" min="0" max="${a.notaMaxima}" step="0.1" placeholder="Nota" value="${n.nota??""}" required><input name="comentario_${i}" placeholder="Comentário" value="${escapeHtml(n.comentario||"")}"></div>`).join("")}${errorField()}<button class="btn primary wide" type="submit">Salvar notas</button></form>`:emptyState("Sem alunos matriculados","A lista de notas depende da carga de matrículas acadêmicas oficiais."));}
    } else if(action==="new-occurrence"){
      const students=await api(`/api/turmas/${button.dataset.id}/alunos`);
      openModal("Registrar ocorrência","Registro restrito aos docentes da turma.",students.length?`<form data-form="occurrence" data-class="${button.dataset.id}"><div class="form-grid"><div class="field"><label>Aluno</label><select name="alunoId" required><option value="">Selecione</option>${students.map(s=>`<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join("")}</select></div><div class="field"><label>Data</label><input type="date" name="data" required></div><div class="field"><label>Tipo</label><select name="tipo"><option>ACADEMICA</option><option>FREQUENCIA</option><option>PARTICIPACAO</option><option>ORIENTACAO</option><option>OUTRA</option></select></div></div><div class="field"><label>Descrição</label><textarea name="descricao" required></textarea></div><div class="field"><label>Acompanhamento / próximo passo</label><textarea name="acompanhamento"></textarea></div>${errorField()}<button class="btn primary wide" type="submit">Registrar ocorrência</button></form>`:emptyState("Sem matrículas ativas","Não há aluno disponível para vincular à ocorrência."));
    } else if(action==="resolve-occurrence"){
      const all=await api(`/api/turmas/${button.dataset.class}/ocorrencias`),item=all.find(x=>x.id===Number(button.dataset.id));if(item){await api(`/api/turmas/${button.dataset.class}/ocorrencias/${item.id}`,{method:"PUT",body:JSON.stringify({status:"RESOLVED",acompanhamento:item.acompanhamento||"Acompanhamento concluído."})});showToast("Ocorrência concluída.");await refreshPage();}
    } else if(action==="new-group-plan"){
      openModal("Planejar encontro do grupo","Este planejamento pertence somente ao grupo de estudo.",`<form data-form="group-plan" data-group="${button.dataset.group}"><div class="field"><label>Título</label><input name="titulo" required></div><div class="form-grid"><div class="field"><label>Data prevista</label><input name="dataPrevista" type="date"></div><div class="field"><label>Data realizada</label><input name="dataRealizada" type="date"></div><div class="field"><label>Situação</label><select name="status"><option value="PLANNED">Planejado</option><option value="COMPLETED">Realizado</option><option value="CANCELED">Cancelado</option></select></div></div><div class="field"><label>Objetivos</label><textarea name="objetivos"></textarea></div><div class="field"><label>Conteúdo planejado</label><textarea name="conteudoPlanejado"></textarea></div><div class="field"><label>Metodologia</label><textarea name="metodologia"></textarea></div><div class="field"><label>Recursos</label><textarea name="recursos"></textarea></div><div class="field"><label>Conteúdo realizado</label><textarea name="conteudoRealizado"></textarea></div><div class="field"><label>Observações</label><textarea name="observacoes"></textarea></div>${errorField()}<button class="btn primary wide" type="submit">Salvar planejamento</button></form>`);
    } else if(action==="delete-group-plan") {if(confirm("Excluir este planejamento do grupo?")){await api(`/api/planejamentos/${button.dataset.id}`,{method:"DELETE"});await refreshPage();}
    } else if(action==="edit-group-plan") {const group=await api(`/api/grupos/${state.groupId}/portal`),p=group.planejamentos.find(x=>x.id===Number(button.dataset.id));if(p)openModal("Editar planejamento","Atualize o plano e o registro do encontro.",`<form data-form="group-plan" data-group="${state.groupId}" data-id="${p.id}"><div class="field"><label>Título</label><input name="titulo" value="${escapeHtml(p.titulo)}" required></div><div class="form-grid"><div class="field"><label>Data prevista</label><input name="dataPrevista" type="date" value="${escapeHtml(p.dataPrevista||"")}"></div><div class="field"><label>Data realizada</label><input name="dataRealizada" type="date" value="${escapeHtml(p.dataRealizada||"")}"></div><div class="field"><label>Situação</label><select name="status"><option value="PLANNED" ${p.status==="PLANNED"?"selected":""}>Planejado</option><option value="COMPLETED" ${p.status==="COMPLETED"?"selected":""}>Realizado</option><option value="CANCELED" ${p.status==="CANCELED"?"selected":""}>Cancelado</option></select></div></div><div class="field"><label>Objetivos</label><textarea name="objetivos">${escapeHtml(p.objetivos||"")}</textarea></div><div class="field"><label>Conteúdo planejado</label><textarea name="conteudoPlanejado">${escapeHtml(p.conteudoPlanejado||"")}</textarea></div><div class="field"><label>Metodologia</label><textarea name="metodologia">${escapeHtml(p.metodologia||"")}</textarea></div><div class="field"><label>Recursos</label><textarea name="recursos">${escapeHtml(p.recursos||"")}</textarea></div><div class="field"><label>Conteúdo realizado</label><textarea name="conteudoRealizado">${escapeHtml(p.conteudoRealizado||"")}</textarea></div><div class="field"><label>Observações</label><textarea name="observacoes">${escapeHtml(p.observacoes||"")}</textarea></div>${errorField()}<button class="btn primary wide" type="submit">Salvar alterações</button></form>`);
    } else if (action === "delete-assignment") {
      if (confirm("Excluir esta tarefa e as entregas vinculadas?")) {
        await api(`/api/tarefas/${button.dataset.id}`, { method: "DELETE" });
        await refreshPage();
      }
    } else if (action === "upload-assignment") {
      await openUploadForm("tarefa", button.dataset.id, button.dataset.title);
    } else if (action === "new-project") {
      await openProjectForm(null, button.dataset.group || "");
    } else if (action === "edit-project") {
      const projects = await api("/api/projetos");
      await openProjectForm(projects.find((project) => project.id === Number(button.dataset.id)));
    } else if (action === "delete-project") {
      if (confirm("Excluir este projeto e as entregas vinculadas?")) {
        await api(`/api/projetos/${button.dataset.id}`, { method: "DELETE" });
        await refreshPage();
      }
    } else if (action === "upload-project") {
      await openUploadForm("projeto", button.dataset.id, button.dataset.title);
    } else if (action === "new-material" || action === "new-video") {
      await openContentForm(action === "new-video" ? "video" : "material", button.dataset.group || "");
    } else if (action === "new-news") {
      const groups = await ownedGroups();
      openModal("Nova publicação", "Compartilhe uma notícia ou aviso com seus grupos.", `<form data-form="news">
        <div class="field"><label for="news-title">Título</label><input id="news-title" name="titulo" maxlength="180" required></div>
        <div class="field"><label for="news-type">Tipo</label><select id="news-type" name="tipo"><option value="NEWS">Notícia</option><option value="ANNOUNCEMENT">Aviso importante</option></select></div>
        <div class="field"><label for="news-group">Grupo (opcional)</label><select id="news-group" name="grupoId"><option value="">Todos os grupos</option>${groupFormOptions(groups)}</select></div>
        <div class="field"><label for="news-description">Mensagem</label><textarea id="news-description" name="descricao" maxlength="2000" required></textarea></div>
        ${errorField()}<button class="btn primary wide" type="submit">Publicar</button></form>`);
    } else if(action==="new-topic"){
      const [type,id]=state.communicationRoom.split(":");openModal("Nova discussão","Inicie um tópico no espaço selecionado.",`<form data-form="topic" data-room="${state.communicationRoom}"><div class="field"><label>Título</label><input name="titulo" maxlength="180" required></div><div class="field"><label>Mensagem inicial</label><textarea name="mensagem" maxlength="4000" required></textarea></div>${errorField()}<button class="btn primary wide" type="submit">Publicar discussão</button></form>`);
    } else if(action==="open-topic"){
      const topic=await api(`/api/forum/${button.dataset.id}/posts`);openModal(topic.titulo,`Discussão de ${topic.autor}`,`<div class="teacher-grade-list"><article class="teacher-grade-item"><div><strong>${escapeHtml(topic.autor)}</strong><p>${escapeHtml(topic.descricao)}</p></div></article>${topic.posts.map(p=>`<article class="teacher-grade-item"><div><strong>${escapeHtml(p.autor)}</strong><small>${formatDateTime(p.enviadaEm)}</small><p>${escapeHtml(p.mensagem)}</p></div></article>`).join("")}</div>${topic.bloqueado?"<p>Discussão encerrada.</p>":`<form data-form="forum-reply" data-id="${topic.id}"><div class="field"><label>Resposta</label><textarea name="mensagem" maxlength="4000" required></textarea></div>${errorField()}<button class="btn primary" type="submit">Responder</button></form>`}`);
    } else if(action==="new-document"){
      const [groups,classes]=await Promise.all([ownedGroups(),api("/api/turmas")]);openModal("Publicar documento ou v\u00eddeo","Envie um arquivo ou informe um link. V\u00eddeos v\u00e3o para a se\u00e7\u00e3o V\u00eddeos; outros arquivos ficam em Documentos.",`<form data-form="document" enctype="multipart/form-data"><div class="field"><label>T\u00edtulo</label><input name="titulo" maxlength="180" required></div><div class="field"><label>Grupo de estudo (opcional)</label><select name="grupoId"><option value="">Nenhum</option>${groups.map(g=>`<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("")}</select></div><div class="field"><label>Turma acad\u00eamica (opcional)</label><select name="turmaId"><option value="">Nenhuma</option>${classes.map(c=>`<option value="${c.id}">${escapeHtml(c.disciplina)} \u00b7 ${escapeHtml(c.nome)}</option>`).join("")}</select><small>Escolha no m\u00e1ximo um espa\u00e7o. V?deos precisam ser vinculados a um grupo de estudo.</small></div><div class="field"><label>Descri\u00e7\u00e3o</label><textarea name="descricao" maxlength="1000"></textarea></div><div class="field"><label>Arquivo (opcional; at\u00e9 100 MB para v\u00eddeo, 25 MB para documentos)</label><input type="file" name="arquivo" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov,.ogg"></div><div class="field"><label>Link externo (opcional)</label><input type="url" name="url" placeholder="https://..."><small>V\u00eddeos do YouTube, Vimeo, Stream e links diretos de v\u00eddeo ser\u00e3o publicados em V\u00eddeos. N\u00e3o \u00e9 necess\u00e1rio anexar arquivo ao informar o link.</small></div>${errorField()}<button class="btn primary wide" type="submit">Publicar</button></form>`);
    } else if(action==="cancel-reservation"){
      if(confirm("Cancelar esta reserva?")){await api(`/api/reservas/${button.dataset.id}`,{method:"DELETE"});showToast("Reserva cancelada.");await refreshPage();}
    } else if (action === "review-submission") {
      const submissions = await api("/api/entregaveis");
      const submission = submissions.find((item) => item.id === Number(button.dataset.id));
      if (submission) openReviewForm(submission);
    } else if (action === "submission-history") {
      const versions = await api(`/api/entregaveis/${button.dataset.id}/versoes`);
      openModal("Histórico de versões", "Envios anteriores e correções registradas.", versions.length
        ? `<div class="card-grid">${versions.map((version) => `<article class="item-card"><div class="item-meta">${statusPill(version.status, version.statusCodigo)}<span class="pill">Versão ${version.versao}</span></div><h3>${escapeHtml(version.nomeArquivo)}</h3><p>${formatDateTime(version.enviadaEm)}</p><p>${escapeHtml(version.comentario || "Sem comentário.")}</p>${version.feedback ? `<p>Professor: ${escapeHtml(version.feedback)}</p>` : ""}${version.nota == null ? "" : `<p>Nota: ${version.nota}</p>`}${version.arquivoId ? `<a class="btn secondary small" href="/api/arquivos/${version.arquivoId}" download>Baixar</a>` : ""}</article>`).join("")}</div>`
        : emptyState("Sem versões", "Nenhum envio registrado."));
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("change", (event) => {
  if(event.target.matches("[data-communication-room]")){state.communicationRoom=event.target.value;state.communicationContact="";refreshPage();return;}
  if(event.target.matches("[data-communication-contact]")){state.communicationContact=event.target.value;refreshPage();return;}
  const input = event.target.closest('input[name="foto"]');
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    state.profilePreviewUrl = String(reader.result);
    const preview = document.querySelector(".profile-photo-preview");
    if (!preview) return;
    preview.classList.add("avatar-image");
    let image = preview.querySelector("img");
    if (!image) {
      preview.textContent = "";
      image = document.createElement("img");
      image.alt = `Prévia da foto de perfil de ${state.user.nome}`;
      preview.append(image);
    }
    image.src = state.profilePreviewUrl;
  });
  reader.addEventListener("error", () => showToast("Não foi possível abrir a prévia da foto selecionada."));
  reader.readAsDataURL(file);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    if (type === "login") {
      state.user = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
      await continueAfterAuthentication();
    } else if (type === "cadastro") {
      state.user = await api(`/api/cadastro/${form.dataset.profile}`, { method: "POST", body: JSON.stringify(data) });
      await continueAfterAuthentication();
    } else if (type === "recuperar") {
      showToast((await api("/api/auth/recuperar", { method: "POST", body: JSON.stringify(data) })).ok);
    } else if (type === "profile") {
      state.user = await api("/api/perfil", { method: "PATCH", body: formData });
      state.profilePreviewUrl = null;
      showToast("Perfil atualizado.");
      await refreshPage();
    } else if (type === "group") {
      const path = form.dataset.id ? `/api/grupos/${form.dataset.id}` : "/api/grupos";
      await api(path, { method: form.dataset.id ? "PUT" : "POST", body: JSON.stringify(data) });
      modal.close();
      showToast(form.dataset.id ? "Grupo atualizado." : "Grupo criado.");
      await refreshPage();
    } else if(type==="topic"){
      const [roomType,roomId]=form.dataset.room.split(":");const scope=roomType==="grupo"?{grupoId:Number(roomId)}:{turmaId:Number(roomId)};await api("/api/forum",{method:"POST",body:JSON.stringify({...data,...scope})});modal.close();showToast("Discussão publicada.");await refreshPage();
    } else if(type==="forum-reply"){
      await api(`/api/forum/${form.dataset.id}/posts`,{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Resposta publicada.");await refreshPage();
    } else if(type==="message"){
      const [roomType,roomId]=form.dataset.room.split(":");const scope=roomType==="grupo"?{grupoId:Number(roomId)}:{turmaId:Number(roomId)};await api("/api/mensagens",{method:"POST",body:JSON.stringify({...data,destinatarioId:Number(form.dataset.recipient),...scope})});showToast("Mensagem enviada.");await refreshPage();
    } else if(type==="document"){
      const published=await api("/api/documentos",{method:"POST",body:formData});modal.close();
      if(published.secao==="videos"){state.page="videos";showToast("V\u00eddeo publicado na se\u00e7\u00e3o V\u00eddeos.");}
      else showToast("Documento publicado.");
      await refreshPage();
    } else if(type==="reservation"){
      await api("/api/reservas",{method:"POST",body:JSON.stringify(data)});showToast("Reserva confirmada.");await refreshPage();
    } else if(type === "subject") {
      await api("/api/disciplinas",{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Disciplina cadastrada.");
      if(state.returnToClassAfterSubject){state.returnToClassAfterSubject=false;const subjects=await api("/api/disciplinas");const prerequisite=subjects.length?"":`<p>Cadastre uma disciplina para continuar.</p>`;openModal("Nova turma acad\u00eamica","Crie sua turma e mantenha as matr\u00edculas separadas dos grupos de estudo.",`${prerequisite}<form data-form="class"><div class="field"><label>Disciplina</label><select name="disciplinaId" required><option value="">Selecione</option>${subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join("")}</select></div><div class="field"><label>Nome da turma</label><input name="nome" maxlength="120" required></div><div class="form-grid"><div class="field"><label>Ano letivo</label><input name="anoLetivo" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required></div><div class="field"><label>Per\u00edodo</label><select name="periodo"><option value="1">1\u00ba per\u00edodo</option><option value="2">2\u00ba per\u00edodo</option></select></div><div class="field"><label>In\u00edcio</label><input type="date" name="dataInicio"></div><div class="field"><label>T\u00e9rmino</label><input type="date" name="dataFim"></div></div>${errorField()}<button class="btn primary wide" type="submit">Criar turma</button></form>`);}
      else await refreshPage();
    } else if(type === "class") {
      await api("/api/turmas",{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Turma acadêmica criada.");state.page="turmas";await refreshPage();
    } else if(type === "schedule") {
      await api(`/api/turmas/${form.dataset.id}/horarios`,{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Horário semanal salvo.");await refreshPage();
    } else if(type === "lesson") {
      await api(`/api/turmas/${form.dataset.id}/aulas`,{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Aula registrada no diário.");await refreshPage();
    } else if(type === "attendance") {
      const registros=[];for(let i=0;form.elements[`alunoId_${i}`];i++)registros.push({alunoId:form.elements[`alunoId_${i}`].value,status:form.elements[`status_${i}`].value,justificativa:form.elements[`justificativa_${i}`].value});
      await api(`/api/turmas/${form.dataset.class}/aulas/${form.dataset.id}/frequencia`,{method:"PUT",body:JSON.stringify({registros})});modal.close();showToast("Frequência salva.");await refreshPage();
    } else if(type === "assessment") {
      await api(`/api/turmas/${form.dataset.class}/avaliacoes`,{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Avaliação cadastrada.");await refreshPage();
    } else if(type === "grades") {
      const notas=[];for(let i=0;form.elements[`alunoId_${i}`];i++)notas.push({alunoId:form.elements[`alunoId_${i}`].value,nota:form.elements[`nota_${i}`].value,comentario:form.elements[`comentario_${i}`].value});
      await api(`/api/turmas/${form.dataset.class}/avaliacoes/${form.dataset.id}/notas`,{method:"PUT",body:JSON.stringify({notas})});modal.close();showToast("Notas salvas.");await refreshPage();
    } else if(type === "occurrence") {
      await api(`/api/turmas/${form.dataset.class}/ocorrencias`,{method:"POST",body:JSON.stringify(data)});modal.close();showToast("Ocorrência registrada.");await refreshPage();
    } else if(type === "group-plan") {
      await api(form.dataset.id?`/api/planejamentos/${form.dataset.id}`:`/api/grupos/${form.dataset.group}/planejamentos`,{method:form.dataset.id?"PUT":"POST",body:JSON.stringify(data)});modal.close();showToast("Planejamento do grupo salvo.");await refreshPage();
    } else if (type === "assignment") {
      await api("/api/tarefas", { method: "POST", body: JSON.stringify(data) });
      modal.close();
      showToast("Tarefa publicada.");
      await refreshPage();
    } else if (type === "project") {
      await api(form.dataset.id ? `/api/projetos/${form.dataset.id}` : "/api/projetos", {
        method: form.dataset.id ? "PUT" : "POST", body: JSON.stringify(data)
      });
      modal.close();
      showToast(form.dataset.id ? "Projeto atualizado." : "Projeto criado.");
      await refreshPage();
    } else if (type === "material" || type === "video") {
      const endpoint = type === "video" ? "/api/videos" : "/api/materiais";
      await api(endpoint, { method: "POST", body: formData });
      modal.close();
      showToast(type === "video" ? "Vídeo publicado." : "Material publicado.");
      await refreshPage();
    } else if (type === "news") {
      await api("/api/noticias", { method: "POST", body: JSON.stringify(data) });
      modal.close();
      showToast("Publicação criada.");
      await refreshPage();
    } else if (type === "upload") {
      await api(`/api/entregaveis/${form.dataset.kind}/${form.dataset.id}`, { method: "POST", body: formData });
      modal.close();
      showToast("Arquivo enviado. O professor receberá o entregável.");
      await refreshPage();
    } else if (type === "review") {
      await api(`/api/entregaveis/${form.dataset.id}/correcao`, { method: "PATCH", body: JSON.stringify(data) });
      modal.close();
      showToast("Correção registrada.");
      await refreshPage();
    } else if (type === "feedback") {
      const result = await api("/api/feedback", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      showToast(result.ok);
    } else if (type === "report") {
      if(data.tipo==="class"&&!data.turmaId) throw new Error("Selecione uma turma acadêmica para o relatório.");
      const params = new URLSearchParams();
      if (data.semestre) params.set("semestre", data.semestre);
      if (data.grupoId) params.set("grupoId", data.grupoId);
      if (data.turmaId) params.set("turmaId", data.turmaId);
      if (data.alunoId) params.set("alunoId", data.alunoId);
      const report = await api(`/api/relatorios?${params}`);
      const target = document.querySelector("#report-result");
      if (target) {
        const subject = `Relatório TechFatec - ${report.aproveitamento}% de aproveitamento`;
        const body = `Entregáveis: ${report.total}\nRecebidos: ${report.recebidos}\nPendentes: ${report.pendentes}\nAproveitamento: ${report.aproveitamento}%`;
        target.innerHTML = `${reportResult(report)}<div class="card-actions"><a class="btn secondary" href="mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Compartilhar por e-mail</a></div>`;
      }
    }
  } catch (error) {
    showFormError(form, error.message);
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
});

try {
  applyAccessibilityPreferences();
  state.user = await api("/api/auth/me");
} catch (error) {
  if (error.message !== "Faça login para continuar.") {
    app.innerHTML = `${accessibilityControls()}<main class="public-home"><section class="public-error"><h1>Não foi possível iniciar o TechFatec</h1><p>${escapeHtml(error.message)}</p><button class="btn primary" data-action="retry-public-home">Tentar novamente</button></section></main>`;
  } else {
    state.authVisible = false;
    state.pendingIntent = null;
    await refreshPage();
  }
}
if (state.user) {
  state.authVisible = false;
  state.page = isStudent() ? "inicio" : "dashboard";
  await refreshPage();
}
