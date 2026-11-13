function columns(db, table) {
  return new Map(db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => [column.name, column]));
}

function addColumn(db, table, name, definition) {
  if (!columns(db, table).has(name)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${definition}`);
  }
}

function migrateDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS professors (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enrollment TEXT
    );
    CREATE TABLE IF NOT EXISTS students (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ra TEXT,
      course TEXT
    );
  `);
  for (const [name, definition] of [
    ["semester", "INTEGER"]
  ]) addColumn(db, "users", name, definition);
  for (const [name, definition] of [
    ["semester", "INTEGER"]
  ]) addColumn(db, "students", name, definition);
  db.prepare(`
    INSERT OR IGNORE INTO students (user_id, ra, course, semester)
    SELECT id, ra, course, semester FROM users WHERE profile = 'ALUNO'
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO professors (user_id, enrollment)
    SELECT id, enrollment FROM users WHERE profile = 'PROFESSOR'
  `).run();

  for (const [name, definition] of [
    ["created_at", "TEXT"],
    ["semester", "INTEGER"],
    ["max_students", "INTEGER NOT NULL DEFAULT 20"],
    ["status", "TEXT NOT NULL DEFAULT 'OPEN'"],
    ["start_date", "TEXT"],
    ["end_date", "TEXT"],
    ["min_members", "INTEGER NOT NULL DEFAULT 5"],
    ["theme", "TEXT"],
    ["objectives", "TEXT"],
    ["methodology", "TEXT"],
    ["level", "TEXT"],
    ["modality", "TEXT"],
    ["meeting_schedule", "TEXT"],
    ["participation_rules", "TEXT"]
  ]) addColumn(db, "groups", name, definition);
  for (const [name, definition] of [
    ["group_id", "INTEGER REFERENCES groups(id) ON DELETE SET NULL"],
    ["kind", "TEXT NOT NULL DEFAULT 'TASK'"],
    ["expected_submissions", "INTEGER"],
    ["assignment_mode", "TEXT NOT NULL DEFAULT 'INDIVIDUAL'"],
    ["team_size", "INTEGER NOT NULL DEFAULT 4"]
  ]) addColumn(db, "activities", name, definition);
  db.prepare("UPDATE groups SET max_students = 20 WHERE max_students > 20").run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS group_mentors (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (group_id, professor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_mentors_professor
      ON group_mentors(professor_id, group_id);
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY,
      code TEXT UNIQUE,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      name TEXT NOT NULL,
      academic_year INTEGER NOT NULL,
      term INTEGER NOT NULL CHECK (term BETWEEN 1 AND 2),
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_classes_subject_term
      ON classes(subject_id, academic_year, term);
    CREATE TABLE IF NOT EXISTS class_teachers (
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (class_id, professor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_class_teachers_professor
      ON class_teachers(professor_id, class_id);
    CREATE TABLE IF NOT EXISTS class_enrollments (
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enrolled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'COMPLETED')),
      PRIMARY KEY (class_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_class_enrollments_student
      ON class_enrollments(student_id, status);
    CREATE TABLE IF NOT EXISTS class_schedules (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      location TEXT,
      modality TEXT NOT NULL DEFAULT 'PRESENCIAL' CHECK (modality IN ('PRESENCIAL', 'REMOTA', 'HIBRIDA')),
      CHECK (end_time > start_time),
      UNIQUE (class_id, weekday, start_time, end_time)
    );
    CREATE INDEX IF NOT EXISTS idx_class_schedules_weekday
      ON class_schedules(weekday, start_time);
    CREATE TABLE IF NOT EXISTS class_sessions (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      session_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      objectives TEXT,
      planned_content TEXT,
      methodology TEXT,
      resources TEXT,
      taught_content TEXT,
      observations TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (class_id, session_date, start_time)
    );
    CREATE INDEX IF NOT EXISTS idx_class_sessions_class_date
      ON class_sessions(class_id, session_date DESC);
    CREATE TABLE IF NOT EXISTS attendance_records (
      session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'JUSTIFIED')),
      justification TEXT,
      updated_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_student
      ON attendance_records(student_id, session_id);
    CREATE TABLE IF NOT EXISTS class_assessments (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'AVALIACAO',
      max_score REAL NOT NULL CHECK (max_score > 0),
      weight REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
      due_date TEXT,
      description TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_class_assessments_class
      ON class_assessments(class_id, due_date);
    CREATE TABLE IF NOT EXISTS assessment_grades (
      assessment_id INTEGER NOT NULL REFERENCES class_assessments(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score REAL NOT NULL CHECK (score >= 0),
      feedback TEXT,
      updated_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (assessment_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assessment_grades_student
      ON assessment_grades(student_id, assessment_id);
    CREATE TABLE IF NOT EXISTS class_occurrences (
      id INTEGER PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      description TEXT NOT NULL,
      follow_up TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_class_occurrences_student
      ON class_occurrences(class_id, student_id, occurrence_date DESC);
    CREATE TABLE IF NOT EXISTS private_messages (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL,
      CHECK ((group_id IS NOT NULL) + (class_id IS NOT NULL) = 1)
    );
    CREATE INDEX IF NOT EXISTS idx_private_messages_thread
      ON private_messages(sender_id, recipient_id, created_at);
    CREATE TABLE IF NOT EXISTS forum_topics (
      id INTEGER PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((group_id IS NOT NULL) + (class_id IS NOT NULL) = 1)
    );
    CREATE INDEX IF NOT EXISTS idx_forum_topics_room ON forum_topics(group_id,class_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY,
      topic_id INTEGER NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON forum_posts(topic_id,created_at);
    CREATE TABLE IF NOT EXISTS resource_reservations (
      id INTEGER PRIMARY KEY,
      professor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
      resource TEXT NOT NULL,
      purpose TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','CANCELED')),
      created_at TEXT NOT NULL,
      CHECK (ends_at > starts_at)
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_resource_time
      ON resource_reservations(resource,starts_at,ends_at,status);
    CREATE TABLE IF NOT EXISTS institutional_documents (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      external_url TEXT,
      created_at TEXT NOT NULL,
      CHECK ((group_id IS NOT NULL) + (class_id IS NOT NULL) <= 1),
      CHECK (file_id IS NOT NULL OR external_url IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_scope ON institutional_documents(group_id,class_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS group_plans (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      planned_date TEXT,
      objectives TEXT,
      planned_content TEXT,
      methodology TEXT,
      resources TEXT,
      realized_date TEXT,
      realized_content TEXT,
      observations TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'COMPLETED', 'CANCELED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_group_plans_group_date
      ON group_plans(group_id, planned_date);
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user_status
      ON group_members(user_id, status);
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL DEFAULT 'TASK',
      professor_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      due_date TEXT,
      expected_submissions INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_group ON assignments(group_id, kind);
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      professor_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      start_date TEXT,
      end_date TEXT,
      evaluation_criteria TEXT,
      expected_submissions INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_group ON projects(group_id);
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      storage_name TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      photo_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      material_type TEXT NOT NULL,
      external_url TEXT,
      file_id INTEGER REFERENCES files(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_materials_group ON materials(group_id);
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      professor_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      video_type TEXT NOT NULL,
      external_url TEXT,
      file_id INTEGER REFERENCES files(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_videos_group ON videos(group_id);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_feed ON notifications(created_at DESC);
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      grader_id INTEGER NOT NULL REFERENCES users(id),
      grade REAL,
      status TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_grades_submission ON grades(submission_id);
  `);
  addColumn(db, "assignments", "class_id", "INTEGER REFERENCES classes(id) ON DELETE CASCADE");
  addColumn(db, "activities", "class_id", "INTEGER REFERENCES classes(id) ON DELETE CASCADE");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id, due_date);`);
  for (const [name, definition] of [
    ["assignment_mode", "TEXT NOT NULL DEFAULT 'INDIVIDUAL'"],
    ["team_size", "INTEGER NOT NULL DEFAULT 4"]
  ]) addColumn(db, "assignments", name, definition);

  const memberCount = db.prepare(`
    SELECT COUNT(*) AS count FROM group_participants WHERE group_id = ?
  `);
  const legacyMembers = db.prepare(`
    SELECT group_id, user_id FROM group_participants
  `).all();
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at, status)
    VALUES (?, ?, ?, 'ACTIVE')
  `);
  const migrationTime = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("group-mentors-many-to-many")) {
      db.prepare(`
        INSERT OR IGNORE INTO group_mentors (group_id, professor_id, created_at)
        SELECT id, professor_id, COALESCE(created_at, ?) FROM groups
      `).run(migrationTime);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run("group-mentors-many-to-many", migrationTime);
    }
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("group-minimum-default-5")) {
      db.prepare("UPDATE groups SET min_members = 5 WHERE min_members = 3").run();
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run("group-minimum-default-5", migrationTime);
    }

    // Reconcile groups created by demo seeding or legacy code after the initial migration.
    db.prepare(`INSERT OR IGNORE INTO group_mentors(group_id,professor_id,created_at)
      SELECT id, professor_id, COALESCE(created_at, ?) FROM groups`).run(migrationTime);

    for (const member of legacyMembers) {
      insertMember.run(member.group_id, member.user_id, migrationTime);
    }

    const groups = db.prepare("SELECT id, max_students FROM groups").all();
    const updateGroup = db.prepare(`
      UPDATE groups SET created_at = COALESCE(created_at, ?),
        status = CASE WHEN status = 'OPEN' AND ? >= max_students THEN 'COMPLETE' ELSE status END
      WHERE id = ?
    `);
    for (const group of groups) {
      updateGroup.run(migrationTime, memberCount.get(group.id).count, group.id);
    }

    const legacyActivities = db.prepare("SELECT * FROM activities ORDER BY id").all();
    const insertAssignment = db.prepare(`
      INSERT OR IGNORE INTO assignments
        (id, title, description, kind, professor_id, group_id, due_date, expected_submissions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const activity of legacyActivities) {
      insertAssignment.run(
        activity.id,
        activity.title,
        activity.instructions,
        activity.kind || "TASK",
        activity.professor_id,
        activity.group_id ?? null,
        activity.deadline,
        activity.expected_submissions ?? null,
        migrationTime
      );
    }

    const submissionColumns = columns(db, "submissions");
    const needsRebuild = !submissionColumns.has("assignment_id");
    if (needsRebuild) {
      db.exec(`
        CREATE TABLE submissions_migration (
          id INTEGER PRIMARY KEY,
          activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
          assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
          project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL REFERENCES users(id),
          file_id INTEGER REFERENCES files(id),
          comment TEXT,
          file_name TEXT,
          submitted_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'SUBMITTED',
          feedback TEXT,
          grade REAL,
          reviewed_by INTEGER REFERENCES users(id),
          reviewed_at TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          CHECK (
            (activity_id IS NOT NULL OR assignment_id IS NOT NULL OR project_id IS NOT NULL)
            AND (project_id IS NULL OR (activity_id IS NULL AND assignment_id IS NULL))
          )
        );
        INSERT INTO submissions_migration
          (id, activity_id, student_id, comment, file_name, submitted_at, status)
        SELECT id, activity_id, student_id, comment, file_name, submitted_at, 'SUBMITTED'
        FROM submissions;
        DROP TABLE submissions;
        ALTER TABLE submissions_migration RENAME TO submissions;
      `);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_activity_student
        ON submissions(activity_id, student_id) WHERE activity_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_assignment_student
        ON submissions(assignment_id, student_id) WHERE assignment_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_project_student
        ON submissions(project_id, student_id) WHERE project_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
      CREATE TABLE IF NOT EXISTS submission_versions (
        id INTEGER PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        file_id INTEGER REFERENCES files(id),
        file_name TEXT NOT NULL,
        comment TEXT,
        submitted_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        feedback TEXT,
        grade REAL,
        UNIQUE (submission_id, version)
      );
    `);
    addColumn(db, "submission_versions", "grade", "REAL");
    db.exec(`
      INSERT OR IGNORE INTO submission_versions
        (submission_id, version, file_name, comment, submitted_at, status, grade)
      SELECT id, version, COALESCE(file_name, 'entrega existente'), comment, submitted_at, status, grade
      FROM submissions;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export { migrateDatabase };
