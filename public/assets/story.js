(function () {
  'use strict';
  var visual = document.querySelector('.story-visual');
  var chapters = document.querySelectorAll('[data-story-chapter]');
  if (!visual || !chapters.length || !('IntersectionObserver' in window)) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      entry.target.classList.toggle('is-current', entry.isIntersecting);
      if (entry.isIntersecting) {
        var stage = entry.target.dataset.storyChapter;
        visual.dataset.stage = stage;
        visual.querySelector('.story-current').textContent = '0' + stage;
      }
    });
  }, { rootMargin: '-30% 0px -40% 0px', threshold: 0 });
  chapters.forEach(function (chapter) { observer.observe(chapter); });
})();
