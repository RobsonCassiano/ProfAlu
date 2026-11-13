import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

class PlatformError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const day = () => now().slice(0, 10);
const MAX_GROUP_SIZE = 20;
const DEFAULT_GROUP_MIN = 5;
const PROFILE_PHOTO_LIMIT = 5 * 1024 * 1024;
const REGULAR_UPLOAD_LIMIT = 25 * 1024 * 1024;
const VIDEO_UPLOAD_LIMIT = 100 * 1024 * 1024;
const MIME_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".zip", "application/zip"],
  [".txt", "text/plain"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"]
]);
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip",
  ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp"
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function readMultipart(request, maxBytes) {
  const contentType = request.headers["content-type"] ?? "";
  const boundary = contentType.match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary) throw new PlatformError(400, "Envie o formulário como multipart/form-data.");
  const marker = boundary[1] || boundary[2].trim();
  if (!marker || marker.length > 200) throw new PlatformError(400, "Limite multipart inválido.");
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > maxBytes + 64 * 1024) {
    throw new PlatformError(413, "O arquivo excede o limite permitido.");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes + 64 * 1024) {
        rejected = true;
        chunks.length = 0;
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return reject(new PlatformError(413, "O arquivo excede o limite permitido."));
      const buffer = Buffer.concat(chunks);
      const delimiter = Buffer.from(`--${marker}`);
      const fields = {};
      let file = null;
      let cursor = 0;
      while (true) {
        const start = buffer.indexOf(delimiter, cursor);
        if (start < 0) break;
        let partStart = start + delimiter.length;
        if (buffer.subarray(partStart, partStart + 2).equals(Buffer.from("--"))) break;
        if (buffer.subarray(partStart, partStart + 2).equals(Buffer.from("\r\n"))) partStart += 2;
        const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
        if (headerEnd < 0) break;
        const next = buffer.indexOf(delimiter, headerEnd + 4);
        if (next < 0) break;
        let partEnd = next;
        if (buffer.subarray(partEnd - 2, partEnd).equals(Buffer.from("\r\n"))) partEnd -= 2;
        const headers = buffer.toString("utf8", partStart, headerEnd);
        const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
        const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
        const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
        const value = buffer.subarray(headerEnd + 4, partEnd);
        if (filename !== undefined) {
          if (file) return reject(new PlatformError(400, "Envie apenas um arquivo por vez."));
          if (value.length > maxBytes) return reject(new PlatformError(413, "O arquivo excede o limite permitido."));
          file = { filename, data: value };
        } else if (name) {
          fields[name] = value.toString("utf8");
        }
        cursor = next;
      }
      resolve({ fields, file });
    });
    request.on("error", reject);
  });
}

function participantCount(db, groupId) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM group_members
    WHERE group_id = ? AND status = 'ACTIVE'
  `).get(groupId).count;
}

function setGroupCapacityStatus(db, groupId) {
  const group = db.prepare("SELECT status, max_students FROM groups WHERE id = ?").get(groupId);
  if (!group || group.status === "CLOSED") return;
  const status = participantCount(db, groupId) >= group.max_students ? "COMPLETE" : "OPEN";
  db.prepare("UPDATE groups SET status = ? WHERE id = ?").run(status, groupId);
}

function safeFilename(filename) {
  return filename.replace(/[\\/\u0000-\u001f\u007f"]/g, "_").slice(0, 180) || "arquivo";
}

function validProfilePhoto(file) {
  const extension = extname(safeFilename(file.filename)).toLowerCase();
  const data = file.data;
  if (extension === ".png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (extension === ".webp") {
    return data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new PlatformError(400, `${label} deve usar o formato AAAA-MM-DD.`);
  }
  return value;
}

function progressFor(db, item, type) {
  const group = item.group_id ? db.prepare("SELECT * FROM groups WHERE id = ?").get(item.group_id) : null;
  const members = group ? participantCount(db, group.id) : null;
  const classStudents = item.class_id ? db.prepare("SELECT COUNT(*) count FROM class_enrollments WHERE class_id=? AND status='ACTIVE'").get(item.class_id).count : null;
  const defaultExpected = item.assignment_mode === "GROUP" && members
    ? Math.ceil(members / (item.team_size || 4))
    : (members ?? classStudents ?? db.prepare("SELECT COUNT(*) AS count FROM students").get().count);
  const expected = Math.max(1, item.expected_submissions ?? defaultExpected);
  const received = db.prepare(type === "project"
    ? "SELECT COUNT(*) AS count FROM submissions WHERE project_id = ?"
    : "SELECT COUNT(*) AS count FROM submissions WHERE assignment_id = ? OR activity_id = ?")
    .get(...(type === "project" ? [item.id] : [item.id, item.id])).count;
  const percent = Math.min(100, Math.round(received / expected * 100));
  const start = item.start_date || item.created_at?.slice(0, 10) || day();
  const deadline = type === "project" ? item.end_date : item.due_date;
  let status = "WAITING_MEMBERS";
  if (!group || members >= (group.min_members || DEFAULT_GROUP_MIN)) {
    if (percent >= 100) status = "COMPLETED";
    else if (deadline && deadline < day()) status = "NOT_MET";
    else {
      const startMs = Date.parse(`${start}T00:00:00Z`);
      const endMs = deadline ? Date.parse(`${deadline}T23:59:59Z`) : NaN;
      const nowMs = Date.now();
      const lateThreshold = Number.isFinite(endMs) && endMs > startMs
        ? startMs + (endMs - startMs) * 0.8
        : nowMs + 1;
      status = nowMs >= lateThreshold ? "OVERDUE" : (received > 0 ? "IN_PROGRESS" : "STARTED");
    }
  }
  return { expected, received, pending: Math.max(0, expected - received), progress: percent, status };
}

function statusLabel(status) {
  return ({
    OPEN: "Aberto",
    PENDING: "Pendente",
    CANCELLED: "Cancelado",
    LEFT: "Saiu do grupo",
    COMPLETE: "Completo",
    CLOSED: "Encerrado",
    WAITING_MEMBERS: "Aguardando alunos",
    STARTED: "Iniciado",
    IN_PROGRESS: "Em progresso",
    OVERDUE: "Em atraso",
    COMPLETED: "Concluído",
    NOT_MET: "Não atingiu a meta",
    NOT_STARTED: "Não iniciado",
    SUBMITTED: "Enviado",
    IN_REVIEW: "Em revisão",
    APPROVED: "Aprovado",
    REJECTED: "Reprovado",
    RESUBMIT: "Reenvio solicitado"
  })[status] || status;
}

function isVideoUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const sharePointVideo = host.endsWith(".sharepoint.com") && /:v:|stream\.aspx|\/video(?:\/|$)/i.test(parsed.pathname);
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") ||
      host === "vimeo.com" || host.endsWith(".vimeo.com") || sharePointVideo ||
      host === "stream.office.com" || host.endsWith(".microsoftstream.com") || /\.(mp4|webm|mov|ogg)(?:$|[?#])/i.test(parsed.href);
  } catch {
    return false;
  }
}

function externalUrl(value) {
  if (!value) throw new PlatformError(400, "Informe um link válido.");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new PlatformError(400, "Informe um link válido.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new PlatformError(400, "Links devem usar HTTP ou HTTPS.");
  }
  return parsed.href;
}

function isStudentMember(db, groupId, userId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'ACTIVE'
  `).get(groupId, userId));
}

