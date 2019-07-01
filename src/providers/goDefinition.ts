'use strict';

import {
	Files,
	Location,
	Position,
	TextDocument
} from 'vscode-languageserver';
import Uri from 'vscode-uri';

import { ICache } from '../services/cache';
import { NodeType } from '../types/nodes';
import { ISettings } from '../types/settings';
import { ISymbols } from '../types/symbols';

import { parseDocument } from '../services/parser';
import { getDocumentPath } from '../utils/document';
import { getSymbolsCollection } from '../utils/symbols';

interface ISymbol {
	document: string;
	path: string;
	info: any;
}

interface IIdentifier {
	type: string;
	position: Position;
	name: string;
}

function samePosition(a: Position, b: Position) {
	return a.line === b.line && a.character === b.character;
}

/**
 * Returns the Symbol, if it present in the documents.
 */
function getSymbols(symbolList: ISymbols[], identifier: IIdentifier, currentPath: string): ISymbol[] {
	const list: ISymbol[] = [];

	symbolList.forEach((symbols) => {
		const fsPath = getDocumentPath(currentPath, symbols.document);

		symbols[identifier.type].forEach((item) => {
			if (item.name === identifier.name && !samePosition(item.position, identifier.position)) {
				list.push({
					document: symbols.document,
					path: fsPath,
					info: item
				});
			}
		});
	});

	return list;
}

/**
 * Do Go Definition :)
 */
export function goDefinition(root: string, document: TextDocument, offset: number, cache: ICache, settings: ISettings): Promise<Location> {
	const documentPath = Files.uriToFilePath(document.uri) || document.uri;
	if (!documentPath) {
		return Promise.resolve(null);
	}

	const resource = parseDocument(root, document, offset, settings);
	const hoverNode = resource.node;
	if (!hoverNode || !hoverNode.type) {
		return Promise.resolve(null);
	}

	let identifier: IIdentifier = null;
	if (hoverNode.type === NodeType.VariableName) {
		const parent = hoverNode.getParent();
		if (parent.type !== NodeType.FunctionParameter && parent.type !== NodeType.VariableDeclaration) {
			identifier = {
				name: hoverNode.getName(),
				position: document.positionAt(hoverNode.offset),
				type: 'variables'
			};
		}
	} else if (hoverNode.type === NodeType.Identifier) {
		let i = 0;
		let node = hoverNode;
		while (node.type !== NodeType.MixinReference && node.type !== NodeType.Function && i !== 2) {
			node = node.getParent();
			i++;
		}

		if (node && (node.type === NodeType.MixinReference || node.type === NodeType.Function)) {
			let type = 'mixins';
			if (node.type === NodeType.Function) {
				type = 'functions';
			}

			identifier = {
				name: node.getName(),
				position: document.positionAt(node.offset),
				type
			};
		}
	}

	if (!identifier) {
		return Promise.resolve(null);
	}

	// Symbols from Cache
	resource.symbols.ctime = new Date();
	cache.set(resource.symbols.document, resource.symbols);
	const symbolsList = getSymbolsCollection(cache);

	// Symbols
	const candidates = getSymbols(symbolsList, identifier, documentPath);
	if (candidates.length === 0) {
		return Promise.resolve(null);
	}

	const definition = candidates[0];

	const symbol = Location.create(Uri.file(definition.document).toString(), {
		start: definition.info.position,
		end: {
			line: definition.info.position.line,
			character: definition.info.position.character + definition.info.name.length
		}
	});

	return Promise.resolve(symbol);
}
