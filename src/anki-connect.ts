import { Notice } from 'obsidian';
import { QuizQuestion } from './gemini-service';

export interface AnkiConnectSettings {
	enabled: boolean;
	url: string;
	allowDeckCreation: boolean;
	noteType: string;
	/**
	 * Behavior when an existing matching note is found.
	 * - 'skip' : do nothing (default)
	 * - 'update' : update existing note fields when content differs
	 * - 'create' : always try to create a new note (may be rejected by Anki)
	 */
	existingNoteBehavior?: 'skip' | 'update' | 'create';
}

export interface AnkiNote {
	deckName: string;
	modelName: string;
	fields: Record<string, string>;
	tags: string[];
}

export interface AnkiConnectResponse {
	result: any;
	error: string | null;
}

export class AnkiConnectService {
	private settings: AnkiConnectSettings;

	constructor(settings: AnkiConnectSettings) {
		this.settings = settings;
	}

	updateSettings(settings: AnkiConnectSettings) {
		this.settings = settings;
	}

	/**
	 * Send a request to AnkiConnect API
	 */
	private async sendRequest(action: string, params?: any, version: number = 6): Promise<AnkiConnectResponse> {
		const requestBody = {
			action,
			version,
			params: params || {}
		};

		try {
			const response = await fetch(this.settings.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const result = await response.json();
			return result;
		} catch (error) {
			console.error('AnkiConnect request failed:', error);
			throw new Error(`AnkiConnect connection failed: ${error.message}`);
		}
	}

	/**
	 * Test if AnkiConnect is available and working
	 */
	async testConnection(): Promise<boolean> {
		try {
			const response = await this.sendRequest('version');
			return response.error === null && response.result !== null;
		} catch (error) {
			console.error('AnkiConnect test failed:', error);
			return false;
		}
	}

	/**
	 * Get AnkiConnect version
	 */
	async getVersion(): Promise<number | null> {
		try {
			const response = await this.sendRequest('version');
			if (response.error) {
				throw new Error(response.error);
			}
			return response.result;
		} catch (error) {
			console.error('Failed to get AnkiConnect version:', error);
			return null;
		}
	}

	/**
	 * Get list of available decks
	 */
	async getDeckNames(): Promise<string[]> {
		try {
			const response = await this.sendRequest('deckNames');
			if (response.error) {
				throw new Error(response.error);
			}
			return response.result || [];
		} catch (error) {
			console.error('Failed to get deck names:', error);
			return [];
		}
	}

	/**
	 * Create a new deck if it doesn't exist
	 */
	async createDeck(deckName: string): Promise<boolean> {
		try {
			const response = await this.sendRequest('createDeck', { deck: deckName });
			if (response.error) {
				throw new Error(response.error);
			}
			return true;
		} catch (error) {
			console.error(`Failed to create deck "${deckName}":`, error);
			return false;
		}
	}

	/**
	 * Get available note types (models)
	 */
	async getModelNames(): Promise<string[]> {
		try {
			const response = await this.sendRequest('modelNames');
			if (response.error) {
				throw new Error(response.error);
			}
			return response.result || [];
		} catch (error) {
			console.error('Failed to get model names:', error);
			return [];
		}
	}

	/**
	 * Convert text line breaks to HTML format for Anki
	 */
	private convertLineBreaksToHtml(text: string): string {
		// Ensure proper line breaks and clean up extra spaces
		return text
			.replace(/\n\s*\n/g, '<br><br>') // Double line breaks become double <br>
			.replace(/\n/g, '<br>') // Single line breaks become single <br>
			.replace(/\s+<br>/g, '<br>') // Remove spaces before <br>
			.replace(/<br>\s+/g, '<br>'); // Remove spaces after <br>
	}

	/**
	 * Convert filename patterns to clickable Obsidian links for Anki
	 */
	private convertFilenameToLink(text: string, vaultName: string): string {
		// Pattern to match filename.md at the start of a line
		const filenamePattern = /^([^<>\n]+\.md)/gm;

		// Helper to escape HTML in displayed text
		const escapeHtml = (str: string) => {
			return str
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		};

		return text.replace(filenamePattern, (match, filename) => {
			// Extract just the basename from filename.md
			const basename = filename.replace('.md', '');
			// Create simple URI without header links
			const obsidianUri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(basename)}`;

			// Display only the obsidian:// link (escaped) to keep the field clean
			const displayFilename = escapeHtml(filename);

			return `<a href="${obsidianUri}">${displayFilename}</a>`;
		});
	}

	/**
	 * Convert QuizQuestion to AnkiNote format
	 */
	convertQuestionToAnkiNote(question: QuizQuestion, deckName: string, triggerWord?: string, vaultName?: string): AnkiNote {
		let fields: Record<string, string>;
		let modelName: string;
		let finalDeckName = deckName;

		// Use trigger word as deck name if provided
		if (triggerWord) {
			finalDeckName = triggerWord;
		}

		if (question.type === 'cloze' && question.clozeText) {
			// Use Cloze note type for cloze deletion cards
			modelName = 'Cloze';
			const vault = vaultName || 'My Drive/docs/brain';
			let clozeTextWithLinks = this.convertFilenameToLink(question.clozeText, vault);
			clozeTextWithLinks = this.convertLineBreaksToHtml(clozeTextWithLinks);
			
			fields = {
				'Text': clozeTextWithLinks,
				'Extra': question.explanation ? this.convertLineBreaksToHtml(question.explanation) : ''
			};
		} else {
			// Use Basic note type for Q&A cards
			modelName = this.settings.noteType || 'Basic';
			const vault = vaultName || 'My Drive/docs/brain';
			let questionWithLinks = this.convertFilenameToLink(question.question, vault);
			questionWithLinks = this.convertLineBreaksToHtml(questionWithLinks);
			
			fields = {
				'Front': questionWithLinks,
				'Back': this.convertLineBreaksToHtml(question.answer + (question.explanation ? '\n\n' + question.explanation : ''))
			};

			// Handle multiple choice questions
			if (question.type === 'multiple-choice' && question.options) {
				const optionsText = '\n\nOptions:\n' + question.options.map((opt, i) => 
					`${String.fromCharCode(65 + i)}. ${opt}`
				).join('\n');
				let fullQuestionWithLinks = this.convertFilenameToLink(question.question + optionsText, vault);
				fields.Front = this.convertLineBreaksToHtml(fullQuestionWithLinks);
			}
		}

		// Add tags based on question type and source
		const tags = [
			'obsidian-plugin',
			`type::${question.type}`,
		];

		if (triggerWord) {
			tags.push(`trigger::${triggerWord}`);
		}

		if (question.type === 'cloze') {
			tags.push('cloze-deletion');
		}

		return {
			deckName: finalDeckName,
			modelName,
			fields,
			tags
		};
	}

	/**
	 * Check if notes with similar content already exist
	 */
	async findDuplicateNotes(notes: AnkiNote[]): Promise<boolean[]> {
		// Backwards-compatible wrapper that uses findMatchingNotesInfo under the hood
		const matches = await this.findMatchingNotesInfo(notes);
		return matches.map(m => m.noteId !== null && m.noteId !== undefined);
	}

	/**
	 * Find matching existing notes (if any) and return their IDs and fields.
	 * This is used to allow updating an existing note when the content differs.
	 */
	async findMatchingNotesInfo(notes: AnkiNote[]): Promise<Array<{ noteId: number | null; existingFields: Record<string, string> | null }>> {
		try {
			const checks = await Promise.all(
				notes.map(async (note) => {
					let query = '';
					if (note.modelName === 'Cloze') {
						const textContent = note.fields['Text'] || '';
						const cleanText = textContent.replace(/\{\{c\d+::(.*?)\}\}/g, '$1');
						const words = cleanText.split(/\s+/).filter(w => w.length > 2).slice(0, 3).join(' ');
						if (words.length > 0) {
							query = `deck:"${note.deckName}" note:"${note.modelName}" Text:"${words}"`;
						}
					} else {
						const frontContent = note.fields['Front'] || '';
						const cleanFront = frontContent.replace(/[^\w\s]/g, ' ').trim();
						const words = cleanFront.split(/\s+/).filter(w => w.length > 2).slice(0, 3).join(' ');
						if (words.length > 0) {
							query = `deck:"${note.deckName}" note:"${note.modelName}" Front:"${words}"`;
						}
					}

					if (!query) {
						return { noteId: null, existingFields: null };
					}

					const response = await this.sendRequest('findNotes', { query });
					const foundNotes = response.result || [];
					if (foundNotes.length > 0) {
						const notesInfo = await this.sendRequest('notesInfo', { notes: foundNotes });
						if (notesInfo.result && notesInfo.result.length > 0) {
							const existingNote = notesInfo.result[0];
							const fieldsObj: Record<string, string> = {};
							if (note.modelName === 'Cloze') {
								fieldsObj['Text'] = existingNote.fields?.Text?.value || '';
							} else {
								fieldsObj['Front'] = existingNote.fields?.Front?.value || '';
								fieldsObj['Back'] = existingNote.fields?.Back?.value || '';
							}
							const id = existingNote.noteId || existingNote.noteId === 0 ? existingNote.noteId : (existingNote.id || null);
							return { noteId: id, existingFields: fieldsObj };
						}
					}

					return { noteId: null, existingFields: null };
				})
			);
			return checks;
		} catch (error) {
			console.error('Error checking for matching notes:', error);
			return notes.map(() => ({ noteId: null, existingFields: null }));
		}
	}

	/**
	 * Update fields for an existing note
	 */
	async updateNoteFields(noteId: number, fields: Record<string, string>): Promise<boolean> {
		try {
			const response = await this.sendRequest('updateNoteFields', { note: { id: noteId, fields } });
			if (response.error) {
				throw new Error(response.error);
			}
			return true;
		} catch (error) {
			console.error(`Failed to update note ${noteId}:`, error);
			return false;
		}
	}

	/**
	 * Check if two content strings are similar enough to be considered duplicates
	 */
	isContentSimilar(content1: string, content2: string): boolean {
		// Normalize both strings
		const normalize = (str: string) => {
			return str.toLowerCase()
				.replace(/[^\w\s]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		};

		const norm1 = normalize(content1);
		const norm2 = normalize(content2);

		// If strings are identical after normalization, they're duplicates
		if (norm1 === norm2) {
			return true;
		}

		// Check if one string contains the other (for partial matches)
		if (norm1.length > 20 && norm2.length > 20) {
			return norm1.includes(norm2) || norm2.includes(norm1);
		}

		return false;
	}

	/**
	 * Add a single note to Anki
	 */
	async addNote(note: AnkiNote): Promise<number | null> {
		try {
			const response = await this.sendRequest('addNote', { note });
			if (response.error) {
				throw new Error(response.error);
			}
			return response.result; // Returns note ID
		} catch (error) {
			console.error('Failed to add note:', error);
			throw error;
		}
	}

	/**
	 * Add multiple notes to Anki
	 */
	async addNotes(notes: AnkiNote[]): Promise<(number | null)[]> {
		try {
			const response = await this.sendRequest('addNotes', { notes });
			if (response.error) {
				throw new Error(response.error);
			}
			return response.result || [];
		} catch (error) {
			console.error('Bulk add failed, trying individual notes:', error);
			
			// If bulk add fails, try adding notes one by one
			// This helps handle individual duplicate errors without failing the entire batch
			const results: (number | null)[] = [];
			
			for (const note of notes) {
				try {
					const singleResponse = await this.sendRequest('addNote', { note });
					if (singleResponse.error) {
						if (singleResponse.error.includes('duplicate')) {
							console.log(`Skipping duplicate note: ${JSON.stringify(note.fields).substring(0, 100)}...`);
							results.push(null); // Mark as failed but don't throw
						} else {
							throw new Error(singleResponse.error);
						}
					} else {
						results.push(singleResponse.result);
					}
				} catch (noteError) {
					console.error(`Failed to add individual note:`, noteError);
					results.push(null);
				}
			}
			
			return results;
		}
	}

	/**
	 * Export quiz questions directly to Anki
	 */
	async exportQuestions(questions: QuizQuestion[], deckName?: string): Promise<{ success: number; failed: number; errors: string[] }> {
		const errors: string[] = [];
		let successCount = 0;
		let failedCount = 0;

		try {
			// Test connection first
			const isConnected = await this.testConnection();
			if (!isConnected) {
				throw new Error('AnkiConnect is not available. Make sure Anki is running with AnkiConnect add-on installed.');
			}

			// Group questions by trigger word if possible
			const questionsByTrigger = this.groupQuestionsByTrigger(questions);
			
			for (const [triggerWord, triggerQuestions] of Object.entries(questionsByTrigger)) {
				const targetDeck = triggerWord;

				// Check if deck exists, create if allowed
				const existingDecks = await this.getDeckNames();
				if (!existingDecks.includes(targetDeck)) {
					if (this.settings.allowDeckCreation) {
						const created = await this.createDeck(targetDeck);
						if (!created) {
							throw new Error(`Failed to create deck "${targetDeck}"`);
						}
						new Notice(`Created new deck: ${targetDeck}`);
					} else {
						throw new Error(`Deck "${targetDeck}" does not exist and deck creation is disabled`);
					}
				}

				// Convert questions to Anki notes
				const ankiNotes = triggerQuestions.map(question => 
					this.convertQuestionToAnkiNote(question, targetDeck, triggerWord === 'other' ? undefined : triggerWord, 'brain')
				);

				// Check for duplicates
				const isDuplicateList = await this.findDuplicateNotes(ankiNotes);
				
				// Filter out duplicates and add only new notes
				const newNotes: AnkiNote[] = [];
				const skippedDuplicates: string[] = [];
				
				ankiNotes.forEach((note, index) => {
					if (isDuplicateList[index]) {
						skippedDuplicates.push(`Skipped duplicate: ${triggerQuestions[index].question.substring(0, 50)}...`);
					} else {
						newNotes.push(note);
					}
				});

				if (skippedDuplicates.length > 0) {
					new Notice(`⚠️ Skipped ${skippedDuplicates.length} duplicate cards in ${targetDeck}`);
					console.log('Skipped duplicates:', skippedDuplicates);
				}

				if (newNotes.length > 0) {
					// Add only new notes to Anki
					const results = await this.addNotes(newNotes);
					
					// Count successes and failures for this trigger
					results.forEach((result, index) => {
						if (result === null) {
							failedCount++;
							const originalIndex = ankiNotes.findIndex(note => note === newNotes[index]);
							errors.push(`Failed to add card in ${targetDeck}: ${triggerQuestions[originalIndex]?.question.substring(0, 50)}...`);
						} else {
							successCount++;
						}
					});

					if (results.filter(r => r !== null).length > 0) {
						new Notice(`✅ Added ${results.filter(r => r !== null).length} cards to deck "${targetDeck}"`);
					}
				}
			}

			if (successCount === 0 && failedCount === 0) {
				new Notice('No new cards to add - all cards already exist in Anki');
				return {
					success: 0,
					failed: 0,
					errors: ['All cards already exist in Anki']
				};
			}

			if (failedCount > 0) {
				new Notice(`⚠️ Failed to add ${failedCount} cards. Check console for details.`);
				console.error('AnkiConnect export errors:', errors);
			}

		} catch (error) {
			console.error('AnkiConnect export failed:', error);
			errors.push(error.message);
			failedCount = questions.length;
			
			// Show user-friendly error message
			if (error.message.includes('AnkiConnect is not available')) {
				new Notice('❌ AnkiConnect not available. Please:\n1. Open Anki\n2. Install AnkiConnect add-on\n3. Restart Anki', 8000);
			} else if (error.message.includes('duplicate')) {
				new Notice('❌ Some cards already exist in Anki. Try using different content or check existing cards.', 6000);
			} else {
				new Notice(`❌ Export to Anki failed: ${error.message}`, 6000);
			}
		}

		return {
			success: successCount,
			failed: failedCount,
			errors
		};
	}

	/**
	 * Group questions by trigger word for separate decks
	 */
	private groupQuestionsByTrigger(questions: QuizQuestion[]): Record<string, QuizQuestion[]> {
		const groups: Record<string, QuizQuestion[]> = {};
		
		questions.forEach(question => {
			// Try to extract trigger word from the question or answer
			const triggerWord = this.extractTriggerWord(question);
			
			if (triggerWord) {
				if (!groups[triggerWord]) {
					groups[triggerWord] = [];
				}
				groups[triggerWord].push(question);
			} else {
				console.warn('Question without trigger word:', question.question);
			}
		});
		
		return groups;
	}

	/**
	 * Extract trigger word from question content
	 */
	private extractTriggerWord(question: QuizQuestion): string | null {
		// Common trigger words to look for
		const triggerWords = [
			'definition', 'example', 'formula', 'theorem', 'principle', 
			'law', 'concept', 'key point', 'important', 'prototypical example'
		];
		
		const content = (question.question + ' ' + question.answer).toLowerCase();
		
		// Look for trigger words in the content
		for (const trigger of triggerWords) {
			if (content.includes(trigger.toLowerCase())) {
				return trigger;
			}
		}
		
		// Check if the question starts with a trigger pattern
		const questionLower = question.question.toLowerCase();
		for (const trigger of triggerWords) {
			if (questionLower.startsWith(trigger.toLowerCase())) {
				return trigger;
			}
		}
		
		return null;
	}

	/**
	 * Get information about AnkiConnect status and available resources
	 */
	async getAnkiInfo(): Promise<{
		connected: boolean;
		version: number | null;
		decks: string[];
		models: string[];
	}> {
		const connected = await this.testConnection();
		
		if (!connected) {
			return {
				connected: false,
				version: null,
				decks: [],
				models: []
			};
		}

		const [version, decks, models] = await Promise.all([
			this.getVersion(),
			this.getDeckNames(),
			this.getModelNames()
		]);

		return {
			connected,
			version,
			decks,
			models
		};
	}
}