# Arquitetura Mobile2

## Visão geral
O `mobile2.html` é uma aplicação web de entrevista com diarização acústica local para 2 indivíduos e transcrição remota via webhook n8n.

Fluxo macro:
1. Calibra Individuo 1 e Individuo 2 (captura de áudio local + assinatura acústica).
2. Inicia entrevista com captura em chunks independentes (`MediaRecorder`).
3. Decide corte por análise local (pausa, troca de speaker ou limite máximo).
4. Envia chunk ao webhook (`multipart/form-data`, Basic Auth).
5. Recebe texto, classifica speaker, atualiza transcrição final e segmentos.
6. Finaliza entrevista, fecha último chunk e libera recursos.

## Componentes
- Interface: botões de calibração, iniciar/finalizar entrevista, painel de resultados, painel debug, editor de prompt.
- Áudio local: `AudioContext` + `AnalyserNode` para extração de features.
- Segmentação: critérios de corte por duração, pausa e troca de speaker.
- STT remoto: webhook n8n via `fetch` e `FormData`.
- Estado global: objeto `state` controla sessão, calibração, chunks e UI.

## Execução por etapa
### Boot e UI
- `boot()` registra eventos e inicializa estado visual.
- `atualizarEstadoControles()` governa habilitação de botões.
- `atualizarVisualBotaoCalibracao()` mostra status de espera individual por webhook.
- `alternarModoDebug()`/`atualizarModoInterface()` alternam visual normal/debug.

### Calibração
1. `calibrar(nome)` inicia captura de 4s (`gravarBlobDoStream`).
2. Em paralelo local, `setupAudioEngine(...forCalibration=true)` alimenta `state.calibracaoBuffer` com features.
3. Após captura: valida frames de voz (`classificarFramesCalibracao`) e cria assinatura (`mediaEdesvioFeatures`).
4. Atualiza pesos (`atualizarPesosAposCalibracao`).
5. Envia áudio ao webhook (`enviarBlobParaWebhook`) para extrair nome (`extrairNomeDaCalibracao`).
6. Libera recursos (`teardownAudioEngine`).

### Entrevista
1. `iniciarEntrevista()` valida calibração e inicia engine de áudio + `iniciarChunkAtual()`.
2. `iniciarMonitorChunk()` roda timer para avaliar cortes com `avaliarCriterioCorte()`.
3. Quando há corte: `encerrarChunkAtual()` fecha recorder do chunk atual e enfileira envio.
4. `processarSegmentoParaEnvio()` calcula métricas e delega para envio/classificação.
5. `enviarChunkParaWebhookComMarcacao()` chama webhook, classifica speaker (`classificarSegmento`) e escreve UI (`appendSegmentoMarcado`, `adicionarTrechoConsolidado`).
6. `finalizarEntrevista()` encerra último chunk e aguarda fila terminar.

### STT remoto (n8n)
- `enviarBlobParaWebhook()` envia `audio` + metadados no `FormData` com Basic Auth.
- `extrairTextoDaRespostaWebhook()` tenta localizar o texto em formatos JSON variados.

## Mapa de funções (1 a 1)
Status:
- `ativa`: usada no fluxo atual.
- `(legado)`: declarada mas sem uso atual.

