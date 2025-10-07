import { QuizQuestion } from './gemini-service';

export class AnkiExporter {
	static exportToTxt(questions: QuizQuestion[]): string {
		let output = '';
		
		questions.forEach((question, index) => {
			let front, back;
			
			// Handle cloze deletion cards differently
			if (question.type === 'cloze' && question.clozeText) {
				// For cloze cards, the front is the cloze text and back is empty
				front = question.clozeText;
				back = '';
				
				// Add explanation if available
				if (question.explanation) {
					back = question.explanation;
				}
			} else {
				// Standard Anki format: Front	Back	Tags
				front = question.question;
				back = question.answer;
				
				// Add options for multiple choice questions
				if (question.type === 'multiple-choice' && question.options) {
					front += '\n\nOptions:\n' + question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n');
				}
				
				// Add explanation if available
				if (question.explanation) {
					back += '<br><br>Explanation: ' + question.explanation;
				}
			}
			
			// Clean and escape content for Anki format
			front = AnkiExporter.cleanTextForAnki(front);
			back = AnkiExporter.cleanTextForAnki(back);
			
			// Use different tags for cloze vs regular cards
			const tag = question.type === 'cloze' ? 'gemini-cloze' : 'gemini-quiz';
			output += `${front}\t${back}\t${tag}\n`;
		});
		
		return output;
	}
	
	static exportToCsv(questions: QuizQuestion[]): string {
		let output = 'Front,Back,Tags\n';
		
		questions.forEach((question) => {
			let front, back;
			
			// Handle cloze deletion cards differently
			if (question.type === 'cloze' && question.clozeText) {
				front = question.clozeText;
				back = '';
				
				if (question.explanation) {
					back = question.explanation;
				}
			} else {
				front = question.question;
				back = question.answer;
				
				// Add options for multiple choice questions
				if (question.type === 'multiple-choice' && question.options) {
					front += '\n\nOptions:\n' + question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n');
				}
				
				// Add explanation if available
				if (question.explanation) {
					back += '<br><br>Explanation: ' + question.explanation;
				}
			}
			
			// Clean text for proper formatting
			front = AnkiExporter.cleanTextForAnki(front);
			back = AnkiExporter.cleanTextForAnki(back);
			
			// Escape quotes and commas for CSV
			front = `"${front.replace(/"/g, '""')}"`;
			back = `"${back.replace(/"/g, '""')}"`;
			
			const tag = question.type === 'cloze' ? 'gemini-cloze' : 'gemini-quiz';
			output += `${front},${back},"${tag}"\n`;
		});
		
		return output;
	}
	
	static downloadFile(content: string, filename: string, mimeType: string) {
		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	/**
	 * Clean and format text for Anki import
	 */
	private static cleanTextForAnki(text: string): string {
		return text
			.replace(/\t/g, ' ') // Replace tabs with spaces
			.replace(/\n\s*\n/g, '<br><br>') // Double line breaks become double <br>
			.replace(/\n/g, '<br>') // Single line breaks become single <br>
			.replace(/\s+<br>/g, '<br>') // Remove spaces before <br>
			.replace(/<br>\s+/g, '<br>'); // Remove spaces after <br>
	}
}