// Operações sobre as conversas, usadas pelo sidebar e pelos atalhos do tmux
// (sidebar/acao.js). `sidebar` é o id do pane do sidebar.
import {execFileSync} from 'node:child_process';

const conversa = new URL('../bin/conversa', import.meta.url).pathname;

export const tmux = (...args) => execFileSync('tmux', args, {encoding: 'utf8', stdio: 'pipe'}).trim();

export const naTela = sidebar => tmux('list-panes', '-t', sidebar, '-F', '#{pane_id} #{@conversa}')
	.split('\n').map(linha => linha.split(' ')).find(([, n]) => n)?.[0];

// Conversas são os panes marcados com @conversa (ver bin/conversa). A que
// divide a janela com o sidebar é a que está na tela; as outras ficam
// guardadas, cada uma na sua janela.
export function ler(sidebar) {
	const janela = tmux('display', '-p', '-t', sidebar, '#{window_id}');
	const conversas = tmux('list-panes', '-s', '-t', sidebar, '-F', '#{pane_id}\t#{@conversa}\t#{window_id}')
		.split('\n')
		.map(linha => linha.split('\t'))
		.filter(([, n]) => n)
		.map(([id, n, w]) => ({id, n: Number(n), naTela: w === janela}))
		.sort((a, b) => a.n - b.n);
	const focado = tmux('display', '-p', '-t', sidebar, '#{pane_active}') === '1';
	return {conversas, focado};
}

export function criar(sidebar) {
	const sessao = tmux('display', '-p', '-t', sidebar, '#{session_id}');
	return tmux('new-window', '-d', '-t', `${sessao}:`, '-P', '-F', '#{pane_id}', '--', conversa);
}

// Traz a conversa para a área principal; a que estava lá vai para a janela dela.
// A janela guardada assume antes o tamanho da área principal, para o claude
// não ser redimensionado a cada troca.
export function mostrar(sidebar, id) {
	const atual = naTela(sidebar);
	if (!atual || atual === id) return;
	const [largura, altura] = tmux('display', '-p', '-t', atual, '#{pane_width} #{pane_height}').split(' ');
	tmux('resize-window', '-t', id, '-x', largura, '-y', altura);
	tmux('swap-pane', '-d', '-s', id, '-t', atual);
}

export function abrir(sidebar, id) {
	mostrar(sidebar, id);
	tmux('select-pane', '-t', id);
}

export function nova(sidebar) {
	const id = criar(sidebar);
	abrir(sidebar, id);
	return id;
}

// Fechar a da tela põe a vizinha no lugar; sem vizinha, uma conversa nova.
export function fechar(sidebar, id) {
	const {conversas} = ler(sidebar);
	const i = conversas.findIndex(c => c.id === id);
	if (naTela(sidebar) === id) {
		const vizinha = conversas[i + 1] ?? conversas[i - 1];
		mostrar(sidebar, vizinha ? vizinha.id : criar(sidebar));
	}
	tmux('kill-pane', '-t', id);
}
