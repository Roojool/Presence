const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('story follows visible chapters when scrolling in either direction', () => {
  const indicator = { textContent: '' };
  const visual = { dataset: {}, querySelector: () => indicator };
  const chapters = [1, 2, 3].map(n => ({ dataset: { storyChapter: String(n) }, classList: { toggle() {} } }));
  let notify;
  const observed = [];
  class Observer {
    constructor(callback) { notify = callback; }
    observe(chapter) { observed.push(chapter); }
  }
  const document = { querySelector: () => visual, querySelectorAll: () => chapters };
  vm.runInNewContext(fs.readFileSync('public/assets/story.js', 'utf8'), {
    document, window: { IntersectionObserver: Observer }, IntersectionObserver: Observer,
  });
  assert.equal(observed.length, 3);
  for (const stage of [1, 2, 3, 2, 1]) {
    notify([{ target: chapters[stage - 1], isIntersecting: true }]);
    assert.equal(visual.dataset.stage, String(stage));
    assert.equal(indicator.textContent, `0${stage}`);
  }
});
