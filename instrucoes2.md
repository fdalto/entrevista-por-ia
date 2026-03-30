# Prompt para o Codex — Site mobile de entrevista com envio em chunks para n8n

Crie um projeto frontend simples, mobile-first, em HTML/CSS/JavaScript puro, para uma página de entrevista com gravação de áudio em celular. Não usar frameworks. O objetivo desta versão é capturar o áudio do entrevistador, gravar a entrevista principal em chunks, fundir o áudio de identificação do entrevistador no início de cada chunk e enviar cada chunk para um webhook do n8n. O n8n fará o restante do fluxo no backend.

## Objetivo da página
A página deve permitir:
1. gravar um pequeno áudio de identificação do entrevistador;
2. iniciar a entrevista;
3. gravar a entrevista em chunks sucessivos;
4. para cada chunk, fundir no início o áudio de identificação do entrevistador;
5. enviar cada chunk fundido ao webhook do n8n;
6. ao finalizar, exibir na tela a transcrição acumulada recebida do backend;
7. permitir copiar a transcrição final.

## Tecnologias
Usar apenas:
- HTML
- CSS
- JavaScript puro

Não usar:
- React
- Vue
- TypeScript
- backend local
- bibliotecas externas sem necessidade real

## Estrutura de arquivos
Criar os arquivos:
- `index.html`
- `style.css`
- `script.js`

## Requisitos gerais
- Interface em português do Brasil
- Layout mobile-first
- Visual limpo, profissional e simples
- Botões grandes para toque em celular
- Estrutura preparada para evolução futura
- Código comentado
- Organização clara e sem excesso de complexidade
- A página deve funcionar em navegador mobile moderno com suporte a:
  - `navigator.mediaDevices.getUserMedia`
  - `MediaRecorder`
  - `fetch`
  - `Blob`
  - `FormData`
  - Web Audio API, se necessário para fusão de áudio

## Interface desejada

### 1. Cabeçalho
No topo da página:
- título: `Entrevista com Transcrição`
- subtítulo: `Grave a identificação do entrevistador e depois inicie a entrevista.`

### 2. Bloco de identificação do entrevistador
Este bloco deve ficar acima dos demais.

Elementos:
- título: `Identificar entrevistador`
- texto de orientação: `Fale: "Meu nome é [seu nome]"`
- botão principal: `Identificar entrevistador`
- área de status desse bloco

Comportamento:
- ao clicar no botão, solicitar microfone se necessário
- gravar um pequeno áudio do entrevistador
- duração curta, por exemplo 4 a 6 segundos, ou permitir clicar novamente para parar
- ao finalizar, guardar esse áudio em memória para uso posterior
- exibir mensagem de sucesso:
  `Identificação do entrevistador registrada com sucesso.`
- exibir estado visual claro:
  - pronto
  - gravando
  - concluído

Importante:
- esse áudio de identificação deve ser armazenado como `Blob` ou estrutura equivalente
- ele será usado para ser fundido no início de cada chunk da entrevista principal

### 3. Bloco principal da entrevista
Elementos:
- botão grande principal: `Iniciar entrevista`
- botão secundário: `Finalizar entrevista`
- botão opcional de reset: `Nova entrevista`
- área de status da entrevista

Regras:
- `Finalizar entrevista` começa desabilitado
- `Nova entrevista` começa oculto ou desabilitado
- ao iniciar:
  - habilitar `Finalizar entrevista`
  - desabilitar ou ocultar `Iniciar entrevista`
  - mostrar status: `Entrevista em andamento`
- ao finalizar:
  - interromper captura
  - parar novos envios
  - exibir a área final de transcrição
  - habilitar botão de copiar
  - exibir `Nova entrevista`

### 4. Área de status durante entrevista
Mostrar:
- indicador visual de gravação, como ponto vermelho
- tempo de gravação em mm:ss
- número de chunks já enviados
- quantidade de respostas recebidas
- status textual amigável

Exemplos:
- `Microfone ativo`
- `Tempo da entrevista: 03:24`
- `Chunks enviados: 4`
- `Respostas recebidas: 4`

### 5. Área final da transcrição
Inicialmente escondida.

Ao finalizar:
- exibir título: `Transcrição da entrevista`
- exibir uma DIV/caixa grande com rolagem contendo toda a transcrição acumulada
- exibir botão: `Copiar transcrição`

Comportamento:
- ao clicar em copiar, copiar todo o texto da transcrição para a área de transferência
- mostrar feedback:
  `Transcrição copiada!`

## Fluxo funcional esperado

### Etapa 1: identificação do entrevistador
- o usuário grava o áudio de identificação
- esse áudio é salvo em memória
- sem esse áudio, a entrevista principal não deve começar
- se o usuário tentar iniciar entrevista sem identificação, mostrar mensagem amigável orientando a gravar primeiro

### Etapa 2: entrevista principal
Ao iniciar a entrevista:
- capturar áudio do microfone
- gravar em chunks periódicos
- usar uma duração de chunk configurável, por exemplo 30 segundos ou 60 segundos
- implementar isso com `MediaRecorder.start(timeslice)` ou outra estratégia equivalente

