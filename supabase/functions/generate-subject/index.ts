import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export const timeout = 600000

function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.substring(start, i + 1)
    }
  }
  return null
}

function limparJSON(texto: string): string {
  // Remove markdown fences
  texto = texto.replace(/```json\n?/g, '').replace(/```\n?/g, '')

  // Extract outermost { ... }
  const first = texto.indexOf('{')
  const last = texto.lastIndexOf('}')
  if (first !== -1 && last !== -1) {
    texto = texto.substring(first, last + 1)
  }

  // Fix missing comma between adjacent objects: }{ → },{
  texto = texto.replace(/\}\s*\{/g, '},{')

  // Fix missing comma between adjacent arrays: ][ → ],[
  texto = texto.replace(/\]\s*\[/g, '],[')

  // Remove trailing commas before ] or }
  texto = texto.replace(/,(\s*[}\]])/g, '$1')

  return texto
}

function tentarParsearJSON(raw: string): any | null {
  // Attempt 1: precise brace-matching extractor + parse
  const extracted = extractFirstObject(raw)
  if (extracted) {
    try { return JSON.parse(extracted) } catch { /* fall through */ }
  }
  // Attempt 2: full cleaning pass + parse
  try { return JSON.parse(limparJSON(raw)) } catch { return null }
}

async function callDeepSeek(
  apiKey: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature = 0.5,
): Promise<string> {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature, max_tokens: maxTokens }),
  })
  const data = await res.json()
  return data.choices[0].message.content as string
}

interface ModeConfig {
  alternativesCount: number
  questionStyle: string
  flashcardStyle: string
}

interface DifficultyConfig {
  label: string
  questionDepth: string
  distractorStrategy: string
  flashcardDepth: string
  systemSuffix: string
}

const difficultyConfig: Record<string, DifficultyConfig> = {
  facil: {
    label: 'Fácil',
    questionDepth:
      'Crie questões SIMPLES E DIRETAS sobre conceitos fundamentais. Uma questão = um conceito claro. Pergunte definições, identificações e fatos objetivos. Evite qualquer ambiguidade ou inferência.',
    distractorStrategy:
      'Alternativas incorretas devem ser CLARAMENTE ERRADAS para quem estudou o assunto com atenção básica. NÃO use pegadinhas. Cada incorreta deve ser facilmente refutável.',
    flashcardDepth:
      'Definições simples e diretas. Uma ideia por flashcard. Linguagem acessível ao iniciante no assunto.',
    systemSuffix:
      'NÍVEL FÁCIL: priorize clareza absoluta. Questões básicas sem ambiguidade, testando conhecimento direto e fundamental.',
  },
  medio: {
    label: 'Médio',
    questionDepth:
      'Crie questões que exigem COMPREENSÃO e APLICAÇÃO. Misture questões diretas com questões que relacionam dois conceitos ou exigem inferência. Não pergunte apenas definições — exija interpretação e aplicação.',
    distractorStrategy:
      'Alternativas incorretas devem ser PLAUSÍVEIS para quem estudou superficialmente, diferindo da correta em pelo menos um detalhe específico. Algumas alternativas podem ser "quase corretas".',
    flashcardDepth:
      'Definição completa com contexto e exemplos. Inclua relações entre conceitos quando relevante.',
    systemSuffix:
      'NÍVEL MÉDIO: equilibre clareza e desafio. Questões que exigem compreensão real, com alternativas plausíveis mas distinguíveis.',
  },
  dificil: {
    label: 'Difícil',
    questionDepth:
      'Crie questões COMPLEXAS que exigem ANÁLISE e SÍNTESE de múltiplos conceitos. Exija distinção entre conceitos similares, identificação de exceções, comparação de elementos. Cada questão deve ser desafiadora mesmo para quem domina o assunto.',
    distractorStrategy:
      'Alternativas incorretas OBRIGATORIAMENTE com pegadinhas: inversão de termos-chave, troca de ordem, elemento quase-correto. Devem ser MUITO PLAUSÍVEIS, diferindo da correta em detalhes SUTIS.',
    flashcardDepth:
      'Conteúdo aprofundado: definição técnica + exceções + casos especiais + relações com outros conceitos.',
    systemSuffix:
      'NÍVEL DIFÍCIL: questões complexas com pegadinhas obrigatórias, alternativas muito similares entre si e análise de múltiplos conceitos combinados.',
  },
  expert: {
    label: 'Expert',
    questionDepth:
      'Crie questões de ALTO NÍVEL que exigem DOMÍNIO COMPLETO. Combine MÚLTIPLOS CONCEITOS em uma única questão. Use casos extremos, explore nuances e contradições aparentes, exija análise crítica. NENHUMA questão deve ser respondível por memorização simples.',
    distractorStrategy:
      'Alternativas incorretas EXTREMAMENTE CONVINCENTES: diferem da correta apenas em aspectos TÉCNICOS MUITO PRECISOS. Cada incorreta representa um EQUÍVOCO SOFISTICADO que um estudante avançado cometeria.',
    flashcardDepth:
      'Conteúdo especializado: definição técnica precisa + exceções + casos de borda + implicações práticas + conexões com outros temas + aspectos frequentemente mal compreendidos.',
    systemSuffix:
      'NÍVEL EXPERT: máxima complexidade. Questões que separam quem memorizou de quem realmente entendeu. Alternativas extremamente convincentes, combinação de múltiplos conceitos, casos extremos.',
  },
}

