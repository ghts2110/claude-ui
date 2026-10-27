// Atalhos do tmux (ver bin/main-pane): `acao.js nova|fechar|subir|descer <sidebar>`.
import {abrir, fechar, naTela, nova, tmux, vizinha} from './conversas.js';

const [acao, sidebar] = process.argv.slice(2);
if (acao === 'nova') nova(sidebar);
else if (acao === 'fechar') {
	fechar(sidebar, naTela(sidebar));
	tmux('select-pane', '-t', naTela(sidebar));
}
else if (acao === 'subir' || acao === 'descer') {
	const id = vizinha(sidebar, acao === 'subir' ? -1 : 1);
	if (id) abrir(sidebar, id);
}
