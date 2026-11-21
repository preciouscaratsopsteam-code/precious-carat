import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactMatchesOrder, leadNote } from '../src/admin.ts';
import { contextBlock, sanitizeHistory, sanitizePage, todayInIndia } from '../src/chat.ts';
import { decodeEntities, extractMain, htmlToText } from '../src/html.ts';
import { DOCS, systemPrompt } from '../src/prompt.ts';
import { emailKey, isHandle, matchFacetValues, orderDigits, parseCarat, parseRatti, phoneKey, toE164 } from '../src/util.ts';

test('parseCarat reads the store title formats', () => {
  assert.equal(parseCarat('Burma Ruby 4.33 Carat'), 4.33);
  assert.equal(parseCarat('African Ruby  5.02 Carats'), 5.02);
  assert.equal(parseCarat('Srilankan Pukhraj Ratna4.99 Carat'), 4.99);
  assert.equal(parseCarat('Fresh Water Pearl 8mm Strand'), null);
  assert.equal(parseCarat('Fresh Water Pearl 8mm Strand', 'A strand weighing 12.5 ct in total.'), 12.5);
});

test('parseRatti reads the bracketed ratti weight', () => {
  assert.equal(parseRatti('weighs 9.48 ct (10.54 ratti). Its treatment'), 10.54);
  assert.equal(parseRatti('no weight here'), null);
});

test('phone and email keys ignore formatting', () => {
  assert.equal(phoneKey('+91 99081-90811'), '9908190811');
  assert.equal(phoneKey('09908190811'), '9908190811');
  assert.equal(phoneKey('12345'), null);
  assert.equal(emailKey('  Asha@Example.COM '), 'asha@example.com');
  assert.equal(emailKey('not an email'), null);
});

test('toE164 accepts Indian mobiles and explicit country codes only', () => {
  assert.equal(toE164('99081 90811'), '+919908190811');
  assert.equal(toE164('09908190811'), '+919908190811');
  assert.equal(toE164('919908190811'), '+919908190811');
  assert.equal(toE164('+1 (415) 555-0100'), '+14155550100');
  assert.equal(toE164('0044 20 7946 0958'), '+442079460958');
  assert.equal(toE164('12345'), null);
  assert.equal(toE164('1234567890'), null); // ten digits that cannot be an Indian mobile
});

test('orderDigits', () => {
  assert.equal(orderDigits('#1131'), '1131');
  assert.equal(orderDigits('order no. 1131'), '1131');
  assert.equal(orderDigits('abc'), null);
});

test('matchFacetValues: exact wins, otherwise start-of-word', () => {
  const origins = ['Africa', 'African', 'Burma', 'Sri Lanka', 'Mozambique'].map((label) => ({ label }));
  assert.deepEqual(matchFacetValues(origins, 'burma').map((v) => v.label), ['Burma']);
  assert.deepEqual(matchFacetValues(origins, 'Africa').map((v) => v.label), ['Africa', 'African']);
  assert.deepEqual(matchFacetValues([...origins, { label: 'Srilanka' }], 'sri lanka').map((v) => v.label), ['Sri Lanka', 'Srilanka']);
  assert.deepEqual(matchFacetValues(origins, 'afric').map((v) => v.label), ['Africa', 'African']);
  assert.deepEqual(matchFacetValues(origins, 'srilanka').map((v) => v.label), ['Sri Lanka']);
  assert.deepEqual(matchFacetValues(origins, 'ceylon'), []);

  const treatments = ['Heated', 'Unheated and Untreated – No indications of treatment observed', 'Minor Oil'].map((label) => ({ label }));
  assert.deepEqual(matchFacetValues(treatments, 'heated').map((v) => v.label), ['Heated']);
  assert.equal(matchFacetValues(treatments, 'unheated').length, 1);
  assert.match(matchFacetValues(treatments, 'unheated')[0]!.label, /^Unheated/);

  const gems = ['Cats Eye', 'Blue Sapphire', 'Yellow Sapphire', 'Coral', 'White Coral'].map((label) => ({ label }));
  assert.deepEqual(matchFacetValues(gems, "cat's eye").map((v) => v.label), ['Cats Eye']);
  assert.deepEqual(matchFacetValues(gems, 'coral').map((v) => v.label), ['Coral']);
  assert.deepEqual(matchFacetValues(gems, 'sapphire').map((v) => v.label), ['Blue Sapphire', 'Yellow Sapphire']);
});

