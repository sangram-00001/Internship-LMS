import { describe, expect, it } from 'vitest';
import { gradeQuiz, questionListSchema, questionSchema } from '../src/lib/assessment.js';
const single = { id: '1da73a99-5c8b-4706-9be3-9fa6be1bf857', prompt: 'Pick one answer', kind: 'MCQ' as const, choices: ['A', 'B'], correctOptions: [1] };
const multi = { ...single, id: 'fed1b6c8-3e88-4587-a257-087c48f717f0', kind: 'MULTI' as const, choices: ['A', 'B', 'C'], correctOptions: [0, 2] };
describe('server quiz scoring', () => {
  it('requires the exact answer set for multiple-answer questions', () => {
    expect(gradeQuiz([multi], [{ questionId: multi.id, selected: [2, 0] }])).toBe(100);
    expect(gradeQuiz([multi], [{ questionId: multi.id, selected: [0] }])).toBe(0);
    expect(gradeQuiz([multi], [{ questionId: multi.id, selected: [0, 1, 2] }])).toBe(0);
  });
  it('counts unanswered questions as incorrect', () => {
    expect(gradeQuiz([single, multi], [{questionId: single.id, selected: [1]}])).toBe(50);
  });
  it('rejects duplicated, unknown and out-of-range answers', () => {
    expect(() => gradeQuiz([single], [{questionId: single.id, selected: [1, 1]}])).toThrow();
    expect(() => gradeQuiz([single], [{questionId: multi.id, selected: [1]}])).toThrow();
    expect(() => gradeQuiz([single], [{questionId: single.id, selected: [7]}])).toThrow();
    expect(() => gradeQuiz([single], [{questionId: single.id, selected: [1]}, {questionId: single.id, selected: [1]}])).toThrow();
  });
  it('rejects invalid answer keys and duplicate question IDs', () => {
    expect(questionSchema.safeParse({...single, correctOptions: [2]}).success).toBe(false);
    expect(questionSchema.safeParse({...single, kind: 'TRUE_FALSE'}).success).toBe(false);
    expect(questionListSchema.safeParse([single, single]).success).toBe(false);
  });
});