Para cada chunk:
1. receber o `Blob` original do chunk
2. fundir no início dele o áudio de identificação do entrevistador
3. montar um novo arquivo final contendo:
   - prefixo do entrevistador
   - chunk atual da entrevista
4. enviar esse arquivo fundido ao webhook do n8n via `fetch`

### Etapa 3: resposta do n8n
Assumir que o n8n responderá JSON.
Preparar o frontend para aceitar uma resposta como exemplo:

```json
{
  "ok": true,
  "chunkIndex": 1,
  "transcricao": "Entrevistador: ...\nEntrevistado: ..."
}
```

ou alguma variação semelhante.

A cada resposta bem-sucedida:
- acumular a transcrição em uma string global
- atualizar a DIV de transcrição na tela
- incrementar contador de respostas recebidas

## Integração com n8n

### Requisito importante
No código, criar uma constante configurável no topo do `script.js`, como:

```javascript
const N8N_WEBHOOK_URL = "COLOCAR_URL_AQUI";
```

### Envio
Enviar cada chunk para o n8n usando `fetch` com `FormData`.

Incluir no `FormData` pelo menos:
- o arquivo de áudio fundido
- índice do chunk
- timestamp inicial e final aproximados
- duração do chunk
- alguma flag indicando que o áudio contém prefixo do entrevistador
- opcionalmente identificador da entrevista

Exemplo desejado de campos:
- `audio`
- `chunkIndex`
- `interviewId`
- `chunkStartMs`
- `chunkEndMs`
- `hasInterviewerPrefix`

O nome do arquivo pode ser algo como:
`entrevista_chunk_001.webm`

### Tratamento de resposta
- se a resposta vier com `transcricao`, concatenar no acumulado
- se vier erro, mostrar mensagem amigável e manter registro do erro na interface
- não travar a interface se um chunk falhar
- idealmente manter fila simples e evitar múltiplos envios simultâneos desorganizados

## Requisito essencial: fusão do áudio do entrevistador com cada chunk

Implementar a estrutura para fundir o pequeno áudio de identificação no início de cada chunk antes do envio.

### Importante
A fusão deve gerar um único `Blob` final enviado ao n8n.

Pode ser implementada de uma destas formas:
1. abordagem simples por concatenação de blobs do mesmo tipo MIME, se funcionar no navegador-alvo
2. abordagem mais robusta usando Web Audio API para decodificar e remontar o áudio
3. caso a fusão real fique limitada pela complexidade do container WebM/Opus, deixar uma implementação prática funcional e bem comentada, além de fallback claro

### Prioridade
Prefira uma solução funcional e simples, mas deixe o código preparado e claramente comentado.

Criar funções separadas, como:
- `gravarAudioEntrevistador()`
- `iniciarEntrevista()`
- `finalizarEntrevista()`
- `processarChunk(blobOriginal, chunkIndex)`
- `fundirPrefixoEntrevistadorComChunk(prefixBlob, chunkBlob)`
- `enviarChunkParaN8n(blobFinal, metadados)`
- `adicionarTranscricao(texto)`
- `copiarTranscricao()`
- `resetarEntrevista()`

## Requisitos de robustez
- tratar falta de suporte do navegador
- tratar ausência de permissão do microfone
- tratar falha de gravação
- tratar falha de envio ao n8n
- tratar tentativa de iniciar entrevista sem identificação prévia
- não usar `alert()` desnecessário; preferir mensagens visuais na página
- manter estados claros da interface

## Requisitos de UX
- deixar o usuário entender facilmente a ordem:
  1. identificar entrevistador
  2. iniciar entrevista
  3. finalizar entrevista
  4. copiar transcrição
- destacar visualmente quando estiver gravando
- mostrar feedback após cada etapa
- mostrar um log simples dos chunks enviados e respostas recebidas

## Design
- fundo claro
- cartões com bordas arredondadas
- botões grandes
- botão de iniciar com destaque
- botão de finalizar em destaque secundário
- tipografia simples e legível
- área de transcrição destacada e com rolagem
- largura adaptada a celulares de cerca de 360px em diante

## Simulação e fallback
Se necessário, caso ainda não haja backend real disponível, deixar fácil ativar um modo simulado por constante, por exemplo:

```javascript
const MODO_SIMULADO = false;
```

Se `true`, simular respostas do n8n com transcrições fake.
Se `false`, usar o webhook real.

## Saída esperada
Gerar os 3 arquivos completos:
- `index.html`
- `style.css`
- `script.js`

## Muito importante
- Entregar código funcional e legível
- Comentar os pontos mais delicados
- Já deixar preparado para o n8n encaminhar depois ao Google Speech-to-Text
- Assumir que o frontend só envia o chunk fundido
- A lógica de diarização e renomeação dos speakers ocorrerá depois no backend/n8n
- A página deve apenas:
  - gravar identificação
  - gravar entrevista
  - fundir prefixo com chunk
  - enviar ao n8n
  - exibir a transcrição acumulada recebida
