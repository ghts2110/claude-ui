// Operações sobre as conversas e o sidebar, usadas por ele. `sidebar` é o id
// do pane do sidebar.
import {execFileSync} from 'node:child_process';

const conversa = new URL('../bin/conversa', import.meta.url).pathname;

export const tmux = (...args) => execFileSync('tmux', args, {encoding: 'utf8', stdio: 'pipe'}).trim();

export const naTela = sidebar => tmux('list-panes', '-t', sidebar, '-F', '#{pane_id} #{@conversa}')
	.split('\n').map(linha => linha.split(' ')).find(([, n]) => n)?.[0];

// Conversas são os panes marcados com @conversa (ver bin/conversa). A que
// divide a janela com o sidebar é a que está na tela; as outras ficam
// guardadas, cada uma na sua janela. Status e título vêm dos hooks do claude
// (ver sidebar/status.js).
export function ler(sidebar) {
	const janela = tmux('display', '-p', '-t', sidebar, '#{window_id}');
	const conversas = tmux('list-panes', '-s', '-t', sidebar, '-F', '#{pane_id}\t#{@conversa}\t#{window_id}\t#{@status}\t#{@titulo}')
		.split('\n')
		.map(linha => linha.split('\t'))
		.filter(([, n]) => n)
		.map(([id, n, w, status, titulo]) => ({id, n: Number(n), naTela: w === janela, status, titulo: titulo || 'nova conversa'}))
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
	tmux('swap-pane', '-dZ', '-s', id, '-t', atual);
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

// Esconder o sidebar é dar zoom na conversa da tela; o Ctrl-\\ (select-pane)
// tira o zoom e o traz de volta.
export const escondido = sidebar => tmux('display', '-p', '-t', sidebar, '#{window_zoomed_flag}') === '1';

export function esconder(sidebar) {
	const id = naTela(sidebar);
	tmux('select-pane', '-t', id);
	if (!escondido(sidebar)) tmux('resize-pane', '-Z', '-t', id);
}

// Largura escolhida fica em @largura e é reaplicada quando a janela muda de
// tamanho (hook em bin/main-pane) ou o sidebar volta a aparecer, até metade
// da janela.
export function largura(sidebar, nova) {
	const janela = Number(tmux('display', '-p', '-t', sidebar, '#{window_width}'));
	const teto = Math.max(20, Math.floor(janela / 2));
	if (nova !== undefined) tmux('set', '-q', '@largura', String(Math.min(Math.max(20, nova), teto)));
	if (escondido(sidebar)) return;
	const guardada = Number(tmux('show', '-qv', '@largura')) || 24;
	tmux('resize-pane', '-t', sidebar, '-x', String(Math.min(guardada, teto)));
}
