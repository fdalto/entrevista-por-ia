# Arquitetura do `script_desktop.js`

## Visao geral
- Script front-end para entrevista com 2 speakers.
- Combina Web Audio API (features acusticas), Web Speech API (transcricao), diarizacao por assinatura calibrada e exportacao para IA.
- Estruturas centrais:
  - `els`: cache dos elementos DOM.
  - `state`: estado unico da sessao, com audio, recognition, calibracao, timeline, segmentos, nomes e pesos.

## Fluxo ponta a ponta
1. `boot()` liga listeners, carrega prompt salvo, inicia watchdog e renderiza o estado inicial.
2. `calibrar()` roda duas vezes, uma por participante.
3. `criarSessaoAudioCompartilhada()` cria uma unica captura e clona trilhas para analise acustica e speech recognition.
4. `setupAudioEngine()` e `startFeatureLoop()` passam a coletar features do microfone.
5. `capturarTranscricaoCalibracao()` extrai o nome falado; `mediaEdesvioFeatures()` gera a assinatura acustica.
6. `atualizarPesosAposCalibracao()` recalcula o peso relativo de cada feature.
7. `iniciarEntrevista()` abre captura compartilhada, limpa o estado anterior e chama `iniciarRecognition()`.
8. `capturarFeature()` alimenta `state.timeline`; `avaliarCorteDuranteInterim()` detecta possiveis trocas de speaker durante o interim.
9. Quando chega resultado final, `fecharSegmento()` classifica o trecho e `adicionarTrechoConsolidado()` atualiza a transcricao corrida.
10. `finalizarEntrevista()` para recognition, descarta interim pendente, encerra audio e limpa a sessao.
11. `enviarParaIA()` monta o prompt final e copia para clipboard.

## Catalogo de funcoes

### Bootstrap e UI
- `boot()` (linha 103): ponto de entrada. Registra eventos dos botoes, inicia o watchdog do interim, carrega o prompt salvo e define o estado visual inicial.
- `setStatus(texto)` (linha 120): atualiza a linha principal de status da interface.
- `alternarModoDebug()` (linha 125): alterna entre visual normal e visual detalhado.
- `atualizarModoInterface()` (linha 132): mostra ou esconde painel de debug, editor de prompt e coluna de transcricao final.
- `calibracoesConcluidas()` (linha 144): informa se as duas assinaturas ja foram coletadas.
- `atualizarEstadoControles()` (linha 149): habilita ou bloqueia botoes conforme calibracao e entrevista.
- `travarControles(calibrando)` (linha 785): desabilita botoes de calibracao durante o processo e reaplica o estado geral dos controles.

### Logs e utilitarios
- `debug(texto)` (linha 158): escreve logs no painel visual de debug com timestamp e limitacao de volume.
- `trace(etapa, dados, throttleKey)` (linha 172): envia logs tecnicos ao console com throttle opcional.
- `formatTraceValue(v)` (linha 190): formata numeros, strings e nulos para os traces.
- `clamp(v, min, max)` (linha 204): restringe um numero a um intervalo.
- `textoTemConteudo(texto)` (linha 209): verifica se ha texto util apos `trim()`.
- `prepararTextoTranscricaoFinal(texto)` (linha 214): padroniza o texto antes de entrar na transcricao corrida.