const modeConfig: Record<string, ModeConfig> = {
  concurso: {
    alternativesCount: 5,
    questionStyle:
      "literal, baseada em lei seca e súmulas. Use expressões como 'Segundo o art. X...', 'De acordo com a CF/88...', 'A Súmula Vinculante X do STF estabelece que...'",
    flashcardStyle:
      "no formato: 'Referência: [art./inciso/súmula] → Conteúdo: [dispositivo completo]'",
  },
  oab: {
    alternativesCount: 5,
    questionStyle:
      "como casos práticos e situações-problema. Use narrativas com nomes ('João, servidor público, foi exonerado...') e pergunte qual a medida cabível ou a posição jurídica correta.",
    flashcardStyle:
      "no formato: 'Conceito: [definição] → Posição STF/STJ: [entendimento] → Exceções: [casos especiais]'",
  },
  vestibular: {
    alternativesCount: 4,
    questionStyle:
      'contextualizada e interdisciplinar. Use contextos históricos ou sociais, peça causas, consequências e relações entre eventos ou conceitos.',
    flashcardStyle:
      "no formato: 'Conceito: [definição] → Exemplo: [caso concreto] → Contexto: [momento histórico ou social]'",
  },
  faculdade: {
    alternativesCount: 4,
    questionStyle:
      'direta, com linguagem acadêmica, focada no conteúdo programático. Pergunte definições, classificações e aplicações diretas de conceitos teóricos.',
    flashcardStyle:
      "no formato: 'Conceito: [definição teórica] → Aplicação: [como usar] → Autores: [principais referências]'",
  },
}

// Different angles for each parallel batch to maximize content variety
const BATCH_ANGLES = [
  'conceitos fundamentais, definições essenciais e bases teóricas',
  'aplicações práticas, exemplos reais e casos concretos',
  'comparações entre conceitos, distinções importantes e classificações',
  'exceções, casos especiais, nuances e pontos frequentemente confundidos',
  'aspectos avançados, relações entre subtópicos e síntese do conhecimento',
]