test('isHandle rejects anything that could alter a URL or query', () => {
  assert.ok(isHandle('burma-ruby-4-33-carat-ru000003874'));
  assert.ok(!isHandle('../admin'));
  assert.ok(!isHandle('a"b'));
  assert.ok(!isHandle(''));
  assert.ok(!isHandle(42));
});

test('htmlToText keeps structure and drops scripts', () => {
  const html = '<main id="MainContent"><h1>Returns</h1><script>x()</script><p>Within&nbsp;10 days &amp; unset.</p><ul><li>One</li><li>Two</li></ul></main><footer>no</footer>';
  assert.equal(htmlToText(extractMain(html)), '# Returns\nWithin 10 days & unset.\n- One\n- Two');
  assert.equal(decodeEntities('&#8377;500 &ndash; &rsquo;'), '₹500 – ’');
});

test('sanitizeHistory enforces shape, order and size', () => {
  assert.deepEqual(sanitizeHistory([{ role: 'user', content: ' hi ' }]), [{ role: 'user', content: 'hi' }]);
  assert.equal(sanitizeHistory([{ role: 'assistant', content: 'hello' }]), null); // must end with the customer
  assert.equal(sanitizeHistory([{ role: 'system', content: 'x' }]), null);
  assert.equal(sanitizeHistory([{ role: 'user', content: 'x'.repeat(2001) }]), null);
  assert.equal(sanitizeHistory('nope'), null);
  const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  long.push({ role: 'user', content: 'last' });
  const kept = sanitizeHistory(long)!;
  assert.ok(kept.length <= 24);
  assert.equal(kept[0]!.role, 'user');
  assert.equal(kept.at(-1)!.content, 'last');
});

test('sanitizePage keeps only validated fields', () => {
  assert.deepEqual(sanitizePage({ path: '/products/x', title: 'A <b>', product_handle: 'x', collection_handle: '../y', extra: 1 }), {
    path: '/products/x',
    title: 'A b',
    product_handle: 'x',
  });
  assert.deepEqual(sanitizePage({ path: 'https://evil.example' }), {});
  assert.match(contextBlock({ path: '/', product_handle: 'x' }, '2026-11-21'), /today: 2026-11-21\npage: \/\nviewing_product: x/);
  assert.equal(todayInIndia(new Date('2026-11-21T20:00:00Z')), '2026-11-22');
});

test('an order is verified only by a contact that is on it', () => {
  const order = {
    email: 'Asha@Example.com',
    phone: null,
    customer: { defaultEmailAddress: null, defaultPhoneNumber: { phoneNumber: '+919908190811' } },
    shippingAddress: { phone: '098765 43210' },
    billingAddress: null,
  };
  assert.ok(contactMatchesOrder(order, 'asha@example.com'));
  assert.ok(contactMatchesOrder(order, '99081 90811'));
  assert.ok(contactMatchesOrder(order, '+91-9876543210'));
  assert.ok(!contactMatchesOrder(order, 'someone@else.com'));
  assert.ok(!contactMatchesOrder(order, '9000000000'));
  assert.ok(!contactMatchesOrder(order, ''));
  assert.ok(!contactMatchesOrder({ email: null, phone: null, customer: null, shippingAddress: null, billingAddress: null }, ''));
});

test('leadNote is dated and bounded', () => {
  const note = leadNote({ name: 'A', interest: 'Blue sapphire 5 ratti', notes: 'Makar rashi', page: '/collections/blue-sapphire' }, '2026-11-21');
  assert.equal(note, '[Chat lead 2026-11-21] Blue sapphire 5 ratti | Notes: Makar rashi | Page: /collections/blue-sapphire');
  assert.ok(leadNote({ name: 'A', interest: 'x'.repeat(5000) }, '2026-11-21').length < 400);
});

test('the system prompt is stable and carries the core pages', () => {
  const env = { ANTHROPIC_API_KEY: 'test' };
  const a = systemPrompt(env);
  assert.equal(a, systemPrompt({ ...env })); // byte-identical: required for prompt caching
  assert.ok(DOCS.length >= 40, 'knowledge.json looks incomplete — run `npm run knowledge`');
  for (const id of ['contact-us', 'easy-returns-money-back', 'treatment-disclosure']) assert.ok(a.includes(`<page id="${id}"`), `core page ${id} missing`);
  assert.ok(a.includes('- ruby-gem-guide'));
  assert.ok(a.includes('https://wa.me/919908190811'));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a.split('# Store pages')[0]!), 'no timestamps in the instructions');
});
