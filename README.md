# TechFatec

Plataforma acadêmica colaborativa com áreas para alunos e professores, interface responsiva em HTML/CSS/JavaScript, API HTTP em Node.js e persistência local em SQLite.

## Requisitos e execução

- Node.js 22.13 ou superior (inclui `node:sqlite`).
- Não há dependências npm externas.

```powershell
npm.cmd start
# Desenvolvimento com reinicio automatico
npm.cmd run dev
# Testes de integracao
npm.cmd test
```

Acesse `http://localhost:3000`. Para desenvolvimento, use `npm run dev`; para executar os testes de integração, use `npm test`.

No Windows PowerShell configurado com a política `AllSigned`, use `npm.cmd start`, `npm.cmd run dev` e `npm.cmd test`. A política bloqueia o wrapper `npm.ps1`; o executável `npm.cmd` funciona sem alterar as configurações de segurança do computador.

O SQLite é inicializado e migrado automaticamente em `data/techfatec.sqlite`. Defina `DB_PATH` para escolher outro arquivo e `PORT` para alterar a porta. Os bancos e arquivos enviados ficam em `data/` (ou no diretório de `DB_PATH`) e não devem ser versionados.

## Contas de demonstração

Em desenvolvimento, um banco vazio recebe contas de demonstração com a senha `fatec123`:

- `tiago.santos@fatec.sp.gov.br` — aluno
- `camila.souza@fatec.sp.gov.br` — professora

Os dados de demonstração são inseridos apenas quando o banco ainda não contém usuários. Para começar com um banco vazio, configure um novo caminho para `DB_PATH`.
Com `NODE_ENV=production`, contas de demonstração não são criadas, o cadastro público fica desativado e o cookie de sessão recebe o atributo `Secure`. Contas de demonstração já existentes em um banco não são removidas automaticamente; revise-as antes de promover uma base para produção e sirva a aplicação exclusivamente por HTTPS.

## Funcionalidades

### Home pública e autenticação por perfil

- A rota `/` apresenta um portal público com destaques, notícias e avisos globais, atividades abertas e grupos com vagas; pesquisa e filtro por disciplina funcionam sem conta.
- A home usa uma única tela de login por e-mail institucional. Após autenticar, o perfil já validado pelo servidor direciona alunos à home acadêmica e professores ao dashboard docente.
- Ao abrir um grupo publico, o aluno pode solicitar participacao; o acesso ao ambiente do grupo comeca depois da aprovacao docente. Atividades publicas podem ser abertas apos o login.
- Visitantes veem somente metadados públicos; conteúdos de grupos, integrantes, tarefas vinculadas a grupos e arquivos continuam protegidos por autenticação e autorização.
- A sessão usa cookie HttpOnly com token aleatório persistido no servidor, em vez de JWT no navegador; isso segue a arquitetura atual e evita expor credenciais de sessão a scripts.

### Alunos

- Home em formato de portal acadêmico com notícias, avisos, atividades próximas, projetos, materiais e grupos disponíveis; pesquisa e filtro por disciplina.
- Exploração de grupos, participação em vários grupos, saída e acesso à área interna com materiais, vídeos, atividades e projetos.
- Lista de prazos, progresso, status, notas e histórico de versões das entregas.
- Envio de PDF, documentos, planilhas, apresentações, ZIP e imagens (até 25 MB).
- Edição do nome e da foto do perfil; e-mail institucional, RA e curso permanecem somente para leitura.

### Professores

- Dashboard com totais de grupos, alunos, tarefas pendentes, projetos ativos e entregas aguardando correção, consolidado por semestre (1º ao 6º) e por grupo.
- Gestão de grupos por disciplina e semestre: criação, edição, encerramento, exclusão, limite de até 20 alunos e mínimo configurável (padrão de 5) para iniciar projetos.
- Publicação de tarefas individuais ou em equipes de quatro alunos, projetos com critérios de avaliação, materiais e vídeos/links vinculados aos grupos.
- Lista de integrantes, remoção de alunos, consulta e download de entregas.
- Correção com status, comentário, nota, aprovação, reprovação ou solicitação de reenvio.
- Painéis de projetos, tarefas e entregáveis com indicadores e barras de progresso.
- Relatórios filtráveis por semestre, grupo ou aluno, com opção de impressão/salvar em PDF e compartilhamento por e-mail.
- Edição do nome e da foto do perfil; e-mail institucional e matrícula permanecem somente para leitura.
- Trilha de navegação e logo clicável com retorno ao Dashboard do professor.

