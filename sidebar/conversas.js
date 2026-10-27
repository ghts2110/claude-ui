// Operações sobre as conversas e o sidebar, usadas por ele e pelos atalhos do
// tmux (sidebar/acao.js). `sidebar` é o id do pane do sidebar.
import {execFileSync} from 'node:child_process';

const conversa = new URL('../bin/conversa', import.meta.url).pathname;

export const tmux = (...args) => execFileSync('tmux', args, {encoding: 'utf8', stdio: 'pipe'}).trim();

export const naTela = sidebar => tmux('list-panes', '-t', sidebar, '-F', '#{pane_id} #{@conversa}')
	.split('\n').map(linha => linha.split(' ')).find(([, n]) => n)?.[0];

// Conversas são os panes marcados com @conversa (ver bin/conversa). A que
// divide a janela com o sidebar é a que está na tela; as outras ficam
// guardadas, cada uma na sua janela. Status, desde quando, se mudou fora da
// tela, o título e o transcript vêm dos hooks do claude (ver sidebar/status.js).
export function ler(sidebar) {
	const janela = tmux('display', '-p', '-t', sidebar, '#{window_id}');
	const conversas = tmux('list-panes', '-s', '-t', sidebar, '-F', '#{pane_id}\t#{@conversa}\t#{window_id}\t#{@status}\t#{@desde}\t#{@novo}\t#{@titulo}\t#{pane_title}\t#{@topico_velho}\t#{pane_current_path}\t#{@transcript}')
		.split('\n')
		.map(linha => linha.split('\t'))
		.filter(([, n]) => n)
		.map(([id, n, w, status, desde, novo, titulo, painel, velho, pasta, transcript]) => ({
			id,
			n: Number(n),
			naTela: w === janela,
			status,
			desde: Number(desde) || undefined,
			novo: novo === '1',
			// O spinner troca o ✳ enquanto trabalha: compara só o assunto.
			titulo: (topico(painel) !== topico(velho) && topico(painel)) || titulo || 'nova conversa',
			pasta,
			transcript,
		}))
		.sort((a, b) => a.n - b.n);
	// Junto, o uso do plano que a statusline guardou (ver sidebar/uso.js).
	const [ativo, uso] = tmux('display', '-p', '-t', sidebar, '#{pane_active}\t#{@uso}').split('\t');
	return {conversas, focado: ativo === '1', uso};
}

// O Claude Code põe no título do terminal o assunto da conversa, resumido
// por ele ("✳ Corrige teste de login"; trabalhando, um spinner no lugar do
// ✳). Como no workmux, é o melhor título; sem ele (antes da primeira
// resposta ou com o título desligado), fica a primeira mensagem.
export function topico(titulo) {
	if (!/^[\u2800-\u28ff✳]/.test(titulo)) return;
	const texto = titulo.replace(/^[\u2800-\u28ff✳\s]+/, '').trim();
	if (texto && !texto.startsWith('Claude Code')) return texto;
}

export function criar(sidebar) {
	const sessao = tmux('display', '-p', '-t', sidebar, '#{session_id}');
	return tmux('new-window', '-d', '-t', `${sessao}:`, '-P', '-F', '#{pane_id}', '--', conversa);
}

// Traz a conversa para a área principal; a que estava lá vai para a janela dela.
// A janela guardada assume antes o tamanho da área principal, para o claude
// não ser redimensionado a cada troca. A que entra deixa de ser novidade; a
// que sai fica em @anterior, para o Tab voltar a ela.
export function mostrar(sidebar, id) {
	const atual = naTela(sidebar);
	if (!atual || atual === id) return;
	const [largura, altura] = tmux('display', '-p', '-t', atual, '#{pane_width} #{pane_height}').split(' ');
	tmux('resize-window', '-t', id, '-x', largura, '-y', altura);
	tmux('swap-pane', '-dZ', '-s', id, '-t', atual);
	tmux('set', '-pu', '-t', id, '@novo');
	tmux('set', '-q', '@anterior', atual);
	avisarCabecalho();
}

// A última conversa que esteve na tela, se ainda existir.
export function anterior(sidebar) {
	const id = tmux('show', '-qv', '@anterior');
	return ler(sidebar).conversas.find(c => c.id === id && !c.naTela)?.id;
}

// A próxima que pede atenção, como o last-done do workmux: as que mudaram
// fora da tela e ainda não foram vistas (esperando por você antes de
// prontas), depois as que continuam esperando; em cada grupo, a que mudou há
// mais tempo.
export function pendente(sidebar) {
	const fora = ler(sidebar).conversas.filter(c => !c.naTela);
	const grupos = [
		c => c.novo && c.status === 'esperando',
		c => c.novo && c.status === 'pronto',
		c => c.status === 'esperando',
	];
	for (const grupo of grupos) {
		const achada = fora.filter(grupo).sort((a, b) => (a.desde ?? 0) - (b.desde ?? 0))[0];
		if (achada) return achada.id;
	}
}

// O cabeçalho (sidebar/cabecalho.js) se ajusta logo à conversa que entrou.
export function avisarCabecalho() {
	try {
		process.kill(Number(tmux('display', '-p', '-t', tmux('show', '-qv', '@cabecalho'), '#{pane_pid}')), 'SIGUSR2');
	} catch {}
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
		// A que sai vai morrer: o Tab continua voltando para a de antes dela.
		const antes = tmux('show', '-qv', '@anterior');
		mostrar(sidebar, vizinha ? vizinha.id : criar(sidebar));
		tmux('set', '-q', '@anterior', antes);
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
// da janela. O cabeçalho volta a ter 3 linhas.
export function largura(sidebar, nova) {
	const janela = Number(tmux('display', '-p', '-t', sidebar, '#{window_width}'));
	const teto = Math.max(20, Math.floor(janela / 2));
	if (nova !== undefined) tmux('set', '-q', '@largura', String(Math.min(Math.max(20, nova), teto)));
	if (escondido(sidebar)) return;
	const guardada = Number(tmux('show', '-qv', '@largura')) || 24;
	tmux('resize-pane', '-t', sidebar, '-x', String(Math.min(guardada, teto)));
	// Sem zoom, o tmux redistribui a altura entre cabeçalho e conversa.
	const cabecalho = tmux('show', '-qv', '@cabecalho');
	if (cabecalho) tmux('resize-pane', '-t', cabecalho, '-y', '3');
}