### Prompt e integracao com IA
- `obterTemplatePromptPadrao()` (linha 223): devolve o template padrao do prompt para reorganizacao da conversa por IA.
- `carregarPromptIA()` (linha 273): busca no `localStorage` um prompt salvo e cai no padrao se nao existir.
- `salvarPromptIA()` (linha 284): persiste no `localStorage` o template editado pelo usuario.
- `obterTemplatePromptAtivo()` (linha 297): retorna o template atual do editor ou o padrao.
- `montarPromptComBlocos(template, transcricaoFinal, segmentosMarcados)` (linha 303): injeta os blocos no template e adiciona os blocos no fim se os placeholders nao estiverem presentes.
- `montarPromptParaIA()` (linha 1899): monta um prompt fixo completo a partir da transcricao consolidada e dos segmentos marcados.
- `montarPromptParaIAEditavel()` (linha 1952): usa o template ativo do editor para gerar o prompt final de envio.
- `enviarParaIA()` (linha 1630): gera o prompt editavel, copia para clipboard e atualiza status e debug.
- `copiarTextoParaClipboard(texto)` (linha 1959): tenta copiar com `navigator.clipboard.writeText` e faz fallback se necessario.
- `copiarTextoFallback(texto)` (linha 1973): copia via `textarea` invisivel e `document.execCommand("copy")`.

### Audio, captura e features acusticas
- `obterVetorFeatures(v)` (linha 319): normaliza entradas que podem ser um frame simples ou uma assinatura `{ medias, desvios }`.
- `dist(a, b)` (linha 330): calcula a distancia ponderada entre dois vetores de features usando `state.pesosFeatures`.
- `setupAudioEngine(opcoes)` (linha 344): abre microfone, monta `AudioContext`, `ChannelSplitter`, `AnalyserNode`s e buffers de leitura; pode usar stream externo compartilhado.
- `teardownAudioEngine()` (linha 415): para o loop de features, encerra tracks de audio, fecha o `AudioContext` e limpa referencias.
- `startFeatureLoop()` (linha 441): liga o `setInterval` que chama `capturarFeature()`.
- `stopFeatureLoop()` (linha 449): interrompe o loop periodico de features.
- `capturarFeature()` (linha 458): le canais L/R, calcula features do frame atual, atualiza `state.ultimoFeature`, alimenta `state.timeline` e, durante calibracao, acumula em `state.calibracaoBuffer`.
- `rms(buffer)` (linha 501): calcula energia RMS de um buffer temporal.
- `criarSinalMixado(bufferL, bufferR)` (linha 510): mistura os dois canais em um sinal mono medio.
- `detectarPitchNormalizado(mix, sampleRate)` (linha 519): estima pitch via autocorrelacao e normaliza para 0..1.
- `autoCorrelacaoPitch(buffer, sampleRate)` (linha 531): encontra o melhor lag em faixa tipica de voz e converte para frequencia.
- `calcularZeroCrossingRate(buffer)` (linha 566): mede cruzamentos por zero, uma feature simples de forma de onda.
- `calcularSpectralCentroidNormalizado(analyserL, analyserR, sampleRate)` (linha 582): calcula o centroide espectral medio dos dois canais e normaliza para 0..1.
- `criarSessaoAudioCompartilhada()` (linha 619): faz uma unica captura de microfone, clona a trilha bruta e devolve `analysisStream`, `sttTrack` e `cleanup()` para reutilizar o mesmo audio em analise e STT.

