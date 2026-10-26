# claude-ui

Interface para o [Claude Code](https://claude.com/claude-code) no terminal: o `claude` ocupa a maior parte da tela e, ao lado, uma barra lateral lista as conversas abertas na sessão.

```
┌──────────────┬────────────────────────────────────────┐
│ Conversas    │                                        │
│              │                                        │
│ ● refatorar  │     claude                             │
│   api        │                                        │
│ ○ bug login  │                                        │
│              │                                        │
│ [n] nova     │                                        │
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

- `Ctrl-\` alterna o foco entre o sidebar e a conversa (clicar no sidebar também funciona).
- `↑`/`↓` ou `j`/`k` escolhem a conversa, `Enter` a traz para a tela.
- `n` abre uma conversa nova, `x` fecha a selecionada (pede confirmação), `Esc` volta para a conversa.
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

