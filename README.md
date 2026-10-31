# Custom Typeform

Plataforma própria de formulários no estilo Typeform: uma pergunta por tela, atalhos de teclado,
animações, tema por formulário e painel administrativo. **Sem dependências** (só Node ≥ 22.13;
o banco é SQLite embutido no Node).

```
server.js           servidor: painel, formulários públicos, API e webhooks
lib/                banco, autenticação, validação, webhooks, estatísticas
admin/              painel administrativo (lista, editor, resultados)
public/             formulário do respondente (/f/<slug>) e pré-visualização
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
- **13 tipos**: texto curto/longo, e-mail, telefone, número, link, data, cidade/UF, escolha única, múltipla, sim/não, escala e mensagem.
- **Aparência**: temas prontos, cores, fonte, cantos, logo, imagem de fundo.
- **Webhook por pergunta** (opcional em cada uma): dispara quando a pessoa responde e avança, com assinatura HMAC
  (`X-Webhook-Signature`), 3 tentativas, botão de teste e histórico. Também há um webhook de conclusão (*Ajustes*).
- **Dashboard**: visualizações, iniciadas, concluídas, taxa de conclusão, tempo mediano, gráfico por dia,
  funil por pergunta (onde as pessoas abandonam), resultado por pergunta, tabela de respostas (busca, filtro,
  detalhe) e exportação CSV. Atualiza sozinho a cada 20 s.
- No texto: `*palavra*` destaca na cor do tema; `{chave}` cita uma resposta anterior (ex.: `{primeiro_nome}`).
- Pré-preenchimento por URL (ex.: Hotmart) e captura de UTMs/`transaction`/`sck`/`src`/`xcod`.

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

## Segurança
Login com limite de tentativas, cookie HttpOnly/SameSite=Strict, checagem de origem nas escritas do painel,
validação de todas as respostas no servidor, limite de envios por IP, campo-armadilha contra robôs,
URLs de webhook e segredos nunca vão para o navegador do respondente.

## Próximos passos possíveis
Lógica condicional (“se responder X, vá para Y”), mais tipos (upload, avaliação com estrelas, imagem como opção),
domínio próprio por formulário, múltiplos usuários.
