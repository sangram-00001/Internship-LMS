import { z } from 'zod';
export const questionSchema = z.object({
  id: z.string().uuid(), prompt: z.string().trim().min(3).max(2000),
  kind: z.enum(['MCQ', 'MULTI', 'TRUE_FALSE']),
  choices: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
  correctOptions: z.array(z.number().int().min(0).max(7)).min(1).max(8),
}).strict().superRefine((q, ctx) => {
  if (new Set(q.correctOptions).size !== q.correctOptions.length || q.correctOptions.some(i => i >= q.choices.length)) ctx.addIssue({ code: 'custom', message: 'Select valid distinct correct answers.' });
  if (q.kind !== 'MULTI' && q.correctOptions.length !== 1) ctx.addIssue({ code: 'custom', message: 'This question requires one correct answer.' });
  if (q.kind === 'TRUE_FALSE' && (q.choices.length !== 2 || q.choices[0] !== 'True' || q.choices[1] !== 'False')) ctx.addIssue({ code: 'custom', message: 'True/false choices must be True and False.' });
});
export const questionListSchema = z.array(questionSchema).min(1).max(100).refine(q => new Set(q.map(v => v.id)).size === q.length, 'Question IDs must be unique.');
export const answersSchema = z.array(z.object({ questionId: z.string().uuid(), selected: z.array(z.number().int().min(0).max(7)).max(8) }).strict()).max(100);
export function gradeQuiz(questions: z.infer<typeof questionListSchema>, answers: z.infer<typeof answersSchema>) {
  if (new Set(answers.map(a => a.questionId)).size !== answers.length) throw new Error('Duplicate answers.');
  let correct = 0;
  for (const answer of answers) {
    const question = questions.find(q => q.id === answer.questionId);
    if (!question || new Set(answer.selected).size !== answer.selected.length || answer.selected.some(i => i >= question.choices.length)) throw new Error('Invalid answers.');
    if (answer.selected.length === question.correctOptions.length && answer.selected.every(i => question.correctOptions.includes(i))) correct++;
  }
  return Math.round(correct / questions.length * 100);
}
