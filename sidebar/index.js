import React, {useEffect, useState} from 'react';
import {render, Box, Text, useInput, useStdout} from 'ink';
import * as conv from './conversas.js';

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

function Conversa({conversa, sobCursor}) {
	const cor = sobCursor ? destaque : conversa.naTela ? undefined : apagado;
	const status = cores[conversa.status];
	return h(
		Box,
		{borderStyle: 'round', borderColor: cor ?? apagado, paddingX: 1, flexShrink: 0},
		h(
			Text,
			{wrap: 'truncate-end'},
			h(Text, {color: status ?? apagado}, status ? '● ' : '○ '),
			h(Text, {bold: conversa.naTela, color: cor}, conversa.titulo),
		),
	);
}

const atalhos = [
	['ctrl+\\', 'alternar'],
	['↑↓ j k', 'escolher'],
	['enter', 'abrir'],
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
	const [estado, setEstado] = useState(ler);
	const [cursor, setCursor] = useState(null);
	// Id da conversa a fechar, enquanto espera o "s".
	const [confirmar, setConfirmar] = useState(null);
	const [ajuda, setAjuda] = useState(false);
	const atualizar = () => {
		try {
			setEstado(ler());
		} catch {}
	};

	useEffect(() => {
		const redimensionar = () => setLinhas(stdout.rows);
		stdout.on('resize', redimensionar);
		// Hooks do tmux avisam quando o foco muda ou uma conversa sai; o
		// intervalo cobre o resto (ex: conversa nova ainda sem @conversa).
		process.on('SIGUSR2', atualizar);
		const aviso = `run-shell -b 'kill -USR2 ${process.pid}'`;
		tmux('set-hook', '-g', 'pane-focus-in', aviso);
		tmux('set-hook', '-g', 'pane-exited', aviso);
		const intervalo = setInterval(atualizar, 1000);
		// Pede ao tmux os cliques e a rodinha do mouse, no formato SGR.
		stdout.write('\x1b[?1000h\x1b[?1006h');
		process.on('exit', () => {
			stdout.write('\x1b[?1000l\x1b[?1006l');
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
		if (focado) {
			setCursor(null);
			try {
				conv.largura(sidebar);
			} catch {}
		}
	}, [focado]);

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

	// Só cabem algumas conversas: mostra a fatia em volta do cursor.
	const cabem = Math.max(1, Math.floor((linhas - 5) / 3));
	const inicio = Math.min(Math.max(0, i - Math.floor(cabem / 2)), Math.max(0, conversas.length - cabem));
	const visiveis = conversas.slice(inicio, inicio + cabem);

	// Clique (botão 0) abre a conversa; a rodinha (64/65) move o cursor. Os
	// botões começam na linha 3 e têm 3 linhas cada.
	function mouse(botao, linha) {
		if (botao === 64) setCursor(conversas[Math.max(0, i - 1)]?.id);
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
		const eventos = [...input.matchAll(/\[<(\d+);\d+;(\d+)([Mm])/g)];
		if (eventos.length) {
			for (const [, botao, linha, tipo] of eventos) {
				if (tipo === 'M') mouse(Number(botao), Number(linha));
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
		else if (key.return && sob) abrir(sob.id);
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

	const dica = (key, texto) => h(Text, {key, color: apagado, wrap: 'truncate-end'}, texto);
	let rodape;
	if (confirmar) rodape = [h(Text, {key: 1, color: aviso, wrap: 'truncate-end'}, `fechar ${alvo?.titulo}?`), dica(2, 's sim · n não')];
	else if (ajuda) rodape = [dica(1, '? ou esc  fechar')];
	else if (focado) rodape = [dica(1, '↑↓ enter  abrir'), dica(2, 'n nova · x fechar'), dica(3, '? ajuda · esc sai')];
	else rodape = [dica(1, 'ctrl+t  nova'), dica(2, 'ctrl+w  fechar'), dica(3, 'ctrl+\\  sidebar')];

	return h(
		Box,
		{flexDirection: 'column', paddingX: 1, height: linhas},
		h(Text, {bold: true}, ajuda ? 'Atalhos' : 'Conversas'),
		h(
			Box,
			{flexDirection: 'column', marginTop: 1, flexGrow: 1, overflow: 'hidden'},
			ajuda
				? h(Ajuda)
				: visiveis.map(c =>
					h(Conversa, {key: c.id, conversa: c, sobCursor: focado && c === sob}),
				),
		),
		h(Box, {flexDirection: 'column', height: 3, flexShrink: 0, justifyContent: 'flex-end'}, rodape),
	);
}

render(h(Sidebar), {exitOnCtrlC: false});
