import { Position, TextDocument } from "vscode"

export type Case = 'none' | 'camel' | 'snake' | 'uppersnake' | 'pascal'

export type Config = {
	tagSuggestion: TagSuggestionConfig
	valueSuggestion: ValueSuggestionConfig
	generation: GenerationConfig
}

export type TagSuggestionConfig = {
	[tagName: string]: TagSuggestion
}

export type TagSuggestion = {
	cases?: Case[]
	options?: string[]
	prefix?: string
	splitter?: string 
}

export type ValueSuggestionConfig = {
	[tagName: string]: string[]
}

export type GenerationConfig = {
	template: string
	templateJson: string
	templateJsonGorm: string
	templateJsonForm: string
	templateJsonFormGorm: string
}


export type FieldFull = {
	names: string[] | null;//null 表示隐藏内嵌字段 或者 } 结尾
	type: string;
	tagJson: string;
	typePosition: Position;
	document: TextDocument;
  };
  
export type InsertText = {
	position: Position
	text: string
}