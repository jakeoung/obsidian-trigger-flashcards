import { AnkiConnectSettings } from './anki-connect';

export interface AnkiQuizSettings {
	geminiApiKey: string;
	exportFormat: 'txt' | 'csv' | 'ankiconnect';
	triggers: string[];
	folderPaths: string[];
	ankiConnect: AnkiConnectSettings;
}

export const DEFAULT_SETTINGS: AnkiQuizSettings = {
	geminiApiKey: '',
	exportFormat: 'txt',
	triggers: [
		'prototypical example',
		'key point',
	],
	folderPaths: [],
	ankiConnect: {
		enabled: true,
		url: 'http://localhost:8765',
		allowDeckCreation: true,
		noteType: 'Basic',
		existingNoteBehavior: 'skip'
	}
};