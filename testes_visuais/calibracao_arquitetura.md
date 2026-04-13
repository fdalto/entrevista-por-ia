# Arquitetura de Calibracao v3

Este documento descreve a arquitetura atual da calibracao dinamica do `visual_test_v3`, para manutencao e evolucao futura.

## Objetivo funcional

A calibracao foi desenhada para melhorar separacao entre classes de audio (silencio vs fala), sem alterar a logica principal de pausa/corte (`shouldCut`) e troca.

Alvos da calibracao:
- nao_fala: abaixo de 15
- silencio basal: perto de 10
- fala estavel (AAAAA): acima de 60
- fala real util: tendencia acima de 70

## Arquivos e responsabilidades

- `testes_visuais/index_test_v3.html`
  - Estrutura da pagina v3.
  - Botoes `GRAVAR` e `TESTE DO SOM`.
  - Barras, indicadores `CORTE`/`TROCA`, canvas, log.
  - Overlay de calibracao com 3 etapas sempre visiveis.

- `testes_visuais/app_env_v3.js`
  - Configuracoes globais, constantes e estado compartilhado (`APP_STATE`).
  - Ganhos/pesos base, limites de ganho e offset, timings e thresholds.
  - Estrutura de `featureState` por feature com `finalGain` e `finalOffset`.
  - Fabricacao de buffers por rodada (`createRoundBuffers`).

- `testes_visuais/render_v3.js`
  - Camada visual: barras, log, indicadores e overlay.
  - Controle de etapa ativa no overlay (`silence`, `aaaa`, `dynamic`).

- `testes_visuais/audio_core_v3.js`
  - Microfone, `AudioContext`, `AnalyserNode`, loop de 50 ms.
  - Extracao de features e composicao de `speechScore`.
  - Aplicacao de normalizacao por feature: `raw * gain + offset`.
  - Log operacional e integracao com coletor de calibracao.
  - Preserva integralmente a regra de `shouldCut` e histerese de fala.

- `testes_visuais/dinamic_cal_v3.js`
  - Protocolo completo do `TESTE DO SOM`.
  - Maquina de estados e fases por rodada.
  - Coleta de amostras por classe.
  - Ajuste de ganho+offset (rodadas 1 e 2).
  - Ajuste de pesos (rodada 3).

## Modelo de normalizacao por feature

As features calibraveis sao:
- `vol`
- `low`
- `move`
- `cent`
- `zcr`

Forma aplicada no core:

```js
score = clamp(rawMapped * finalGain + finalOffset, 0, 100)
```

`pitch` e `rolloff` permanecem sem esta calibracao afim nesta etapa.

## Maquina de estados da calibracao

Estados usados:
- `idle`
- `round1_silence`
- `round1_aaaa`
- `round1_dynamic`
- `round1_apply_gain`
- `round2_silence`
- `round2_aaaa`
- `round2_dynamic`
- `round2_apply_gain`
- `round3_silence`
- `round3_aaaa`
- `round3_dynamic`
- `round3_apply_weights`
- `done`

## Protocolo por rodada

Cada rodada reinicia buffers (audio novo):
1. Silencio (`silenceMs`)
2. AAAAA (`aaaaMs`)
3. Fala normal (`dynamicMs`)
4. Aplicacao do ajuste da rodada

Rodadas:
- Rodada 1: ganho + offset
- Rodada 2: ganho + offset (com dados novos apos rodada 1)
- Rodada 3: pesos

## Coleta de dados

Buffers por rodada contem:
- `trustedSilence`
- `trustedAaaa`
- `trustedSpeech`
- `features.<key>.silence`
- `features.<key>.aaaa`
- `features.<key>.speech`

Regras de coleta:
- Fase silencio: coleta como silencio.
- Fase AAAAA: coleta como `aaaa` e `speech`.
- Fase dinamica: classifica por `speechScore`:
  - `> speechHigh`: speech confiavel
  - `< silenceLow`: silencio confiavel
  - intermediario: ignora para calibracao

## Calibracao de ganho + offset (rodadas 1 e 2)

Para cada feature:
- calcula `silenceMedian`
- calcula `aaaaMedian`
- usa targets:
  - `targetSilence = 10`
  - `targetAaaa = 60`

Sistema afim alvo:
- `silenceMedian * gainTarget + offsetTarget = targetSilence`
- `aaaaMedian * gainTarget + offsetTarget = targetAaaa`

Formula:

```text
gainTarget = (targetAaaa - targetSilence) / (aaaaMedian - silenceMedian)
offsetTarget = targetSilence - gainTarget * silenceMedian
```

Protecao degenerada:
- se `abs(aaaaMedian - silenceMedian) < epsilon`, aplica fallback conservador
- evita explosao de ganho/offset

Suavizacao:

```text
newGain = oldGain * 0.7 + gainTarget * 0.3
newOffset = oldOffset * 0.7 + offsetTarget * 0.3
```

Clamps obrigatorios:
- ganho respeita `GAIN_LIMITS`
- offset respeita `OFFSET_LIMITS` (seguranca)

## Calibracao de pesos (rodada 3)

Para cada feature:
- `medianSpeech`
- `medianSilence`
- `separation = abs(medianSpeech - medianSilence)`

Passos:
1. Ordena features por menor separacao
2. Seleciona 2 piores
3. Reduz pesos dessas 2 pela metade
4. Renormaliza soma para 1
5. Suaviza com pesos antigos
6. Renormaliza novamente

Mantem peso minimo para evitar zerar feature.

## Speech score

Com features calibradas, o score permanece:

```js
weighted =
  volScore * w.vol +
  lowBandScore * w.low +
  movementScore * w.move +
  centroidScore * w.cent +
  zcrScore * w.zcr;

maxFeature = Math.max(volScore, lowBandScore, movementScore);
speechScore = 0.7 * weighted + 0.3 * maxFeature;
```

## Overlay e UX de calibracao

Durante o `TESTE DO SOM`:
- overlay visivel com rodada atual
- 3 etapas sempre visiveis
- etapa ativa destacada (vermelha e maior)
- contador regressivo

Ao finalizar:
- overlay some
- sistema continua gravando normalmente
- ganhos/offsets/pesos finais permanecem aplicados

## Invariantes importantes (nao quebrar)

- Nao alterar regras de `shouldCut`.
- Nao alterar thresholds/histerese de pausa/fala.
- Nao alterar logica principal de TROCA alem do uso das features calibradas.
- Rodada 2 sempre com audio novo.
- Rodada 3 segue sendo apenas de pesos.

## Campos de debug esperados

Em logs de calibracao de ganho (por feature):
- `silenceMedian`
- `aaaaMedian`
- `targetSilence`
- `targetAaaa`
- `oldGain`, `gainTarget`, `newGain`
- `oldOffset`, `offsetTarget`, `newOffset`
- `degenerateFallback`

Em logs de pesos:
- `medians` (speech/silence)
- `separations`
- `worstTwo`
- `newWeights`

Em fechamento da calibracao:
- `finalGains`
- `finalOffsets`
- `finalWeights`

## Sugestoes para evolucao futura

- Ajustar `OFFSET_LIMITS` por feature em vez de limite unico.
- Registrar metricas de qualidade por rodada (ex.: taxa de falso positivo em silencio).
- Persistir perfil de calibracao por dispositivo/ambiente.
- Adicionar botao de reset para retornar aos parametros base.
