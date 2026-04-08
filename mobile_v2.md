Você vai criar uma NOVA VERSÃO do projeto em arquivos separados, sem apagar nem alterar o arquivo atual mobile2.html.

OBJETIVO
Criar:
- mobile_v2.html
- mobile_v2.js
- mobile_v2.css

A nova versão deve manter o visual geral e a experiência atual do mobile2.html, mas refatorar profundamente a lógica da ENTREVISTA para ficar mais robusta e simples, reduzindo a chance de gerar áudios defeituosos/corrompidos ou chunks ruins para o webhook n8n.

IMPORTANTE
- NÃO mexa na lógica de calibração além do mínimo necessário para compatibilizar com a nova arquitetura.
- A calibração atual está considerada boa e deve continuar funcionando.
- O foco da refatoração é a etapa de ENTREVISTA.
- Preserve a compatibilidade de uso com o restante do projeto.
- Preserve os textos e labels principais da interface, a menos que seja necessário pequeno ajuste.
- Não remova o modo debug; ao contrário, melhore os logs.
- Não descarte trechos de áudio automaticamente. Se um trecho for fraco, ele deve ser ACUMULADO/FUNDIDO com o próximo, e não perdido.
- Não criar dependências externas.
- Use JavaScript puro, HTML puro e CSS puro.

ARQUITETURA NOVA OBRIGATÓRIA

1) SEPARAÇÃO DE ARQUIVOS
Crie:
- mobile_v2.html com a estrutura HTML
- mobile_v2.css com os estilos
- mobile_v2.js com toda a lógica

No HTML, referencie os arquivos separados corretamente.

2) DUAS ROTAS DE ÁUDIO
Implementar duas rotas de áudio durante a entrevista:

ROTA A - análise local
- Usar o stream bruto vindo do microfone para análise acústica local.
- Tentar capturar em estéreo usando channelCount ideal 2.
- Verificar o channelCount real recebido do dispositivo/browser.
- Se houver 2 canais reais, permitir análise L/R.
- Se vier mono, desativar automaticamente qualquer feature dependente de diferença entre canais.

ROTA B - gravação para envio ao webhook
- Criar um stream derivado em MONO.
- Esse stream mono deve ser criado por downmix do bruto via Web Audio API.
- O MediaRecorder da entrevista deve gravar SOMENTE esse stream mono derivado.
- O webhook n8n deve continuar recebendo áudio mono.

3) CAPTURA EM ESTÉREO, MAS SEM ASSUMIR QUE O DISPOSITIVO ENTREGA ESTÉREO REAL
Ao solicitar microfone:
- usar channelCount ideal 2
- desativar:
  - echoCancellation
  - noiseSuppression
  - autoGainControl

Não use exact: 2.
Use configuração tolerante, para não quebrar em dispositivos que só entregam mono.

Após obter o stream:
- detectar o channelCount real com getSettings() da faixa de áudio, quando disponível
- registrar isso no debug
- caso channelCount real seja 1, desativar feature de canal e cair para modo mono robusto

4) PARAR DE REINICIAR O MEDIARECORDER A CADA CORTE
Isto é crucial.

Na entrevista:
- usar UM MediaRecorder contínuo durante toda a sessão
- não parar/reiniciar o recorder a cada chunk
- iniciar o recorder uma vez ao começar a entrevista
- usar recorder.start com timeslice curto, por exemplo 400ms ou 500ms
- acumular os pedaços em buffer
- quando a lógica decidir fechar um segmento, apenas separar logicamente as partes pertencentes àquele segmento
- o MediaRecorder só deve parar ao final da entrevista

Objetivo:
- evitar corrupção/instabilidade causada por múltiplos ciclos de stop/start

5) SIMPLIFICAR A LÓGICA DE CORTE DA ENTREVISTA
A nova lógica deve priorizar robustez.

A decisão de fechar segmento deve usar principalmente:
- tempo máximo
- silêncio após já existir voz útil

A detecção de troca de speaker NÃO deve mais ser o gatilho principal do corte.

Nova regra:
- speaker change é secundário/opcional/conservador
- o sistema pode usar speaker dominante do segmento como RÓTULO
- não cortar imediatamente ao perceber possível troca
- se implementar corte por troca, ele deve ser bem mais conservador que o atual

