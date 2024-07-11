import * as vscode from 'vscode'
import config from './config'
import { executeGenerateTagCommand } from './generation'
import { getTagSuggestions } from './tagSuggestion'
import { getValueSuggestions } from './valueSuggestion'

let configDisposable: vscode.Disposable
let tagSuggestionDisposable: vscode.Disposable
let valueSuggestionDisposable: vscode.Disposable
let generationDisposable: vscode.Disposable
let generationDisposableDefault: vscode.Disposable

export async function activate(context: vscode.ExtensionContext) {
	configDisposable = config.init()
	tagSuggestionDisposable = registerTagSuggestion()
	valueSuggestionDisposable = registerValueSuggestion()
	generationDisposable = registerGenerationCommand()
	generationDisposableDefault = registerGenerationCommandDefault()

	config.onValueSuggestionConfigChange(() => {
		valueSuggestionDisposable.dispose()
		valueSuggestionDisposable = registerValueSuggestion()
	})
}

export function deactivate(context: vscode.ExtensionContext) {
	configDisposable.dispose()
	tagSuggestionDisposable.dispose()
	valueSuggestionDisposable.dispose()
	generationDisposable.dispose()
	generationDisposableDefault.dispose()
}

function registerTagSuggestion(): vscode.Disposable {
	const chars = config.getTagSuggestionSupportedTags().join('').split('')
	return vscode.languages.registerCompletionItemProvider(
		'go',
		{
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
				const text = document.lineAt(position).text.slice(0, position.character)
				return getTagSuggestions(text)
			}
		},
		...(new Set(chars))
	)
}

function registerValueSuggestion(): vscode.Disposable {
	const cfg = config.getValueSuggestionConfig()
	let chars: string[] = []
	for (let key of Object.keys(cfg)) {
		chars.push(...cfg[key])
	}
	chars.push(',', '"')
	chars = chars.join('').split('')
	return vscode.languages.registerCompletionItemProvider(
		'go',
		{
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
				const text = document.lineAt(position).text.slice(0, position.character)
				return getValueSuggestions(text)
			}
		},
		...(new Set(chars))
	)
}

function registerGenerationCommand(): vscode.Disposable {
	return vscode.commands.registerTextEditorCommand(
		'goStructTagAutogen.generateStructTags.selector', async (textEditor, edit) => {

			const itemsThenable = vscode.window.showQuickPick([
				'json',
				'json-gorm',
				'json-form',
				'json-form-gorm',
				'default'
			], {
				placeHolder: 'Select generation type',
			});
			itemsThenable.then((val) => {
				if (val) {
					// vscode.window.showInformationMessage('User choose 1:' + val);
					vscode.commands.executeCommand('goStructTagAutogen.generateStructTags',val);
					// vscode.window.showInformationMessage('User choose 2:' + val);
				}
			});

		}
	);
}

function registerGenerationCommandDefault(): vscode.Disposable {
	return vscode.commands.registerTextEditorCommand(
		'goStructTagAutogen.generateStructTags', async (textEditor, edit,...args) => {
			await executeGenerateTagCommand(textEditor, edit, args[0]);
		}
	);
}
