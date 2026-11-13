import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../server.js";

test("fluxos de autenticação, grupos, atividades, entregas e feedback", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "techfatec-test-"));
  const application = createApplication({ databasePath: join(directory, "test.sqlite") });
  application.server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    application.server.once("listening", resolve);
    application.server.once("error", reject);
  });
  const { port } = application.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  context.after(async () => {
    await new Promise((resolve) => application.server.close(resolve));
    application.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const pageHtml = await page.text();
  assert.match(pageHtml, /TechFatec/);
  assert.match(pageHtml, /type="module"/);
  assert.match(pageHtml, /href="\/css\/style\.css"/);
  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  await script.text();
  const stylesheet = await fetch(`${baseUrl}/styles.css`);
  assert.equal(stylesheet.status, 200);
  await stylesheet.text();
  for (const asset of [
    "/css/style.css",
    "/img/logo-fatec-saoroque.png",
    "/img/vestibulinho.svg",
    "/img/spanish.svg",
    "/img/vestibular.svg",
    "/img/cps.svg",
    "/img/x.png",
    "/img/facebook.png",
    "/img/instagram.png",
    "/img/linkedin.png",
    "/img/youtube.png",
    "/img/tik-tok.png",
    "/img/vestibulinho.jpg",
    "/img/spanish.jpg",
    "/img/vestibular.jpg",
    "/img/cps.jpg",
    "/img/inter.jpg",
    "/img/engenharia.png",
    "/img/gastronomia.png",
    "/img/comercial.png",
    "/img/empreendimento.png",
    "/img/turismo.png",
    "/img/sistema.png",
    "/fonts/roboto-latin-400-italic.woff2",
    "/fonts/roboto-latin-400-normal.woff2",
    "/fonts/roboto-latin-500-normal.woff2",
    "/fonts/roboto-latin-700-normal.woff2",
    "/fonts/roboto-slab-latin-300-normal.woff2",
    "/fonts/roboto-slab-latin-400-normal.woff2",
    "/fonts/roboto-slab-latin-500-normal.woff2",
    "/fonts/roboto-slab-latin-700-normal.woff2"
  ]) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} is served`);
    assert.ok((await response.arrayBuffer()).byteLength > 0, `${asset} is not empty`);
  }
  assert.equal((await fetch(`${baseUrl}/fonts/../../server.js`)).status, 404);

  async function request(path, { cookie, method = "GET", body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    return { response, result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }

  const unauthenticated = await request("/api/grupos");
  assert.equal(unauthenticated.response.status, 401);

  const publicHome = await request("/api/public/home");
  assert.equal(publicHome.response.status, 200);
  assert.equal(publicHome.result.demoAccountsEnabled, process.env.NODE_ENV !== "production");
  assert.ok(publicHome.result.destaques.gruposAbertos > 0);
  assert.ok(publicHome.result.destaques.vagasDisponiveis > 0);
  assert.ok(publicHome.result.grupos.length > 0);
  assert.ok(publicHome.result.atividades.length > 0);
  assert.ok(publicHome.result.grupos.every((group) =>
    group.status === "OPEN" && !("nomes" in group) && !("participo" in group)));
  assert.equal((await request("/api/noticias")).response.status, 401);

  const oversizedJson = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "tiago.santos@fatec.sp.gov.br",
      senha: "fatec123",
      campo: "ç".repeat(600_000)
    })
  });
  assert.equal(oversizedJson.status, 413);

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "tiago.santos@fatec.sp.gov.br", senha: "fatec123" }
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.result.perfil, "ALUNO");
  assert.ok(login.cookie);

  const groups = await request("/api/grupos", { cookie: login.cookie });
  assert.equal(groups.response.status, 200);
  assert.equal(groups.result.length, 6);
  const joined = await request(`/api/grupos/${groups.result[0].id}/participar`, {
    cookie: login.cookie,
    method: "POST"
  });
  assert.equal(joined.result.participo, false);
  assert.equal(joined.result.participacaoStatus, "PENDING");

  const activities = await request("/api/atividades", { cookie: login.cookie });
  assert.equal(activities.result.length, 1);
  const activityId = activities.result[0].id;
  const submission = await request(`/api/atividades/${activityId}/entregas`, {
    cookie: login.cookie,
    method: "POST",
    body: { nomeArquivo: "prototipo.pdf", comentario: "Pronto para revisão." }
  });
  assert.equal(submission.response.status, 201);
  assert.equal(submission.result.nomeArquivo, "prototipo.pdf");

  const duplicate = await request(`/api/atividades/${activityId}/entregas`, {
    cookie: login.cookie,
    method: "POST",
    body: { nomeArquivo: "outro.pdf" }
  });
  assert.equal(duplicate.response.status, 409);

  const feedback = await request("/api/feedback", {
    cookie: login.cookie,
    method: "POST",
    body: { assunto: "Sugestão", mensagem: "Adicionar mais conteúdos." }
  });
  assert.equal(feedback.response.status, 201);

  const teacherLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "camila.souza@fatec.sp.gov.br", senha: "fatec123" }
  });
  const publicNews = await request("/api/noticias", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: { tipo: "ANNOUNCEMENT", titulo: "Semana de projetos", descricao: "Confira as atividades da semana." }
  });
  assert.equal(publicNews.response.status, 201);
  const refreshedPublicHome = await request("/api/public/home");
  assert.equal(refreshedPublicHome.result.noticias[0].titulo, "Semana de projetos");
  const submissions = await request(`/api/atividades/${activityId}/entregas`, {
    cookie: teacherLogin.cookie
  });
  assert.equal(submissions.response.status, 200);
  assert.equal(submissions.result[0].aluno, "Tiago Santos");

  const forbiddenJoin = await request("/api/grupos/1/participar", {
    cookie: teacherLogin.cookie,
    method: "POST"
  });
  assert.equal(forbiddenJoin.response.status, 403);

  const newGroup = await request("/api/grupos", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: { nome: "Projeto Integrador", disciplina: "Projeto", descricao: "Grupo novo." }
  });
  assert.equal(newGroup.response.status, 201);
  const updatedGroup = await request(`/api/grupos/${newGroup.result.id}`, {
    cookie: teacherLogin.cookie,
    method: "PUT",
    body: { nome: "Projeto Integrador II", disciplina: "Projeto", descricao: "Grupo atualizado." }
  });
  assert.equal(updatedGroup.result.nome, "Projeto Integrador II");

  const newActivity = await request("/api/atividades", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: { titulo: "Nova atividade", disciplina: "Projeto", prazo: "2026-12-01" }
  });
  assert.equal(newActivity.response.status, 201);
});

test("cadastro valida domínio Fatec e inicia sessão", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "techfatec-register-test-"));
  const application = createApplication({ databasePath: join(directory, "test.sqlite") });
  application.server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    application.server.once("listening", resolve);
    application.server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  context.after(async () => {
    await new Promise((resolve) => application.server.close(resolve));
    application.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const invalid = await fetch(`${baseUrl}/api/cadastro/aluno`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Pessoa Teste", email: "pessoa@example.com",
      ra: "123", curso: "Sistemas", senha: "segura123"
    })
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${baseUrl}/api/cadastro/aluno`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Pessoa Teste", email: "pessoa.teste@fatec.sp.gov.br",
      ra: "123", curso: "Sistemas", senha: "segura123"
    })
  });
  const user = await response.json();
  assert.equal(response.status, 201);
  assert.equal(user.perfil, "ALUNO");
  assert.ok(response.headers.get("set-cookie"));
});