#### Gestão acadêmica e grupos de estudo

O portal mantém turmas acadêmicas e grupos de estudo como entidades distintas. Disciplinas e turmas possuem vínculos docentes, horários semanais, diário de aulas e registros de frequência. Tarefas podem ser direcionadas a uma turma ou a um grupo; matrícula acadêmica não é deduzida da participação em grupos. A frequência aceita apenas alunos com matrícula ativa na turma. A carga oficial de matrículas deve vir do processo administrativo institucional; a tela informa quando ainda não há matrículas carregadas.

Cada grupo de estudo também tem seu próprio planejamento de encontros com data prevista/realizada, objetivos, conteúdo, metodologia, recursos e observações. A tabela `group_mentors` permite mais de um professor responsável, preservando o professor original durante a migração.

Avaliações e trabalhos acadêmicos aceitam nota máxima, peso, prazo e feedback; as médias ponderadas, frequência e ocorrências aparecem no acompanhamento e nos relatórios por turma. Pesos são configurados pelo docente, pois ainda não há integração com uma política institucional de avaliação. Materiais e vídeos de grupos, fóruns, mensagens privadas vinculadas, documentos e reservas de recursos também estão disponíveis. As reservas são registradas localmente e verificam conflitos de horário; não substituem um sistema institucional de aprovação ou inventário.

### Progresso e segurança

- O progresso é calculado a partir de entregas recebidas e esperadas; projetos aguardam o mínimo de integrantes, avançam com as entregas, sinalizam atraso após 80% do prazo e não atingimento quando o prazo expira sem conclusão.
- Arquivos são armazenados com nome interno aleatório, validação por extensão, limite de tamanho e controle de acesso por perfil, autoria e participação no grupo.
- Fotos de perfil aceitam PNG, JPG ou WebP de até 5 MB e só podem ser visualizadas pelo próprio usuário autenticado.
- Senhas protegidas com scrypt; sessões em SQLite com token aleatório HttpOnly, SameSite=Lax e expiração de uma hora; bloqueio temporário após três tentativas incorretas.
- As tabelas `students`, `professors`, `group_members`, `materials`, `videos`, `assignments`, `projects`, `submissions`, `submission_versions`, `grades`, `notifications` e `files` são criadas/migradas automaticamente.

