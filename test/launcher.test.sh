#!/bin/sh
# Testes do launcher com um `claude` falso. Uso: npm test

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
TMP=$(mktemp -d)
FAKE="$TMP/bin"
export CLAUDE_UI_SOCKET="claude-ui-test-$$"
mkdir -p "$FAKE"
trap 'tmux -L "$CLAUDE_UI_SOCKET" kill-server 2>/dev/null' EXIT

# claude falso: responde versão e plano (para o cabeçalho), grava argumentos e
# ambiente, depois espera.
cat > "$FAKE/claude" <<FAKE
#!/bin/sh
case "\$1" in
	--version) echo '9.9.9 (Claude Code)'; exit ;;
	auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}'; exit ;;
esac
[ -n "\$FAKE_LOGO" ] && printf ' ▐▛█  Claude Code v9.9.9\n▝▜██  Modelo · Claude Max\n ▝▝   ~/projeto\n'
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
	FAKE_SLEEP=$FAKE_SLEEP FAKE_LOGO=1 PATH="$FAKE:$PATH" TMUX= CLAUDE_UI= \
		script -q /dev/null sh -c 'stty cols 120 rows 30; exec "$0" "$@"' \
		"$ROOT/bin/claude-ui" "$@" </dev/null >/dev/null 2>&1 &
	PID=$!
	sleep 2
}

# Dentro da interface: roda o claude puro.
: > "$TMP/args"
PATH="$FAKE:$PATH" CLAUDE_UI=1 "$ROOT/bin/claude-ui" -v
[ "$(cat "$TMP/args")" = "-v" ] && ! servidor_vivo \
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
abrir 90 --model opus "olá mundo" ";" "x;" '$HOME' '\;' 'dir#S'
panes=$(T list-panes -t "$(T show -v @sidebar)" -F '#{pane_left}:#{pane_width}' | tr '\n' ' ')
[ "$panes" = "0:24 25:95 " ] && ok "sidebar à esquerda e claude no resto" \
	|| falha "layout inesperado: $panes"
esperado=$(printf '%s\n' --settings "$ROOT/sidebar/hooks.json" --model opus "olá mundo" ";" "x;" '$HOME' '\;' 'dir#S')
[ "$(cat "$TMP/args")" = "$esperado" ] && ok "argumentos chegam ao claude" \
	|| falha "argumentos: $(cat "$TMP/args" | tr '\n' '|')"
grep -q "CLAUDE_UI=1" "$TMP/env" && ok "claude roda marcado como dentro da interface" \
	|| falha "CLAUDE_UI não chegou ao claude"

# Cabeçalho fixo acima da conversa, copiando o logo do claude, só depois que
# o logo original rola para fora (Enter ecoa linhas em branco no claude falso).
cab=$(T show -v @cabecalho)
janela() { T display -p -t "$1" '#{window_id}'; }
[ "$(janela "$cab")" != "$(janela "$(T show -v @sidebar)")" ] \
	&& ok "sem cabeçalho com o logo original na tela" || falha "cabeçalho com o logo na tela"
conversa=$(T list-panes -a -F '#{pane_id} #{@conversa}' | awk '$2 { print $1 }')
for _ in $(seq 40); do T send-keys -t "$conversa" Enter; done
sleep 1.5
geometria=$(T display -p -t "$cab" '#{pane_left}:#{pane_top}:#{pane_height}')
[ "$geometria" = "25:0:3" ] && ok "cabeçalho acima da conversa" || falha "cabeçalho: $geometria"
T capture-pane -p -t "$cab" | head -1 | grep -q "Claude Code v9.9.9" \
	&& T capture-pane -p -t "$cab" | grep -q "Modelo · Claude Max" \
	&& ok "cabeçalho copia o logo do claude" || falha "logo: $(T capture-pane -p -t "$cab")"
T capture-pane -p -t "$cab" | head -1 | grep -q "^ ▐▛█" && ok "logo mantém o alinhamento" \
	|| falha "alinhamento: $(T capture-pane -p -t "$cab" | head -1)"
T resize-window -x 120 -y 50; sleep 1; T resize-window -x 120 -y 20; sleep 1
[ "$(T display -p -t "$cab" '#{pane_height}')" = 3 ] && ok "cabeçalho mantém 3 linhas ao redimensionar" \
	|| falha "altura do cabeçalho: $(T display -p -t "$cab" '#{pane_height}')"