async function generateQuestionsFromSubject(
  apiKey: string,
  materia: string,
  assunto: string,
  observacoes: string,
  batchIndex: number,
  config: ModeConfig,
  diffConfig: DifficultyConfig,
  targetCount: number,
  modoEstudo: string,
): Promise<{ questions: any[]; topics: string[] }> {
  const letters = ['A', 'B', 'C', 'D', 'E'].slice(0, config.alternativesCount)
  const angle = BATCH_ANGLES[batchIndex] ?? BATCH_ANGLES[0]

  const prompt = `Você é um especialista em ${materia} com anos de experiência criando questões para ${modoEstudo}.

TAREFA: Crie EXATAMENTE ${targetCount} questões de múltipla escolha sobre o seguinte tema.

Matéria: ${materia}
Assunto: ${assunto}${observacoes ? `\nObservações específicas: ${observacoes}` : ''}

Foco desta parte: ${angle}

━━━ REGRAS DE QUALIDADE — OBRIGATÓRIAS ━━━

REGRA 1 — CONTEÚDO REAL:
Use apenas conhecimento consolidado e academicamente reconhecido sobre ${materia} / ${assunto}.
NUNCA invente conceitos, leis, artigos, nomes ou fatos que não existem.
Cada questão deve abordar um conceito real e relevante desta matéria.

REGRA 2 — QUANTIDADE OBRIGATÓRIA:
Você DEVE gerar EXATAMENTE ${targetCount} questões — nem mais, nem menos.

REGRA 3 — ENUNCIADO:
- Claro, objetivo, sem ambiguidade (10 a 30 palavras)
- Começa diretamente com o conceito, instituto ou situação
- NÃO comece com "Segundo a doutrina", "De acordo com o material" ou similares
- ✅ CORRETO: "O princípio da legalidade na Administração Pública determina que:"
- ❌ PROIBIDO: "Segundo o material estudado, o princípio da legalidade:"

REGRA 4 — ALTERNATIVAS:
- ${config.alternativesCount} alternativas (${letters.join(', ')})
- Apenas 1 alternativa correta — inequivocamente certa
- As ${config.alternativesCount - 1} incorretas devem ser PLAUSÍVEIS (erros comuns reais)
- NÃO use alternativas absurdas, engraçadinhas ou óbvias
- Cada alternativa deve conter apenas a informação, SEM frases como "conforme a doutrina"

REGRA 5 — EXPLICAÇÃO:
- Obrigatória e educativa: explique POR QUE a correta está certa
- Mencione brevemente por que cada incorreta está errada
- Mínimo 2 frases, máximo 5 frases

REGRA 6 — VARIEDADE:
- Cada questão aborda um conceito DIFERENTE dentro do tema
- Distribua a resposta correta entre ${letters.join(', ')}

MODO DE ESTUDO (${modoEstudo}): ${config.questionStyle}
NÍVEL ${diffConfig.label}: ${diffConfig.questionDepth}
Distratores: ${diffConfig.distractorStrategy}

Retorne APENAS este JSON (sem markdown, sem texto fora do JSON):
{
  "questions": [
    {
      "text": "Enunciado direto iniciando com o conceito (não referencia fonte ou material)",
      "alternatives": ["${letters[0]}) texto da alternativa", "${letters[1]}) texto da alternativa"${config.alternativesCount >= 3 ? `, "${letters[2]}) texto da alternativa"` : ''}${config.alternativesCount >= 4 ? `, "${letters[3]}) texto da alternativa"` : ''}${config.alternativesCount === 5 ? `, "${letters[4]}) texto da alternativa"` : ''}],
      "correct_answer": "${letters[0]}",
      "explanation": "Explicação educativa de por que a resposta correta está certa e as demais estão erradas.",
      "topic": "subtópico específico dentro de ${assunto}"
    }
  ],
  "topics": ["subtópico 1", "subtópico 2"]
}`

  const qMessages = [
    {
      role: 'system',
      content:
        `Você é um especialista em educação e em ${materia}. ` +
        'Crie questões de múltipla escolha de alta qualidade pedagógica baseadas no seu conhecimento consolidado. ' +
        'NUNCA invente informações. Use apenas conhecimento real e academicamente reconhecido. ' +
        'Alternativas incorretas devem representar erros comuns reais que estudantes cometem, nunca absurdos. ' +
        `${diffConfig.systemSuffix} Retorne APENAS JSON válido.`,
    },
    { role: 'user', content: prompt },
  ]

  const MAX_ATTEMPTS = 2
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callDeepSeek(apiKey, qMessages, 7500)
      const result = tentarParsearJSON(raw)
      if (!result) {
        console.log(`⚠️ Q lote ${batchIndex + 1} tentativa ${attempt}: JSON inválido${attempt < MAX_ATTEMPTS ? ' — retentando' : ' — descartado'}`)
        continue
      }
      const questions = (Array.isArray(result) ? result : (result.questions ?? [])).slice(0, targetCount)
      const topics = result.topics ?? []
      console.log(`✅ Q lote ${batchIndex + 1}: ${questions.length}/${targetCount} questões${attempt > 1 ? ` (tentativa ${attempt})` : ''}`)
      return { questions, topics }
    } catch (e: any) {
      console.error(`❌ Q lote ${batchIndex + 1} tentativa ${attempt}:`, e.message)
    }
  }
  return { questions: [], topics: [] }
}