## API principal

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `POST` | `/api/auth/login` | Público | Login |
| `POST` | `/api/auth/logout` · `GET /api/auth/me` | Logado | Encerra ou consulta a sessão |
| `GET/PATCH` | `/api/perfil` | Logado | Consulta e atualiza o próprio nome e foto |
| `POST` | `/api/cadastro/aluno` · `/api/cadastro/professor` | Público | Cadastro institucional |
| `GET` | `/api/home` · `/api/noticias` | Logado | Portal e notícias visíveis ao perfil/grupo |
| `GET` | `/api/public/home` | Público | Notícias globais, atividades abertas e grupos com vagas |
| `POST` | `/api/noticias` | Professor | Publica notícia ou aviso |
| `GET/POST` | `/api/grupos` | Logado / Professor | Lista grupos ou cria grupo |
| `GET/PUT/DELETE` | `/api/grupos/:id` | Logado / Professor responsável | Consulta, edita ou exclui |
| `POST` | `/api/grupos/:id/participar` · `/sair` | Aluno | Gerencia participação |
| `GET` | `/api/grupos/:id/portal` | Integrante / Professor responsável | Conteúdos e integrantes do grupo |
| `GET/POST` | `/api/grupos/:id/planejamentos` | Professor responsável | Consulta e registra o planejamento do grupo |
| `PUT/DELETE` | `/api/planejamentos/:id` | Professor responsável | Atualiza ou exclui um planejamento de grupo |
| `DELETE` | `/api/grupos/:id/membros/:alunoId` | Professor responsável | Remove integrante |
| `GET/POST` | `/api/tarefas` · `DELETE /api/tarefas/:id` | Logado / Professor | Consulta, cria ou exclui tarefas |
| `GET/POST` | `/api/disciplinas` | Professor | Lista disciplinas e cadastra uma disciplina |
| `GET/POST` | `/api/turmas` | Logado / Professor | Lista turmas autorizadas ou cria turma acadêmica |
| `GET` | `/api/turmas/:id` · `/aulas` | Professor responsável / aluno matriculado | Consulta dados da turma e diário |
| `POST` | `/api/turmas/:id/horarios` · `/aulas` | Professor responsável | Registra horários semanais e aulas no diário |
| `GET/PUT` | `/api/turmas/:id/aulas/:aulaId/frequencia` | Professor responsável | Consulta e salva frequência de alunos matriculados |
| `GET/POST` | `/api/turmas/:id/avaliacoes` | Professor responsável | Lista ou cria avaliações e trabalhos com peso |
| `PUT` | `/api/turmas/:id/avaliacoes/:avaliacaoId/notas` | Professor responsável | Lança notas para alunos com matrícula ativa |
| `GET/POST/PUT` | `/api/turmas/:id/ocorrencias` · `/ocorrencias/:ocorrenciaId` | Professor responsável | Registra ocorrências e atualiza acompanhamento |
| `GET` | `/api/turmas/:id/relatorio` · `/api/relatorios?turmaId=:id` | Professor responsável | Médias ponderadas, frequência e ocorrências por aluno |
| `GET/POST/PUT/DELETE` | `/api/projetos` · `/api/projetos/:id` | Logado / Professor responsável | Consulta e gerencia projetos |
| `GET/POST` | `/api/materiais` · `/api/videos` | Logado / Professor | Consulta ou publica conteúdo |
| `GET/POST` | `/api/forum` · `/api/forum/:id/posts` | Integrante / Professor do espaço | Cria tópicos e respostas em fóruns de grupos ou turmas |
| `GET/POST` | `/api/mensagens` · `GET /api/contatos` | Pessoas vinculadas ao mesmo espaço | Mensagens privadas entre aluno e professor |
| `GET/POST` | `/api/documentos` | Logado / Professor | Consulta documentos autorizados ou publica arquivo/link |
| `GET/POST/DELETE` | `/api/reservas` · `/api/reservas/:id` | Professor | Agenda recurso e cancela a própria reserva |
| `POST` | `/api/entregaveis/tarefa/:id` · `/projeto/:id` | Aluno integrante | Envia ou reenvia arquivo |
| `GET` | `/api/entregaveis` · `/api/entregaveis/:id/versoes` | Professor / autor ou professor responsável | Consulta entregas e versões |
| `PATCH` | `/api/entregaveis/:id/correcao` | Professor responsável | Registra revisão, comentário e nota |
| `GET` | `/api/arquivos/:id` | Autor, integrante autorizado ou professor responsável | Baixa arquivo |
| `GET` | `/api/dashboard?tipo=resumo\|projetos\|tarefas\|entregaveis` | Professor | Métricas e dados dos painéis |
| `GET` | `/api/relatorios?semestre=1&grupoId=1&alunoId=1` | Professor | Relatório de entregáveis e aproveitamento |

Uploads de video aceitam MP4, WebM e MOV ate 100 MB. Links externos devem usar HTTP ou HTTPS. Arquivos enviados ficam em `data/uploads/` (ou no diretorio de dados configurado por `DB_PATH`).

## Organização

- `public/index.html`, `public/app.js`, `public/styles.css`: interface e navegação responsivas por perfil.
- `server.js`: servidor HTTP, autenticação, sessões, arquivos estáticos e inicialização do SQLite.
- `src/database.js`: schema e migrações.
- `src/platform-api.js`: validações, permissões, regras de negócio, uploads e rotas da plataforma.
- `test/server.test.js`: testes de integração da API e dos fluxos colaborativos.

Fotos de perfil e metadados são persistidos nas tabelas `files` e `user_profiles`; a migração é aplicada automaticamente nos bancos existentes.

O SSO Fatec e a recuperação de senha continuam simulados. Em produção, cadastros públicos ficam bloqueados até existir um fluxo de autenticação/verificação institucional; contas devem ser provisionadas por um processo administrativo confiável. A aplicação armazena arquivos no disco local; para produção, configure armazenamento externo, política de retenção/backup, serviço de e-mail e provedor institucional de identidade.