RECOMENDAÇÃO:
- manter corte principal por tempo e silêncio
- manter speaker apenas para marcar o segmento
- se houver corte por speaker, só permitir quando:
  - segmento já tiver duração mínima razoável
  - houver voz consistente
  - a mudança persistir por janela maior
  - a confiança mínima seja mais alta que no código atual

Se isso aumentar risco/complexidade, REMOVA totalmente o corte por speaker e mantenha apenas rotulagem de speaker no final do segmento.

6) FEATURES: USAR MENOS, NÃO MAIS
A diarização local deve ser simplificada.

Diretriz:
- manter features simples e relativamente estáveis
- reduzir dependência de features frágeis

Faça assim:
- manter: vol, pit, cent
- zcr pode permanecer apenas com peso pequeno ou opcional
- ch só pode existir se houver estéreo real detectado
- se não houver estéreo real, ch deve ser automaticamente removido do conjunto de features ativas e dos pesos

Crie uma estrutura clara para:
- FEATURE_KEYS_ATIVAS
- pesos dinâmicos
- fallback quando não houver estéreo real

Não invente diarização complexa.
A prioridade é estabilidade, não sofisticação.

7) CHUNKS FRACOS NÃO DEVEM SER DESCARTADOS
Implementar política de fusão/acúmulo.

Criar classificação dos segmentos:
- ok
- fraco
- muito_fraco

Critérios podem considerar:
- duração
- quantidade de frames de voz
- proporção de voz
- tamanho do blob
- contexto do corte

Comportamento:
- ok: envia normalmente
- fraco: não enviar sozinho; guardar para fundir com o próximo
- muito_fraco: também guardar; nunca jogar fora automaticamente
- ao chegar novo segmento, fundir com o pendente e enviar o bloco combinado
- preservar rastreabilidade temporal no debug e nos metadados

IMPORTANTE:
- Se houver trecho pendente no final da entrevista, ele deve ser enviado junto com o último bloco finalizável
- Nunca perder áudio por decisão local

8) BITRATE
Aumentar bitrate do MediaRecorder da entrevista para algo mais robusto.
Sugestão:
- 32000 como padrão

Se necessário, permitir fácil ajuste por constante no topo do arquivo JS.

9) MIME / CONTAINER
Manter estratégia compatível com navegador, mas melhorar rastreabilidade.

Implementar:
- escolha de mime compatível como já existe
- logar no debug:
  - mime escolhido
  - blob.type
  - blob.size
  - channelCount real
  - duração estimada do segmento
  - motivo do corte
  - classificação do segmento (ok/fraco/muito_fraco)
- não mudar radicalmente os formatos, a menos que seja necessário

10) VALIDAÇÃO MAIS RÍGIDA, SEM DESCARTE
Antes de enviar um segmento ao webhook, calcular e registrar:
- duracaoMs
- framesTotal
- framesVoz
- vozRatio
- blob.size
- mimeType
- motivoCorte
- se foi fundido com segmento anterior
- channelCount real
- features médias do segmento
- speaker estimado
- confiança estimada

Mas atenção:
- validação não deve causar perda de áudio
- segmentos ruins devem ser fundidos, não jogados fora

11) CALIBRAÇÃO
A calibração deve continuar funcional e próxima do comportamento atual.
Pode ajustar apenas o necessário para:
- funcionar com a nova estrutura de arquivos
- funcionar com novo setup de áudio
- suportar a eventual ausência de feature ch em mono

Mas:
- não reformule a calibração
- não mude o fluxo principal da calibração
- não complique essa etapa

12) UI / UX
Manter layout parecido com o atual.
Separar CSS em mobile_v2.css.
Manter:
- botões de calibração
- botão iniciar entrevista
- botão finalizar entrevista
- status
- resultado final
- segmentos marcados
- transcrição final corrida
- debug
- prompt da IA
- botão enviar para IA
- botão salvar prompt
- botão modo debug

Pode fazer pequenos refinamentos visuais, mas sem mudar muito a identidade atual.

13) DEBUG MELHORADO
Expandir o debug para ajudar diagnóstico real.