async function generateFlashcardsFromSubject(
  apiKey: string,
  materia: string,
  assunto: string,
  observacoes: string,
  batchIndex: number,
  diffConfig: DifficultyConfig,
  targetCount: number,
  modoEstudo: string,
  config: ModeConfig,
): Promise<any[]> {
  const angle = BATCH_ANGLES[batchIndex] ?? BATCH_ANGLES[0]

  const prompt = `Você é um especialista em ${materia}. Crie EXATAMENTE ${targetCount} flashcards de estudo sobre:

Matéria: ${materia}
Assunto: ${assunto}${observacoes ? `\nObservações: ${observacoes}` : ''}

Foco desta parte: ${angle}

QUANTIDADE OBRIGATÓRIA: EXATAMENTE ${targetCount} flashcards.

ESTRATÉGIAS DE MEMORIZAÇÃO (varie — não use sempre a mesma):

1. PERGUNTA DIRETA — frente: pergunta objetiva | verso: resposta concisa
   ✅ Frente: "Quais são os elementos essenciais do contrato?"
      Verso: "Agente capaz, objeto lícito e possível, forma prescrita ou não proibida em lei"

2. LACUNA/OMISSÃO — frente: frase com ___ | verso: a palavra omitida + explicação breve
   ✅ Frente: "O princípio da ___ veda à Administração agir sem autorização legal"
      Verso: "Legalidade — o administrador só pode fazer o que a lei expressamente autoriza"

3. COMPARAÇÃO — frente: "Diferença entre X e Y?" | verso: distinção clara
   ✅ Frente: "Diferença entre dolo e culpa?"
      Verso: "Dolo: intenção de causar o resultado. Culpa: resultado por negligência, imprudência ou imperícia"

4. LISTA/MNEMÔNICO — frente: "Quais são os tipos/requisitos de X?" | verso: lista enumerada
   ✅ Frente: "Modalidades de extinção do contrato"
      Verso: "1) Distrato 2) Resolução 3) Rescisão 4) Resilição 5) Morte do contratante"

5. VERDADEIRO OU FALSO — frente: afirmação | verso: "Verdadeiro" ou "Falso — [correção]"
   ✅ Frente: "A rescisão contratual ocorre por mútuo acordo"
      Verso: "Falso — por mútuo acordo é distrato. Rescisão é unilateral por inadimplemento"

REGRAS:
- Frente: máximo 15 palavras
- Verso: máximo 3 linhas, direto ao ponto
- NÃO comece o verso com "Referência:", "Texto:", "Conteúdo:" ou similares
- NÃO crie flashcards genéricos ("Conceito importante", "Ponto relevante")
- Use conceitos reais e específicos da matéria ${materia} / ${assunto}
- Use apenas conhecimento real e academicamente consolidado
- Formato para ${modoEstudo}: ${config.flashcardStyle}

Nível ${diffConfig.label}: ${diffConfig.flashcardDepth}

Retorne APENAS este JSON (sem markdown):
{
  "flashcards": [
    {
      "front": "Pergunta, lacuna ou afirmação (máx. 15 palavras)",
      "back": "Resposta direta e objetiva (máx. 3 linhas)",
      "topic": "subtópico específico"
    }
  ]
}`

  const fcMessages = [
    {
      role: 'system',
      content:
        `Você é um especialista em ${materia} e em criação de material didático. ` +
        'Crie flashcards objetivos, precisos e pedagogicamente eficazes. ' +
        'Use apenas conhecimento real e academicamente consolidado. ' +
        'NUNCA use frente ou verso genérico. Cada flashcard deve referenciar um conceito concreto e específico. ' +
        'Retorne APENAS JSON válido.',
    },
    { role: 'user', content: prompt },
  ]

  const MAX_ATTEMPTS = 2
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callDeepSeek(apiKey, fcMessages, 4000)
      const result = tentarParsearJSON(raw)
      if (!result) {
        console.log(`⚠️ FC lote ${batchIndex + 1} tentativa ${attempt}: JSON inválido${attempt < MAX_ATTEMPTS ? ' — retentando' : ' — descartado'}`)
        continue
      }
      const flashcards = (Array.isArray(result) ? result : (result.flashcards ?? [])).slice(0, targetCount)
      console.log(`✅ FC lote ${batchIndex + 1}: ${flashcards.length}/${targetCount} flashcards${attempt > 1 ? ` (tentativa ${attempt})` : ''}`)
      return flashcards
    } catch (e: any) {
      console.error(`❌ FC lote ${batchIndex + 1} tentativa ${attempt}:`, e.message)
    }
  }
  return []
}

