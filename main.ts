import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { AnkiQuizSettings, DEFAULT_SETTINGS } from './src/settings';
import { GeminiService, QuizQuestion } from './src/gemini-service';
import { QuizModal } from './src/quiz-modal';
import { AnkiConnectService } from './src/anki-connect';

interface FolderProcessingResult {
	folderPath: string;
	fileCount: number;
	questionCount: number;
}

export default class AnkiQuizPlugin extends Plugin {
	settings: AnkiQuizSettings;
	geminiService: GeminiService;
	ankiConnectService: AnkiConnectService;

	async onload() {
		await this.loadSettings();
		this.geminiService = new GeminiService(this.settings);
		this.ankiConnectService = new AnkiConnectService(this.settings.ankiConnect);

		// Main command: Generate cards from triggers
		this.addCommand({
			id: 'generate-trigger-word-cards',
			name: 'Generate Cards from Triggers of Current File',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.generateTriggerWordCards();
					}
					return true;
				}
				return false;
			}
		});

		// Process multiple folders for triggers
		this.addCommand({
			id: 'process-folders-trigger-words',
			name: 'Process Multiple Folders for Triggers',
			callback: () => {
				this.processFoldersTriggerWords();
			}
		});

		// Direct export to Anki command for multiple files
		this.addCommand({
			id: 'export-multiple-files-to-anki',
			name: 'Export All Files Directly to Anki',
			callback: () => {
				if (!this.settings.ankiConnect.enabled) {
					new Notice('AnkiConnect is not enabled. Please enable it in settings.');
					return;
				}
				this.exportMultipleFilesToAnki();
			}
		});

		// LEGACY COMMANDS (commented out to hide from command palette)
		// Legacy: Generate cloze cards from highlights
		// this.addCommand({
		// 	id: 'generate-cloze-only',
		// 	name: 'Generate Cloze Cards Only (Legacy)',
		// 	checkCallback: (checking: boolean) => {
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			if (!checking) {
		// 				this.generateClozeFromHighlights();
		// 			}
		// 			return true;
		// 		}
		// 		return false;
		// 	}
		// });

		// Legacy: Generate quiz from highlights and cues
		// this.addCommand({
		// 	id: 'generate-quiz-from-highlights',
		// 	name: 'Generate Quiz from Highlights and Cues (Legacy)',
		// 	checkCallback: (checking: boolean) => {
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			if (!checking) {
		// 				this.generateQuizFromHighlights();
		// 			}
		// 			return true;
		// 		}
		// 		return false;
		// 	}
		// });

		// Legacy AI enhancement command
		// this.addCommand({
		// 	id: 'generate-ai-enhanced-quiz',
		// 	name: 'Generate AI Enhanced Quiz (Legacy)',
		// 	checkCallback: (checking: boolean) => {
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			if (!checking) {
		// 				this.generateAIEnhancedQuiz();
		// 			}
		// 			return true;
		// 		}
		// 		return false;
		// 	}
		// });


		// Debug command to show vault info
		this.addCommand({
			id: 'debug-vault-info',
			name: 'Debug: Show Vault Info',
			callback: () => {
				const allFiles = this.app.vault.getAllLoadedFiles();
				const markdownFiles = this.app.vault.getMarkdownFiles();
				
				const fileTypes = allFiles.reduce((acc, file) => {
					const type = file.constructor.name;
					acc[type] = (acc[type] || 0) + 1;
					return acc;
				}, {} as Record<string, number>);

				const debugInfo = [
					`Total files: ${allFiles.length}`,
					`Markdown files: ${markdownFiles.length}`,
					`File types: ${JSON.stringify(fileTypes, null, 2)}`,
					`First 5 files: ${allFiles.slice(0, 5).map(f => `${f.constructor.name}: ${f.path}`).join(', ')}`
				];

				console.log('Vault Debug Info:', debugInfo);
				new Notice(`Debug info logged to console:\n${debugInfo.slice(0, 3).join('\n')}`, 5000);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AnkiQuizSettingTab(this.app, this));
	}

	async generateTriggerWordCards() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			new Notice('Please open a markdown file');
			return;
		}

		try {
			const content = markdownView.getViewData();
						console.log('📄 Processing document for triggers...');
			
			// Focus only on triggers
			const triggerWordMatches = this.checkForTriggerWords(content);

						console.log(`🎯 Found ${triggerWordMatches.length} triggers`);

			if (triggerWordMatches.length === 0) {
								new Notice('No triggers found in this document');
				return;
			}

			// ⚡ FAST LOCAL PROCESSING (immediate results)
			console.log('⚡ Processing triggers with context...');
			const triggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, markdownView);
			console.log(`⚡ Generated ${triggerQuestions.length} contextual trigger cards`);

			console.log(`⚡ Fast processing complete! Generated ${triggerQuestions.length} cards instantly`);

			// Show modal with the locally generated cards
			const modal = new QuizModal(this.app, triggerQuestions, this.settings.exportFormat, this.settings);
			modal.open();

			new Notice(`✅ Generated ${triggerQuestions.length} trigger cards!`);

		} catch (error) {
			console.error('Error generating trigger cards:', error);
			new Notice(`Error generating trigger cards: ${error.message}`);
		}
	}

	async exportMultipleFilesToAnki() {
		if (!this.settings.ankiConnect.enabled) {
			new Notice('AnkiConnect is not enabled. Please enable it in settings.');
			return;
		}

		if (this.settings.folderPaths.length === 0) {
			new Notice('No folders configured. Please add folder paths in settings for batch export.');
			return;
		}

		try {
			const allQuestions: QuizQuestion[] = [];
			let processedFiles = 0;
			
			new Notice(`� Processing ${this.settings.folderPaths.length} folder(s) for direct Anki export...`);

			for (const folderPath of this.settings.folderPaths) {
				// Get all markdown files in the specified path
				const files = this.app.vault.getMarkdownFiles().filter(file => 
					file.path.startsWith(folderPath + '/') || 
					(folderPath === '' && !file.path.includes('/'))
				);

				for (const file of files) {
					try {
						const content = await this.app.vault.read(file);
						
						// Extract only trigger words
						const triggerWordMatches = this.checkForTriggerWords(content);

						// Create a mock MarkdownView object for compatibility
						const mockView = {
							file: file,
							getViewData: () => content
						};

						// Generate trigger word cards only
						if (triggerWordMatches.length > 0) {
							const triggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, mockView as any);
							allQuestions.push(...triggerQuestions);
							processedFiles++;
						}

					} catch (error) {
						console.error(`Error processing file ${file.path}:`, error);
					}
				}
			}

			if (allQuestions.length === 0) {
				new Notice('No triggers found in configured folders');
				return;
			}

			// Import AnkiDirectExporter and export directly
			const { AnkiDirectExporter } = await import('./src/anki-direct-exporter');
			const exporter = new AnkiDirectExporter(this.settings);
			
			new Notice(`� Exporting ${allQuestions.length} cards from ${processedFiles} files to Anki...`);
			const result = await exporter.exportToAnki(allQuestions);
			
			if (result.success > 0) {
				new Notice(`✅ Successfully exported ${result.success} cards to Anki from ${processedFiles} files!`);
			} else {
				new Notice(`❌ Export failed. ${result.errors.join(', ')}`);
			}

		} catch (error) {
			console.error('Error exporting multiple files to Anki:', error);
			new Notice(`Error exporting multiple files to Anki: ${error.message}`);
		}
	}

	async processFoldersTriggerWords() {
		if (this.settings.folderPaths.length === 0) {
			new Notice('No folders configured. Please add folder paths in settings.');
			return;
		}

		try {
			const allQuestions: QuizQuestion[] = [];
			const processingResults: FolderProcessingResult[] = [];
			
			new Notice(`Processing ${this.settings.folderPaths.length} configured folder(s) for triggers...`);

		for (const folderPath of this.settings.folderPaths) {
			// Try to get folder, but also process if files exist in the path
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			const filesInPath = this.app.vault.getMarkdownFiles()
				.filter(file => file.path.startsWith(folderPath + '/') || 
						(folderPath === '' && !file.path.includes('/')));

			if (!folder && filesInPath.length === 0) {
				console.warn(`Skipping invalid folder: ${folderPath} (no folder object and no files)`);
				continue;
			}

			// Process files directly if folder object not found but files exist
			const folderQuestions = folder ? 
				await this.processFolderFilesTriggerWords(folder) :
				await this.processFilesByPath(folderPath);
			
			allQuestions.push(...folderQuestions);
			
			const fileCount = filesInPath.length;
			processingResults.push({
				folderPath: folderPath,
				fileCount: fileCount,
				questionCount: folderQuestions.length
			});
		}			if (allQuestions.length === 0) {
				new Notice('No triggers found in configured folders');
				return;
			}

			// Show processing results first
			const resultsModal = new ProcessingResultsModal(this.app, processingResults, () => {
				// Show quiz modal after results are acknowledged
				const modal = new QuizModal(this.app, allQuestions, this.settings.exportFormat, this.settings);
				modal.open();
			});
			resultsModal.open();

			const totalFiles = processingResults.reduce((sum, result) => sum + result.fileCount, 0);
			new Notice(`✅ Generated ${allQuestions.length} trigger cards from ${totalFiles} files!`);

		} catch (error) {
			console.error('Error processing folders for triggers:', error);
			new Notice(`Error processing folders for triggers: ${error.message}`);
		}
	}

	async processFolderFilesTriggerWords(folder: any): Promise<QuizQuestion[]> {
		const questions: QuizQuestion[] = [];
		
		// Process all markdown files in the folder
		const files = this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(folder.path + '/') || file.path === folder.path
		);

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				
				// Extract only trigger words
				const triggerWordMatches = this.checkForTriggerWords(content);

				// Create a mock MarkdownView object for compatibility
				const mockView = {
					file: file,
					getViewData: () => content
				};

				// Generate trigger word cards only
				if (triggerWordMatches.length > 0) {
					const triggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, mockView as any);
					questions.push(...triggerQuestions);
				}

			} catch (error) {
				console.error(`Error processing file ${file.path}:`, error);
			}
		}

		return questions;
	}

	async generateQuizFromHighlights() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			new Notice('Please open a markdown file');
			return;
		}

		try {
			const content = markdownView.getViewData();
			console.log('📄 Processing document content...');
			
			// Extract all types of content for fast local processing
			const highlightMatches = this.extractHighlights(content);
			const remNoteMatches = this.extractRemNoteCues(content);
			const triggerWordMatches = this.checkForTriggerWords(content);

			console.log(`🔍 Found ${highlightMatches.length} highlights, ${remNoteMatches.length} RemNote cues, ${triggerWordMatches.length} trigger words`);

			if (highlightMatches.length === 0 && remNoteMatches.length === 0 && triggerWordMatches.length === 0) {
				new Notice('No highlights, RemNote-style cues (text::answer), or trigger words found in this document');
				return;
			}

			// ⚡ FAST LOCAL PROCESSING (immediate results)
			const questions: QuizQuestion[] = [];
			console.log('⚡ Starting fast local processing...');

			// Generate basic cloze cards from highlights (no AI needed)
			if (highlightMatches.length > 0) {
				console.log('⚡ Processing highlights locally...');
				const basicClozeQuestions = this.generateContextualClozeCards(content, highlightMatches, markdownView);
				questions.push(...basicClozeQuestions);
				console.log(`⚡ Generated ${basicClozeQuestions.length} contextual cloze cards`);
			}

			// Generate basic Q&A cards from RemNote-style cues (no AI needed)
			if (remNoteMatches.length > 0) {
				console.log('⚡ Processing RemNote cues locally...');
				const basicQAQuestions = this.generateContextualQACards(remNoteMatches, content, markdownView);
				questions.push(...basicQAQuestions);
				console.log(`⚡ Generated ${basicQAQuestions.length} contextual Q&A cards`);
			}

			// Generate basic Q&A cards from triggers (no AI needed)
			if (triggerWordMatches.length > 0) {
				console.log('⚡ Processing triggers with context...');
				const contextualTriggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, markdownView);
				questions.push(...contextualTriggerQuestions);
				console.log(`⚡ Generated ${contextualTriggerQuestions.length} contextual trigger word cards`);
			}

			console.log(`⚡ Fast processing complete! Generated ${questions.length} cards instantly`);

			// Show modal with the locally generated cards
			const modal = new QuizModal(this.app, questions, this.settings.exportFormat, this.settings);
			modal.open();

			new Notice(`✅ Generated ${questions.length} cards!`);

		} catch (error) {
			console.error('Error generating quiz:', error);
			new Notice(`Error generating quiz: ${error.message}`);
		}
	}

	async generateClozeFromHighlights() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			new Notice('Please open a markdown file');
			return;
		}

		try {
			const content = markdownView.getViewData();
			const highlights = this.extractHighlights(content);
			
			if (highlights.length === 0) {
				new Notice('No highlights found in this document');
				return;
			}

			// Generate contextual cloze cards
			const questions = this.generateContextualClozeCards(content, highlights, markdownView);
			
			const modal = new QuizModal(this.app, questions, this.settings.exportFormat, this.settings);
			modal.open();

		} catch (error) {
			console.error('Error generating cloze cards:', error);
			new Notice(`Error generating cloze cards: ${error.message}`);
		}
	}

	async generateAIEnhancedQuiz() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			new Notice('Please open a markdown file');
			return;
		}

		if (!this.settings.geminiApiKey) {
			new Notice('Please set your Gemini API key in settings to use AI enhancement');
			return;
		}

		try {
			const content = markdownView.getViewData();
			console.log('📄 Processing document content with AI...');
			
			// Extract all types of content for fast local processing first
			const highlightMatches = this.extractHighlights(content);
			const remNoteMatches = this.extractRemNoteCues(content);
			const triggerWordMatches = this.checkForTriggerWords(content);

			console.log(`🔍 Found ${highlightMatches.length} highlights, ${remNoteMatches.length} RemNote cues, ${triggerWordMatches.length} trigger words`);

			if (highlightMatches.length === 0 && remNoteMatches.length === 0 && triggerWordMatches.length === 0) {
				new Notice('No highlights, RemNote-style cues (text::answer), or trigger words found in this document');
				return;
			}

			// Generate basic cards first
			const questions: QuizQuestion[] = [];

			if (highlightMatches.length > 0) {
				const basicClozeQuestions = this.generateContextualClozeCards(content, highlightMatches, markdownView);
				questions.push(...basicClozeQuestions);
			}

			if (remNoteMatches.length > 0) {
				const basicQAQuestions = this.generateContextualQACards(remNoteMatches, content, markdownView);
				questions.push(...basicQAQuestions);
			}

			if (triggerWordMatches.length > 0) {
				const contextualTriggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, markdownView);
				questions.push(...contextualTriggerQuestions);
			}

			// Show modal immediately with basic cards
			const modal = new QuizModal(this.app, questions, this.settings.exportFormat, this.settings);
			modal.open();

			// AI Enhancement
			console.log('🤖 Starting AI enhancement...');
			new Notice('🤖 Enhancing cards with AI...');
			
			try {
				// Single AI call for all enhancements
				const enhancedQuestions = await this.geminiService.enhanceAllCards(questions, content);
				
				// Close current modal and open new one with enhanced questions
				modal.close();
				const enhancedModal = new QuizModal(this.app, enhancedQuestions, this.settings.exportFormat, this.settings);
				enhancedModal.open();
				
				new Notice(`✨ Enhanced ${enhancedQuestions.length} cards with AI!`);
				console.log(`✨ AI enhancement complete! Enhanced ${enhancedQuestions.length} cards`);
			} catch (error) {
				console.error('AI enhancement failed:', error);
				new Notice(`⚠️ AI enhancement failed: ${error.message}`);
			}

		} catch (error) {
			console.error('Error generating AI enhanced quiz:', error);
			new Notice(`Error generating AI enhanced quiz: ${error.message}`);
		}
	}

	async processFolderBatch() {
		if (this.settings.folderPaths.length === 0) {
			new Notice('No folders configured. Please add folder paths in settings.');
			return;
		}

		try {
			const allQuestions: QuizQuestion[] = [];
			const processingResults: FolderProcessingResult[] = [];
			
			new Notice(`Processing ${this.settings.folderPaths.length} configured folder(s)...`);

		for (const folderPath of this.settings.folderPaths) {
			// Try to get folder, but also process if files exist in the path
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			const filesInPath = this.app.vault.getMarkdownFiles()
				.filter(file => file.path.startsWith(folderPath + '/') || 
						(folderPath === '' && !file.path.includes('/')));

			if (!folder && filesInPath.length === 0) {
				console.warn(`Skipping invalid folder: ${folderPath} (no folder object and no files)`);
				continue;
			}

			// Process files directly if folder object not found but files exist
			const folderQuestions = folder ? 
				await this.processFolderFiles(folder) :
				await this.processFilesByPathAllTypes(folderPath);
			
			allQuestions.push(...folderQuestions);
			
			const fileCount = filesInPath.length;
			processingResults.push({
				folderPath: folderPath,
				fileCount: fileCount,
				questionCount: folderQuestions.length
			});
		}			if (allQuestions.length === 0) {
				new Notice('No highlights, cues, or trigger words found in configured folders');
				return;
			}

			// Show processing results first
			const resultsModal = new ProcessingResultsModal(this.app, processingResults, () => {
				// Show quiz modal after results are acknowledged
				const modal = new QuizModal(this.app, allQuestions, this.settings.exportFormat, this.settings);
				modal.open();
			});
			resultsModal.open();

			const totalFiles = processingResults.reduce((sum, result) => sum + result.fileCount, 0);
			new Notice(`✅ Generated ${allQuestions.length} cards from ${totalFiles} files!`);

		} catch (error) {
			console.error('Error processing folders:', error);
			new Notice(`Error processing folders: ${error.message}`);
		}
	}

	async processFolderFiles(folder: any): Promise<QuizQuestion[]> {
		const questions: QuizQuestion[] = [];
		
		// Process all markdown files in the folder
		const files = this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(folder.path + '/') || file.path === folder.path
		);

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				
				// Extract content like in the main method
				const highlightMatches = this.extractHighlights(content);
				const remNoteMatches = this.extractRemNoteCues(content);
				const triggerWordMatches = this.checkForTriggerWords(content);

				// Create a mock MarkdownView object for compatibility
				const mockView = {
					file: file,
					getViewData: () => content
				};

				// Generate contextual questions
				if (highlightMatches.length > 0) {
					const clozeQuestions = this.generateContextualClozeCards(content, highlightMatches, mockView as any);
					questions.push(...clozeQuestions);
				}

				if (remNoteMatches.length > 0) {
					const qaQuestions = this.generateContextualQACards(remNoteMatches, content, mockView as any);
					questions.push(...qaQuestions);
				}

				if (triggerWordMatches.length > 0) {
					const triggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, mockView as any);
					questions.push(...triggerQuestions);
				}

			} catch (error) {
				console.error(`Error processing file ${file.path}:`, error);
			}
		}

		return questions;
	}

	async countMarkdownFiles(folder: any): Promise<number> {
		const files = this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(folder.path + '/') || file.path === folder.path
		);
		return files.length;
	}

	async processFilesByPath(folderPath: string): Promise<QuizQuestion[]> {
		const questions: QuizQuestion[] = [];
		
		// Get all markdown files in the specified path
		const files = this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(folderPath + '/') || 
			(folderPath === '' && !file.path.includes('/'))
		);

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				
				// Extract only trigger words
				const triggerWordMatches = this.checkForTriggerWords(content);

				// Create a mock MarkdownView object for compatibility
				const mockView = {
					file: file,
					getViewData: () => content
				};

				// Generate trigger word cards only
				if (triggerWordMatches.length > 0) {
					const triggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, mockView as any);
					questions.push(...triggerQuestions);
				}

			} catch (error) {
				console.error(`Error processing file ${file.path}:`, error);
			}
		}

		return questions;
	}

	async processFilesByPathAllTypes(folderPath: string): Promise<QuizQuestion[]> {
		const questions: QuizQuestion[] = [];
		
		// Get all markdown files in the specified path
		const files = this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(folderPath + '/') || 
			(folderPath === '' && !file.path.includes('/'))
		);

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				
				// Extract content like in the main method (all types)
				const highlightMatches = this.extractHighlights(content);
				const remNoteMatches = this.extractRemNoteCues(content);
				const triggerWordMatches = this.checkForTriggerWords(content);

				// Create a mock MarkdownView object for compatibility
				const mockView = {
					file: file,
					getViewData: () => content
				};

				// Generate contextual questions
				if (highlightMatches.length > 0) {
					const clozeQuestions = this.generateContextualClozeCards(content, highlightMatches, mockView as any);
					questions.push(...clozeQuestions);
				}

				if (remNoteMatches.length > 0) {
					const qaQuestions = this.generateContextualQACards(remNoteMatches, content, mockView as any);
					questions.push(...qaQuestions);
				}

				if (triggerWordMatches.length > 0) {
					const triggerQuestions = this.generateContextualTriggerCards(triggerWordMatches, content, mockView as any);
					questions.push(...triggerQuestions);
				}

			} catch (error) {
				console.error(`Error processing file ${file.path}:`, error);
			}
		}

		return questions;
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.geminiService.updateSettings(this.settings);
		this.ankiConnectService.updateSettings(this.settings.ankiConnect);
	}

	/**
	 * Extract highlighted text (text between ==)
	 */
	extractHighlights(content: string): string[] {
		const regex = /==(.*?)==/g;
		const matches: string[] = [];
		let match;
		
		while ((match = regex.exec(content)) !== null) {
			matches.push(match[0]); // Keep the == markers for replacement
		}
		
		return matches;
	}

	/**
	 * Extract RemNote-style cues (question::answer format)
	 */
	extractRemNoteCues(content: string): string[] {
		const regex = /^[^:\n]*::[^:\n]+$/gm;
		const matches = content.match(regex) || [];
		return matches.filter(match => !match.includes('=='));
	}

	/**
	 * Check for trigger words that indicate definitions or explanations
	 * Triggers must be at the beginning of a line (allowing for markdown formatting)
	 */
	checkForTriggerWords(content: string): string[] {
		const matches: string[] = [];
		const lines = content.split('\n');
		
		for (const line of lines) {
			for (const triggerWord of this.settings.triggers) {
				// Pattern to match trigger word at start of line, allowing markdown formatting
				// Allows: *italic*, **bold**, ***bold-italic***, or plain text at the start
				const regex = new RegExp(`^(\\*{1,3})?\\s*(${triggerWord})\\s*[:.]\\s*(.+)`, 'i');
				const match = line.match(regex);
				if (match) {
					matches.push(match[0]); // Return the full matched line
				}
			}
		}
		
		return matches;
	}

	/**
	 * Generate filename display for cards (HTML for Anki, plain text for Obsidian preview)
	 */
	generateFilenameDisplay(file: any, forAnki: boolean = false): string {
		if (!file) return 'Unknown File.md';
		
		if (forAnki) {
			// For Anki: use HTML link
			const vaultName = this.app.vault.getName();
			const filePath = encodeURIComponent(file.path);
			const obsidianUri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${filePath}`;
			return `<a href="${obsidianUri}">${file.basename}.md</a>`;
		} else {
			// For Obsidian preview: use plain text
			return `${file.basename}.md`;
		}
	}

	/**
	 * Get the most relevant header for a specific line in the content
	 */
	getMostRelevantHeader(content: string, targetLine: string): string | null {
		const lines = content.split('\n');
		const targetIndex = lines.findIndex(line => line.includes(targetLine));
		
		if (targetIndex === -1) return null;
		
		// Look backwards from the target line to find the nearest header
		for (let i = targetIndex - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (line.startsWith('#')) {
				const match = line.match(/^#{1,6}\s+(.+)$/);
				if (match) {
					return match[1]; // Return the header text without # symbols
				}
			}
		}
		
		return null;
	}

	/**
	 * Generate contextual cloze cards from highlights with filename and header
	 */
	generateContextualClozeCards(content: string, highlights: string[], markdownView: MarkdownView): QuizQuestion[] {
		const questions: QuizQuestion[] = [];
		
		// Get filename (plain text for Obsidian preview)
		const lines = content.split('\n');
		
		// Get filename (plain text for Obsidian preview)
		const filename = this.generateFilenameDisplay(markdownView.file, false);
		const contentLines = content.split('\n');
		
		for (const highlight of highlights) {
			const cleanHighlight = highlight.replace(/==/g, '');
			
			// Find the specific line containing this highlight
			const lineIndex = contentLines.findIndex(line => line.includes(highlight));
			if (lineIndex === -1) continue; // Skip if highlight not found
			
			const targetLine = contentLines[lineIndex];
			
			// Get the most relevant header for this highlight
			const relevantHeader = this.getMostRelevantHeader(content, highlight);
			
			// Build context with filename and header
			let contextString = filename;
			if (relevantHeader) {
				contextString += `\n-> ${relevantHeader}`;
			}
			
			// Create cloze text from only the line containing the highlight
			const clozeText = targetLine.replace(highlight, `{{c1::${cleanHighlight}}}`);
			
			// Add context to the cloze text
			const contextualClozeText = `${contextString}\n ${clozeText}`;
			
			questions.push({
				type: 'cloze',
				question: contextualClozeText,
				answer: cleanHighlight,
				clozeText: contextualClozeText
			});
		}
		
		return questions;
	}

	/**
	 * Generate contextual Q&A cards from RemNote-style cues
	 */
	generateContextualQACards(remNoteMatches: string[], content: string, markdownView: MarkdownView): QuizQuestion[] {
		const questions: QuizQuestion[] = [];
		
		// Get filename (plain text for Obsidian preview)
		const filename = this.generateFilenameDisplay(markdownView.file, false);
		
		for (const match of remNoteMatches) {
			const parts = match.split('::');
			if (parts.length >= 2) {
				const originalQuestion = parts[0].trim();
				const answer = parts[1].trim();
				
				// Get the most relevant header for this Q&A
				const relevantHeader = this.getMostRelevantHeader(content, match);
				
				// Build context with filename and header
				let contextString = filename;
				if (relevantHeader) {
					contextString += `\n-> ${relevantHeader}`;
				}
				
				// Add context to the question
				const contextualQuestion = `${contextString}\n ${originalQuestion}`;
				
				questions.push({
					type: 'short-answer',
					question: contextualQuestion,
					answer: answer
				});
			}
		}
		
		return questions;
	}

	/**
	 * Generate contextual trigger word cards
	 */
	generateContextualTriggerCards(triggerMatches: string[], content: string, markdownView: MarkdownView): QuizQuestion[] {
		const questions: QuizQuestion[] = [];
		
		// Get filename and header context
		const filename = this.generateFilenameDisplay(markdownView.file, false);
		
		for (const match of triggerMatches) {
			for (const triggerWord of this.settings.triggers) {
				// Pattern to extract definition from trigger line with optional markdown formatting
				const regex = new RegExp(`^(\\*{1,3})?\\s*(${triggerWord})\\s*[:.]\\s*(.+)`, 'i');
				const matchResult = match.match(regex);
				
				if (matchResult) {
					const definition = matchResult[3].trim(); // Extract the definition part
					
					// Get the most relevant header for this specific trigger word line
					const relevantHeader = this.getMostRelevantHeader(content, match);
					
					// Build context with filename and header
					let contextString = filename + `\n`;
					if (relevantHeader) {
						contextString += `\n-> ${relevantHeader}`;
					}
					
					// Create enhanced question with context
					const contextualQuestion = `${contextString}\n\n${triggerWord}`;
					
					questions.push({
						type: 'short-answer',
						question: contextualQuestion,
						answer: definition
					});
					break;
				}
			}
		}
		
		return questions;
	}
}

class FolderSelectionModal extends Modal {
	private selectedFolders: Set<string> = new Set();
	private onConfirm: (selectedFolders: string[]) => void;

	constructor(app: App, onConfirm: (selectedFolders: string[]) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: 'Select Folders to Process' });
		contentEl.createEl('p', { 
			text: 'Choose which folders to scan for highlights, RemNote-style cues, and trigger words. Note: You can also configure default folders in plugin settings.' 
		});

		// Get all folders in the vault
		const allFiles = this.app.vault.getAllLoadedFiles();
		const folders = allFiles
			.filter(file => {
				// Check if it's a folder using multiple criteria
				return file.hasOwnProperty('children') || 
					   file.constructor.name === 'TFolder' ||
					   (file as any).type === 'folder';
			})
			.map(folder => folder.path)
			.filter(path => path !== '') // Remove empty root folder
			.sort();

		// Also try getting folders from markdown files directory structure
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const folderPaths = new Set<string>();
		
		markdownFiles.forEach(file => {
			const pathParts = file.path.split('/');
			for (let i = 1; i < pathParts.length; i++) {
				const folderPath = pathParts.slice(0, i).join('/');
				if (folderPath) {
					folderPaths.add(folderPath);
				}
			}
		});

		// Combine both methods
		const allFolders = [...new Set([...folders, ...Array.from(folderPaths)])].sort();

		if (allFolders.length === 0) {
			contentEl.createEl('p', { text: 'No folders found in vault. Make sure you have folders with markdown files.' });
			return;
		}

		// Container for folder checkboxes
		const folderContainer = contentEl.createEl('div', { cls: 'folder-selection-container' });
		folderContainer.style.maxHeight = '300px';
		folderContainer.style.overflowY = 'auto';
		folderContainer.style.marginBottom = '20px';

		// Add checkboxes for each folder
		allFolders.forEach(folderPath => {
			const folderItem = folderContainer.createEl('div', { cls: 'folder-item' });
			folderItem.style.display = 'flex';
			folderItem.style.alignItems = 'center';
			folderItem.style.marginBottom = '8px';

			const checkbox = folderItem.createEl('input', { type: 'checkbox' });
			checkbox.style.marginRight = '8px';
			
			const label = folderItem.createEl('label', { text: folderPath });
			label.style.cursor = 'pointer';
			
			// Make label clickable
			label.addEventListener('click', () => {
				checkbox.checked = !checkbox.checked;
				this.updateSelection(folderPath, checkbox.checked);
			});

			checkbox.addEventListener('change', () => {
				this.updateSelection(folderPath, checkbox.checked);
			});
		});

		// Buttons
		const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'space-between';
		buttonContainer.style.marginTop = '20px';

		// Select All button
		const selectAllBtn = buttonContainer.createEl('button', { text: 'Select All' });
		selectAllBtn.addEventListener('click', () => {
			const checkboxes = folderContainer.querySelectorAll('input[type="checkbox"]');
			checkboxes.forEach((checkbox: HTMLInputElement, index) => {
				checkbox.checked = true;
				this.updateSelection(allFolders[index], true);
			});
		});

		// Clear Selection button
		const clearBtn = buttonContainer.createEl('button', { text: 'Clear All' });
		clearBtn.addEventListener('click', () => {
			const checkboxes = folderContainer.querySelectorAll('input[type="checkbox"]');
			checkboxes.forEach((checkbox: HTMLInputElement, index) => {
				checkbox.checked = false;
				this.updateSelection(allFolders[index], false);
			});
		});

		// Action buttons container
		const actionContainer = contentEl.createEl('div', { cls: 'action-container' });
		actionContainer.style.display = 'flex';
		actionContainer.style.justifyContent = 'flex-end';
		actionContainer.style.gap = '10px';
		actionContainer.style.marginTop = '20px';

		// Cancel button
		const cancelBtn = actionContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		// Process button
		const processBtn = actionContainer.createEl('button', { text: 'Process Folders' });
		processBtn.classList.add('mod-cta');
		processBtn.addEventListener('click', () => {
			const selectedArray = Array.from(this.selectedFolders);
			this.close();
			this.onConfirm(selectedArray);
		});
	}

	private updateSelection(folderPath: string, selected: boolean) {
		if (selected) {
			this.selectedFolders.add(folderPath);
		} else {
			this.selectedFolders.delete(folderPath);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ProcessingResultsModal extends Modal {
	private results: FolderProcessingResult[];
	private onContinue: () => void;

	constructor(app: App, results: FolderProcessingResult[], onContinue: () => void) {
		super(app);
		this.results = results;
		this.onContinue = onContinue;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: 'Folder Processing Results' });
		
		// Summary
		const totalFiles = this.results.reduce((sum, result) => sum + result.fileCount, 0);
		const totalQuestions = this.results.reduce((sum, result) => sum + result.questionCount, 0);
		
		const summaryDiv = contentEl.createEl('div', { cls: 'processing-summary' });
		summaryDiv.style.background = 'var(--background-secondary)';
		summaryDiv.style.padding = '15px';
		summaryDiv.style.borderRadius = '5px';
		summaryDiv.style.marginBottom = '20px';
		
		summaryDiv.createEl('p', { text: `📂 Processed ${this.results.length} folders` });
		summaryDiv.createEl('p', { text: `📄 Scanned ${totalFiles} markdown files` });
		summaryDiv.createEl('p', { text: `💎 Generated ${totalQuestions} flashcards` });

		// Detailed results
		if (this.results.length > 0) {
			contentEl.createEl('h3', { text: 'Detailed Results' });
			
			const resultsContainer = contentEl.createEl('div', { cls: 'detailed-results' });
			resultsContainer.style.maxHeight = '300px';
			resultsContainer.style.overflowY = 'auto';
			resultsContainer.style.border = '1px solid var(--background-modifier-border)';
			resultsContainer.style.borderRadius = '5px';
			resultsContainer.style.padding = '10px';
			resultsContainer.style.marginBottom = '20px';

			this.results.forEach(result => {
				const resultItem = resultsContainer.createEl('div', { cls: 'result-item' });
				resultItem.style.padding = '10px';
				resultItem.style.marginBottom = '8px';
				resultItem.style.border = '1px solid var(--background-modifier-border)';
				resultItem.style.borderRadius = '3px';
				
				resultItem.createEl('div', { 
					text: `📁 ${result.folderPath}`,
					cls: 'folder-name'
				}).style.fontWeight = 'bold';
				
				const statsDiv = resultItem.createEl('div', { cls: 'folder-stats' });
				statsDiv.style.marginTop = '5px';
				statsDiv.style.fontSize = '0.9em';
				statsDiv.style.color = 'var(--text-muted)';
				
				statsDiv.createEl('span', { text: `${result.fileCount} files • ` });
				statsDiv.createEl('span', { text: `${result.questionCount} cards` });
			});
		}

		// Action buttons
		const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		
		const continueBtn = buttonContainer.createEl('button', { text: 'View Generated Cards' });
		continueBtn.classList.add('mod-cta');
		continueBtn.addEventListener('click', () => {
			this.close();
			this.onContinue();
		});

		const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class AnkiQuizSettingTab extends PluginSettingTab {
	plugin: AnkiQuizPlugin;

	constructor(app: App, plugin: AnkiQuizPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Trigger Flashcards Settings' });

		// Export Format
		new Setting(containerEl)
			.setName('Export Format')
			.setDesc('Choose the format for exporting quiz questions')
			.addDropdown(dropdown => dropdown
				.addOption('txt', 'Text (.txt)')
				.addOption('csv', 'CSV (.csv)')
				.addOption('ankiconnect', 'Direct to Anki (AnkiConnect)')
				.setValue(this.plugin.settings.exportFormat)
				.onChange(async (value: 'txt' | 'csv' | 'ankiconnect') => {
					this.plugin.settings.exportFormat = value;
					await this.plugin.saveSettings();
				}));

		// AnkiConnect Settings
		containerEl.createEl('h3', { text: 'AnkiConnect Settings' });
		containerEl.createEl('p', { 
			text: 'Configure direct export to Anki using AnkiConnect add-on. Make sure AnkiConnect is installed in Anki.',
			cls: 'setting-item-description'
		});

		// Enable AnkiConnect
		new Setting(containerEl)
			.setName('Enable AnkiConnect')
			.setDesc('Enable direct export to Anki using AnkiConnect')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.ankiConnect.enabled)
				.onChange(async (value) => {
					this.plugin.settings.ankiConnect.enabled = value;
					await this.plugin.saveSettings();
				}));

		// AnkiConnect URL
		new Setting(containerEl)
			.setName('AnkiConnect URL')
			.setDesc('URL for AnkiConnect API (default: http://localhost:8765)')
			.addText(text => text
				.setPlaceholder('http://localhost:8765')
				.setValue(this.plugin.settings.ankiConnect.url)
				.onChange(async (value) => {
					this.plugin.settings.ankiConnect.url = value || 'http://localhost:8765';
					await this.plugin.saveSettings();
				}));

		// Default Deck
		// Allow Deck Creation
		new Setting(containerEl)
			.setName('Allow Deck Creation')
			.setDesc('Automatically create deck if it doesn\'t exist')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.ankiConnect.allowDeckCreation)
				.onChange(async (value) => {
					this.plugin.settings.ankiConnect.allowDeckCreation = value;
					await this.plugin.saveSettings();
				}));

		// Note Type
		const noteTypeSetting = new Setting(containerEl)
			.setName('Note Type')
			.setDesc('Anki note type for basic Q&A cards (Cloze cards always use "Cloze" type)')
			.addDropdown(dropdown => {
				// Add default option
				dropdown.addOption('Basic', 'Basic (default)');
				dropdown.setValue(this.plugin.settings.ankiConnect.noteType);
				
				dropdown.onChange(async (value) => {
					this.plugin.settings.ankiConnect.noteType = value || 'Basic';
					await this.plugin.saveSettings();
				});
				
				// Load note types from Anki asynchronously
				this.loadNoteTypesForDropdown(dropdown);
				
				return dropdown;
			});

		// Test AnkiConnect button
		new Setting(containerEl)
			.setName('Test AnkiConnect')
			.setDesc('Test connection to AnkiConnect and show available decks')
			.addButton(button => button
				.setButtonText('Test Connection')
				.setCta()
				.onClick(async () => {
					if (!this.plugin.settings.ankiConnect.enabled) {
						new Notice('AnkiConnect is disabled in settings');
						return;
					}

					try {
						const ankiInfo = await this.plugin.ankiConnectService.getAnkiInfo();
						
						if (ankiInfo.connected) {
							const deckCount = ankiInfo.decks.length;
							const modelCount = ankiInfo.models.length;
							const deckList = ankiInfo.decks.slice(0, 5).join(', ') + (ankiInfo.decks.length > 5 ? '...' : '');
							new Notice(`✅ AnkiConnect connected!\nVersion: ${ankiInfo.version}\nDecks: ${deckCount}\nNote types: ${modelCount}\n\nSample decks: ${deckList}`, 8000);
						} else {
							new Notice('❌ AnkiConnect connection failed. Please:\n1. Open Anki\n2. Install AnkiConnect add-on\n3. Restart Anki', 8000);
						}
					} catch (error) {
						new Notice(`❌ AnkiConnect error: ${error.message}`);
					}
				}));

		// Existing note behavior
		new Setting(containerEl)
			.setName('Behavior for existing notes')
			.setDesc('Choose what to do when a note (matched by deck+front) already exists in Anki')
			.addDropdown(dropdown => dropdown
				.addOption('skip', 'Skip (do nothing)')
				.addOption('update', 'Update existing answer')
				.addOption('create', 'Always create new note')
				.setValue(this.plugin.settings.ankiConnect.existingNoteBehavior || 'skip')
				.onChange(async (value: 'skip' | 'update' | 'create') => {
					this.plugin.settings.ankiConnect.existingNoteBehavior = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Content Processing Settings' });

		// Triggers
		new Setting(containerEl)
			.setName('Triggers')
			.setDesc('Words that indicate definitions or explanations (one per line)')
			.addTextArea(text => text
				.setPlaceholder('definition\nexample\nformula\ntheorem')
				.setValue(this.plugin.settings.triggers.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.triggers = value.split('\n').filter(word => word.trim().length > 0);
					await this.plugin.saveSettings();
				}));

		// Folder Paths
		new Setting(containerEl)
			.setName('Folder Paths')
			.setDesc('Folder paths to process for triggers (one per line). Use forward slashes, e.g., "Folder1", "Folder1/Subfolder"')
			.addTextArea(text => text
				.setPlaceholder('Notes\nStudy Materials\nCourse Notes/Chapter 1')
				.setValue(this.plugin.settings.folderPaths.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.folderPaths = value.split('\n').filter(path => path.trim().length > 0);
					await this.plugin.saveSettings();
				}));

		// Test Folder Paths button
		new Setting(containerEl)
			.setName('Test Folder Paths')
			.setDesc('Validate that the configured folder paths exist in your vault')
			.addButton(button => button
				.setButtonText('Test Paths')
				.setCta()
				.onClick(async () => {
					if (this.plugin.settings.folderPaths.length === 0) {
						new Notice('No folder paths configured');
						return;
					}

					const results: string[] = [];
					let validCount = 0;

					for (const folderPath of this.plugin.settings.folderPaths) {
						// Try multiple methods to find the folder
						let folder = this.app.vault.getAbstractFileByPath(folderPath);
						
						// Alternative method: check if any markdown files exist in this path
						const filesInFolder = this.app.vault.getMarkdownFiles()
							.filter(file => file.path.startsWith(folderPath + '/') || 
										(file.path === folderPath && file.path.includes('.')));
						
						if (folder && (folder.hasOwnProperty('children') || folder.constructor.name === 'TFolder')) {
							const fileCount = this.app.vault.getMarkdownFiles()
								.filter(file => file.path.startsWith(folderPath + '/') || file.path === folderPath)
								.length;
							results.push(`✅ ${folderPath} (${fileCount} markdown files)`);
							validCount++;
						} else if (filesInFolder.length > 0) {
							// Folder exists (has files) even if not detected as folder object
							results.push(`✅ ${folderPath} (${filesInFolder.length} markdown files - path exists)`);
							validCount++;
						} else {
							results.push(`❌ ${folderPath} (not found or no markdown files)`);
						}
					}

				const message = `Folder validation results:\n\n${results.join('\n')}\n\n${validCount}/${this.plugin.settings.folderPaths.length} folders valid`;
				new Notice(message, 8000);
			}));

		// // AI Enhancement Settings
		// containerEl.createEl('h3', { text: 'AI Enhancement (Optional)' });
		
		// // Gemini API Key
		// new Setting(containerEl)
		// 	.setName('Gemini API Key')
		// 	.setDesc('Your Google Gemini API key for AI-powered question enhancement and insights')
		// 	.addText(text => text
		// 		.setPlaceholder('Enter your Gemini API key')
		// 		.setValue(this.plugin.settings.geminiApiKey)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.geminiApiKey = value;
		// 			await this.plugin.saveSettings();
		// 		}));

		// // Test Gemini API button
		// new Setting(containerEl)
		// 	.setName('Test Gemini API')
		// 	.setDesc('Test connection to Gemini AI and verify your API key works')
		// 	.addButton(button => button
		// 		.setButtonText('Test API')
		// 		.setCta()
		// 		.onClick(async () => {
		// 			if (!this.plugin.settings.geminiApiKey) {
		// 				new Notice('Please enter your Gemini API key first');
		// 				return;
		// 			}

		// 			try {
		// 				const geminiService = new GeminiService(this.plugin.settings);
		// 				const testResult = await geminiService.generateQuizFromContent('Test: This is a simple test to verify the API connection.');
						
		// 				if (testResult && testResult.length > 0) {
		// 					new Notice('✅ Gemini API is working! API key is valid.', 5000);
		// 				} else {
		// 					new Notice('⚠️ Gemini API responded but returned no results. Check your API key.', 5000);
		// 				}
		// 			} catch (error) {
		// 				console.error('Gemini API test failed:', error);
		// 				new Notice(`❌ Gemini API test failed: ${error.message}`, 8000);
		// 			}
		// 		}));
	}	/**
	 * Load note types from Anki and populate the dropdown
	 */
	private async loadNoteTypesForDropdown(dropdown: any) {
		try {
			if (!this.plugin.settings.ankiConnect.enabled) {
				return;
			}

			const ankiService = new AnkiConnectService(this.plugin.settings.ankiConnect);
			const noteTypes = await ankiService.getModelNames();
			
			if (noteTypes && noteTypes.length > 0) {
				// Clear existing options
				dropdown.selectEl.empty();
				
				// Add note types from Anki
				noteTypes.forEach(noteType => {
					dropdown.addOption(noteType, noteType);
				});

				
				// Set current value
				dropdown.setValue(this.plugin.settings.ankiConnect.noteType);
			}
		} catch (error) {
			console.warn('Could not load note types from Anki:', error);
			// Keep default 'Basic' option if Anki is not available
		}
	}
}
