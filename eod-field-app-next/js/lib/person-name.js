(function (global) {
  'use strict';

  function capitalizePart(part) {
    if (!part) return part;
    const hasLower = /[a-z]/.test(part);
    const hasUpperAfterFirst = /[A-Z]/.test(part.slice(1));
    if (hasLower && hasUpperAfterFirst) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }

  function capitalizeWord(word) {
    return String(word || '')
      .split(/([-'’])/)
      .map((part) => (/^[-'’]$/.test(part) ? part : capitalizePart(part)))
      .join('');
  }

  function capitalizeNameWords(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map(capitalizeWord)
      .join(' ');
  }

  function capitalizeNameWhileTyping(value) {
    return String(value || '').replace(/(^|\s)([A-Za-zÀ-ÖØ-öø-ÿ])/g, (_, lead, letter) =>
      `${lead}${letter.toUpperCase()}`
    );
  }

  const api = { capitalizeNameWords, capitalizeNameWhileTyping };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodPersonName = api;
})(typeof window !== 'undefined' ? window : globalThis);