async function handlePlatformApi(context) {
  const { request, response, url, db, requireUser, findGroup, groupDto, uploadsPath } = context;
  const method = request.method;
  const pathname = url.pathname;
  const routeGroup = pathname.match(/^\/api\/grupos\/(\d+)(?:\/(.*))?$/);
  const routeClass = pathname.match(/^\/api\/turmas\/(\d+)(?:\/(.*))?$/);
  const routeGroupPlan = pathname.match(/^\/api\/planejamentos\/(\d+)$/);

  function groupForTeacher(groupId, teacher) {
    const group = findGroup(groupId);
    if (!db.prepare("SELECT 1 FROM group_mentors WHERE group_id=? AND professor_id=?").get(groupId, teacher.id)) {
      throw new PlatformError(403, "Este grupo não está vinculado ao seu perfil docente.");
    }
    return group;
  }

  function classForTeacher(classId, teacher) {
    const row = db.prepare(`
      SELECT c.*, s.name AS subject_name, s.code AS subject_code
      FROM classes c JOIN subjects s ON s.id=c.subject_id WHERE c.id=?
    `).get(classId);
    if (!row) throw new PlatformError(404, "Turma não encontrada.");
    if (!db.prepare("SELECT 1 FROM class_teachers WHERE class_id=? AND professor_id=?").get(classId, teacher.id)) {
      throw new PlatformError(403, "Esta turma não está vinculada ao seu perfil docente.");
    }
    return row;
  }

  function authorizedRoom(user, groupId, classId) {
    if (Boolean(groupId) === Boolean(classId)) throw new PlatformError(400, "Selecione um grupo ou uma turma para este recurso.");
    if (groupId) {
      if (user.perfil === "PROFESSOR") groupForTeacher(Number(groupId), user);
      else groupForStudent(Number(groupId), user);
      return { groupId:Number(groupId), classId:null };
    }
    if (user.perfil === "PROFESSOR") classForTeacher(Number(classId), user);
    else if (!db.prepare("SELECT 1 FROM class_enrollments WHERE class_id=? AND student_id=? AND status='ACTIVE'").get(Number(classId),user.id)) throw new PlatformError(403,"A turma não está vinculada à sua matrícula.");
    return { groupId:null, classId:Number(classId) };
  }

  function roomQuery(params, user) {
    const groupId=params.get("grupoId"), classId=params.get("turmaId");
    return authorizedRoom(user,groupId?Number(groupId):null,classId?Number(classId):null);
  }

  function classDto(row) {
    return {
      id: row.id,
      disciplinaId: row.subject_id,
      disciplina: row.subject_name,
      codigoDisciplina: row.subject_code,
      nome: row.name,
      anoLetivo: row.academic_year,
      periodo: row.term,
      dataInicio: row.start_date,
      dataFim: row.end_date,
      status: row.status,
      alunos: db.prepare("SELECT COUNT(*) AS count FROM class_enrollments WHERE class_id=? AND status='ACTIVE'").get(row.id).count,
      horarios: db.prepare("SELECT id, weekday AS dia, start_time AS inicio, end_time AS fim, location AS local, modality AS modalidade FROM class_schedules WHERE class_id=? ORDER BY weekday, start_time").all(row.id)
    };
  }

  function groupPlanDto(row) {
    return {
      id: row.id, groupId: row.group_id, titulo: row.title, dataPrevista: row.planned_date,
      objetivos: row.objectives, conteudoPlanejado: row.planned_content, metodologia: row.methodology,
      recursos: row.resources, dataRealizada: row.realized_date, conteudoMinistrado: row.realized_content,
      observacoes: row.observations, status: row.status, criadoEm: row.created_at, atualizadoEm: row.updated_at
    };
  }

  function classSessionDto(row) {
    return {
      id: row.id, turmaId: row.class_id, data: row.session_date, inicio: row.start_time, fim: row.end_time,
      objetivos: row.objectives, conteudoPlanejado: row.planned_content, metodologia: row.methodology,
      recursos: row.resources, conteudoMinistrado: row.taught_content, observacoes: row.observations,
      atualizadoEm: row.updated_at
    };
  }

  function groupForStudent(groupId, student) {
    findGroup(groupId);
    if (!isStudentMember(db, groupId, student.id)) {
      throw new PlatformError(403, "Participe do grupo para acessar este conteúdo.");
    }
  }

  function contentItems(table, groupId) {
    const rows = db.prepare(`
      SELECT c.*, u.name AS professor_name FROM "${table}" c
      JOIN users u ON u.id = c.professor_id
      WHERE c.group_id = ? ORDER BY c.created_at DESC
    `).all(groupId);
    return rows.map((row) => ({
      id: row.id,
      grupoId: row.group_id,
      titulo: row.title,
      descricao: row.description,
      tipo: row.material_type || row.video_type,
      url: row.external_url,
      arquivoId: row.file_id,
      nomeArquivo: row.file_id
        ? db.prepare("SELECT original_name FROM files WHERE id = ?").get(row.file_id)?.original_name
        : null,
      professor: row.professor_name,
      criadoEm: row.created_at
    }));
  }

  function assignmentDto(item, user) {
    const progress = progressFor(db, item, "assignment");
    const group = item.group_id ? findGroup(item.group_id) : null;
    const own = user.perfil === "ALUNO"
      ? db.prepare("SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?")
        .get(item.id, user.id)
      : null;
    return {
      id: item.id,
      titulo: item.title,
      descricao: item.description,
      tipo: item.kind,
      grupoId: item.group_id,
      turmaId: item.class_id || null,
      turma: item.class_id ? db.prepare("SELECT name FROM classes WHERE id=?").get(item.class_id)?.name || null : null,
      disciplina: group?.subject ?? null,
      semestre: group?.semester ?? null,
      modalidade: item.assignment_mode || "INDIVIDUAL",
      tamanhoEquipe: item.team_size || 4,
      grupo: group?.name ?? null,
      prazo: item.due_date,
      professor: db.prepare("SELECT name FROM users WHERE id = ?").get(item.professor_id).name,
      status: own ? statusLabel(own.status) : statusLabel(progress.status === "COMPLETED" ? "COMPLETED" : "NOT_STARTED"),
      statusCodigo: own?.status || "NOT_STARTED",
      feedback: own?.feedback || null,
      revisadaEm: own?.reviewed_at || null,
      entregaId: own?.id || null,
      nomeArquivo: own?.file_name || null,
      enviadaEm: own?.submitted_at || null,
      nota: own?.grade ?? null,
      progresso: progress.progress,
      recebidos: progress.received,
      esperados: progress.expected,
      vagasPendentes: progress.pending
    };
  }

  function projectDto(project, user) {
    const progress = progressFor(db, project, "project");
    const group = findGroup(project.group_id);
    const own = user.perfil === "ALUNO"
      ? db.prepare("SELECT * FROM submissions WHERE project_id = ? AND student_id = ?")
        .get(project.id, user.id)
      : null;
    return {
      id: project.id,
      nome: project.name,
      descricao: project.description,
      criterios: project.evaluation_criteria,
      grupoId: project.group_id,
      grupo: group.name,
      disciplina: group.subject,
      professor: group.professor_name,
      inicio: project.start_date,
      fim: project.end_date,
      status: statusLabel(progress.status),
      statusCodigo: progress.status,
      progresso: progress.progress,
      recebidos: progress.received,
      esperados: progress.expected,
      pendentes: progress.pending,
      minhaEntrega: own ? {
        id: own.id,
        status: statusLabel(own.status),
        statusCodigo: own.status,
        nomeArquivo: own.file_name,
        enviadaEm: own.submitted_at,
        nota: own.grade
      } : null
    };
  }

  function assignmentById(id) {
    const item = db.prepare("SELECT * FROM assignments WHERE id = ?").get(id);
    if (!item) throw new PlatformError(404, "Tarefa não encontrada.");
    return item;
  }

  function projectById(id) {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!project) throw new PlatformError(404, "Projeto não encontrado.");
    return project;
  }

  function assertTeachingAssignment(item, teacher) {
    if (item.professor_id === teacher.id) return;
    if (item.group_id) return groupForTeacher(item.group_id, teacher);
    if (item.class_id) return classForTeacher(item.class_id, teacher);
    throw new PlatformError(403, "Este conteúdo não está vinculado ao seu perfil docente.");
  }

  function assignmentBody(body, teacher) {
    const title = String(body.titulo ?? "").trim();
    const kind = String(body.tipo ?? body.kind ?? "TASK").toUpperCase();
    const allowedKinds = new Set(["TASK", "EXERCISE", "WORK"]);
    if (!title) throw new PlatformError(400, "O título da tarefa é obrigatório.");
    if (!allowedKinds.has(kind)) throw new PlatformError(400, "Tipo de tarefa inválido.");
    const groupId = body.grupoId === "" || body.grupoId == null ? null : Number(body.grupoId);
    if (groupId) groupForTeacher(groupId, teacher);
    const classId = body.turmaId === "" || body.turmaId == null ? null : Number(body.turmaId);
    if (groupId && classId) throw new PlatformError(400, "Escolha um grupo de estudo ou uma turma acadêmica.");
    if (classId) classForTeacher(classId, teacher);
    const assignmentMode = String(body.modalidade ?? body.assignmentMode ?? "INDIVIDUAL").toUpperCase();
    if (!["INDIVIDUAL", "GROUP"].includes(assignmentMode)) {
      throw new PlatformError(400, "A modalidade deve ser individual ou em grupo.");
    }
    const teamSize = body.tamanhoEquipe == null || body.tamanhoEquipe === "" ? 4 : Number(body.tamanhoEquipe);
    if (!Number.isInteger(teamSize) || teamSize !== 4) {
      throw new PlatformError(400, "As tarefas em grupo devem ter equipes de exatamente 4 alunos.");
    }
    const dueDate = parseDate(body.prazo ?? body.dueDate, "Prazo");
    const expected = body.entregasEsperadas == null || body.entregasEsperadas === ""
      ? null
      : Number(body.entregasEsperadas);
    if (expected !== null && (!Number.isInteger(expected) || expected < 1 || expected > 10000)) {
      throw new PlatformError(400, "A quantidade de entregas esperadas deve ser entre 1 e 10.000.");
    }
    return {
      title,
      description: String(body.descricao ?? "").trim() || null,
      kind,
      groupId,
      classId,
      dueDate,
      expected,
      assignmentMode,
      teamSize
    };
  }

  async function saveFile(file, ownerId, video = false) {
    if (!file || !file.filename || file.data.length === 0) {
      throw new PlatformError(400, "Selecione um arquivo válido.");
    }
    const originalName = safeFilename(file.filename);
    const extension = extname(originalName).toLowerCase();
    const allowed = video ? VIDEO_EXTENSIONS : DOCUMENT_EXTENSIONS;
    if (!allowed.has(extension)) {
      throw new PlatformError(415, video
        ? "Formato de vídeo inválido. Use MP4, WebM ou MOV."
        : "Formato inválido. Use PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ZIP ou imagem.");
    }
    const limit = video ? VIDEO_UPLOAD_LIMIT : REGULAR_UPLOAD_LIMIT;
    if (file.data.length > limit) {
      throw new PlatformError(413, `O arquivo excede o limite de ${video ? 100 : 25} MB.`);
    }
    await mkdir(uploadsPath, { recursive: true });
    const storageName = `${randomUUID()}${extension}`;
    await writeFile(join(uploadsPath, storageName), file.data, { flag: "wx", mode: 0o600 });
    try {
      const result = db.prepare(`
        INSERT INTO files (storage_name, original_name, mime_type, size_bytes, owner_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(storageName, originalName, MIME_TYPES.get(extension), file.data.length, ownerId, now());
      return Number(result.lastInsertRowid);
    } catch (error) {
      await unlink(join(uploadsPath, storageName)).catch((unlinkError) => {
        console.error("Não foi possível remover um upload não registrado:", unlinkError);
      });
      throw error;
    }
  }

  async function removeStoredFile(fileId) {
    const storedFile = db.prepare("SELECT storage_name FROM files WHERE id=?").get(fileId);
    db.prepare("DELETE FROM files WHERE id=?").run(fileId);
    if (!storedFile) return;
    await unlink(join(uploadsPath, storedFile.storage_name)).catch((error) => {
      if (error.code !== "ENOENT") {
        console.error("Não foi possível remover um upload não registrado:", error);
      }
    });
  }

  async function createUploadSubmission(requestBody, student, kind, id) {
    const target = kind === "project" ? projectById(id) : assignmentById(id);
    if (target.group_id) groupForStudent(target.group_id, student);
    const projectId = kind === "project" ? target.id : null;
    const assignmentId = kind === "assignment" ? target.id : null;
    const previous = db.prepare(`
      SELECT * FROM submissions
      WHERE ${kind === "project" ? "project_id = ?" : "(assignment_id = ? OR activity_id = ?)"}
        AND student_id = ?
    `).get(...(kind === "project" ? [id, student.id] : [id, id, student.id]));
    if (previous?.status === "APPROVED") {
      throw new PlatformError(409, "Esta entrega já foi aprovada e não pode ser substituída.");
    }
    const { fields, file } = await readMultipart(requestBody, REGULAR_UPLOAD_LIMIT);
    const fileId = await saveFile(file, student.id);
    const submittedAt = now();
    const comment = String(fields.comentario ?? "").trim() || null;
    const nextVersion = (previous?.version ?? 0) + 1;
    try {
      db.exec("BEGIN");
      let submissionId;
      if (previous) {
        submissionId = previous.id;
        db.prepare(`
          UPDATE submissions SET file_id = ?, file_name = ?, comment = ?, submitted_at = ?,
            status = 'SUBMITTED', feedback = NULL, reviewed_by = NULL, reviewed_at = NULL,
            version = ?, assignment_id = COALESCE(assignment_id, ?)
          WHERE id = ?
        `).run(fileId, safeFilename(file.filename), comment, submittedAt, nextVersion,
          assignmentId, submissionId);
      } else {
        const inserted = db.prepare(`
          INSERT INTO submissions
            (activity_id, assignment_id, project_id, student_id, file_id, comment, file_name,
             submitted_at, status, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?)
        `).run(kind === "assignment" ? id : null, assignmentId, projectId, student.id,
          fileId, comment, safeFilename(file.filename), submittedAt, nextVersion);
        submissionId = Number(inserted.lastInsertRowid);
      }
      db.prepare(`
        INSERT INTO submission_versions
          (submission_id, version, file_id, file_name, comment, submitted_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED')
      `).run(submissionId, nextVersion, fileId, safeFilename(file.filename), comment, submittedAt);
      db.exec("COMMIT");
      if (target.group_id) {
        const professor = target.professor_id;
        db.prepare(`
          INSERT INTO notifications (group_id, author_id, user_id, kind, title, body, created_at)
          VALUES (?, ?, ?, 'SUBMISSION', ?, ?, ?)
        `).run(target.group_id, student.id, professor, "Nova entrega recebida",
          `${student.nome} enviou ${safeFilename(file.filename)}.`, submittedAt);
      }
      return { id: submissionId, versao: nextVersion, nomeArquivo: safeFilename(file.filename), enviadaEm: submittedAt };
    } catch (error) {
      db.exec("ROLLBACK");
      await removeStoredFile(fileId);
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new PlatformError(409, "Já existe uma entrega para esta atividade.");
      }
      throw error;
    }
  }

  function submissionRows(rows) {
    return rows.map((row) => ({
      id: row.id,
      tipo: row.project_id ? "project" : "assignment",
      itemId: row.project_id || row.assignment_id || row.activity_id,
      titulo: row.item_title,
      projeto: Boolean(row.project_id),
      grupo: row.group_name,
      aluno: row.student_name,
      email: row.student_email,
      arquivoId: row.file_id,
      nomeArquivo: row.file_name,
      comentario: row.comment,
      enviadaEm: row.submitted_at,
      status: statusLabel(row.status),
      statusCodigo: row.status,
      feedback: row.feedback,
      nota: row.grade,
      versao: row.version
    }));
  }

  try {
    if (pathname === "/api/perfil" && method === "GET") {
      const user = requireUser(request);
      const photoFileId = db.prepare(
        "SELECT photo_file_id FROM user_profiles WHERE user_id = ?"
      ).get(user.id)?.photo_file_id;
      return sendJson(response, 200, {
        ...user,
        fotoUrl: photoFileId ? `/api/arquivos/${photoFileId}` : null
      });
    }

    if (pathname === "/api/perfil" && method === "PATCH") {
      const user = requireUser(request);
      const { fields, file } = await readMultipart(request, PROFILE_PHOTO_LIMIT);
      const name = String(fields.nome ?? "").trim();
      const removePhoto = fields.removerFoto === "true";
      const uploadedFile = file?.filename ? file : null;
      if (file && !uploadedFile && file.data.length > 0) {
        throw new PlatformError(400, "O arquivo da foto de perfil é inválido.");
      }
      if (name.length < 2 || name.length > 120) {
        throw new PlatformError(400, "O nome deve ter entre 2 e 120 caracteres.");
      }
      if (uploadedFile && removePhoto) {
        throw new PlatformError(400, "Escolha uma nova foto ou remova a atual, não ambos.");
      }
      if (uploadedFile && uploadedFile.data.length > PROFILE_PHOTO_LIMIT) {
        throw new PlatformError(413, "A foto de perfil deve ter no máximo 5 MB.");
      }
      if (uploadedFile && !validProfilePhoto(uploadedFile)) {
        throw new PlatformError(415, "Formato de foto inválido. Use uma imagem PNG, JPG ou WebP válida.");
      }

      const previousPhoto = db.prepare(
        "SELECT photo_file_id FROM user_profiles WHERE user_id = ?"
      ).get(user.id)?.photo_file_id ?? null;
      const newPhotoId = uploadedFile ? await saveFile(uploadedFile, user.id) : null;
      const updatedAt = now();
      try {
        db.exec("BEGIN");
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
        if (newPhotoId || removePhoto) {
          db.prepare(`
            INSERT INTO user_profiles (user_id, photo_file_id, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET photo_file_id = excluded.photo_file_id,
              updated_at = excluded.updated_at
          `).run(user.id, newPhotoId, updatedAt);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (newPhotoId) await removeStoredFile(newPhotoId);
        throw error;
      }

      if (previousPhoto && (newPhotoId || removePhoto)) await removeStoredFile(previousPhoto);
      return sendJson(response, 200, {
        ...user,
        nome: name,
        fotoUrl: newPhotoId ? `/api/arquivos/${newPhotoId}` : (removePhoto ? null : user.fotoUrl)
      });
    }

    if (pathname === "/api/auth/perfil" && method === "GET") {
      return sendJson(response, 200, requireUser(request));
    }

    if (pathname === "/api/public/home" && method === "GET") {
      const groups = db.prepare(`
        SELECT g.*, u.name AS professor_name FROM groups g
        JOIN users u ON u.id = g.professor_id
        WHERE g.status = 'OPEN' AND (
          SELECT COUNT(*) FROM group_members gm
          WHERE gm.group_id = g.id AND gm.status = 'ACTIVE'
        ) < g.max_students
        ORDER BY g.created_at DESC LIMIT 12
      `).all().map((group) => {
        const details = groupDto(group, null);
        return {
          id: details.id,
          nome: details.nome,
          descricao: details.descricao,
          disciplina: details.disciplina,
          professor: details.professor,
          participantes: details.participantes,
          vagas: details.vagas,
          limiteAlunos: details.limiteAlunos,
          status: details.status,
          statusLabel: details.statusLabel
        };
      });
      const groupMetrics = db.prepare(`
        SELECT COUNT(*) AS open_groups,
          COALESCE(SUM(g.max_students - (
            SELECT COUNT(*) FROM group_members gm
            WHERE gm.group_id = g.id AND gm.status = 'ACTIVE'
          )), 0) AS available_seats
        FROM groups g
        WHERE g.status = 'OPEN' AND (
          SELECT COUNT(*) FROM group_members gm
          WHERE gm.group_id = g.id AND gm.status = 'ACTIVE'
        ) < g.max_students
      `).get();
      const news = db.prepare(`
        SELECT n.id, n.kind, n.title, n.body, n.created_at, u.name AS author_name
        FROM notifications n JOIN users u ON u.id = n.author_id
        WHERE n.group_id IS NULL AND n.user_id IS NULL
          AND n.kind IN ('NEWS', 'ANNOUNCEMENT')
        ORDER BY n.created_at DESC LIMIT 6
      `).all().map((row) => ({
        id: row.id,
        tipo: row.kind,
        titulo: row.title,
        descricao: row.body,
        autor: row.author_name,
        criadoEm: row.created_at
      }));
      const assignments = db.prepare(`
        SELECT a.id, a.title, a.due_date, u.name AS professor_name
        FROM assignments a JOIN users u ON u.id = a.professor_id
        WHERE a.group_id IS NULL AND (a.due_date IS NULL OR a.due_date >= ?)
        ORDER BY a.due_date IS NULL, a.due_date LIMIT 4
      `).all(day()).map((row) => ({
        id: row.id,
        titulo: row.title,
        prazo: row.due_date,
        professor: row.professor_name
      }));
      return sendJson(response, 200, {
        demoAccountsEnabled: process.env.NODE_ENV !== "production",
        registrationEnabled: process.env.NODE_ENV !== "production",
        destaques: {
          gruposAbertos: groupMetrics.open_groups,
          vagasDisponiveis: groupMetrics.available_seats,
          atividades: assignments.length
        },
        grupos: groups,
        noticias: news,
        atividades: assignments
      });
    }

    if (pathname === "/api/contatos" && method === "GET") {
      const user=requireUser(request),room=roomQuery(url.searchParams,user);
      const rows=room.groupId?db.prepare(`SELECT DISTINCT u.id,u.name,u.profile FROM users u WHERE u.id<>? AND ((?='PROFESSOR' AND EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=? AND gm.user_id=u.id AND gm.status='ACTIVE')) OR (?='ALUNO' AND EXISTS(SELECT 1 FROM group_mentors m WHERE m.group_id=? AND m.professor_id=u.id))) ORDER BY u.name`).all(user.id,user.perfil,room.groupId,user.perfil,room.groupId):db.prepare(`SELECT DISTINCT u.id,u.name,u.profile FROM users u WHERE u.id<>? AND ((?='PROFESSOR' AND EXISTS(SELECT 1 FROM class_enrollments e WHERE e.class_id=? AND e.student_id=u.id AND e.status='ACTIVE')) OR (?='ALUNO' AND EXISTS(SELECT 1 FROM class_teachers t WHERE t.class_id=? AND t.professor_id=u.id))) ORDER BY u.name`).all(user.id,user.perfil,room.classId,user.perfil,room.classId);
      return sendJson(response,200,rows.map(r=>({id:r.id,nome:r.name,perfil:r.profile})));
    }
    if (pathname === "/api/mensagens" && method === "GET") {
      const user=requireUser(request), room=roomQuery(url.searchParams,user);
      const rows=db.prepare(`SELECT m.*,s.name remetente,r.name destinatario FROM private_messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id WHERE (m.sender_id=? OR m.recipient_id=?) AND m.group_id IS ? AND m.class_id IS ? ORDER BY m.created_at`).all(user.id,user.id,room.groupId,room.classId);
      db.prepare("UPDATE private_messages SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND group_id IS ? AND class_id IS ?").run(now(),user.id,room.groupId,room.classId);
      return sendJson(response,200,rows.map(m=>({id:m.id,remetenteId:m.sender_id,remetente:m.remetente,destinatarioId:m.recipient_id,destinatario:m.destinatario,mensagem:m.body,lidaEm:m.read_at,enviadaEm:m.created_at})));
    }
    if (pathname === "/api/mensagens" && method === "POST") {
      const user=requireUser(request),body=await context.readBody(request),room=authorizedRoom(user,body.grupoId?Number(body.grupoId):null,body.turmaId?Number(body.turmaId):null),recipientId=Number(body.destinatarioId),message=String(body.mensagem??"").trim();
      if(!Number.isInteger(recipientId)||recipientId===user.id||!message||message.length>4000)throw new PlatformError(400,"Informe destinatário e mensagem (até 4.000 caracteres).");
      const recipient=db.prepare("SELECT id,profile FROM users WHERE id=?").get(recipientId);if(!recipient)throw new PlatformError(404,"Destinatário não encontrado.");
      if(recipient.profile===user.perfil)throw new PlatformError(403,"Mensagens privadas só podem ser trocadas entre professor e aluno vinculados ao mesmo grupo ou turma.");
      authorizedRoom({id:recipientId,perfil:recipient.profile==="PROFESSOR"?"PROFESSOR":"ALUNO"},room.groupId,room.classId);
      db.prepare("INSERT INTO private_messages(sender_id,recipient_id,group_id,class_id,body,created_at) VALUES(?,?,?,?,?,?)").run(user.id,recipientId,room.groupId,room.classId,message,now());
      return sendJson(response,201,{ok:"Mensagem enviada."});
    }
    if (pathname === "/api/forum" && method === "GET") {
      const user=requireUser(request),room=roomQuery(url.searchParams,user);
      const rows=db.prepare(`SELECT t.*,u.name autor,(SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=t.id) respostas FROM forum_topics t JOIN users u ON u.id=t.author_id WHERE t.group_id IS ? AND t.class_id IS ? ORDER BY t.updated_at DESC`).all(room.groupId,room.classId);
      return sendJson(response,200,rows.map(t=>({id:t.id,titulo:t.title,descricao:t.body,autor:t.autor,respostas:t.respostas,bloqueado:Boolean(t.locked),criadoEm:t.created_at,atualizadoEm:t.updated_at})));
    }
    if (pathname === "/api/forum" && method === "POST") {
      const user=requireUser(request),body=await context.readBody(request),room=authorizedRoom(user,body.grupoId?Number(body.grupoId):null,body.turmaId?Number(body.turmaId):null),title=String(body.titulo??"").trim(),message=String(body.mensagem??"").trim();if(!title||!message)throw new PlatformError(400,"Informe o título e o texto inicial da discussão.");const stamp=now(),result=db.prepare("INSERT INTO forum_topics(group_id,class_id,author_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(room.groupId,room.classId,user.id,title,message,stamp,stamp);return sendJson(response,201,{id:Number(result.lastInsertRowid),titulo:title});
    }
    const forumTopicRoute=pathname.match(/^\/api\/forum\/(\d+)\/posts$/);
    if(forumTopicRoute&&(method==="GET"||method==="POST")){const user=requireUser(request),topic=db.prepare("SELECT * FROM forum_topics WHERE id=?").get(Number(forumTopicRoute[1]));if(!topic)throw new PlatformError(404,"Discussão não encontrada.");authorizedRoom(user,topic.group_id,topic.class_id);if(method==="GET"){const posts=db.prepare("SELECT p.*,u.name autor FROM forum_posts p JOIN users u ON u.id=p.author_id WHERE p.topic_id=? ORDER BY p.created_at").all(topic.id);return sendJson(response,200,{id:topic.id,titulo:topic.title,descricao:topic.body,autor:db.prepare("SELECT name FROM users WHERE id=?").get(topic.author_id).name,bloqueado:Boolean(topic.locked),posts:posts.map(p=>({id:p.id,autor:p.autor,mensagem:p.body,enviadaEm:p.created_at}))});}if(topic.locked)throw new PlatformError(409,"Esta discussão foi encerrada.");const body=await context.readBody(request),message=String(body.mensagem??"").trim();if(!message)throw new PlatformError(400,"A resposta não pode ficar vazia.");const stamp=now();db.prepare("INSERT INTO forum_posts(topic_id,author_id,body,created_at) VALUES(?,?,?,?)").run(topic.id,user.id,message,stamp);db.prepare("UPDATE forum_topics SET updated_at=? WHERE id=?").run(stamp,topic.id);return sendJson(response,201,{ok:"Resposta publicada."});}
    if(pathname==="/api/reservas"&&method==="GET"){const teacher=requireUser(request,"PROFESSOR");return sendJson(response,200,db.prepare(`SELECT r.*,c.name turma FROM resource_reservations r LEFT JOIN classes c ON c.id=r.class_id WHERE r.professor_id=? ORDER BY r.starts_at`).all(teacher.id).map(r=>({id:r.id,recurso:r.resource,finalidade:r.purpose,inicio:r.starts_at,fim:r.ends_at,status:r.status,turma:r.turma,turmaId:r.class_id})))}
    if(pathname==="/api/reservas"&&method==="POST"){const teacher=requireUser(request,"PROFESSOR"),body=await context.readBody(request),resource=String(body.recurso??"").trim(),purpose=String(body.finalidade??"").trim(),start=String(body.inicio??""),end=String(body.fim??""),classId=body.turmaId?Number(body.turmaId):null;if(classId)classForTeacher(classId,teacher);if(!resource||resource.length>120||!purpose||purpose.length>500||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(start)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(end)||end<=start)throw new PlatformError(400,"Confira recurso, finalidade e período da reserva.");if(db.prepare("SELECT 1 FROM resource_reservations WHERE resource=? AND status='CONFIRMED' AND starts_at<? AND ends_at>?").get(resource,end,start))throw new PlatformError(409,"Este recurso já está reservado nesse horário.");const result=db.prepare("INSERT INTO resource_reservations(professor_id,class_id,resource,purpose,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?)").run(teacher.id,classId,resource,purpose,start,end,now());return sendJson(response,201,{id:Number(result.lastInsertRowid),ok:"Reserva confirmada."})}
    const reservationRoute=pathname.match(/^\/api\/reservas\/(\d+)$/);if(reservationRoute&&method==="DELETE"){const teacher=requireUser(request,"PROFESSOR"),result=db.prepare("UPDATE resource_reservations SET status='CANCELED' WHERE id=? AND professor_id=? AND status='CONFIRMED'").run(Number(reservationRoute[1]),teacher.id);if(!result.changes)throw new PlatformError(404,"Reserva não encontrada.");return sendJson(response,200,{ok:"Reserva cancelada."})}
    if(pathname==="/api/documentos"&&method==="GET"){const user=requireUser(request);const rows=db.prepare(`SELECT d.*,u.name autor FROM institutional_documents d JOIN users u ON u.id=d.owner_id WHERE (d.group_id IS NULL AND d.class_id IS NULL) OR d.owner_id=? OR (?='ALUNO' AND (EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=d.group_id AND gm.user_id=? AND gm.status='ACTIVE') OR EXISTS(SELECT 1 FROM class_enrollments ce WHERE ce.class_id=d.class_id AND ce.student_id=? AND ce.status='ACTIVE'))) OR (?='PROFESSOR' AND (EXISTS(SELECT 1 FROM group_mentors gm WHERE gm.group_id=d.group_id AND gm.professor_id=?) OR EXISTS(SELECT 1 FROM class_teachers ct WHERE ct.class_id=d.class_id AND ct.professor_id=?))) ORDER BY d.created_at DESC`).all(user.id,user.perfil,user.id,user.id,user.perfil,user.id,user.id);return sendJson(response,200,rows.map(d=>({id:d.id,titulo:d.title,descricao:d.description,autor:d.autor,grupoId:d.group_id,turmaId:d.class_id,arquivoId:d.file_id,nomeArquivo:d.file_id?db.prepare("SELECT original_name FROM files WHERE id=?").get(d.file_id)?.original_name:null,url:d.external_url,criadoEm:d.created_at})));}
    if (pathname === "/api/documentos" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const contentType = request.headers["content-type"] ?? "";
      const multipart = contentType.includes("multipart/form-data");
      const data = multipart ? await readMultipart(request, VIDEO_UPLOAD_LIMIT) : null;
      const body = data?.fields ?? await context.readBody(request);
      const groupId = body.grupoId ? Number(body.grupoId) : null;
      const classId = body.turmaId ? Number(body.turmaId) : null;
      const title = String(body.titulo ?? "").trim();
      const uploadedFile = data?.file?.filename && data.file.data.length ? data.file : null;
      if (!title) throw new PlatformError(400, "Informe o título do documento.");
      if (uploadedFile && body.url) throw new PlatformError(400, "Escolha um arquivo ou um link, não os dois.");
      const link = body.url ? externalUrl(String(body.url)) : null;
      const videoFile = uploadedFile && VIDEO_EXTENSIONS.has(extname(safeFilename(uploadedFile.filename)).toLowerCase());
      const videoLink = isVideoUrl(link);
      const isVideo = Boolean(videoFile || videoLink);
      if ((groupId || classId) && !isVideo) authorizedRoom(teacher, groupId, classId);
      if (isVideo) {
        if (!groupId) throw new PlatformError(400, "Selecione um grupo para publicar o vídeo na seção Vídeos.");
        if (classId) throw new PlatformError(400, "Vídeos devem ser vinculados a um grupo de estudo.");
        groupForTeacher(groupId, teacher);
        let fileId = null;
        try {
          let type = "STREAM";
          let videoUrl = link;
          if (videoFile) {
            fileId = await saveFile(uploadedFile, teacher.id, true);
            type = "UPLOAD";
            videoUrl = null;
          } else {
            const host = new URL(link).hostname.toLowerCase();
            if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") type = "YOUTUBE";
          }
          const result = db.prepare("INSERT INTO videos (group_id,professor_id,title,description,video_type,external_url,file_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
            .run(groupId, teacher.id, title, String(body.descricao ?? "").trim() || null, type, videoUrl, fileId, now());
          return sendJson(response, 201, { id: Number(result.lastInsertRowid), titulo: title, tipo: "VIDEO", secao: "videos" });
        } catch (error) {
          if (fileId) await removeStoredFile(fileId);
          throw error;
        }
      }
      if (!uploadedFile && !link) throw new PlatformError(400, "Envie um arquivo ou informe um link HTTP/HTTPS.");
      if (uploadedFile && uploadedFile.data.length > REGULAR_UPLOAD_LIMIT) throw new PlatformError(413, "O documento excede o limite de 25 MB.");
      let fileId = null;
      try {
        if (uploadedFile) fileId = await saveFile(uploadedFile, teacher.id);
        const result = db.prepare("INSERT INTO institutional_documents(owner_id,group_id,class_id,title,description,file_id,external_url,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(teacher.id, groupId, classId, title, String(body.descricao ?? "").trim() || null, fileId, link, now());
        return sendJson(response, 201, { id: Number(result.lastInsertRowid), titulo: title, secao: "documentos" });
      } catch (error) {
        if (fileId) await removeStoredFile(fileId);
        throw error;
      }
    }

    if (pathname === "/api/noticias" && method === "GET") {
      const user = requireUser(request);
      const rows = db.prepare(`
        SELECT n.*, g.name AS group_name, u.name AS author_name
        FROM notifications n LEFT JOIN groups g ON g.id = n.group_id
        JOIN users u ON u.id = n.author_id
        WHERE n.user_id IS NULL OR n.user_id = ? OR
          (n.group_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = n.group_id AND gm.user_id = ? AND gm.status = 'ACTIVE'
          ))
        ORDER BY n.created_at DESC LIMIT 50
      `).all(user.id, user.id);
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id,
        tipo: row.kind,
        titulo: row.title,
        descricao: row.body,
        grupoId: row.group_id,
        grupo: row.group_name,
        autor: row.author_name,
        criadoEm: row.created_at
      })));
    }
    if (pathname === "/api/noticias" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const body = await context.readBody(request);
      const title = String(body.titulo ?? "").trim();
      const description = String(body.descricao ?? "").trim();
      const kind = String(body.tipo ?? "NEWS").toUpperCase();
      if (!title || !description || !["NEWS", "ANNOUNCEMENT"].includes(kind)) {
        throw new PlatformError(400, "Informe título, descrição e um tipo válido para a notícia.");
      }
      const groupId = body.grupoId ? Number(body.grupoId) : null;
      if (groupId) groupForTeacher(groupId, teacher);
      db.prepare(`
        INSERT INTO notifications (group_id, author_id, kind, title, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(groupId, teacher.id, kind, title, description, now());
      return sendJson(response, 201, { ok: "Publicação criada." });
    }

    if (pathname === "/api/home" && method === "GET") {
      const user = requireUser(request);
      const groups = db.prepare(`
        SELECT g.*, u.name AS professor_name FROM groups g
        JOIN users u ON u.id = g.professor_id
        ORDER BY CASE WHEN g.status = 'OPEN' THEN 0 ELSE 1 END, g.created_at DESC LIMIT 6
      `).all().map((group) => groupDto(group, user.id));
      const news = db.prepare(`
        SELECT n.*, u.name AS author_name FROM notifications n
        JOIN users u ON u.id = n.author_id
        WHERE n.user_id IS NULL OR n.user_id = ? OR
          (n.group_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = n.group_id
              AND gm.user_id = ? AND gm.status = 'ACTIVE'
          ))
        ORDER BY n.created_at DESC LIMIT 6
      `).all(user.id, user.id).map((row) => ({
        id: row.id, tipo: row.kind, titulo: row.title, descricao: row.body,
        autor: row.author_name, criadoEm: row.created_at
      }));
      const assignments = db.prepare(`
        SELECT a.* FROM assignments a
        WHERE (a.group_id IS NULL AND ? = 'ALUNO') OR
          (a.group_id IS NOT NULL AND (
            a.professor_id = ? OR EXISTS (
              SELECT 1 FROM group_members gm WHERE gm.group_id = a.group_id
                AND gm.user_id = ? AND gm.status = 'ACTIVE'
            )
          ))
        ORDER BY a.due_date IS NULL, a.due_date LIMIT 6
      `).all(user.perfil, user.id, user.id).map((row) => assignmentDto(row, user));
      const projects = db.prepare(`
        SELECT p.* FROM projects p
        WHERE p.professor_id = ? OR EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = p.group_id
            AND gm.user_id = ? AND gm.status = 'ACTIVE'
        ) ORDER BY p.end_date LIMIT 6
      `).all(user.id, user.id).map((row) => projectDto(row, user));
      const materials = db.prepare(`
        SELECT m.*, g.name AS group_name, u.name AS professor_name
        FROM materials m JOIN groups g ON g.id = m.group_id JOIN users u ON u.id = m.professor_id
        WHERE m.professor_id = ? OR EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = m.group_id
            AND gm.user_id = ? AND gm.status = 'ACTIVE'
        ) ORDER BY m.created_at DESC LIMIT 6
      `).all(user.id, user.id).map((row) => ({
        id: row.id, titulo: row.title, descricao: row.description, grupo: row.group_name,
        tipo: row.material_type, url: row.external_url, arquivoId: row.file_id,
        nomeArquivo: row.file_id ? db.prepare("SELECT original_name FROM files WHERE id=?").get(row.file_id)?.original_name : null
      }));
      if (user.perfil === "PROFESSOR") {
        return sendJson(response, 200, {
          groups, news, assignments, projects, materials,
          dashboard: dashboardMetrics(db, user.id)
        });
      }
      return sendJson(response, 200, { groups, news, assignments, projects, materials });
    }

    if (pathname === "/api/relatorios" && method === "GET") {
      const teacher = requireUser(request, "PROFESSOR");
      const semester = url.searchParams.get("semestre") ? Number(url.searchParams.get("semestre")) : null;
      const groupId = url.searchParams.get("grupoId") ? Number(url.searchParams.get("grupoId")) : null;
      const classId = url.searchParams.get("turmaId") ? Number(url.searchParams.get("turmaId")) : null;
      const studentId = url.searchParams.get("alunoId") ? Number(url.searchParams.get("alunoId")) : null;
      if (semester !== null && (!Number.isInteger(semester) || semester < 1 || semester > 6)) {
        throw new PlatformError(400, "Semestre inválido.");
      }
      if (groupId) groupForTeacher(groupId, teacher);
      if(classId){classForTeacher(classId,teacher);const roster=db.prepare("SELECT u.id,u.name FROM class_enrollments e JOIN users u ON u.id=e.student_id WHERE e.class_id=? AND e.status='ACTIVE' ORDER BY u.name").all(classId);if(studentId&&!roster.some(s=>s.id===studentId))throw new PlatformError(404,"Aluno não encontrado na turma.");const assessments=db.prepare("SELECT id,max_score,weight FROM class_assessments WHERE class_id=?").all(classId);const totalSessions=db.prepare("SELECT COUNT(*) n FROM class_sessions WHERE class_id=?").get(classId).n;const rows=roster.filter(s=>!studentId||s.id===studentId).map(s=>{let weighted=0,weights=0;for(const a of assessments){const grade=db.prepare("SELECT score FROM assessment_grades WHERE assessment_id=? AND student_id=?").get(a.id,s.id);if(grade){weighted+=grade.score/a.max_score*100*a.weight;weights+=a.weight;}}const attendance=db.prepare("SELECT SUM(status IN ('PRESENT','JUSTIFIED')) attended FROM attendance_records ar JOIN class_sessions cs ON cs.id=ar.session_id WHERE cs.class_id=? AND ar.student_id=?").get(classId,s.id);return {alunoId:s.id,aluno:s.name,mediaPonderada:weights?Math.round(weighted/weights*10)/10:null,frequencia:totalSessions?Math.round((attendance.attended||0)/totalSessions*100):null,aulasRegistradas:totalSessions,ocorrencias:db.prepare("SELECT COUNT(*) n FROM class_occurrences WHERE class_id=? AND student_id=?").get(classId,s.id).n};});const scored=rows.filter(r=>r.mediaPonderada!==null),frequency=rows.filter(r=>r.frequencia!==null);return sendJson(response,200,{tipo:"turma",turmaId:classId,total:rows.length,mediaTurma:scored.length?Math.round(scored.reduce((n,r)=>n+r.mediaPonderada,0)/scored.length*10)/10:null,frequenciaMedia:frequency.length?Math.round(frequency.reduce((n,r)=>n+r.frequencia,0)/frequency.length):null,ocorrencias:rows.reduce((n,r)=>n+r.ocorrencias,0),linhas:rows});}
      if (studentId && !db.prepare(`
        SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
        WHERE gm.user_id=? AND g.professor_id=? AND gm.status='ACTIVE'
      `).get(studentId, teacher.id)) {
        throw new PlatformError(404, "Aluno não encontrado nos grupos do professor.");
      }
      const assignments = db.prepare(`
        SELECT a.*, g.name AS group_name, g.subject, g.semester
        FROM assignments a LEFT JOIN groups g ON g.id=a.group_id
        WHERE (a.professor_id=? OR EXISTS (
          SELECT 1 FROM group_mentors mt WHERE mt.group_id=a.group_id AND mt.professor_id=?
        ))
          AND (? IS NULL OR g.semester=?)
          AND (? IS NULL OR a.group_id=?)
        ORDER BY g.semester, g.subject, a.due_date
      `).all(teacher.id, teacher.id, semester, semester, groupId, groupId);
      const rows = assignments.map((item) => {
        const progress = progressFor(db, item, "assignment");
        const student = studentId
          ? db.prepare("SELECT name, email FROM users WHERE id=?").get(studentId)
          : null;
        const submitted = studentId
          ? db.prepare(`
            SELECT status, grade, submitted_at FROM submissions
            WHERE (assignment_id=? OR activity_id=?) AND student_id=?
            ORDER BY submitted_at DESC LIMIT 1
          `).get(item.id, item.id, studentId)
          : null;
        return {
          id: item.id,
          titulo: item.title,
          disciplina: item.subject,
          semestre: item.semester,
          grupo: item.group_name,
          modalidade: item.assignment_mode || "INDIVIDUAL",
          prazo: item.due_date,
          progresso: studentId ? (submitted ? 100 : 0) : progress.progress,
          recebidos: studentId ? (submitted ? 1 : 0) : progress.received,
          esperados: studentId ? 1 : progress.expected,
          aluno: student?.name || null,
          email: student?.email || null,
          status: submitted ? statusLabel(submitted.status) : statusLabel(progress.status),
          nota: submitted?.grade ?? null
        };
      });
      const received = rows.reduce((total, row) => total + row.recebidos, 0);
      const expected = rows.reduce((total, row) => total + row.esperados, 0);
      return sendJson(response, 200, {
        tipo: studentId ? "aluno" : groupId ? "grupo" : "semestre",
        semestre: semester,
        grupoId: groupId,
        alunoId: studentId,
        total: rows.length,
        recebidos: received,
        pendentes: Math.max(0, expected - received),
        aproveitamento: expected ? Math.round(received / expected * 100) : 0,
        linhas: rows
      });
    }

    if (pathname === "/api/dashboard" && method === "GET") {
      const teacher = requireUser(request, "PROFESSOR");
      const type = url.searchParams.get("tipo") || "resumo";
      if (!["resumo", "projetos", "tarefas", "entregaveis"].includes(type)) {
        throw new PlatformError(400, "Tipo de painel inválido.");
      }
      const metrics = dashboardMetrics(db, teacher.id);
      if (type === "projetos") {
        metrics.projetos = db.prepare(`SELECT * FROM projects p WHERE p.professor_id = ? OR EXISTS (
          SELECT 1 FROM group_mentors mt WHERE mt.group_id=p.group_id AND mt.professor_id=?
        ) ORDER BY end_date`).all(teacher.id, teacher.id).map((project) => projectDto(project, teacher));
      } else if (type === "tarefas") {
        metrics.tarefas = db.prepare(`SELECT * FROM assignments a WHERE a.professor_id = ? OR EXISTS (
          SELECT 1 FROM group_mentors mt WHERE mt.group_id=a.group_id AND mt.professor_id=?
        ) ORDER BY due_date`).all(teacher.id, teacher.id).map((item) => assignmentDto(item, teacher));
      } else if (type === "entregaveis") {
        metrics.entregaveis = getTeacherSubmissions(db, teacher.id);
      }
      return sendJson(response, 200, metrics);
    }

    if (pathname === "/api/disciplinas" && method === "GET") {
      const teacher = requireUser(request, "PROFESSOR");
      const rows = db.prepare(`SELECT s.*, COUNT(DISTINCT CASE WHEN ct.professor_id=? THEN c.id END) AS turmas FROM subjects s
        LEFT JOIN classes c ON c.subject_id=s.id
        LEFT JOIN class_teachers ct ON ct.class_id=c.id AND ct.professor_id=?
        GROUP BY s.id ORDER BY s.name`).all(teacher.id, teacher.id);
      return sendJson(response, 200, rows.map((r) => ({id:r.id,codigo:r.code,nome:r.name,turmas:r.turmas,ativa:Boolean(r.active)})));
    }
    if (pathname === "/api/disciplinas" && method === "POST") {
      requireUser(request, "PROFESSOR");
      const body = await context.readBody(request); const name=String(body.nome??"").trim();
      if (!name || name.length>160) throw new PlatformError(400,"Informe um nome de disciplina (até 160 caracteres).");
      try { const result=db.prepare("INSERT INTO subjects(code,name) VALUES(?,?)").run(String(body.codigo??"").trim()||null,name);
        return sendJson(response,201,{id:Number(result.lastInsertRowid),nome:name,codigo:String(body.codigo??"").trim()||null});
      } catch(e) { if (String(e.message).includes("UNIQUE")) throw new PlatformError(409,"Já existe uma disciplina com esse nome ou código."); throw e; }
    }
    if (pathname === "/api/turmas" && method === "GET") {
      const user=requireUser(request); const rows=db.prepare(`SELECT c.*,s.name subject_name,s.code subject_code FROM classes c JOIN subjects s ON s.id=c.subject_id
        WHERE (?='PROFESSOR' AND EXISTS(SELECT 1 FROM class_teachers ct WHERE ct.class_id=c.id AND ct.professor_id=?))
        OR (?='ALUNO' AND EXISTS(SELECT 1 FROM class_enrollments ce WHERE ce.class_id=c.id AND ce.student_id=? AND ce.status='ACTIVE'))
        ORDER BY c.academic_year DESC,c.term,c.name`).all(user.perfil,user.id,user.perfil,user.id);
      return sendJson(response,200,rows.map(classDto));
    }
    if (pathname === "/api/turmas" && method === "POST") {
      const teacher=requireUser(request,"PROFESSOR"); const body=await context.readBody(request);
      const subjectId=Number(body.disciplinaId), name=String(body.nome??"").trim(), year=Number(body.anoLetivo), term=Number(body.periodo);
      if (!db.prepare("SELECT 1 FROM subjects WHERE id=? AND active=1").get(subjectId)) throw new PlatformError(400,"Selecione uma disciplina válida.");
      if (!name || name.length>120 || !Number.isInteger(year) || year<2000 || year>2100 || ![1,2].includes(term)) throw new PlatformError(400,"Informe nome, ano letivo e período (1 ou 2) válidos.");
      const start=parseDate(body.dataInicio,"Data de início"), end=parseDate(body.dataFim,"Data de término");
      if(start&&end&&start>end) throw new PlatformError(400,"A data final deve ser posterior à inicial.");
      const created=now(); db.exec("BEGIN"); try { const res=db.prepare("INSERT INTO classes(subject_id,name,academic_year,term,start_date,end_date,created_at) VALUES(?,?,?,?,?,?,?)").run(subjectId,name,year,term,start,end,created);
        db.prepare("INSERT INTO class_teachers(class_id,professor_id,assigned_at) VALUES(?,?,?)").run(Number(res.lastInsertRowid),teacher.id,created); db.exec("COMMIT"); return sendJson(response,201,classDto(db.prepare("SELECT c.*,s.name subject_name,s.code subject_code FROM classes c JOIN subjects s ON s.id=c.subject_id WHERE c.id=?").get(Number(res.lastInsertRowid))));
      } catch(e) { db.exec("ROLLBACK"); throw e; }
    }
    if (routeClass) {
      const classId=Number(routeClass[1]), sub=routeClass[2]||"";
      if (!sub && method === "GET") { const user=requireUser(request); if(user.perfil==="PROFESSOR") return sendJson(response,200,classDto(classForTeacher(classId,user)));
        const c=db.prepare("SELECT c.*,s.name subject_name,s.code subject_code FROM classes c JOIN subjects s ON s.id=c.subject_id WHERE c.id=? AND EXISTS(SELECT 1 FROM class_enrollments e WHERE e.class_id=c.id AND e.student_id=? AND e.status='ACTIVE')").get(classId,user.id);
        if(!c) throw new PlatformError(404,"Turma não encontrada."); return sendJson(response,200,classDto(c)); }
      if (sub === "horarios" && method === "POST") { const teacher=requireUser(request,"PROFESSOR"); classForTeacher(classId,teacher); const b=await context.readBody(request); const weekday=Number(b.dia), start=String(b.inicio??""), end=String(b.fim??""), modality=String(b.modalidade??"PRESENCIAL").toUpperCase();
        if(!Number.isInteger(weekday)||weekday<1||weekday>7||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end)||end<=start||!["PRESENCIAL","REMOTA","HIBRIDA"].includes(modality)) throw new PlatformError(400,"Confira dia, horários e modalidade.");
        const r=db.prepare("INSERT INTO class_schedules(class_id,weekday,start_time,end_time,location,modality) VALUES(?,?,?,?,?,?)").run(classId,weekday,start,end,String(b.local??"").trim()||null,modality); return sendJson(response,201,{id:Number(r.lastInsertRowid),dia:weekday,inicio:start,fim:end,local:b.local||null,modalidade:modality}); }
      const scheduleRoute=sub.match(/^horarios\/(\d+)$/);
      if(scheduleRoute&&method==="DELETE"){const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);const result=db.prepare("DELETE FROM class_schedules WHERE id=? AND class_id=?").run(Number(scheduleRoute[1]),classId);if(!result.changes)throw new PlatformError(404,"Horário não encontrado.");return sendJson(response,200,{ok:"Horário removido."});}
      if (sub === "aulas" && method === "GET") { const user=requireUser(request); if(user.perfil==="PROFESSOR") classForTeacher(classId,user); else if(!db.prepare("SELECT 1 FROM class_enrollments WHERE class_id=? AND student_id=? AND status='ACTIVE'").get(classId,user.id)) throw new PlatformError(403,"Acesso restrito aos alunos matriculados.");
        const rows=db.prepare("SELECT * FROM class_sessions WHERE class_id=? ORDER BY session_date DESC,start_time").all(classId).map((r)=>({...classSessionDto(r),frequencias:user.perfil==="PROFESSOR"?db.prepare("SELECT COUNT(*) total, SUM(status='PRESENT') presentes, SUM(status='ABSENT') ausentes, SUM(status='JUSTIFIED') justificadas FROM attendance_records WHERE session_id=?").get(r.id):undefined})); return sendJson(response,200,rows); }
      if (sub === "aulas" && method === "POST") { const teacher=requireUser(request,"PROFESSOR"); classForTeacher(classId,teacher); const b=await context.readBody(request), date=parseDate(b.data,"Data da aula"); if(!date) throw new PlatformError(400,"Informe a data da aula.");
        const created=now(); const r=db.prepare("INSERT INTO class_sessions(class_id,session_date,start_time,end_time,objectives,planned_content,methodology,resources,taught_content,observations,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(classId,date,b.inicio||null,b.fim||null,b.objetivos||null,b.conteudoPlanejado||null,b.metodologia||null,b.recursos||null,b.conteudoMinistrado||null,b.observacoes||null,teacher.id,created,created);
        return sendJson(response,201,classSessionDto(db.prepare("SELECT * FROM class_sessions WHERE id=?").get(Number(r.lastInsertRowid)))); }
      const lessonRoute=sub.match(/^aulas\/(\d+)$/);
      if(lessonRoute&&method==="PUT"){const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);const lesson=db.prepare("SELECT * FROM class_sessions WHERE id=? AND class_id=?").get(Number(lessonRoute[1]),classId);if(!lesson)throw new PlatformError(404,"Aula não encontrada.");const b=await context.readBody(request),date=parseDate(b.data??lesson.session_date,"Data da aula");db.prepare("UPDATE class_sessions SET session_date=?,start_time=?,end_time=?,objectives=?,planned_content=?,methodology=?,resources=?,taught_content=?,observations=?,updated_at=? WHERE id=?").run(date,b.inicio??lesson.start_time,b.fim??lesson.end_time,b.objetivos??lesson.objectives,b.conteudoPlanejado??lesson.planned_content,b.metodologia??lesson.methodology,b.recursos??lesson.resources,b.conteudoMinistrado??lesson.taught_content,b.observacoes??lesson.observations,now(),lesson.id);return sendJson(response,200,classSessionDto(db.prepare("SELECT * FROM class_sessions WHERE id=?").get(lesson.id)));}
      const attendance=sub.match(/^aulas\/(\d+)\/frequencia$/);
      if(attendance&&method==="GET"){const teacher=requireUser(request,"PROFESSOR"); classForTeacher(classId,teacher); const session=db.prepare("SELECT 1 FROM class_sessions WHERE id=? AND class_id=?").get(Number(attendance[1]),classId); if(!session)throw new PlatformError(404,"Aula não encontrada."); return sendJson(response,200,db.prepare(`SELECT u.id,u.name nome,COALESCE(a.status,'ABSENT') status,a.justification justificativa FROM class_enrollments e JOIN users u ON u.id=e.student_id LEFT JOIN attendance_records a ON a.session_id=? AND a.student_id=e.student_id WHERE e.class_id=? AND e.status='ACTIVE' ORDER BY u.name`).all(Number(attendance[1]),classId));}
      if(attendance&&method==="PUT"){const teacher=requireUser(request,"PROFESSOR"); classForTeacher(classId,teacher); const sessionId=Number(attendance[1]), b=await context.readBody(request); if(!db.prepare("SELECT 1 FROM class_sessions WHERE id=? AND class_id=?").get(sessionId,classId))throw new PlatformError(404,"Aula não encontrada."); if(!Array.isArray(b.registros))throw new PlatformError(400,"Envie a lista de frequência."); const enrolled=new Set(db.prepare("SELECT student_id FROM class_enrollments WHERE class_id=? AND status='ACTIVE'").all(classId).map(x=>x.student_id)); const stamp=now(); db.exec("BEGIN");try{for(const item of b.registros){const sid=Number(item.alunoId),status=String(item.status||"").toUpperCase();if(!enrolled.has(sid)||!["PRESENT","ABSENT","JUSTIFIED"].includes(status))throw new PlatformError(400,"Aluno ou situação de frequência inválidos."); db.prepare(`INSERT INTO attendance_records(session_id,student_id,status,justification,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,justification=excluded.justification,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(sessionId,sid,status,String(item.justificativa||"").trim()||null,teacher.id,stamp);}db.exec("COMMIT");}catch(e){db.exec("ROLLBACK");throw e;} return sendJson(response,200,{ok:"Frequência salva."});}
      if (sub === "alunos" && method === "GET") {const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);return sendJson(response,200,db.prepare("SELECT u.id,u.name nome,u.email FROM class_enrollments e JOIN users u ON u.id=e.student_id WHERE e.class_id=? AND e.status='ACTIVE' ORDER BY u.name").all(classId));}
      if (sub === "avaliacoes" && method === "GET") {
        const teacher=requireUser(request,"PROFESSOR"); classForTeacher(classId,teacher);
        const items=db.prepare("SELECT * FROM class_assessments WHERE class_id=? ORDER BY due_date IS NULL,due_date,id").all(classId);
        return sendJson(response,200,items.map(a=>({id:a.id,titulo:a.title,categoria:a.category,notaMaxima:a.max_score,peso:a.weight,prazo:a.due_date,descricao:a.description,notas:db.prepare(`SELECT u.id alunoId,u.name aluno,g.score nota,g.feedback comentario FROM class_enrollments e JOIN users u ON u.id=e.student_id LEFT JOIN assessment_grades g ON g.assessment_id=? AND g.student_id=e.student_id WHERE e.class_id=? AND e.status='ACTIVE' ORDER BY u.name`).all(a.id,classId)})));
      }
      if (sub === "avaliacoes" && method === "POST") {
        const teacher=requireUser(request,"PROFESSOR"); classForTeacher(classId,teacher); const b=await context.readBody(request);
        const title=String(b.titulo??"").trim(), max=Number(b.notaMaxima??100), weight=Number(b.peso??1), category=String(b.categoria??"AVALIACAO").toUpperCase();
        if(!title||!Number.isFinite(max)||max<=0||!Number.isFinite(weight)||weight<=0||weight>100||!["AVALIACAO","TRABALHO","PROVA","SEMINARIO","PARTICIPACAO","OUTRA"].includes(category))throw new PlatformError(400,"Confira título, categoria, nota máxima e peso da avaliação.");
        const result=db.prepare("INSERT INTO class_assessments(class_id,title,category,max_score,weight,due_date,description,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(classId,title,category,max,weight,parseDate(b.prazo,"Prazo"),String(b.descricao??"").trim()||null,teacher.id,now());
        return sendJson(response,201,{id:Number(result.lastInsertRowid),titulo:title,categoria:category,notaMaxima:max,peso:weight});
      }
      const gradesRoute=sub.match(/^avaliacoes\/(\d+)\/notas$/);
      if(gradesRoute&&method==="PUT"){
        const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);const assessment=db.prepare("SELECT * FROM class_assessments WHERE id=? AND class_id=?").get(Number(gradesRoute[1]),classId),b=await context.readBody(request);
        if(!assessment)throw new PlatformError(404,"Avaliação não encontrada.");if(!Array.isArray(b.notas))throw new PlatformError(400,"Envie as notas dos alunos.");
        const enrolled=new Set(db.prepare("SELECT student_id FROM class_enrollments WHERE class_id=? AND status='ACTIVE'").all(classId).map(r=>r.student_id));const stamp=now();db.exec("BEGIN");try{for(const row of b.notas){const sid=Number(row.alunoId),score=Number(row.nota);if(!enrolled.has(sid)||!Number.isFinite(score)||score<0||score>assessment.max_score)throw new PlatformError(400,`A nota deve estar entre 0 e ${assessment.max_score} e o aluno deve ter matrícula ativa.`);db.prepare(`INSERT INTO assessment_grades(assessment_id,student_id,score,feedback,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=excluded.score,feedback=excluded.feedback,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(assessment.id,sid,score,String(row.comentario??"").trim()||null,teacher.id,stamp);}db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}return sendJson(response,200,{ok:"Notas registradas."});
      }
      if(sub==="ocorrencias"&&method==="GET"){const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);return sendJson(response,200,db.prepare("SELECT o.*,u.name aluno FROM class_occurrences o JOIN users u ON u.id=o.student_id WHERE o.class_id=? ORDER BY o.occurrence_date DESC,o.id DESC").all(classId).map(o=>({id:o.id,alunoId:o.student_id,aluno:o.aluno,data:o.occurrence_date,tipo:o.kind,descricao:o.description,acompanhamento:o.follow_up,status:o.status})));}
      if(sub==="ocorrencias"&&method==="POST"){const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);const b=await context.readBody(request),studentId=Number(b.alunoId),date=parseDate(b.data,"Data da ocorrência"),kind=String(b.tipo??"").trim().toUpperCase(),description=String(b.descricao??"").trim();if(!db.prepare("SELECT 1 FROM class_enrollments WHERE class_id=? AND student_id=? AND status='ACTIVE'").get(classId,studentId))throw new PlatformError(400,"Selecione um aluno com matrícula ativa nesta turma.");if(!date||!kind||!description)throw new PlatformError(400,"Informe data, tipo e descrição da ocorrência.");const stamp=now(),result=db.prepare("INSERT INTO class_occurrences(class_id,student_id,occurrence_date,kind,description,follow_up,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(classId,studentId,date,kind,description,String(b.acompanhamento??"").trim()||null,teacher.id,stamp,stamp);return sendJson(response,201,{id:Number(result.lastInsertRowid),ok:"Ocorrência registrada."});}
      const occurrenceRoute=sub.match(/^ocorrencias\/(\d+)$/);if(occurrenceRoute&&method==="PUT"){const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);const b=await context.readBody(request),status=String(b.status??"").toUpperCase();if(!["OPEN","RESOLVED"].includes(status))throw new PlatformError(400,"Situação inválida.");const result=db.prepare("UPDATE class_occurrences SET status=?,follow_up=?,updated_at=? WHERE id=? AND class_id=?").run(status,String(b.acompanhamento??"").trim()||null,now(),Number(occurrenceRoute[1]),classId);if(!result.changes)throw new PlatformError(404,"Ocorrência não encontrada.");return sendJson(response,200,{ok:"Acompanhamento atualizado."});}
      if(sub==="relatorio"&&method==="GET"){const teacher=requireUser(request,"PROFESSOR");classForTeacher(classId,teacher);const students=db.prepare("SELECT u.id,u.name FROM class_enrollments e JOIN users u ON u.id=e.student_id WHERE e.class_id=? AND e.status='ACTIVE' ORDER BY u.name").all(classId),assessments=db.prepare("SELECT id,max_score,weight FROM class_assessments WHERE class_id=?").all(classId),sessionCount=db.prepare("SELECT COUNT(*) count FROM class_sessions WHERE class_id=?").get(classId).count;const alunos=students.map(s=>{let sum=0,weight=0;for(const a of assessments){const g=db.prepare("SELECT score FROM assessment_grades WHERE assessment_id=? AND student_id=?").get(a.id,s.id);if(g){sum+=g.score/a.max_score*100*a.weight;weight+=a.weight;}}const attendance=db.prepare("SELECT SUM(status IN ('PRESENT','JUSTIFIED')) attended FROM attendance_records ar JOIN class_sessions cs ON cs.id=ar.session_id WHERE cs.class_id=? AND ar.student_id=?").get(classId,s.id);return {alunoId:s.id,aluno:s.name,mediaPonderada:weight?Math.round(sum/weight*10)/10:null,aulasRegistradas:sessionCount,frequencia:sessionCount?Math.round((attendance.attended||0)/sessionCount*100):null,ocorrencias:db.prepare("SELECT COUNT(*) count FROM class_occurrences WHERE class_id=? AND student_id=?").get(classId,s.id).count};});return sendJson(response,200,{turmaId:classId,avaliacoes:assessments.length,aulas:sessionCount,alunos});}
    }
    if (routeGroup && routeGroup[2] === "planejamentos" && method === "GET") {
      const teacher=requireUser(request,"PROFESSOR"), groupId=Number(routeGroup[1]); groupForTeacher(groupId,teacher);
      return sendJson(response,200,db.prepare("SELECT * FROM group_plans WHERE group_id=? ORDER BY planned_date IS NULL,planned_date,id DESC").all(groupId).map(groupPlanDto));
    }
    if (routeGroup && routeGroup[2] === "planejamentos" && method === "POST") {
      const teacher=requireUser(request,"PROFESSOR"), groupId=Number(routeGroup[1]); groupForTeacher(groupId,teacher); const b=await context.readBody(request), title=String(b.titulo??"").trim();
      if(!title)throw new PlatformError(400,"Informe o título do planejamento."); const planned=parseDate(b.dataPrevista,"Data prevista"), realized=parseDate(b.dataRealizada,"Data realizada"), status=String(b.status??(realized?"COMPLETED":"PLANNED")).toUpperCase();
      if(!["PLANNED","COMPLETED","CANCELED"].includes(status))throw new PlatformError(400,"Situação do planejamento inválida."); const stamp=now(); const r=db.prepare("INSERT INTO group_plans(group_id,professor_id,title,planned_date,objectives,planned_content,methodology,resources,realized_date,realized_content,observations,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(groupId,teacher.id,title,planned,b.objetivos||null,b.conteudoPlanejado||null,b.metodologia||null,b.recursos||null,realized,b.conteudoRealizado||null,b.observacoes||null,status,stamp,stamp); return sendJson(response,201,groupPlanDto(db.prepare("SELECT * FROM group_plans WHERE id=?").get(Number(r.lastInsertRowid))));
    }
    if (routeGroupPlan && method === "PUT") {
      const teacher=requireUser(request,"PROFESSOR"), item=db.prepare("SELECT * FROM group_plans WHERE id=?").get(Number(routeGroupPlan[1])); if(!item)throw new PlatformError(404,"Planejamento não encontrado."); groupForTeacher(item.group_id,teacher); const b=await context.readBody(request), title=String(b.titulo??item.title).trim(), status=String(b.status??item.status).toUpperCase(); if(!title||!["PLANNED","COMPLETED","CANCELED"].includes(status))throw new PlatformError(400,"Revise o título e a situação.");
      db.prepare("UPDATE group_plans SET title=?,planned_date=?,objectives=?,planned_content=?,methodology=?,resources=?,realized_date=?,realized_content=?,observations=?,status=?,updated_at=? WHERE id=?").run(title,parseDate(b.dataPrevista??item.planned_date,"Data prevista"),b.objetivos??item.objectives,b.conteudoPlanejado??item.planned_content,b.metodologia??item.methodology,b.recursos??item.resources,parseDate(b.dataRealizada??item.realized_date,"Data realizada"),b.conteudoRealizado??item.realized_content,b.observacoes??item.observations,status,now(),item.id); return sendJson(response,200,groupPlanDto(db.prepare("SELECT * FROM group_plans WHERE id=?").get(item.id)));
    }
    if (routeGroupPlan && method === "DELETE") { const teacher=requireUser(request,"PROFESSOR"), item=db.prepare("SELECT * FROM group_plans WHERE id=?").get(Number(routeGroupPlan[1])); if(!item)throw new PlatformError(404,"Planejamento não encontrado."); groupForTeacher(item.group_id,teacher); db.prepare("DELETE FROM group_plans WHERE id=?").run(item.id); return sendJson(response,200,{ok:"Planejamento excluído."}); }
    if (routeGroup && method === "GET" && routeGroup[2] === "portal") {
      const user = requireUser(request);
      const groupId = Number(routeGroup[1]);
      const group = findGroup(groupId);
      if (user.perfil === "ALUNO") groupForStudent(groupId, user);
      else groupForTeacher(groupId, user);
      const members = db.prepare(`
        SELECT u.id, u.name, u.email, gm.joined_at, gm.status
        FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ? ORDER BY gm.joined_at
      `).all(groupId).map((member) => ({
        id: member.id, nome: member.name, email: member.email,
        entrouEm: member.joined_at, status: statusLabel(member.status), statusCodigo: member.status
      }));
      const mentors=db.prepare("SELECT u.id,u.name FROM group_mentors gm JOIN users u ON u.id=gm.professor_id WHERE gm.group_id=? ORDER BY u.name").all(groupId).map(m=>({id:m.id,nome:m.name}));
      const notices=db.prepare("SELECT id,title,body,created_at FROM notifications WHERE group_id=? AND kind IN ('NEWS','ANNOUNCEMENT') ORDER BY created_at DESC LIMIT 20").all(groupId).map(n=>({id:n.id,titulo:n.title,texto:n.body,criadoEm:n.created_at}));
      const plans=db.prepare("SELECT id,title,planned_date,objectives,planned_content,status FROM group_plans WHERE group_id=? AND status<>'CANCELED' ORDER BY planned_date IS NULL,planned_date,id DESC").all(groupId).map(p=>({id:p.id,titulo:p.title,dataPrevista:p.planned_date,objetivos:p.objectives,conteudo:p.planned_content,status:p.status}));
      const topics=db.prepare("SELECT t.id,t.title,t.body description,t.updated_at,u.name author,(SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=t.id) responses FROM forum_topics t JOIN users u ON u.id=t.author_id WHERE t.group_id=? ORDER BY t.updated_at DESC LIMIT 30").all(groupId).map(t=>({id:t.id,titulo:t.title,descricao:t.description,atualizadoEm:t.updated_at,autor:t.author,respostas:t.responses}));
      return sendJson(response, 200, {
        ...groupDto(group, user.id),
        membros: user.perfil === "PROFESSOR" ? members : members.filter(m=>m.statusCodigo==="ACTIVE").map(({id,nome})=>({id,nome})),
        orientadores:mentors,avisos:notices,agenda:plans,discussoes:topics,
        planejamentos: user.perfil === "PROFESSOR" ? db.prepare("SELECT * FROM group_plans WHERE group_id=? ORDER BY planned_date IS NULL,planned_date,id DESC").all(groupId).map(groupPlanDto) : [],
        materiais: contentItems("materials", groupId),
        videos: contentItems("videos", groupId),
        atividades: db.prepare("SELECT * FROM assignments WHERE group_id = ? ORDER BY due_date")
          .all(groupId).map((item) => assignmentDto(item, user)),
        projetos: db.prepare("SELECT * FROM projects WHERE group_id = ? ORDER BY end_date")
          .all(groupId).map((project) => projectDto(project, user))
      });
    }

    if (pathname === "/api/inscricoes" && method === "GET") {
      const student=requireUser(request,"ALUNO");
      const rows=db.prepare(`SELECT g.*,u.name professor_name,gm.status participacao_status,gm.joined_at
        FROM group_members gm JOIN groups g ON g.id=gm.group_id JOIN users u ON u.id=g.professor_id
        WHERE gm.user_id=? ORDER BY gm.joined_at DESC`).all(student.id);
      return sendJson(response,200,rows.map(group=>({...groupDto(group,student.id),solicitacaoStatus:group.participacao_status,solicitadaEm:group.joined_at})));
    }
    if (pathname === "/api/grupos" && method === "GET") {
      const user = requireUser(request);
      const mine = url.searchParams.get("meus") === "1";
      const rows = db.prepare(`
        SELECT g.*, u.name AS professor_name FROM groups g
        JOIN users u ON u.id = g.professor_id
        WHERE (? = 0 OR EXISTS (SELECT 1 FROM group_mentors mt WHERE mt.group_id=g.id AND mt.professor_id=?) OR EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?
            AND gm.status IN ('ACTIVE','PENDING')
        ))
        ORDER BY g.created_at DESC
      `).all(mine ? 1 : 0, user.perfil === "PROFESSOR" ? user.id : -1, user.id);
      return sendJson(response, 200, rows.map((group) => groupDto(group, user.id)));
    }
    if (pathname === "/api/grupos" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const body = await context.readBody(request);
      const name = String(body.nome ?? "").trim();
      if (!name) throw new PlatformError(400, "O nome do grupo é obrigatório.");
      const max = body.limiteAlunos == null || body.limiteAlunos === "" ? MAX_GROUP_SIZE : Number(body.limiteAlunos);
      const minimum = body.minimoAlunos == null || body.minimoAlunos === "" ? DEFAULT_GROUP_MIN : Number(body.minimoAlunos);
      const semester = body.semestre == null || body.semestre === "" ? null : Number(body.semestre);
      if (!Number.isInteger(max) || max < 1 || max > MAX_GROUP_SIZE ||
          !Number.isInteger(minimum) || minimum < 1 || minimum > max ||
          (semester !== null && (!Number.isInteger(semester) || semester < 1 || semester > 6))) {
        throw new PlatformError(400, "O grupo deve aceitar de 1 a 20 alunos; o mínimo para projetos deve caber no limite.");
      }
      const startDate = parseDate(body.dataInicio, "Data de início");
      const endDate = parseDate(body.dataTermino, "Data de término");
      if (startDate && endDate && startDate > endDate) {
        throw new PlatformError(400, "A data final deve ser posterior à data inicial.");
      }
      const result = db.prepare(`
        INSERT INTO groups (name, description, subject, semester, professor_id, created_at, max_students, status,
          start_date, end_date, min_members, theme, objectives, methodology, level, modality, meeting_schedule, participation_rules)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, String(body.descricao ?? "").trim() || null,
        String(body.disciplina ?? "").trim() || null,
        semester,
        teacher.id, now(),
        max, startDate, endDate, minimum, String(body.tema??"").trim()||null, String(body.objetivos??"").trim()||null,
        String(body.metodologia??"").trim()||null, String(body.nivel??"").trim()||null, String(body.modalidade??"").trim()||null,
        String(body.horarioEncontros??"").trim()||null, String(body.regrasParticipacao??"").trim()||null);
      db.prepare("INSERT INTO group_mentors(group_id,professor_id,created_at) VALUES(?,?,?)").run(Number(result.lastInsertRowid),teacher.id,now());
      return sendJson(response, 201, groupDto(findGroup(Number(result.lastInsertRowid)), teacher.id));
    }
    if (routeGroup && routeGroup[2] === "participar" && method === "POST") {
      const student = requireUser(request, "ALUNO");
      const groupId = Number(routeGroup[1]);
      const group = findGroup(groupId);
      const existing=db.prepare("SELECT status FROM group_members WHERE group_id=? AND user_id=?").get(groupId,student.id);
      if (existing?.status === "ACTIVE" || existing?.status === "PENDING") {
        return sendJson(response, 200, groupDto(group, student.id));
      }
      setGroupCapacityStatus(db, groupId);
      const latestGroup = findGroup(groupId);
      if (latestGroup.status === "CLOSED") throw new PlatformError(409, "Este grupo está encerrado.");
      if (latestGroup.status === "COMPLETE") throw new PlatformError(409, "Grupo Completo: não há vagas disponíveis.");
      const occupied=db.prepare("SELECT COUNT(*) count FROM group_members WHERE group_id=? AND status IN ('ACTIVE','PENDING')").get(groupId).count;
      if(occupied>=latestGroup.max_students)throw new PlatformError(409,"Não há vagas livres; solicitações atuais aguardam análise.");
      const studentRecord = db.prepare("SELECT semester FROM users WHERE id = ?").get(student.id);
      if (latestGroup.semester && studentRecord.semester !== latestGroup.semester) {
        throw new PlatformError(403, "Este grupo aceita apenas alunos matriculados no semestre correspondente.");
      }
      db.prepare(`
        INSERT INTO group_members (group_id, user_id, joined_at, status)
        VALUES (?, ?, ?, 'PENDING')
        ON CONFLICT(group_id, user_id) DO UPDATE SET
          joined_at = excluded.joined_at, status = 'PENDING'
      `).run(groupId, student.id, now());
      const stamp=now();
      db.prepare(`INSERT INTO notifications(group_id,author_id,user_id,kind,title,body,created_at)
        SELECT ?, ?, professor_id, 'GROUP_REQUEST', 'Nova solicitacao de participacao', ?, ? FROM group_mentors WHERE group_id=?`)
        .run(groupId,student.id,`${student.nome} solicitou participacao no grupo ${latestGroup.name}.`,stamp,groupId);
      return sendJson(response, 200, groupDto(findGroup(groupId), student.id));
    }
    if(routeGroup&&routeGroup[2]==="participar"&&method==="DELETE"){
      const student=requireUser(request,"ALUNO"),groupId=Number(routeGroup[1]);findGroup(groupId);
      const result=db.prepare("UPDATE group_members SET status='CANCELLED' WHERE group_id=? AND user_id=? AND status='PENDING'").run(groupId,student.id);
      if(!result.changes)throw new PlatformError(409,"Não há solicitacao pendente para cancelar.");
      return sendJson(response,200,groupDto(findGroup(groupId),student.id));
    }
    const requestDecision=routeGroup?.[2]?.match(/^solicitacoes\/(\d+)$/);
    if(requestDecision&&method==="PUT"){
      const teacher=requireUser(request,"PROFESSOR"),groupId=Number(routeGroup[1]),studentId=Number(requestDecision[1]);groupForTeacher(groupId,teacher);
      const body=await context.readBody(request),decision=String(body.status??"").toUpperCase();
      if(!["APPROVED","REJECTED"].includes(decision))throw new PlatformError(400,"Escolha aprovar ou recusar a solicitacao.");
      if(!db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND status='PENDING'").get(groupId,studentId))throw new PlatformError(404,"Solicitacao pendente nao encontrada.");
      if(decision==="APPROVED"&&participantCount(db,groupId)>=findGroup(groupId).max_students)throw new PlatformError(409,"O grupo atingiu o limite de participantes.");
      const status=decision==="APPROVED"?"ACTIVE":"REJECTED";db.prepare("UPDATE group_members SET status=? WHERE group_id=? AND user_id=?").run(status,groupId,studentId);setGroupCapacityStatus(db,groupId);
      const groupName=findGroup(groupId).name,title=decision==="APPROVED"?"Solicitacao aprovada":"Solicitacao recusada",message=decision==="APPROVED"?`Sua participacao em ${groupName} foi aprovada.`:`Sua solicitacao para ${groupName} nao foi aprovada.`;
      db.prepare("INSERT INTO notifications(group_id,author_id,user_id,kind,title,body,created_at) VALUES(?,?,?,?,?,?,?)").run(groupId,teacher.id,studentId,`GROUP_${decision}`,title,message,now());
      return sendJson(response,200,{ok:title,status});
    }
    const memberSubmissionsRoute = pathname.match(/^\/api\/grupos\/(\d+)\/membros\/(\d+)\/entregas$/);
    if (memberSubmissionsRoute && method === "GET") {
      const teacher = requireUser(request, "PROFESSOR");
      const groupId = Number(memberSubmissionsRoute[1]);
      const studentId = Number(memberSubmissionsRoute[2]);
      groupForTeacher(groupId, teacher);
      if (!db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?").get(groupId, studentId)) {
        throw new PlatformError(404, "Integrante não encontrado neste grupo.");
      }
      const rows = db.prepare(`
        SELECT s.*, u.name AS student_name, u.email AS student_email,
          COALESCE(a.title, p.name, old.title) AS item_title,
          g.name AS group_name
        FROM submissions s JOIN users u ON u.id=s.student_id
        LEFT JOIN assignments a ON a.id=s.assignment_id
        LEFT JOIN projects p ON p.id=s.project_id
        LEFT JOIN activities old ON old.id=s.activity_id
        JOIN groups g ON g.id=?
        WHERE s.student_id=? AND
          COALESCE(a.group_id, p.group_id, old.group_id)=?
        ORDER BY s.submitted_at DESC
      `).all(groupId, studentId, groupId);
      return sendJson(response, 200, submissionRows(rows));
    }
    if (routeGroup && routeGroup[2] === "sair" && method === "POST") {
      const student = requireUser(request, "ALUNO");
      const groupId = Number(routeGroup[1]);
      findGroup(groupId);
      db.prepare(`
        UPDATE group_members SET status = 'LEFT' WHERE group_id = ? AND user_id = ? AND status = 'ACTIVE'
      `).run(groupId, student.id);
      db.prepare("DELETE FROM group_participants WHERE group_id = ? AND user_id = ?")
        .run(groupId, student.id);
      setGroupCapacityStatus(db, groupId);
      return sendJson(response, 200, groupDto(findGroup(groupId), student.id));
    }
    if (routeGroup && routeGroup[2]?.startsWith("membros/") && method === "DELETE") {
      const teacher = requireUser(request, "PROFESSOR");
      const groupId = Number(routeGroup[1]);
      groupForTeacher(groupId, teacher);
      const memberId = Number(routeGroup[2].slice("membros/".length));
      db.prepare(`
        UPDATE group_members SET status = 'REMOVED' WHERE group_id = ? AND user_id = ?
      `).run(groupId, memberId);
      db.prepare("DELETE FROM group_participants WHERE group_id = ? AND user_id = ?")
        .run(groupId, memberId);
      setGroupCapacityStatus(db, groupId);
      return sendJson(response, 200, { ok: "Participante removido." });
    }
    if (routeGroup && routeGroup[2] === "encerrar" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const groupId = Number(routeGroup[1]);
      groupForTeacher(groupId, teacher);
      db.prepare("UPDATE groups SET status = 'CLOSED' WHERE id = ?").run(groupId);
      return sendJson(response, 200, groupDto(findGroup(groupId), teacher.id));
    }
    if (routeGroup && !routeGroup[2] && method === "GET") {
      const user = requireUser(request);
      return sendJson(response, 200, groupDto(findGroup(Number(routeGroup[1])), user.id));
    }
    if (routeGroup && !routeGroup[2] && method === "PUT") {
      const teacher = requireUser(request, "PROFESSOR");
      const groupId = Number(routeGroup[1]);
      const group = groupForTeacher(groupId, teacher);
      const body = await context.readBody(request);
      const name = String(body.nome ?? "").trim();
      if (!name) throw new PlatformError(400, "O nome do grupo é obrigatório.");
      const max = body.limiteAlunos == null || body.limiteAlunos === ""
        ? group.max_students : Number(body.limiteAlunos);
      const minimum = body.minimoAlunos == null || body.minimoAlunos === ""
        ? group.min_members ?? DEFAULT_GROUP_MIN : Number(body.minimoAlunos);
      const semester = body.semestre == null || body.semestre === "" ? group.semester : Number(body.semestre);
      if (!Number.isInteger(max) || max < participantCount(db, groupId) || max > MAX_GROUP_SIZE ||
          !Number.isInteger(minimum) || minimum < 1 || minimum > max ||
          (semester !== null && (!Number.isInteger(semester) || semester < 1 || semester > 6))) {
        throw new PlatformError(400, "O limite precisa ser de 1 a 20 e não pode ser menor que as vagas já ocupadas.");
      }
      const startDate = parseDate(body.dataInicio ?? group.start_date, "Data de início");
      const endDate = parseDate(body.dataTermino ?? group.end_date, "Data de término");
      if (startDate && endDate && startDate > endDate) {
        throw new PlatformError(400, "A data final deve ser posterior à data inicial.");
      }
      db.prepare(`
        UPDATE groups SET name = ?, description = ?, subject = ?, semester = ?, max_students = ?,
          min_members = ?, start_date = ?, end_date = ?, theme=?, objectives=?, methodology=?, level=?, modality=?, meeting_schedule=?, participation_rules=? WHERE id = ?
      `).run(name, String(body.descricao ?? "").trim() || null,
        String(body.disciplina ?? "").trim() || null,
        semester,
        max, minimum, startDate, endDate, String(body.tema??group.theme??"").trim()||null, String(body.objetivos??group.objectives??"").trim()||null, String(body.metodologia??group.methodology??"").trim()||null, String(body.nivel??group.level??"").trim()||null, String(body.modalidade??group.modality??"").trim()||null, String(body.horarioEncontros??group.meeting_schedule??"").trim()||null, String(body.regrasParticipacao??group.participation_rules??"").trim()||null, groupId);
      setGroupCapacityStatus(db, groupId);
      return sendJson(response, 200, groupDto(findGroup(groupId), teacher.id));
    }
    if (routeGroup && !routeGroup[2] && method === "DELETE") {
      const teacher = requireUser(request, "PROFESSOR");
      const groupId = Number(routeGroup[1]);
      groupForTeacher(groupId, teacher);
      db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
      return sendJson(response, 200, { ok: "Grupo excluído." });
    }

    if (pathname === "/api/tarefas" && method === "GET") {
      const user = requireUser(request);
      const type = url.searchParams.get("tipo")?.toUpperCase();
      if (type && !["TASK", "EXERCISE", "WORK"].includes(type)) {
        throw new PlatformError(400, "Tipo de tarefa inválido.");
      }
      const rows = db.prepare(`
        SELECT a.* FROM assignments a
        WHERE (? IS NULL OR a.kind = ?) AND (
          (? = 'PROFESSOR' AND (a.professor_id = ? OR
            (a.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM group_mentors mt WHERE mt.group_id=a.group_id AND mt.professor_id=?)) OR
            (a.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id=a.class_id AND ct.professor_id=?)))) OR
          (? = 'ALUNO' AND (a.group_id IS NULL AND a.class_id IS NULL OR EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = a.group_id
              AND gm.user_id = ? AND gm.status = 'ACTIVE'
          ) OR EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id=a.class_id AND ce.student_id=? AND ce.status='ACTIVE')))
        ) ORDER BY a.due_date IS NULL, a.due_date, a.created_at DESC
      `).all(type ?? null, type ?? null, user.perfil, user.id, user.id, user.id, user.perfil, user.id, user.id);
      return sendJson(response, 200, rows.map((row) => assignmentDto(row, user)));
    }
    if (pathname === "/api/tarefas" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const body = assignmentBody(await context.readBody(request), teacher);
      db.exec("BEGIN");
      try {
        const result = db.prepare(`
          INSERT INTO assignments
            (title, description, kind, professor_id, group_id, class_id, due_date, expected_submissions, assignment_mode, team_size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(body.title, body.description, body.kind, teacher.id, body.groupId, body.classId,
          body.dueDate, body.expected, body.assignmentMode, body.teamSize, now());
        const id = Number(result.lastInsertRowid);
        db.prepare(`
          INSERT INTO activities (id, title, instructions, subject, deadline, professor_id, group_id, class_id, kind, expected_submissions, assignment_mode, team_size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, body.title, body.description,
          body.groupId ? findGroup(body.groupId).subject : body.classId ? db.prepare("SELECT s.name FROM classes c JOIN subjects s ON s.id=c.subject_id WHERE c.id=?").get(body.classId)?.name : null, body.dueDate,
          teacher.id, body.groupId, body.classId, body.kind, body.expected, body.assignmentMode, body.teamSize);
        db.exec("COMMIT");
        if (body.groupId) {
          db.prepare(`
            INSERT INTO notifications (group_id, author_id, kind, title, body, created_at)
            VALUES (?, ?, 'ASSIGNMENT', ?, ?, ?)
          `).run(body.groupId, teacher.id, "Nova atividade", body.title, now());
        }
        return sendJson(response, 201, assignmentDto(assignmentById(id), teacher));
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    const assignmentRoute = pathname.match(/^\/api\/tarefas\/(\d+)$/);
    if (assignmentRoute && method === "DELETE") {
      const teacher = requireUser(request, "PROFESSOR");
      const item = assignmentById(Number(assignmentRoute[1]));
      assertTeachingAssignment(item, teacher);
      db.prepare("DELETE FROM assignments WHERE id = ?").run(item.id);
      db.prepare("DELETE FROM activities WHERE id = ?").run(item.id);
      return sendJson(response, 200, { ok: "Tarefa excluída." });
    }

    if (pathname === "/api/atividades" && method === "GET") {
      const user = requireUser(request);
      const rows = db.prepare(`
        SELECT a.* FROM assignments a
        WHERE (? = 'PROFESSOR' AND a.professor_id = ?) OR
          (? = 'ALUNO' AND (a.group_id IS NULL OR EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = a.group_id
              AND gm.user_id = ? AND gm.status = 'ACTIVE'
          )))
        ORDER BY a.id
      `).all(user.perfil, user.id, user.perfil, user.id);
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id, titulo: row.title, instrucoes: row.description,
        disciplina: row.group_id ? findGroup(row.group_id).subject : null,
        prazo: row.due_date,
        professor: db.prepare("SELECT name FROM users WHERE id=?").get(row.professor_id).name,
        entregue: Boolean(user.perfil === "ALUNO" && db.prepare(`
          SELECT 1 FROM submissions
          WHERE (assignment_id = ? OR activity_id = ?) AND student_id = ?
        `).get(row.id, row.id, user.id))
      })));
    }
    if (pathname === "/api/atividades" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const body = await context.readBody(request);
      const data = assignmentBody({
        ...body,
        tipo: body.tipo ?? "TASK"
      }, teacher);
      db.exec("BEGIN");
      try {
        const result = db.prepare(`
          INSERT INTO assignments (title, description, kind, professor_id, group_id, due_date, expected_submissions, assignment_mode, team_size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(data.title, data.description, data.kind, teacher.id, data.groupId,
          data.dueDate, data.expected, data.assignmentMode, data.teamSize, now());
        const id = Number(result.lastInsertRowid);
        db.prepare(`
          INSERT INTO activities (id, title, instructions, subject, deadline, professor_id, group_id, kind, expected_submissions, assignment_mode, team_size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.title, data.description, data.groupId ? findGroup(data.groupId).subject : null,
          data.dueDate, teacher.id, data.groupId, data.kind, data.expected, data.assignmentMode, data.teamSize);
        db.exec("COMMIT");
        return sendJson(response, 201, {
          id, titulo: data.title, instrucoes: data.description,
          disciplina: data.groupId ? findGroup(data.groupId).subject : null,
          prazo: data.dueDate, professor: teacher.nome, entregue: false
        });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    const legacyActivitySubmissions = pathname.match(/^\/api\/atividades\/(\d+)\/entregas$/);
    if (legacyActivitySubmissions && method === "POST") {
      const student = requireUser(request, "ALUNO");
      const activityId = Number(legacyActivitySubmissions[1]);
      const item = assignmentById(activityId);
      if (!(request.headers["content-type"] ?? "").includes("multipart/form-data")) {
        const body = await context.readBody(request);
        const filename = safeFilename(String(body.nomeArquivo ?? "").trim());
        if (!filename || filename === "arquivo") {
          throw new PlatformError(400, "O nome do arquivo é obrigatório.");
        }
        if (item.group_id) groupForStudent(item.group_id, student);
        if (db.prepare(`
          SELECT 1 FROM submissions
          WHERE (assignment_id=? OR activity_id=?) AND student_id=?
        `).get(item.id, item.id, student.id)) {
          throw new PlatformError(409, "Você já entregou esta atividade.");
        }
        const submittedAt = now();
        const comment = String(body.comentario ?? "").trim() || null;
        const result = db.prepare(`
          INSERT INTO submissions
            (activity_id, assignment_id, student_id, comment, file_name, submitted_at, status, version)
          VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', 1)
        `).run(item.id, item.id, student.id, comment, filename, submittedAt);
        const submissionId = Number(result.lastInsertRowid);
        db.prepare(`
          INSERT INTO submission_versions (submission_id, version, file_name, comment, submitted_at, status)
          VALUES (?, 1, ?, ?, ?, 'SUBMITTED')
        `).run(submissionId, filename, comment, submittedAt);
        return sendJson(response, 201, {
          id: submissionId, atividadeId: item.id, aluno: student.nome,
          comentario: comment, nomeArquivo: filename, enviadaEm: submittedAt
        });
      }
      const result = await createUploadSubmission(request, student, "assignment", item.id);
      return sendJson(response, 201, {
        id: result.id, atividadeId: item.id, aluno: student.nome,
        nomeArquivo: result.nomeArquivo, enviadaEm: result.enviadaEm, versao: result.versao
      });
    }
    if (legacyActivitySubmissions && method === "GET") {
      const teacher = requireUser(request, "PROFESSOR");
      const item = assignmentById(Number(legacyActivitySubmissions[1]));
      assertTeachingAssignment(item, teacher);
      return sendJson(response, 200, getAssignmentSubmissions(db, item.id));
    }

    if (pathname === "/api/projetos" && method === "GET") {
      const user = requireUser(request);
      const rows = db.prepare(`
        SELECT p.* FROM projects p
        WHERE (? = 'PROFESSOR' AND (p.professor_id = ? OR EXISTS (
          SELECT 1 FROM group_mentors mt WHERE mt.group_id=p.group_id AND mt.professor_id=?
        ))) OR
          (? = 'ALUNO' AND EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = p.group_id
              AND gm.user_id = ? AND gm.status = 'ACTIVE'
          ))
        ORDER BY p.end_date, p.created_at DESC
      `).all(user.perfil, user.id, user.id, user.perfil, user.id);
      return sendJson(response, 200, rows.map((row) => projectDto(row, user)));
    }
    if (pathname === "/api/projetos" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const body = await context.readBody(request);
      const name = String(body.nome ?? "").trim();
      const groupId = Number(body.grupoId);
      if (!name || !Number.isInteger(groupId)) throw new PlatformError(400, "Informe o nome do projeto e seu grupo.");
      groupForTeacher(groupId, teacher);
      const startDate = parseDate(body.dataInicio, "Data de início");
      const endDate = parseDate(body.dataFinal, "Data final");
      if (!startDate || !endDate || startDate > endDate) {
        throw new PlatformError(400, "Informe datas válidas e uma data final posterior à inicial.");
      }
      const expected = body.entregasEsperadas == null || body.entregasEsperadas === ""
        ? null : Number(body.entregasEsperadas);
      if (expected !== null && (!Number.isInteger(expected) || expected < 1 || expected > 10000)) {
        throw new PlatformError(400, "A quantidade esperada deve ser entre 1 e 10.000.");
      }
      const result = db.prepare(`
        INSERT INTO projects
          (name, description, professor_id, group_id, start_date, end_date,
           evaluation_criteria, expected_submissions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, String(body.descricao ?? "").trim() || null, teacher.id,
        groupId, startDate, endDate, String(body.criterios ?? "").trim() || null, expected, now());
      db.prepare(`
        INSERT INTO notifications (group_id, author_id, kind, title, body, created_at)
        VALUES (?, ?, 'PROJECT', ?, ?, ?)
      `).run(groupId, teacher.id, "Novo projeto", name, now());
      return sendJson(response, 201, projectDto(projectById(Number(result.lastInsertRowid)), teacher));
    }
    const projectRoute = pathname.match(/^\/api\/projetos\/(\d+)$/);
    if (projectRoute && method === "PUT") {
      const teacher = requireUser(request, "PROFESSOR");
      const project = projectById(Number(projectRoute[1]));
      if (project.professor_id !== teacher.id) groupForTeacher(project.group_id, teacher);
      const body = await context.readBody(request);
      const name = String(body.nome ?? "").trim();
      const startDate = parseDate(body.dataInicio, "Data de início");
      const endDate = parseDate(body.dataFinal, "Data final");
      if (!name || !startDate || !endDate || startDate > endDate) {
        throw new PlatformError(400, "Informe nome e datas válidas para o projeto.");
      }
      db.prepare(`
        UPDATE projects SET name=?, description=?, start_date=?, end_date=?, evaluation_criteria=? WHERE id=?
      `).run(name, String(body.descricao ?? "").trim() || null, startDate, endDate,
        String(body.criterios ?? "").trim() || null, project.id);
      return sendJson(response, 200, projectDto(projectById(project.id), teacher));
    }
    if (projectRoute && method === "DELETE") {
      const teacher = requireUser(request, "PROFESSOR");
      const project = projectById(Number(projectRoute[1]));
      if (project.professor_id !== teacher.id) groupForTeacher(project.group_id, teacher);
      db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
      return sendJson(response, 200, { ok: "Projeto excluído." });
    }

    if (pathname === "/api/materiais" && method === "GET") {
      const user = requireUser(request);
      const rows = db.prepare(`
        SELECT m.*, g.name AS group_name, u.name AS professor_name FROM materials m
        JOIN groups g ON g.id = m.group_id JOIN users u ON u.id = m.professor_id
        WHERE (? = 'PROFESSOR' AND (m.professor_id = ? OR EXISTS (
            SELECT 1 FROM group_mentors mt WHERE mt.group_id=m.group_id AND mt.professor_id=?
          ))) OR
          (? = 'ALUNO' AND EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = m.group_id
              AND gm.user_id = ? AND gm.status = 'ACTIVE'
          ))
        ORDER BY m.created_at DESC
      `).all(user.perfil, user.id, user.id, user.perfil, user.id);
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id, grupoId: row.group_id, grupo: row.group_name, titulo: row.title,
        descricao: row.description, tipo: row.material_type, url: row.external_url,
        arquivoId: row.file_id,
        nomeArquivo: row.file_id ? db.prepare("SELECT original_name FROM files WHERE id=?").get(row.file_id)?.original_name : null,
        professor: row.professor_name, criadoEm: row.created_at
      })));
    }
    if (pathname === "/api/materiais" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const contentType = request.headers["content-type"] ?? "";
      const multipart = contentType.includes("multipart/form-data");
      const data = multipart ? await readMultipart(request, REGULAR_UPLOAD_LIMIT) : null;
      const body = data?.fields ?? await context.readBody(request);
      const groupId = Number(body.grupoId);
      const title = String(body.titulo ?? "").trim();
      if (!Number.isInteger(groupId) || !title) throw new PlatformError(400, "Informe o grupo e o título do material.");
      groupForTeacher(groupId, teacher);
      let fileId = null;
      let link = null;
      let type;
      if (data?.file) {
        fileId = await saveFile(data.file, teacher.id);
        type = "FILE";
      } else {
        link = externalUrl(String(body.url ?? ""));
        type = "LINK";
      }
      try {
        const result = db.prepare(`
          INSERT INTO materials (group_id, professor_id, title, description, material_type, external_url, file_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(groupId, teacher.id, title, String(body.descricao ?? "").trim() || null,
          type, link, fileId, now());
        return sendJson(response, 201, { id: Number(result.lastInsertRowid), titulo: title, tipo: type });
      } catch (error) {
        if (fileId) await removeStoredFile(fileId);
        throw error;
      }
    }

    if (pathname === "/api/videos" && method === "GET") {
      const user = requireUser(request);
      const rows = db.prepare(`
        SELECT v.*, g.name AS group_name, u.name AS professor_name FROM videos v
        JOIN groups g ON g.id=v.group_id JOIN users u ON u.id=v.professor_id
        WHERE (?='PROFESSOR' AND (v.professor_id=? OR EXISTS (
          SELECT 1 FROM group_mentors mt WHERE mt.group_id=v.group_id AND mt.professor_id=?
        ))) OR
          (?='ALUNO' AND EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id=v.group_id
              AND gm.user_id=? AND gm.status='ACTIVE'
          )) ORDER BY v.created_at DESC
      `).all(user.perfil, user.id, user.id, user.perfil, user.id);
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id, grupoId: row.group_id, grupo: row.group_name, titulo: row.title,
        descricao: row.description, tipo: row.video_type, url: row.external_url,
        arquivoId: row.file_id,
        nomeArquivo: row.file_id ? db.prepare("SELECT original_name FROM files WHERE id=?").get(row.file_id)?.original_name : null,
        professor: row.professor_name, criadoEm: row.created_at
      })));
    }
    if (pathname === "/api/videos" && method === "POST") {
      const teacher = requireUser(request, "PROFESSOR");
      const contentType = request.headers["content-type"] ?? "";
      const multipart = contentType.includes("multipart/form-data");
      const data = multipart ? await readMultipart(request, VIDEO_UPLOAD_LIMIT) : null;
      const body = data?.fields ?? await context.readBody(request);
      const groupId = Number(body.grupoId);
      const title = String(body.titulo ?? "").trim();
      if (!Number.isInteger(groupId) || !title) throw new PlatformError(400, "Informe o grupo e o título do vídeo.");
      groupForTeacher(groupId, teacher);
      let fileId = null;
      let link = null;
      let type;
      const uploadedFile = data?.file?.filename && data.file.data.length ? data.file : null;
      if (uploadedFile) {
        fileId = await saveFile(uploadedFile, teacher.id, true);
        type = "UPLOAD";
      } else {
        link = externalUrl(String(body.url ?? ""));
        type = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(new URL(link).hostname) ? "YOUTUBE" : "STREAM";
      }
      try {
        const result = db.prepare(`
          INSERT INTO videos (group_id, professor_id, title, description, video_type, external_url, file_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(groupId, teacher.id, title, String(body.descricao ?? "").trim() || null, type, link, fileId, now());
        return sendJson(response, 201, { id: Number(result.lastInsertRowid), titulo: title, tipo: type });
      } catch (error) {
        if (fileId) await removeStoredFile(fileId);
        throw error;
      }
    }

    if (pathname === "/api/entregaveis/meus" && method === "GET") {
      const student = requireUser(request, "ALUNO");
      const rows = db.prepare(`
        SELECT s.*, u.name AS student_name, u.email AS student_email,
          COALESCE(a.title, p.name, old.title) AS item_title,
          COALESCE(g.name, pg.name, oldg.name) AS group_name
        FROM submissions s JOIN users u ON u.id=s.student_id
        LEFT JOIN assignments a ON a.id=s.assignment_id
        LEFT JOIN projects p ON p.id=s.project_id
        LEFT JOIN activities old ON old.id=s.activity_id
        LEFT JOIN groups g ON g.id=a.group_id
        LEFT JOIN groups pg ON pg.id=p.group_id
        LEFT JOIN groups oldg ON oldg.id=old.group_id
        WHERE s.student_id=? ORDER BY s.submitted_at DESC
      `).all(student.id);
      return sendJson(response, 200, submissionRows(rows));
    }
    if (pathname === "/api/entregaveis" && method === "GET") {
      const teacher = requireUser(request, "PROFESSOR");
      return sendJson(response, 200, getTeacherSubmissions(db, teacher.id));
    }
    const submitRoute = pathname.match(/^\/api\/entregaveis\/(tarefa|projeto)\/(\d+)$/);
    if (submitRoute && method === "POST") {
      const student = requireUser(request, "ALUNO");
      const kind = submitRoute[1] === "projeto" ? "project" : "assignment";
      const result = await createUploadSubmission(request, student, kind, Number(submitRoute[2]));
      return sendJson(response, 201, result);
    }
    const reviewRoute = pathname.match(/^\/api\/entregaveis\/(\d+)\/correcao$/);
    const versionsRoute = pathname.match(/^\/api\/entregaveis\/(\d+)\/versoes$/);
    if (versionsRoute && method === "GET") {
      const user = requireUser(request);
      const submission = db.prepare("SELECT * FROM submissions WHERE id=?").get(Number(versionsRoute[1]));
      if (!submission) throw new PlatformError(404, "Entrega não encontrada.");
      const item = submission.project_id
        ? projectById(submission.project_id)
        : assignmentById(submission.assignment_id ?? submission.activity_id);
      if (user.perfil === "ALUNO" && submission.student_id !== user.id) {
        throw new PlatformError(403, "Você não tem acesso a este histórico.");
      }
      if (user.perfil === "PROFESSOR" && item.professor_id !== user.id) {
        assertTeachingAssignment(item, user);
      }
      const versions = db.prepare(`
        SELECT * FROM submission_versions WHERE submission_id=? ORDER BY version DESC
      `).all(submission.id).map((version) => ({
        versao: version.version,
        arquivoId: version.file_id,
        nomeArquivo: version.file_name,
        comentario: version.comment,
        enviadaEm: version.submitted_at,
        status: statusLabel(version.status),
        statusCodigo: version.status,
        feedback: version.feedback,
        nota: version.grade
      }));
      return sendJson(response, 200, versions);
    }
    if (reviewRoute && method === "PATCH") {
      const teacher = requireUser(request, "PROFESSOR");
      const body = await context.readBody(request);
      const submissionId = Number(reviewRoute[1]);
      const submission = db.prepare("SELECT * FROM submissions WHERE id=?").get(submissionId);
      if (!submission) throw new PlatformError(404, "Entrega não encontrada.");
      let item;
      if (submission.project_id) item = projectById(submission.project_id);
      else item = assignmentById(submission.assignment_id ?? submission.activity_id);
      if (item.professor_id !== teacher.id) assertTeachingAssignment(item, teacher);
      const status = String(body.status ?? "").toUpperCase();
      if (!["IN_REVIEW", "APPROVED", "REJECTED", "RESUBMIT"].includes(status)) {
        throw new PlatformError(400, "Status de correção inválido.");
      }
      const grade = body.nota == null || body.nota === "" ? null : Number(body.nota);
      if (grade !== null && (!Number.isFinite(grade) || grade < 0 || grade > 100)) {
        throw new PlatformError(400, "A nota deve estar entre 0 e 100.");
      }
      const feedback = String(body.comentario ?? "").trim() || null;
      const reviewedAt = now();
      db.prepare(`
        UPDATE submissions SET status=?, feedback=?, grade=?, reviewed_by=?, reviewed_at=? WHERE id=?
      `).run(status, feedback, grade, teacher.id, reviewedAt, submissionId);
      db.prepare("UPDATE submission_versions SET status=?, feedback=? WHERE submission_id=? AND version=?")
        .run(status, feedback, submissionId, submission.version);
      db.prepare("UPDATE submission_versions SET grade=? WHERE submission_id=? AND version=?")
        .run(grade, submissionId, submission.version);
      db.prepare(`
        INSERT INTO grades (submission_id, grader_id, grade, status, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(submissionId, teacher.id, grade, status, feedback, reviewedAt);
      db.prepare(`
        INSERT INTO notifications (group_id, author_id, user_id, kind, title, body, created_at)
        VALUES (?, ?, ?, 'REVIEW', ?, ?, ?)
      `).run(item.group_id ?? null, teacher.id, submission.student_id,
        `Entrega ${statusLabel(status).toLowerCase()}`,
        feedback || "Seu professor atualizou o status da entrega.", reviewedAt);
      return sendJson(response, 200, {
        id: submissionId, status: statusLabel(status), statusCodigo: status,
        feedback, nota: grade, revisadaEm: reviewedAt
      });
    }

    const fileRoute = pathname.match(/^\/api\/arquivos\/(\d+)$/);
    if (fileRoute && method === "GET") {
      const user = requireUser(request);
      const file = db.prepare("SELECT * FROM files WHERE id=?").get(Number(fileRoute[1]));
      if (!file) throw new PlatformError(404, "Arquivo não encontrado.");
      const submission = db.prepare(`
        SELECT s.*, COALESCE(a.professor_id,p.professor_id,old.professor_id) AS professor_id,
          COALESCE(a.group_id,p.group_id,old.group_id) AS group_id
        FROM submissions s
        LEFT JOIN assignments a ON a.id=s.assignment_id
        LEFT JOIN projects p ON p.id=s.project_id
        LEFT JOIN activities old ON old.id=s.activity_id
        WHERE s.file_id=? OR EXISTS (
          SELECT 1 FROM submission_versions sv
          WHERE sv.submission_id=s.id AND sv.file_id=?
        ) LIMIT 1
      `).get(file.id, file.id);
      const content = submission
        ? user.id === submission.student_id ||
          (user.perfil === "PROFESSOR" && submission.professor_id === user.id)
        : (() => {
            const contentRow = db.prepare(`
              SELECT group_id, NULL AS class_id, professor_id, 0 AS global_access FROM materials WHERE file_id=?
              UNION ALL SELECT group_id, NULL AS class_id, professor_id, 0 AS global_access FROM videos WHERE file_id=?
              UNION ALL SELECT group_id, class_id, owner_id AS professor_id, (group_id IS NULL AND class_id IS NULL) AS global_access FROM institutional_documents WHERE file_id=? LIMIT 1
            `).get(file.id, file.id, file.id);
            return contentRow && (
              contentRow.global_access || (user.perfil === "PROFESSOR" && (contentRow.professor_id === user.id || (contentRow.group_id && db.prepare("SELECT 1 FROM group_mentors WHERE group_id=? AND professor_id=?").get(contentRow.group_id,user.id)) || (contentRow.class_id && db.prepare("SELECT 1 FROM class_teachers WHERE class_id=? AND professor_id=?").get(contentRow.class_id,user.id)))) ||
              (user.perfil === "ALUNO" && (contentRow.group_id && isStudentMember(db, contentRow.group_id, user.id) || contentRow.class_id && db.prepare("SELECT 1 FROM class_enrollments WHERE class_id=? AND student_id=? AND status='ACTIVE'").get(contentRow.class_id,user.id)))
            );
          })();
      if (file.owner_id !== user.id && !content) throw new PlatformError(403, "Você não tem acesso a este arquivo.");
      const diskPath = join(uploadsPath, file.storage_name);
      response.writeHead(200, {
        "Content-Type": file.mime_type,
        "Content-Length": file.size_bytes,
        "Content-Disposition": `${file.mime_type.startsWith("video/") || file.mime_type.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      });
      const stream = createReadStream(diskPath);
      stream.on("error", (error) => {
        console.error("Erro ao ler arquivo armazenado:", error);
        if (!response.headersSent) sendJson(response, 404, { erro: "O arquivo não está disponível." });
        else response.destroy(error);
      });
      stream.pipe(response);
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof PlatformError) {
      sendJson(response, error.status, { erro: error.message });
      return true;
    }
    throw error;
  }
}

