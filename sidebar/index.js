import React, {useEffect, useState} from 'react';
import {render, Box, Text, useInput, useStdout} from 'ink';
import {execFile} from 'node:child_process';
import {basename} from 'node:path';
import * as conv from './conversas.js';
import * as anel from './anel.js';

const h = React.createElement;
const sidebar = process.env.TMUX_PANE;
const {tmux} = conv;
const ler = () => conv.ler(sidebar);
const naTela = () => conv.naTela(sidebar);

// Tons médios, legíveis em tema claro e escuro (o cinza é o mesmo das bordas
// dos panes, em tmux.conf). Sem status (nenhuma mensagem ainda): bolinha vazia.
const cores = {pronto: '#2ea043', esperando: '#3b82f6', trabalhando: '#d4a017'};
const destaque = '#0891b2';
const apagado = '#6b7280';
const aviso = '#d97706';
const vermelho = '#dc2626';
const laranja = '#d97706';

// Ícones de status como os do workmux, sem emoji (largura incerta no
// terminal): spinner enquanto trabalha, ? quando precisa de você, ✓ pronto.
const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const icones = {esperando: '?', pronto: '✓'};

// Tempo desde a última mudança de status, curto como no workmux: 2:14, 3h, 2d.
function tempo(desde) {
	const s = Math.max(0, Math.floor(Date.now() / 1000) - desde);
	if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

const home = process.env.HOME;
const pasta = caminho => (!caminho ? '' : caminho === home ? '~' : basename(caminho));

// Linhas mudadas desde o último commit na pasta da conversa (git diff HEAD),
// como os números do workmux. Sem git ou sem mudança, nada.
function diff(caminho) {
	return new Promise(resolve => {
		// Sem travar o índice (um git add do claude falharia com index.lock) nem
		// rodar diff externo ou textconv do usuário, como no workmux.
		execFile('git', ['--no-optional-locks', '-C', caminho, 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', 'HEAD'], {timeout: 3000}, (erro, saida) => {
			if (erro) return resolve();
			const mais = Number(saida.match(/(\d+) insert/)?.[1] ?? 0);
			const menos = Number(saida.match(/(\d+) delet/)?.[1] ?? 0);
			resolve(mais || menos ? {mais, menos} : undefined);
		});
	});
}

// Cada conversa ocupa 3 linhas: título e tempo, pasta e diff, separador. À
// esquerda, uma faixa na cor do status, como os tiles do workmux; sob o
// cursor, mais grossa e no tom de destaque.
function Conversa({conversa, sobCursor, quadro, mudancas, largura}) {
	const cor = cores[conversa.status];
	const icone = conversa.status === 'trabalhando' ? spinner[quadro % spinner.length] : icones[conversa.status] ?? '○';
	// Na tela ou com novidade (mudou fora da tela e não foi vista): em
	// negrito. As outras ficam apagadas.
	const forte = conversa.naTela || conversa.novo;
	const faixa = h(Box, {flexShrink: 0}, h(Text, {color: sobCursor ? destaque : cor ?? apagado}, sobCursor ? '┃ ' : '▎ '));
	const fixo = filho => h(Box, {flexShrink: 0}, filho);
	const flexivel = filho => h(Box, {flexGrow: 1, flexShrink: 1, overflow: 'hidden'}, filho);
	return h(
		Box,
		{flexDirection: 'column', flexShrink: 0},
		h(
			Box,
			null,
			faixa,
			fixo(h(Text, {color: cor ?? apagado}, `${icone} `)),
			flexivel(h(Text, {wrap: 'truncate-end', bold: forte, color: sobCursor ? destaque : forte ? undefined : apagado}, conversa.titulo)),
			conversa.desde ? fixo(h(Text, {color: apagado}, ` ${tempo(conversa.desde)}`)) : null,
		),
		h(
			Box,
			null,
			faixa,
			flexivel(h(Text, {wrap: 'truncate-end', color: apagado}, `  ${pasta(conversa.pasta)}`)),
			mudancas ? h(Box, {flexShrink: 0}, h(Text, {color: cores.pronto}, ` +${mudancas.mais}`), h(Text, {color: vermelho}, ` -${mudancas.menos}`)) : null,
		),
		h(Text, {color: apagado}, '─'.repeat(Math.max(0, largura))),
	);
}

// Uso do plano na janela de 5h (ver sidebar/anel.js): a parte usada em
// laranja, o resto apagado; sem o dado, todo apagado. A % e o reinício só
// aparecem ao lado com o mouse em cima ou depois de um clique.
function Anel({uso, detalhe}) {
	const hora = segundos => {
		const data = new Date(segundos * 1000);
		return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
	};
	const texto = !detalhe ? [] : uso
		? [h(Text, {key: 1, bold: true, color: laranja}, `${Math.round(uso.usado)}% usado`), h(Text, {key: 2, color: apagado, wrap: 'truncate-end'}, 'do plano (5h)'), h(Text, {key: 3, color: apagado, wrap: 'truncate-end'}, `reinicia ${hora(uso.reinicia)}`)]
		: [h(Text, {key: 1, color: apagado, wrap: 'truncate-end'}, 'uso do plano'), h(Text, {key: 2, color: apagado, wrap: 'truncate-end'}, 'indisponível')];
	return h(
		Box,
		{height: anel.linhas, flexShrink: 0},
		h(
			Box,
			{flexDirection: 'column', flexShrink: 0, marginRight: 1},
			anel.anel((uso?.usado ?? 0) / 100).map((trechos, l) =>
				h(Text, {key: l}, trechos.map(({texto, cheio}, j) => h(Text, {key: j, color: cheio ? laranja : apagado, dimColor: !cheio}, texto))),
			),
		),
		h(Box, {flexDirection: 'column', flexShrink: 1, overflow: 'hidden'}, texto),
	);
}

const atalhos = [
	['ctrl+\\', 'alternar'],
	['↑↓ j k', 'escolher'],
	['opt+↑↓', 'trocar'],
	['g G', 'início, fim'],
	['enter', 'abrir'],
	['1-9', 'abrir a nº'],
	['tab', 'anterior'],
	['p', 'pendente'],
	['n ctrl+t', 'nova'],
	['x ctrl+w', 'fechar'],
	['h', 'esconder'],
	['< >', 'largura'],
	['esc', 'voltar'],
];

function Ajuda() {
	return h(
		Box,
		{flexDirection: 'column'},
		atalhos.map(([tecla, acao]) =>
			h(Text, {key: tecla, wrap: 'truncate-end'}, h(Text, {color: destaque}, tecla.padEnd(9)), acao),
		),
		h(Box, {flexDirection: 'column', marginTop: 1}, [
			'p vai para a que',
			'espera por você',
			'ou terminou sem',
			'ser vista.',
			'Escondido, ctrl+\\',
			'o traz de volta.',
			'A borda também',
			'se arrasta com',
			'o mouse.',
		].map(linha => h(Text, {key: linha, color: apagado, wrap: 'truncate-end'}, linha))),
	);
}

function Sidebar() {
	const {stdout} = useStdout();
	const [linhas, setLinhas] = useState(stdout.rows);
	const [colunas, setColunas] = useState(stdout.columns);
	const [estado, setEstado] = useState(ler);
	const [cursor, setCursor] = useState(null);
	// Id da conversa a fechar, enquanto espera o "s".
	const [confirmar, setConfirmar] = useState(null);
	const [ajuda, setAjuda] = useState(false);
	const [quadro, setQuadro] = useState(0);
	// % do anel à mostra: com o mouse em cima ou fixada por um clique.
	const [sobreAnel, setSobreAnel] = useState(false);
	const [anelFixo, setAnelFixo] = useState(false);
	// Conta os movimentos do mouse, para o prazo da % recomeçar a cada um.
	const [quadroMouse, setQuadroMouse] = useState(0);
	// Diff de cada pasta (ver diff()), por caminho.
	const [mudancas, setMudancas] = useState({});
	const atualizar = () => {
		try {
			setEstado(ler());
		} catch {}
	};

	useEffect(() => {
		const redimensionar = () => {
			setLinhas(stdout.rows);
			setColunas(stdout.columns);
		};
		stdout.on('resize', redimensionar);
		// Hooks do tmux avisam quando o foco muda ou uma conversa sai; o
		// intervalo cobre o resto (ex: conversa nova ainda sem @conversa).
		process.on('SIGUSR2', atualizar);
		const aviso = `run-shell -b 'kill -USR2 ${process.pid}'`;
		tmux('set-hook', '-g', 'pane-focus-in', aviso);
		tmux('set-hook', '-g', 'pane-exited', aviso);
		const intervalo = setInterval(atualizar, 1000);
		// Pede ao tmux os cliques, a rodinha e os movimentos do mouse (para
		// passar sobre o anel), no formato SGR.
		stdout.write('\x1b[?1003h\x1b[?1006h');
		process.on('exit', () => {
			stdout.write('\x1b[?1003l\x1b[?1006l');
			try {
				tmux('set-hook', '-gu', 'pane-focus-in');
				tmux('set-hook', '-gu', 'pane-exited');
			} catch {}
		});
		return () => {
			stdout.off('resize', redimensionar);
			process.off('SIGUSR2', atualizar);
			clearInterval(intervalo);
		};
	}, []);

	const {conversas, focado} = estado;
	const uso = anel.ler(estado.uso);

	// O spinner só anda enquanto alguma conversa trabalha.
	const trabalhando = conversas.some(c => c.status === 'trabalhando');
	useEffect(() => {
		if (!trabalhando) return;
		const intervalo = setInterval(() => setQuadro(q => q + 1), 250);
		return () => clearInterval(intervalo);
	}, [trabalhando]);

	// O git é relido a cada 5s, fora do ciclo de 1s da lista.
	const pastas = [...new Set(conversas.map(c => c.pasta).filter(Boolean))].join('\n');
	useEffect(() => {
		let vivo = true;
		const ler = async () => {
			const lista = pastas.split('\n').filter(Boolean);
			const lidas = await Promise.all(lista.map(diff));
			if (vivo) setMudancas(Object.fromEntries(lista.map((p, i) => [p, lidas[i]])));
		};
		ler();
		const intervalo = setInterval(ler, 5000);
		return () => {
			vivo = false;
			clearInterval(intervalo);
		};
	}, [pastas]);

	// O cursor segue a conversa pelo id; sem cursor, fica na que está na tela.
	let i = conversas.findIndex(c => c.id === cursor);
	if (i < 0) i = Math.max(0, conversas.findIndex(c => c.naTela));
	const sob = conversas[i];

	// Ao ganhar o foco, o cursor volta para a conversa na tela: assim
	// Ctrl-\ x sempre mira a conversa que se está vendo. O foco também é
	// a volta do sidebar escondido, com a largura que o tmux redistribuiu.
	useEffect(() => {
		setConfirmar(null);
		setAjuda(false);
		setSobreAnel(false);
		if (focado) {
			setCursor(null);
			try {
				conv.largura(sidebar);
			} catch {}
		}
	}, [focado]);

	// O tmux só manda o movimento ao pane sob o mouse: saindo rápido do
	// sidebar, nenhum evento avisa que ele deixou o anel. Sem movimento por
	// alguns segundos, a % some.
	useEffect(() => {
		if (!sobreAnel) return;
		const prazo = setTimeout(() => setSobreAnel(false), 4000);
		return () => clearTimeout(prazo);
	}, [sobreAnel, quadroMouse]);

	// Trocou a conversa da tela (Option-↑/↓, Ctrl-T, uma que saiu): o cursor
	// volta para ela.
	const tela = conversas.find(c => c.naTela)?.id;
	useEffect(() => setCursor(null), [tela]);

	// A conversa a fechar saiu sozinha enquanto esperava o "s": desiste.
	const alvo = conversas.find(c => c.id === confirmar);
	useEffect(() => {
		if (confirmar && !alvo) setConfirmar(null);
	}, [confirmar, alvo]);

	// Um pane pode sumir entre a leitura e a ação (até 1s); o comando do tmux
	// falha e a lista é relida, sem derrubar o sidebar.
	const agir = acao => {
		try {
			acao();
		} catch {}
		atualizar();
	};

	const abrir = id => agir(() => conv.abrir(sidebar, id));

	// Só cabem algumas conversas: mostra a fatia em volta do cursor. Fora o
	// título, o anel e o rodapé, sobram linhas para elas, menos uma para o
	// "↓ mais" quando não cabem todas (o "↑ acima" usa a linha abaixo do título).
	const fixas = 6 + anel.linhas;
	let cabem = Math.max(1, Math.floor((linhas - fixas) / 3));
	if (conversas.length > cabem) cabem = Math.max(1, Math.floor((linhas - fixas - 1) / 3));
	const inicio = Math.min(Math.max(0, i - Math.floor(cabem / 2)), Math.max(0, conversas.length - cabem));
	const visiveis = conversas.slice(inicio, inicio + cabem);
	const abaixo = conversas.length - inicio - visiveis.length;

	// Clique (botão 0) abre a conversa; a rodinha (64/65) move o cursor. Os
	// botões começam na linha 3 e têm 3 linhas cada. O anel fica logo acima
	// das 3 linhas do rodapé, depois da margem de uma coluna; passar o mouse
	// (35, movimento sem botão) mostra a %, e o clique a fixa ou solta.
	const topoAnel = linhas - 3 - anel.linhas;
	const noAnel = (linha, coluna) => linha >= topoAnel && linha < topoAnel + anel.linhas && coluna >= 2 && coluna < 2 + anel.colunas;
	function mouse(botao, linha, coluna) {
		// Movimento com shift, alt ou ctrl soma 4, 8 ou 16 ao botão.
		if ((botao & ~28) === 35) {
			setSobreAnel(noAnel(linha, coluna));
			setQuadroMouse(n => n + 1);
		}
		else if (botao === 0 && noAnel(linha, coluna)) setAnelFixo(fixo => !fixo);
		else if (botao === 64) setCursor(conversas[Math.max(0, i - 1)]?.id);
		else if (botao === 65) setCursor(conversas[Math.min(conversas.length - 1, i + 1)]?.id);
		else if (botao === 0 && linha >= 3 && !ajuda) {
			const conversa = visiveis[Math.floor((linha - 3) / 3)];
			if (conversa) {
				setConfirmar(null);
				setCursor(conversa.id);
				abrir(conversa.id);
			}
		}
	}

	useInput((input, key) => {
		const eventos = [...input.matchAll(/\[<(\d+);(\d+);(\d+)([Mm])/g)];
		if (eventos.length) {
			for (const [, botao, coluna, linha, tipo] of eventos) {
				if (tipo === 'M') mouse(Number(botao), Number(linha), Number(coluna));
			}
			return;
		}

		if (ajuda) {
			if (input === '?' || input === 'q' || key.escape) setAjuda(false);
			return;
		}

		if (confirmar) {
			setConfirmar(null);
			if (input === 's' && alvo) {
				// Fechada, o foco volta para a conversa que ficou na tela.
				agir(() => {
					conv.fechar(sidebar, alvo.id);
					tmux('select-pane', '-t', naTela());
				});
			}
			return;
		}

		if (key.upArrow || input === 'k') setCursor(conversas[Math.max(0, i - 1)]?.id);
		else if (key.downArrow || input === 'j') setCursor(conversas[Math.min(conversas.length - 1, i + 1)]?.id);
		else if (input === 'g') setCursor(conversas[0]?.id);
		else if (input === 'G') setCursor(conversas.at(-1)?.id);
		else if (key.return && sob) abrir(sob.id);
		else if (/^[1-9]$/.test(input) && conversas[input - 1]) abrir(conversas[input - 1].id);
		else if (key.tab || input === 'p') {
			// Tab volta para a anterior; p vai para a próxima pendente. Sem
			// nenhuma, fica onde está.
			agir(() => {
				const id = key.tab ? conv.anterior(sidebar) : conv.pendente(sidebar);
				if (id) conv.abrir(sidebar, id);
			});
		}
		else if (input === 'n') {
			agir(() => setCursor(conv.nova(sidebar)));
		} else if (input === 'x' && sob) setConfirmar(sob.id);
		else if (input === 'h') agir(() => conv.esconder(sidebar));
		else if (input === '<' || input === '>') {
			agir(() => {
				const atual = Number(tmux('display', '-p', '-t', sidebar, '#{pane_width}'));
				conv.largura(sidebar, atual + (input === '>' ? 2 : -2));
			});
		} else if (input === '?') setAjuda(true);
		else if (key.escape) agir(() => tmux('select-pane', '-t', naTela()));
	});

	// Dicas do rodapé: tecla no tom de destaque, ação apagada.
	const dica = (key, ...pares) => h(
		Text,
		{key, wrap: 'truncate-end'},
		pares.flatMap(([tecla, acao], j) => [
			j ? h(Text, {key: `s${j}`, color: apagado}, ' · ') : null,
			h(Text, {key: `t${j}`, color: destaque}, tecla),
			h(Text, {key: `a${j}`, color: apagado}, ` ${acao}`),
		]),
	);
	let rodape;
	if (confirmar) rodape = [h(Text, {key: 1, color: aviso, wrap: 'truncate-end'}, `fechar ${alvo?.titulo}?`), dica(2, ['s', 'sim'], ['n', 'não'])];
	else if (ajuda) rodape = [dica(1, ['? esc', 'fechar'])];
	else if (focado) rodape = [dica(1, ['↑↓ enter', 'abrir']), dica(2, ['n', 'nova'], ['x', 'fechar']), dica(3, ['?', 'ajuda'], ['esc', 'sai'])];
	else rodape = [dica(1, ['ctrl+t', 'nova']), dica(2, ['ctrl+w', 'fechar']), dica(3, ['ctrl+\\', 'sidebar'])];

	// No título, quantas esperam por você e quantas terminaram sem ser vistas
	// (como o resumo de grupo do workmux), e o total.
	const esperando = conversas.filter(c => c.status === 'esperando').length;
	const novas = conversas.filter(c => c.novo && !c.naTela && c.status === 'pronto').length;
	// Textos irmãos, sem aninhar: o Ink mede errado um Text com filhos vazios.
	const contagem = h(
		Box,
		{flexShrink: 0, marginLeft: 1, gap: 1},
		esperando ? h(Text, {color: cores.esperando}, `?${esperando}`) : null,
		novas ? h(Text, {color: cores.pronto}, `✓${novas}`) : null,
		h(Text, {color: apagado}, String(conversas.length)),
	);
	const seta = (key, texto) => h(Text, {key, color: apagado, wrap: 'truncate-end'}, texto);

	// Uma linha a menos que o pane: com a altura toda, o Ink limpa a tela a
	// cada render (o spinner faria isso 4 vezes por segundo).
	return h(
		Box,
		{flexDirection: 'column', paddingX: 1, height: linhas - 1},
		h(
			Box,
			{justifyContent: 'space-between', flexShrink: 0},
			h(Box, {flexShrink: 1, overflow: 'hidden'}, h(Text, {bold: true, color: focado ? destaque : undefined, wrap: 'truncate-end'}, ajuda ? 'Atalhos' : 'Conversas')),
			ajuda ? null : contagem,
		),
		h(Box, {height: 1, flexShrink: 0}, !ajuda && inicio ? seta(1, `↑ ${inicio} acima`) : null),
		h(
			Box,
			{flexDirection: 'column', flexGrow: 1, overflow: 'hidden'},
			ajuda
				? h(Ajuda)
				: [
					...visiveis.map(c =>
						h(Conversa, {key: c.id, conversa: c, sobCursor: focado && c === sob, quadro, mudancas: mudancas[c.pasta], largura: colunas - 2}),
					),
					abaixo ? seta('abaixo', `↓ ${abaixo} abaixo`) : null,
				],
		),
		h(Anel, {uso, detalhe: sobreAnel || anelFixo}),
		h(Box, {flexDirection: 'column', height: 3, flexShrink: 0, justifyContent: 'flex-end'}, rodape),
	);
}

render(h(Sidebar), {exitOnCtrlC: false});