Registrar:
- inicialização da entrevista
- constraints solicitadas
- settings reais do track
- se estéreo real foi obtido
- se feature ch está ativa ou desativada
- mime escolhido
- início/fim lógico de segmentos
- motivo do fechamento do segmento
- métricas do segmento
- classificação ok/fraco/muito_fraco
- quando um segmento foi fundido com outro
- quando algo foi acumulado em buffer pendente
- quando o blob foi enviado
- resposta/resumo do webhook
- erros de processamento
- fechamento final e flush pendente

14) ORGANIZAÇÃO DO JS
No mobile_v2.js, organizar o código em blocos/funções mais claras.
Estrutura sugerida:
- constantes
- cache de elementos
- state
- boot / UI
- utilitários
- setup de áudio
- extração de features
- calibração
- entrevista contínua
- segmentação lógica
- fusão de segmentos fracos
- envio ao webhook
- renderização
- debug

15) REGRAS DA ENTREVISTA NOVA
Implementar a entrevista com esta filosofia:

A) fluxo
- inicia stream
- configura rota de análise
- configura rota mono para gravação
- inicia MediaRecorder contínuo
- acumula partes com timestamps lógicos
- monitor de segmentação roda periodicamente
- ao fechar segmento, recorta logicamente partes do buffer sem parar recorder
- valida
- se fraco, acumula
- se ok, envia
- se houver pendência acumulada, funde antes de enviar

B) corte por tempo e silêncio
- usar constantes ajustáveis
- chunk mínimo um pouco maior que o atual
- chunk máximo previsível
- silêncio só corta se já houve voz suficiente

C) speaker
- speaker serve principalmente como rótulo do segmento
- se implementar corte por troca, seja extremamente conservador
- em caso de dúvida, NÃO cortar por speaker

16) COMPATIBILIDADE
- manter uso de fetch + FormData no webhook
- manter envio com Basic Auth
- manter extração de texto da resposta em formatos variados
- manter compatibilidade com o prompt da IA e localStorage

17) LIMPEZA DE CÓDIGO
- remover código morto
- evitar duplicação
- comentar pontos críticos
- não exagerar nos comentários, mas documentar a nova arquitetura
- deixar fácil manutenção futura

18) ENTREGA ESPERADA
Quero que você:
- crie os 3 novos arquivos
- não altere os arquivos antigos
- escreva código completo, não pseudo-código
- implemente a nova arquitetura funcionando
- ao final, apresente um resumo objetivo:
  - o que mudou
  - como a nova entrevista funciona
  - quais variáveis devo ajustar se eu quiser calibrar sensibilidade
  - quais logs devo observar no debug

19) PONTOS TÉCNICOS IMPORTANTES PARA IMPLEMENTAÇÃO
- O MediaRecorder contínuo deve usar o stream MONO derivado, não o stream bruto
- A análise local deve usar o stream bruto
- A associação entre partes do recorder contínuo e segmentos lógicos deve ser feita por timestamps lógicos no momento da chegada dos chunks do ondataavailable
- Ao montar blob de segmento lógico, usar as partes correspondentes ao intervalo daquele segmento
- Garantir que segmentos consecutivos não percam conteúdo entre fronteiras
- Se houver dúvida na fronteira entre dois segmentos, preferir SOBREPOR levemente ou preservar conteúdo, nunca perder áudio
- No fim da entrevista, fazer flush do que estiver pendente

20) RESTRIÇÕES
- não usar frameworks
- não usar bibliotecas externas
- não mudar o endpoint do webhook
- não mudar o mecanismo de autenticação
- não remover o modo debug
- não simplificar removendo a funcionalidade principal
- não descartar áudio automaticamente

21) SE PRECISAR ESCOLHER ENTRE ROBUSTEZ E SOFISTICAÇÃO
Escolha robustez.

22) SE PRECISAR ESCOLHER ENTRE DETECTAR SPEAKER PERFEITAMENTE E NÃO CORROMPER/FRAGMENTAR O ÁUDIO
Escolha preservar o áudio.

Agora implemente isso criando os novos arquivos:
- mobile_v2.html
- mobile_v2.css
- mobile_v2.js

Use o mobile2.html atual como referência visual e funcional, mas com a nova arquitetura descrita acima.