T resize-window -x 120 -y 30; sleep 1
T select-pane -t "$cab"; sleep 1
[ -n "$(T display -p '#{@conversa}')" ] && ok "foco no cabeçalho passa para a conversa" \
	|| falha "foco ficou em $(T display -p '#{pane_id}')"

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
[ "$(janela "$cab")" != "$(janela "$sb")" ] && [ "$(T display -p -t "$sb" '#{window_height}')" = 30 ] \
	&& ok "conversa nova na tela tira o cabeçalho" || falha "cabeçalho na conversa nova"
tecla Up; tecla Enter
[ "$(na_tela)" = 2 ] && [ "$(T display -p '#{@conversa}')" = 2 ] \
	&& ok "enter traz a conversa para a tela" || falha "enter: $(na_tela)"
tecla x; tecla s
[ "$(conversas)" = "1 3 " ] && [ "$(na_tela)" = 3 ] && [ "$(T display -p '#{@conversa}')" = 3 ] \
	&& ok "x fecha a conversa e o foco vai para a que assume" || falha "x: $(conversas)/$(na_tela)"
# Cursor deixado em outra conversa: ao voltar ao sidebar, x mira a da tela.
T set -p -t "$(T list-panes -t "$sb" -F '#{pane_id}' | tail -1)" @titulo terceira
tecla Up; T select-pane -t "$(T list-panes -t "$sb" -F '#{pane_id}' | tail -1)"; sleep 0.5
tecla x
T capture-pane -p -t "$sb" | grep -q "fechar terceira?" \
	&& ok "x mira a conversa na tela" || falha "x mira: $(T capture-pane -p -t "$sb" | grep fechar)"
tecla Escape
sair 1
[ "$(conversas)" = "3 " ] && [ "$(na_tela)" = 3 ] \
	&& ok "conversa encerrada some da lista" || falha "exit: $(conversas)/$(na_tela)"
tecla x; tecla s
[ "$(conversas)" = "4 " ] && [ "$(na_tela)" = 4 ] \
	&& ok "fechar a última abre uma nova" || falha "fechar a última: $(conversas)/$(na_tela)"
tecla n; sair 5
[ "$(conversas)" = "4 " ] && [ "$(na_tela)" = 4 ] \
	&& ok "encerrar a conversa na tela traz outra" || falha "exit na tela: $(conversas)/$(na_tela)"
# Atalhos como se digitados no terminal.
cliente=$(T list-clients -F '#{client_name}')
atalho() { T send-keys -K -c "$cliente" "$1"; sleep 1.5; }
atalho C-t
[ "$(conversas)" = "4 6 " ] && [ "$(na_tela)" = 6 ] && [ "$(T display -p '#{@conversa}')" = 6 ] \
	&& ok "ctrl-t abre conversa nova" || falha "ctrl-t: $(conversas)/$(na_tela)"
atalho C-w; atalho n
[ "$(conversas)" = "4 6 " ] && ok "ctrl-w n não fecha" || falha "ctrl-w n: $(conversas)"
atalho C-w; atalho s
[ "$(conversas)" = "4 " ] && [ "$(na_tela)" = 4 ] && [ "$(T display -p '#{@conversa}')" = 4 ] \
	&& ok "ctrl-w s fecha a conversa da tela" || falha "ctrl-w s: $(conversas)/$(na_tela)"
zoom() { T display -p -t "$sb" '#{window_zoomed_flag}'; }
largura() { T display -p -t "$sb" '#{pane_width}'; }
tecla n; tecla h
[ "$(zoom)" = 1 ] && [ "$(T display -p '#{pane_id}')" != "$sb" ] \
	&& ok "h esconde o sidebar" || falha "h: zoom=$(zoom)"
sair 7
[ "$(zoom)" = 1 ] && [ "$(na_tela)" = 4 ] \
	&& ok "sidebar continua escondido quando a conversa sai" || falha "escondido: zoom=$(zoom)/$(na_tela)"
atalho 'C-\'
[ "$(zoom)" = 0 ] && [ "$(T display -p '#{pane_id}')" = "$sb" ] \
	&& ok "ctrl-\\ traz o sidebar de volta" || falha "ctrl-\\: zoom=$(zoom)"
atalho 'C-\'
[ -n "$(T display -p '#{@conversa}')" ] && ok "ctrl-\\ volta para a conversa, não para o cabeçalho" \
	|| falha "ctrl-\\ foi para $(T display -p '#{pane_id}')"
