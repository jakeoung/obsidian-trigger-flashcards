import { Notice } from 'obsidian';
import { QuizQuestion } from './gemini-service';
import { AnkiConnectService, AnkiNote } from './anki-connect';
import { AnkiQuizSettings } from './settings';

export interface AnkiExportResult {
	success: number;
	failed: number;
	skipped: number;
	errors: string[];
	decksCreated: string[];
}

export class AnkiDirectExporter {
	private ankiConnectService: AnkiConnectService;
	private settings: AnkiQuizSettings;

	constructor(settings: AnkiQuizSettings) {
		this.settings = settings;
		this.ankiConnectService = new AnkiConnectService(settings.ankiConnect);
	}

	/**
	 * Export questions directly to Anki with smart deck organization
	 */
	async exportToAnki(questions: QuizQuestion[]): Promise<AnkiExportResult> {
		const result: AnkiExportResult = {
			success: 0,
			failed: 0,
			skipped: 0,
			errors: [],
			decksCreated: []
		};

		try {
			// Test connection first
			if (!await this.ankiConnectService.testConnection()) {
				throw new Error('AnkiConnect is not available. Please ensure Anki is running with AnkiConnect add-on installed.');
			}

			// Group questions by trigger word
			const questionGroups = this.groupQuestionsByTrigger(questions);
			
			// Process each group
			for (const [triggerWord, groupQuestions] of Object.entries(questionGroups)) {
				const deckResult = await this.processQuestionGroup(triggerWord, groupQuestions);
				
				// Accumulate results
				result.success += deckResult.success;
				result.failed += deckResult.failed;
				result.skipped += deckResult.skipped;
				result.errors.push(...deckResult.errors);
				result.decksCreated.push(...deckResult.decksCreated);
			}

			// Show summary
			this.showExportSummary(result);

		} catch (error) {
			console.error('Anki export failed:', error);
			result.errors.push(error.message);
			result.failed = questions.length;
			this.showErrorMessage(error.message);
		}

		return result;
	}

	/**
	 * Process a group of questions for a specific trigger/deck
	 */
	private async processQuestionGroup(triggerWord: string, questions: QuizQuestion[]): Promise<AnkiExportResult> {
		const result: AnkiExportResult = {
			success: 0,
			failed: 0,
			skipped: 0,
			errors: [],
			decksCreated: []
		};

		const deckName = triggerWord;

		if (!deckName) {
			console.warn('No trigger word found for question, skipping');
			return { success: 0, failed: 0, skipped: 1, errors: ['Question without trigger word'], decksCreated: [] };
		}

		try {
			// Ensure deck exists
			const deckCreated = await this.ensureDeckExists(deckName);
			if (deckCreated) {
				result.decksCreated.push(deckName);
			}

		// Convert questions to Anki notes
		const ankiNotes = questions.map(question => 
			this.ankiConnectService.convertQuestionToAnkiNote(
				question, 
				deckName, 
				triggerWord === 'other' ? undefined : triggerWord,
				'brain' // Using a simplified vault name to avoid URI encoding issues
			)
		);

		// Find matching existing notes (if any)
		const matches = await this.ankiConnectService.findMatchingNotesInfo(ankiNotes);

		const notesToCreate: AnkiNote[] = [];
		let updatedCount = 0;
		let skippedCount = 0;

		const behavior = this.settings.ankiConnect.existingNoteBehavior || 'skip';

		for (let i = 0; i < ankiNotes.length; i++) {
			const note = ankiNotes[i];
			const match = matches[i];
			if (match && match.noteId) {
				const existing = match.existingFields || {};
				if (behavior === 'create') {
					// Force create: treat as if no match
					notesToCreate.push(note);
					continue;
				}
				// For skip or update, decide based on content similarity
				const differs = (() => {
					if (note.modelName === 'Cloze') {
						const existingText = existing['Text'] || '';
						const newText = note.fields['Text'] || '';
						return !this.ankiConnectService.isContentSimilar(existingText, newText);
					} else {
						const existingFront = existing['Front'] || '';
						const newFront = note.fields['Front'] || '';
						const existingBack = existing['Back'] || '';
						const newBack = note.fields['Back'] || '';
						return !this.ankiConnectService.isContentSimilar(existingFront, newFront) || !this.ankiConnectService.isContentSimilar(existingBack, newBack);
					}
				})();

				if (!differs) {
					// Identical
					if (behavior === 'skip') {
						skippedCount++;
						continue;
					} else if (behavior === 'update') {
						// identical -> no update needed
						skippedCount++;
						continue;
					}
				}

				// differs
				if (behavior === 'update') {
					// Update only the answer-related fields to avoid clobbering questions/front content
					let fieldsToUpdate: Record<string, string> = {};
					if (note.modelName === 'Cloze') {
						// For cloze, update only the Extra field (explanation/notes)
						fieldsToUpdate['Extra'] = note.fields['Extra'] || '';
					} else {
						// For basic cards, update only the Back field (answer + explanation)
						fieldsToUpdate['Back'] = note.fields['Back'] || '';
					}

					const success = await this.ankiConnectService.updateNoteFields(match.noteId, fieldsToUpdate);
					if (success) {
						updatedCount++;
					} else {
						result.failed++;
						result.errors.push(`Failed to update note ${match.noteId} in ${deckName}`);
					}
				} else if (behavior === 'skip') {
					// skip even if differs
					skippedCount++;
				}
			} else {
				// No matching note found, schedule for creation
				notesToCreate.push(note);
			}
		}

		if (skippedCount > 0) {
			result.skipped += skippedCount;
			console.log(`Skipped ${skippedCount} identical cards in ${deckName}`);
		}

		if (updatedCount > 0) {
			result.success += updatedCount;
			new Notice(`🔄 Updated ${updatedCount} existing cards in "${deckName}"`);
		}

		// Add notes that didn't match any existing notes
		if (notesToCreate.length > 0) {
			const addResults = await this.ankiConnectService.addNotes(notesToCreate);
			addResults.forEach((noteId, idx) => {
				if (noteId === null) {
					result.failed++;
					result.errors.push(`Failed to add card in ${deckName}: ${questions[idx]?.question.substring(0, 50)}...`);
				} else {
					result.success++;
				}
			});
		}

		} catch (error) {
			console.error(`Error processing ${deckName}:`, error);
			result.failed += questions.length;
			result.errors.push(`Failed to process ${deckName}: ${error.message}`);
		}

		return result;
	}

