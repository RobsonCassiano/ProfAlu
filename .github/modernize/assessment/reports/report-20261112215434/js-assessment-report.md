# Avaliação JavaScript — TechFatec

## Dependências

- Ferramenta: `npm-check-updates@19.6.3`
- Resultado: `package.json` não declara dependências nem dependências de desenvolvimento; não há pacotes npm para atualizar.
- Runtime declarado: Node.js `>=22.13.0`, necessário para o módulo SQLite nativo usado pelo servidor.

## Correções realizadas nesta revisão

- O limite de 1 MB do corpo JSON agora é medido em bytes, inclusive em requisições com transferência em partes.
- `NODE_ENV=production` desativa a criação de contas de demonstração e o cadastro público.
- Cookies de sessão recebem `Secure` em produção.
- O portal agora apresenta opções de cadastro apenas quando o servidor as habilita.

## Próximos passos recomendados

1. Integrar SSO Fatec ou verificação institucional de e-mail/identidade e recuperação de senha real.
2. Adicionar limitação de tentativas de login compartilhada entre instâncias e baseada também na origem da requisição.
3. Configurar armazenamento externo, cotas, retenção e backups testados para arquivos e SQLite.
4. Adicionar testes de navegador para fluxos de aluno/professor e verificações de acessibilidade.
5. Planejar suporte a requisições HTTP Range para permitir busca/avanço em vídeos enviados.