atalho 'C-\'
tecla '>'; tecla '>'
T resize-window -x 150 -y 30; sleep 1
[ "$(largura)" = 28 ] && ok "> alarga o sidebar e a largura se mantém" || falha "largura: $(largura)"
tecla h; T resize-window -x 180 -y 30; sleep 1; atalho 'C-\'
[ "$(largura)" = 28 ] && ok "largura volta com o sidebar" || falha "largura após esconder: $(largura)"
tecla '<'
[ "$(largura)" = 26 ] && ok "< estreita o sidebar" || falha "<: $(largura)"
T resize-window -x 44 -y 30; sleep 1
[ "$(largura)" = 22 ] && ok "sidebar vai até metade da janela" || falha "metade: $(largura)"
T resize-window -x 180 -y 30; sleep 1
[ "$(largura)" = 26 ] && ok "janela larga devolve a largura escolhida" || falha "devolve: $(largura)"
T list-keys -T root MouseDragEnd1Pane >/dev/null 2>&1 && T list-keys -T root MouseDragEnd1Border >/dev/null 2>&1 \
	&& ok "arrastar a borda guarda a largura" || falha "arrasto sem bind"
tecla '?'
T capture-pane -p -t "$sb" | grep -q "esconder" && ok "? mostra os atalhos" \
	|| falha "ajuda: $(T capture-pane -p -t "$sb")"
tecla Escape
T capture-pane -p -t "$sb" | grep -q "Conversas" && ok "esc fecha a ajuda" || falha "fechar ajuda"
tecla n
[ "$(T display -p -t "$sb" '#{mouse_sgr_flag}')" = 1 ] && ok "sidebar recebe o mouse" \
	|| falha "sidebar não pediu o mouse"
# Clique esquerdo no primeiro botão (linha 4).
T send-keys -t "$sb" -l "$(printf '\033[<0;5;4M')"; sleep 1.5
[ "$(na_tela)" = 4 ] && ok "clique traz a conversa para a tela" || falha "clique: $(na_tela)"

# Hooks do claude marcam status e título; o primeiro prompt vira o título.
hook() {
	printf '%s' "$3" > "$TMP/hook"
	T run-shell "TMUX_PANE=$1 '$(command -v node)' '$ROOT/sidebar/status.js' $2 < '$TMP/hook'"
	sleep 0.5
}
item() { T capture-pane -p -t "$sb" | grep -m1 "$1"; }
pane=$(T list-panes -t "$sb" -F '#{pane_id} #{@conversa}' | awk '$2 { print $1 }')
item "○ nova conversa" >/dev/null && ok "conversa sem mensagem tem título provisório" \
	|| falha "título provisório: $(T capture-pane -p -t "$sb")"
hook "$pane" trabalhando '{"prompt":"corrige   o teste\nde login que está quebrado"}'
hook "$pane" esperando '{"prompt":"outra coisa"}'
[ "$(T show -pv -t "$pane" @status)" = esperando ] && item "? corrige o" >/dev/null \
	&& ok "hook marca status e título da primeira mensagem" \
	|| falha "hook: $(T show -pv -t "$pane" @status) $(item corrige)"
[ "$(T show -pv -t "$pane" @titulo)" = "corrige o teste de login que está quebrado" ] \
	&& item "corrige" | grep -q "…" && ok "título longo é truncado" || falha "truncar: $(item corrige)"
# Esc interrompe o claude: a conversa trabalhando passa a pronta.
hook "$pane" trabalhando '{}'
T send-keys -K -c "$cliente" Escape; sleep 0.5
[ "$(T show -pv -t "$pane" @status)" = pronto ] && ok "esc tira a conversa de trabalhando" \
	|| falha "esc: $(T show -pv -t "$pane" @status)"
# /clear apaga título e status; o ';' final chega inteiro ao título.
hook "$pane" limpar '{}'
item "○ nova conversa" >/dev/null && ok "/clear volta ao título provisório" || falha "limpar: $(item conversa)"
hook "$pane" trabalhando '{"prompt":"fim;"}'
[ "$(T show -pv -t "$pane" @titulo)" = "fim;" ] && ok "título termina com ;" \
	|| falha "título com ;: $(T show -pv -t "$pane" @titulo)"
[ "$(T show -pv -t "$pane" @desde)" -gt 0 ] 2>/dev/null && item "fim;" | grep -q "0:0" \
	&& ok "status guarda desde quando e o sidebar mostra o tempo" || falha "desde: $(item 'fim;')"

# O assunto que o claude põe no título do terminal vira o título; depois do
# /clear, o antigo é ignorado.
T select-pane -t "$pane" -T "✳ Corrige login"; sleep 1.5
item "Corrige login" >/dev/null && ok "assunto do claude vira o título" || falha "assunto: $(T capture-pane -p -t "$sb")"
hook "$pane" limpar '{}'
item "○ nova conversa" >/dev/null && ok "/clear ignora o assunto antigo" || falha "assunto após /clear: $(item ○)"
T select-pane -t "$pane" -T "⠐ Corrige login"; sleep 1.5
item "○ nova conversa" >/dev/null && ok "assunto antigo continua ignorado com o spinner" || falha "spinner após /clear: $(item ○)"

