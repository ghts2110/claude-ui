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

## Como rodar

_Em construção._

## Roadmap

1. Base: `claude` abre tmux com sidebar + claude lado a lado; fechar o terminal limpa tudo
2. Várias conversas: criar e alternar pelo sidebar
3. Títulos e status de cada conversa
4. Acabamento: cores, atalhos, mostrar/esconder o sidebar

## Licença

[MIT](LICENSE)
