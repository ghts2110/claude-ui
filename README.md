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

## Instalação

Precisa ter o [Claude Code](https://claude.com/claude-code) e o [Node 20+](https://nodejs.org) instalados. Depois, cole no terminal:

```sh
git clone https://github.com/ghts2110/claude-ui.git ~/claude-ui
~/claude-ui/install.sh
```

Abra um terminal novo e digite `claude`. Pronto.

O instalador instala o tmux (via Homebrew, se faltar), roda o `npm install` e adiciona ao seu `~/.zshrc` (ou `~/.bashrc`) a função que faz `claude` abrir a interface. Pode rodar de novo sem problema.

Para desfazer: `~/claude-ui/install.sh --remover`.

## Uso

- `claude` abre a interface; argumentos chegam ao Claude Code (`claude --continue`, `claude "corrige o teste"`).
- `command claude` abre o Claude Code puro, sem a interface.
- Rodar `claude` dentro da interface (ou de qualquer tmux) também abre o Claude Code puro.
- Modos não interativos e subcomandos (`-p`, `--version`, `mcp`, `update`, ...) e uso em pipes/scripts rodam o Claude Code puro.
- Sair do Claude Code ou fechar o terminal encerra a interface.
- Cada terminal tem seu próprio servidor tmux, com a config do repo; o `~/.tmux.conf` não é lido.
- O prefixo do tmux fica desligado para os atalhos do Claude Code (como `Ctrl-b`) continuarem funcionando. `Ctrl-Z` fica desativado: suspenderia o claude sem um shell para trazê-lo de volta.

## Desenvolvimento

Testes do launcher: `npm test`.

## Roadmap

1. Base: `claude` abre tmux com sidebar + claude lado a lado; fechar o terminal limpa tudo
2. Várias conversas: criar e alternar pelo sidebar
3. Títulos e status de cada conversa
4. Acabamento: cores, atalhos, mostrar/esconder o sidebar

## Licença

[MIT](LICENSE)

