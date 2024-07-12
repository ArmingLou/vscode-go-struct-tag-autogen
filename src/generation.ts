import * as vscode from 'vscode';
import config from './config';
import { formatField } from './formatter';
import { supportedCases } from './constants';
import { FieldFull, InsertText } from './types';
import * as fs from 'fs';

export async function executeGenerateTagCommand(
  textEditor: vscode.TextEditor,
  edit: vscode.TextEditorEdit,
  type: string | undefined,
) {
  const document = textEditor.document;
  for (let selection of textEditor.selections) {
    const start = selection.start.line;
    const end = selection.end.line;

    try {
      const lines = await getFields(start, end, document);
      const inserts = await genTagsOfStruct(edit, type, lines);

      await vscode.window.activeTextEditor?.edit((editBuilder) => {
        for (let insert of inserts) {
          editBuilder.insert(insert.position, insert.text);
        }
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`${err.toString()} (line ${start + 1})`);
    }
  }
}



function generateTags(field: string, type: string | undefined): string {
  const cfg = config.getGenerationConfig();

  let tags = cfg.template;
  if (type) {
    if (type === 'json-form-gorm') {
      tags = cfg.templateJsonFormGorm;
    } else if (type === 'json-gorm') {
      tags = cfg.templateJsonGorm;
    } else if (type === 'json-form') {
      tags = cfg.templateJsonForm;
    } else if (type === 'json') {
      tags = cfg.templateJson;
    }
  }
  for (let c of supportedCases) {
    const r = new RegExp(`{{${c}}}`, 'g');
    tags = tags.replace(r, formatField(field, c));
  }
  return tags;
}


async function fieldTypeIsStruct(field: FieldFull): Promise<boolean> {
  let value = isBaseType(field.typePosition, field.document, field.type);
  if (value) {
    return false;
  }
  let isStruct = await getCustomTypeFromPositionIfStruct(field.typePosition, field.document, field.type);
  return isStruct;
}


function getFields(
  start: number,
  end: number,
  document: vscode.TextDocument,
): FieldFull[] {
  let scope: { start: number; end: number };
  try {
    scope = getStructScope(start, document);
  } catch (err) {
    if (start === end) { throw err; }
    scope = getStructScope(end, document);
  }

  if (scope.start > scope.end) {
    throw new Error(`invalid struct format (${document.fileName} : ${start}-${end} | found struct scope: ${scope.start}-${scope.end})`);
  }

  if (scope.start + 1 > scope.end - 1) {
    return [];
  }

  let res: number[] = [];
  for (let line = scope.start + 1; line <= scope.end - 1; line++) {
    res.push(line);
  }

  let fields: FieldFull[] = [];
  fields = res.map((line) => {
    const text = document.lineAt(line).text;
    // const field = /^\s*(([\w]+)\s)?\s*([\*\[\]\.\w\{\}]+)/;
    const fieldMulti = /^\s*([\w]+(\s*,\s*[\w]+)*\s)?\s*([\*\[\]\.\w\{\}]+)/;
    const tag = /^[^\/`]*`([^`]*)/;
    // const fs = field.exec(text);
    const fsMult = fieldMulti.exec(text);
    const tagJson = tag.exec(text);
    const tg = tagJson ? tagJson[1] : '';
    let pos: vscode.Position = new vscode.Position(line, 0);
    if (fsMult) {
      let idx = text.indexOf(fsMult[3]);
      pos = new vscode.Position(line, idx);
      let nameArr = fsMult[1] ? fsMult[1].split(',').map((name) => name.trim()).filter((name) => name !== '') : null;
      return {
        names: nameArr, //null 表示隐藏内嵌字段 或者 } 结尾
        type: fsMult[3],
        tagJson: tg,
        typePosition: pos,
        document: document
      };
    }
    return null;
  }).filter((field): field is FieldFull => {
    if (field === null) {
      return false;
    }

    if (field.names === null && field.type !== '}') {
      //隐藏字段
      if (!(/^[A-Z]/.test(fixTypeStr(getSuffixName(field.type))))) {
        return false; //  隐藏字段，且私有的，不处理
      }
    }
    if (!isInerStructStart(field)) {
      if (field.tagJson !== '' && field.type !== '}') {
        return false; // 已经有 tag 的，不重复处理
      }
      if (field.names !== null && field.names.length > 1) {
        return false; // 多个名字的，不处理 // 保留内部struct 开始{
      }
    }

    return true;
  });

  return fields;
}

function getStructScope(
  line: number,
  document: vscode.TextDocument,
): { start: number; end: number } {

  const typesStartRec = /^\s*type\s*\(\s*/;
  const typesEndRec = /^\s*\)\s*/;
  const typeRecSingle = /^\s*type\s+\w+\s+struct\s*\{/;
  const typeRecSingleEmpty = /^\s*type\s+\w+\s+struct\s*\{\s*\}/;
  const typeRecInBackets = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{/;
  const typeRecInBacketsEmpty = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{\s*\}/;
  const typeTail = /^\s*}/;

  let headLine = -1;
  let tailLine = -1;
  let backetStartLine = -1;

  // 向上找定义开始行
  for (let l = line; l >= 0; l--) {
    const currentLine = document.lineAt(l).text;
    if (typeRecSingleEmpty.exec(currentLine)) {
      // 空struct定义
      headLine = l;
      tailLine = l;
      break;
    } else if (typeRecSingle.exec(currentLine)) {
      headLine = l;
      break;
    }
    if (typesStartRec.exec(currentLine)) {
      backetStartLine = l;
      break;
    }
  }

  if (headLine === tailLine && headLine !== -1) {
    //空struct
    if (line !== headLine) {
      throw new Error(`光标不在 struct 定义代码块内 (${document.fileName} : ${line + 1})`);
    }
    return { start: headLine, end: headLine };
  }

  if (headLine === -1 && backetStartLine === -1) {
    throw new Error(`光标不在 struct 定义代码块内 (${document.fileName} : ${line + 1})`);
  }

  // 在独立 type struct {} 定义中找到 定义 结束行
  if (headLine > -1) {
    let headCounts = 1;
    let tailCounts = 0;
    for (let l = headLine; l < document.lineCount; l++) {
      const currentLine = document.lineAt(l).text;
      if (typeRecInBacketsEmpty.exec(currentLine)) {
        // headCounts++;
      } else if (typeRecInBackets.exec(currentLine)) {
        headCounts++;
      } else if (typeTail.exec(currentLine)) {
        tailCounts++;
      }

      if (headCounts === tailCounts) {
        tailLine = l;
        break;
      }
    }


    if (tailLine === -1 || tailLine < line) {
      throw new Error(`光标不在 struct 定义代码块内 (${document.fileName} : ${line + 1})`);
    }

  }

  // 在 type ( ) 中找到结构体定义开始 及 结束行
  if (backetStartLine > -1) {
    let headCounts = 0;
    let tailCounts = 0;
    let pass = false;
    let head = -1;
    for (let l = backetStartLine; l < document.lineCount; l++) {
      const currentLine = document.lineAt(l).text;
      if (l >= line) {
        pass = true;
      }
      if (typeRecInBacketsEmpty.exec(currentLine)) {
        // 空struct定义
        // headCounts++;
        if (head < 0) {
          head = l;
        }
      } else if (typeRecInBackets.exec(currentLine)) {
        headCounts++;
        if (head < 0) {
          head = l;
        }
      } else if (typeTail.exec(currentLine)) {
        tailCounts++;
      } else if (typesEndRec.exec(currentLine)) {
        break;
      }
      if (headCounts === tailCounts) {
        if (pass) {
          tailLine = l;
          headLine = head;
          break;
        } else {
          head = -1;
        }
      }
    }

    if (tailLine === -1) {
      throw new Error(`光标不在 struct 定义代码块内 (${document.fileName} : ${line + 1})`);
    }



  }

  if (headLine === -1) {
    throw new Error(`光标不在 struct 定义代码块内 (${document.fileName} : ${line + 1})`);
  }


  return { start: headLine, end: tailLine };
}

function isInerStructStart(field: FieldFull): boolean {
  let fixedType = fixTypeStr(field.type);
  if (fixedType === 'struct' || fixedType === 'struct{'
    || fixedType.endsWith(']struct') || fixedType.endsWith(']struct{')
  ) {
    return true;
  }
  return false;
}

export function getSuffixName(type: string): string {
  let index = type.lastIndexOf('.');
  if (index > 0) {
    return type.substring(index + 1);
  }
  return type;
}

export function fixTypeStr(type: string): string {
  if (type.startsWith('*')) {
    return type.substring(1);
  }
  return type;
}


async function genTagOfField(edit: vscode.TextEditorEdit, type: string | undefined, field: FieldFull, nameSpc: string = ''): Promise<InsertText> {
  let name = '';
  if (nameSpc !== '') {
    name = nameSpc
  } else {
    if (field.names === null) {
      name = fixTypeStr(getSuffixName(field.type))
    } else {
      name = field.names[0]
    }
  }
  const tags = generateTags(name, type);
  const line = field.typePosition.line;
  const document = field.document;
  return {
    position: new vscode.Position(line, document.lineAt(line).text.includes('//') ? document.lineAt(line).text.indexOf('//') : document.lineAt(line).range.end.character),
    text: ` \`${tags}\``
  }
}

async function genTagsOfStruct(edit: vscode.TextEditorEdit, type: string | undefined, fields: FieldFull[]): Promise<InsertText[]> {

  let inserts: InsertText[] = [];

  let inerStructStarField: FieldFull | null = null;
  let inerFields: FieldFull[] = [];
  let inerCount = 0;

  // 是否在数组内
  for (let field of fields) {

    let fixedType = fixTypeStr(field.type);


    if (inerCount > 0) {
      if (isInerStructStart(field)) {
        inerCount++;
        inerFields.push(field);
      } else if (fixedType === '}') {
        inerCount--;
        if (inerCount === 0) {
          if (field.tagJson !== '' || (inerStructStarField?.names?.length && inerStructStarField?.names.length > 1)) {
            // 不处理
          } else {
            inserts.push(await genTagOfField(edit, type, field, inerStructStarField?.names?.[0] ?? ''));
          }
          let inerStruct = await genTagsOfStruct(edit, type, inerFields);
          inserts.push(...inerStruct);
          inerStructStarField = null;
          inerCount = 0;
          inerFields = [];
        } else {
          inerFields.push(field);
        }
      } else {
        inerFields.push(field);
      }

    } else {
      if (field.names === null && field.type !== '}') {
        // 隐藏字段，嵌套 自定义类型

        let isStruc = await fieldTypeIsStruct(field);
        if (!isStruc) {
          inserts.push(await genTagOfField(edit, type, field));
        }

      } else if (isInerStructStart(field)) {
        inerStructStarField = field;
        inerCount++;
      } else {
        inserts.push(await genTagOfField(edit, type, field));
      }
    }
  }


  return inserts;
}


async function getCustomTypeFromPositionIfStruct(
  position: vscode.Position,
  document: vscode.TextDocument,
  typeName: string,
  excludeFilePaths: string[] = [],
): Promise<boolean> {

  typeName = fixTypeStr(getSuffixName(typeName));
  let isStr = false;
  let superType = null;

  // 优先 document 所在文件夹
  let f = vscode.workspace.asRelativePath(document.uri);
  const folder = f.substring(0, f.lastIndexOf('/')) + '/**/*.go';
  const currentFiles = await vscode.workspace.findFiles(folder);
  if (currentFiles.length > 0) {
    superType = await getCustomTypeSuperFromFiles(typeName, currentFiles, excludeFilePaths);
  }

  // 再查整个工作空间目录
  if (superType === null) {
    const files = await vscode.workspace.findFiles('**/*.go', folder);
    superType = await getCustomTypeSuperFromFiles(typeName, files, excludeFilePaths);
  }

  if (superType !== null) {

    // filePath 转换成 document
    let textDocument = await vscode.workspace.openTextDocument(superType.filePath);
    let positionNew = new vscode.Position(superType.line, superType.idx);

    if (superType.superTypeName.startsWith('[]')) {
      isStr = false;
    } else if (superType.superTypeName.startsWith('map[')) {
      isStr = false;
    } else if (superType.superTypeName === 'struct{}' || superType.superTypeName === 'struct' || superType.superTypeName === 'struct{') {

      isStr = true;

    } else {
      let value = isBaseType(positionNew, textDocument, superType.superTypeName);
      if (!value) {
        //  (2024-07-06) : 自定义类型
        // 预防死循环
        if (typeName === superType.superTypeName) {
          excludeFilePaths.push(superType.filePath);
        }
        isStr = await getCustomTypeFromPositionIfStruct(positionNew, textDocument, superType.superTypeName, excludeFilePaths);
      } else {
        isStr = false;
      }
    }
  } else {
    isStr = true;
  }


  return isStr;
}

async function getCustomTypeSuperFromFiles(
  typeName: string,
  files: vscode.Uri[],
  excludeFilePaths: string[] = [],
): Promise<{ superTypeName: string, line: number, idx: number, filePath: string } | null> {

  // 根据正则内容，获取定义文件及对应的position
  const typesStartRec = new RegExp('^\\s*type\\s*\\(\\s*');
  const typesEndRec = new RegExp('^\\s*\\)\\s*');
  const typeRecSingle = new RegExp('^\\s*type\\s+' + typeName + '\\s+([\\*\\[\\]\\.\\w\\{\\}]+)');
  const typeRecInBackets = new RegExp('^\\s*' + typeName + '\\s+([\\*\\[\\]\\.\\w\\{\\}]+)');

  const typeStructInBackets = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{/;
  const typeStructInBacketsEmpty = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{\s*\}/;
  const typeStructTail = /^\s*}/;

  let typeRec = typeRecSingle;
  // 搜索整个工作空间，寻找匹配正则内容的 文件


  for (const file of files) {
    const filePath = file.fsPath;
    if (excludeFilePaths.includes(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');

    const lines = content.split('\n');
    let lineCount = 0;
    let idx = 0;
    let superTypeName = '';
    let open = false;
    typeRec = typeRecSingle;
    let structOpen = 0;

    for (const line of lines) {

      if (!open) {
        let start = typesStartRec.exec(line);
        if (start && start[0] !== '') {
          open = true;
          typeRec = typeRecInBackets;
          // continue;
        }
      }

      if (structOpen === 0) { // 否则，可能是结构体内的字段
        let m = typeRec.exec(line);
        if (m) {
          superTypeName = fixTypeStr(m[1]);
          idx = line.indexOf(superTypeName);
          break;
        }
      }

      if (open) {
        if (typeStructInBacketsEmpty.exec(line)) {
          // structOpen++;
        } else if (typeStructInBackets.exec(line)) {
          structOpen++;
        } else if (typeStructTail.exec(line)) {
          structOpen--;
        }

        let end = typesEndRec.exec(line);
        if (end && end[0] !== '') {
          open = false;
          typeRec = typeRecSingle;
          structOpen = 0;
          // continue;
        }
      }
      lineCount++;
    }


    if (superTypeName !== '') {

      return {
        superTypeName: superTypeName,
        line: lineCount,
        idx: idx,
        filePath: filePath
      };

    }

  }
  return null;
}

function isBaseType(position: vscode.Position,
  document: vscode.TextDocument, type: string): boolean {

  type = fixTypeStr(type);

  switch (type) {
    case 'string':
    case 'int': case 'int8': case 'int16': case 'int32': case 'int64':
    case 'uint': case 'uint8': case 'uint16': case 'uint32': case 'uint64':
    case 'float32': case 'float64':
    case 'bool':
    case 'interface{}':
    // case 'struct{}': case 'struct':
    case 'error':
      return true;
    case 'chan': //不支持序列化类型，异常提示
    // throw new Error(`该struct不能序列化, 因含有 ${type} 类型字段。 (${document.fileName} : ${position.line + 1})`);
    case 'time.Time': case 'Time:': //常用的第三方类型
    case 'Decimal': case 'decimal.Decimal': //常用的第三方类型
    case 'sql.NullTime': case 'NullTime': case 'gorm.DeletedAt'://常用的第三方类型
    case 'time.Duration': //常用的第三方类型
      return true;
    default: //其他自定义类型，返回空 ,下一步处理
      return false;
  }
}

function unsupportedType(position: vscode.Position,
  document: vscode.TextDocument,type: string): boolean {
  type = fixTypeStr(type);

  switch (type) {
    case 'chan': //不支持序列化类型，异常提示
      return true;
    // throw new Error(`该struct不能序列化, 因含有 ${type} 类型字段。 (${document.fileName} : ${position.line + 1})`);
    default: //其他自定义类型，返回空 ,下一步处理
      return false;
  }
}