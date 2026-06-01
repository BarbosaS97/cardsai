# CardsQuestõesAI — Guia de Deploy

## 1. Configurar Supabase

### 1.1 Executar SQL Schema
- Abra o Supabase: https://supabase.com/dashboard
- Selecione o projeto `gxkhmmbovlfulcxyupue`
- Vá em **SQL Editor → New Query**
- Cole e execute o conteúdo de `sql/schema.sql`

### 1.2 Deploy da Edge Function
Instale a CLI do Supabase e faça login:
```bash
npm install -g supabase
supabase login
supabase link --project-ref gxkhmmbovlfulcxyupue
```

Configure o secret da DeepSeek:
```bash
supabase secrets set DEEPSEEK_API_KEY=sk-b7e652a5174b45a1a453055549f7c926
```

Deploy da função:
```bash
supabase functions deploy process-pdf
```

### 1.3 Criar usuário Admin
- Vá em https://cardsai.netlify.app/register.html
- Registre com: admin@cardsai.com / admin123
- O trigger criará automaticamente o perfil com créditos ilimitados e is_admin=true

## 2. Deploy do Frontend no Netlify

### Opção A: Netlify Drop (mais rápido)
1. Acesse https://app.netlify.com/drop
2. Arraste a pasta `cardsai/` para a área de drop
3. Pronto! Você terá uma URL como `https://abc123.netlify.app`

### Opção B: GitHub + Netlify CI/CD
1. Suba o projeto para um repositório GitHub
2. Em Netlify: **Add new site → Import from Git**
3. Selecione o repositório
4. Base directory: `cardsai`
5. Publish directory: `cardsai`
6. Deploy!

## 3. Configurar CORS na Edge Function (se necessário)
Se o frontend estiver em domínio diferente, edite o CORS_HEADERS no `index.ts`:
```typescript
"Access-Control-Allow-Origin": "https://seu-dominio.netlify.app",
```

## 4. Testar o Sistema

### Fluxo básico:
1. Abra o site
2. Registre com admin@cardsai.com / admin123
3. Faça upload de um PDF de teste
4. Aguarde o processamento (1-3 minutos)
5. Veja as questões e flashcards gerados

### Painel admin:
- URL: `/admin.html`
- Ver todos usuários e gerações
- Adicionar/resetar créditos manualmente

## 5. Estrutura de arquivos
```
cardsai/
├── sql/schema.sql              ← Execute no Supabase SQL Editor
├── supabase/functions/
│   └── process-pdf/index.ts   ← Deploy com supabase CLI
├── js/
│   ├── config.js               ← Credenciais Supabase
│   └── auth.js                 ← Utilitários de autenticação
├── index.html                  ← Landing page
├── login.html                  ← Login
├── register.html               ← Cadastro
├── dashboard.html              ← Dashboard do usuário
├── upload.html                 ← Upload de PDF
├── results.html                ← Questões e flashcards
├── pricing.html                ← Planos e pagamento
├── admin.html                  ← Painel administrativo
└── netlify.toml                ← Config Netlify
```

## 6. Variáveis de ambiente (Edge Function)
Configuradas automaticamente pelo Supabase:
- `SUPABASE_URL` — URL do projeto
- `SUPABASE_SERVICE_ROLE_KEY` — Chave service role

Precisa configurar manualmente:
- `DEEPSEEK_API_KEY` — Via `supabase secrets set`

## 7. Regras de negócio implementadas
- Upload não consome crédito
- Crédito debitado SOMENTE após geração 100% concluída
- Admin (is_admin=true) NUNCA consome créditos
- Novos usuários recebem 2 créditos grátis automaticamente
- Limite de 150 páginas por PDF
- Texto extraído client-side (PDF.js) — PDFs não são armazenados
