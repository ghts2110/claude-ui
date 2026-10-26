// Atalhos do tmux (ver bin/main-pane): `acao.js nova|fechar <sidebar>`.
import {fechar, naTela, nova, tmux} from './conversas.js';

const [acao, sidebar] = process.argv.slice(2);
if (acao === 'nova') nova(sidebar);
else if (acao === 'fechar') {
	fechar(sidebar, naTela(sidebar));
	tmux('select-pane', '-t', naTela(sidebar));
}