async function generateSummary(
  apiKey: string,
  materia: string,
  assunto: string,
  observacoes: string,
): Promise<string> {
  try {
    return await callDeepSeek(
      apiKey,
      [
        {
          role: 'user',
          content: `Crie um resumo estruturado e completo sobre o seguinte tema:

Matéria: ${materia}
Assunto: ${assunto}${observacoes ? `\nObservações: ${observacoes}` : ''}

REGRAS:
- NÃO use asteriscos (*) ou (**)
- Use hífen (-) para listas
- Títulos de seção em MAIÚSCULAS
- Cubra os principais tópicos, conceitos e classificações do assunto

FORMATO:
NOME DO TÓPICO
- Conceito: explicação detalhada
- Ponto importante: desenvolvimento`,
        },
      ],
      2500,
    )
  } catch (e: any) {
    console.error('Erro no resumo:', e.message)
    return `Resumo gerado automaticamente para ${materia} - ${assunto}.`
  }
}

function isJunk(text: string): boolean {
  const JUNK_RE = [/https?:\/\//i, /t\.me\//i, /telegram/i, /whatsapp/i, /inscreva[- ]se/i, /clique\s+aqui/i]
  return JUNK_RE.some(p => p.test(text))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`

  try {
    const { generationId, materia, assunto, observacoes = '', modoEstudo = 'concurso', dificuldade = 'medio' } = await req.json()

    if (!materia || !assunto) {
      return new Response(JSON.stringify({ error: 'materia e assunto são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization header ausente' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = user.id

    const config = modeConfig[modoEstudo] ?? modeConfig.concurso
    const diffConfig = difficultyConfig[dificuldade] ?? difficultyConfig.medio

    console.log(`📚 Matéria: ${materia} | Assunto: ${assunto} | modo: ${modoEstudo} | dificuldade: ${dificuldade} | userId: ${userId}`)

    await supabase.from('generations').update({ status: 'processing' }).eq('id', generationId)

    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY não configurada')

    const TARGET_QUESTIONS = 50
    const TARGET_FLASHCARDS = 100
    const numBatches = 5
    const questionsPerBatch  = Math.ceil((TARGET_QUESTIONS  + 10) / numBatches) // 12: +10 buffer para sanitização/dedup
    const flashcardsPerBatch = Math.ceil((TARGET_FLASHCARDS + 10) / numBatches) // 22: +10 buffer para dedup

    console.log(`🚀 Lançando ${numBatches * 2 + 1} chamadas paralelas à DeepSeek...`)

    const batchIndices = Array.from({ length: numBatches }, (_, i) => i)

    const [questionResults, flashcardResults, finalSummary] = await Promise.all([
      Promise.all(
        batchIndices.map(i =>
          generateQuestionsFromSubject(DEEPSEEK_API_KEY, materia, assunto, observacoes, i, config, diffConfig, questionsPerBatch, modoEstudo),
        ),
      ),
      Promise.all(
        batchIndices.map(i =>
          generateFlashcardsFromSubject(DEEPSEEK_API_KEY, materia, assunto, observacoes, i, diffConfig, flashcardsPerBatch, modoEstudo, config),
        ),
      ),
      generateSummary(DEEPSEEK_API_KEY, materia, assunto, observacoes),
    ])

    console.log(`⏱️ API concluída em ${elapsed()}`)

    let allQuestions: any[] = []
    let allFlashcards: any[] = []
    let allTopics: string[] = []

    for (const r of questionResults) {
      allQuestions.push(...r.questions)
      allTopics.push(...r.topics)
    }
    for (const fc of flashcardResults) {
      allFlashcards.push(...fc)
    }

    console.log(`📊 Total gerado: ${allQuestions.length}Q, ${allFlashcards.length}FC`)

    // Fallback se a IA falhou em todos os lotes
    if (allQuestions.length === 0 && allFlashcards.length === 0) {
      console.log('⚠️ IA falhou em todos os lotes — tentando chamada única de recuperação')
      try {
        const recoveryQ = await generateQuestionsFromSubject(DEEPSEEK_API_KEY, materia, assunto, observacoes, 0, config, diffConfig, TARGET_QUESTIONS, modoEstudo)
        allQuestions.push(...recoveryQ.questions)
        allTopics.push(...recoveryQ.topics)
        const recoveryFC = await generateFlashcardsFromSubject(DEEPSEEK_API_KEY, materia, assunto, observacoes, 0, diffConfig, TARGET_FLASHCARDS, modoEstudo, config)
        allFlashcards.push(...recoveryFC)
        console.log(`🔄 Recuperação: ${allQuestions.length}Q, ${allFlashcards.length}FC`)
      } catch (recoveryErr: any) {
        console.error('❌ Recuperação também falhou:', recoveryErr.message)
      }
    }

    const altCount = config.alternativesCount
    const VALID_ANSWERS = new Set(['A', 'B', 'C', 'D', 'E'])

    // Sanitizar questões
    for (const q of allQuestions) {
      const altsValid =
        Array.isArray(q.alternatives) &&
        q.alternatives.length >= 4 &&
        q.alternatives.every((a: any) => typeof a === 'string' && a.trim().length > 3)

      if (altsValid) {
        if (q.alternatives.length > altCount) {
          q.alternatives = q.alternatives.slice(0, altCount)
        }
      } else {
        console.warn(`⚠️ Q inválida descartada`)
        q._discard = true
      }

      if (!VALID_ANSWERS.has(q.correct_answer)) {
        q.correct_answer = 'A'
      }
    }

    const before = allQuestions.length
    allQuestions = allQuestions.filter((q: any) => !q._discard && q.text && q.text.trim().length > 10)
    if (allQuestions.length < before) {
      console.warn(`⚠️ ${before - allQuestions.length} questão(ões) descartadas`)
    }

    const uniqueTopics = [...new Set(allTopics)]

    // Deduplicação
    const seenQ = new Set<string>()
    allQuestions = allQuestions
      .filter((q: any) => {
        if (isJunk(q.text ?? '')) return false
        const key = (q.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 70)
        if (seenQ.has(key)) return false
        seenQ.add(key)
        return true
      })
      .slice(0, TARGET_QUESTIONS)

    // Fallback cirúrgico para questões
    if (allQuestions.length < TARGET_QUESTIONS) {
      const missing = TARGET_QUESTIONS - allQuestions.length
      console.log(`⚠️ ${allQuestions.length} questões após dedup — gerando ${missing} adicionais...`)
      try {
        const extraQ = await generateQuestionsFromSubject(
          DEEPSEEK_API_KEY, materia, assunto, observacoes,
          99, config, diffConfig, missing + 3, modoEstudo,
        )
        for (const q of extraQ.questions) {
          if (allQuestions.length >= TARGET_QUESTIONS) break
          if (isJunk(q.text ?? '') || !q.text || q.text.trim().length <= 10) continue
          const altsValid =
            Array.isArray(q.alternatives) &&
            q.alternatives.length >= 4 &&
            q.alternatives.every((a: any) => typeof a === 'string' && a.trim().length > 3)
          if (!altsValid) continue
          if (!VALID_ANSWERS.has(q.correct_answer)) q.correct_answer = 'A'
          if (q.alternatives.length > altCount) q.alternatives = q.alternatives.slice(0, altCount)
          const key = (q.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 70)
          if (seenQ.has(key)) continue
          seenQ.add(key)
          allQuestions.push(q)
        }
        console.log(`🔄 Após fallback Q: ${allQuestions.length}Q`)
      } catch (e: any) {
        console.error('❌ Fallback de questões falhou:', e.message)
      }
    }

    const seenFC = new Set<string>()
    allFlashcards = allFlashcards
      .filter((f: any) => {
        if (isJunk(f.front ?? '') || isJunk(f.back ?? '')) return false
        if ((f.front ?? '').trim().length <= 5) return false
        const key = (f.front ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 50)
        if (seenFC.has(key)) return false
        seenFC.add(key)
        return true
      })
      .slice(0, TARGET_FLASHCARDS)

    // Fallback cirúrgico para flashcards
    if (allFlashcards.length < TARGET_FLASHCARDS) {
      const missing = TARGET_FLASHCARDS - allFlashcards.length
      console.log(`⚠️ ${allFlashcards.length} flashcards após dedup — gerando ${missing} adicionais...`)
      try {
        const extraFC = await generateFlashcardsFromSubject(DEEPSEEK_API_KEY, materia, assunto, observacoes, 99, diffConfig, missing + 5, modoEstudo, config)
        for (const f of extraFC) {
          if (allFlashcards.length >= TARGET_FLASHCARDS) break
          if (isJunk(f.front ?? '') || isJunk(f.back ?? '')) continue
          if ((f.front ?? '').trim().length <= 5) continue
          const key = (f.front ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 50)
          if (seenFC.has(key)) continue
          seenFC.add(key)
          allFlashcards.push(f)
        }
        console.log(`🔄 Após fallback FC: ${allFlashcards.length}FC`)
      } catch (e: any) {
        console.error('❌ Fallback de flashcards falhou:', e.message)
      }
    }

    console.log(`📊 Após dedup: ${allQuestions.length}Q (target ${TARGET_QUESTIONS}), ${allFlashcards.length}FC (target ${TARGET_FLASHCARDS})`)

    const questionRows = allQuestions.map((q, i) => ({
      generation_id: generationId,
      text: q.text,
      alternatives: q.alternatives,
      correct_answer: q.correct_answer,
      explanation: q.explanation ?? null,
      topic: q.topic ?? assunto,
      order_index: i + 1,
    }))

    const flashcardRows = allFlashcards.map((f, i) => ({
      generation_id: generationId,
      front: f.front,
      back: f.back,
      topic: f.topic ?? assunto,
      order_index: i + 1,
    }))

    const BATCH = 25
    const insertResults = await Promise.all([
      ...Array.from({ length: Math.ceil(questionRows.length / BATCH) }, (_, i) =>
        supabase.from('questions').insert(questionRows.slice(i * BATCH, (i + 1) * BATCH)),
      ),
      ...Array.from({ length: Math.ceil(flashcardRows.length / BATCH) }, (_, i) =>
        supabase.from('flashcards').insert(flashcardRows.slice(i * BATCH, (i + 1) * BATCH)),
      ),
    ])

    let insertErrors = 0
    for (const r of insertResults) {
      if (r.error) {
        console.error('❌ INSERT ERROR:', r.error.message)
        insertErrors++
      }
    }
    if (insertErrors > 0) {
      throw new Error(`${insertErrors} batch(es) de inserção falharam`)
    }
    console.log(`✅ ${questionRows.length}Q + ${flashcardRows.length}FC salvos em ${elapsed()}`)

    const now = new Date().toISOString()
    const { data: updatedRows, error: updateError } = await supabase
      .from('generations')
      .update({
        summary: finalSummary,
        topics: uniqueTopics.slice(0, 10),
        status: 'completed',
        study_mode: modoEstudo,
        question_count: questionRows.length,
        flashcard_count: flashcardRows.length,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', generationId)
      .select('id')

    if (updateError) {
      console.error('❌ UPDATE ERROR:', updateError.message)
    } else if (!updatedRows || updatedRows.length === 0) {
      console.error(`⚠️ UPDATE afetou 0 linhas — generationId: ${generationId}`)
    } else {
      console.log(`✅ Geração ${generationId} marcada como completed`)
    }

    try {
      const { error: debitError } = await supabase.rpc('consume_credit', { p_user_id: userId })
      if (debitError) console.error(`DEBIT_ERROR userId=${userId}:`, debitError.message)
      else console.log(`DEBIT OK userId=${userId}`)
    } catch (e: any) {
      console.error(`DEBIT_EXCEPTION userId=${userId}:`, e.message)
    }

    console.log(`🎉 Concluído em ${elapsed()}!`)
    return new Response(
      JSON.stringify({ success: true, questionCount: questionRows.length, flashcardCount: flashcardRows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
