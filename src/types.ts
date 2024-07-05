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
