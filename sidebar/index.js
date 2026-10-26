import React from 'react';
import {render, Box, Text, useInput} from 'ink';

const h = React.createElement;

function Sidebar() {
	// Mantém o stdin aberto para o processo não sair; atalhos vêm depois.
	useInput(() => {});

	return h(
		Box,
		{flexDirection: 'column', paddingX: 1},
		h(Text, {bold: true}, 'Conversas'),
		h(Box, {marginTop: 1}, h(Text, {color: 'green'}, '● '), h(Text, null, 'claude')),
	);
}

render(h(Sidebar), {exitOnCtrlC: false});
