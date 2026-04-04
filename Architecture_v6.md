# Architecture v6

## 1) Visao geral da pagina

A pagina principal de v6 eh `index6.html`.
Ela monta uma UI de entrevista com diarizacao simples para 2 speakers, com estes blocos:

- Controles de calibracao (`Calibrar Individuo 1` e `Calibrar Individuo 2`)
- Controles da entrevista (`Iniciar Entrevista` e `Finalizar Entrevista`)
- Resultado final (segmentos marcados + transcricao corrida)
- Painel de debug (logs operacionais)
- Editor de prompt para envio a IA

Arquivo de entrada:
- `index6.html` carrega `script6.js` e os estilos da pagina.

## 2) Responsabilidades do script6.js

`script6.js` concentra toda a logica de:

- captura de audio com WebAudio
- reconhecimento de fala (Web Speech API)
- extracao de features acusticas (ch, vol, pit, zcr, cent)
- calibracao de assinaturas de voz
- classificacao de speaker por distancia entre features
- montagem de segmentos, consolidacao de transcricao e render na UI
- logs tecnicos e estado da aplicacao

## 3) Estado global da aplicacao

O objeto `state` guarda os estados de runtime, incluindo:

- estado de audio (`audioContext`, `stream`, `analyserL/R`, buffers)
- estado do recognition (`recognition`, `recognitionRunning`)
- estado da entrevista (`entrevistaAtiva`)
- assinaturas calibradas (`assinaturaIndividuo1`, `assinaturaIndividuo2`)
- nomes calibrados (`nomeIndividuo1`, `nomeIndividuo2`)
- buffers de calibracao e timeline acustica
- segmentos marcados e partes da transcricao final
- controle de cortes candidatos no interim
- sessao compartilhada da entrevista (`sessaoEntrevista`)

## 4) Arquitetura de audio (v6)

### 4.1 Sessao compartilhada

A funcao `criarSessaoAudioCompartilhada()` abre **uma unica captura** de microfone e cria:

- `analysisStream`: trilha clonada para analise acustica (WebAudio)
- `sttTrack`: trilha clonada para SpeechRecognition
- `cleanup()`: encerra clones e stream original

Isso reduz divergencia entre o audio medido e o audio usado pelo STT.

### 4.2 Motor de analise

`setupAudioEngine(opcoes)`:

- aceita stream externo (`opcoes.stream`) para usar a trilha de analise da sessao compartilhada
- cria `AudioContext`, split de canais e `AnalyserNode` L/R
- roda loop periodico `capturarFeature()`
- tenta `audioContext.resume()` quando necessario

`capturarFeature()` calcula por frame:

- `vol` (RMS medio)
- `ch` (balanco entre canais)
- `pit` (pitch normalizado por autocorrelacao)
- `zcr` (zero crossing rate)
- `cent` (spectral centroid normalizado)

`teardownAudioEngine()` para loop, tracks e fecha o contexto de audio.

## 5) Fluxo de calibracao

Funcao principal: `calibrar(nome)`.

Fluxo:

1. valida estado (nao pode estar entrevistando/calibrando)
2. cria sessao compartilhada (`criarSessaoAudioCompartilhada`)
3. inicia STT da calibracao com `capturarTranscricaoCalibracao(..., { track })`
4. inicia motor acustico com `setupAudioEngine({ forCalibration: true, stream })`
5. coleta frames por `CALIBRACAO_MS`
6. classifica frames validos com `classificarFramesCalibracao`
7. gera assinatura (`mediaEdesvioFeatures`)
8. salva assinatura/nome do individuo
9. recalcula pesos dinamicos (`atualizarPesosAposCalibracao`)
10. finaliza recursos (`teardownAudioEngine` + `cleanup` da sessao)

Funcoes chave da calibracao:

- `capturarTranscricaoCalibracao`
- `extrairNomeDaCalibracao`
- `normalizarNome`
- `classificarFramesCalibracao`
- `diagnosticarFalhaCalibracao`
- `mediaEdesvioFeatures`

## 6) Fluxo da entrevista

### 6.1 Inicio

Funcao principal: `iniciarEntrevista()`.

Fluxo:

1. valida se as duas calibracoes existem
2. cria sessao compartilhada da entrevista
3. liga analise acustica via `setupAudioEngine({ stream: analysisStream })`
4. limpa estados de saida/interim/cortes
5. inicia recognition com track dedicado: `iniciarRecognition({ track: sttTrack })`
6. marca entrevista ativa e libera controles

### 6.2 Recognition continuo

Funcao principal: `iniciarRecognition(opcoes)`.

- configura `SpeechRecognition` em `pt-BR`, continuo e interim
- tenta `recognition.start(track)` quando suportado
- se nao suportar, faz fallback para `recognition.start()`
- no `onresult`: 
  - `final`: fecha segmento e consolida texto
  - `interim`: atualiza texto parcial e avalia corte
- no `onend`: tenta restart mantendo a mesma estrategia de track/fallback

### 6.3 Segmentacao e classificacao

Funcoes principais:

- `fecharSegmento`: monta janela acustica recente e classifica speaker
- `quebrarSegmentoPorCorteCandidato`: aplica cortes internos quando plausiveis
- `classificarSegmento`: compara distancia para assinaturas calibradas
- `agregarFeaturesSegmento`: agrega features com peso por volume

### 6.4 Finalizacao

Funcao principal: `finalizarEntrevista()`.

Fluxo:

1. marca entrevista inativa
2. aguarda parada do recognition (`aguardarParadaRecognition`)
3. trata interim pendente (`flushInterimFinalSeNecessario`)
4. derruba analise acustica (`teardownAudioEngine`)
5. encerra sessao compartilhada da entrevista (`state.sessaoEntrevista.cleanup()`)
6. atualiza status/controles

## 7) Renderizacao e UX

Funcoes de interface importantes:

- `boot`: wiring inicial dos eventos
- `atualizarEstadoControles`: habilita/desabilita botoes
- `setStatus` e `debug`: feedback visual e tecnico
- `appendSegmentoMarcado` / `renderizarSegmentosMarcados`
- `atualizarTranscricaoFinalUI`
- `alternarModoDebug` / `atualizarModoInterface`

## 8) Envio para IA

`enviarParaIA()` monta o prompt final com:

- transcricao consolidada
- segmentos marcados
- template editavel salvo em `localStorage`

O resultado eh copiado para clipboard para uso em ferramentas de IA.

## 9) Resumo arquitetural

A v6 usa um desenho hibrido de diarizacao + STT:

- STT para texto
- features acusticas para rotular speaker
- sessao compartilhada com clones para reduzir desvio entre medicao e reconhecimento

Esse arranjo melhora consistencia entre calibracao e entrevista e facilita diagnostico via painel de debug.
