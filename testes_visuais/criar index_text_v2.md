Você vai editar o projeto atual para criar uma NOVA VERSÃO do site de teste de diarização, sem quebrar a versão existente.

OBJETIVO GERAL
- Ler o arquivo atual `index_test.html` como base.
- Criar uma nova versão chamada `index_test_v2.html`.
- Manter o mecanismo atual de detecção de pausas / corte EXATAMENTE como está na versão base.
- Evoluir APENAS o mecanismo de detecção de TROCA de locutor.
- Adicionar barras visuais para novos atributos usados na detecção de troca.
- Não remover as barras antigas já existentes; reorganize de forma clara para acomodar as novas.
- Não alterar o mecanismo de detectar pausas.
- Não alterar thresholds, buffer ou score do mecanismo de corte.
- Não alterar o flash do botão CORTE.
- Não alterar a lógica de shouldCut, exceto se for necessário apenas refatorar nomes sem mudar o comportamento.
- O foco é criar uma versão v2 com debug visual mais rico para TROCA.

ARQUIVOS
- Ler o conteúdo atual de `index_test.html`.
- Criar `index_test_v2.html`.
- Se o projeto atual estiver tudo em um único HTML com CSS e JS embutidos, mantenha esse padrão na nova versão.
- Se houver CSS e JS separados, pode criar arquivos novos versionados (`index_test_v2.js`, `index_test_v2.css`) se isso facilitar, mas preserve a estrutura do projeto.
- No final, me entregue os arquivos completos criados/modificados.

REQUISITOS CRÍTICOS
1. NÃO ALTERAR O MECANISMO DE PAUSAS
- O mecanismo atual de detectar pausas/corte deve ser preservado.
- Não mexer na lógica de:
  - speechScore usado para corte
  - buffer temporal do corte
  - regra de silêncio sustentado
  - regra de queda de low band / movement para corte
  - shouldCut
- Pode reaproveitar a estrutura existente, mas sem mudar o comportamento do corte.

2. EVOLUIR APENAS O MECANISMO DE TROCA
- O novo algoritmo de troca NÃO deve depender de frame único.
- Deve comparar janelas anterior vs recente.
- Deve usar mudança sustentada.
- Deve evitar marcar troca durante silêncio/respiração.
- Deve exigir fala antes e fala depois da transição.
- Deve usar score combinado de múltiplos atributos.
- Deve ter debug visual claro.

3. NOVOS ATRIBUTOS PARA TROCA
Adicionar pelo menos estes novos atributos:
- pitchScore
- rolloffScore

Além dos já existentes e úteis para troca:
- volScore
- lowBandScore
- movementScore
- centroidScore
- zcrScore
- speechScore

4. NOVAS BARRAS VISUAIS
Criar barras visuais para os novos atributos, deixando tudo claro no layout:
- VOLx20
- LOW
- MOVE
- CENT
- SPEECH
- PITCH
- ROLLOFF
- CHANGE (barra do score de troca)

Pode reorganizar em 2 linhas de barras se necessário.
Pode manter estilo simples.
O importante é ficar legível.

5. BOTÃO TROCA
- O botão TROCA deve continuar existindo.
- Deve ficar vermelho por cerca de 300 ms quando o algoritmo decidir troca.
- Não manter vermelho contínuo.
- Evitar repetição frenética; manter throttling simples se necessário.

ALGORITMO PROPOSTO PARA TROCA
Implementar uma nova lógica de troca com estas ideias:

ETAPA A — EXTRAÇÃO DE FEATURES
Continuar calculando as features atuais.
Adicionar:
1. pitchScore
   - Implementar uma estimativa leve de pitch/F0 a partir do sinal temporal.
   - Pode ser uma estimativa heurística/local, sem dependências pesadas.
   - Pode usar autocorrelação simples no domínio do tempo para estimar período fundamental.
   - Limitar a faixa útil de pitch humano aproximado.
   - Transformar o valor em score estável 0..100 para visualização.
   - Se não houver pitch confiável, retornar 0 ou valor neutro coerente.

2. rolloffScore
   - Implementar spectral rolloff baseado no espectro.
   - Ex.: frequência/bin abaixo da qual ficam 85% da energia espectral.
   - Normalizar para 0..100.
   - Mostrar em barra.

ETAPA B — SUAVIZAÇÃO
- Manter a lógica atual de blocos de 50 ms.
- Manter a suavização por média dos últimos N blocos já existentes no projeto.
- Aplicar a mesma filosofia aos novos atributos.
- Não mudar a lógica de suavização usada no corte; apenas incorporar os novos atributos ao pipeline de features para troca.

