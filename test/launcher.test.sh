#!/bin/sh
# Testes do launcher com um `claude` falso. Uso: npm test

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
TMP=$(mktemp -d)
FAKE="$TMP/bin"
export CLAUDE_UI_SOCKET="claude-ui-test-$$"
mkdir -p "$FAKE"
trap 'tmux -L "$CLAUDE_UI_SOCKET" kill-server 2>/dev/null' EXIT

# claude falso: grava argumentos e ambiente, depois espera.
cat > "$FAKE/claude" <<FAKE
#!/bin/sh
printf '%s\n' "\$@" > "$TMP/args"
echo "CLAUDE_UI=\$CLAUDE_UI" > "$TMP/env"
sleep "\${FAKE_SLEEP:-0}"
FAKE
chmod +x "$FAKE/claude"

falhas=0
ok() { echo "ok   - $1"; }
falha() { echo "FAIL - $1"; falhas=$((falhas + 1)); }
servidor_vivo() { tmux -L "$CLAUDE_UI_SOCKET" ls >/dev/null 2>&1; }

# Abre o launcher num pty de 120x30, em segundo plano.
abrir() {
	FAKE_SLEEP=$1; shift
	FAKE_SLEEP=$FAKE_SLEEP PATH="$FAKE:$PATH" TMUX= CLAUDE_UI= \
		script -q /dev/null sh -c 'stty cols 120 rows 30; exec "$0" "$@"' \
		"$ROOT/bin/claude-ui" "$@" </dev/null >/dev/null 2>&1 &
	PID=$!
	sleep 2
}

# Dentro da interface: roda o claude puro.
: > "$TMP/args"
PATH="$FAKE:$PATH" CLAUDE_UI=1 "$ROOT/bin/claude-ui" --version
[ "$(cat "$TMP/args")" = "--version" ] && ! servidor_vivo \
	&& ok "dentro da interface roda o claude puro" \
	|| falha "dentro da interface roda o claude puro"

# Fora de um terminal ou em modo não interativo: claude puro.
: > "$TMP/args"
echo | PATH="$FAKE:$PATH" TMUX= CLAUDE_UI= "$ROOT/bin/claude-ui" -p oi | cat
[ "$(cat "$TMP/args" | tr '\n' ' ')" = "-p oi " ] && ! servidor_vivo \
	&& ok "em pipe roda o claude puro" || falha "em pipe roda o claude puro"
: > "$TMP/args"
PATH="$FAKE:$PATH" TMUX= CLAUDE_UI= script -q /dev/null "$ROOT/bin/claude-ui" mcp list </dev/null >/dev/null 2>&1
[ "$(cat "$TMP/args" | tr '\n' ' ')" = "mcp list " ] && ! servidor_vivo \
	&& ok "subcomando roda o claude puro" || falha "subcomando roda o claude puro"

# Sem tmux: mensagem clara.
SEM_TMUX="$TMP/sem-tmux"; mkdir -p "$SEM_TMUX"
ln -s "$FAKE/claude" "$SEM_TMUX/claude"
PATH="$SEM_TMUX:/usr/bin:/bin" TMUX= CLAUDE_UI= \
	script -q "$TMP/saida" "$ROOT/bin/claude-ui" </dev/null >/dev/null 2>&1
saida=$(cat "$TMP/saida")
echo "$saida" | grep -q "tmux não encontrado" \
	&& ok "sem tmux mostra mensagem" || falha "sem tmux mostra mensagem: $saida"

# Layout e argumentos.
abrir 30 --model opus "olá mundo" ";" "x;" '$HOME' '\;' 'dir#S'
panes=$(tmux -L "$CLAUDE_UI_SOCKET" list-panes -a -F '#{pane_left}:#{pane_width}' | tr '\n' ' ')
[ "$panes" = "0:24 25:95 " ] && ok "sidebar à esquerda e claude no resto" \
	|| falha "layout inesperado: $panes"
esperado=$(printf '%s\n' --model opus "olá mundo" ";" "x;" '$HOME' '\;' 'dir#S')
[ "$(cat "$TMP/args")" = "$esperado" ] && ok "argumentos chegam ao claude" \
	|| falha "argumentos: $(cat "$TMP/args" | tr '\n' '|')"
grep -q "CLAUDE_UI=1" "$TMP/env" && ok "claude roda marcado como dentro da interface" \
	|| falha "CLAUDE_UI não chegou ao claude"

tmux -L "$CLAUDE_UI_SOCKET" resize-window -x 180 -y 30
sleep 1
largura=$(tmux -L "$CLAUDE_UI_SOCKET" list-panes -a -F '#{pane_left}:#{pane_width}' | head -1)
[ "$largura" = "0:24" ] && ok "sidebar mantém a largura ao redimensionar" \
	|| falha "sidebar ao redimensionar: $largura"

# Fechar o terminal encerra tudo.
kill -HUP "$PID"; wait "$PID" 2>/dev/null; sleep 1
servidor_vivo && falha "fechar o terminal encerra tudo" || ok "fechar o terminal encerra tudo"

# Sair do claude fecha a interface.
abrir 1
sleep 1
servidor_vivo && falha "sair do claude fecha a interface" || ok "sair do claude fecha a interface"

rm -r "$TMP"
[ $falhas -eq 0 ]