function dashboardMetrics(db, teacherId) {
  const groupIds = db.prepare("SELECT id FROM groups WHERE professor_id=?").all(teacherId).map((row) => row.id);
  const groupCount = groupIds.length;
  const teacherGroups = db.prepare("SELECT * FROM groups WHERE professor_id=? ORDER BY semester, subject, name").all(teacherId);
  const students = db.prepare(`
    SELECT COUNT(DISTINCT gm.user_id) AS count FROM group_members gm
    JOIN groups g ON g.id=gm.group_id
    WHERE g.professor_id=? AND gm.status='ACTIVE'
  `).get(teacherId).count;
  const assignments = db.prepare("SELECT * FROM assignments WHERE professor_id=?").all(teacherId);
  const projects = db.prepare("SELECT * FROM projects WHERE professor_id=?").all(teacherId);
  const activeProjects = projects.filter((project) => {
    const status = progressFor(db, project, "project").status;
    return !["COMPLETED", "NOT_MET"].includes(status);
  });
  const assignmentExpected = assignments.reduce((total, item) =>
    total + progressFor(db, item, "assignment").expected, 0);
  const assignmentReceived = assignments.reduce((total, item) =>
    total + progressFor(db, item, "assignment").received, 0);
  const projectExpected = projects.reduce((total, project) =>
    total + progressFor(db, project, "project").expected, 0);
  const projectReceived = projects.reduce((total, project) =>
    total + progressFor(db, project, "project").received, 0);
  const ownedSubmissions = getTeacherSubmissions(db, teacherId);
  const awaitingReview = ownedSubmissions.filter((submission) =>
    ["SUBMITTED", "IN_REVIEW", "RESUBMIT"].includes(submission.statusCodigo)).length;
  const semesters = Array.from({ length: 6 }, (_, index) => {
    const semester = index + 1;
    const groups = teacherGroups.filter((group) => group.semester === semester);
    const semesterAssignments = assignments.filter((item) =>
      item.group_id && groups.some((group) => group.id === item.group_id));
    const expected = semesterAssignments.reduce((total, item) =>
      total + progressFor(db, item, "assignment").expected, 0);
    const received = semesterAssignments.reduce((total, item) =>
      total + progressFor(db, item, "assignment").received, 0);
    const studentCount = groups.length
      ? db.prepare(`
        SELECT COUNT(DISTINCT gm.user_id) AS count FROM group_members gm
        JOIN groups g ON g.id=gm.group_id
        WHERE g.professor_id=? AND g.semester=? AND gm.status='ACTIVE'
      `).get(teacherId, semester).count
      : 0;
    return {
      semestre: semester,
      grupos: groups.length,
      alunos: studentCount,
      tarefas: semesterAssignments.length,
      entregues: received,
      pendentes: Math.max(0, expected - received),
      progresso: expected ? Math.round(received / expected * 100) : 0
    };
  });
  const gruposResumo = teacherGroups.map((group) => {
    const groupAssignments = assignments.filter((item) => item.group_id === group.id);
    const expected = groupAssignments.reduce((total, item) =>
      total + progressFor(db, item, "assignment").expected, 0);
    const received = groupAssignments.reduce((total, item) =>
      total + progressFor(db, item, "assignment").received, 0);
    return {
      id: group.id,
      nome: group.name,
      disciplina: group.subject,
      semestre: group.semester,
      alunos: participantCount(db, group.id),
      tarefas: groupAssignments.length,
      entregues: received,
      pendentes: Math.max(0, expected - received),
      progresso: expected ? Math.round(received / expected * 100) : 0
    };
  });
  return {
    grupos: groupCount,
    alunos: students,
    tarefasPendentes: Math.max(0, assignmentExpected - assignmentReceived),
    projetosAtivos: activeProjects.length,
    aguardandoCorrecao: awaitingReview,
    projetosConcluidos: projects.filter((project) => progressFor(db, project, "project").status === "COMPLETED").length,
    projetosAtrasados: projects.filter((project) => ["OVERDUE", "NOT_MET"].includes(progressFor(db, project, "project").status)).length,
    tarefasCriadas: assignments.length,
    tarefasEntregues: assignmentReceived,
    entregaveisPrevistos: assignmentExpected + projectExpected,
    entregaveisRecebidos: assignmentReceived + projectReceived,
    entregaveisPendentes: Math.max(0, assignmentExpected + projectExpected - assignmentReceived - projectReceived),
    semestres: semesters,
    gruposResumo
  };
}

