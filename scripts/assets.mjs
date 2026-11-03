import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  ctx.scale(size / 128, size / 128);
  ctx.fillStyle = '#8d73d7'; ctx.beginPath(); ctx.roundRect(0, 0, 128, 128, 27); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(74, 26); ctx.lineTo(36, 26); ctx.lineTo(36, 102); ctx.lineTo(91, 102); ctx.lineTo(91, 45); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(73, 27); ctx.lineTo(73, 46); ctx.lineTo(90, 46); ctx.stroke();
  for (const [y, x] of [[63, 76], [77, 76], [90, 63]]) { ctx.beginPath(); ctx.moveTo(49, y); ctx.lineTo(x, y); ctx.stroke(); }
  await writeFile(`public/icons/icon-${size}.png`, canvas.toBuffer('image/png'));
}
if (process.argv.includes('--icons-only')) process.exit(0);

const doc = await PDFDocument.create();
const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const blue = rgb(.26, .38, .72), ink = rgb(.19, .23, .31), gray = rgb(.51, .55, .62), light = rgb(.88, .9, .94);
function text(page, value, x, top, size, font = regular, color = ink) { page.drawText(value, { x, y: page.getHeight() - top - size, size, font, color }); }
function line(page, top) { page.drawLine({ start: { x: 58, y: 792 - top }, end: { x: 554, y: 792 - top }, thickness: .6, color: light }); }
function footer(page, n) { line(page, 738); text(page, 'STUDIO NORTH     /     A WORK IN PROGRESS', 58, 751, 7, regular, gray); text(page, `0${n}`, 542, 751, 8, regular, gray); }
const p = doc.addPage([612, 792]);
text(p, 'S T U D I O   N O R T H', 58, 47, 9, bold, blue);
text(p, 'PROJECT BRIEF  /  2026', 416, 47, 7, regular, gray);
line(p, 83);
text(p, 'Good things start', 58, 117, 42, serif);
text(p, 'with a little space.', 58, 165, 42, serif);
text(p, 'A fresh chapter for the way we work together.', 60, 232, 12, regular, gray);
p.drawRectangle({ x: 58, y: 792 - 328, width: 496, height: 42, color: rgb(.96, .97, .985) });
text(p, '01', 72, 300, 9, bold, blue); text(p, 'THE IDEA', 104, 300, 9, bold);
for (const [i, value] of [
  'Create a place for considered work. A place where the details feel',
  'intentional, the tools stay out of the way, and good ideas have room',
  'to become something real.',
].entries()) text(p, value, 60, 351 + i * 21, 11, regular, gray);
text(p, 'A few things to make our own', 60, 451, 18, serif);
for (const [i, [title, body]] of [
  ['Make it clear', 'Simple tools. Thoughtful decisions. A little less noise.'],
  ['Make it useful', 'Start with the moments that need a finishing touch.'],
  ['Make it yours', 'Leave room for a name, a note, or a different point of view.'],
].entries()) {
  const top = 495 + i * 53;
  text(p, `0${i + 1}`, 60, top + 2, 9, regular, blue); text(p, title, 88, top, 11, bold); text(p, body, 88, top + 19, 9, regular, gray);
}
footer(p, 1);
const p2 = doc.addPage([612, 792]);
text(p2, 'S T U D I O   N O R T H', 58, 47, 9, bold, blue); line(p2, 83);
text(p2, 'The details matter.', 58, 120, 36, serif);
text(p2, 'A small space for the next steps.', 60, 179, 12, regular, gray);
for (const [i, label] of ['Your name', 'A thought to take forward', 'What happens next', 'One last thing'].entries()) {
  const top = 255 + i * 104;
  text(p2, label.toUpperCase(), 60, top, 8, bold, gray);
  line(p2, top + 63);
}
footer(p2, 2);
await writeFile('public/sample.pdf', await doc.save());

// Rotated, cropped pages exercise placement in coordinate systems beyond portrait A4.
const fixture = await PDFDocument.create();
for (const rotation of [0, 90, 180, 270]) {
  const page = fixture.addPage([612, 792]);
  page.setCropBox(24, 36, 560, 700); page.setRotation(degrees(rotation));
  page.drawText(`Rotated ${rotation} degrees`, { x: 50, y: 680, size: 20 });
}
await mkdir('tests/fixtures', { recursive: true });
await writeFile('tests/fixtures/rotated.pdf', await fixture.save());
