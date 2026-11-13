# Custom Typeform

Plataforma própria de formulários no estilo Typeform: uma pergunta por tela, atalhos de teclado,
animações, tema por formulário e painel administrativo. **Sem dependências** (só Node ≥ 22.13;
o banco é SQLite embutido no Node).

```
server.js           servidor: painel, formulários públicos, API e webhooks
lib/                banco, autenticação, validação, webhooks, estatísticas
admin/              painel administrativo (lista, editor, resultados)
public/             formulário do respondente (/f/<slug>), pré-visualização e route.js (regras de navegação,
                    compartilhadas por servidor, formulário e painel)
deploy/             systemd e Nginx
scripts/            importador do quiz antigo (vulcan-quiz)
data/               criado sozinho: app.db (tudo), uploads/ (logos e imagens)
```

## Rodar localmente
```
ADMIN_PASSWORD=teste node server.js      # ou: npm run dev
```
Painel: http://127.0.0.1:3000/admin/ · Formulários publicados: http://127.0.0.1:3000/f/<slug>

## O que o painel faz
- **Vários formulários**, cada um com **slug próprio** (`/f/meu-slug`), editável em *Ajustes*. Rascunho ou publicado.
- **Editor** com pré-visualização ao vivo (desktop/celular): adicionar, reordenar (arrastar), duplicar e excluir perguntas.
  **Nada vai ao ar sem salvar**: editar só muda o editor e a pré-visualização; o botão *Salvar* (ou Cmd/Ctrl+S) é que grava.
  Em formulário publicado, salvar publica as alterações na hora.
- **Lógica de navegação**: cada pergunta segue por padrão para a seguinte. Em *Navegação* você define outro destino
  (uma pergunta posterior ou *Finalizar*) e, nas perguntas de escolha única, sim/não e escala, um destino por resposta
  (ex.: responde A → vai para a pergunta 3; responde B → segue para a 2). Só é possível saltar para frente, então não há laços.
  Para quem responde, a contagem continua sequencial (a pergunta 3 aparece como “02”); no sistema a resposta fica
  salva na posição real. Perguntas puladas não são exigidas, mesmo obrigatórias, e as respostas delas são descartadas se a pessoa mudar de rota.
- **14 tipos**: texto curto/longo, e-mail, telefone, número, link, data, cidade/UF, escolha única, **lista suspensa** (pesquisável,
  para muitas opções), múltipla, sim/não, **avaliação** e mensagem. A avaliação tem três estilos: **números** (ex.: NPS de 0 a 10),
  **estrelas** (3 a 10) e **emojis** (3 a 5 carinhas, para satisfação).
- **O tipo da pergunta trava depois que o formulário é aberto** (publicado pela primeira vez): as respostas já recebidas deixariam de fazer sentido.
  Vale também para o estilo e a escala da avaliação. Para outro tipo, crie uma pergunta nova (a antiga pode ser excluída; as respostas viram “passadas”).
- **Aparência**: temas prontos, cores, fonte, cantos, logo, imagem de fundo.
- **Webhook** único por formulário, configurado em *Ajustes*, com duas caixas: **ao concluir o formulário** e/ou **ao responder uma
  pergunta específica** (você escolhe qual). Não dispara a cada pergunta. Assinatura HMAC (`X-Webhook-Signature`), 3 tentativas,
  botões de teste e histórico.
- **Redirecionamento condicional** (*Tela final e redirecionamento*): regras do tipo “pergunta 1 é A **e** pergunta 2 é C **e** pergunta 3 é D
  → URL”. A primeira regra que combinar vence; sem regra, vale a URL padrão (opcional); desligado, a pessoa vê só a **página de obrigado**
  (título, texto e botão editáveis). As URLs aceitam `{chave}` para levar respostas e `{resposta_id}`. Operadores por tipo:
  é / não é, inclui, maior ou menor que (notas), contém.
- **Agenda e encerramento**: abre e encerra em data e hora (fuso do navegador), ou encerre/reabra na hora. Telas próprias de “em breve” e
  “encerrado” (editáveis). Quem já estava preenchendo quando o encerramento agendado chega tem 10 minutos para terminar.
- **Prévia do link** (*Ajustes*): título, descrição e imagem que aparecem ao compartilhar no WhatsApp, Instagram e afins
  (definir `PUBLIC_URL` se o site fica atrás de um proxy que muda o endereço).
- **Dashboard**: visualizações, iniciadas, concluídas, taxa de conclusão, tempo mediano, gráfico por dia,
  funil por pergunta (de quem chegou à pergunta pela própria rota, quantos pararam ali), resultado por pergunta, tabela de respostas (busca, filtro,
  detalhe) e exportação CSV. Atualiza sozinho a cada 20 s.
- **Respostas ativas e passadas**: *ativas* são as dadas a perguntas que ainda estão no formulário; *passadas*, as dadas a
  perguntas que foram excluídas (guardadas, listadas no dashboard e no CSV como “(removida)”).
- No texto: `*palavra*` destaca na cor do tema; `{chave}` cita uma resposta anterior (ex.: `{primeiro_nome}`).
- Pré-preenchimento por URL (ex.: Hotmart) e captura de UTMs/`transaction`/`sck`/`src`/`xcod`.