	/**
	 * Ensure deck exists, create if needed
	 */
	private async ensureDeckExists(deckName: string): Promise<boolean> {
		const existingDecks = await this.ankiConnectService.getDeckNames();
		
		if (!existingDecks.includes(deckName)) {
			if (this.settings.ankiConnect.allowDeckCreation) {
				const created = await this.ankiConnectService.createDeck(deckName);
				if (created) {
					return true;
				} else {
					throw new Error(`Failed to create deck "${deckName}"`);
				}
			} else {
				throw new Error(`Deck "${deckName}" does not exist and deck creation is disabled`);
			}
		}
		
		return false;
	}

	/**
	 * Group questions by trigger word for deck organization
	 */
	private groupQuestionsByTrigger(questions: QuizQuestion[]): Record<string, QuizQuestion[]> {
		const groups: Record<string, QuizQuestion[]> = {};
		
		questions.forEach(question => {
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
		// Use the configured triggers from settings
		const triggerWords = this.settings.triggers;
		
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
			if (questionLower.includes(trigger.toLowerCase() + ':')) {
				return trigger;
			}
		}
		
		return null;
	}

	/**
	 * Show export summary to user
	 */
	private showExportSummary(result: AnkiExportResult): void {
		const messages: string[] = [];
		
		if (result.success > 0) {
			messages.push(`✅ Added ${result.success} cards`);
		}
		
		if (result.skipped > 0) {
			messages.push(`⚠️ Skipped ${result.skipped} duplicates`);
		}
		
		if (result.failed > 0) {
			messages.push(`❌ Failed ${result.failed} cards`);
		}
		
		if (result.decksCreated.length > 0) {
			messages.push(`📦 Created decks: ${result.decksCreated.join(', ')}`);
		}
		
		if (messages.length > 0) {
			new Notice(messages.join('\n'), 5000);
		}
		
		if (result.failed > 0) {
			console.error('Anki export errors:', result.errors);
		}
	}

	/**
	 * Show error message to user
	 */
	private showErrorMessage(errorMessage: string): void {
		if (errorMessage.includes('AnkiConnect is not available')) {
			new Notice('❌ AnkiConnect not available. Please:\n1. Open Anki\n2. Install AnkiConnect add-on\n3. Restart Anki', 8000);
		} else if (errorMessage.includes('duplicate')) {
			new Notice('❌ Some cards already exist in Anki. Try using different content or check existing cards.', 6000);
		} else {
			new Notice(`❌ Export to Anki failed: ${errorMessage}`, 6000);
		}
	}

	/**
	 * Update settings
	 */
	updateSettings(settings: AnkiQuizSettings): void {
		this.settings = settings;
		this.ankiConnectService.updateSettings(settings.ankiConnect);
	}
}