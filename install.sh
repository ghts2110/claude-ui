#!/bin/sh
# Instala o claude-ui: confere as dependências, roda o npm install e faz o
# comando `claude` abrir a interface. Uso: ./install.sh  (ou ./install.sh --remover)

set -e

ROOT=$(cd "$(dirname "$0")" && pwd -P)
INICIO="# >>> claude-ui >>>"
FIM="# <<< claude-ui <<<"

case $(basename "${SHELL:-zsh}") in
	bash) RC="$HOME/.bashrc" ;;
	*) RC="$HOME/.zshrc" ;;
esac

# Tira o bloco do claude-ui do arquivo de config do shell, se existir.
remover_bloco() {
	[ -f "$RC" ] || return 0
	awk -v i="$INICIO" -v f="$FIM" '$0 == i {pula = 1} !pula {print} $0 == f {pula = 0}' \
		"$RC" > "$RC.claude-ui.tmp"
	cat "$RC.claude-ui.tmp" > "$RC"
	rm "$RC.claude-ui.tmp"
}

if [ "$1" = "--remover" ]; then
	remover_bloco
	echo "Pronto: o claude-ui foi removido de $RC."
	echo "Abra um terminal novo e o 'claude' volta a ser o Claude Code puro."
	exit 0
fi

falta=0
if ! command -v claude >/dev/null 2>&1; then
	echo "✗ Claude Code não encontrado. Instale: https://claude.com/claude-code"
	falta=1
fi
if ! command -v tmux >/dev/null 2>&1; then
	if command -v brew >/dev/null 2>&1; then
		echo "→ Instalando o tmux com o Homebrew..."
		brew install tmux
	else
		echo "✗ tmux não encontrado. Instale o tmux 3.x (ex.: 'brew install tmux' ou 'sudo apt install tmux')."
		falta=1
	fi
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
	echo "✗ Node não encontrado. Instale o Node 20+: https://nodejs.org"
	falta=1
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
	echo "✗ Node $(node -v) é antigo demais. Instale o Node 20+: https://nodejs.org"
	falta=1
fi
if [ $falta -ne 0 ]; then
	echo "Instale o que falta e rode ./install.sh de novo."
	exit 1
fi

echo "→ Instalando as dependências do sidebar..."
(cd "$ROOT" && npm install --silent --no-fund --no-audit)

remover_bloco
cat >> "$RC" <<EOF
$INICIO
# 'claude' abre a interface; 'command claude' abre o Claude Code puro.
claude() { "$ROOT/bin/claude-ui" "\$@"; }
$FIM
EOF

echo "✓ Pronto! Abra um terminal novo e digite 'claude'."
echo "  Para desfazer: $ROOT/install.sh --remover"