## Visual
O formulário segue a linguagem da landing BALF 360: fundo preto, laranja sólido com gradiente para dourado nos
destaques, Inter pesada com rótulos em JetBrains Mono, cartões de borda fina e brilhos desfocados. O tema “BALF 360”
é o padrão de novos formulários; em *Aparência* há outros temas, cores (destaque e destaque secundário), fonte, logo e fundo.
Campos opcionais para o clima da referência: etiqueta na boas-vindas e na tela final, nota sob o botão e texto mono no topo.

## Payload dos webhooks
```json
{ "evento": "question.answered", "enviado_em": "...", "formulario": {"id","slug","titulo"},
  "resposta_id": "...", "pergunta": {"id","chave","tipo","rotulo"}, "resposta": "...",
  "respostas": {"chave": "valor"}, "meta": {"utm_source": "..."}, "concluida": false }
```
`form.completed` traz `respostas` completas, `iniciada_em` e `concluida_em`.
Validação da assinatura: `HMAC-SHA256(corpo, segredo)` em hexadecimal, comparado com o valor após `sha256=`.

## Importar o quiz do Vulcan
```
node scripts/import-quiz.js ../vulcan-quiz laboratorio-vulcan
```
Cria um rascunho com as 24 perguntas, o tema Ignis e o logo. Revise e publique no painel.

## Instalação na VPS (Ubuntu/Debian)
1. Instale Node 22.13+ (ex.: via NodeSource) e Nginx.
2. `sudo mkdir -p /opt/custom-typeform && sudo cp -r . /opt/custom-typeform && sudo chown -R www-data /opt/custom-typeform`
3. Copie `deploy/custom-typeform.service` para `/etc/systemd/system/`, troque a senha e:
   `sudo systemctl daemon-reload && sudo systemctl enable --now custom-typeform`
4. Copie `deploy/nginx.conf` para `/etc/nginx/sites-available/custom-typeform`, troque o domínio, ative e gere o HTTPS:
   `sudo ln -s /etc/nginx/sites-available/custom-typeform /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`
   `sudo certbot --nginx -d forms.seudominio.com.br`
5. **Backup**: copie a pasta `data/` (contém `app.db`, `uploads/` e `.secret`).

Com Docker: `docker build -t custom-typeform . && docker run -d -p 127.0.0.1:3000:3000 -v ctf-data:/data -e ADMIN_PASSWORD=... custom-typeform`

## Variáveis de ambiente
| Variável | Padrão | Uso |
|---|---|---|
| `ADMIN_PASSWORD` | — | senha do painel (obrigatória) |
| `PORT` / `HOST` | 3000 / 127.0.0.1 | endereço de escuta |
| `TRUST_PROXY` | 0 | `1` atrás do Nginx (IP real e cookie Secure) |
| `DATA_DIR` | `./data` | onde ficam banco e uploads |
| `SESSION_SECRET` | gerado em `data/.secret` | assina o cookie de sessão |
| `TZ_NAME` | America/Sao_Paulo | fuso dos gráficos por dia |
| `PUBLIC_URL` | do cabeçalho Host | endereço público usado na prévia do link (ex.: `https://forms.seudominio.com.br`) |

## Segurança
Login com limite de tentativas, cookie HttpOnly/SameSite=Strict, checagem de origem nas escritas do painel,
validação de todas as respostas no servidor, limite de envios por IP, campo-armadilha contra robôs,
URLs de webhook, segredos e regras de redirecionamento nunca vão para o navegador do respondente (o servidor decide o destino).

## Próximos passos possíveis
Lógica condicional (“se responder X, vá para Y”), mais tipos (upload, avaliação com estrelas, imagem como opção),
domínio próprio por formulário, múltiplos usuários.

## Quiz com pontuação (matriz, “Outra” na lista suspensa, resultados por pontuação)

- **Matriz (grade):** várias afirmações numa só tela, com as mesmas colunas de resposta. Cada linha recebe uma letra (A, B, C…) e a resposta é salva como `{ "A": "Concordo", … }`.
- **Lista suspensa com “Outra”:** ative “Incluir opção Outra” na pergunta; a pessoa digita a resposta livre.
- **Pontuação e resultados** (item “Pontuação e resultados” no editor): crie variáveis (ex.: oferta, tese, volume, vulcan), regras de pontos por resposta (inclusive por linha de uma matriz) e telas de resultado. O primeiro resultado cujas condições combinarem (de cima para baixo) aparece depois da abertura da tela final; o último, sem condições, vale como padrão. As regras ficam no servidor.
- **Textos:** `{chave}` cita uma resposta; `{chave|min}` deixa a primeira letra minúscula; cada linha de texto da tela final vira um parágrafo.
- **Webhook de conclusão:** além das respostas, envia `pontuacao` (pontos por variável), `tags` (variáveis que atingiram o “marcar quando ≥”) e `resultado` (chave do resultado mostrado). As respostas de matriz chegam como objeto por letra.
- **Dashboard e CSV:** a matriz aparece com a distribuição por linha; o CSV ganha colunas `pontos_<variável>`, `tags` e `resultado`.
