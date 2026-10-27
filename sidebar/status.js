// Hook do Claude Code (ver sidebar/hooks.json): `status.js <estado>` marca o
// status da conversa no pane dela e, na primeira mensagem, o título; `limpar`
// (após /clear) apaga os dois. Não escreve nada na saída: no UserPromptSubmit
// ela viraria contexto do claude.
// Junto do status ficam desde quando ele vale (@desde, para o tempo no
// sidebar) e, se mudou para pronto ou esperando fora da tela, @novo: a
// conversa tem novidade até ser aberta (ver sidebar/conversas.js).
import {readFileSync} from 'node:fs';
import {tmux} from './conversas.js';

const pane = process.env.TMUX_PANE;
const estado = process.argv[2];
try {
	if (estado === 'limpar') {
		for (const opcao of ['@status', '@desde', '@novo', '@titulo']) tmux('set', '-pu', '-t', pane, opcao);
		// O assunto da conversa antiga continua no título do terminal até o
		// claude resumir a nova; o sidebar o ignora até lá.
		tmux('set', '-p', '-t', pane, '--', '@topico_velho', tmux('display', '-p', '-t', pane, '#{pane_title}').replace(/;$/, '\\;'));
	} else {
		// Vários hooks repetem o mesmo status (cada ferramenta, o aviso de
		// ociosidade): só a mudança conta.
		if (tmux('show', '-pqv', '-t', pane, '@status') !== estado) {
			tmux('set', '-p', '-t', pane, '@status', estado);
			tmux('set', '-p', '-t', pane, '@desde', String(Math.floor(Date.now() / 1000)));
			const janela = alvo => tmux('display', '-p', '-t', alvo, '#{window_id}');
			if (estado === 'trabalhando') tmux('set', '-pu', '-t', pane, '@novo');
			else if (janela(pane) !== janela(tmux('show', '-qv', '@sidebar'))) {
				tmux('set', '-p', '-t', pane, '@novo', '1');
				// Aberta enquanto o hook rodava: não é novidade.
				if (janela(pane) === janela(tmux('show', '-qv', '@sidebar'))) tmux('set', '-pu', '-t', pane, '@novo');
			}
		}
	}
} catch {}
try {
	const {prompt} = JSON.parse(readFileSync(0, 'utf8') || '{}');
	// O tmux lê um argumento terminado em ';' como separador de comandos.
	const titulo = prompt?.replace(/\s+/g, ' ').trim().slice(0, 200).replace(/;$/, '\\;');
	if (titulo && !tmux('show', '-pqv', '-t', pane, '@titulo')) tmux('set', '-p', '-t', pane, '--', '@titulo', titulo);
} catch {}
// Avisa o sidebar para não esperar a próxima leitura.
try {
	process.kill(Number(tmux('display', '-p', '-t', tmux('show', '-qv', '@sidebar'), '#{pane_pid}')), 'SIGUSR2');
} catch {}