# Novidade fora da tela, p (pendente), Tab (anterior) e 1-9.
outro=$(T list-panes -s -t claude-ui -F '#{pane_id} #{window_id} #{@conversa}' |
	awk -v w="$(janela "$sb")" '$3 && $2 != w { print $1; exit }')
n_outro=$(T show -pv -t "$outro" @conversa)
hook "$outro" pronto '{}'
[ "$(T show -pqv -t "$outro" @novo)" = 1 ] && T capture-pane -p -t "$sb" | head -1 | grep -q "✓1" \
	&& ok "conversa que termina fora da tela fica como novidade" || falha "novo: $(T show -pqv -t "$outro" @novo)"
hook "$pane" pronto '{}'
[ -z "$(T show -pqv -t "$pane" @novo)" ] && ok "a da tela não vira novidade" || falha "novo na tela"
tecla p
[ "$(na_tela)" = "$n_outro" ] && [ -z "$(T show -pqv -t "$outro" @novo)" ] \
	&& ok "p abre a pendente e ela deixa de ser novidade" || falha "p: $(na_tela)"
n_pane=$(T show -pv -t "$pane" @conversa)
tecla Tab
[ "$(na_tela)" = "$n_pane" ] && ok "tab volta para a anterior" || falha "tab: $(na_tela)"
tecla 2
[ "$(na_tela)" = "$(conversas | cut -d' ' -f2)" ] && ok "2 abre a segunda conversa" || falha "2: $(na_tela)"

# Anel do uso do plano: a statusline guarda a % da janela de 5h em @uso e
# repassa a statusline do usuário; o anel fica acima do rodapé (linhas 24-26
# num pane de 30) e mostra a % com o mouse em cima ou depois de um clique.
anel() { T capture-pane -p -t "$sb" | sed -n 24,26p; }
anel | grep -q "indisponível" && falha "anel mostra a % sem o mouse" \
	|| ok "anel não mostra a % sem o mouse"
passar() { T send-keys -t "$sb" -l "$(printf '\033[<35;4;25M')"; sleep 1; }
passar
anel | grep -q "indisponível" && ok "sem dado de uso, o anel diz indisponível" || falha "sem uso: $(anel)"
statusline() {
	printf '%s' "$1" > "$TMP/statusline"
	T run-shell "HOME='$TMP' '$(command -v node)' '$ROOT/sidebar/uso.js' < '$TMP/statusline'"
	sleep 1.5
}
mkdir -p "$TMP/.claude"
echo '{"statusLine": {"command": "echo minha statusline"}}' > "$TMP/.claude/settings.json"
reinicia=$(($(date +%s) + 3600))
limite() { printf '{"cwd":"%s","rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s}}}' "$TMP" "$1" "$2"; }
saida=$(statusline "$(limite 42.4 "$reinicia")")
[ "$saida" = "minha statusline" ] && ok "statusline do usuário continua aparecendo" || falha "statusline: $saida"
passar; anel | grep -q "42% usado" && ok "statusline guarda o uso e o anel mostra a %" || falha "uso: $(anel)"
statusline "{\"cwd\":\"$TMP\"}" >/dev/null
passar; anel | grep -q "42% usado" && ok "conversa sem dado não apaga o uso" || falha "uso apagado: $(anel)"
statusline "$(limite 30 "$reinicia")" >/dev/null
passar; anel | grep -q "42% usado" && ok "conversa parada não volta o uso para trás" || falha "uso antigo: $(anel)"
T send-keys -t "$sb" -l "$(printf '\033[<35;12;25M')"; sleep 1
anel | grep -q "%" && falha "% continua fora do anel" || ok "% some quando o mouse sai do anel"
T send-keys -t "$sb" -l "$(printf '\033[<0;4;25M')"; sleep 1
anel | grep -q "42% usado" && ok "clique no anel fixa a %" || falha "clique no anel: $(anel)"
T set -q @uso "42 $(($(date +%s) - 1))"; sleep 1.5
anel | grep -q "indisponível" && ok "janela de 5h reiniciada vira indisponível" || falha "reiniciada: $(anel)"

# Fechar o terminal encerra tudo.
kill -HUP "$PID"; wait "$PID" 2>/dev/null; sleep 1
servidor_vivo && falha "fechar o terminal encerra tudo" || ok "fechar o terminal encerra tudo"

# Sair do claude fecha a interface.
abrir 1
sleep 1
servidor_vivo && falha "sair do claude fecha a interface" || ok "sair do claude fecha a interface"

rm -r "$TMP"
[ $falhas -eq 0 ]
