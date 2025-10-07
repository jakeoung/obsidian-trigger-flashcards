import { App, Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import { QuizQuestion } from './gemini-service';
import { AnkiExporter } from './anki-exporter';
import { AnkiDirectExporter } from './anki-direct-exporter';
import { AnkiQuizSettings } from './settings';
import { GeminiService } from './gemini-service';

export class QuizModal extends Modal {
	private questions: QuizQuestion[];
	private currentQuestionIndex: number = 0;
	private exportFormat: 'txt' | 'csv' | 'ankiconnect';
	private ankiDirectExporter?: AnkiDirectExporter;
	private settings?: AnkiQuizSettings;
	private geminiService?: GeminiService;
	private contentContainer?: HTMLElement;
	private questionContainer?: HTMLElement;
	private insightContainer?: HTMLElement;

	constructor(app: App, questions: QuizQuestion[], exportFormat: 'txt' | 'csv' | 'ankiconnect' = 'txt', settings?: AnkiQuizSettings) {
		super(app);
		this.questions = questions;
		this.exportFormat = exportFormat;
		this.settings = settings;
		if (settings?.ankiConnect.enabled) {
			this.ankiDirectExporter = new AnkiDirectExporter(settings);
		}
		if (settings?.geminiApiKey) {
			this.geminiService = new GeminiService(settings);
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.style.maxWidth = '800px';
		contentEl.style.minHeight = '600px';

		// Header with navigation
		this.createHeader(contentEl);
		
		// Main content container
		this.contentContainer = contentEl.createEl('div', { cls: 'quiz-content' });
		this.contentContainer.style.padding = '20px 0';
		
		// Question container
		this.questionContainer = this.contentContainer.createEl('div', { cls: 'question-container' });
		
		// Insight container (initially hidden)
		this.insightContainer = this.contentContainer.createEl('div', { cls: 'insight-container' });
		this.insightContainer.style.display = 'none';
		this.insightContainer.style.marginTop = '20px';
		this.insightContainer.style.padding = '15px';
		this.insightContainer.style.border = '1px solid var(--background-modifier-border)';
		this.insightContainer.style.borderRadius = '8px';
		this.insightContainer.style.backgroundColor = 'var(--background-secondary)';

		// Navigation and controls
		this.createControls(contentEl);
		
		// Display first question
		this.displayCurrentQuestion();
	}

	private createHeader(parent: HTMLElement) {
		const header = parent.createEl('div', { cls: 'quiz-header' });
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.alignItems = 'center';
		header.style.marginBottom = '20px';
		header.style.paddingBottom = '15px';
		header.style.borderBottom = '1px solid var(--background-modifier-border)';

		const title = header.createEl('h2', { text: 'Trigger Flashcards Review' });
		title.style.margin = '0';

		const progress = header.createEl('div', { cls: 'question-progress' });
		progress.style.fontSize = '14px';
		progress.style.color = 'var(--text-muted)';
		progress.textContent = `${this.currentQuestionIndex + 1} of ${this.questions.length}`;
	}

	private createControls(parent: HTMLElement) {
		const controls = parent.createEl('div', { cls: 'quiz-controls' });
		controls.style.display = 'flex';
		controls.style.justifyContent = 'space-between';
		controls.style.alignItems = 'center';
		controls.style.marginTop = '30px';
		controls.style.paddingTop = '20px';
		controls.style.borderTop = '1px solid var(--background-modifier-border)';

		// Navigation buttons
		const navButtons = controls.createEl('div', { cls: 'nav-buttons' });
		navButtons.style.display = 'flex';
		navButtons.style.gap = '10px';

		const prevButton = new ButtonComponent(navButtons);
		prevButton.setButtonText('← Previous')
			.setDisabled(this.currentQuestionIndex === 0)
			.onClick(() => this.previousQuestion());

		const nextButton = new ButtonComponent(navButtons);
		nextButton.setButtonText('Next →')
			.setDisabled(this.currentQuestionIndex === this.questions.length - 1)
			.onClick(() => this.nextQuestion());

		// Export button
		const exportButton = new ButtonComponent(controls);
		exportButton.setButtonText('Export All to Anki')
			.setCta()
			.onClick(() => this.exportQuestions());
	}

	private displayCurrentQuestion() {
		if (!this.questionContainer) return;
		
		this.questionContainer.empty();
		this.hideInsights();
		
		const question = this.questions[this.currentQuestionIndex];
		
		// Question card
		const questionCard = this.questionContainer.createEl('div', { cls: 'question-card' });
		questionCard.style.padding = '20px';
		questionCard.style.border = '2px solid var(--background-modifier-border)';
		questionCard.style.borderRadius = '12px';
		questionCard.style.backgroundColor = 'var(--background-primary)';

		// Question type badge
		const typeBadge = questionCard.createEl('div', { cls: 'question-type-badge' });
		typeBadge.style.display = 'inline-block';
		typeBadge.style.padding = '4px 12px';
		typeBadge.style.backgroundColor = 'var(--interactive-accent)';
		typeBadge.style.color = 'var(--text-on-accent)';
		typeBadge.style.borderRadius = '20px';
		typeBadge.style.fontSize = '12px';
		typeBadge.style.fontWeight = 'bold';
		typeBadge.style.marginBottom = '15px';
		typeBadge.textContent = question.type.toUpperCase();

		// Question text
		const questionText = questionCard.createEl('div', { cls: 'question-text' });
		questionText.style.fontSize = '18px';
		questionText.style.fontWeight = '600';
		questionText.style.marginBottom = '20px';
		questionText.style.whiteSpace = 'pre-line';
		questionText.textContent = question.question;

		// Reveal answer button
		const revealButton = questionCard.createEl('button', { text: '🔍 Reveal Answer' });
		revealButton.style.padding = '12px 24px';
		revealButton.style.fontSize = '16px';
		revealButton.style.fontWeight = '600';
		revealButton.style.backgroundColor = 'var(--interactive-accent)';
		revealButton.style.color = 'var(--text-on-accent)';
		revealButton.style.border = 'none';
		revealButton.style.borderRadius = '8px';
		revealButton.style.cursor = 'pointer';
		revealButton.style.marginBottom = '15px';
		revealButton.style.width = '100%';

		// Answer section (initially hidden)
		const answerSection = questionCard.createEl('div', { cls: 'answer-section' });
		answerSection.style.padding = '15px';
		answerSection.style.backgroundColor = 'var(--background-secondary)';
		answerSection.style.borderRadius = '8px';
		answerSection.style.marginBottom = '15px';
		answerSection.style.display = 'none'; // Initially hidden

		// Reveal answer functionality
		revealButton.onclick = () => {
			answerSection.style.display = 'block';
			revealButton.style.display = 'none';
		};

		if (question.type === 'multiple-choice' && question.options) {
			const optionsEl = answerSection.createEl('div', { cls: 'question-options' });
			question.options.forEach((option, optIndex) => {
				const optionEl = optionsEl.createEl('div');
				optionEl.style.padding = '8px';
				optionEl.style.marginBottom = '5px';
				const isCorrect = option === question.answer;
				
				if (isCorrect) {
					optionEl.style.backgroundColor = 'var(--text-success)';
					optionEl.style.color = 'white';
					optionEl.style.borderRadius = '4px';
					optionEl.style.fontWeight = 'bold';
				}
				
				optionEl.textContent = `${String.fromCharCode(65 + optIndex)}. ${option}`;
			});
		} else {
			const answerLabel = answerSection.createEl('div', { cls: 'answer-label' });
			answerLabel.style.fontSize = '14px';
			answerLabel.style.fontWeight = 'bold';
			answerLabel.style.color = 'var(--text-muted)';
			answerLabel.style.marginBottom = '8px';
			answerLabel.textContent = 'Answer:';
			
			const answerText = answerSection.createEl('div', { cls: 'answer-text' });
			answerText.style.fontSize = '16px';
			answerText.style.whiteSpace = 'pre-line';
			answerText.textContent = question.answer;
		}

		// Explanation if available
		if (question.explanation) {
			const explanationSection = questionCard.createEl('div', { cls: 'explanation-section' });
			explanationSection.style.padding = '15px';
			explanationSection.style.backgroundColor = 'var(--background-secondary-alt)';
			explanationSection.style.borderRadius = '8px';
			explanationSection.style.marginTop = '10px';

			const explanationLabel = explanationSection.createEl('div', { cls: 'explanation-label' });
			explanationLabel.style.fontSize = '14px';
			explanationLabel.style.fontWeight = 'bold';
			explanationLabel.style.color = 'var(--text-muted)';
			explanationLabel.style.marginBottom = '8px';
			explanationLabel.textContent = 'Explanation:';

			const explanationText = explanationSection.createEl('div', { cls: 'explanation-text' });
			explanationText.style.fontSize = '14px';
			explanationText.style.whiteSpace = 'pre-line';
			explanationText.style.fontStyle = 'italic';
			explanationText.textContent = question.explanation;
		}

		// Gemini insight buttons
		if (this.geminiService && this.settings?.geminiApiKey) {
			this.createGeminiInsightButtons(questionCard, question);
		}

		// Update header progress
		this.updateProgress();
	}

	private createGeminiInsightButtons(parent: HTMLElement, question: QuizQuestion) {
		const insightSection = parent.createEl('div', { cls: 'insight-buttons' });
		insightSection.style.marginTop = '20px';
		insightSection.style.paddingTop = '15px';
		insightSection.style.borderTop = '1px solid var(--background-modifier-border)';

		const sectionTitle = insightSection.createEl('div', { cls: 'insight-title' });
		sectionTitle.style.fontSize = '14px';
		sectionTitle.style.fontWeight = 'bold';
		sectionTitle.style.marginBottom = '10px';
		sectionTitle.style.color = 'var(--text-muted)';
		sectionTitle.textContent = '🤖 AI Insights:';

		const buttonContainer = insightSection.createEl('div', { cls: 'insight-button-container' });
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.flexWrap = 'wrap';

		const insights = [
			{ label: 'Related Concepts', action: () => this.getRelatedConcepts(question) },
			{ label: 'Examples', action: () => this.getExamples(question) },
			{ label: 'Intuition', action: () => this.getIntuition(question) },
			{ label: 'Practice Questions', action: () => this.getPracticeQuestions(question) }
		];

		insights.forEach(insight => {
			const button = new ButtonComponent(buttonContainer);
			button.setButtonText(insight.label)
				.setClass('insight-button')
				.onClick(insight.action);
		});
	}

	private async getRelatedConcepts(question: QuizQuestion) {
		this.showInsightLoading('Getting related concepts...');
		try {
			const prompt = `For this flashcard question: "${question.question}" with answer: "${question.answer}", provide 3-5 related concepts that would help with understanding. Format as a simple list.`;
			const result = await this.geminiService?.generateContent(prompt);
			this.showInsight('Related Concepts', result || 'No related concepts generated.');
		} catch (error: any) {
			console.error('Error getting related concepts:', error);
			this.showInsight('Error', `Failed to get related concepts: ${error?.message || 'Unknown error'}`);
		}
	}

	private async getExamples(question: QuizQuestion) {
		this.showInsightLoading('Getting examples...');
		try {
			const prompt = `For this flashcard question: "${question.question}" with answer: "${question.answer}", provide 2-3 practical examples or use cases that illustrate this concept.`;
			const result = await this.geminiService?.generateContent(prompt);
			this.showInsight('Examples', result || 'No examples generated.');
		} catch (error: any) {
			console.error('Error getting examples:', error);
			this.showInsight('Error', `Failed to get examples: ${error?.message || 'Unknown error'}`);
		}
	}

	private async getIntuition(question: QuizQuestion) {
		this.showInsightLoading('Getting intuition...');
		try {
			const prompt = `For this flashcard question: "${question.question}" with answer: "${question.answer}", provide intuitive understanding, conceptual insights, or ways to develop intuition about this topic.`;
			const result = await this.geminiService?.generateContent(prompt);
			this.showInsight('Intuition', result || 'No intuition generated.');
		} catch (error: any) {
			console.error('Error getting intuition:', error);
			this.showInsight('Error', `Failed to get intuition: ${error?.message || 'Unknown error'}`);
		}
	}

	private async getPracticeQuestions(question: QuizQuestion) {
		this.showInsightLoading('Getting practice questions...');
		try {
			const prompt = `For this flashcard question: "${question.question}" with answer: "${question.answer}", create 2-3 additional practice questions that test the same concept from different angles.`;
			const result = await this.geminiService?.generateContent(prompt);
			this.showInsight('Practice Questions', result || 'No practice questions generated.');
		} catch (error: any) {
			console.error('Error getting practice questions:', error);
			this.showInsight('Error', `Failed to get practice questions: ${error?.message || 'Unknown error'}`);
		}
	}

	private showInsightLoading(message: string) {
		if (!this.insightContainer) return;
		
		this.insightContainer.empty();
		this.insightContainer.style.display = 'block';
		
		const loadingEl = this.insightContainer.createEl('div', { cls: 'insight-loading' });
		loadingEl.style.textAlign = 'center';
		loadingEl.style.color = 'var(--text-muted)';
		loadingEl.textContent = message;
	}

	private showInsight(title: string, content: string) {
		if (!this.insightContainer) return;
		
		this.insightContainer.empty();
		this.insightContainer.style.display = 'block';
		
		const titleEl = this.insightContainer.createEl('h4', { text: title });
		titleEl.style.margin = '0 0 10px 0';
		titleEl.style.color = 'var(--text-accent)';
		
		const contentEl = this.insightContainer.createEl('div', { cls: 'insight-content' });
		contentEl.style.whiteSpace = 'pre-line';
		contentEl.textContent = content;
		
		const closeButton = this.insightContainer.createEl('button', { text: '✕ Close' });
		closeButton.style.marginTop = '10px';
		closeButton.style.padding = '5px 10px';
		closeButton.style.backgroundColor = 'var(--interactive-normal)';
		closeButton.style.border = 'none';
		closeButton.style.borderRadius = '4px';
		closeButton.style.cursor = 'pointer';
		closeButton.onclick = () => this.hideInsights();
	}

	private hideInsights() {
		if (this.insightContainer) {
			this.insightContainer.style.display = 'none';
		}
	}

	private previousQuestion() {
		if (this.currentQuestionIndex > 0) {
			this.currentQuestionIndex--;
			this.displayCurrentQuestion();
		}
	}

	private nextQuestion() {
		if (this.currentQuestionIndex < this.questions.length - 1) {
			this.currentQuestionIndex++;
			this.displayCurrentQuestion();
		}
	}

	private updateProgress() {
		const progressEl = this.containerEl.querySelector('.question-progress');
		if (progressEl) {
			progressEl.textContent = `${this.currentQuestionIndex + 1} of ${this.questions.length}`;
		}
		
		// Update navigation buttons
		const prevButton = this.containerEl.querySelector('.nav-buttons button:first-child') as HTMLButtonElement;
		const nextButton = this.containerEl.querySelector('.nav-buttons button:last-child') as HTMLButtonElement;
		
		if (prevButton) prevButton.disabled = this.currentQuestionIndex === 0;
		if (nextButton) nextButton.disabled = this.currentQuestionIndex === this.questions.length - 1;
	}

	private async exportQuestions() {
		if (this.exportFormat === 'ankiconnect' && this.ankiDirectExporter) {
			await this.exportToAnkiConnect();
		} else {
			await this.exportToFile();
		}
	}

	private async exportToAnkiConnect() {
		if (!this.ankiDirectExporter) {
			new Notice('AnkiConnect is not configured');
			return;
		}

		try {
			const result = await this.ankiDirectExporter.exportToAnki(this.questions);
			
			if (result.success > 0) {
				new Notice(`Successfully exported ${result.success} questions to Anki`);
				this.close();
			} else {
				new Notice(`Export failed: ${result.errors.join(', ')}`);
			}
		} catch (error) {
			console.error('AnkiConnect export failed:', error);
			new Notice('Failed to export to AnkiConnect. Check console for details.');
		}
	}

	private async exportToFile() {
		let content: string;
		let filename: string;

		if (this.exportFormat === 'csv') {
			content = AnkiExporter.exportToCsv(this.questions);
			filename = 'anki-questions.csv';
		} else {
			content = AnkiExporter.exportToTxt(this.questions);
			filename = 'anki-questions.txt';
		}

		// Create and download file
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);

		new Notice(`Exported ${this.questions.length} questions to ${filename}`);
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}