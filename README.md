# claude-ui

Interface para o [Claude Code](https://claude.com/claude-code) no terminal: o `claude` ocupa a maior parte da tela e, ao lado, uma barra lateral lista as conversas abertas na sessão.

```
┌──────────────┬────────────────────────────────────────┐
│ Conversas    │                                        │
│              │                                        │
│ ● refatorar… │     claude                             │
│ ● corrige o… │                                        │
│ ○ nova conv… │                                        │
│              │                                        │
│ ? ajuda      │                                        │
└──────────────┴────────────────────────────────────────┘
```

## Ideia

- Digitar `claude` no terminal já abre a interface.
- Cada conversa é um `claude` real rodando em segundo plano; escolher uma no sidebar a traz para a área principal sem perder o estado das outras.
- Nada é persistido: ao fechar o terminal, as conversas somem do sidebar.
- `command claude` continua abrindo o Claude Code puro, sem a interface.

## Como funciona

- **tmux** cuida do layout e mantém cada conversa viva em seu próprio pane.
- **Node + [Ink](https://github.com/vadimdemedes/ink)** desenha o sidebar.
- Uma função no `~/.zshrc` troca o `claude` pelo launcher do projeto.

## Requisitos

- macOS ou Linux
- [tmux](https://github.com/tmux/tmux) 3.x — `brew install tmux`
- Node 20+
- Claude Code instalado (`claude` no PATH)

## Instalação

```sh
git clone https://github.com/ghts2110/claude-ui.git ~/claude-ui
cd ~/claude-ui && npm install
```

Adicione ao `~/.zshrc` (ajuste o caminho se clonou em outro lugar):

```sh
claude() { ~/claude-ui/bin/claude-ui "$@"; }
```

Abra um terminal novo e digite `claude`. Argumentos são repassados ao Claude Code (`claude --continue`, `claude "corrige o teste"`).

No sidebar, cada conversa é um `claude` separado; as que não estão na tela continuam rodando.

- O título de cada conversa é a primeira mensagem dela (até lá, "nova conversa"); `/clear` volta ao provisório.
- A bolinha mostra o status: verde quando o Claude terminou, azul quando precisa de você (pergunta, permissão ou aprovação), amarela enquanto trabalha. Vazia quando a conversa ainda não teve mensagem.
- Título e status vêm de hooks do Claude Code, passados com `--settings` (ver `sidebar/hooks.json`). Se você também passar `--settings`, ou desligar hooks nas suas configurações, a conversa fica sem título e sem status.

- `Ctrl-\` alterna o foco entre o sidebar e a conversa.
- `↑`/`↓` ou `j`/`k` escolhem a conversa, `Enter` a traz para a tela. Com o mouse: clique no botão da conversa; a rodinha move a seleção.
- `n` abre uma conversa nova, `x` fecha a selecionada (pede confirmação), `Esc` volta para a conversa.
- De qualquer lugar: `Ctrl-T` abre uma conversa nova e `Ctrl-W` fecha a que está na tela (confirma com `s`). Dentro da interface, esses atalhos deixam de chegar ao Claude Code.
- `h` esconde o sidebar e a conversa ocupa o terminal inteiro; `Ctrl-\` o traz de volta.
- `<` e `>` estreitam e alargam o sidebar; arrastar a borda com o mouse também vale. A largura se mantém ao redimensionar o terminal, até metade dele.
- `?` mostra todos os atalhos.
- Fora `Ctrl-\`, `Ctrl-T` e `Ctrl-W`, os atalhos só valem com o sidebar focado, então os do Claude Code continuam chegando a ele (exceto `Ctrl-Z`, ver abaixo).
- `/exit` numa conversa a tira da lista; na última, fecha a interface.
- Argumentos do `claude` valem só para a primeira conversa; as novas abrem vazias.

- `command claude` abre o Claude Code puro, sem a interface.
- Rodar `claude` dentro da interface (ou de qualquer tmux) também abre o Claude Code puro.
- Modos não interativos e subcomandos (`-p`, `--version`, `mcp`, `update`, ...) e uso em pipes/scripts rodam o Claude Code puro.
- Sair da última conversa ou fechar o terminal encerra a interface.
- Cada terminal tem seu próprio servidor tmux, com a config do repo; o `~/.tmux.conf` não é lido.
- O prefixo do tmux fica desligado para os atalhos do Claude Code (como `Ctrl-b`) continuarem funcionando. `Ctrl-Z` fica desativado: suspenderia o claude sem um shell para trazê-lo de volta.

Testes do launcher: `npm test`.

## Roadmap

1. Base: `claude` abre tmux com sidebar + claude lado a lado; fechar o terminal limpa tudo
2. Várias conversas: criar e alternar pelo sidebar
3. Títulos e status de cada conversa
4. Acabamento: cores, atalhos, mostrar/esconder o sidebar

## Licença

[MIT](LICENSE)

