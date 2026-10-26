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
trap 'kill \$!; exit 0' TERM
sleep "\${FAKE_SLEEP:-0}" & wait \$!
FAKE
chmod +x "$FAKE/claude"

falhas=0
ok() { echo "ok   - $1"; }
falha() { echo "FAIL - $1"; falhas=$((falhas + 1)); }
T() { tmux -L "$CLAUDE_UI_SOCKET" "$@"; }
servidor_vivo() { T ls >/dev/null 2>&1; }

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
panes=$(T list-panes -a -F '#{pane_left}:#{pane_width}' | tr '\n' ' ')
[ "$panes" = "0:24 25:95 " ] && ok "sidebar à esquerda e claude no resto" \
	|| falha "layout inesperado: $panes"
esperado=$(printf '%s\n' --model opus "olá mundo" ";" "x;" '$HOME' '\;' 'dir#S')
[ "$(cat "$TMP/args")" = "$esperado" ] && ok "argumentos chegam ao claude" \
	|| falha "argumentos: $(cat "$TMP/args" | tr '\n' '|')"
grep -q "CLAUDE_UI=1" "$TMP/env" && ok "claude roda marcado como dentro da interface" \
	|| falha "CLAUDE_UI não chegou ao claude"

T resize-window -x 180 -y 30
sleep 1
largura=$(T list-panes -a -F '#{pane_left}:#{pane_width}' | head -1)
[ "$largura" = "0:24" ] && ok "sidebar mantém a largura ao redimensionar" \
	|| falha "sidebar ao redimensionar: $largura"

# Conversas pelo sidebar.
sb=$(T show -v @sidebar)
tecla() { T select-pane -t "$sb"; sleep 0.3; T send-keys -t "$sb" "$1"; sleep 1.5; }
conversas() { T list-panes -s -t claude-ui -F '#{@conversa}' | grep . | sort -n | tr '\n' ' '; }
na_tela() { T list-panes -t "$sb" -F '#{@conversa}' | grep .; }
# Encerra o claude da conversa, como um /exit.
sair() {
	pane=$(T list-panes -s -t claude-ui -F '#{@conversa} #{pane_id}' | awk -v n="$1" '$1 == n { print $2 }')
	pkill -P "$(T display -p -t "$pane" '#{pane_pid}')"
	sleep 1
}

tecla n; tecla n
[ "$(conversas)" = "1 2 3 " ] && [ "$(na_tela)" = 3 ] \
	&& ok "n cria conversa na área principal" || falha "n: $(conversas)/$(na_tela)"
tecla Up; tecla Enter
[ "$(na_tela)" = 2 ] && [ "$(T display -p '#{@conversa}')" = 2 ] \
	&& ok "enter traz a conversa para a tela" || falha "enter: $(na_tela)"
tecla x; tecla s
[ "$(conversas)" = "1 3 " ] && [ "$(na_tela)" = 3 ] \
	&& ok "x fecha a conversa e outra assume" || falha "x: $(conversas)/$(na_tela)"
sair 1
[ "$(conversas)" = "3 " ] && [ "$(na_tela)" = 3 ] \
	&& ok "conversa encerrada some da lista" || falha "exit: $(conversas)/$(na_tela)"
tecla x; tecla s
[ "$(conversas)" = "4 " ] && [ "$(na_tela)" = 4 ] \
	&& ok "fechar a última abre uma nova" || falha "fechar a última: $(conversas)/$(na_tela)"
tecla n; sair 5
[ "$(conversas)" = "4 " ] && [ "$(na_tela)" = 4 ] \
	&& ok "encerrar a conversa na tela traz outra" || falha "exit na tela: $(conversas)/$(na_tela)"
tecla n
[ "$(T display -p -t "$sb" '#{mouse_sgr_flag}')" = 1 ] && ok "sidebar recebe o mouse" \
	|| falha "sidebar não pediu o mouse"
# Clique esquerdo no primeiro botão (linha 4).
T send-keys -t "$sb" -l "$(printf '\033[<0;5;4M')"; sleep 1.5
[ "$(na_tela)" = 4 ] && ok "clique traz a conversa para a tela" || falha "clique: $(na_tela)"

# Fechar o terminal encerra tudo.
kill -HUP "$PID"; wait "$PID" 2>/dev/null; sleep 1
servidor_vivo && falha "fechar o terminal encerra tudo" || ok "fechar o terminal encerra tudo"

# Sair do claude fecha a interface.
abrir 1
sleep 1
servidor_vivo && falha "sair do claude fecha a interface" || ok "sair do claude fecha a interface"

rm -r "$TMP"
[ $falhas -eq 0 ]