ETAPA C — JANELAS PARA TROCA
Para detectar troca, comparar:
- uma janela anterior
- uma janela recente

Sugestão:
- usar `SWITCH_SUSTAIN_BLOCKS` ou equivalente
- janela recente = últimos N smoothFrames
- janela anterior = N smoothFrames imediatamente anteriores

ETAPA D — DELTAS ENTRE JANELAS
Calcular deltas entre média da janela anterior e média da janela recente para:
- deltaVol
- deltaLow
- deltaMove
- deltaCent
- deltaZcr
- deltaPitch
- deltaRolloff

ETAPA E — SCORE COMBINADO DE TROCA
Montar um `speakerChangeScore` usando pesos.
Sugestão inicial de pesos:
- deltaPitch: 0.24
- deltaRolloff: 0.18
- deltaLow: 0.16
- deltaMove: 0.14
- deltaCent: 0.10
- deltaZcr: 0.08
- deltaVol: 0.10

Se julgar melhor, ajuste levemente esses pesos, mas mantendo a ideia:
- pitch e rolloff devem ter papel relevante
- move e low também devem contribuir
- volume isolado não pode dominar

Expor esse valor numa barra CHANGE de 0..100.

ETAPA F — REGRA DE TROCA
A troca só deve acontecer quando:
- havia fala antes
- há fala agora
- não é silêncio
- não é corte
- a mudança ficou sustentada
- o score combinado passou do limiar

Exemplo conceitual:
- `previousSpeechAvg > limiar`
- `recentSpeechAvg > limiar`
- `recent` não pode estar em silêncio
- `!shouldCut`
- `speakerChangeScore > limiarTroca`

Adicionar também uma pequena histerese / estabilidade:
- não disparar troca por 1 único smoothFrame
- exigir condição sustentada por alguns frames ou pelo menos usando comparação de janelas robusta
- throttling simples no flash visual

ETAPA G — BLOQUEIOS IMPORTANTES
Não marcar troca quando:
- shouldCut for true
- recentSpeechAvg estiver baixo
- a mudança for dominada apenas por volume
- houver silêncio recente

DEBUG VISUAL E LOG
Adicionar no log visual valores como:
- volX20
- low
- move
- cent
- speech
- pitch
- rolloff
- deltaPitch
- deltaRolloff
- speakerChangeScore
- shouldCut
- shouldSwitch

Se possível, mostrar isso em JSON formatado no `logEl`.

FUNÇÕES NOVAS SUGERIDAS
Você pode criar helpers como:
- `estimatePitchScore(timeData, sampleRate)`
- `estimatePitchHz(timeData, sampleRate)` ou equivalente
- `spectralRolloff(freqData, ratio = 0.85)`
- `normalizePitchToScore(hz)`
- `computeSpeakerChangeScore(previousWindow, recentWindow)`

IMPORTANTE SOBRE PITCH
- Não usar bibliotecas externas pesadas.
- Implementar uma heurística leve o suficiente para rodar no navegador.
- Pode usar autocorrelação simples no domínio do tempo.
- Considerar apenas uma faixa plausível de pitch humano, por exemplo algo como ~80–350 Hz ou equivalente.
- Se a confiança for ruim, retornar score baixo ou neutro.
- O objetivo é ajudar no debug e na troca, não fazer detecção clínica precisa.

IMPORTANTE SOBRE ROLLOFF
- Implementar a partir do espectro atual.
- Calcular energia acumulada e encontrar o bin de 85%.
- Normalizar o índice/bin para 0..100.

LAYOUT
- O layout pode continuar simples.
- Reorganize as barras para caberem bem.
- Mantenha botão GRAVAR/PARAR no topo.
- Mantenha CORTE e TROCA.
- Adicione as barras novas sem poluir.
- O scope/espectro pode ser mantido.

COMPATIBILIDADE
- Não quebrar o funcionamento local no navegador.
- Não introduzir dependências externas obrigatórias.
- Não usar frameworks.
- Manter JS puro e HTML/CSS simples.

ENTREGÁVEIS
Quero que você:
1. Leia `index_test.html`
2. Crie `index_test_v2.html`
3. Preserve o mecanismo de pausa/corte
4. Implemente o novo mecanismo de troca
5. Adicione barras de PITCH, ROLLOFF e CHANGE
6. Me entregue o conteúdo completo dos arquivos criados/modificados

CHECKLIST FINAL ANTES DE ENCERRAR
- Confirmar que a lógica de pausa/corte não foi alterada
- Confirmar que a nova lógica de troca usa pitch + rolloff + score combinado
- Confirmar que há barras visuais novas
- Confirmar que TROCA não dispara por frame único
- Confirmar que CORTE foi preservado como na versão anterior