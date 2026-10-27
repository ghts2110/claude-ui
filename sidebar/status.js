// Hook do Claude Code (ver sidebar/hooks.json): `status.js <estado>` marca o
// status da conversa no pane dela e, na primeira mensagem, o título; `limpar`
// (após /clear) apaga os dois e zera as linhas mudadas. Não escreve nada na saída: no UserPromptSubmit
// ela viraria contexto do claude.
// Junto do status ficam desde quando ele vale (@desde, para o tempo no
// sidebar) e, se mudou para pronto ou esperando fora da tela, @novo: a
// conversa tem novidade até ser aberta (ver sidebar/conversas.js).
// O transcript da conversa fica em @transcript, para a leitura em voz alta
// (ver sidebar/voz.js); mandar uma mensagem na conversa da tela cala a fala.
// Ao passar a pronto ou esperando, a conversa apita: o BEL vai para o tty do
// pane dela, e o tmux o repassa ao terminal mesmo com ela fora da tela
// (bell-action any no tmux.conf). O Terminal.app toca o som e, fora de foco,
// faz o ícone pular no Dock.
import {appendFileSync, readFileSync} from 'node:fs';
import {tmux} from './conversas.js';

const pane = process.env.TMUX_PANE;
const estado = process.argv[2];
let entrada = {};
try {
	entrada = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {}
const janela = alvo => tmux('display', '-p', '-t', alvo, '#{window_id}');
try {
	if (estado === 'limpar') {
		for (const opcao of ['@status', '@desde', '@novo', '@titulo', '@linhas']) tmux('set', '-pu', '-t', pane, opcao);
		// As linhas da conversa antiga não passam para a nova (ver sidebar/uso.js).
		const total = tmux('show', '-pqv', '-t', pane, '@linhas_total');
		if (total) tmux('set', '-p', '-t', pane, '@linhas_base', total);
		// O assunto da conversa antiga continua no título do terminal até o
		// claude resumir a nova; o sidebar o ignora até lá.
		tmux('set', '-p', '-t', pane, '--', '@topico_velho', tmux('display', '-p', '-t', pane, '#{pane_title}').replace(/;$/, '\\;'));
	} else {
		// Vários hooks repetem o mesmo status (cada ferramenta, o aviso de
		// ociosidade): só a mudança conta.
		if (tmux('show', '-pqv', '-t', pane, '@status') !== estado) {
			tmux('set', '-p', '-t', pane, '@status', estado);
			tmux('set', '-p', '-t', pane, '@desde', String(Math.floor(Date.now() / 1000)));
			if (estado === 'trabalhando') tmux('set', '-pu', '-t', pane, '@novo');
			else if (janela(pane) !== janela(tmux('show', '-qv', '@sidebar'))) {
				tmux('set', '-p', '-t', pane, '@novo', '1');
				// Aberta enquanto o hook rodava: não é novidade.
				if (janela(pane) === janela(tmux('show', '-qv', '@sidebar'))) tmux('set', '-pu', '-t', pane, '@novo');
			}
			if (estado !== 'trabalhando') appendFileSync(tmux('display', '-p', '-t', pane, '#{pane_tty}'), '\x07');
		}
	}
} catch {}
try {
	const {prompt} = entrada;
	// O tmux lê um argumento terminado em ';' como separador de comandos.
	const titulo = prompt?.replace(/\s+/g, ' ').trim().slice(0, 200).replace(/;$/, '\\;');
	if (titulo && !tmux('show', '-pqv', '-t', pane, '@titulo')) tmux('set', '-p', '-t', pane, '--', '@titulo', titulo);
} catch {}
try {
	// Só uma mensagem nova ou o /clear (SessionStart) mudam o transcript e
	// calam a fala; os outros hooks não pagam esse custo.
	const {transcript_path: transcript, hook_event_name: evento} = entrada;
	if (evento !== 'UserPromptSubmit' && evento !== 'SessionStart') throw 0;
	if (transcript) tmux('set', '-p', '-t', pane, '--', '@transcript', transcript);
	if (janela(pane) === janela(tmux('show', '-qv', '@sidebar'))) {
		const fala = tmux('show', '-qv', '@fala');
		if (fala) process.kill(Number(fala));
	}
} catch {}
// Avisa o sidebar para não esperar a próxima leitura.
try {
	process.kill(Number(tmux('display', '-p', '-t', tmux('show', '-qv', '@sidebar'), '#{pane_pid}')), 'SIGUSR2');
} catch {}
