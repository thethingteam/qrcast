import { EXAMPLES } from './examples.js';

const list = document.getElementById('examples')!;
const entries = [
  ...EXAMPLES.map((example) => ({ href: `send.html?example=${example.id}`, title: example.title, text: example.description })),
  { href: 'send.html?example=random', title: 'Random body', text: 'Incompressible bytes of any size. Best for measuring speed.' },
  { href: 'send.html?example=file', title: 'Your own file', text: 'Choose any file. The receiver shows its size and hash.' },
];
for (const entry of entries) {
  const card = document.createElement('a');
  card.className = 'card';
  card.href = entry.href;
  const title = document.createElement('h2');
  title.textContent = entry.title;
  const text = document.createElement('p');
  text.className = 'muted small';
  text.textContent = entry.text;
  card.append(title, text);
  list.append(card);
}