| Função | Status | Papel principal |
|---|---|---|
| `boot` | ativa | Inicialização geral e binding de eventos |
| `setStatus` | ativa | Atualiza texto de status principal |
| `debug` | ativa | Log no painel debug + console |
| `alternarModoDebug` | ativa | Alterna modo debug/normal |
| `atualizarModoInterface` | ativa | Ajusta visibilidade por modo |
| `calibracoesConcluidas` | ativa | Verifica pré-requisito para entrevista |
| `atualizarEstadoControles` | ativa | Habilita/desabilita botões |
| `atualizarVisualBotaoCalibracao` | ativa | Feedback visual individual dos botões de calibração |
| `clamp` | ativa | Limita valores numéricos |
| `obterAudioConstraintsCompat` | ativa | Define constraints de áudio |
| `escolherMimeType` | ativa | Escolhe mime suportado para gravação |
| `nomeArquivo` | ativa | Define nome de arquivo por mime |
| `rms` | ativa | Calcula RMS do frame |
| `criarSinalMixado` | ativa | Cria sinal mono médio (L/R) |
| `calcularZeroCrossingRate` | ativa | Feature ZCR |
| `detectarPitchNormalizado` | ativa | Feature de pitch normalizado |
| `calcularCentroidNormalizado` | ativa | Feature de centroid espectral |
| `extrairFeatureFrame` | ativa | Extrai frame acústico completo |
| `setupAudioEngine` | ativa | Inicia pipeline de análise acústica |
| `teardownAudioEngine` | ativa | Encerra pipeline de análise acústica |
| `mediaEdesvioFeatures` | ativa | Gera assinatura acústica (médias/desvios) |
| `formatFeatures` | ativa | Formatação para debug |
| `classificarFramesCalibracao` | ativa | Filtra frames válidos de calibração |
| `atualizarPesosAposCalibracao` | ativa | Recalibra pesos por separabilidade |
| `dist` | ativa | Distância ponderada para assinatura |
| `classificarSegmento` | ativa | Classificação final de speaker por chunk |
| `nomePorLabel` | ativa | Mapeia label 1/2 para nome calibrado |
| `classificarLabelInterim` | ativa | Label acústico instantâneo para troca |
| `agregarFeaturesSegmento` | ativa | Média de features do trecho |
| `prepararTextoTranscricaoFinal` | ativa | Normalização básica de texto |
| `normalizarTokenNome` | ativa | Capitalização de token de nome |
| `contemLetraLatina` | ativa | Validação de script latino |
| `normalizarNomeExtraido` | ativa | Limpa/normaliza candidato a nome |
| `extrairNomeDaCalibracao` | ativa | Extrai nome a partir da transcrição da calibração |
| `adicionarTrechoConsolidado` | ativa | Adiciona texto na transcrição corrida |
| `atualizarTranscricaoFinalUI` | ativa | Render da transcrição final |
| `appendSegmentoMarcado` | ativa | Render de um segmento marcado |
| `renderizarSegmentosMarcados` | ativa | Re-render completo de segmentos |
| `resetarSaidaEntrevista` | ativa | Limpa estado/UI de saída |
| `montarPromptComBlocos` | ativa | Monta prompt para IA |
| `carregarPromptIA` | ativa | Carrega prompt salvo |
| `salvarPromptIA` | ativa | Salva prompt personalizado |
| `enviarParaIA` | ativa | Gera/copia prompt final |
| `extrairTextoDaRespostaWebhook` | ativa | Extrai texto de payloads variados |
| `enviarBlobParaWebhook` | ativa | POST multipart ao n8n |
| `gravarBlobDoStream` | ativa | Grava blob por duração fixa |
| `calibrar` | ativa | Fluxo completo de calibração |
| `iniciarChunkAtual` | ativa | Inicia gravação do chunk corrente |
| `avaliarTrocaSpeakerChunk` | ativa | Detecta troca de speaker por janela acústica |
| `calcularMetricasChunk` | ativa | Métricas de qualidade do chunk |
| `encerrarChunkAtual` | ativa | Fecha chunk e enfileira processamento |
| `avaliarCriterioCorte` | ativa | Decide motivo de corte do chunk |
| `iniciarMonitorChunk` | ativa | Loop de monitoramento de corte |
| `processarSegmentoParaEnvio` | ativa | Ponte para envio/classificação |
| `enviarChunkParaWebhookComMarcacao` | ativa | Pipeline final de STT + diarização + UI |
| `iniciarEntrevista` | ativa | Inicializa sessão de entrevista |
| `finalizarEntrevista` | ativa | Encerra sessão e flush final |

## Observações técnicas atuais
- O fluxo depende fortemente da qualidade de áudio capturado e do retorno do webhook.
- `spk="ruído?"` é usado para chunks fracos (baixo conteúdo de voz), preservando rastreabilidade.
- A fila `chunkUploadQueue` mantém ordem temporal de envio e integração textual.