function getTeacherSubmissions(db, teacherId) {
  const rows = db.prepare(`
    SELECT s.*, u.name AS student_name, u.email AS student_email,
      COALESCE(a.title, p.name, old.title) AS item_title,
      COALESCE(g.name, pg.name, oldg.name) AS group_name
    FROM submissions s JOIN users u ON u.id=s.student_id
    LEFT JOIN assignments a ON a.id=s.assignment_id
    LEFT JOIN projects p ON p.id=s.project_id
    LEFT JOIN activities old ON old.id=s.activity_id
    LEFT JOIN groups g ON g.id=a.group_id
    LEFT JOIN groups pg ON pg.id=p.group_id
    LEFT JOIN groups oldg ON oldg.id=old.group_id
    WHERE (COALESCE(a.professor_id,p.professor_id,old.professor_id)=? OR
      EXISTS (SELECT 1 FROM group_mentors mt WHERE mt.professor_id=? AND mt.group_id=COALESCE(a.group_id,p.group_id,old.group_id)))
    ORDER BY s.submitted_at DESC
  `).all(teacherId, teacherId);
  return rows.map((row) => ({
    id: row.id, tipo: row.project_id ? "project" : "assignment",
    itemId: row.project_id || row.assignment_id || row.activity_id,
    titulo: row.item_title, projeto: Boolean(row.project_id), grupo: row.group_name,
    aluno: row.student_name, email: row.student_email, arquivoId: row.file_id,
    nomeArquivo: row.file_name, comentario: row.comment, enviadaEm: row.submitted_at,
    status: statusLabel(row.status), statusCodigo: row.status, feedback: row.feedback,
    nota: row.grade, versao: row.version
  }));
}

function getAssignmentSubmissions(db, assignmentId) {
  const rows = db.prepare(`
    SELECT s.*, u.name AS student_name, u.email AS student_email,
      a.title AS item_title, g.name AS group_name
    FROM submissions s JOIN users u ON u.id=s.student_id
    JOIN assignments a ON a.id=s.assignment_id
    LEFT JOIN groups g ON g.id=a.group_id
    WHERE s.assignment_id=? OR s.activity_id=? ORDER BY s.submitted_at
  `).all(assignmentId, assignmentId);
  return rows.map((row) => ({
    id: row.id, atividadeId: row.assignment_id, aluno: row.student_name,
    email: row.student_email, comentario: row.comment, nomeArquivo: row.file_name,
    enviadaEm: row.submitted_at, status: statusLabel(row.status),
    statusCodigo: row.status, feedback: row.feedback, nota: row.grade,
    arquivoId: row.file_id, versao: row.version
  }));
}

export { handlePlatformApi, PlatformError };

