// Journal prompts and tag ideas. A different prompt is suggested each day.

export const PROMPTS = [
  { id: 'gratitude', title: 'Gratitude', text: 'Three things you are grateful for today' },
  { id: 'reflection', title: 'Reflection', text: 'One thing you would do differently' },
  { id: 'highlight', title: 'Highlight', text: 'The best part of your day' },
  { id: 'challenge', title: 'Challenge', text: 'Something that tested you today' },
  { id: 'growth', title: 'Growth', text: 'Something you learned' },
];

export const TAG_SUGGESTIONS = ['gratitude', 'work', 'family', 'health', 'growth'];

export function promptForDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return PROMPTS[((dayNumber % PROMPTS.length) + PROMPTS.length) % PROMPTS.length];
}

export const wordCount = (text) => (text.trim().match(/\S+/g) || []).length;
