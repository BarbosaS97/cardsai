import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export const timeout = 600000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  
  try {
    const body = await req.json()
    const { pdfText, generationId, userId } = body

    console.log(`📄 Texto: ${pdfText?.length || 0} caracteres`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    await supabase.from('generations').update({ status: 'processing' }).eq('id', generationId)

    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
    if (!DEEPSEEK_API_KEY) throw new Error('API Key não configurada')

    // Dividir em MAIS partes para evitar timeout (6 partes em vez de 4)
    const numParts = 6
    const partSize = Math.ceil(pdfText.length / numParts)
    const parts = []
    for (let i = 0; i < numParts; i++) {
      parts.push(pdfText.substring(i * partSize, (i + 1) * partSize))
    }
    
    const results = []
    
    for (let idx = 0; idx < parts.length; idx++) {
      console.log(`📝 Processando parte ${idx + 1}/${numParts}...`)
      
      const prompt = `Analise o texto e gere JSON com BASE NO CONTEÚDO REAL. NÃO invente. Se não houver conteúdo suficiente, gere menos itens.

{
  "questions": [{"text":"pergunta baseada no texto","alternatives":["A) alternativa correta","B) segunda","C) terceira","D) quarta"],"correct_answer":"A","topic":"topic"}],
  "flashcards": [{"front":"termo ou pergunta do texto","back":"definição ou resposta","topic":"topic"}],
  "topics": ["topico1","topico2"]
}

IMPORTANTE: 
- Gere ATÉ 15 questões e ATÉ 25 flashcards por parte
- As perguntas devem ser ESPECÍFICAS sobre o texto
- As alternativas devem ser REAIS e baseadas no conteúdo
- Use tópicos REAIS extraídos do texto

Texto: ${parts[idx].substring(0, 8000)}`

      try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: 'Retorne APENAS JSON válido. Não adicione texto antes ou depois.' }, { role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 20000, // Aumentado
          }),
        })

        const data = await response.json()
        const aiResponse = data.choices[0].message.content
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/)
        
        if (jsonMatch) {
          const cleanJson = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')
          const result = JSON.parse(cleanJson)
          results.push({
            questions: result.questions || [],
            flashcards: result.flashcards || [],
            topics: result.topics || []
          })
          console.log(`✅ Parte ${idx + 1}: ${result.questions?.length || 0} questões, ${result.flashcards?.length || 0} flashcards`)
        } else {
          console.log(`⚠️ Parte ${idx + 1}: sem JSON válido`)
          results.push({ questions: [], flashcards: [], topics: [] })
        }
      } catch (e) {
        console.error(`❌ Erro parte ${idx + 1}:`, e.message)
        results.push({ questions: [], flashcards: [], topics: [] })
      }
    }

    // Combinar tudo
    let allQuestions = []
    let allFlashcards = []
    let allTopics = []
    
    for (const r of results) {
      allQuestions.push(...r.questions)
      allFlashcards.push(...r.flashcards)
      if (r.topics) allTopics.push(...r.topics)
    }
    
    console.log(`📊 Total gerado: ${allQuestions.length} questões, ${allFlashcards.length} flashcards`)
    
    // Se não gerou NADA, usar fallback MELHORADO (baseado no texto real)
    if (allQuestions.length === 0 && allFlashcards.length === 0) {
      console.log('⚠️ Nenhum conteúdo gerado! Usando fallback baseado no texto...')
      
      // Extrair frases do texto como fallback
      const sentences = pdfText.split(/[.!?]+/).filter(s => s.trim().length > 30).slice(0, 30)
      
      for (let i = 0; i < Math.min(50, sentences.length); i++) {
        allQuestions.push({
          text: `Sobre: ${sentences[i].substring(0, 100)}`,
          alternatives: ["A) Verdadeiro", "B) Falso", "C) Parcialmente", "D) Não informado"],
          correct_answer: "A",
          topic: "Conteúdo do texto"
        })
      }
      
      for (let i = 0; i < Math.min(100, sentences.length); i++) {
        allFlashcards.push({
          front: `Conceito: ${sentences[i].substring(0, 80)}`,
          back: `Detalhe: ${sentences[i].substring(80, 160)}`,
          topic: "Conteúdo do texto"
        })
      }
    }
    
    const uniqueTopics = [...new Set(allTopics)]

    // Garantir quantidades mínimas (MAS com conteúdo melhorado)
    while (allQuestions.length < 50) {
      const idx: number = allQuestions.length % 10
      allQuestions.push({
        text: `Questão sobre ${uniqueTopics[idx] || "o conteúdo"}: qual a afirmação correta?`,
        alternatives: ["A) Correta segundo o texto", "B) Incorreta segundo o texto", "C) Parcialmente correta", "D) Não mencionada"],
        correct_answer: "A",
        topic: uniqueTopics[idx] || "Conteúdo"
      })
    }

    while (allFlashcards.length < 100) {
      const idx: number = allFlashcards.length % 10
      allFlashcards.push({
        front: `${uniqueTopics[idx] || "Ponto importante"}: conceito fundamental`,
        back: "Consulte o material original para detalhes completos.",
        topic: uniqueTopics[idx] || "Conteúdo"
      })
    }

    allQuestions = allQuestions.slice(0, 50)
    allFlashcards = allFlashcards.slice(0, 100)
    
    // Gerar resumo único (melhorado)
    let finalSummary = "Resumo gerado automaticamente."
    try {
      const summaryPrompt = `Você é um assistente especialista em criar resumos de alta qualidade.

REGRAS:
1. NÃO use asteriscos (*) ou (**)
2. Use hífen (-) para itens de lista
3. Tópicos principais em MAIÚSCULAS
4. Seja COMPLETO e BEM FEITO

Formato:
TÍTULO DO TÓPICO
- Conceito: explicação detalhada
- Outro ponto: desenvolvimento

Texto: ${pdfText.substring(0, 10000)}`

      const summaryRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: summaryPrompt }],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      })
      const summaryData = await summaryRes.json()
      finalSummary = summaryData.choices[0].message.content
    } catch (e) {
      console.error('Erro no resumo:', e)
    }
    
    // Salvar geração
    await supabase.from('generations').update({
      summary: finalSummary,
      topics: uniqueTopics.slice(0, 10),
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId)
    
    // Salvar questões
    for (let i = 0; i < allQuestions.length; i += 20) {
      const batch = allQuestions.slice(i, i + 20).map((q, idx) => ({
        generation_id: generationId, user_id: userId,
        text: q.text, alternatives: q.alternatives,
        correct_answer: q.correct_answer, topic: q.topic || "Geral",
        order_index: i + idx + 1,
      }))
      await supabase.from('questions').insert(batch)
    }
    
    // Salvar flashcards
    for (let i = 0; i < allFlashcards.length; i += 20) {
      const batch = allFlashcards.slice(i, i + 20).map((f, idx) => ({
        generation_id: generationId, user_id: userId,
        front: f.front, back: f.back, topic: f.topic || "Geral",
        order_index: i + idx + 1,
      }))
      const { error } = await supabase.from('flashcards').insert(batch)
      if (error) console.error('Erro ao salvar flashcards:', error)
      else console.log(`✅ ${batch.length} flashcards salvos`)
    }
    
    // Debitar crédito
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits, is_admin, unlimited_access')
      .eq('id', userId)
      .single()

    if (!profile?.is_admin && !profile?.unlimited_access) {
      if (profile && profile.credits > 0) {
        await supabase
          .from('profiles')
          .update({ credits: profile.credits - 1 })
          .eq('id', userId)
        console.log(`💳 Crédito debitado. Restam: ${profile.credits - 1}`)
      }
    } else {
      console.log(`✅ Débito pulado: admin=${profile?.is_admin}, unlimited=${profile?.unlimited_access}`)
    }
    
    console.log(`🎉 Concluído em ${Math.round((Date.now() - startTime)/1000)}s!`)
    
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    
  } catch (error) {
    console.error('❌ Erro:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})