import * as vscode from 'vscode';
import config from './config';
import { formatField } from './formatter';
import { supportedCases } from './constants';

export function executeGenerateTagCommand(
  textEditor: vscode.TextEditor,
  edit: vscode.TextEditorEdit,
  type: string | undefined,
) {
  const document = textEditor.document;
  for (let selection of textEditor.selections) {
    const start = selection.start.line;
    const end = selection.end.line;
    try {
      const fieldLines = getFieldLines(start, end, document);
      for (let line of fieldLines) {
        const field = getField(document.lineAt(line).text);
        if (field) {
          const tags = generateTags(field,type);
          edit.insert(
            new vscode.Position(
              line,
              document.lineAt(line).text.includes('//')
                ? document.lineAt(line).text.indexOf('//')
                : document.lineAt(line).range.end.character
            ),
            ` \`${tags}\``
          );
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`${err.toString()} (line ${start + 1})`);
    }
  }
}

function getField(text: string): string | null {
  const field = /^\s*([a-zA-Z_][a-zA-Z_\d]*)\s+\*?[a-zA-Z_\.\[\]]+/;
  const list = field.exec(text);
  if (!list) {
    return null;
  }
  return list[1];
}

function getFieldLines(
  start: number,
  end: number,
  document: vscode.TextDocument
): number[] {
  let scope: { start: number; end: number };
  try {
    scope = getStructScope(start, document);
  } catch (err) {
    if (start === end) throw err;
    scope = getStructScope(end, document);
  }

  if (scope.start + 1 > scope.end - 1) {
    throw new Error('invalid struct format');
  }

  let res: number[] = [];
  for (let line = scope.start + 1; line <= scope.end - 1; line++) {
    res.push(line);
  }

  res = res.filter((line) => {
    const text = document.lineAt(line).text;
    const field = /^\s*([a-zA-Z_][a-zA-Z_\d]*)\s+\*?[a-zA-Z_\[\]]+/;
    return field.exec(text) !== null && !text.includes('`');
  });
  return res;
}

function getStructScope(
  line: number,
  document: vscode.TextDocument
): { start: number; end: number } {
  const head = /type\s+\w+\s+struct\s*{/;
  const tail = /^\s*}/;

  let headLine = -1;
  let tailLine = -1;
  for (let l = line; l >= 0; l--) {
    const currentLine = document.lineAt(l).text;
    if (head.exec(currentLine)) {
      headLine = l;
      break;
    }
    if (
      l < line &&
      tail.exec(currentLine) &&
      !document.lineAt(l + 1).text.startsWith(currentLine.split('}')[0])
    ) {
      throw new Error('outside struct 2');
    }
  }
  const headText = document.lineAt(headLine).text;
  for (let l = line; l < document.lineCount; l++) {
    const currentLine = document.lineAt(l).text;
    if (
      tail.exec(currentLine) &&
      headText.startsWith(currentLine.split('}')[0])
    ) {
      tailLine = l;
      break;
    }
    if (l > line && head.exec(document.lineAt(l).text)) {
      throw new Error('outside struct');
    }
  }

  if (
    (headLine === -1 && tailLine !== -1) ||
    (headLine !== -1 && tailLine === -1)
  ) {
    throw new Error('invalid struct format');
  }

  if (headLine === -1 && tailLine === -1) {
    throw new Error('no struct to generate');
  }

  return { start: headLine, end: tailLine };
}

function generateTags(field: string,type: string | undefined): string {
  const cfg = config.getGenerationConfig();

  let tags = cfg.template;
  if(type){
    if(type === 'json-form-gorm'){
      tags = cfg.templateJsonFormGorm;
    }else if(type === 'json-gorm'){
      tags = cfg.templateJsonGorm;
    }else if(type === 'json-form'){
      tags = cfg.templateJsonForm;
    }else if(type === 'json'){
      tags = cfg.templateJson;
    }
  }
  for (let c of supportedCases) {
    const r = new RegExp(`{{${c}}}`, 'g');
    tags = tags.replace(r, formatField(field, c));
  }
  return tags;
}
