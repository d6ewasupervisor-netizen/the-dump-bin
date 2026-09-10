'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  capitalizeNameWords,
  capitalizeNameWhileTyping,
} = require('../js/lib/person-name');

test('saved signer names capitalize every word', () => {
  assert.equal(capitalizeNameWords('eric owens'), 'Eric Owens');
  assert.equal(capitalizeNameWords('MARY ANN VAN BUREN'), 'Mary Ann Van Buren');
  assert.equal(capitalizeNameWords("shaun o'NEILL-smith"), "Shaun O'Neill-Smith");
  assert.equal(capitalizeNameWords('McDonald deSilva'), 'McDonald DeSilva');
});

test('name entry capitalizes the first letter after each space', () => {
  assert.equal(capitalizeNameWhileTyping('mary ann van buren'), 'Mary Ann Van Buren');
  assert.equal(capitalizeNameWhileTyping('Mary '), 'Mary ');
});