test("grupos, projetos, uploads versionados e permissões por perfil", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "techfatec-collaboration-test-"));
  const application = createApplication({ databasePath: join(directory, "test.sqlite") });
  application.server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    application.server.once("listening", resolve);
    application.server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  context.after(async () => {
    await new Promise((resolve) => application.server.close(resolve));
    application.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function request(path, { cookie, method = "GET", body, form } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: form || (body ? JSON.stringify(body) : undefined)
    });
    const result = await response.json();
    return {
      response,
      result,
      cookie: response.headers.get("set-cookie")?.split(";")[0]
    };
  }

  const teacherLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "camila.souza@fatec.sp.gov.br", senha: "fatec123" }
  });
  const invalidGroup = await request("/api/grupos", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: { nome: "Grupo inválido", limiteAlunos: 31, minimoAlunos: 5 }
  });
  assert.equal(invalidGroup.response.status, 400);
  const invalidDateProject = await request("/api/projetos", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: { nome: "Projeto inválido", grupoId: 1, dataInicio: "2026-02-31", dataFinal: "2026-03-10" }
  });
  assert.equal(invalidDateProject.response.status, 400);
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  today.setDate(today.getDate() + 14);
  const end = today.toISOString().slice(0, 10);
  const group = await request("/api/grupos", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: {
      nome: "Projeto colaborativo",
      disciplina: "Desenvolvimento Web",
      limiteAlunos: 5,
      dataInicio: start,
      dataTermino: end
    }
  });
  assert.equal(group.response.status, 201);
  assert.equal(group.result.minimoAlunos, 5);

  const project = await request("/api/projetos", {
    cookie: teacherLogin.cookie,
    method: "POST",
    body: {
      nome: "Portal acessível",
      grupoId: group.result.id,
      dataInicio: start,
      dataFinal: end,
      criterios: "Acessibilidade e testes."
    }
  });
  assert.equal(project.response.status, 201);
  assert.equal(project.result.statusCodigo, "WAITING_MEMBERS");

  const students = [];
  for (let index = 1; index <= 6; index += 1) {
    const registration = await request("/api/cadastro/aluno", {
      method: "POST",
      body: {
        nome: `Aluno ${index}`,
        email: `aluno${index}@fatec.sp.gov.br`,
        ra: `RA-${index}`,
        curso: "Sistemas para Internet",
        senha: "segura123"
      }
    });
    assert.equal(registration.response.status, 201);
    students.push(registration.cookie);
  }
  const tasks = await request("/api/tarefas", { cookie: teacherLogin.cookie });
  assert.equal(tasks.result.find((item) => item.grupo === null).esperados, 7);

  const unauthorizedUpload = new FormData();
  unauthorizedUpload.append("arquivo", new Blob(["pdf"], { type: "application/pdf" }), "fora.pdf");
  const denied = await request(`/api/entregaveis/projeto/${project.result.id}`, {
    cookie: students[5],
    method: "POST",
    form: unauthorizedUpload
  });
  assert.equal(denied.response.status, 403);

  for (const cookie of students.slice(0, 5)) {
    const joined = await request(`/api/grupos/${group.result.id}/participar`, {
      cookie,
      method: "POST"
    });
    assert.equal(joined.response.status, 200);
    const profile = await request("/api/auth/me", { cookie });
    const approved = await request(`/api/grupos/${group.result.id}/solicitacoes/${profile.result.id}`, {
      cookie: teacherLogin.cookie, method: "PUT", body: { status: "APPROVED" }
    });
    assert.equal(approved.response.status, 200);
  }
  const fullGroup = await request(`/api/grupos/${group.result.id}`, { cookie: students[0] });
  assert.equal(fullGroup.result.status, "COMPLETE");
  assert.equal(fullGroup.result.participantes, 5);
  assert.equal(fullGroup.result.vagas, 0);

  const unavailable = await request(`/api/grupos/${group.result.id}/participar`, {
    cookie: students[5],
    method: "POST"
  });
  assert.equal(unavailable.response.status, 409);

  const leave = await request(`/api/grupos/${group.result.id}/sair`, {
    cookie: students[0],
    method: "POST"
  });
  assert.equal(leave.result.status, "OPEN");
  const rejoined = await request(`/api/grupos/${group.result.id}/participar`, {
    cookie: students[0],
    method: "POST"
  });
  assert.equal(rejoined.result.participantes, 4);
  assert.equal(rejoined.result.participacaoStatus, "PENDING");

  const portal = await request(`/api/grupos/${group.result.id}/portal`, { cookie: students[1] });
  assert.equal(portal.response.status, 200);
  assert.equal(portal.result.membros.length, 4);
  const roster = await request(`/api/grupos/${group.result.id}/portal`, { cookie: teacherLogin.cookie });
  assert.equal(roster.result.membros.length, 5);
  assert.ok(roster.result.membros.every((member) => member.email.endsWith("@fatec.sp.gov.br")));
  const materialForm = new FormData();
  materialForm.append("grupoId", String(group.result.id));
  materialForm.append("titulo", "Guia do projeto");
  materialForm.append("arquivo", new Blob(["material"], { type: "application/pdf" }), "guia.pdf");
  const material = await request("/api/materiais", {
    cookie: teacherLogin.cookie,
    method: "POST",
    form: materialForm
  });
  assert.equal(material.response.status, 201, JSON.stringify(material.result));
  const studentMaterials = await request("/api/materiais", { cookie: students[1] });
  assert.equal(studentMaterials.result[0].titulo, "Guia do projeto");
  const materialDownload = await fetch(`${baseUrl}/api/arquivos/${studentMaterials.result[0].arquivoId}`, {
    headers: { Cookie: students[1] }
  });
  assert.equal(materialDownload.status, 200);
  assert.equal(await materialDownload.text(), "material");
  const outsiderMaterials = await request("/api/materiais", { cookie: students[5] });
  assert.equal(outsiderMaterials.result.length, 0);
  const forbiddenMaterial = await fetch(`${baseUrl}/api/arquivos/${studentMaterials.result[0].arquivoId}`, {
    headers: { Cookie: students[5] }
  });
  assert.equal(forbiddenMaterial.status, 403);

  const videoForm = new FormData();
  videoForm.append("grupoId", String(group.result.id));
  videoForm.append("titulo", "Aula gravada");
  videoForm.append("arquivo", new Blob(["video"], { type: "video/mp4" }), "aula.mp4");
  const video = await request("/api/videos", {
    cookie: teacherLogin.cookie,
    method: "POST",
    form: videoForm
  });
  assert.equal(video.response.status, 201, JSON.stringify(video.result));
  const linkedVideoForm = new FormData();
  linkedVideoForm.append("grupoId", String(group.result.id));
  linkedVideoForm.append("titulo", "V\u00eddeo por link externo");
  linkedVideoForm.append("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  linkedVideoForm.append("arquivo", new Blob([]), "");
  const linkedVideo = await request("/api/videos", { cookie: teacherLogin.cookie, method: "POST", form: linkedVideoForm });
  assert.equal(linkedVideo.response.status, 201, JSON.stringify(linkedVideo.result));
  const studentVideos = await request("/api/videos", { cookie: students[1] });
  assert.ok(studentVideos.result.some((item) => item.url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ" && item.arquivoId === null));
  const linkedDocForm = new FormData();
  linkedDocForm.append("grupoId", String(group.result.id));
  linkedDocForm.append("titulo", "V\u00eddeo externo publicado por Documentos");
  linkedDocForm.append("url", "https://www.youtube.com/shorts/89H3hnap90w");
  linkedDocForm.append("arquivo", new Blob([]), "");
  const routedVideo = await request("/api/documentos", { cookie: teacherLogin.cookie, method: "POST", form: linkedDocForm });
  assert.equal(routedVideo.response.status, 201, JSON.stringify(routedVideo.result));
  assert.equal(routedVideo.result.secao, "videos");
  const videoFeed = await request("/api/videos", { cookie: students[1] });
  assert.ok(videoFeed.result.some((item) => item.titulo === "V\u00eddeo externo publicado por Documentos"));
  const uploadedVideoDoc = new FormData();
  uploadedVideoDoc.append("grupoId", String(group.result.id));
  uploadedVideoDoc.append("titulo", "V\u00eddeo enviado por Documentos");
  uploadedVideoDoc.append("arquivo", new Blob(["video"], { type: "video/mp4" }), "aula-documento.mp4");
  const routedUpload = await request("/api/documentos", { cookie: teacherLogin.cookie, method: "POST", form: uploadedVideoDoc });
  assert.equal(routedUpload.response.status, 201, JSON.stringify(routedUpload.result));
  assert.equal(routedUpload.result.secao, "videos");
  const regularDocForm = new FormData();
  regularDocForm.append("grupoId", String(group.result.id));
  regularDocForm.append("titulo", "Roteiro em PDF");
  regularDocForm.append("arquivo", new Blob(["roteiro"], { type: "application/pdf" }), "roteiro.pdf");
  const routedDocument = await request("/api/documentos", { cookie: teacherLogin.cookie, method: "POST", form: regularDocForm });
  assert.equal(routedDocument.response.status, 201, JSON.stringify(routedDocument.result));
  assert.equal(routedDocument.result.secao, "documentos");
  const documentFeed = await request("/api/documentos", { cookie: students[1] });
  assert.ok(documentFeed.result.some((item) => item.titulo === "Roteiro em PDF"));
  const uploadedVideo = studentVideos.result.find((item) => item.arquivoId);
  const videoDownload = await fetch(`${baseUrl}/api/arquivos/${uploadedVideo.arquivoId}`, {
    headers: { Cookie: students[1] }
  });
  assert.equal(videoDownload.status, 200);
  assert.match(videoDownload.headers.get("content-disposition"), /^inline;/);
  assert.equal(await videoDownload.text(), "video");

  const started = await request("/api/projetos", { cookie: students[1] });
  assert.equal(started.result[0].statusCodigo, "WAITING_MEMBERS");
  assert.equal(started.result[0].esperados, 4);

  const firstVersion = new FormData();
  firstVersion.append("arquivo", new Blob(["primeira versão"], { type: "application/pdf" }), "projeto.pdf");
  const submitted = await request(`/api/entregaveis/projeto/${project.result.id}`, {
    cookie: students[1],
    method: "POST",
    form: firstVersion
  });
  assert.equal(submitted.response.status, 201);
  const received = await request("/api/entregaveis", { cookie: teacherLogin.cookie });
  assert.equal(received.result.length, 1);
  const review = await request(`/api/entregaveis/${submitted.result.id}/correcao`, {
    cookie: teacherLogin.cookie,
    method: "PATCH",
    body: { status: "RESUBMIT", comentario: "Ajustar os requisitos." }
  });
  assert.equal(review.response.status, 200);

  const secondVersion = new FormData();
  secondVersion.append("arquivo", new Blob(["segunda versão"], { type: "application/pdf" }), "projeto-v2.pdf");
  const resubmitted = await request(`/api/entregaveis/projeto/${project.result.id}`, {
    cookie: students[1],
    method: "POST",
    form: secondVersion
  });
  assert.equal(resubmitted.response.status, 201);
  assert.equal(resubmitted.result.versao, 2);
  const history = await request(`/api/entregaveis/${submitted.result.id}/versoes`, { cookie: teacherLogin.cookie });
  assert.equal(history.result.length, 2);
  const oldFile = await fetch(`${baseUrl}/api/arquivos/${history.result[1].arquivoId}`, {
    headers: { Cookie: teacherLogin.cookie }
  });
  assert.equal(oldFile.status, 200);
  assert.equal(await oldFile.text(), "primeira versão");

  const updatedProject = await request("/api/projetos", { cookie: students[1] });
  assert.equal(updatedProject.result[0].progresso, 25);
  const dashboards = await request("/api/dashboard?tipo=projetos", { cookie: teacherLogin.cookie });
  assert.equal(dashboards.result.projetosAtivos, 1);
  assert.equal(dashboards.result.projetos[0].recebidos, 1);
  const deliverableDashboard = await request("/api/dashboard?tipo=entregaveis", { cookie: teacherLogin.cookie });
  assert.ok(deliverableDashboard.result.entregaveisPrevistos >= 5);
  assert.equal(deliverableDashboard.result.entregaveisRecebidos, 1);
  const approval = await request(`/api/entregaveis/${submitted.result.id}/correcao`, {
    cookie: teacherLogin.cookie,
    method: "PATCH",
    body: { status: "APPROVED", nota: 95, comentario: "Aprovado." }
  });
  assert.equal(approval.result.statusCodigo, "APPROVED");
  const blockedReplacement = new FormData();
  blockedReplacement.append("arquivo", new Blob(["terceira versão"], { type: "application/pdf" }), "projeto-v3.pdf");
  const replacement = await request(`/api/entregaveis/projeto/${project.result.id}`, {
    cookie: students[1],
    method: "POST",
    form: blockedReplacement
  });
  assert.equal(replacement.response.status, 409);
});

test("alunos e professores editam o próprio perfil e foto com autorização", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "techfatec-profile-test-"));
  const application = createApplication({ databasePath: join(directory, "test.sqlite") });
  application.server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    application.server.once("listening", resolve);
    application.server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  context.after(async () => {
    await new Promise((resolve) => application.server.close(resolve));
    application.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function login(email) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha: "fatec123" })
    });
    return {
      response,
      user: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0]
    };
  }

  const unauthenticated = await fetch(`${baseUrl}/api/perfil`);
  assert.equal(unauthenticated.status, 401);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p7sAAAAASUVORK5CYII=",
    "base64"
  );
  const student = await login("tiago.santos@fatec.sp.gov.br");
  assert.equal(student.response.status, 200);
  const studentProfileBefore = await fetch(`${baseUrl}/api/perfil`, {
    headers: { Cookie: student.cookie }
  });
  assert.equal(studentProfileBefore.status, 200);
  assert.equal((await studentProfileBefore.json()).nome, "Tiago Santos");
  const studentForm = new FormData();
  studentForm.append("nome", "Tiago Perfil Atualizado");
  studentForm.append("foto", new Blob([png], { type: "image/png" }), "perfil.png");
  const studentUpdate = await fetch(`${baseUrl}/api/perfil`, {
    method: "PATCH",
    headers: { Cookie: student.cookie },
    body: studentForm
  });
  const studentProfile = await studentUpdate.json();
  assert.equal(studentUpdate.status, 200);
  assert.equal(studentProfile.nome, "Tiago Perfil Atualizado");
  assert.equal(studentProfile.perfil, "ALUNO");
  assert.equal(studentProfile.email, "tiago.santos@fatec.sp.gov.br");
  assert.match(studentProfile.fotoUrl, /^\/api\/arquivos\/\d+$/);
  const studentProfileAfter = await fetch(`${baseUrl}/api/perfil`, {
    headers: { Cookie: student.cookie }
  });
  assert.equal((await studentProfileAfter.json()).fotoUrl, studentProfile.fotoUrl);
  const refreshedSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: student.cookie }
  });
  const authenticatedProfile = await refreshedSession.json();
  assert.equal(authenticatedProfile.nome, studentProfile.nome);
  assert.equal(authenticatedProfile.fotoUrl, studentProfile.fotoUrl);

  const photoId = studentProfile.fotoUrl.split("/").at(-1);
  const photo = await fetch(`${baseUrl}${studentProfile.fotoUrl}`, {
    headers: { Cookie: student.cookie }
  });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.match(photo.headers.get("content-disposition"), /^inline;/);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);

  const teacher = await login("camila.souza@fatec.sp.gov.br");
  const forbiddenPhoto = await fetch(`${baseUrl}${studentProfile.fotoUrl}`, {
    headers: { Cookie: teacher.cookie }
  });
  assert.equal(forbiddenPhoto.status, 403);

  const invalidForm = new FormData();
  invalidForm.append("nome", "Nome não deve ser salvo");
  invalidForm.append("foto", new Blob(["<svg></svg>"], { type: "image/png" }), "foto.png");
  const invalidPhoto = await fetch(`${baseUrl}/api/perfil`, {
    method: "PATCH",
    headers: { Cookie: student.cookie },
    body: invalidForm
  });
  assert.equal(invalidPhoto.status, 415);

  const removeForm = new FormData();
  removeForm.append("nome", "Tiago Perfil Atualizado");
  removeForm.append("removerFoto", "true");
  const removed = await fetch(`${baseUrl}/api/perfil`, {
    method: "PATCH",
    headers: { Cookie: student.cookie },
    body: removeForm
  });
  const removedProfile = await removed.json();
  assert.equal(removed.status, 200);
  assert.equal(removedProfile.fotoUrl, null);
  assert.equal((await fetch(`${baseUrl}/api/arquivos/${photoId}`, {
    headers: { Cookie: student.cookie }
  })).status, 404);

  const teacherForm = new FormData();
  teacherForm.append("nome", "Camila Professora Atualizada");
  teacherForm.append("foto", new Blob([png], { type: "image/png" }), "professora.png");
  const teacherUpdate = await fetch(`${baseUrl}/api/perfil`, {
    method: "PATCH",
    headers: { Cookie: teacher.cookie },
    body: teacherForm
  });
  const teacherProfile = await teacherUpdate.json();
  assert.equal(teacherUpdate.status, 200);
  assert.equal(teacherProfile.nome, "Camila Professora Atualizada");
  assert.equal(teacherProfile.perfil, "PROFESSOR");
  assert.ok(teacherProfile.fotoUrl);
});

