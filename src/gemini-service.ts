import { GoogleGenerativeAI } from '@google/generative-ai';
import { AnkiQuizSettings } from './settings';

export interface QuizQuestion {
	type: 'multiple-choice' | 'true-false' | 'fill-in-blank' | 'short-answer' | 'cloze';
	question: string;
	answer: string;
	options?: string[]; // For multiple choice
	explanation?: string;
	clozeText?: string; // For cloze deletions - the full text with {{c1::answer}} format
}

export class GeminiService {
	private genAI: GoogleGenerativeAI | null = null;
	private settings: AnkiQuizSettings;

	constructor(settings: AnkiQuizSettings) {
		this.settings = settings;
		if (settings.geminiApiKey) {
			this.genAI = new GoogleGenerativeAI(settings.geminiApiKey);
		}
	}

	updateSettings(settings: AnkiQuizSettings) {
		this.settings = settings;
		if (settings.geminiApiKey) {
			this.genAI = new GoogleGenerativeAI(settings.geminiApiKey);
		} else {
			this.genAI = null;
		}
	}

	async generateQuizFromContent(content: string): Promise<QuizQuestion[]> {
		if (!this.genAI) {
			throw new Error('Gemini API key not configured');
		}

		if (!this.settings.geminiApiKey || this.settings.geminiApiKey.trim() === '') {
			throw new Error('Gemini API key is empty. Please configure it in settings.');
		}

		console.log('Using Gemini API key:', this.settings.geminiApiKey.substring(0, 10) + '...');

		const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

		const prompt = `Based on the following content, create quiz questions for Anki flashcards.

Content:
${content}

Requirements:
- Create a mix of question types
- Focus on key concepts and important information
- Make questions suitable for spaced repetition learning

Format your response as a JSON array with this structure:
[
  {
    "type": "multiple-choice" | "true-false" | "fill-in-blank" | "short-answer",
    "question": "The question text",
    "answer": "The correct answer",
    "options": ["option1", "option2", "option3", "option4"], // Only for multiple-choice
    "explanation": "Brief explanation of why this is correct"
  }
]

Make sure questions are diverse, test understanding rather than memorization, and are directly based on the provided content.`;

		try {
			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			
			// Try to extract JSON from the response
			const jsonMatch = text.match(/\[[\s\S]*\]/);
			if (!jsonMatch) {
				throw new Error('Failed to parse quiz questions from AI response');
			}

			const questions: QuizQuestion[] = JSON.parse(jsonMatch[0]);
			return questions;
		} catch (error) {
			console.error('Error generating quiz:', error);
			
			// More detailed error information
			if (error.message && error.message.includes('API_KEY')) {
				throw new Error('Invalid API key. Please check your Gemini API key in settings.');
			} else if (error.message && error.message.includes('quota')) {
				throw new Error('API quota exceeded. Please check your Gemini API usage limits.');
			} else if (error.message && error.message.includes('permission')) {
				throw new Error('Permission denied. Please ensure your API key has proper permissions.');
			}
			
			throw new Error(`Failed to generate quiz: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Generate cloze deletion cards from highlighted text (== ==)
	 * Converts highlights to Anki cloze format: {{c1::answer}}
	 */
	async generateClozeFromHighlights(content: string): Promise<QuizQuestion[]> {
		if (!this.genAI) {
			throw new Error('Gemini API key not configured');
		}

		// Extract highlights using regex
		const highlightRegex = /==(.+?)==/g;
		const highlights: Array<{text: string, fullContext: string, startIndex: number}> = [];
		let match;

		while ((match = highlightRegex.exec(content)) !== null) {
			const highlightedText = match[1].trim();
			const startIndex = match.index;
			
			// Get surrounding context (50 characters before and after)
			const contextStart = Math.max(0, startIndex - 50);
			const contextEnd = Math.min(content.length, match.index + match[0].length + 50);
			const fullContext = content.substring(contextStart, contextEnd);
			
			highlights.push({
				text: highlightedText,
				fullContext: fullContext,
				startIndex: startIndex
			});
		}

		if (highlights.length === 0) {
			throw new Error('No highlights found in content. Use == == to highlight text for cloze deletions.');
		}

		const clozeQuestions: QuizQuestion[] = [];

		// Process each highlight
		for (let i = 0; i < highlights.length; i++) {
			const highlight = highlights[i];
			
			// Create the cloze text by replacing the highlight with Anki cloze format
			const clozeText = content.replace(
				new RegExp(`==${highlight.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}==`, 'g'),
				`{{c${i + 1}::${highlight.text}}}`
			);

			// Clean up any remaining highlights in the cloze text
			const cleanClozeText = clozeText.replace(/==/g, '');

			clozeQuestions.push({
				type: 'cloze',
				question: `Fill in the blank: ${highlight.fullContext.replace(/==/g, '').replace(highlight.text, '___')}`,
				answer: highlight.text,
				clozeText: cleanClozeText,
				explanation: `This creates a cloze deletion for: "${highlight.text}"`
			});
		}

		// Optional: Use AI to improve the cloze cards
		if (clozeQuestions.length > 0) {
			try {
				await this.enhanceClozeCards(clozeQuestions, content);
			} catch (error) {
				console.warn('Failed to enhance cloze cards with AI:', error.message);
				// Continue with basic cloze cards if AI enhancement fails
			}
		}

		return clozeQuestions;
	}

	/**
	 * Use AI to enhance cloze cards with better context and explanations
	 */
	private async enhanceClozeCards(clozeQuestions: QuizQuestion[], originalContent: string): Promise<void> {
		const model = this.genAI!.getGenerativeModel({ model: 'gemini-2.5-flash' });

		const highlightedTerms = clozeQuestions.map(q => q.answer).join(', ');

		const prompt = `Based on the following content, improve the explanations for these highlighted terms that will become cloze deletion cards: ${highlightedTerms}

Original content:
${originalContent}

For each term, provide a brief, educational explanation (1-2 sentences) that helps understand why this term is important in context. Focus on:
- Why this term is significant
- How it relates to the surrounding content
- Key relationships or definitions

Respond in JSON format:
{
  "explanations": {
    "term1": "explanation for term1",
    "term2": "explanation for term2"
  }
}`;

		try {
			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const enhancements = JSON.parse(jsonMatch[0]);
				
				// Apply enhanced explanations
				clozeQuestions.forEach(question => {
					const enhancement = enhancements.explanations?.[question.answer];
					if (enhancement) {
						question.explanation = enhancement;
					}
				});
			}
		} catch (error) {
			console.warn('Failed to parse AI enhancement response:', error.message);
		}
	}

	/**
	 * Generate Q&A cards from RemNote-style cues (Question::Answer format)
	 */
	async generateQAFromRemNoteCues(content: string): Promise<QuizQuestion[]> {
		if (!this.genAI) {
			throw new Error('Gemini API key not configured');
		}

		// Extract RemNote-style cues using regex
		const remNoteRegex = /^(.+?)::(.+?)$/gm;
		const cues: Array<{question: string, answer: string, fullLine: string}> = [];
		let match;

		while ((match = remNoteRegex.exec(content)) !== null) {
			const question = match[1].trim();
			const answer = match[2].trim();
			const fullLine = match[0];
			
			// Skip empty questions or answers
			if (question && answer) {
				cues.push({
					question: question,
					answer: answer,
					fullLine: fullLine
				});
			}
		}

		if (cues.length === 0) {
			throw new Error('No RemNote-style cues found. Use the format: Question::Answer');
		}

		const qaQuestions: QuizQuestion[] = [];

		// Process each cue
		for (const cue of cues) {
			qaQuestions.push({
				type: 'short-answer',
				question: cue.question,
				answer: cue.answer,
				explanation: `Generated from RemNote-style cue: ${cue.fullLine}`
			});
		}

		// Optional: Use AI to improve the Q&A cards
		if (qaQuestions.length > 0) {
			try {
				await this.enhanceQACards(qaQuestions, content);
			} catch (error) {
				console.warn('Failed to enhance Q&A cards with AI:', error.message);
				// Continue with basic Q&A cards if AI enhancement fails
			}
		}

		return qaQuestions;
	}

	/**
	 * Use AI to enhance Q&A cards with better explanations and context
	 */
	private async enhanceQACards(qaQuestions: QuizQuestion[], originalContent: string): Promise<void> {
		const model = this.genAI!.getGenerativeModel({ model: 'gemini-2.5-flash' });

		const questionsText = qaQuestions.map(q => `Q: ${q.question} | A: ${q.answer}`).join('\n');

		const prompt = `Based on the following content and question-answer pairs, improve the explanations for these Q&A cards:

Original content:
${originalContent}

Question-Answer pairs:
${questionsText}

For each Q&A pair, provide a brief, educational explanation (1-2 sentences) that:
- Adds context or background information
- Explains why this answer is correct
- Connects to broader concepts if relevant

Respond in JSON format with the question as the key:
{
  "explanations": {
    "question1": "explanation for this Q&A pair",
    "question2": "explanation for this Q&A pair"
  }
}`;

		try {
			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const enhancements = JSON.parse(jsonMatch[0]);
				
				// Apply enhanced explanations
				qaQuestions.forEach(question => {
					const enhancement = enhancements.explanations?.[question.question];
					if (enhancement) {
						question.explanation = enhancement;
					}
				});
			}
		} catch (error) {
			console.warn('Failed to parse AI enhancement response:', error.message);
		}
	}

	/**
	 * Generate quiz questions from lines that start with predefined triggers
	 * Example: "prototypical example: Machine learning is..."
	 * Creates: Q: "What is a prototypical example?" A: "Machine learning is..."
	 */
	async generateQAFromTriggerWords(content: string): Promise<QuizQuestion[]> {
		if (!this.genAI) {
			throw new Error('Gemini API key not configured');
		}

		const triggerQuestions: QuizQuestion[] = [];
		const lines = content.split('\n');

		// Process each line
		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine) continue;

			// Check if line starts with any trigger
			for (const triggerWord of this.settings.triggers) {
				const triggerPattern = new RegExp(`^\\*?${triggerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?\\s*:?\\s*(.+)$`, 'i');
				const match = trimmedLine.match(triggerPattern);

				if (match) {
					const answer = match[1].trim();
					if (answer) {
						// Generate question based on trigger
						let question = `What is ${triggerWord}?`;
						
						// Customize question based on trigger word type
						if (triggerWord.toLowerCase().includes('example')) {
							question = `What is a ${triggerWord}?`;
						} else if (triggerWord.toLowerCase().includes('definition')) {
							question = `What is the definition?`;
						} else if (triggerWord.toLowerCase().includes('formula')) {
							question = `What is the formula?`;
						} else if (triggerWord.toLowerCase().includes('theorem')) {
							question = `What is the theorem?`;
						} else if (triggerWord.toLowerCase().includes('principle') || triggerWord.toLowerCase().includes('law')) {
							question = `What is the ${triggerWord}?`;
						} else if (triggerWord.toLowerCase().includes('concept')) {
							question = `What is the concept?`;
						} else if (triggerWord.toLowerCase().includes('key point') || triggerWord.toLowerCase().includes('important')) {
							question = `What is the key point?`;
						}

						triggerQuestions.push({
							type: 'short-answer',
							question: question,
							answer: answer,
							explanation: `Generated from trigger: "${triggerWord}"`
						});
					}
					break; // Only match the first trigger word per line
				}
			}
		}

		if (triggerQuestions.length === 0) {
			throw new Error(`No triggers found. Use words like: ${this.settings.triggers.slice(0, 3).join(', ')}, etc.`);
		}

		// Optional: Use AI to improve the questions
		if (triggerQuestions.length > 0) {
			try {
				await this.enhanceTriggerWordQuestions(triggerQuestions, content);
			} catch (error) {
				console.warn('Failed to enhance trigger word questions with AI:', error.message);
				// Continue with basic questions if AI enhancement fails
			}
		}

		return triggerQuestions;
	}

	/**
	 * Use AI to enhance trigger questions with better phrasing and explanations
	 */
	private async enhanceTriggerWordQuestions(questions: QuizQuestion[], originalContent: string): Promise<void> {
		const model = this.genAI!.getGenerativeModel({ model: 'gemini-2.5-flash' });

		const questionsText = questions.map((q, i) => `${i + 1}. Q: ${q.question} | A: ${q.answer}`).join('\n');

		const prompt = `Based on the following content and automatically generated questions, improve the questions to be more specific and educational:

Original content:
${originalContent}

Auto-generated questions:
${questionsText}

For each question, provide:
1. A better, more specific question that tests understanding of the answer
2. A brief explanation (1-2 sentences) about why this is important

Respond in JSON format:
{
  "improvements": [
    {
      "originalQuestion": "What is the concept?",
      "improvedQuestion": "What concept is being described here?",
      "explanation": "This concept is important because..."
    }
  ]
}`;

		try {
			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const improvements = JSON.parse(jsonMatch[0]);
				
				// Apply improvements
				if (improvements.improvements && Array.isArray(improvements.improvements)) {
					improvements.improvements.forEach((improvement: any, index: number) => {
						if (index < questions.length) {
							if (improvement.improvedQuestion) {
								questions[index].question = improvement.improvedQuestion;
							}
							if (improvement.explanation) {
								questions[index].explanation = improvement.explanation;
							}
						}
					});
				}
			}
		} catch (error) {
			console.warn('Failed to parse AI enhancement response:', error.message);
		}
	}

	async testConnection(): Promise<boolean> {
		if (!this.genAI) {
			console.log('No GenAI instance available');
			return false;
		}

		if (!this.settings.geminiApiKey || this.settings.geminiApiKey.trim() === '') {
			console.log('API key is empty');
			return false;
		}

		try {
			console.log('Testing connection with API key:', this.settings.geminiApiKey.substring(0, 10) + '...');
			const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
			const result = await model.generateContent('Say "Hello" if you can hear me.');
			const response = await result.response;
			const text = response.text();
			console.log('API response:', text);
			return text.toLowerCase().includes('hello');
		} catch (error) {
			console.error('API connection test failed:', error);
			console.error('Error details:', error.message);
			return false;
		}
	}

	/**
	 * Enhance all cards in a single API call for better performance
	 */
	async enhanceAllCards(questions: QuizQuestion[], context: string, documentContext?: string): Promise<QuizQuestion[]> {
		if (!this.genAI) {
			throw new Error('Gemini API key not configured');
		}

		console.log('🤖 Enhancing', questions.length, 'cards with AI...');
		
		const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

		// Limit context size for performance
		const limitedContext = context.length > 2000 ? context.substring(0, 2000) + '...' : context;

		// Include document context if available
		const fullContext = documentContext ? 
			`Document Context:\n${documentContext}\n\nContent:\n${limitedContext}` : 
			limitedContext;

		const prompt = `Enhance these flashcards by improving questions and adding brief explanations. Use the document context to make questions more specific and relevant.

${fullContext}

Current cards:
${JSON.stringify(questions, null, 2)}

Instructions:
- Use the file name and section context to make questions more specific
- Improve question clarity and wording to include document context
- Add brief explanations (1-2 sentences) that reference the source
- Keep the same answer content but enhance with context
- Maintain the original structure
- Make questions more contextual and educational
- For trigger word cards, ensure questions reference the specific document/section

Return the enhanced cards in the same JSON format.`;

		try {
			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			
			// Parse the JSON response
			const jsonMatch = text.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const enhancedQuestions = JSON.parse(jsonMatch[0]);
				console.log('✨ Successfully enhanced', enhancedQuestions.length, 'cards with context');
				return enhancedQuestions;
			} else {
				console.warn('Failed to parse AI response, returning original cards');
				return questions;
			}
		} catch (error) {
			console.error('AI enhancement failed:', error);
			return questions; // Return original cards if enhancement fails
		}
	}

	/**
	 * Generate a simple text response from Gemini for insights and explanations
	 */
	async generateContent(prompt: string): Promise<string> {
		if (!this.genAI) {
			throw new Error('Gemini API key not configured');
		}

		try {
			const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
			const result = await model.generateContent(prompt);
			const response = await result.response;
			return response.text();
		} catch (error: any) {
			console.error('Error generating content:', error);
			
			if (error?.message?.includes('API_KEY') || error?.message?.includes('invalid')) {
				throw new Error('Invalid API key. Please check your Gemini API key in settings.');
			} else if (error?.message?.includes('quota') || error?.message?.includes('limit')) {
				throw new Error('API quota exceeded. Please check your Gemini API usage limits.');
			} else if (error?.message?.includes('model')) {
				throw new Error('Model not available. Please try again later.');
			} else {
				throw new Error(`AI generation failed: ${error?.message || 'Unknown error'}`);
			}
		}
	}
}