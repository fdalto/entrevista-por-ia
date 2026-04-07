Você vai criar um **novo site HTML completo** chamado **`mobile2.html`**, usando como base principal o arquivo **`index6.html`** e, para o envio ao webhook, também usando como referência o arquivo **`mobile.html`**.

## Objetivo geral

O novo `mobile2.html` deve:

* manter o **esquema visual** do `index6.html`
* manter a **estrutura geral da interface**
* manter as **funções de análise de áudio**
* manter as **funções de texto e exibição dos resultados**
* **substituir totalmente** a transcrição via `SpeechRecognition` do Chrome por transcrição remota via **webhook do n8n**
* continuar funcionando com a lógica de **calibração** e **entrevista**
* preservar ao máximo o restante do comportamento do sistema original

---

## Mudança principal

### Remover completamente

* qualquer uso de `SpeechRecognition`
* qualquer uso de `webkitSpeechRecognition`

### Substituir por

* captura local de áudio
* segmentação local dos trechos com base em análise acústica
* envio dos trechos para o **webhook do n8n**
* recebimento do texto transcrito pelo webhook
* processamento desse texto no front-end como antes era feito com o resultado do recognition

---

## Referências obrigatórias

### Base principal de interface e lógica:

* `index6.html`

### Base obrigatória para envio ao webhook:

* `mobile.html`

Do `mobile.html`, reutilize:

* URL do webhook
* autenticação
* formato de envio
* qualidade e configuração do áudio
* modo de envio `multipart/form-data`
* qualquer detalhe necessário para manter compatibilidade com o seu webhook atual

---

## Regras gerais

1. **Não altere desnecessariamente o layout**

   * manter aparência visual semelhante ao `index6.html`
   * manter botões, áreas de texto e organização geral

2. **Não remover a análise de áudio**

   * manter a lógica de extração de features
   * manter a classificação e análise local dos segmentos
   * manter a identificação aproximada de troca de indivíduo

3. **Não usar backend adicional**

   * o front-end deve falar apenas com o webhook já existente

4. **Não simplificar demais**

   * quero um site funcional, não apenas um protótipo mínimo

5. **Entregue o arquivo completo `mobile2.html`**

   * não resumir
   * não omitir partes importantes
   * não entregar pseudocódigo

---

## Nova lógica de calibração

Na calibração:

* manter o tempo atual de **4 segundos**
* gravar o áudio localmente durante esse período
* enviar o áudio da calibração ao webhook do n8n
* receber o texto transcrito
* processar esse texto do mesmo modo que antes era processado o retorno do `SpeechRecognition`
* usar esse texto para descobrir o nome falado na calibração

### Importante

A lógica de:

* extrair nome da frase falada
* salvar nome do indivíduo calibrado
* manter assinatura acústica

deve continuar existindo.

---

## Nova lógica da entrevista

Ao iniciar a entrevista, a ordem agora deve ser invertida:

### Antes

* primeiro vinha a transcrição
* depois a análise

### Agora

* primeiro o sistema faz a **análise local do áudio**
* depois decide **quando fechar um chunk**
* só então envia esse chunk ao webhook para transcrição

---

## Regras de segmentação da entrevista

Durante a entrevista, o sistema deve capturar áudio continuamente e criar chunks para envio ao webhook.

Cada chunk deve ter no máximo **15 segundos**.

O envio deve acontecer:

* quando atingir **15 segundos**
* **ou antes disso** se detectar uma quebra natural por análise acústica

### Critérios para quebrar antes dos 15s

1. houver **pausa de respiração / pausa de fala**
2. houver **troca de assinatura acústica** indicando provável mudança de indivíduo

---

## Comportamento esperado da entrevista

Para cada chunk fechado:

1. o front-end identifica:

   * tempo inicial do segmento
   * tempo final do segmento
   * provável indivíduo
   * features relevantes do trecho

2. envia o chunk ao webhook do n8n

3. recebe o texto transcrito

4. encaixa esse texto no fluxo visual da entrevista

5. atualiza:

   * transcrição final
   * segmentos marcados
   * qualquer área de texto equivalente à lógica do `index6.html`

---

## Processamento do texto recebido

O texto recebido do webhook deve ser tratado no front-end como se fosse o texto final do recognition antigo.

Ou seja:

* deve alimentar a mesma lógica de consolidação textual
* deve ser integrado à interface existente
* deve manter o comportamento de atualização do texto final
* deve continuar compatível com a lógica de segmentação já existente

---

## Requisitos técnicos

### Áudio

* usar a mesma referência de qualidade/configuração do `mobile.html`
* preferir áudio mono
* manter formato leve
* manter envio compatível com o webhook já existente

### Envio

* usar `multipart/form-data`
* usar a mesma autenticação/base do `mobile.html`

### Estrutura

* manter nomes de funções e variáveis do `index6.html` quando isso ajudar a preservar compatibilidade
* mas remover toda dependência do recognition do Chrome

---

## O que quero preservar do index6.html

Preserve o máximo possível destas partes:

* interface visual
* modo debug
* exibição da transcrição
* exibição de segmentos marcados
* lógica de calibração acústica
* cálculo de features
* classificação de segmentos por assinatura
* funções auxiliares de texto e merge
* fluxo de conclusão da entrevista
* prompt final para IA, se existir no arquivo base

---

## O que deve ser adaptado

Adapte para o novo modelo:

* calibração por webhook
* entrevista por chunks enviados ao webhook
* processamento assíncrono das respostas
* fila local de chunks, se necessário
* associação entre chunk enviado e texto recebido
* encaixe temporal do texto transcrito no segmento correspondente

---

## Saída esperada

Crie um único arquivo novo:

**`mobile2.html`**

Ele deve estar pronto para teste, completo e funcional.

Não quero explicação teórica.
Quero o arquivo completo implementado.