test("produção não cria contas de demonstração e protege cookies de sessão", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "techfatec-production-test-"));
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const application = createApplication({ databasePath: join(directory, "test.sqlite") });
  application.server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    application.server.once("listening", resolve);
    application.server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  context.after(async () => {
    await new Promise((resolve) => application.server.close(resolve));
    application.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  const publicHome = await fetch(`${baseUrl}/api/public/home`);
  const publicConfig = await publicHome.json();
  assert.equal(publicConfig.demoAccountsEnabled, false);
  assert.equal(publicConfig.registrationEnabled, false);

  const demoLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "tiago.santos@fatec.sp.gov.br", senha: "fatec123" })
  });
  assert.equal(demoLogin.status, 401);

  const registration = await fetch(`${baseUrl}/api/cadastro/aluno`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Pessoa de Produção",
      email: "pessoa.producao@fatec.sp.gov.br",
      ra: "RA-PROD",
      curso: "Sistemas para Internet",
      senha: "senha-segura"
    })
  });
  assert.equal(registration.status, 403);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
  assert.match(logout.headers.get("set-cookie"), /;\s*Secure(?:;|$)/i);
});

test("avaliações, notas, ocorrências e relatórios ficam no escopo da turma acadêmica", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "techfatec-academic-test-"));
  const application = createApplication({ databasePath: join(directory, "test.sqlite") });
  application.server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { application.server.once("listening", resolve); application.server.once("error", reject); });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  context.after(async () => { await new Promise((resolve) => application.server.close(resolve)); application.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async (path, {cookie,method="GET",body}={}) => {const response=await fetch(`${baseUrl}${path}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});return {response,result:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]};};
  const login=await request("/api/auth/login",{method:"POST",body:{email:"camila.souza@fatec.sp.gov.br",senha:"fatec123"}});
  assert.equal(login.response.status,200);
  const subject=await request("/api/disciplinas",{cookie:login.cookie,method:"POST",body:{nome:"Avaliação Integrada",codigo:"AI-TEST"}});
  assert.equal(subject.response.status,201);
  const turma=await request("/api/turmas",{cookie:login.cookie,method:"POST",body:{disciplinaId:subject.result.id,nome:"AI 2026 - 1",anoLetivo:2026,periodo:1}});
  assert.equal(turma.response.status,201);
  const assessment=await request(`/api/turmas/${turma.result.id}/avaliacoes`,{cookie:login.cookie,method:"POST",body:{titulo:"Trabalho final",categoria:"TRABALHO",notaMaxima:10,peso:2}});
  assert.equal(assessment.response.status,201);
  assert.equal((await request(`/api/turmas/${turma.result.id}/avaliacoes`,{cookie:login.cookie})).result.length,1);
  const report=await request(`/api/relatorios?turmaId=${turma.result.id}`,{cookie:login.cookie});
  assert.equal(report.response.status,200);
  assert.equal(report.result.tipo,"turma");
  assert.equal(report.result.total,0);
  const unauthorizedOccurrence=await request(`/api/turmas/${turma.result.id}/ocorrencias`,{cookie:login.cookie,method:"POST",body:{alunoId:999,data:"2026-11-13",tipo:"ACADEMICA",descricao:"Teste"}});
  assert.equal(unauthorizedOccurrence.response.status,400);
});

test("fórum, mensagens, documentos institucionais e reservas respeitam seus escopos", async (context) => {
  const directory=mkdtempSync(join(tmpdir(),"techfatec-comms-test-"));const application=createApplication({databasePath:join(directory,"test.sqlite")});application.server.listen(0,"127.0.0.1");await new Promise((resolve,reject)=>{application.server.once("listening",resolve);application.server.once("error",reject)});const baseUrl=`http://127.0.0.1:${application.server.address().port}`;context.after(async()=>{await new Promise(resolve=>application.server.close(resolve));application.close();rmSync(directory,{recursive:true,force:true})});
  const request=async(path,{cookie,method="GET",body}={})=>{const response=await fetch(`${baseUrl}${path}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});return {response,result:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]}};
  const teacher=await request("/api/auth/login",{method:"POST",body:{email:"camila.souza@fatec.sp.gov.br",senha:"fatec123"}}),student=await request("/api/auth/login",{method:"POST",body:{email:"tiago.santos@fatec.sp.gov.br",senha:"fatec123"}});
  const createdGroup=await request("/api/grupos",{cookie:teacher.cookie,method:"POST",body:{nome:"Comunicação de teste",descricao:"Espaço de conversa"}});assert.equal(createdGroup.response.status,201);const groupId=createdGroup.result.id;
  assert.equal((await request(`/api/grupos/${groupId}/participar`,{cookie:student.cookie,method:"POST"})).response.status,200);
  const studentProfile=await request("/api/auth/me",{cookie:student.cookie});
  assert.equal((await request(`/api/grupos/${groupId}/solicitacoes/${studentProfile.result.id}`,{cookie:teacher.cookie,method:"PUT",body:{status:"APPROVED"}})).response.status,200);
  const topic=await request("/api/forum",{cookie:teacher.cookie,method:"POST",body:{grupoId:groupId,titulo:"Dúvida sobre o projeto",mensagem:"Como estruturamos a entrega?"}});assert.equal(topic.response.status,201);
  const reply=await request(`/api/forum/${topic.result.id}/posts`,{cookie:student.cookie,method:"POST",body:{mensagem:"Podemos começar pelo roteiro."}});assert.equal(reply.response.status,201);
  const posts=await request(`/api/forum/${topic.result.id}/posts`,{cookie:teacher.cookie});assert.equal(posts.result.posts.length,1);
  const contacts=await request(`/api/contatos?grupoId=${groupId}`,{cookie:student.cookie});assert.equal(contacts.result.length,1);
  assert.equal((await request("/api/mensagens",{cookie:student.cookie,method:"POST",body:{grupoId:groupId,destinatarioId:contacts.result[0].id,mensagem:"Obrigado!"}})).response.status,201);
  assert.equal((await request(`/api/mensagens?grupoId=${groupId}`,{cookie:teacher.cookie})).result.length,1);
  assert.equal((await request("/api/documentos",{cookie:teacher.cookie,method:"POST",body:{titulo:"Calendário institucional",url:"https://example.edu/calendario"}})).response.status,201);
  assert.equal((await request("/api/documentos",{cookie:student.cookie})).result.length,1);
  const reservation=await request("/api/reservas",{cookie:teacher.cookie,method:"POST",body:{recurso:"Laboratório 2",finalidade:"Apresentações",inicio:"2026-12-01T10:00",fim:"2026-12-01T11:00"}});assert.equal(reservation.response.status,201);
  const conflict=await request("/api/reservas",{cookie:teacher.cookie,method:"POST",body:{recurso:"Laboratório 2",finalidade:"Atendimento",inicio:"2026-12-01T10:30",fim:"2026-12-01T11:30"}});assert.equal(conflict.response.status,409);
});





