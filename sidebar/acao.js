// Atalhos do tmux (ver bin/main-pane): `acao.js nova|fechar|ditar <sidebar>`.
import {fechar, naTela, nova, tmux} from './conversas.js';

const [acao, sidebar] = process.argv.slice(2);
if (acao === 'nova') nova(sidebar);
else if (acao === 'fechar') {
	fechar(sidebar, naTela(sidebar));
	tmux('select-pane', '-t', naTela(sidebar));
} else if (acao === 'ditar') {
	// O sidebar liga ou desliga o ditado quando o contador muda (ver
	// sidebar/index.js); o sinal o avisa sem esperar a próxima leitura.
	// Somado pelo próprio tmux: dois Ctrl-Q seguidos não se perdem.
	tmux('set', '-qF', '@ditar', '#{e|+:#{@ditar},1}');
	process.kill(Number(tmux('display', '-p', '-t', sidebar, '#{pane_pid}')), 'SIGUSR2');
}
