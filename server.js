import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "./src/database.js";
import { handlePlatformApi, PlatformError } from "./src/platform-api.js";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const cookieName = "techfatec.sid";
const sessionDuration = 60 * 60;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, storedHash) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function initializeDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      profile TEXT NOT NULL CHECK (profile IN ('ALUNO', 'PROFESSOR')),
      ra TEXT,
      course TEXT,
      semester INTEGER,
      enrollment TEXT,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      subject TEXT,
      semester INTEGER,
      professor_id INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS group_participants (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      instructions TEXT,
      subject TEXT,
      deadline TEXT,
      professor_id INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id),
      comment TEXT,
      file_name TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      UNIQUE (activity_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id),
      subject TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_activity ON submissions(activity_id);
  `);
  migrateDatabase(db);
  seedDemoData(db);
  migrateDatabase(db);
  return db;
}

function seedDemoData(db) {
  if (process.env.NODE_ENV === "production") return;
  const demoProfessor = db.prepare(`
    SELECT id FROM users WHERE email = 'camila.souza@fatec.sp.gov.br' AND profile = 'PROFESSOR'
  `).get();
  if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0) {
    if (demoProfessor) ensureDemoGroups(db, demoProfessor.id);
    return;
  }
  const seed = db.prepare(`
    INSERT INTO users (name, email, profile, ra, course, enrollment, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    seed.run(
      "Tiago Santos", "tiago.santos@fatec.sp.gov.br", "ALUNO", "DEMO-0001",
      "Sistemas para Internet", null, hashPassword("fatec123")
    );
    const professor = Number(seed.run(
      "Camila Souza", "camila.souza@fatec.sp.gov.br", "PROFESSOR", null,
      null, "DEMO-P001", hashPassword("fatec123")
    ).lastInsertRowid);
    ensureDemoGroups(db, professor);
    db.prepare(`
      INSERT INTO activities (title, instructions, subject, deadline, professor_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "Entrega do protótipo navegável",
      "Envie o arquivo do protótipo e um comentário opcional.",
      "Projeto de Navegação e Interação",
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      professor
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureDemoGroups(db, professorId) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("demo-course-groups")) return;
  const courses = [
    "Engenharia de Produção",
    "Gastronomia",
    "Gestão Comercial",
    "Gestão de Empreendimentos Gastronômicos",
    "Gestão de Turismo",
    "Sistemas para Internet"
  ];
  const existing = db.prepare(`
    SELECT id FROM groups WHERE professor_id = ? ORDER BY id
  `).all(professorId);
  const update = db.prepare(`
    UPDATE groups SET name = ?, description = ?, subject = ? WHERE id = ?
  `);
  const insert = db.prepare(`
    INSERT INTO groups (name, description, subject, professor_id)
    VALUES (?, ?, ?, ?)
  `);
  for (let index = 0; index < courses.length; index += 1) {
    const subject = courses[index];
    const name = `Grupo de estudos - ${subject}`;
    const description = `Grupo de estudos para revisão e acompanhamento das atividades de ${subject}.`;
    if (existing[index]) update.run(name, description, subject, existing[index].id);
    else insert.run(name, description, subject, professorId);
  }
  db.prepare(`
    INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)
  `).run("demo-course-groups", new Date().toISOString());
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const limit = 1024 * 1024;
    const chunks = [];
    let received = 0;
    let tooLarge = false;
    if (Number(request.headers["content-length"] ?? 0) > limit) {
      reject(new HttpError(413, "A requisição excede o limite de 1 MB."));
      request.resume();
      return;
    }
    request.on("data", (chunk) => {
      if (tooLarge) return;
      received += chunk.length;
      if (received > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, "A requisição excede o limite de 1 MB."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return;
      const data = Buffer.concat(chunks).toString("utf8");
      if (!data) return resolve({});
      try {
        const value = JSON.parse(data);
        if (!value || Array.isArray(value) || typeof value !== "object") {
          throw new Error("JSON body must be an object");
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, "Corpo JSON inválido."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDuration}${secure}`
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function cookieValue(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) ?? null;
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function safeUser(row, photoFileId = null) {
  return {
    id: row.id,
    nome: row.name,
    email: row.email,
    perfil: row.profile,
    ra: row.ra,
    curso: row.course,
    semestre: row.semester,
    matricula: row.enrollment,
    fotoUrl: photoFileId ? `/api/arquivos/${photoFileId}` : null
  };
}

function createApplication({
  databasePath = process.env.DB_PATH || join(root, "data", "techfatec.sqlite")
} = {}) {
  const db = initializeDatabase(databasePath);
  const loginAttempts = new Map();
  const uploadsPath = join(dirname(databasePath), "uploads");
  const userById = db.prepare("SELECT * FROM users WHERE id = ?");
  const profilePhotoByUser = db.prepare("SELECT photo_file_id FROM user_profiles WHERE user_id = ?");
  const sessionByToken = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?");

  function currentUser(request) {
    const token = cookieValue(request, cookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = hashSessionToken(token);
    const session = sessionByToken.get(tokenHash);
    if (!session) return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    const user = userById.get(session.user_id);
    return user ? safeUser(user, profilePhotoByUser.get(user.id)?.photo_file_id) : null;
  }

  function requireUser(request, profile) {
    const user = currentUser(request);
    if (!user) throw new HttpError(401, "Faça login para continuar.");
    if (profile && user.perfil !== profile) {
      const area = profile === "ALUNO" ? "aluno" : "professor";
      throw new HttpError(403, `Esta área é exclusiva de ${area}.`);
    }
    return user;
  }

  function createSession(response, userId) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashSessionToken(token);
    const expiresAt = Math.floor(Date.now() / 1000) + sessionDuration;
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash, userId, expiresAt);
    setSessionCookie(response, token);
  }

  function groupDto(group, userId) {
    const participants = db.prepare(`
      SELECT u.id, u.name FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ? AND gm.status = 'ACTIVE' ORDER BY u.name
    `).all(group.id);
    const membership = userId ? db.prepare("SELECT status FROM group_members WHERE group_id=? AND user_id=?").get(group.id,userId) : null;
    const pendingCount = db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id=? AND status='PENDING'").get(group.id).count;
    const mentors = db.prepare(`SELECT u.id,u.name FROM group_mentors gm JOIN users u ON u.id=gm.professor_id WHERE gm.group_id=? ORDER BY u.name`).all(group.id);
    const status = group.status === "CLOSED" ? "CLOSED"
      : participants.length >= (group.max_students ?? 20) ? "COMPLETE" : "OPEN";
    return {
      id: group.id,
      nome: group.name,
      descricao: group.description,
      disciplina: group.subject,
      professor: group.professor_name,
      professores: mentors.length ? mentors.map((mentor) => ({ id:mentor.id, nome:mentor.name })) : [{ id:group.professor_id, nome:group.professor_name }],
      tema: group.theme,
      objetivos: group.objectives,
      metodologia: group.methodology,
      nivel: group.level,
      modalidade: group.modality,
      horarioEncontros: group.meeting_schedule,
      regrasParticipacao: group.participation_rules,
      participantes: participants.length,
      participo: participants.some((participant) => participant.id === userId),
      participacaoStatus: membership?.status || null,
      solicitacoesPendentes: pendingCount,
      nomes: participants.map((participant) => participant.name),
      semestre: group.semester,
      vagas: Math.max(0, (group.max_students ?? 20) - participants.length - pendingCount),
      limiteAlunos: group.max_students ?? 20,
      minimoAlunos: group.min_members ?? 5,
      status,
      statusLabel: status === "COMPLETE" ? "Completo" : status === "CLOSED" ? "Encerrado" : "Aberto",
      dataCriacao: group.created_at,
      dataInicio: group.start_date,
      dataTermino: group.end_date
    };
  }

  function findGroup(id) {
    const group = db.prepare(`
      SELECT g.*, u.name AS professor_name FROM groups g
      JOIN users u ON u.id = g.professor_id WHERE g.id = ?
    `).get(id);
    if (!group) throw new HttpError(404, "Grupo não encontrado.");
    return group;
  }

  function activityDto(activity, delivered) {
    return {
      id: activity.id,
      titulo: activity.title,
      instrucoes: activity.instructions,
      disciplina: activity.subject,
      prazo: activity.deadline,
      professor: activity.professor_name,
      entregue: delivered
    };
  }

  function submissionDto(submission) {
    return {
      id: submission.id,
      atividadeId: submission.activity_id,
      aluno: submission.student_name,
      comentario: submission.comment,
      nomeArquivo: submission.file_name,
      enviadaEm: submission.submitted_at
    };
  }

  async function handleApi(request, response, url) {
    const method = request.method;
    const pathname = url.pathname;
    const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(request) : {};

    if (method === "POST" && pathname === "/api/auth/login") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.senha ?? "");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
        throw new HttpError(400, "Informe um e-mail válido e a senha.");
      }
      const attempt = loginAttempts.get(email);
      if (attempt?.blockedUntil > Date.now()) {
        const remaining = Math.ceil((attempt.blockedUntil - Date.now()) / 1000);
        throw new HttpError(429, `Login bloqueado. Aguarde ${remaining} s.`);
      }
      const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
      if (!user || !passwordMatches(password, user.password_hash)) {
        const errors = !attempt || attempt.blockedUntil ? 1 : attempt.errors + 1;
        const blockedUntil = errors >= 3 ? Date.now() + 30_000 : null;
        loginAttempts.set(email, { errors, blockedUntil });
        const message = errors >= 3
          ? "Login bloqueado por 30 s."
          : `Não foi possível entrar. E-mail ou senha incorretos. Restam ${3 - errors} tentativas.`;
        throw new HttpError(errors >= 3 ? 429 : 401, message);
      }
      loginAttempts.delete(email);
      createSession(response, user.id);
      return sendJson(response, 200, safeUser(user, profilePhotoByUser.get(user.id)?.photo_file_id));
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      const token = cookieValue(request, cookieName);
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
      clearSessionCookie(response);
      return sendJson(response, 200, { ok: "Sessão encerrada." });
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      const user = currentUser(request);
      if (!user) throw new HttpError(401, "Faça login para continuar.");
      return sendJson(response, 200, user);
    }

    if (method === "POST" && pathname === "/api/auth/recuperar") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, "Informe um e-mail válido.");
      }
      if (!db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
        throw new HttpError(404, "E-mail não encontrado. Deseja criar uma conta?");
      }
      return sendJson(response, 200, { ok: "Verifique seu e-mail para continuar a recuperação na Fatec." });
    }

    if (method === "POST" && ["/api/cadastro/aluno", "/api/cadastro/professor"].includes(pathname)) {
      if (process.env.NODE_ENV === "production") {
        throw new HttpError(403, "Cadastro público desativado. Use a autenticação institucional.");
      }
      const student = pathname.endsWith("/aluno");
      const name = String(body.nome ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.senha ?? "");
      const studentFields = student ? [
        String(body.ra ?? "").trim(),
        String(body.curso ?? "").trim(),
        body.semestre == null || body.semestre === "" ? null : Number(body.semestre)
      ] : [];
      const enrollment = student ? null : String(body.matricula ?? "").trim();
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          password.length < 6 || (student && (!studentFields[0] || !studentFields[1] ||
            (studentFields[2] !== null && (!Number.isInteger(studentFields[2]) ||
              studentFields[2] < 1 || studentFields[2] > 6)))) ||
          (!student && !enrollment)) {
        throw new HttpError(400, "Revise os campos informados. A senha deve ter ao menos 6 caracteres.");
      }
      if (!email.endsWith("@fatec.sp.gov.br")) {
        throw new HttpError(400, "Use o e-mail institucional (@fatec.sp.gov.br).");
      }
      if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
        throw new HttpError(409, "Já existe uma conta com este e-mail.");
      }
      db.exec("BEGIN");
      let userId;
      try {
        const result = db.prepare(`
          INSERT INTO users (name, email, profile, ra, course, semester, enrollment, password_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(name, email, student ? "ALUNO" : "PROFESSOR",
          student ? studentFields[0] : null, student ? studentFields[1] : null,
          student ? studentFields[2] : null, enrollment,
          hashPassword(password));
        userId = Number(result.lastInsertRowid);
        if (student) {
          db.prepare("INSERT INTO students (user_id, ra, course, semester) VALUES (?, ?, ?, ?)")
            .run(userId, studentFields[0], studentFields[1], studentFields[2]);
        } else {
          db.prepare("INSERT INTO professors (user_id, enrollment) VALUES (?, ?)")
            .run(userId, enrollment);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      createSession(response, userId);
      return sendJson(response, 201, safeUser(userById.get(userId)));
    }

    if (pathname === "/api/grupos" && method === "GET") {
      const user = requireUser(request);
      const groups = db.prepare(`
        SELECT g.*, u.name AS professor_name FROM groups g
        JOIN users u ON u.id = g.professor_id ORDER BY g.id
      `).all();
      return sendJson(response, 200, groups.map((group) => groupDto(group, user.id)));
    }
    if (pathname === "/api/grupos" && method === "POST") {
      const professor = requireUser(request, "PROFESSOR");
      const name = String(body.nome ?? "").trim();
      if (!name) throw new HttpError(400, "O nome do grupo é obrigatório.");
      const result = db.prepare(`
        INSERT INTO groups (name, description, subject, professor_id) VALUES (?, ?, ?, ?)
      `).run(name, body.descricao || null, body.disciplina || null, professor.id);
      return sendJson(response, 201, groupDto(findGroup(Number(result.lastInsertRowid)), professor.id));
    }

    const groupRoute = pathname.match(/^\/api\/grupos\/(\d+)(?:\/(participar))?$/);
    if (groupRoute) {
      const id = Number(groupRoute[1]);
      if (groupRoute[2] === "participar" && method === "POST") {
        const student = requireUser(request, "ALUNO");
        findGroup(id);
        db.prepare("INSERT OR IGNORE INTO group_participants (group_id, user_id) VALUES (?, ?)")
          .run(id, student.id);
        return sendJson(response, 200, groupDto(findGroup(id), student.id));
      }
      if (!groupRoute[2] && method === "GET") {
        const user = requireUser(request);
        return sendJson(response, 200, groupDto(findGroup(id), user.id));
      }
      if (!groupRoute[2] && method === "PUT") {
        const professor = requireUser(request, "PROFESSOR");
        const group = findGroup(id);
        if (group.professor_id !== professor.id) {
          throw new HttpError(403, "Só o professor responsável pode editar o grupo.");
        }
        const name = String(body.nome ?? "").trim();
        if (!name) throw new HttpError(400, "O nome do grupo é obrigatório.");
        db.prepare("UPDATE groups SET name = ?, description = ?, subject = ? WHERE id = ?")
          .run(name, body.descricao || null, body.disciplina || null, id);
        return sendJson(response, 200, groupDto(findGroup(id), professor.id));
      }
    }

    if (pathname === "/api/atividades" && method === "GET") {
      const user = requireUser(request);
      const activities = db.prepare(`
        SELECT a.*, u.name AS professor_name FROM activities a
        JOIN users u ON u.id = a.professor_id ORDER BY a.id DESC
      `).all();
      const delivered = user.perfil === "ALUNO"
        ? new Set(db.prepare("SELECT activity_id FROM submissions WHERE student_id = ?")
          .all(user.id).map((row) => row.activity_id))
        : new Set();
      return sendJson(response, 200, activities.map((activity) =>
        activityDto(activity, delivered.has(activity.id))));
    }
    if (pathname === "/api/atividades" && method === "POST") {
      const professor = requireUser(request, "PROFESSOR");
      const title = String(body.titulo ?? "").trim();
      if (!title) throw new HttpError(400, "O título da atividade é obrigatório.");
      const result = db.prepare(`
        INSERT INTO activities (title, instructions, subject, deadline, professor_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(title, body.instrucoes || null, body.disciplina || null, body.prazo || null, professor.id);
      const activity = db.prepare(`
        SELECT a.*, u.name AS professor_name FROM activities a
        JOIN users u ON u.id = a.professor_id WHERE a.id = ?
      `).get(Number(result.lastInsertRowid));
      return sendJson(response, 201, activityDto(activity, false));
    }

    const activityRoute = pathname.match(/^\/api\/atividades\/(\d+)\/entregas$/);
    if (activityRoute && method === "POST") {
      const student = requireUser(request, "ALUNO");
      const activityId = Number(activityRoute[1]);
      if (!db.prepare("SELECT 1 FROM activities WHERE id = ?").get(activityId)) {
        throw new HttpError(404, "Atividade não encontrada.");
      }
      const fileName = String(body.nomeArquivo ?? "").trim();
      if (!fileName) throw new HttpError(400, "O nome do arquivo é obrigatório.");
      if (db.prepare("SELECT 1 FROM submissions WHERE activity_id = ? AND student_id = ?")
        .get(activityId, student.id)) {
        throw new HttpError(409, "Você já entregou esta atividade.");
      }
      const submittedAt = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO submissions (activity_id, student_id, comment, file_name, submitted_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(activityId, student.id, body.comentario || null, fileName, submittedAt);
      return sendJson(response, 201, {
        id: Number(result.lastInsertRowid),
        atividadeId: activityId,
        aluno: student.nome,
        comentario: body.comentario || null,
        nomeArquivo: fileName,
        enviadaEm: submittedAt
      });
    }
    if (activityRoute && method === "GET") {
      requireUser(request, "PROFESSOR");
      const activityId = Number(activityRoute[1]);
      if (!db.prepare("SELECT 1 FROM activities WHERE id = ?").get(activityId)) {
        throw new HttpError(404, "Atividade não encontrada.");
      }
      const submissions = db.prepare(`
        SELECT s.*, u.name AS student_name FROM submissions s
        JOIN users u ON u.id = s.student_id WHERE s.activity_id = ? ORDER BY s.submitted_at
      `).all(activityId);
      return sendJson(response, 200, submissions.map(submissionDto));
    }

    if (pathname === "/api/feedback" && method === "POST") {
      const student = requireUser(request, "ALUNO");
      const message = String(body.mensagem ?? "").trim();
      if (!message) throw new HttpError(400, "Escreva uma mensagem.");
      db.prepare(`
        INSERT INTO feedback (author_id, subject, message, created_at) VALUES (?, ?, ?, ?)
      `).run(student.id, body.assunto || null, message, new Date().toISOString());
      return sendJson(response, 201, { ok: "Feedback enviado. Obrigado!" });
    }

    throw new HttpError(404, "Rota não encontrada.");
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const platformHandled = await handlePlatformApi({
          request,
          response,
          url,
          db,
          requireUser: (req, profile) => requireUser(req, profile),
          findGroup,
          groupDto,
          readBody,
          uploadsPath
        });
        if (platformHandled) return;
        await handleApi(request, response, url);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "Método não permitido.");
      }
      const files = new Map([
        ["/", join(publicDir, "index.html")],
        ["/index.html", join(publicDir, "index.html")],
        ["/app.js", join(publicDir, "app.js")],
        ["/styles.css", join(publicDir, "styles.css")],
        ["/css/style.css", join(root, "css", "style.css")],
        ["/img/logo-fatec-saoroque.png", join(root, "img", "logo-fatec-saoroque.png")],
        ["/img/vestibulinho.svg", join(root, "img", "vestibulinho.jpg")],
        ["/img/spanish.svg", join(root, "img", "spanish.jpg")],
        ["/img/vestibular.svg", join(root, "img", "vestibular.jpg")],
        ["/img/cps.svg", join(root, "img", "cps.jpg")],
        ["/img/vestibulinho.jpg", join(root, "img", "vestibulinho.jpg")],
        ["/img/spanish.jpg", join(root, "img", "spanish.jpg")],
        ["/img/vestibular.jpg", join(root, "img", "vestibular.jpg")],
        ["/img/cps.jpg", join(root, "img", "cps.jpg")],
        ["/img/inter.jpg", join(root, "img", "inter.jpg")],
        ["/img/engenharia.png", join(root, "img", "engenharia.png")],
        ["/img/gastronomia.png", join(root, "img", "gastronomia.png")],
        ["/img/comercial.png", join(root, "img", "comercial.png")],
        ["/img/empreendimento.png", join(root, "img", "empreendimento.png")],
        ["/img/turismo.png", join(root, "img", "turismo.png")],
        ["/img/sistema.png", join(root, "img", "sistema.png")],
        ["/img/x.png", join(root, "img", "x.png")],
        ["/img/facebook.png", join(root, "img", "facebook.png")],
        ["/img/instagram.png", join(root, "img", "instagram.png")],
        ["/img/linkedin.png", join(root, "img", "linkedin.png")],
        ["/img/youtube.png", join(root, "img", "youtube.png")],
        ["/img/tik-tok.png", join(root, "img", "tik-tok.png")],
        ...[
          "roboto-latin-400-italic.woff2",
          "roboto-latin-400-normal.woff2",
          "roboto-latin-500-normal.woff2",
          "roboto-latin-700-normal.woff2",
          "roboto-slab-latin-300-normal.woff2",
          "roboto-slab-latin-400-normal.woff2",
          "roboto-slab-latin-500-normal.woff2",
          "roboto-slab-latin-700-normal.woff2"
        ].map((font) => [`/fonts/${font}`, join(root, "fonts", font)])
      ]);
      const filePath = files.get(url.pathname);
      if (!filePath) throw new HttpError(404, "Página não encontrada.");
      const content = readFileSync(filePath);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".woff2": "font/woff2"
      };
      response.writeHead(200, {
        "Content-Type": types[extname(filePath)],
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' https: blob:; frame-src 'self' https:; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof HttpError) {
        sendJson(response, error.status, { erro: error.message });
      } else if (error instanceof PlatformError) {
        sendJson(response, error.status, { erro: error.message });
      } else {
        console.error("Erro ao processar requisição:", error);
        sendJson(response, 500, { erro: "Ocorreu um erro interno. Tente novamente." });
      }
    }
  });

  return {
    server,
    close() {
      db.close();
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = createApplication();
  const requestedPort = Number(process.env.PORT ?? 3000);
  const listen = (port) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" && !process.env.PORT && port < 3100) {
        console.warn(`Port ${port} is busy; trying port ${port + 1}.`);
        listen(port + 1);
        return;
      }
      throw error;
    });
    server.listen(port, () => {
      const address = server.address();
      console.log(`TechFatec dispon\u00edvel em http://localhost:${address.port}`);
    });
  };
  listen(requestedPort);
}

export { createApplication };
