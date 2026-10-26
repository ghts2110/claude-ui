// Hook do Claude Code (ver sidebar/hooks.json): `status.js <estado>` marca o
// status da conversa no pane dela e, na primeira mensagem, o título; `limpar`
// (após /clear) apaga os dois. Não escreve nada na saída: no UserPromptSubmit
// ela viraria contexto do claude.
import {readFileSync} from 'node:fs';
import {tmux} from './conversas.js';

const pane = process.env.TMUX_PANE;
const estado = process.argv[2];
try {
	if (estado === 'limpar') {
		tmux('set', '-pu', '-t', pane, '@status');
		tmux('set', '-pu', '-t', pane, '@titulo');
	} else tmux('set', '-p', '-t', pane, '@status', estado);
} catch {}
try {
	const {prompt} = JSON.parse(readFileSync(0, 'utf8') || '{}');
	// O tmux lê um argumento terminado em ';' como separador de comandos.
	const titulo = prompt?.replace(/\s+/g, ' ').trim().slice(0, 200).replace(/;$/, '\\;');
	if (titulo && !tmux('show', '-pqv', '-t', pane, '@titulo')) tmux('set', '-p', '-t', pane, '@titulo', titulo);
} catch {}
// Avisa o sidebar para não esperar a próxima leitura.
try {
	process.kill(Number(tmux('display', '-p', '-t', tmux('show', '-qv', '@sidebar'), '#{pane_pid}')), 'SIGUSR2');
} catch {}