### Calibracao e assinaturas
- `calibrar(nome)` (linha 665): executa a calibracao completa de um participante; captura nome falado, coleta frames acusticos, gera assinatura, salva o nome calibrado e recalcula pesos dinamicos.
- `mediaFeatures(lista)` (linha 792): calcula a media simples de `ch`, `vol`, `pit`, `zcr` e `cent`.
- `agregarFeaturesSegmento(lista)` (linha 818): filtra ou pondera frames por volume para produzir uma media mais robusta do trecho.
- `mediaEdesvioFeatures(lista)` (linha 854): gera a assinatura estatistica da calibracao com medias e desvios por feature.
- `filtrarFramesCalibracao(lista)` (linha 879): atalho que devolve apenas os frames validos da classificacao de calibracao.
- `classificarFramesCalibracao(lista)` (linha 884): separa frames validos e invalidos com base em volume minimo e indicios de voz.
- `diagnosticarFalhaCalibracao(nome, framesBrutos, diagnosticoFrames)` (linha 919): gera logs detalhados quando a calibracao falha por poucos frames de voz aproveitaveis.
- `normalizarPesosComPiso(scores, pesoMin)` (linha 956): transforma scores por feature em pesos normalizados, garantindo piso minimo e soma 1.
- `calcularPesosDinamicos(assinatura1, assinatura2)` (linha 997): calcula o peso relativo de cada feature com base na separacao entre os dois perfis e na variabilidade interna.
- `formatPesos(p)` (linha 1021): monta uma string curta para exibir pesos, scores e diferencas no debug.
- `atualizarPesosAposCalibracao()` (linha 1026): recalcula `state.pesosFeatures` quando as duas calibracoes ja existem.
- `formatFeatures(f)` (linha 1039): formata um vetor de features para leitura humana no debug.
- `capturarTranscricaoCalibracaoLegacy(duracaoMs, opcoes)` (linha 2118): versao antiga da captura de nome; usa speech recognition sem trilha compartilhada e um monitor de silencio separado.
- `capturarTranscricaoCalibracao(duracaoMs, opcoes)` (linha 2286): versao atual da captura de nome; usa speech recognition continuo com `interim` e suporte opcional a `track`.
- `extrairNomeDaCalibracao(texto)` (linha 2386): tenta extrair nome de frases como "meu nome e ...", "eu sou ..." ou "me chamo ...".
- `normalizarNome(nome)` (linha 2414): limpa stopwords simples e normaliza capitalizacao do nome final.

### Entrevista e reconhecimento continuo
- `iniciarEntrevista()` (linha 1047): abre sessao compartilhada de audio, limpa o estado da conversa anterior, inicia `setupAudioEngine()` e aciona o speech recognition continuo.
- `iniciarRecognition(opcoes)` (linha 1123): cria e configura a instancia de `SpeechRecognition`, trata `onresult`, `onerror` e `onend`, e reinicia automaticamente o reconhecimento enquanto a entrevista estiver ativa.
- `aguardarParadaRecognition()` (linha 1658): chama `recognition.stop()` e espera o `onend`, com timeout curto para evitar travamento no encerramento.
- `flushInterimFinalSeNecessario()` (linha 1697): descarta o `interim` pendente ao encerrar a entrevista sem promove-lo a texto oficial.
- `iniciarWatchdogInterim()` (linha 1724): monitora interims que ficaram parados por muito tempo e os limpa sem consolidar.
- `atualizarTranscricaoFinalUI()` (linha 1644): espelha a transcricao consolidada na coluna visual da direita.
- `obterTranscricaoFinalConsolidada()` (linha 1651): monta a string final a partir de `state.transcricaoFinalPartes`.
- `adicionarTrechoConsolidado(texto, origem)` (linha 1746): acrescenta um novo trecho final na transcricao corrida, com merge por sobreposicao quando a normalizacao estiver ativa.
- `combinarComSobreposicao(base, novo)` (linha 1812): detecta duplicacao ou sobreposicao textual entre o fim do bloco anterior e o inicio do novo bloco.
- `finalizarEntrevista()` (linha 1602): encerra recognition, limpa audio, fecha a sessao compartilhada e marca a entrevista como finalizada.

### Segmentacao e classificacao de speaker
- `nomePorLabelInterim(label)` (linha 1271): converte labels 1/2 nos nomes calibrados atuais.
- `classificarLabelInterim(features)` (linha 1282): escolhe o speaker mais provavel para uma janela curta e mede a separacao (`delta`) entre as assinaturas.
- `limparCortesCandidatosAntigos(agora)` (linha 1296): remove cortes muito antigos ou ja consumidos.
- `avaliarCorteDuranteInterim(textoInterim)` (linha 1306): olha a janela acustica recente durante `interim` e cria candidatos de troca de speaker antes do resultado final chegar.
- `quebrarSegmentoPorCorteCandidato(textoFinal, janela)` (linha 1410): se existir um corte candidato valido, divide o texto final em dois subsegmentos e classifica cada lado.
- `fecharSegmento(textoFinal)` (linha 1505): fecha o bloco final reconhecido; tenta usar corte candidato e, se nao conseguir, classifica o bloco inteiro.
- `classificarSegmento(features)` (linha 1545): compara a distancia do trecho para cada assinatura calibrada e devolve `spk`, `conf` e `delta`.
- `appendSegmentoMarcado(seg)` (linha 1573): adiciona visualmente um segmento na coluna da esquerda.
- `formatarLinhaSegmento(seg)` (linha 1582): escolhe a representacao do segmento para modo normal ou modo debug.
- `renderizarSegmentosMarcados()` (linha 1594): refaz toda a coluna de segmentos quando o modo visual muda.
- `marcarSegmentoIndefinido(textoFinal)` (linha 1882): fallback de seguranca que grava um segmento `??` quando algo falha na classificacao.
- `quebrarSegmentoPorTrocaDeSpeaker(textoFinal, janela)` (linha 1993): heuristica alternativa de subsegmentacao por runs de labels; esta presente no codigo, mas nao esta ligada ao fluxo principal atual de `fecharSegmento()`.

### Funcoes locais internas importantes
- `cleanup()` dentro de `criarSessaoAudioCompartilhada()`: fecha `analysisStream`, `sttTrack` e `rawStream`.
- `concluir()` dentro de `aguardarParadaRecognition()`: resolve a espera de parada apenas uma vez e limpa o timeout associado.
- `limparMonitorAudio()` dentro de `capturarTranscricaoCalibracaoLegacy()`: encerra timers, `AudioContext` e stream de monitoramento de silencio.
- `finalizar()` dentro de `capturarTranscricaoCalibracaoLegacy()`: fecha o monitor e resolve somente com texto final.
- `finalizeErrorSafe()` dentro de `capturarTranscricaoCalibracaoLegacy()`: tenta finalizar com seguranca mesmo quando ocorre erro.
- `iniciarMonitorSilencio()` dentro de `capturarTranscricaoCalibracaoLegacy()`: observa RMS do microfone e encerra o recognition apos silencio continuo.
- `finalizar()` dentro de `capturarTranscricaoCalibracao()`: resolve a promessa juntando texto final e `interim` restante.
- `iniciarRecognition()` dentro de `capturarTranscricaoCalibracao()`: tenta iniciar o speech recognition com `track` quando suportado e faz fallback para `start()` comum.

## Funcoes de apoio, legado ou uso indireto
- `filtrarFramesCalibracao()` existe como wrapper utilitario; o fluxo atual usa diretamente `classificarFramesCalibracao()`.
- `montarPromptParaIA()` continua util como template fixo pronto, mas o botao da UI usa `montarPromptParaIAEditavel()`.
- `capturarTranscricaoCalibracaoLegacy()` permanece como referencia de comportamento anterior.
- `quebrarSegmentoPorTrocaDeSpeaker()` implementa uma estrategia alternativa que hoje nao esta chamada pelo caminho principal.

## Observacoes arquiteturais
- O script centraliza tudo em um `state` global. Isso simplifica a pagina unica, mas aumenta o acoplamento entre audio, UI e diarizacao.
- A separacao entre analise acustica e speech recognition e feita por clonagem de trilha em `criarSessaoAudioCompartilhada()`. Esse e um ponto importante da arquitetura porque reduz divergencia entre o audio analisado e o audio transcrito.
- A diarizacao final depende de duas camadas: classificacao do bloco final por assinatura acustica e deteccao antecipada de troca de speaker durante o `interim`.
- O texto final consolidado e propositalmente montado apenas com resultados `final` do recognition. O `interim` serve para corte e observabilidade, nao para virar texto oficial.
- O arquivo mistura regra de negocio, integracao com APIs do navegador e renderizacao DOM no mesmo modulo. Se o projeto crescer, a primeira divisao natural e separar em modulos de `audio`, `transcricao`, `segmentacao` e `ui`.